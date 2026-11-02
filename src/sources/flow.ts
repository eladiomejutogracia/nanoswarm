/**
 * Motion formulas (dx, dy, dz): calibration and stepping.
 *
 * A motion describes velocity, not position, and every system lives at its
 * own scale and pace — Lorenz spans ~50 units and races, Thomas spans ~5 and
 * crawls. Instead of asking the user for a time step and a scale, we trace a
 * few trajectories once and measure: where the motion lives (center, size)
 * and how fast it typically moves. From that we derive the world transform
 * and a step that gives every system a similar, pleasant on-screen pace.
 */
import type { CompiledFormula, FormulaFrame } from '../formula';
import { createParticleParams, mulberry32 } from './params';

export interface FlowField {
    formula: CompiledFormula;
    /** Native → world: world = (native - center) * scale. */
    center: [number, number, number];
    scale: number;
    /** Native time to advance per real second at speed 1. */
    stepPerSecond: number;
    /** Longest native step known to be accurate; longer frames are split into substeps. */
    maxStep: number;
    /** Points on the motion's attractor (native coords) — where particles start and respawn. */
    seeds: Float32Array;
}

/** Radius the motion is scaled to fit, in world units (same as models). */
export const FLOW_RADIUS = 4.5;
/** Typical on-screen speed at speed 1, in world units per second. */
export const FLOW_WORLD_SPEED = 1.6;
/** Particles further than this from the center (world units) are respawned. */
export const FLOW_ESCAPE = 20;
/** Most substeps per frame (very high speed on a stiff system just runs a bit slower). */
export const MAX_SUBSTEPS = 8;

const TRAJECTORIES = 32;
const WARMUP_STEPS = 2000;
const RECORD_STEPS = 3000;
/** Relative error allowed per calibration step, and the step bounds (native time). */
const TOLERANCE = 1e-3;
const MIN_STEP = 1e-7;
const MAX_STEP = 10;
const SEED_COUNT = 4096;
/** Seeds come from within this many "radii" (95th percentile) of the center. */
const SEED_REGION = 1.5;
/** A trajectory covering this many times the typical time is coming to rest. */
const RESTING_TIME_FACTOR = 5;
/** Safe step = this × the median accurate step found while calibrating. */
const STABLE_STEP_FACTOR = 4;
const RUNAWAY = 1e5;

const STILL: FormulaFrame = { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(0) };

/**
 * Why a motion can't be drawn. The set only grows; read `code`, never the message,
 * to tell failures apart — the wording is free to improve.
 *   'diverges'  the motion runs off to infinity
 *   'rests'     the motion settles on a single point
 */
export type FlowErrorCode = 'diverges' | 'rests';

export class FlowError extends Error {
    constructor(readonly code: FlowErrorCode, message: string) {
        super(message);
        this.name = 'FlowError';
    }
}

/**
 * One RK2 (midpoint) step for a batch of points, in place.
 * `k` and `mid` are scratch buffers of the same length as `points`;
 * `colors` (optional) receives the formula's `c` at the midpoint.
 */
export function stepFlow(
    formula: CompiledFormula,
    points: Float32Array,
    params: Float32Array,
    count: number,
    h: number,
    frame: FormulaFrame,
    k: Float32Array,
    mid: Float32Array,
    colors: Float32Array | null = null,
): void {
    const n = count * 3;
    formula.evaluate(k, null, params, count, frame, points);
    for (let i = 0; i < n; i++) mid[i] = points[i] + k[i] * 0.5 * h;
    formula.evaluate(k, colors, params, count, frame, mid);
    for (let i = 0; i < n; i++) points[i] += k[i] * h;
}

const isBad = (x: number, y: number, z: number) =>
    !(Math.abs(x) < RUNAWAY && Math.abs(y) < RUNAWAY && Math.abs(z) < RUNAWAY); // also catches NaN

