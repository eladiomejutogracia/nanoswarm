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
import { chooseBackend, clampParticles, detectCapabilities, type BackendChoice, type BackendPreference } from './backends/select';
import type { Backend, BackendKind, FrameInput } from './backends/types';
import { resolveLook, type Look } from './looks';
import { PointerTracker } from './runtime/pointer';
import { AutoQuality } from './runtime/quality';
import { DEFAULT_VIEW, ViewTween } from './runtime/view';
import { DEFAULT_FORMULA, resolveSource, type Source, type Target } from './sources';

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
    /** Particle count. Clamped to what the chosen backend handles. */
    particles?: number;
    /** 'auto' picks GPU when the browser can do GPGPU, CPU otherwise. */
    backend?: BackendPreference;
    /** Lower the particle count if the frame rate stays below 30 fps. Default: true unless `particles` is set. */
    autoQuality?: boolean;
    /** The pointer pushes particles away. Default: true. */
    interactive?: boolean;
    /** Slowly orbit the camera. Default: true. */
    autoRotate?: boolean;
    /** Audio reactivity multiplier. Default: 1. */
    sensitivity?: number;
    /** Called when something fails after creation (bad model URL, mic denied…). */
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
}

/** Create a swarm that fills `container`. The canvas follows the container size. */
export function createSwarm(container: HTMLElement, options: SwarmOptions = {}): Swarm {
    return new Swarm(container, options);
}

export class Swarm {
    /** Resolves once the initial source is loaded (models load asynchronously). */
    readonly ready: Promise<void>;

    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    private readonly controls: OrbitControls;
    private readonly audio = new AudioInput();
    private readonly pointer: PointerTracker;
    private readonly viewTween: ViewTween;
    private readonly quality = new AutoQuality();
    private readonly resizeObserver: ResizeObserver;
    private readonly intersectionObserver: IntersectionObserver;
    private readonly onError?: (error: Error) => void;

    private backendPreference: BackendPreference;
    private autoQuality: boolean;
    private speed: number;
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
    private running = true;
    private visible = true;
    private pendingFallback = false;
    private disposed = false;
    private centerOffset = { x: 0, y: 0 };
    /** Reused every frame — the render loop allocates nothing. */
    private readonly frame: FrameInput;

    constructor(private readonly container: HTMLElement, options: SwarmOptions) {
        this.backendPreference = options.backend ?? 'auto';
        this.autoQuality = options.autoQuality ?? options.particles === undefined;
        this.speed = options.speed ?? 1;
        this.onError = options.onError;
        this.look = resolveLook(options.look);
        this.requestedParticles = options.particles;
        this.audio.sensitivity = options.sensitivity ?? 1;

        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        const canvas = this.renderer.domElement;
        canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
        container.appendChild(canvas);
        this.renderer.debug.onShaderError = () => this.onShaderError();

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
        this.controls.autoRotate = options.autoRotate ?? true;
        this.controls.autoRotateSpeed = 0.6;
        this.controls.addEventListener('start', () => this.viewTween.cancel()); // the user takes over

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
        if (options.audio) void this.setAudio(options.audio);

        this.lastTime = performance.now();
        this.frameId = requestAnimationFrame(this.tick);
    }

    // ─── Public API ─────────────────────────────────────────────────

    /** Change what the swarm forms. Particles fly from their current shape. */
    async setSource(source: Source): Promise<void> {
        const token = ++this.sourceToken;
        try {
            const target = await resolveSource(source);
            if (token !== this.sourceToken || this.disposed) return; // a newer source won
            this.target = target;
            this.backend.setTarget(target);
        } catch (error) {
            this.report(error);
            throw error;
        }
    }

    /** The names of the current model's animations, in order (empty for formulas and still models). */
    get animations(): string[] {
        return this.target?.kind === 'animated' ? this.target.model.animations : [];
    }

    /** Start or replace the audio input. `null` stops it. */
    async setAudio(source: AudioSource): Promise<void> {
        try {
            await this.audio.connect(source);
        } catch (error) {
            this.report(error);
            throw error;
        }
    }

    setLook(look: Partial<Look>): void {
        this.look = resolveLook(look);
        this.applyLook();
    }

    /** Set the particle count explicitly. This also turns auto quality off — you decided. */
    setParticles(count: number): void {
        this.requestedParticles = count;
        this.autoQuality = false;
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
        this.controls.autoRotate = on;
    }

    /** Pace: 1 = normal, 2 = twice as fast, 0.5 = half. */
    setSpeed(speed: number): void {
        this.speed = Math.max(0, speed);
    }

    /** Glide the camera to this height in degrees above the horizon. */
    setTilt(degrees: number): void {
        this.viewTween.start({ elevation: degrees, distance: this.camera.position.length() });
    }

    /**
     * Shift the visual center by (x, y) CSS pixels — e.g. to keep the swarm
     * centered in the free space next to a side panel. (0, 0) resets.
     */
    setCenterOffset(x: number, y = 0): void {
        this.centerOffset = { x, y };
        this.resize();
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
        };
    }

    pause(): void {
        this.running = false;
    }

    resume(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.quality.reset();
    }

    /** PNG data URL of the current frame. */
    screenshot(): string {
        this.render();
        return this.renderer.domElement.toDataURL('image/png');
    }

    dispose(): void {
        this.disposed = true;
        cancelAnimationFrame(this.frameId);
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
    }

    /** A GPU shader failed to compile (exotic driver, odd formula): switch to CPU once. */
    private onShaderError(): void {
        if (this.backend.kind !== 'gpu' || this.backendPreference === 'gpu') return;
        console.warn('[NanoSwarm] GPU shader failed to compile — switching to the CPU backend.');
        this.pendingFallback = true;
    }

    // ─── Rendering ──────────────────────────────────────────────────

    private applyLook(): void {
        this.scene.background = new THREE.Color(this.look.background);
        const pixelRatio = Math.min(window.devicePixelRatio, this.backend.kind === 'gpu' ? 2 : 1);
        this.renderer.setPixelRatio(pixelRatio);
        this.backend.setLook(this.look, pixelRatio);

        const wantsBloom = this.look.bloom > 0 && this.backend.kind === 'gpu';
        if (wantsBloom && !this.composer) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            // Higher threshold than three's default: only dense, bright areas glow.
            this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), this.look.bloom, 0.35, 0.35);
            this.composer.addPass(this.bloomPass);
            this.composer.addPass(new OutputPass());
        } else if (!wantsBloom && this.composer) {
            this.composer.dispose();
            this.composer = null;
            this.bloomPass = null;
        }
        if (this.bloomPass) this.bloomPass.strength = this.look.bloom;
        this.resize();
    }

    private resize(): void {
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(width, height, false);
        this.composer?.setPixelRatio(this.renderer.getPixelRatio());
        this.composer?.setSize(width, height);
        this.camera.aspect = width / height;
        const { x, y } = this.centerOffset;
        if (x || y) this.camera.setViewOffset(width, height, -x, -y, width, height);
        else this.camera.clearViewOffset();
        this.camera.updateProjectionMatrix();
    }

    private render(): void {
        if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    private readonly tick = (now: number): void => {
        this.frameId = requestAnimationFrame(this.tick);
        const dt = Math.min((now - this.lastTime) / 1000, 0.25);
        this.lastTime = now;
        if (!this.running || !this.visible || dt <= 0) return;

        if (this.pendingFallback) {
            this.pendingFallback = false;
            this.backendPreference = 'cpu';
            this.rebuild();
            this.choice = { ...this.choice, reason: 'GPU shader failed to compile' };
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

    private report(error: unknown): void {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
}
