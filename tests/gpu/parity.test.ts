import { afterAll, describe, expect, it } from 'vitest';
import { SILENCE } from '../../src/audio/bands';
import { CpuBackend } from '../../src/backends/cpu';
import { GpuBackend } from '../../src/backends/gpu';
import { PHYSICS } from '../../src/backends/physics';
import type { FrameInput } from '../../src/backends/types';
import { formulaTarget, type Target } from '../../src/sources';
import { createTestRenderer, examples, frame, grammarCorpus, LOUD, particleErrors, readCpu, readGpu, uncalibratedTarget } from './helpers';

/**
 * The README's promise is that the CPU and GPU backends draw the same thing. These tests hold them to it:
 * the same target on both, then the numbers in their buffers side by side.
 *
 * The two paths are not bit-identical and cannot be: the CPU rounds each step to float32 but calls the
 * JS engine's sin/exp/pow, while a GPU is allowed more slack (GLSL ES 3.00 only promises sin/cos to an
 * absolute error of 2^-11 ≈ 4.9e-4, and SwiftShader, the CI driver, is right at that bound). So:
 *
 * - FORMULA_TOLERANCE 2e-3 — about 4× the worst error seen on the 19 examples (8e-4, a sin/cos-heavy
 *   shape) and 4× the spec's single-call bound. Errors in attractors are far smaller (<1e-5).
 *   A wrong operator, constant or function moves values by whole units, orders of magnitude past this.
 * - MAX_OUTLIER_SHARE 0.25% (10 of 4096 particles) may exceed it. The only outliers seen are a particle
 *   sitting exactly on a floor()/step()/fract() boundary, where 1 ulp picks the neighbouring cell
 *   (particle 0 has u = π, so floor(u/TAU*12) is exactly 6.0). That is inherent to discontinuous
 *   functions, not a bug; a codegen mismatch would put most particles outside, not a handful.
 * - PHYSICS_TOLERANCE 1e-4 — the physics is plain float32 arithmetic and a handful of exp/sqrt calls;
 *   it agrees to ~5e-6 after 120 frames, and no outliers are allowed.
 *
 * Known difference, deliberately not tested as parity: GPUComputationRenderer feeds the physics passes
 * the previous frame's target texture, so on the GPU a moving shape is followed one frame (~16 ms) late
 * (and its first frame is drawn towards the origin). Targets are therefore compared where they are
 * computed (both sides, same frame), and the physics with a target that does not move.
 */
const FORMULA_TOLERANCE = 2e-3;
const MAX_OUTLIER_SHARE = 0.0025;
const PHYSICS_TOLERANCE = 1e-4;
const COUNT = 4096;

const { renderer } = createTestRenderer();
afterAll(() => renderer.dispose());

function worstShare(errors: Float64Array, tolerance: number): { share: number; worst: number; at: number } {
    let over = 0, worst = 0, at = 0;
    errors.forEach((e, i) => { if (e > tolerance) over++; if (e > worst) { worst = e; at = i; } });
    return { share: over / errors.length, worst, at };
}

/** Run both backends through the same frames; after each frame in `compareAt`, call `check`. */
function runBoth(target: Target, frames: FrameInput[], compareAt: number[], check: (cpu: CpuBackend, gpu: GpuBackend, frameIndex: number) => void): void {
    const cpu = new CpuBackend(COUNT);
    const gpu = new GpuBackend(renderer, COUNT);
    try {
        cpu.setTarget(target);
        gpu.setTarget(target);
        frames.forEach((fr, i) => {
            cpu.update(fr);
            gpu.update(fr);
            if (compareAt.includes(i + 1)) check(cpu, gpu, i + 1);
        });
    } finally {
        cpu.dispose();
        gpu.dispose();
    }
}

function expectTargetsAgree(target: Target, frames: FrameInput[], compareAt: number[]): void {
    const world = target.kind === 'motion' ? target.field : undefined;
    runBoth(target, frames, compareAt, (cpu, gpu, n) => {
        const errors = particleErrors(readCpu(cpu, 'targets'), readGpu(renderer, gpu, 'targetVar'), COUNT, world);
        const { share, worst, at } = worstShare(errors, FORMULA_TOLERANCE);
        expect(share, `frame ${n}: worst relative error ${worst.toExponential(2)} at particle ${at}`).toBeLessThanOrEqual(MAX_OUTLIER_SHARE);
    });
}

const timeline = (count: number, bands = LOUD) => Array.from({ length: count }, (_, i) => frame((i + 1) / 60, bands));