/** Trace the motion, measure it, and return everything needed to animate it. Throws FlowError. */
export function calibrateFlow(formula: CompiledFormula, seed = 11): FlowField {
    if (formula.program.kind !== 'motion') throw new Error('[NanoSwarm] calibrateFlow needs a motion formula (dx, dy, dz).');

    const random = mulberry32(seed);
    const n = TRAJECTORIES;
    const params = createParticleParams(n);
    const points = new Float32Array(n * 3);
    const k1 = new Float32Array(n * 3);
    const k2 = new Float32Array(n * 3);
    const mid = new Float32Array(n * 3);
    const h = new Float32Array(n).fill(1e-3);
    for (let i = 0; i < n * 3; i++) points[i] = (random() - 0.5) * 2;

    // Adaptive RK2: each trajectory picks its own step from the difference
    // between RK2 and Euler (an error estimate), relative to where it is.
    // Every system then advances at its own natural pace — no dt to guess —
    // and runs long enough to explore its whole attractor (Lorenz's points
    // start near slowly-unstable "eyes"; too little time and they never leave).
    const alive = new Array<boolean>(n).fill(true);
    const recorded: number[] = [];
    const weights: number[] = []; // time spent at each recorded point
    const owners: number[] = []; // which trajectory recorded it

    for (let step = 0; step < WARMUP_STEPS + RECORD_STEPS; step++) {
        formula.evaluate(k1, null, params, n, STILL, points);
        for (let i = 0; i < n; i++) {
            const i3 = i * 3, half = h[i] * 0.5;
            mid[i3] = points[i3] + k1[i3] * half;
            mid[i3 + 1] = points[i3 + 1] + k1[i3 + 1] * half;
            mid[i3 + 2] = points[i3 + 2] + k1[i3 + 2] * half;
        }
        formula.evaluate(k2, null, params, n, STILL, mid);

        for (let i = 0; i < n; i++) {
            if (!alive[i]) continue;
            const i3 = i * 3;
            const taken = h[i];
            const x = (points[i3] += k2[i3] * taken);
            const y = (points[i3 + 1] += k2[i3 + 1] * taken);
            const z = (points[i3 + 2] += k2[i3 + 2] * taken);
            if (isBad(x, y, z)) {
                alive[i] = false;
                continue;
            }
            const error = 0.5 * taken * Math.hypot(k2[i3] - k1[i3], k2[i3 + 1] - k1[i3 + 1], k2[i3 + 2] - k1[i3 + 2]);
            // Purely relative: an absolute floor would let steps grow near the origin
            // until RK2 turns unstable (and a collapsing motion would look alive).
            const tolerance = TOLERANCE * Math.max(Math.hypot(x, y, z), 1e-9);
            const factor = error > 0 ? 0.9 * Math.sqrt(tolerance / error) : 2;
            h[i] = Math.min(MAX_STEP, Math.max(MIN_STEP, taken * Math.min(2, Math.max(0.3, factor))));
            if (step >= WARMUP_STEPS) {
                recorded.push(x, y, z);
                weights.push(taken);
                owners.push(i);
            }
        }
    }

    // An attractor keeps revisiting the same region; "the second half of the
    // recording left the region of the first half" means it is running away —
    // whether the points spread out or all drift off together.
    if (recorded.length === 0 || leftTheRegion(recorded)) {
        throw new FlowError('diverges', 'This motion runs off to infinity, so particles would fly away. Try smaller numbers, or pull points back (for example "- x").');
    }

    const sample = new Float32Array(recorded);

    // Some systems also have a resting point next to their attractor (Aizawa
    // does): trajectories that fall into it slow to a crawl — and, taking huge
    // steps there, would dominate the time-weighted statistics. Drop them.
    const still = stillTrajectories(sample, weights, owners, n);
    for (let i = 0; i < weights.length; i++) if (still[owners[i]]) weights[i] = 0;
    if (weights.every((w) => w === 0)) {
        throw new FlowError('rests', 'This motion settles on a single point, so there is nothing to draw. Attractors need a motion that keeps moving.');
    }

    // Robust framing: a stray trajectory (one that took long to fall onto the
    // attractor, or wandered off) must not inflate the size — that made Aizawa
    // tiny and, through a too-large step, unstable. Center = per-axis median of
    // a time-weighted sample; size = 95th percentile distance.
    const probe = pickWeighted(sample, weights, SEED_COUNT, random);
    const center: [number, number, number] = [median(probe, 0), median(probe, 1), median(probe, 2)];
    const radius = percentileDistance(probe, center, 0.95);
    if (radius < 1e-6) {
        throw new FlowError('rests', 'This motion settles on a single point, so there is nothing to draw. Attractors need a motion that keeps moving.');
    }
    const scale = FLOW_RADIUS / radius;

    // Seeds are picked in proportion to time spent (how particles spread over
    // an attractor), but only inside the attractor's region.
    const regionSq = (SEED_REGION * radius) ** 2;
    const inRegion = weights.map((w, i) => {
        const dx = sample[i * 3] - center[0], dy = sample[i * 3 + 1] - center[1], dz = sample[i * 3 + 2] - center[2];
        return dx * dx + dy * dy + dz * dz <= regionSq ? w : 0;
    });
    const seeds = pickWeighted(sample, inRegion, SEED_COUNT, random);

    // Typical speed (median, time-weighted via the seeds) in native units.
    const velocities = new Float32Array(seeds.length);
    formula.evaluate(velocities, null, createParticleParams(SEED_COUNT), SEED_COUNT, STILL, seeds);
    const speeds = new Float32Array(SEED_COUNT);
    for (let i = 0; i < SEED_COUNT; i++) speeds[i] = Math.hypot(velocities[i * 3], velocities[i * 3 + 1], velocities[i * 3 + 2]);
    speeds.sort();
    const typicalSpeed = Math.max(speeds[SEED_COUNT >> 1], 1e-9);

    // The steps the adaptive integrator found accurate are also safe; frames
    // that need a longer step are split into substeps of at most a few of them.
    const steps = Float64Array.from(weights).sort();
    const maxStep = STABLE_STEP_FACTOR * steps[steps.length >> 1];

    return {
        formula,
        center,
        scale,
        stepPerSecond: FLOW_WORLD_SPEED / (typicalSpeed * scale),
        maxStep,
        seeds,
    };
}

