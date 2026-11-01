import { describe, expect, it } from 'vitest';
import { BandSmoother, bandEnergy, rawBands, rawSpectrum, SPECTRUM_BINS, SpectrumSmoother } from '../src/audio/bands';

const SAMPLE_RATE = 48000;
const BINS = 1024; // fftSize 2048 → 23.4 Hz per bin

/** An FFT frame with `value` in the bins between lowHz and highHz. */
function frame(lowHz: number, highHz: number, value = 255): Uint8Array {
    const freq = new Uint8Array(BINS);
    const binHz = SAMPLE_RATE / 2 / BINS;
    for (let i = 0; i < BINS; i++) if (i * binHz >= lowHz && i * binHz < highHz) freq[i] = value;
    return freq;
}

describe('band extraction', () => {
    it('measures energy only inside the requested range', () => {
        const kick = frame(40, 120);
        expect(bandEnergy(kick, SAMPLE_RATE, 20, 250)).toBeGreaterThan(0.2);
        expect(bandEnergy(kick, SAMPLE_RATE, 2000, 10000)).toBe(0);
    });

    it('separates bass, mid and treble', () => {
        expect(rawBands(frame(20, 250), SAMPLE_RATE).bass).toBeGreaterThan(0.8);
        expect(rawBands(frame(20, 250), SAMPLE_RATE).treble).toBe(0);
        expect(rawBands(frame(2000, 10000), SAMPLE_RATE).treble).toBeGreaterThan(0.9);
        expect(rawBands(frame(250, 2000), SAMPLE_RATE).mid).toBeGreaterThan(0.9);
    });

    it('is silent on a silent frame', () => {
        expect(rawBands(new Uint8Array(BINS), SAMPLE_RATE)).toEqual({ bass: 0, mid: 0, treble: 0, level: 0 });
    });
});

describe('BandSmoother', () => {
    const loud = { bass: 0.9, mid: 0.5, treble: 0.3, level: 0.57 };
    const quiet = { bass: 0.2, mid: 0.12, treble: 0.08, level: 0.13 };
    const silent = { bass: 0, mid: 0, treble: 0, level: 0 };

    it('stays in [0, 1]', () => {
        const smoother = new BandSmoother(3);
        for (let i = 0; i < 60; i++) {
            const out = smoother.update(i % 2 ? loud : silent, 1 / 60);
            for (const v of Object.values(out)) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
    });

    it('attacks fast and releases slowly', () => {
        const smoother = new BandSmoother();
        const afterHit = smoother.update(loud, 1 / 10).bass;
        expect(afterHit).toBeGreaterThan(0.9);
        const afterRelease = smoother.update(silent, 1 / 10).bass;
        expect(afterRelease).toBeGreaterThan(0.4);
        expect(afterRelease).toBeLessThan(afterHit);
    });

    it('adapts gain so a quiet but steady song still reaches the top of the range', () => {
        const smoother = new BandSmoother();
        let out = smoother.update(quiet, 1 / 60);
        for (let i = 0; i < 300; i++) out = smoother.update(quiet, 1 / 60);
        expect(out.bass).toBeGreaterThan(0.9);
    });

    it('does not amplify background hiss', () => {
        const smoother = new BandSmoother();
        const hiss = { bass: 0.03, mid: 0.03, treble: 0.03, level: 0.03 };
        let out = smoother.update(hiss, 1 / 60);
        for (let i = 0; i < 300; i++) out = smoother.update(hiss, 1 / 60);
        expect(out.level).toBe(0);
    });
});

describe('spectrum', () => {
    it('is log-spaced: a kick lands in the first slices, a hi-hat in the last ones', () => {
        const kick = rawSpectrum(frame(40, 90), SAMPLE_RATE);
        const hat = rawSpectrum(frame(8000, 12000), SAMPLE_RATE);
        expect(kick.length).toBe(SPECTRUM_BINS);
        expect(Math.max(...kick.slice(0, 8))).toBeGreaterThan(0.5);
        expect(Math.max(...kick.slice(32))).toBe(0);
        expect(Math.max(...hat.slice(-6))).toBeGreaterThan(0.5);
        expect(Math.max(...hat.slice(0, 32))).toBe(0);
    });

    it('keeps the shape of the spectrum while normalizing its height', () => {
        const smoother = new SpectrumSmoother();
        const raw = new Float32Array(SPECTRUM_BINS);
        raw[0] = 0.5;
        raw[10] = 0.25;
        let out = smoother.update(raw, 1 / 60);
        for (let i = 0; i < 120; i++) out = smoother.update(raw, 1 / 60);
        expect(out[0]).toBeGreaterThan(0.95);
        expect(out[10]).toBeGreaterThan(0.3);
        expect(out[10]).toBeLessThan(out[0]);
        expect(out[40]).toBe(0);
    });
});
