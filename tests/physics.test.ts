import { describe, expect, it } from 'vitest';
import { PHYSICS, PHYSICS_GLSL, stepParticles, type PointerState } from '../src/backends/physics';

const NO_POINTER: PointerState = { active: false, x: 0, y: 0, z: 0 };

function simulate(
    start: number[],
    target: number[],
    { seconds = 4, rand = 0.5, pointer = NO_POINTER, fps = 60 } = {},
) {
    const positions = new Float32Array(start);
    const velocities = new Float32Array(3);
    const speeds = new Float32Array(1);
    const targets = new Float32Array(target);
    const randArr = new Float32Array([rand]);
    for (let i = 0; i < seconds * fps; i++) {
        stepParticles(positions, velocities, speeds, randArr, { dt: 1 / fps, targets, pointer });
    }
    return { positions, velocities, speeds };
}

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('stepParticles', () => {
    it('settles particles on their target', () => {
        const { positions, speeds } = simulate([8, -3, 5], [1, 2, 3]);
        expect(dist(positions, [1, 2, 3])).toBeLessThan(0.01);
        expect(speeds[0]).toBeLessThan(0.05);
    });

    it('settles for slow and fast particles alike', () => {
        for (const rand of [0, 1]) {
            expect(dist(simulate([5, 5, 5], [0, 1, 0], { rand }).positions, [0, 1, 0])).toBeLessThan(0.05);
        }
    });

    it('is stable at low frame rates', () => {
        const { positions } = simulate([10, 10, 10], [0, 0, 0], { fps: 15, seconds: 6 });
        expect(dist(positions, [0, 0, 0])).toBeLessThan(0.05);
    });

    it('clamps huge frame gaps (background tab) instead of exploding', () => {
        const positions = new Float32Array([5, 0, 0]);
        const velocities = new Float32Array(3);
        stepParticles(positions, velocities, new Float32Array(1), new Float32Array([1]), {
            dt: 10, targets: new Float32Array(3), pointer: NO_POINTER,
        });
        expect(Math.abs(positions[0])).toBeLessThan(5);
    });

    it('swirls while travelling', () => {
        const positions = new Float32Array([5, 0, 0]);
        const velocities = new Float32Array(3);
        stepParticles(positions, velocities, new Float32Array(1), new Float32Array([0.5]), {
            dt: 1 / 60, targets: new Float32Array(3), pointer: NO_POINTER,
        });
        expect(velocities[2]).not.toBe(0);
    });

    it('pushes particles away from the pointer', () => {
        const pointer = { active: true, x: 0.5, y: 0, z: 0 };
        const { positions } = simulate([0, 0, 0], [0, 0, 0], { pointer, seconds: 2 });
        expect(positions[0]).toBeLessThan(-0.2);
        expect(dist(positions, [0.5, 0, 0])).toBeLessThan(PHYSICS.pointerRadius);
    });
});

describe('GLSL twin', () => {
    it('embeds every physics constant', () => {
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.stiffness}.0`);
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.spreadMin}`);
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.spreadRange}`);
        expect(PHYSICS_GLSL).toContain(`${-PHYSICS.damping}`);
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.pointerRadius}`);
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.pointerForce}.0`);
        expect(PHYSICS_GLSL).toContain(`${PHYSICS.maxDelta}`);
    });
});

describe('H1 · no formula can kill a particle for good', () => {
    // A float32 target the formulas can produce (x = 1e39 collapses to 0 on the way out of the
    // formula; 3e38 is the biggest finite one, where the velocity step itself overflows float32).
    it('a target so far away that the step overflows float32 sends the particle back to the target, not to NaN', () => {
        const { positions, velocities, speeds } = simulate([0, 0, 0], [3e38, 0, 0], { seconds: 1 });
        expect(Array.from(positions).every(Number.isFinite)).toBe(true);
        expect(Array.from(velocities).every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(speeds[0])).toBe(true);
    });

    it('a NaN or infinite target parks the particle at the origin instead of poisoning it', () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            const { positions, velocities } = simulate([1, 2, 3], [bad, 0, 0], { seconds: 1 });
            expect(Array.from(positions)).toEqual([0, 0, 0]);
            expect(Array.from(velocities)).toEqual([0, 0, 0]);
        }
    });

    it('recovers once the target is sane again', () => {
        const positions = new Float32Array([0, 0, 0]);
        const velocities = new Float32Array(3);
        const speeds = new Float32Array(1);
        const rand = new Float32Array([0.5]);
        const step = (targets: Float32Array, frames: number) => {
            for (let i = 0; i < frames; i++) stepParticles(positions, velocities, speeds, rand, { dt: 1 / 60, targets, pointer: NO_POINTER });
        };
        step(new Float32Array([NaN, 3e38, -3e38]), 30);
        step(new Float32Array([1, 2, 3]), 240);
        expect(dist(positions, [1, 2, 3])).toBeLessThan(0.01);
    });

    it('the GLSL twin applies the same rule: velocity to zero, position to the target or the origin', () => {
        expect(PHYSICS_GLSL).toContain('bool nsNotFinite(vec3');
        expect(PHYSICS_GLSL).toContain('void nsStep(');
        expect(PHYSICS_GLSL).toMatch(/nsNotFinite\(target\) \? vec3\(0\.0\) : target/);
        expect(PHYSICS_GLSL).toMatch(/vel = vec3\(0\.0\)/);
    });
});
