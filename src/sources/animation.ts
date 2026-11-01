import * as THREE from 'three';
import { FIT_RADIUS, mulberry32 } from './params';

/** How many moments of the clip are looked at to frame the whole animation. */
const FRAMING_FRAMES = 24;
/** How many surface points those framing looks use (independent of the particle count). */
const FRAMING_POINTS = 4096;

/** One mesh of the model, as the sampler and the per-frame update see it. */
interface Part {
    mesh: THREE.Mesh;
    /** Vertex positions in the mesh's own space, as stored in the file. */
    rest: Float32Array;
    /** The same, recomputed every frame — only for skinned or morphing meshes; rigid meshes just move. */
    live: Float32Array | null;
    /** Vertex indices, three per triangle. */
    triangles: Uint32Array;
}

/** Where particles sit: grouped by part, each on one triangle at fixed barycentric weights. */
interface Placement {
    /** Particles of part p are [ranges[p], ranges[p + 1]). */
    ranges: Uint32Array;
    triangle: Uint32Array;
    /** Barycentric weights (a, b) per particle; c = 1 - a - b. */
    weights: Float32Array;
    /** Each particle's point in its mesh's space. */
    local: Float32Array;
}

/**
 * A model that moves: its first animation clip loops, paced by formula time `t`
 * (so the `speed` attribute sets its pace and `speed="0"` freezes it).
 *
 * The surface is sampled once — each particle keeps its triangle and its spot on it.
 * Every frame only the clip's transforms are applied (plus the vertices of skinned or
 * morphing meshes), and the whole animation is framed once, so nothing jumps or leaves the screen.
 */
export class AnimatedModel {
    private readonly mixer: THREE.AnimationMixer;
    private readonly parts: Part[];
    /** World → screen units: the same for every frame, chosen to fit the whole animation. */
    private readonly fit = new THREE.Matrix4();
    private readonly matrix = new THREE.Matrix4();
    private readonly vertex = new THREE.Vector3();
    private start: number | null = null;
    private posedAt = NaN;

    constructor(private readonly root: THREE.Object3D, private readonly clip: THREE.AnimationClip) {
        this.mixer = new THREE.AnimationMixer(root);
        this.mixer.clipAction(clip).play();
        this.parts = collectParts(root);
        if (this.parts.length === 0) throw new Error('[NanoSwarm] The model contains no meshes.');
        this.frameWholeAnimation();
    }

    /** Spread `count` particles over the surface. Call `pose` every frame to move them. */
    sample(count: number): AnimatedSurface {
        return new AnimatedSurface(this, this.place(count, 7));
    }

    /**
     * Move the model to formula time `t` (the clip starts the first time it is posed, then loops).
     * Returns false if the clip time didn't change (e.g. speed 0): nothing to recompute.
     */
    seek(time: number): boolean {
        this.start ??= time;
        const duration = this.clip.duration;
        const local = ((time - this.start) % duration + duration) % duration;
        if (local === this.posedAt) return false;
        this.posedAt = local;
        this.mixer.setTime(local);
        this.root.updateMatrixWorld(true);
        for (const part of this.parts) if (part.live) refreshVertices(part, this.vertex);
        return true;
    }

