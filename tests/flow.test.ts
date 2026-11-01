import { describe, expect, it } from 'vitest';
import { compileFormula } from '../src/formula';
import { calibrateFlow, FLOW_RADIUS, FLOW_WORLD_SPEED, FlowError, particleSeeds, stepFlow, substepsFor, type FlowField } from '../src/sources/flow';
import { createParticleParams } from '../src/sources/params';

const ATTRACTORS = {
    lorenz: 'dx = 10 * (y - x)\ndy = x * (28 - z) - y\ndz = x * y - 8/3 * z',
    thomas: 'b = 0.208186\ndx = sin(y) - b * x\ndy = sin(z) - b * y\ndz = sin(x) - b * z',
    aizawa: [
        'dx = (z - 0.7) * x - 3.5 * y',
        'dy = 3.5 * x + (z - 0.7) * y',
        'dz = 0.6 + 0.95 * z - z^3 / 3 - (x*x + y*y) * (1 + 0.25 * z) + 0.1 * z * x^3',
    ].join('\n'),
    halvorsen: [
        'a = 1.89',
        'dx = -a*x - 4*y - 4*z - y*y',
        'dy = -a*y - 4*z - 4*x - z*z',
        'dz = -a*z - 4*x - 4*y - x*x',
    ].join('\n'),
};
const STILL = { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) };

/** Sorted world-space distances from the center. */
function worldDistances(field: FlowField, points: Float32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < points.length; i += 3) {
        out.push(Math.hypot(
            (points[i] - field.center[0]) * field.scale,
            (points[i + 1] - field.center[1]) * field.scale,
            (points[i + 2] - field.center[2]) * field.scale,
        ));
    }
    return out.sort((a, b) => a - b);
}

const quantile = (sorted: number[], q: number) => sorted[Math.floor(q * (sorted.length - 1))];

