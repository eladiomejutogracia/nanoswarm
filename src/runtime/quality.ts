/**
 * Automatic quality: if the frame rate stays low, suggest fewer particles.
 *
 * It only ever steps *down* (stepping back up would oscillate), waits after
 * every change so the new count can settle, and stops at a floor.
 */
export interface AutoQualityOptions {
    /** Average fps below this over a whole window triggers a step down. */
    minFps: number;
    /** Seconds of frames averaged per decision. */
    windowSeconds: number;
    /** Seconds ignored after start or after a change (shader compiles, morphs). */
    warmupSeconds: number;
    /** New count = current × factor. */
    factor: number;
    /** Never go below this many particles. */
    floor: number;
}

export const AUTO_QUALITY_DEFAULTS: AutoQualityOptions = {
    minFps: 30,
    windowSeconds: 3,
    warmupSeconds: 2,
    factor: 0.6,
    floor: 5_000,
};

export class AutoQuality {
    private readonly options: AutoQualityOptions;
    private warmup: number;
    private time = 0;
    private frames = 0;

    constructor(options: Partial<AutoQualityOptions> = {}) {
        this.options = { ...AUTO_QUALITY_DEFAULTS, ...options };
        this.warmup = this.options.warmupSeconds;
    }

    /** Start over (after a rebuild, or when the page becomes visible again). */
    reset(): void {
        this.warmup = this.options.warmupSeconds;
        this.time = 0;
        this.frames = 0;
    }

    /**
     * Feed one frame. Returns a smaller particle count to switch to,
     * or null to keep the current one.
     */
    sample(dt: number, count: number): number | null {
        if (this.warmup > 0) {
            this.warmup -= dt;
            return null;
        }
        this.time += dt;
        this.frames++;
        if (this.time < this.options.windowSeconds) return null;

        const fps = this.frames / this.time;
        this.time = 0;
        this.frames = 0;
        if (fps >= this.options.minFps || count <= this.options.floor) return null;

        this.reset();
        return Math.max(this.options.floor, Math.round(count * this.options.factor));
    }
}
