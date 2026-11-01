import { Swarm } from '../swarm';
import { ATTRIBUTE_NAMES, readOptions, type AttributeName, type ElementOptions } from './markup';

const FORMULA_DEBOUNCE_MS = 150;

// Importing the library outside a browser (tests, server rendering) must not
// crash just because HTMLElement does not exist there.
const ElementBase = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * <nano-swarm>: a particle swarm as plain HTML.
 *
 * The formula is the element's text; everything else is an attribute (see
 * ATTRIBUTES in ./markup). The canvas lives in a shadow root, so the light
 * DOM — and therefore `outerHTML` — stays exactly what you wrote.
 *
 * Events: `swarm-load` once a formula or model is showing; `swarm-error` (detail: Error)
 * when a formula, model or audio fails.
 */
export class NanoSwarmElement extends ElementBase {
    static readonly observedAttributes = ATTRIBUTE_NAMES;

    /** A File to use for the `model` attribute (e.g. from a file picker); the attribute holds its name. */
    modelFile: File | null = null;
    /** Same idea for `audio`: a picked file whose name is in the attribute. */
    audioFile: File | null = null;

    private instance: Swarm | null = null;
    private readonly stage: HTMLDivElement;
    private observer: MutationObserver | null = null;
    private formulaTimer = 0;
    private sourceQueued = false;
    private applied: ElementOptions | null = null;
    private waitingForGesture: (() => void) | null = null;

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>:host{display:block;position:relative;min-height:240px}div{position:absolute;inset:0}</style><div></div>';
        this.stage = root.querySelector('div')!;
    }

    /** The JavaScript API underneath (null until the element is in the page). */
    get swarm(): Swarm | null {
        return this.instance;
    }

    /** The formula: the element's text. */
    get formula(): string {
        return this.textContent ?? '';
    }

    set formula(text: string) {
        this.textContent = text;
    }

    connectedCallback(): void {
        if (this.instance) return;
        const options = this.readAttributes();
        this.instance = new Swarm(this.stage, {
            ...options,
            source: this.currentSource(),
            onError: (error) => this.dispatchEvent(new CustomEvent('swarm-error', { detail: error })),
        });
        this.applied = options;
        this.instance.ready.then(() => this.loaded(), () => { /* reported through onError */ });
        this.syncAudio();

        this.observer = new MutationObserver(() => {
            if (this.hasAttribute('model')) return;
            clearTimeout(this.formulaTimer);
            this.formulaTimer = window.setTimeout(() => void this.applySource(), FORMULA_DEBOUNCE_MS);
        });
        this.observer.observe(this, { childList: true, characterData: true, subtree: true });
    }

    disconnectedCallback(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.cancelGestureWait();
        this.instance?.dispose();
        this.instance = null;
        this.applied = null;
    }

    attributeChangedCallback(name: AttributeName, previous: string | null, value: string | null): void {
        const swarm = this.instance;
        if (!swarm || previous === value) return;

        if (name === 'model' || (name === 'animation' && this.hasAttribute('model'))) {
            // Once per task, so setting `model` and then `animation` loads the file once.
            if (!this.sourceQueued) queueMicrotask(() => {
                this.sourceQueued = false;
                void this.applySource();
            });
            this.sourceQueued = true;
            return;
        }
        if (name === 'animation') return;
        if (name === 'audio') {
            this.syncAudio();
            return;
        }

        const next = this.readAttributes();
        const prev = this.applied!;
        if (JSON.stringify(next.look) !== JSON.stringify(prev.look)) swarm.setLook(next.look);
        if (next.speed !== prev.speed) swarm.setSpeed(next.speed);
        if (next.tilt !== prev.tilt && next.tilt !== undefined) swarm.setTilt(next.tilt);
        if (next.particles !== prev.particles && next.particles !== undefined) swarm.setParticles(next.particles);
        if (next.backend !== prev.backend) swarm.setBackend(next.backend);
        if (next.sensitivity !== prev.sensitivity) swarm.setSensitivity(next.sensitivity);
        if (next.interactive !== prev.interactive) swarm.setInteractive(next.interactive);
        if (next.autoRotate !== prev.autoRotate) swarm.setAutoRotate(next.autoRotate);
        this.applied = next;
    }

    private readAttributes(): ElementOptions {
        return readOptions((name) => this.getAttribute(name));
    }

    private currentSource() {
        const model = this.getAttribute('model');
        if (model) {
            const file = this.modelFile && this.modelFile.name === model ? this.modelFile : null;
            return { model: file ?? model, animation: this.getAttribute('animation') || undefined };
        }
        return this.formula;
    }

    private async applySource(): Promise<void> {
        try {
            await this.instance?.setSource(this.currentSource());
            this.loaded();
        } catch {
            /* reported through onError */
        }
    }

    private loaded(): void {
        this.dispatchEvent(new CustomEvent('swarm-load'));
    }

    /**
     * Browsers only allow sound after the visitor has interacted with the
     * page. If they have, start now; otherwise wait for their first click or key.
     */
    private syncAudio(): void {
        const swarm = this.instance;
        if (!swarm) return;
        this.cancelGestureWait();
        const audio = this.getAttribute('audio');
        if (!audio) {
            void swarm.setAudio(null).catch(() => {});
            return;
        }
        const source = this.audioFile && this.audioFile.name === audio ? this.audioFile : audio;
        const start = () => void swarm.setAudio(source).catch(() => {});
        const activated = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
        if (activated) {
            start();
            return;
        }
        const onGesture = () => {
            this.cancelGestureWait();
            start();
        };
        window.addEventListener('pointerdown', onGesture, { once: true });
        window.addEventListener('keydown', onGesture, { once: true });
        this.waitingForGesture = () => {
            window.removeEventListener('pointerdown', onGesture);
            window.removeEventListener('keydown', onGesture);
        };
    }

    private cancelGestureWait(): void {
        this.waitingForGesture?.();
        this.waitingForGesture = null;
    }
}

/** Register <nano-swarm> (safe to call more than once). */
export function defineNanoSwarm(tag = 'nano-swarm'): void {
    if (!customElements.get(tag)) customElements.define(tag, NanoSwarmElement);
}
