import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AudioInput, type AudioSource } from './audio/input';
import type { AudioBands } from './audio/bands';
import { CpuBackend } from './backends/cpu';
import { GpuBackend } from './backends/gpu';
import { chooseBackend, clampParticles, createRenderer, detectCapabilities, type BackendChoice, type BackendPreference } from './backends/select';
import type { Backend, BackendKind, FrameInput } from './backends/types';
import { resolveLook, type Look } from './looks';
import { MotionPreference, StillFrames } from './runtime/motion';
import { PointerTracker } from './runtime/pointer';
import { AutoQuality } from './runtime/quality';
import { describeShaderFailure } from './runtime/shader-log';
import { DEFAULT_VIEW, FIELD_OF_VIEW, ViewTween, verticalFov } from './runtime/view';
import { DEFAULT_FORMULA, resolveSource, type Source, type Target } from './sources';
import { PHYSICS, type PointerState } from './backends/physics';

/** Higher than three's default: on a dark background only dense, bright areas glow. */
const BLOOM_THRESHOLD = 0.35;
const NO_POINTER: PointerState = { active: false, x: 0, y: 0, z: 0 };

export interface SwarmOptions {
    /** Formula text, { formula }, { model } or { points }. Default: a sphere. */
    source?: Source;
    /** 'mic', an audio URL/File, an <audio> element, or null. Default: null. */
    audio?: AudioSource;
    /** Colors, background, style ('light' | 'solid'), bloom. Anything left out uses the defaults. */
    look?: Partial<Look>;
    /** Pace: multiplies time for shapes and travel speed for motions. Default: 1. */
    speed?: number;
    /** Camera height in degrees above the horizon (0 = side view, 90 = top-down). Default: 11. */
    tilt?: number;
    /**
     * Particle count you want: a ceiling, not an order. It is clamped to what the chosen backend
     * handles, and with `autoQuality` on (the default) it is still lowered if the device can't keep 30 fps.
     * Leave it out for a count chosen for the device.
     */
    particles?: number;
    /** 'auto' picks GPU when the browser can do GPGPU, CPU otherwise. */
    backend?: BackendPreference;
    /** Lower the particle count if the frame rate stays below 30 fps (it never raises it again). Default: true. Set false to hold `particles` exactly. */
    autoQuality?: boolean;
    /** The pointer pushes particles away. Default: true. */
    interactive?: boolean;
    /** Slowly orbit the camera. Default: true (never while the visitor has asked for reduced motion). */
    autoRotate?: boolean;
    /** Audio reactivity multiplier. Default: 1. */
    sensitivity?: number;
    /**
     * Called when the `source` or `audio` you passed here fails (bad formula, 404 model, mic denied…) —
     * nothing else holds a promise for those. Calls you make later (`setSource`, `setAudio`) report
     * through the promise they return and never reach `onError`. Without `onError`, failures go to `console.warn`.
     */
    onError?: (error: Error) => void;
}

export interface SwarmInfo {
    backend: BackendKind;
    /** Why that backend was picked. */
    reason: string;
    particles: number;
    fps: number;
    /** True if auto quality lowered the particle count. */
    reduced: boolean;
    /**
     * True while the visitor's "reduce motion" setting is on: the swarm is a still
     * picture, drawn again only when something changes. Follows the setting live.
     */
    still: boolean;
}

/**
 * Create a swarm that fills `container`. The canvas follows the container size.
 * Throws an Error (message starting "[NanoSwarm]") if the browser can't give it a WebGL context.
 */
export function createSwarm(container: HTMLElement, options: SwarmOptions = {}): Swarm {
    return new Swarm(container, options);
}