describe('calibrateFlow', () => {
    it.each(Object.entries(ATTRACTORS))('%s: frames the attractor at the standard size', (_, source) => {
        const field = calibrateFlow(compileFormula(source));
        expect(field.stepPerSecond).toBeGreaterThan(0);
        expect(field.maxStep).toBeGreaterThan(0);
        expect(field.seeds.every(Number.isFinite)).toBe(true);
        const d = worldDistances(field, field.seeds);
        expect(quantile(d, 0.95)).toBeLessThanOrEqual(FLOW_RADIUS * 1.05); // the bulk fits…
        expect(quantile(d, 0.9)).toBeGreaterThan(FLOW_RADIUS * 0.6); // …and fills it (not a tiny blob)
        expect(d.at(-1)!).toBeLessThanOrEqual(FLOW_RADIUS * 1.5 + 1e-3); // no strays
    });

    it.each(Object.entries(ATTRACTORS))('%s: stays full-size and stable for 5 s, even at 3× speed', (_, source) => {
        const field = calibrateFlow(compileFormula(source));
        const n = 1000;
        const params = createParticleParams(n);
        const k = new Float32Array(n * 3), mid = new Float32Array(n * 3);
        for (const speed of [1, 3]) {
            const points = particleSeeds(field, n);
            const h = (speed * field.stepPerSecond) / 60;
            const substeps = substepsFor(field, h);
            for (let frame = 0; frame < 300; frame++) {
                for (let s = 0; s < substeps; s++) stepFlow(field.formula, points, params, n, h / substeps, STILL, k, mid);
            }
            const d = worldDistances(field, points);
            expect(d.at(-1)!).toBeLessThan(FLOW_RADIUS * 2);
            expect(quantile(d, 0.9)).toBeGreaterThan(FLOW_RADIUS * 0.6);
        }
    });

    it('ignores trajectories that fall into a resting point next to the attractor', () => {
        // Aizawa has a stable point at (0, 0, -1.105) besides its attractor; some starts end there.
        const field = calibrateFlow(compileFormula(ATTRACTORS.aizawa));
        let atRest = 0;
        for (let i = 0; i < field.seeds.length; i += 3) {
            if (Math.hypot(field.seeds[i], field.seeds[i + 1], field.seeds[i + 2] + 1.105) < 0.05) atRest++;
        }
        expect(atRest / (field.seeds.length / 3)).toBeLessThan(0.02);
    });

    it('gives systems with very different sizes and speeds a similar on-screen pace', () => {
        for (const source of [ATTRACTORS.lorenz, ATTRACTORS.thomas]) {
            const field = calibrateFlow(compileFormula(source));
            const n = field.seeds.length / 3;
            const k = new Float32Array(field.seeds.length);
            field.formula.evaluate(k, null, createParticleParams(n), n, STILL, field.seeds);
            const speeds = Array.from({ length: n }, (_, i) => Math.hypot(k[i * 3], k[i * 3 + 1], k[i * 3 + 2]));
            speeds.sort((a, b) => a - b);
            const worldSpeed = speeds[n >> 1] * field.scale * field.stepPerSecond;
            expect(worldSpeed).toBeGreaterThan(FLOW_WORLD_SPEED * 0.7);
            expect(worldSpeed).toBeLessThan(FLOW_WORLD_SPEED * 1.4);
        }
    });

    it('explores the whole attractor, not just the slow neighbourhood of a fixed point', () => {
        // Lorenz (y as up axis): its "eyes" at x = z = ±8.485, y = 27 are only weakly unstable.
        // A calibration that doesn't run long enough seeds everything there and
        // the particles sit in two small rings instead of the butterfly.
        const field = calibrateFlow(compileFormula('dx = 10 * (z - x)\ndz = x * (28 - y) - z\ndy = x * z - 8/3 * y'));
        const nearEyes = (p: Float32Array) => {
            let near = 0;
            for (let i = 0; i < p.length; i += 3) {
                const a = Math.hypot(p[i] - 8.485, p[i + 1] - 27, p[i + 2] - 8.485);
                const b = Math.hypot(p[i] + 8.485, p[i + 1] - 27, p[i + 2] + 8.485);
                if (Math.min(a, b) < 4) near++;
            }
            return near / (p.length / 3);
        };
        let minY = Infinity, maxY = -Infinity;
        for (let i = 1; i < field.seeds.length; i += 3) {
            minY = Math.min(minY, field.seeds[i]);
            maxY = Math.max(maxY, field.seeds[i]);
        }
        expect(maxY - minY).toBeGreaterThan(35); // the full height of the butterfly
        expect(nearEyes(field.seeds)).toBeLessThan(0.1);

        const n = 1000;
        const points = particleSeeds(field, n);
        const k = new Float32Array(n * 3), mid = new Float32Array(n * 3);
        for (let i = 0; i < 180; i++) stepFlow(field.formula, points, createParticleParams(n), n, field.stepPerSecond / 60, STILL, k, mid);
        expect(nearEyes(points)).toBeLessThan(0.1); // and they stay spread out while moving
    });

    it('explains a motion that runs off to infinity', () => {
        expect(() => calibrateFlow(compileFormula('dx = x * x + 1\ndy = y\ndz = z'))).toThrow(FlowError);
        expect(() => calibrateFlow(compileFormula('dx = x * x + 1\ndy = y\ndz = z'))).toThrow(/infinity/);
    });

    it('explains a motion that settles on a single point', () => {
        expect(() => calibrateFlow(compileFormula('dx = -x\ndy = -y\ndz = -z'))).toThrow(/single point/);
    });

    it('rejects shape formulas', () => {
        expect(() => calibrateFlow(compileFormula('x = u\ny = v\nz = 0'))).toThrow(/motion formula/);
    });
});

describe('stepFlow', () => {
    it('keeps particles on the attractor over many frames', () => {
        const field = calibrateFlow(compileFormula(ATTRACTORS.lorenz));
        const count = 500;
        const points = particleSeeds(field, count);
        const params = createParticleParams(count);
        const k = new Float32Array(count * 3);
        const mid = new Float32Array(count * 3);
        const h = (1 / 60) * field.stepPerSecond;
        for (let frame = 0; frame < 600; frame++) stepFlow(field.formula, points, params, count, h, STILL, k, mid);
        for (let i = 0; i < points.length; i += 3) {
            const r = Math.hypot(
                (points[i] - field.center[0]) * field.scale,
                (points[i + 1] - field.center[1]) * field.scale,
                (points[i + 2] - field.center[2]) * field.scale,
            );
            expect(r).toBeLessThan(FLOW_RADIUS * 1.5);
        }
    });

    it('actually moves the particles', () => {
        const field = calibrateFlow(compileFormula(ATTRACTORS.thomas));
        const points = particleSeeds(field, 10);
        const before = points.slice();
        stepFlow(field.formula, points, createParticleParams(10), 10, 0.5, STILL, new Float32Array(30), new Float32Array(30));
        expect(points).not.toEqual(before);
    });
});