/**
 * Trajectories that are coming to rest: they barely move, or — the telling
 * sign when they still crawl — their adaptive steps grew so large that they
 * covered far more time than the typical trajectory in the same step count.
 */
function stillTrajectories(sample: Float32Array, weights: number[], owners: number[], n: number): boolean[] {
    const min = new Float64Array(n * 3).fill(Infinity);
    const max = new Float64Array(n * 3).fill(-Infinity);
    const time = new Float64Array(n);
    for (let i = 0; i < owners.length; i++) {
        time[owners[i]] += weights[i];
        for (let a = 0; a < 3; a++) {
            const v = sample[i * 3 + a];
            const j = owners[i] * 3 + a;
            if (v < min[j]) min[j] = v;
            if (v > max[j]) max[j] = v;
        }
    }
    // Lower quartile: still a fair "typical" even if most trajectories came to rest.
    const typicalTime = Float64Array.from(time).sort()[n >> 2];
    return Array.from({ length: n }, (_, t) => {
        if (!Number.isFinite(min[t * 3])) return true; // recorded nothing (escaped early)
        if (time[t] > RESTING_TIME_FACTOR * typicalTime) return true;
        const size = Math.hypot(max[t * 3] - min[t * 3], max[t * 3 + 1] - min[t * 3 + 1], max[t * 3 + 2] - min[t * 3 + 2]);
        const where = Math.hypot(max[t * 3] + min[t * 3], max[t * 3 + 1] + min[t * 3 + 1], max[t * 3 + 2] + min[t * 3 + 2]) / 2;
        return size < 1e-4 * Math.max(1, where);
    });
}

function median(points: Float32Array, axis: number): number {
    const values = new Float64Array(points.length / 3);
    for (let i = 0; i < values.length; i++) values[i] = points[i * 3 + axis];
    values.sort();
    return values[values.length >> 1];
}

function percentileDistance(points: Float32Array, center: [number, number, number], fraction: number): number {
    const distances = new Float64Array(points.length / 3);
    for (let i = 0; i < distances.length; i++) {
        distances[i] = Math.hypot(points[i * 3] - center[0], points[i * 3 + 1] - center[1], points[i * 3 + 2] - center[2]);
    }
    distances.sort();
    return distances[Math.min(distances.length - 1, Math.floor(fraction * distances.length))];
}

/** How many substeps a frame needs so no single step exceeds the field's safe step. */
export function substepsFor(field: FlowField, h: number): number {
    return Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(h / field.maxStep)));
}

/** True if the later half of the recording strays well outside the region of the earlier half. */
function leftTheRegion(recorded: number[]): boolean {
    const half = Math.floor(recorded.length / 6) * 3;
    const [center, radius] = bounds(new Float32Array(recorded.slice(0, half)));
    const limit = 2 * Math.max(radius, 1e-6);
    for (let i = half; i < recorded.length; i += 3) {
        if (Math.hypot(recorded[i] - center[0], recorded[i + 1] - center[1], recorded[i + 2] - center[2]) > limit) return true;
    }
    return false;
}

/** Pick `count` points with probability proportional to their weight. */
function pickWeighted(points: Float32Array, weights: number[], count: number, random: () => number): Float32Array {
    const cumulative = new Float64Array(weights.length);
    let total = 0;
    for (let i = 0; i < weights.length; i++) cumulative[i] = total += weights[i];
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const target = random() * total;
        let lo = 0, hi = cumulative.length - 1;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (cumulative[m] < target) lo = m + 1;
            else hi = m;
        }
        out[i * 3] = points[lo * 3];
        out[i * 3 + 1] = points[lo * 3 + 1];
        out[i * 3 + 2] = points[lo * 3 + 2];
    }
    return out;
}

function bounds(points: Float32Array): [[number, number, number], number] {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < points.length; i += 3) {
        for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], points[i + a]);
            max[a] = Math.max(max[a], points[i + a]);
        }
    }
    const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    let radius = 0;
    for (let i = 0; i < points.length; i += 3) {
        radius = Math.max(radius, Math.hypot(points[i] - center[0], points[i + 1] - center[1], points[i + 2] - center[2]));
    }
    return [center, radius];
}

/** Start position for particle i: a seed point plus a whisker of jitter so particles don't stack. */
export function particleSeeds(field: FlowField, count: number, seed = 5): Float32Array {
    const random = mulberry32(seed);
    const n = field.seeds.length / 3;
    const jitter = 0.002 / field.scale;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const j = (i % n) * 3;
        out[i * 3] = field.seeds[j] + (random() - 0.5) * jitter;
        out[i * 3 + 1] = field.seeds[j + 1] + (random() - 0.5) * jitter;
        out[i * 3 + 2] = field.seeds[j + 2] + (random() - 0.5) * jitter;
    }
    return out;
}