/** What `createSwarm` returns. Create swarms with `createSwarm`, not `new`. */
export class Swarm {
    /**
     * Resolves once the initial source is showing (models load asynchronously). Rejects with the same
     * error `onError` receives if it fails; it is marked handled, so ignoring it never logs an unhandled rejection.
     */
    readonly ready: Promise<void>;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 200);
    private readonly controls: OrbitControls;
    private readonly audio = new AudioInput();
    private readonly pointer: PointerTracker;
    private readonly viewTween: ViewTween;
    private readonly quality = new AutoQuality();
    private readonly still = new StillFrames();
    private readonly motion = new MotionPreference((reduced) => this.onMotionChange(reduced));
    private readonly resizeObserver: ResizeObserver;
    private readonly intersectionObserver: IntersectionObserver;
    private readonly onError?: (error: Error) => void;

    private backendPreference: BackendPreference;
    private autoQuality: boolean;
    private speed: number;
    private autoRotate: boolean;
    private backend!: Backend;
    private choice!: BackendChoice;
    private look: Look;
    private requestedParticles: number | undefined;
    private reduced = false;
    private target: Target | null = null;
    private sourceToken = 0;
    private composer: EffectComposer | null = null;
    private bloomPass: UnrealBloomPass | null = null;
    private frameId = 0;
    private lastTime = 0;
    private fps = 60;
    private visible = true;
    private pendingFallback = false;
    private disposed = false;
    /** Reused every frame — the render loop allocates nothing. */
    private readonly frame: FrameInput;

    constructor(private readonly container: HTMLElement, options: SwarmOptions) {
        this.backendPreference = options.backend ?? 'auto';
        this.autoQuality = options.autoQuality ?? true;
        this.speed = options.speed ?? 1;
        this.autoRotate = options.autoRotate ?? true;
        this.onError = options.onError;
        this.look = resolveLook(options.look);
        this.requestedParticles = options.particles;
        this.audio.sensitivity = options.sensitivity ?? 1;

        this.renderer = createRenderer();
        const canvas = this.renderer.domElement;
        canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
        container.appendChild(canvas);
        // A restored context comes back blank, and with motion reduced nothing else would redraw it.
        canvas.addEventListener('webglcontextrestored', () => this.still.resettle());
        // Setting this replaces three.js's own report, so print the driver's message before reacting.
        this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
            console.error(describeShaderFailure(gl, program, vertex, fragment));
            this.onShaderError();
        };

        this.camera.position.setFromSphericalCoords(
            DEFAULT_VIEW.distance,
            THREE.MathUtils.degToRad(90 - (options.tilt ?? DEFAULT_VIEW.elevation)),
            0,
        );
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.minDistance = 4;
        this.controls.maxDistance = 40;
        this.controls.autoRotateSpeed = 0.6;
        this.applyMotion();
        this.controls.addEventListener('start', () => this.viewTween.cancel()); // the user takes over
        this.controls.addEventListener('change', () => this.still.invalidate());

        this.pointer = new PointerTracker(canvas, this.camera, options.interactive ?? true);
        this.viewTween = new ViewTween(this.camera);
        this.frame = {
            dt: 0,
            time: 0,
            speed: this.speed,
            bands: this.audio.bands,
            spectrum: this.audio.spectrum,
            pointer: this.pointer.state,
        };

        this.buildBackend();
        this.applyLook();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.intersectionObserver = new IntersectionObserver(([entry]) => {
            this.visible = entry.isIntersecting;
            if (this.visible) this.quality.reset();
        });
        this.intersectionObserver.observe(container);
        this.resize();

        this.ready = this.setSource(options.source ?? DEFAULT_FORMULA);
        this.ready.catch((error) => this.report(error));
        if (options.audio) this.setAudio(options.audio).catch((error) => this.report(error));

        this.lastTime = performance.now();
        this.frameId = requestAnimationFrame(this.tick);
    }

    // ─── Public API ─────────────────────────────────────────────────

    /**
     * Change what the swarm forms. Particles fly from their current shape.
     * Rejects if the source can't be shown (the swarm keeps what it was showing).
     */
    async setSource(source: Source): Promise<void> {
        const token = ++this.sourceToken;
        const target = await resolveSource(source);
        if (token !== this.sourceToken || this.disposed) return; // a newer source won
        this.target = target;
        this.backend.setTarget(target);
        this.still.resettle();
    }

    /** The names of the current model's animations, in order (empty for formulas and still models). */
    get animations(): string[] {
        return this.target?.kind === 'animated' ? this.target.model.animations : [];
    }

    /** Start or replace the audio input. `null` stops it. Rejects if the sound can't start. */
    setAudio(source: AudioSource): Promise<void> {
        return this.audio.connect(source);
    }

    setLook(look: Partial<Look>): void {
        this.look = resolveLook(look);
        this.applyLook();
    }

    /**
     * Change the particle count you want (see `SwarmOptions.particles`); `undefined` goes back to the
     * count chosen for the device. Auto quality keeps working: it may lower this count again.
     */
    setParticles(count?: number): void {
        this.requestedParticles = count;
        this.reduced = false;
        if (clampParticles(this.choice.kind, count) !== this.backend.count) this.rebuild();
    }

    setBackend(preference: BackendPreference): void {
        this.backendPreference = preference;
        this.rebuild();
    }

    /** Let the pointer push particles away (true) or not. */
    setInteractive(on: boolean): void {
        this.pointer.setEnabled(on);
    }

    setSensitivity(value: number): void {
        this.audio.sensitivity = value;
    }

    setAutoRotate(on: boolean): void {
        this.autoRotate = on;
        this.applyMotion();
    }

    /** Pace: 1 = normal, 2 = twice as fast, 0.5 = half. */
    setSpeed(speed: number): void {
        this.speed = Math.max(0, speed);
    }

    /** Glide the camera to this height in degrees above the horizon. */
    setTilt(degrees: number): void {
        this.viewTween.start({ elevation: degrees, distance: this.camera.position.length() });
        if (this.motion.reduced) {
            this.viewTween.finish();
            this.still.invalidate();
        }
    }

    /** Current log-spaced spectrum, 0–1 per slice (what spectrum(k) reads). */
    get spectrum(): Float32Array {
        return this.audio.spectrum;
    }

    /** Current audio energy, 0–1 per band. */
    get bands(): AudioBands {
        return this.audio.bands;
    }

    /** The <audio> element created for a file source, for play/pause controls. */
    get audioElement(): HTMLAudioElement | null {
        return this.audio.element;
    }

    get info(): SwarmInfo {
        return {
            backend: this.backend.kind,
            reason: this.choice.reason,
            particles: this.backend.count,
            fps: Math.round(this.fps),
            reduced: this.reduced,
            still: this.motion.reduced,
        };
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frameId);
        this.motion.dispose();
        this.resizeObserver.disconnect();
        this.intersectionObserver.disconnect();
        this.pointer.dispose();
        this.controls.dispose();
        this.audio.dispose();
        this.backend.dispose();
        this.composer?.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }

    // ─── Backend lifecycle ──────────────────────────────────────────

    private buildBackend(): void {
        this.choice = chooseBackend(this.backendPreference, detectCapabilities(this.renderer));
        const count = clampParticles(this.choice.kind, this.requestedParticles);

        if (this.choice.kind === 'gpu') {
            try {
                this.backend = new GpuBackend(this.renderer, count, this.choice.dataType);
            } catch (error) {
                console.warn('[NanoSwarm] Falling back to CPU:', error);
                this.choice = { ...this.choice, kind: 'cpu', reason: 'GPU init failed' };
                this.backend = new CpuBackend(clampParticles('cpu', this.requestedParticles));
            }
        } else {
            this.backend = new CpuBackend(count);
        }

        this.scene.add(this.backend.object);
        if (this.target) this.backend.setTarget(this.target);
        this.quality.reset();
    }

    private rebuild(): void {
        this.scene.remove(this.backend.object);
        this.backend.dispose();
        this.buildBackend();
        this.applyLook();
        this.still.resettle();
    }

    /** The "reduce motion" setting changed while the page was open. */
    private onMotionChange(reduced: boolean): void {
        this.applyMotion();
        this.quality.reset();
        if (reduced) {
            this.viewTween.finish();
            this.still.resettle();
        }
    }

    /** Reduced motion: no orbiting on its own, and no coasting after the visitor lets go of the camera. */
    private applyMotion(): void {
        const reduced = this.motion.reduced;
        this.controls.autoRotate = this.autoRotate && !reduced;
        this.controls.enableDamping = !reduced;
    }

    /** A GPU shader failed to compile (exotic driver, odd formula): switch to CPU once. */
    private onShaderError(): void {
        if (this.backend.kind !== 'gpu' || this.backendPreference === 'gpu') return;
        console.warn('[NanoSwarm] GPU shader failed to compile — switching to the CPU backend.');
        this.pendingFallback = true;
    }

    // ─── Rendering ──────────────────────────────────────────────────

    private applyLook(): void {
        const background = new THREE.Color(this.look.background);
        this.scene.background = background;
        const pixelRatio = Math.min(window.devicePixelRatio, this.backend.kind === 'gpu' ? 2 : 1);
        this.renderer.setPixelRatio(pixelRatio);
        this.backend.setLook(this.look, pixelRatio);

        const wantsBloom = this.look.bloom > 0 && this.backend.kind === 'gpu';
        if (wantsBloom && !this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), this.look.bloom, 0.35, BLOOM_THRESHOLD);
            this.composer.addPass(this.bloomPass);
            this.composer.addPass(new OutputPass());
        } else if (!wantsBloom && this.composer) {
            this.composer.dispose();
            this.composer = null;
            this.bloomPass = null;
        }
        if (this.bloomPass) {
            this.bloomPass.strength = this.look.bloom;
            // Only what is brighter than the background glows — never the background itself.
            const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
            this.bloomPass.threshold = Math.max(BLOOM_THRESHOLD, luminance + 0.1);
        }
        this.resize();
    }

    private resize(): void {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(width, height, false);
        this.composer?.setPixelRatio(this.renderer.getPixelRatio());
        this.composer?.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.fov = verticalFov(this.camera.aspect);
        this.camera.updateProjectionMatrix();
        this.still.invalidate(); // resizing clears the canvas
    }

    private render(): void {
        if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    private readonly tick = (now: number): void => {
        this.frameId = requestAnimationFrame(this.tick);
        const dt = Math.min((now - this.lastTime) / 1000, 0.25);
        this.lastTime = now;
        if (!this.visible || dt <= 0) return;

        if (this.pendingFallback) {
            this.pendingFallback = false;
            this.backendPreference = 'cpu';
            this.rebuild();
            this.choice = { ...this.choice, reason: 'GPU shader failed to compile' };
        }

        if (this.motion.reduced) {
            this.stillFrame(dt);
            return;
        }

        this.fps += (1 / dt - this.fps) * 0.05;
        if (this.autoQuality) {
            const lower = this.quality.sample(dt, this.backend.count);
            if (lower !== null) {
                this.requestedParticles = lower;
                this.reduced = true;
                this.rebuild();
            }
        }

        this.viewTween.update(dt);
        this.controls.update(dt);

        const frame = this.frame;
        frame.dt = dt;
        frame.speed = this.speed;
        frame.time += dt * this.speed;
        frame.bands = this.audio.update(dt);
        frame.spectrum = this.audio.spectrum;
        this.backend.update(frame);
        this.render();
    };

    /**
     * One frame with motion reduced: time stands still, the swarm settles into
     * its shape in one go, and the picture is redrawn only when it changed.
     * Orbiting by hand still works — that movement is the visitor's own.
     */
    private stillFrame(dt: number): void {
        this.audio.update(dt); // keeps `bands` live for anyone reading them; the picture ignores sound
        this.controls.update(dt);
        const { steps, paint } = this.still.next();
        if (steps > 0) {
            const step = { ...this.frame, dt: PHYSICS.maxDelta, pointer: NO_POINTER };
            for (let i = 0; i < steps; i++) this.backend.update(step);
        }
        if (paint) this.render();
    }

    private report(error: unknown): void {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (this.onError) this.onError(failure);
        else console.warn(failure.message);
    }
}
