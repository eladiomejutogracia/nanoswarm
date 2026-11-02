import './helpers/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentEvents, fakes, fakeRenderer, readyState } from './helpers/browser';
import { NanoSwarmElement } from '../src/element/element';

vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => ({ OrbitControls: (await import('./helpers/browser')).FakeOrbitControls }));
vi.mock('../src/backends/select', async (original) => ({
    ...(await original<typeof import('../src/backends/select')>()),
    createRenderer: () => {
        if (fakes.rendererError) throw fakes.rendererError;
        return fakeRenderer();
    },
}));

// Same tag-less construction the browser does: the class itself is an HTMLElement in this harness.
function create(formula: string, attributes: Record<string, string> = {}) {
    const element = new NanoSwarmElement();
    element.textContent = formula;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    const events: Array<{ type: string; detail?: unknown }> = [];
    for (const type of ['swarm-load', 'swarm-error']) {
        element.addEventListener(type, (event) => events.push({ type, detail: (event as CustomEvent).detail }));
    }
    return { element, events };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let warn: ReturnType<typeof vi.spyOn>;
const elements: NanoSwarmElement[] = [];

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    elements.splice(0).forEach((element) => element.disconnectedCallback());
    fakes.rendererError = null;
    readyState.value = 'complete';
    vi.restoreAllMocks();
});

function connect(formula: string, attributes: Record<string, string> = {}) {
    const result = create(formula, { backend: 'cpu', ...attributes });
    elements.push(result.element);
    result.element.connectedCallback();
    return result;
}

describe('F1 · no WebGL', () => {
    it('does not throw from connectedCallback, and reports a readable swarm-error', async () => {
        fakes.rendererError = new Error('[NanoSwarm] WebGL is not available (it is turned off in this browser, or this device does not support it), so nothing can be drawn.');
        let connected: ReturnType<typeof connect> | undefined;
        expect(() => { connected = connect('x = u'); }).not.toThrow();
        await settle();
        const { events, element } = connected!;
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('swarm-error');
        expect((events[0].detail as Error).message).toMatch(/^\[NanoSwarm\] WebGL is not available/);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[NanoSwarm\] WebGL/), element);
        expect(element.swarm).toBeNull();
    });
});

describe('F2 · an invalid formula is not an empty element', () => {
    it('writes a console warning and emits swarm-error, never swarm-load', async () => {
        const { events, element } = connect('x = nope\ny = 0\nz = 0');
        await settle();
        expect(events.map((e) => e.type)).toEqual(['swarm-error']);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/^\[NanoSwarm\] This formula can't be drawn\. .*nope/);
        expect(warn.mock.calls[0][1]).toBe(element);
    });

    it('a valid formula emits swarm-load and nothing is warned', async () => {
        const { events } = connect('x = u\ny = v\nz = 0');
        await settle();
        expect(events.map((e) => e.type)).toEqual(['swarm-load']);
        expect(warn).not.toHaveBeenCalled();
    });

    it('while the page is still being parsed, an empty element waits for its formula before announcing anything', async () => {
        readyState.value = 'loading';
        const { events, element } = connect('');
        await settle();
        expect(events).toEqual([]); // the default sphere is not "loaded": the text hasn't been parsed yet
        element.textContent = 'x = nope';
        readyState.value = 'interactive';
        documentEvents.dispatchEvent(new Event('DOMContentLoaded'));
        await settle();
        expect(events.map((e) => e.type)).toEqual(['swarm-error']);
    });
});

describe('particles attribute', () => {
    it('removing it goes back to the device default (and drops any earlier lowering)', async () => {
        const { element } = connect('x = u\ny = v\nz = 0', { particles: '12000' });
        await settle();
        const spy = vi.spyOn(element.swarm!, 'setParticles');
        expect(element.swarm!.info.particles).toBe(12_000);
        element.removeAttribute('particles');
        expect(spy).toHaveBeenCalledWith(undefined);
    });
});
