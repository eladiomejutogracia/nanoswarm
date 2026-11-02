import { FormulaError } from '../formula';
import { FlowError } from '../sources';
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
 * when a formula, model or audio fails, or when the browser has no WebGL. Every
 * error is also written to the console, so a broken formula never looks like an empty element.
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
    private sourceToken = 0;
    private waitingForParser: (() => void) | null = null;
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
        const token = ++this.sourceToken;
        try {
            this.instance = new Swarm(this.stage, {
                ...options,
                source: this.currentSource(),
                onError: (error) => this.fail(error),
            });
        } catch (error) {
            // No WebGL: same channel as every other failure, and never an exception out of the browser's callback.
            queueMicrotask(() => this.fail(error));
            return;
        }
        this.applied = options;

        // The HTML parser creates the element before its text exists. An empty element that is still
        // being parsed isn't "empty": wait for its formula instead of announcing the default sphere.
        if (document.readyState === 'loading' && !this.hasAttribute('model') && this.formula.trim() === '') {
            const onParsed = () => {
                this.waitingForParser = null;
                clearTimeout(this.formulaTimer);
                if (token === this.sourceToken) void this.applySource();
            };
            document.addEventListener('DOMContentLoaded', onParsed, { once: true });
            this.waitingForParser = () => document.removeEventListener('DOMContentLoaded', onParsed);
        } else {
            this.instance.ready.then(() => token === this.sourceToken && this.loaded(), () => { /* reported through onError */ });
        }
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
        this.waitingForParser?.();
        this.waitingForParser = null;
        clearTimeout(this.formulaTimer);
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
        if (next.particles !== prev.particles) swarm.setParticles(next.particles);
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
        const swarm = this.instance;
        if (!swarm) return;
        const token = ++this.sourceToken;
        this.waitingForParser?.();
        this.waitingForParser = null;
        try {
            await swarm.setSource(this.currentSource());
        } catch (error) {
            if (token === this.sourceToken) this.fail(error); // an older source failing is no longer news
            return;
        }
        if (token === this.sourceToken) this.loaded();
    }

    private loaded(): void {
        this.dispatchEvent(new CustomEvent('swarm-load'));
    }

    /** The one place errors leave the element: the `swarm-error` event, and the console. */
    private fail(error: unknown): void {
        const failure = error instanceof Error ? error : new Error(String(error));
        const text = failure instanceof FormulaError || failure instanceof FlowError
            ? `[NanoSwarm] This formula can't be drawn. ${failure.message}`
            : failure.message.startsWith('[NanoSwarm]') ? failure.message : `[NanoSwarm] ${failure.message}`;
        console.warn(text, this);
        this.dispatchEvent(new CustomEvent('swarm-error', { detail: failure }));
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
            swarm.setAudio(null).catch((error) => this.fail(error));
            return;
        }
        const source = this.audioFile && this.audioFile.name === audio ? this.audioFile : audio;
        const start = () => swarm.setAudio(source).catch((error) => this.fail(error));
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
