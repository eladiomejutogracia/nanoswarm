/**
 * Just enough browser for the element and the swarm to run in Node (no WebGL, no layout):
 * import this file first, before anything from src/.
 */

export const fakes = {
    /** When set, createRenderer() throws it — what a browser without WebGL does. */
    rendererError: null as Error | null,
};

class FakeObserver {
    observe(): void {}
    disconnect(): void {}
}

class FakeElement extends EventTarget {
    private readonly attributes = new Map<string, string>();
    private text = '';
    readonly shadow = { innerHTML: '', querySelector: () => fakeCanvasHost() };

    attachShadow() { return this.shadow; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    hasAttribute(name: string) { return this.attributes.has(name); }
    setAttribute(name: string, value: string) {
        const previous = this.getAttribute(name);
        this.attributes.set(name, value);
        this.notify(name, previous, value);
    }
    removeAttribute(name: string) {
        const previous = this.getAttribute(name);
        this.attributes.delete(name);
        this.notify(name, previous, null);
    }
    // What the browser does for observedAttributes.
    private notify(name: string, previous: string | null, value: string | null) {
        const observed = (this.constructor as unknown as { observedAttributes?: string[] }).observedAttributes;
        if (observed?.includes(name)) (this as unknown as { attributeChangedCallback(...args: unknown[]): void }).attributeChangedCallback?.(name, previous, value);
    }
    get textContent() { return this.text; }
    set textContent(value: string | null) { this.text = value ?? ''; }
}

export function fakeCanvasHost() {
    return { appendChild() {}, clientWidth: 100, clientHeight: 100 };
}

export function fakeRenderer() {
    const canvas = { style: { cssText: '' }, addEventListener() {}, removeEventListener() {}, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    return {
        domElement: canvas,
        getContext: () => ({ getParameter: () => '' }),
        extensions: { get: () => null, has: () => false },
        capabilities: { maxVertexTextures: 0 },
        debug: {},
        setPixelRatio() {},
        getPixelRatio: () => 1,
        setSize() {},
        render() {},
        dispose() {},
    };
}

export class FakeOrbitControls {
    enableDamping = false;
    enablePan = false;
    minDistance = 0;
    maxDistance = 0;
    autoRotate = false;
    autoRotateSpeed = 0;
    addEventListener(): void {}
    update(): void {}
    dispose(): void {}
}

export const readyState = { value: 'complete' as DocumentReadyState };
export const documentEvents = new EventTarget();

Object.assign(globalThis, {
    HTMLElement: FakeElement,
    ResizeObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    MutationObserver: FakeObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1, setTimeout: globalThis.setTimeout.bind(globalThis) }),
    document: {
        get readyState() { return readyState.value; },
        addEventListener: documentEvents.addEventListener.bind(documentEvents),
        removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    },
});
