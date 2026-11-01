import { describe, expect, it } from 'vitest';
import { compileFormula } from '../src/formula';
import { parseMarkup, readOptions, type SwarmMarkup } from '../src/element/markup';
import { calibrateFlow } from '../src/sources/flow';
import { createParticleParams } from '../src/sources/params';

const GROUPS = ['sound', 'shapes', 'attractors'];

// Same loader as the playground, so both read the very same files.
const files = import.meta.glob('../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples: [string, string, SwarmMarkup][] = Object.entries(files).map(([path, html]) => {
    const [group, file] = path.split('/').slice(-2);
    return [`${group}/${file}`, group, parseMarkup(html)];
});

const attr = (markup: SwarmMarkup, name: string) => markup.attributes.find(([n]) => n === name)?.[1] ?? null;
const N = 2000;
const params = createParticleParams(N);
const frame = (audio: number) => ({ t: 3.7, bass: audio, mid: audio, treble: audio, level: audio, spectrum: new Float32Array(64).fill(audio) });

describe('examples', () => {
    it('exist in every group', () => {
        for (const group of GROUPS) expect(examples.filter(([, g]) => g === group).length).toBeGreaterThan(2);
        expect(new Set(examples.map(([, g]) => g))).toEqual(new Set(GROUPS));
    });

    it.each(examples)('%s has a title and valid attributes', (_, __, markup) => {
        expect(attr(markup, 'title')).toBeTruthy();
        const options = readOptions((name) => attr(markup, name));
        const colors = attr(markup, 'colors');
        if (colors) expect(options.look.colors.join(' ')).toBe(colors); // nothing silently dropped
    });

    it.each(examples.filter(([, group]) => group !== 'attractors'))('%s is a shape that stays on screen', (_, group, markup) => {
        const formula = compileFormula(markup.formula);
        expect(formula.program.kind).toBe('shape');
        expect(formula.program.usesAudio).toBe(group === 'sound'); // sound shapes listen; the others ignore it
        const out = new Float32Array(N * 3);
        for (const audio of [0, 1]) {
            formula.evaluate(out, null, params, N, frame(audio));
            expect(out.every(Number.isFinite)).toBe(true);
            let max = 0;
            for (let i = 0; i < out.length; i += 3) max = Math.max(max, Math.hypot(out[i], out[i + 1], out[i + 2]));
            expect(max).toBeGreaterThan(1);
            expect(max).toBeLessThan(8);
        }
    });

    it.each(examples.filter(([, group]) => group === 'attractors'))('%s is a motion whose colors span the palette', (_, __, markup) => {
        const formula = compileFormula(markup.formula);
        expect(formula.program.kind).toBe('motion');
        const field = calibrateFlow(formula);
        const n = field.seeds.length / 3;
        const colors = new Float32Array(n);
        formula.evaluate(new Float32Array(n * 3), colors, createParticleParams(n), n, frame(0), field.seeds);
        const sorted = Array.from(colors).sort((a, b) => a - b);
        expect(sorted[Math.floor(n * 0.1)]).toBeLessThan(0.45); // slow parts reach the cool end…
        expect(sorted[Math.floor(n * 0.9)]).toBeGreaterThan(0.55); // …fast parts the hot end
    });
});
