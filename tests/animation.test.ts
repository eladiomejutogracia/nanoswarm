import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AnimatedModel } from '../src/sources/animation';
import { FIT_RADIUS } from '../src/sources/params';
import { CpuBackend } from '../src/backends/cpu';
import { SILENCE } from '../src/audio/bands';
import type { FrameInput } from '../src/backends/types';

/** A base plate and a lid that rises 2 units over one second — like a case opening. */
function openingCase(): { root: THREE.Group; clip: THREE.AnimationClip } {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2)));
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2));
    lid.name = 'lid';
    lid.position.y = 0.3;
    root.add(lid);
    const clip = new THREE.AnimationClip('open', 1, [
        new THREE.VectorKeyframeTrack('lid.position', [0, 1], [0, 0.3, 0, 0, 2.3, 0]),
    ]);
    return { root, clip };
}

/** A plane whose morph target lifts it by 1 unit over one second. */
function morphingPlane(): { root: THREE.Group; clip: THREE.AnimationClip } {
    const geometry = new THREE.PlaneGeometry(2, 2, 4, 4);
    const lifted = geometry.attributes.position.clone();
    for (let i = 0; i < lifted.count; i++) lifted.setZ(i, 1);
    geometry.morphAttributes.position = [lifted];
    const plane = new THREE.Mesh(geometry);
    plane.name = 'plane';
    plane.updateMorphTargets();
    const root = new THREE.Group();
    root.add(plane);
    const clip = new THREE.AnimationClip('lift', 1, [
        new THREE.NumberKeyframeTrack('plane.morphTargetInfluences[0]', [0, 1], [0, 1]),
    ]);
    return { root, clip };
}

function meanY(points: Float32Array): number {
    let sum = 0;
    for (let i = 1; i < points.length; i += 3) sum += points[i];
    return sum / (points.length / 3);
}

function maxRadius(points: Float32Array): number {
    let max = 0;
    for (let i = 0; i < points.length; i += 3) max = Math.max(max, Math.hypot(points[i], points[i + 1], points[i + 2]));
    return max;
}

describe('AnimatedModel', () => {
    it('moves the particles with the clip', () => {
        const { root, clip } = openingCase();
        const surface = new AnimatedModel(root, clip).sample(2000);
        const closed = new Float32Array(2000 * 3);
        const open = new Float32Array(2000 * 3);
        surface.pose(10, closed); // the clip starts the first time it is posed
        surface.pose(10.9, open);
        expect(meanY(open)).toBeGreaterThan(meanY(closed) + 0.5);
    });

    it('loops, and does nothing when time stands still (speed 0)', () => {
        const { root, clip } = openingCase();
        const surface = new AnimatedModel(root, clip).sample(500);
        const points = new Float32Array(500 * 3);
        surface.pose(0, points);
        surface.pose(0.4, points);
        expect(surface.pose(0.4, points)).toBe(false);
        const atPoint4 = points.slice();
        surface.pose(0.9, points);
        surface.pose(2.4, points); // two loops later: the same moment as 0.4
        for (let i = 0; i < points.length; i++) expect(points[i]).toBeCloseTo(atPoint4[i], 4);
    });

    it('frames the whole animation once: fits the screen at every moment, without jitter', () => {
        const { root, clip } = openingCase();
        const surface = new AnimatedModel(root, clip).sample(3000);
        const points = new Float32Array(3000 * 3);
        let largest = 0;
        for (let t = 0; t < 1; t += 0.05) {
            surface.pose(t, points);
            largest = Math.max(largest, maxRadius(points));
        }
        expect(largest).toBeLessThanOrEqual(FIT_RADIUS * 1.02);
        expect(largest).toBeGreaterThan(FIT_RADIUS * 0.9);

        // The base never moves on screen: same framing every frame.
        const base = (t: number): number => {
            surface.pose(t, points);
            let lowest = Infinity;
            for (let i = 1; i < points.length; i += 3) lowest = Math.min(lowest, points[i]);
            return lowest;
        };
        expect(base(0.1)).toBeCloseTo(base(0.8), 3);
    });

    it('follows morph targets', () => {
        const { root, clip } = morphingPlane();
        const surface = new AnimatedModel(root, clip).sample(400);
        const start = new Float32Array(400 * 3);
        const end = new Float32Array(400 * 3);
        surface.pose(0, start);
        surface.pose(0.9, end);
        let moved = 0;
        for (let i = 2; i < start.length; i += 3) if (Math.abs(end[i] - start[i]) > 0.5) moved++;
        expect(moved).toBe(400);
    });

    it('drives the CPU backend: targets follow the clip', () => {
        const frame = (time: number): FrameInput => ({
            dt: 1 / 60, time, speed: 1, bands: SILENCE, spectrum: new Float32Array(64),
            pointer: { active: false, x: 0, y: 0, z: 0 },
        });
        const { root, clip } = openingCase();
        const backend = new CpuBackend(1000);
        backend.setTarget({ kind: 'animated', model: new AnimatedModel(root, clip) });
        const targets = (): Float32Array => (backend as unknown as { targets: Float32Array }).targets;
        backend.update(frame(0));
        const closed = meanY(targets());
        backend.update(frame(0.9));
        expect(meanY(targets())).toBeGreaterThan(closed + 0.5);
    });
});