describe('formulas: the JS and GLSL code generators evaluate the same targets', () => {
    it.each(examples.map((e) => [e.name, e.formula]))('example %s', (_, formula) => {
        expectTargetsAgree(formulaTarget(formula), timeline(30), [1, 30]);
    });

    it.each(grammarCorpus())('%s', (_, source) => {
        expectTargetsAgree(uncalibratedTarget(source), timeline(3), [3]);
    });

    // Arguments GLSL leaves undefined and JavaScript defines; a motion's x, y, z run through both signs and zero.
    it.each([
        ['log of negatives and zero', 'dx = log(x)\ndy = log(x * 0)\ndz = exp(log(x * 0))'],
        ['pow of a negative base and a fractional exponent', 'dx = pow(x, 1.5)\ndy = x ^ 0.5\ndz = pow(y, x)'],
        ['pow of a zero base', 'dx = pow(x * 0, y)\ndy = pow(x * 0, 2)\ndz = pow(x * 0, -1 - abs(y))'],
        ['pow with a zero exponent', 'dx = pow(x, y * 0)\ndy = pow(x * 0, y * 0)\ndz = x ^ 0'],
        ['pow of a negative base and an integer exponent', 'dx = x ^ 2\ndy = x ^ 3\ndz = pow(x, -1)'],
    ])('%s', (_, source) => {
        expectTargetsAgree(uncalibratedTarget(source), timeline(3), [3]);
    });

    it('the check itself can fail: a different formula on each side is far outside the tolerance', () => {
        const cpu = new CpuBackend(COUNT);
        const gpu = new GpuBackend(renderer, COUNT);
        cpu.setTarget(uncalibratedTarget('x = u\ny = v\nz = r'));
        gpu.setTarget(uncalibratedTarget('x = u\ny = v\nz = r + 0.05'));
        cpu.update(frame(1)); gpu.update(frame(1));
        const { share } = worstShare(particleErrors(readCpu(cpu, 'targets'), readGpu(renderer, gpu, 'targetVar'), COUNT), FORMULA_TOLERANCE);
        cpu.dispose(); gpu.dispose();
        expect(share).toBeGreaterThan(0.9);
    });
});

describe('physics: the JS step and its GLSL twin move particles the same way', () => {
    /** A target that never moves. */
    const still: Target = {
        kind: 'points',
        sample: (count) => Float32Array.from({ length: count * 3 }, (_, i) => Math.sin(i * 1.7) * 4),
    };
    const POINTER = { active: true, x: 0.5, y: 0.3, z: 0 };

    /** Frame 0 has dt = 0: it only lets the GPU's one-frame-late target texture catch up, and moves nothing. */
    function physicsFrames(dt: number, count: number, pointer = { ...POINTER, active: false }): FrameInput[] {
        return [{ ...frame(0, SILENCE, 0), pointer }, ...Array.from({ length: count }, (_, i) => ({ ...frame((i + 1) / 60, SILENCE, dt), pointer }))];
    }

    function expectPhysicsAgree(frames: FrameInput[]): Float32Array {
        let positions = new Float32Array(0);
        runBoth(still, frames, [1, 10, frames.length], (cpu, gpu, n) => {
            const pos = particleErrors(readCpu(cpu, 'positions'), readGpu(renderer, gpu, 'positionVar'), COUNT);
            const vel = particleErrors(readCpu(cpu, 'velocities'), readGpu(renderer, gpu, 'velocityVar'), COUNT);
            expect(worstShare(pos, PHYSICS_TOLERANCE).share, `frame ${n}: positions, worst ${Math.max(...pos).toExponential(2)}`).toBe(0);
            expect(worstShare(vel, PHYSICS_TOLERANCE).share, `frame ${n}: velocities, worst ${Math.max(...vel).toExponential(2)}`).toBe(0);
            positions = readCpu(cpu, 'positions').slice();
        });
        return positions;
    }

    it('a swarm settling onto its target at 60 fps', () => {
        expectPhysicsAgree(physicsFrames(1 / 60, 120));
    });

    it('a long frame: both clamp the step to the same maximum', () => {
        expect(0.2).toBeGreaterThan(PHYSICS.maxDelta);
        expectPhysicsAgree(physicsFrames(0.2, 20));
    });

    it('a pointer pushing particles away (and it does push: the scenario is not vacuous)', () => {
        const pushed = expectPhysicsAgree(physicsFrames(1 / 60, 10, POINTER));
        const alone = expectPhysicsAgree(physicsFrames(1 / 60, 10));
        let moved = 0;
        for (let i = 0; i < pushed.length; i++) moved = Math.max(moved, Math.abs(pushed[i] - alone[i]));
        expect(moved).toBeGreaterThan(0.01);
    });

    it('particles whose spring overflows float32 end up on their target at rest, on both', () => {
        const HUGE = 20;
        // d = target - position ≈ 3.3e38 keeps growing until the velocity passes float32's maximum (3.4e38).
        const doomed: Target = {
            kind: 'points',
            sample: (count) => Float32Array.from({ length: count * 3 }, (_, i) => (i < HUGE * 3 ? 3.3e38 * (i % 2 ? -1 : 1) : 1)),
        };
        const cpu = new CpuBackend(COUNT);
        const gpu = new GpuBackend(renderer, COUNT);
        cpu.setTarget(doomed); gpu.setTarget(doomed);
        for (const fr of physicsFrames(1 / 60, 60)) { cpu.update(fr); gpu.update(fr); }
        const target = doomed.sample(COUNT);
        const onCpu = readCpu(cpu, 'positions').slice();
        const onGpu = readGpu(renderer, gpu, 'positionVar');
        const velCpu = readCpu(cpu, 'velocities').slice();
        const velGpu = readGpu(renderer, gpu, 'velocityVar');
        cpu.dispose(); gpu.dispose();
        for (let i = 0; i < HUGE; i++) for (let k = 0; k < 3; k++) {
            expect(onCpu[i * 3 + k], `cpu particle ${i}`).toBe(target[i * 3 + k]);
            expect(onGpu[i * 4 + k], `gpu particle ${i}`).toBe(target[i * 3 + k]);
            expect(velCpu[i * 3 + k]).toBe(0);
            expect(velGpu[i * 4 + k]).toBe(0);
        }
    });
});
