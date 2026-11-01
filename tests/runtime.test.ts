import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AutoQuality } from '../src/runtime/quality';
import { FIELD_OF_VIEW, ViewTween, verticalFov } from '../src/runtime/view';

/** Feed `seconds` of frames at a steady `fps`; return the first suggestion, if any. */
function run(quality: AutoQuality, fps: number, seconds: number, count = 120_000): number | null {
    for (let t = 0; t < seconds; t += 1 / fps) {
        const next = quality.sample(1 / fps, count);
        if (next !== null) return next;
    }
    return null;
}

describe('AutoQuality', () => {
    it('leaves a smooth swarm alone', () => {
        expect(run(new AutoQuality(), 60, 30)).toBeNull();
    });

    it('steps down after a full window of low fps (once warm-up has passed)', () => {
        const quality = new AutoQuality();
        expect(run(quality, 20, 4.9)).toBeNull(); // 2 s warm-up + 3 s window not complete yet
        expect(run(quality, 20, 0.5)).toBe(72_000);
    });

    it('ignores short hiccups that average out', () => {
        const quality = new AutoQuality();
        run(quality, 60, 2); // warm-up
        let suggestion: number | null = null;
        for (let i = 0; i < 180 && suggestion === null; i++) {
            suggestion = quality.sample(i % 30 === 0 ? 0.2 : 1 / 60, 120_000); // a stutter every half second
        }
        expect(suggestion).toBeNull();
    });

    it('never goes below its floor and waits again after each change', () => {
        const quality = new AutoQuality({ floor: 5_000 });
        expect(run(quality, 10, 10, 6_000)).toBe(5_000);
        expect(run(quality, 10, 10, 5_000)).toBeNull();
    });
});

describe('verticalFov', () => {
    const horizontalFov = (aspect: number) =>
        THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(verticalFov(aspect) / 2)) * aspect));

    it('keeps the field of view vertically on landscape and square canvases', () => {
        expect(verticalFov(16 / 9)).toBe(FIELD_OF_VIEW);
        expect(verticalFov(1)).toBe(FIELD_OF_VIEW);
    });

    it('keeps it horizontally on portrait canvases, so shapes are not cropped on phones', () => {
        for (const aspect of [0.9, 390 / 792, 0.3]) {
            expect(horizontalFov(aspect)).toBeCloseTo(FIELD_OF_VIEW, 6);
            expect(verticalFov(aspect)).toBeGreaterThan(FIELD_OF_VIEW);
        }
    });
});

describe('ViewTween', () => {
    it('glides to the requested elevation and distance, keeping the azimuth', () => {
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(10, 0, 0); // looking from +x
        const tween = new ViewTween(camera, 1);
        tween.start({ elevation: 30, distance: 20 });
        expect(tween.active).toBe(true);
        for (let i = 0; i < 70; i++) tween.update(1 / 60);
        expect(tween.active).toBe(false);
        const spherical = new THREE.Spherical().setFromVector3(camera.position);
        expect(spherical.radius).toBeCloseTo(20, 5);
        expect(THREE.MathUtils.radToDeg(Math.PI / 2 - spherical.phi)).toBeCloseTo(30, 5);
        expect(camera.position.z).toBeCloseTo(0, 5);
        expect(camera.position.x).toBeGreaterThan(0);
    });

    it('stops when cancelled (the user grabbed the camera)', () => {
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(0, 0, 10);
        const tween = new ViewTween(camera);
        tween.start({ elevation: 60, distance: 30 });
        tween.cancel();
        tween.update(1);
        expect(camera.position.toArray()).toEqual([0, 0, 10]);
    });
});