    /** Write each particle's current position (screen units) into `out`, xyz per particle. */
    write(placement: Placement, out: Float32Array, fit = this.fit): void {
        const { ranges, triangle, weights, local } = placement;
        for (let p = 0; p < this.parts.length; p++) {
            const part = this.parts[p];
            const start = ranges[p], end = ranges[p + 1];
            if (part.live) interpolate(part.live, part.triangles, triangle, weights, local, start, end);
            const e = this.matrix.multiplyMatrices(fit, part.mesh.matrixWorld).elements;
            for (let i = start; i < end; i++) {
                const i3 = i * 3;
                const x = local[i3], y = local[i3 + 1], z = local[i3 + 2];
                out[i3] = e[0] * x + e[4] * y + e[8] * z + e[12];
                out[i3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
                out[i3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
            }
        }
    }

    /** Area-weighted random spots on the surface, measured in the clip's first frame. */
    private place(count: number, seed: number): Placement {
        this.mixer.setTime(0);
        this.root.updateMatrixWorld(true);
        this.posedAt = NaN; // the scene moved: the next seek must pose again

        // Cumulative world-space triangle areas over all parts.
        const total = this.parts.reduce((sum, part) => sum + part.triangles.length / 3, 0);
        const cumulative = new Float64Array(total);
        const owner = new Uint32Array(total);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        let area = 0, k = 0;
        this.parts.forEach((part, p) => {
            const m = part.mesh.matrixWorld, v = part.rest, t = part.triangles;
            for (let i = 0; i < t.length; i += 3, k++) {
                a.fromArray(v, t[i] * 3).applyMatrix4(m);
                b.fromArray(v, t[i + 1] * 3).applyMatrix4(m).sub(a);
                c.fromArray(v, t[i + 2] * 3).applyMatrix4(m).sub(a);
                area += b.cross(c).length();
                cumulative[k] = area;
                owner[k] = p;
            }
        });

        // Draw a triangle per particle, then group particles by part so each part is one loop.
        const random = mulberry32(seed);
        const drawn = new Uint32Array(count);
        const perPart = new Uint32Array(this.parts.length);
        for (let i = 0; i < count; i++) {
            drawn[i] = search(cumulative, random() * area);
            perPart[owner[drawn[i]]]++;
        }
        const ranges = new Uint32Array(this.parts.length + 1);
        for (let p = 0; p < this.parts.length; p++) ranges[p + 1] = ranges[p] + perPart[p];
        const firstTriangle = new Uint32Array(this.parts.length);
        for (let p = 1; p < this.parts.length; p++) firstTriangle[p] = firstTriangle[p - 1] + this.parts[p - 1].triangles.length / 3;

        const next = ranges.slice(0, -1);
        const triangle = new Uint32Array(count);
        const weights = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            const p = owner[drawn[i]];
            const slot = next[p]++;
            triangle[slot] = drawn[i] - firstTriangle[p];
            // Uniform spot on a triangle: fold the unit square in half.
            let u = random(), w = random();
            if (u + w > 1) { u = 1 - u; w = 1 - w; }
            weights[slot * 2] = u;
            weights[slot * 2 + 1] = w;
        }

        const local = new Float32Array(count * 3);
        this.parts.forEach((part, p) => interpolate(part.rest, part.triangles, triangle, weights, local, ranges[p], ranges[p + 1]));
        return { ranges, triangle, weights, local };
    }

    /** One fixed framing for the whole clip: centered and scaled like a static model, over every moment. */
    private frameWholeAnimation(): void {
        const placement = this.place(FRAMING_POINTS, 11);
        const frames = new Float32Array(FRAMING_FRAMES * FRAMING_POINTS * 3);
        const identity = new THREE.Matrix4();
        for (let f = 0; f < FRAMING_FRAMES; f++) {
            this.mixer.setTime((f / FRAMING_FRAMES) * this.clip.duration);
            this.root.updateMatrixWorld(true);
            for (const part of this.parts) if (part.live) refreshVertices(part, this.vertex);
            this.write(placement, frames.subarray(f * FRAMING_POINTS * 3, (f + 1) * FRAMING_POINTS * 3), identity);
        }
        const box = new THREE.Box3().setFromArray(frames);
        const center = box.getCenter(new THREE.Vector3());
        let maxDistSq = 0;
        for (let i = 0; i < frames.length; i += 3) {
            const dx = frames[i] - center.x, dy = frames[i + 1] - center.y, dz = frames[i + 2] - center.z;
            maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz);
        }
        const scale = maxDistSq > 0 ? FIT_RADIUS / Math.sqrt(maxDistSq) : 1;
        this.fit.makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
        this.posedAt = NaN; // framing moved the scene: the next seek must pose again
    }
}

/** The particles of one backend on an animated model. */
export class AnimatedSurface {
    private posed = false;

    constructor(private readonly model: AnimatedModel, private readonly placement: Placement) {}

    /** Write positions for formula time `t` into `out`. Returns false when nothing moved since the last call. */
    pose(time: number, out: Float32Array): boolean {
        const moved = this.model.seek(time);
        if (!moved && this.posed) return false;
        this.posed = true;
        this.model.write(this.placement, out);
        return true;
    }
}

function collectParts(root: THREE.Object3D): Part[] {
    const parts: Part[] = [];
    root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const position = mesh.isMesh ? mesh.geometry?.attributes.position : undefined;
        if (!position || position.count < 3) return;
        const rest = new Float32Array(position.count * 3);
        for (let i = 0; i < position.count; i++) {
            rest[i * 3] = position.getX(i);
            rest[i * 3 + 1] = position.getY(i);
            rest[i * 3 + 2] = position.getZ(i);
        }
        const index = mesh.geometry.index;
        const triangles = index
            ? Uint32Array.from({ length: index.count - (index.count % 3) }, (_, i) => index.getX(i))
            : Uint32Array.from({ length: position.count - (position.count % 3) }, (_, i) => i);
        const deforms = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true || (mesh.morphTargetInfluences?.length ?? 0) > 0;
        parts.push({ mesh, rest, live: deforms ? new Float32Array(rest.length) : null, triangles });
    });
    return parts;
}

/** Skinned or morphing mesh: its vertices as they are right now, in its own space. */
function refreshVertices(part: Part, vertex: THREE.Vector3): void {
    const live = part.live!;
    for (let i = 0, n = live.length / 3; i < n; i++) {
        part.mesh.getVertexPosition(i, vertex);
        live[i * 3] = vertex.x;
        live[i * 3 + 1] = vertex.y;
        live[i * 3 + 2] = vertex.z;
    }
}

function interpolate(vertices: Float32Array, triangles: Uint32Array, triangle: Uint32Array, weights: Float32Array, out: Float32Array, start: number, end: number): void {
    for (let i = start; i < end; i++) {
        const t = triangle[i] * 3;
        const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
        const wa = weights[i * 2], wb = weights[i * 2 + 1], wc = 1 - wa - wb;
        out[i * 3] = vertices[a] * wa + vertices[b] * wb + vertices[c] * wc;
        out[i * 3 + 1] = vertices[a + 1] * wa + vertices[b + 1] * wb + vertices[c + 1] * wc;
        out[i * 3 + 2] = vertices[a + 2] * wa + vertices[b + 2] * wb + vertices[c + 2] * wc;
    }
}

/** First index whose cumulative value exceeds `value`. */
function search(cumulative: Float64Array, value: number): number {
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cumulative[mid] > value) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}
