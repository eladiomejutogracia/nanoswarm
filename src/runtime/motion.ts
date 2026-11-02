/**
 * The visitor's "reduce motion" setting, and what a frame does while it is on.
 * Pure: no three.js, no DOM beyond the optional `matchMedia`.
 */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export interface MotionQuery {
    readonly matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
}

/** Follows the operating-system setting live. Where there is no `matchMedia` (tests, servers) motion is never reduced. */
export class MotionPreference {
    private readonly query: MotionQuery | null;
    private readonly listener = () => this.onChange(this.reduced);

    constructor(
        private readonly onChange: (reduced: boolean) => void,
        matchMedia: ((query: string) => MotionQuery) | undefined = globalThis.matchMedia?.bind(globalThis),
    ) {
        this.query = matchMedia ? matchMedia(REDUCED_MOTION_QUERY) : null;
        this.query?.addEventListener('change', this.listener);
    }

    get reduced(): boolean {
        return this.query?.matches ?? false;
    }

    dispose(): void {
        this.query?.removeEventListener('change', this.listener);
    }
}

/** Steps of the largest frame the swarm takes to settle: 3 s of physics, well past the spring's ring-down. */
export const SETTLE_STEPS = 90;
/** Spread over frames, so a slow device never stalls (or loses its GPU) on one long task. */
export const SETTLE_STEPS_PER_FRAME = 6;

export interface StillFrame {
    /** Physics steps to take this frame. */
    steps: number;
    /** Draw the picture after them. */
    paint: boolean;
}

/**
 * With motion reduced the swarm is a picture, not an animation: it settles
 * into its shape out of sight, then is drawn, and is drawn again only when
 * something changes. One rule for every kind of shape.
 */
export class StillFrames {
    private remaining = SETTLE_STEPS;
    private paint = true;

    /** Something visible changed (size, colors, camera): draw again. */
    invalidate(): void {
        this.paint = true;
    }

    /** The swarm itself changed (shape, count, renderer, a lost GPU context): settle again, then draw. */
    resettle(): void {
        this.remaining = SETTLE_STEPS;
        this.paint = true;
    }

    /** What this frame does. Asking consumes the request. */
    next(): StillFrame {
        const steps = Math.min(SETTLE_STEPS_PER_FRAME, this.remaining);
        this.remaining -= steps;
        const paint = this.remaining === 0 && this.paint;
        if (paint) this.paint = false;
        return { steps, paint };
    }
}
