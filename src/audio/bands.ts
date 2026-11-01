/**
 * Turning an FFT frame into four friendly numbers in [0, 1]:
 * bass, mid, treble and level. Pure functions — no Web Audio here.
 */
export interface AudioBands {
    bass: number;
    mid: number;
    treble: number;
    level: number;
}

export const SILENCE: Readonly<AudioBands> = Object.freeze({ bass: 0, mid: 0, treble: 0, level: 0 });

/** Frequency ranges in Hz. */
export const BAND_RANGES = {
    bass: [20, 250],
    mid: [250, 2000],
    treble: [2000, 10000],
} as const;

/** Average byte magnitude (0–255) of the FFT bins covering [lowHz, highHz), as 0–1. */
export function bandEnergy(freq: Uint8Array, sampleRate: number, lowHz: number, highHz: number): number {
    const binHz = sampleRate / 2 / freq.length;
    const from = Math.max(0, Math.floor(lowHz / binHz));
    const to = Math.min(freq.length, Math.max(from + 1, Math.ceil(highHz / binHz)));
    let sum = 0;
    for (let i = from; i < to; i++) sum += freq[i];
    return sum / (to - from) / 255;
}

export function rawBands(freq: Uint8Array, sampleRate: number): AudioBands {
    const bass = bandEnergy(freq, sampleRate, ...BAND_RANGES.bass);
    const mid = bandEnergy(freq, sampleRate, ...BAND_RANGES.mid);
    const treble = bandEnergy(freq, sampleRate, ...BAND_RANGES.treble);
    return { bass, mid, treble, level: (bass + mid + treble) / 3 };
}

const KEYS = ['bass', 'mid', 'treble', 'level'] as const;

/**
 * Keeps the bands lively regardless of volume:
 * - adaptive gain: each band is divided by its own slowly-decaying peak,
 *   so quiet songs still use the full 0–1 range;
 * - envelope: fast attack, slower release, so beats pop and fade smoothly.
 */
export class BandSmoother {
    private readonly peak: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0 };
    private readonly value: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0 };

    constructor(
        /** Multiplier applied after normalization. */
        public sensitivity = 1,
        /** Raw energies below this are treated as silence (avoids amplifying hiss). */
        private readonly noiseFloor = 0.04,
        private readonly attack = 30,
        private readonly release = 6,
        /** Peak decay per second (fraction kept). */
        private readonly peakDecay = 0.5,
    ) {}

    update(raw: AudioBands, dt: number): AudioBands {
        const peakKeep = Math.pow(this.peakDecay, dt);
        for (const key of KEYS) {
            const energy = Math.max(0, raw[key] - this.noiseFloor);
            this.peak[key] = Math.max(energy, this.peak[key] * peakKeep, 0.08);
            const target = Math.min(1, (energy / this.peak[key]) * this.sensitivity);
            const rate = target > this.value[key] ? this.attack : this.release;
            this.value[key] += (target - this.value[key]) * (1 - Math.exp(-rate * dt));
        }
        return { ...this.value };
    }

    reset(): void {
        for (const key of KEYS) {
            this.peak[key] = 0;
            this.value[key] = 0;
        }
    }
}

// ─── Spectrum: the full picture, for formulas that call spectrum(k) ──

/** Number of log-spaced spectrum slices exposed to formulas (shared with the GLSL uniform). */
export const SPECTRUM_BINS = 64;
export const SPECTRUM_RANGE_HZ = [40, 12000] as const;

/**
 * Log-spaced spectrum: slice 0 is deep bass, the last slice is high treble.
 * Each slice averages the FFT bins in its frequency range (0–1).
 */
export function rawSpectrum(freq: Uint8Array, sampleRate: number, out = new Float32Array(SPECTRUM_BINS)): Float32Array {
    const [low, high] = SPECTRUM_RANGE_HZ;
    const ratio = high / low;
    for (let i = 0; i < out.length; i++) {
        const from = low * Math.pow(ratio, i / out.length);
        const to = low * Math.pow(ratio, (i + 1) / out.length);
        out[i] = bandEnergy(freq, sampleRate, from, to);
    }
    return out;
}

/**
 * Same idea as BandSmoother, but one shared adaptive peak for all slices —
 * so the spectrum keeps its shape (bass still taller than treble) while
 * quiet songs still fill the range.
 */
export class SpectrumSmoother {
    readonly value = new Float32Array(SPECTRUM_BINS);
    private peak = 0;

    constructor(
        public sensitivity = 1,
        private readonly noiseFloor = 0.04,
        private readonly attack = 30,
        private readonly release = 8,
        private readonly peakDecay = 0.5,
    ) {}

    update(raw: Float32Array, dt: number): Float32Array {
        let frameMax = 0;
        for (let i = 0; i < raw.length; i++) frameMax = Math.max(frameMax, raw[i] - this.noiseFloor);
        this.peak = Math.max(frameMax, this.peak * Math.pow(this.peakDecay, dt), 0.08);

        const up = 1 - Math.exp(-this.attack * dt);
        const down = 1 - Math.exp(-this.release * dt);
        for (let i = 0; i < this.value.length; i++) {
            const energy = Math.max(0, (raw[i] ?? 0) - this.noiseFloor);
            const target = Math.min(1, (energy / this.peak) * this.sensitivity);
            this.value[i] += (target - this.value[i]) * (target > this.value[i] ? up : down);
        }
        return this.value;
    }

    reset(): void {
        this.peak = 0;
        this.value.fill(0);
    }
}
