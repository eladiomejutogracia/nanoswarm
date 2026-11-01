import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { detectModelFormat, flattenToGeometry, sampleSurface } from '../src/sources/model';
import { createParticleParams, normalizePoints, resamplePoints } from '../src/sources/params';
import { DEFAULT_FORMULA, resolveSource } from '../src/sources';

function maxRadius(points: Float32Array): number {
    let max = 0;
    for (let i = 0; i < points.length; i += 3) {
        max = Math.max(max, Math.hypot(points[i], points[i + 1], points[i + 2]));
    }
    return max;
}

function allFinite(points: Float32Array): boolean {
    return points.every(Number.isFinite);
}

describe('particle params', () => {
    it('spreads u, v over [0, 2π) and r over [0, 1)', () => {
        const params = createParticleParams(5000);
        for (let i = 0; i < params.length; i += 3) {
            expect(params[i]).toBeGreaterThanOrEqual(0);
            expect(params[i]).toBeLessThan(Math.PI * 2 + 1e-5);
            expect(params[i + 2]).toBeGreaterThanOrEqual(0);
            expect(params[i + 2]).toBeLessThan(1);
        }
    });

    it('is deterministic', () => {
        expect(createParticleParams(100)).toEqual(createParticleParams(100));
    });

    it('covers the parameter square evenly (no empty quadrant)', () => {
        const params = createParticleParams(400);
        const quadrants = [0, 0, 0, 0];
        for (let i = 0; i < params.length; i += 3) {
            quadrants[(params[i] < Math.PI ? 0 : 1) + (params[i + 1] < Math.PI ? 0 : 2)]++;
        }
        for (const q of quadrants) expect(q).toBeGreaterThan(80);
    });
});

describe('point helpers', () => {
    it('normalizes into a centered sphere of the given radius', () => {
        const points = normalizePoints(new Float32Array([10, 10, 10, 30, 10, 10]), 2);
        expect(Array.from(points)).toEqual([-2, 0, 0, 2, 0, 0]);
    });

    it('resamples to any count', () => {
        const points = new Float32Array([0, 0, 0, 1, 1, 1]);
        expect(resamplePoints(points, 4).length).toBe(12);
        expect(resamplePoints(points, 1).length).toBe(3);
        expect(resamplePoints(new Float32Array(0), 2)).toEqual(new Float32Array(6));
    });
});

describe('resolveSource', () => {
    it('treats any string as a formula', async () => {
        expect((await resolveSource('x = u\ny = v\nz = 0')).kind).toBe('shape');
        expect((await resolveSource({ formula: 'x = u\ny = v\nz = 0' })).kind).toBe('shape');
    });

    it('shows the default sphere for an empty formula', async () => {
        const target = await resolveSource('   \n ');
        if (target.kind !== 'shape') throw new Error('expected a shape');
        expect(target.formula.source).toBe(DEFAULT_FORMULA);
    });

    it('turns motion formulas into calibrated, animated targets', async () => {
        const target = await resolveSource('dx = 10 * (y - x)\ndy = x * (28 - z) - y\ndz = x * y - 8/3 * z');
        if (target.kind !== 'motion') throw new Error('expected a motion');
        expect(target.field.scale).toBeGreaterThan(0);
    });

    it('reports formula mistakes with line and column', async () => {
        await expect(resolveSource('x = nope\ny = 0\nz = 0')).rejects.toThrow(/Line 1, col 5: Unknown name "nope"/);
    });

    it('accepts raw points and caches samples per count', async () => {
        const target = await resolveSource({ points: new Float32Array([0, 0, 0, 2, 0, 0]) });
        if (target.kind !== 'points') throw new Error('expected points');
        const a = target.sample(10);
        expect(a.length).toBe(30);
        expect(target.sample(10)).toBe(a);
        expect(target.sample(20)).not.toBe(a);
    });
});

describe('models', () => {
    it('detects formats from names and URLs', () => {
        expect(detectModelFormat('robot.GLB')).toBe('glb');
        expect(detectModelFormat('/models/bunny.obj?v=2')).toBe('obj');
        expect(detectModelFormat('scene.gltf#node')).toBe('gltf');
        expect(detectModelFormat('photo.png')).toBeNull();
        expect(detectModelFormat('photo.png?file=robot.glb')).toBeNull();
    });

    it('detects formats in linear time, even from hostile URLs', () => {
        const hostile = '.glb#'.repeat(20_000) + '\n'; // took seconds with the old single regex
        const start = performance.now();
        expect(detectModelFormat(hostile)).toBe('glb');
        expect(performance.now() - start).toBeLessThan(100);
    });

    it('flattens a scene graph with world transforms and samples its surface', () => {
        const group = new THREE.Group();
        const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
        const b = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8));
        b.position.set(10, 0, 0);
        group.add(a, b);

        const geometry = flattenToGeometry(group);
        const points = sampleSurface(geometry, 1000);
        expect(points.length).toBe(3000);
        expect(allFinite(points)).toBe(true);
        expect(maxRadius(points)).toBeCloseTo(4.5, 1);
    });

    it('fails clearly when a model has no meshes', () => {
        expect(() => flattenToGeometry(new THREE.Group())).toThrow(/no meshes/);
    });
});

describe('detectSourceKind', () => {
    it('recognises models and audio by name or MIME type', async () => {
        const { detectSourceKind } = await import('../src/sources');
        expect(detectSourceKind({ name: 'robot.glb' })).toBe('model');
        expect(detectSourceKind({ name: 'song.MP3' })).toBe('audio');
        expect(detectSourceKind({ name: 'recording', type: 'audio/webm' })).toBe('audio');
        expect(detectSourceKind({ name: 'photo.png', type: 'image/png' })).toBeNull();
    });
});
