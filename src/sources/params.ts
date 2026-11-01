const TAU = Math.PI * 2;

// R2 low-discrepancy sequence (Roberts, 2018): spreads (u, v) evenly over
// the parameter square, so surfaces look smooth instead of speckled.
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

/** Small deterministic PRNG so every particle keeps the same `r` across rebuilds. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Per-particle formula inputs, packed as (u, v, r) triplets.
 * u, v ∈ [0, 2π) evenly distributed; r ∈ [0, 1) random.
 */
export function createParticleParams(count: number, seed = 1): Float32Array {
    const params = new Float32Array(count * 3);
    const random = mulberry32(seed);
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        params[i3] = ((0.5 + R2_A * i) % 1) * TAU;
        params[i3 + 1] = ((0.5 + R2_B * i) % 1) * TAU;
        params[i3 + 2] = random();
    }
    return params;
}

/** Random cloud the particles start from before flying to their first shape. */
export function createSpawnCloud(count: number, radius = 9, seed = 3): Float32Array {
    const random = mulberry32(seed);
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(2 * random() - 1);
        const rad = radius * Math.cbrt(random());
        out[i * 3] = rad * Math.sin(phi) * Math.cos(theta);
        out[i * 3 + 1] = rad * Math.cos(phi);
        out[i * 3 + 2] = rad * Math.sin(phi) * Math.sin(theta);
    }
    return out;
}

/** Center points on the origin and scale them to fit inside `radius`. In place. */
export function normalizePoints(points: Float32Array, radius = 4.5): Float32Array {
    const n = points.length / 3;
    if (n === 0) return points;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
        const x = points[i], y = points[i + 1], z = points[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    let maxDistSq = 0;
    for (let i = 0; i < points.length; i += 3) {
        const dx = points[i] - cx, dy = points[i + 1] - cy, dz = points[i + 2] - cz;
        maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz);
    }

    const scale = maxDistSq > 0 ? radius / Math.sqrt(maxDistSq) : 1;
    for (let i = 0; i < points.length; i += 3) {
        points[i] = (points[i] - cx) * scale;
        points[i + 1] = (points[i + 1] - cy) * scale;
        points[i + 2] = (points[i + 2] - cz) * scale;
    }
    return points;
}

/** Stretch or shrink a point cloud to exactly `count` points by even resampling. */
export function resamplePoints(points: Float32Array, count: number): Float32Array {
    const n = points.length / 3;
    if (n === count) return points.slice();
    const out = new Float32Array(count * 3);
    if (n === 0) return out;
    for (let i = 0; i < count; i++) {
        const src = Math.floor((i * n) / count) * 3;
        out[i * 3] = points[src];
        out[i * 3 + 1] = points[src + 1];
        out[i * 3 + 2] = points[src + 2];
    }
    return out;
}
