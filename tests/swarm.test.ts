import './helpers/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCanvasHost, fakeRenderer, fakes } from './helpers/browser';
import { createSwarm, type Swarm, type SwarmOptions } from '../src/swarm';
import { PARTICLE_LIMITS } from '../src/backends/select';

vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => ({ OrbitControls: (await import('./helpers/browser')).FakeOrbitControls }));
vi.mock('../src/backends/select', async (original) => ({
    ...(await original<typeof import('../src/backends/select')>()),
    createRenderer: () => {
        if (fakes.rendererError) throw fakes.rendererError;
        return fakeRenderer();
    },
}));

const swarms: Swarm[] = [];
function make(options: SwarmOptions = {}): Swarm {
    const swarm = createSwarm(fakeCanvasHost() as unknown as HTMLElement, { backend: 'cpu', ...options });
    swarms.push(swarm);
    return swarm;
}

/** Run frames at `fps` for `seconds` — enough to trip (or not) auto quality. */
function run(swarm: Swarm, seconds: number, fps = 10): void {
    const tick = (swarm as unknown as { tick(now: number): void }).tick;
    let now = 1000;
    for (let i = 0; i < seconds * fps; i++) {
        now += 1000 / fps;
        tick(now);
    }
}

afterEach(() => {
    swarms.splice(0).forEach((swarm) => swarm.dispose());
    fakes.rendererError = null;
    vi.restoreAllMocks();
});

describe('particles and autoQuality', () => {
    it('particles is a ceiling: auto quality stays on and lowers it on a slow device', () => {
        const swarm = make({ particles: 20_000 });
        expect(swarm.info.particles).toBe(20_000);
        run(swarm, 12);
        expect(swarm.info.particles).toBeLessThan(20_000);
        expect(swarm.info.reduced).toBe(true);
    });

    it('never raises the count again, even when the frame rate recovers', () => {
        const swarm = make({ particles: 20_000 });
        run(swarm, 12);
        const lowered = swarm.info.particles;
        run(swarm, 12, 60);
        expect(swarm.info.particles).toBe(lowered);
    });

    it('holds the count exactly with autoQuality: false', () => {
        const swarm = make({ particles: 20_000, autoQuality: false });
        run(swarm, 12);
        expect(swarm.info).toMatchObject({ particles: 20_000, reduced: false });
    });

    it('setParticles changes the ceiling without turning auto quality off', () => {
        const swarm = make();
        swarm.setParticles(10_000);
        expect(swarm.info.particles).toBe(10_000);
        run(swarm, 12);
        expect(swarm.info.particles).toBeLessThan(10_000);
    });

    it('setParticles(undefined) goes back to the count chosen for the device, and forgets the lowering', () => {
        const swarm = make({ particles: 20_000 });
        run(swarm, 12);
        expect(swarm.info.reduced).toBe(true);
        swarm.setParticles(undefined);
        expect(swarm.info).toMatchObject({ particles: PARTICLE_LIMITS.cpu.default, reduced: false });
    });

    it('clamps a request above what the backend sustains', () => {
        expect(make({ particles: 1e7 }).info.particles).toBe(PARTICLE_LIMITS.cpu.max);
    });
});

describe('errors', () => {
    it('setSource rejects and does not also call onError', async () => {
        const onError = vi.fn();
        const swarm = make({ onError });
        await swarm.ready;
        await expect(swarm.setSource('x = nope')).rejects.toThrow(/nope/);
        expect(onError).not.toHaveBeenCalled();
    });

    it('a failed setSource keeps what the swarm was showing', async () => {
        const swarm = make();
        await swarm.ready;
        await swarm.setSource('x = u\ny = v\nz = 0');
        await expect(swarm.setSource('x = nope')).rejects.toThrow();
        expect((swarm as unknown as { target: { kind: string } }).target.kind).toBe('shape');
    });

    it('the source passed at creation reports through onError, and ready rejects with the same error', async () => {
        const onError = vi.fn();
        const swarm = make({ source: 'x = nope', onError });
        const error = await swarm.ready.catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(error);
    });

    it('without onError, a failing initial source goes to console.warn instead of vanishing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const swarm = make({ source: 'x = nope' });
        await swarm.ready.catch(() => {});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'));
    });

    it('setAudio rejects with a [NanoSwarm] error instead of calling onError', async () => {
        const onError = vi.fn();
        const swarm = make({ onError });
        await swarm.ready;
        await expect(swarm.setAudio('mic')).rejects.toThrow(/^\[NanoSwarm\]/); // no AudioContext in Node
        expect(onError).not.toHaveBeenCalled();
    });

    it('createSwarm throws a readable error without WebGL', () => {
        fakes.rendererError = new Error('[NanoSwarm] WebGL is not available');
        expect(() => make()).toThrow(/WebGL is not available/);
    });
});

describe('shader errors', () => {
    it("prints the driver's message before reacting, instead of replacing three.js's report with silence", () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const swarm = make();
        const { onShaderError } = (swarm as unknown as { renderer: ReturnType<typeof fakeRenderer> }).renderer.debug as {
            onShaderError: (gl: unknown, program: unknown, vertex: unknown, fragment: unknown) => void;
        };
        const gl = {
            getProgramInfoLog: () => 'link failed',
            getShaderInfoLog: (shader: string) => (shader === 'fs' ? "ERROR: 0:2: 'oops' : undeclared identifier" : ''),
            getShaderSource: () => 'void main() {\n  oops;\n}',
        };
        onShaderError(gl, {}, 'vs', 'fs');
        const message = String(error.mock.calls[0]?.[0]);
        expect(message).toContain('link failed');
        expect(message).toContain("'oops' : undeclared identifier");
        expect(message).toContain('> 2:   oops;');
    });
});
