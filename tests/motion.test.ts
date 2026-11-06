import { describe, expect, it } from 'vitest';
import {
    MotionPreference,
    REDUCED_MOTION_QUERY,
    SETTLE_STEPS,
    SETTLE_STEPS_PER_FRAME,
    StillFrames,
    type MotionQuery,
} from '../src/runtime/motion';

/** A stand-in for window.matchMedia(...) whose setting the test can flip, like the operating system does. */
function fakeSetting(initial: boolean) {
    const listeners = new Set<() => void>();
    const queries: string[] = [];
    const query: MotionQuery = {
        matches: initial,
        addEventListener: (_type, listener) => void listeners.add(listener),
        removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
    return {
        matchMedia: (q: string) => (queries.push(q), query),
        query,
        queries,
        listeners,
        set(reduced: boolean) {
            (query as { matches: boolean }).matches = reduced;
            listeners.forEach((listener) => listener());
        },
    };
}

describe('MotionPreference', () => {
    it('asks for prefers-reduced-motion and reads the current setting', () => {
        const on = fakeSetting(true);
        expect(new MotionPreference(() => {}, on.matchMedia).reduced).toBe(true);
        expect(on.queries).toEqual([REDUCED_MOTION_QUERY]);
        expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
        expect(new MotionPreference(() => {}, fakeSetting(false).matchMedia).reduced).toBe(false);
    });

    it('follows a change of the setting without a reload, in both directions', () => {
        const setting = fakeSetting(false);
        const seen: boolean[] = [];
        const preference = new MotionPreference((reduced) => seen.push(reduced), setting.matchMedia);
        setting.set(true);
        expect(preference.reduced).toBe(true);
        setting.set(false);
        expect(preference.reduced).toBe(false);
        expect(seen).toEqual([true, false]);
    });

    it('reports a change once even when the event never arrives, as soon as the setting is read', () => {
        const setting = fakeSetting(false);
        const seen: boolean[] = [];
        const preference = new MotionPreference((reduced) => seen.push(reduced), setting.matchMedia);
        setting.listeners.clear(); // the browser swallowed the event
        (setting.query as { matches: boolean }).matches = true;
        expect(preference.reduced).toBe(true);
        expect(preference.reduced).toBe(true);
        expect(seen).toEqual([true]);
    });

    it('stops listening once disposed', () => {
        const setting = fakeSetting(false);
        const seen: boolean[] = [];
        const preference = new MotionPreference((reduced) => seen.push(reduced), setting.matchMedia);
        preference.dispose();
        expect(setting.listeners.size).toBe(0);
        setting.set(true);
        expect(seen).toEqual([]);
    });

    it('is never reduced where there is no matchMedia (tests, servers)', () => {
        const preference = new MotionPreference(() => {}, undefined);
        expect(preference.reduced).toBe(false);
        expect(() => preference.dispose()).not.toThrow();
    });
});

/** Run frames until the swarm has settled and been drawn; report how many frames and steps it took. */
function untilDrawn(frames: StillFrames): { frames: number; steps: number } {
    let steps = 0;
    for (let frame = 1; frame <= 1000; frame++) {
        const next = frames.next();
        steps += next.steps;
        if (next.paint) return { frames: frame, steps };
    }
    throw new Error('never drawn');
}

describe('StillFrames', () => {
    it('settles for SETTLE_STEPS in small batches, draws once at the end, and then does nothing at all', () => {
        const frames = new StillFrames();
        const first = untilDrawn(frames);
        expect(first.steps).toBe(SETTLE_STEPS);
        expect(first.frames).toBe(Math.ceil(SETTLE_STEPS / SETTLE_STEPS_PER_FRAME));
        for (let i = 0; i < 100; i++) expect(frames.next()).toEqual({ steps: 0, paint: false });
    });

    it('never takes more than a small batch of steps in one frame', () => {
        const frames = new StillFrames();
        for (let i = 0; i < 30; i++) expect(frames.next().steps).toBeLessThanOrEqual(SETTLE_STEPS_PER_FRAME);
    });

    it('draws nothing while it is still settling (no half-formed picture, no motion to see)', () => {
        const frames = new StillFrames();
        const painted: boolean[] = [];
        for (let i = 0; i < 14; i++) painted.push(frames.next().paint);
        expect(painted.filter(Boolean)).toHaveLength(0);
        expect(frames.next().paint).toBe(true);
    });

    it('draws again, without settling, when something visible changes (size, colors, camera)', () => {
        const frames = new StillFrames();
        untilDrawn(frames);
        frames.invalidate();
        expect(frames.next()).toEqual({ steps: 0, paint: true });
        expect(frames.next()).toEqual({ steps: 0, paint: false });
    });

    it('settles again when the swarm itself changes (shape, count, renderer, lost GPU context)', () => {
        const frames = new StillFrames();
        untilDrawn(frames);
        frames.resettle();
        expect(untilDrawn(frames).steps).toBe(SETTLE_STEPS);
        expect(frames.next()).toEqual({ steps: 0, paint: false });
    });

    it('a change during settling still ends in one draw', () => {
        const frames = new StillFrames();
        frames.next();
        frames.invalidate();
        frames.resettle();
        expect(untilDrawn(frames).steps).toBe(SETTLE_STEPS);
        expect(frames.next()).toEqual({ steps: 0, paint: false });
    });
});
