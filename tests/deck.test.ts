import { describe, expect, it } from 'vitest';
import { checkMarkup } from '../src/element/check';
import { parseFormula } from '../src/formula';
import { INSIDE_LINE, LANGS, SLIDES, UI } from '../web/deck/slides';

describe('deck', () => {
    it.each(SLIDES.map((s) => [s.id, s] as const))('%s draws a valid <nano-swarm>', (_, slide) => {
        const result = checkMarkup(slide.swarm);
        expect(result.errors).toEqual([]);
    });

    it.each(SLIDES.map((s) => [s.id, s] as const))('%s is written in every language', (_, slide) => {
        for (const lang of LANGS) {
            const text = slide.text[lang];
            for (const field of ['name', 'eyebrow', 'title', 'body', 'notes'] as const) expect(text[field].trim(), `${lang}.${field}`).not.toBe('');
        }
    });

    it('has the same words around the slides in every language', () => {
        const keys = Object.keys(UI.en).sort();
        for (const lang of LANGS) expect(Object.keys(UI[lang]).sort()).toEqual(keys);
    });

    it('fits the number keys and has unique slide ids', () => {
        expect(SLIDES.length).toBeLessThanOrEqual(9);
        expect(new Set(SLIDES.map((s) => s.id)).size).toBe(SLIDES.length);
    });

    it('shows generated code for a line the "inside" slide really has', () => {
        const inside = SLIDES.find((s) => s.id === 'inside')!;
        const program = parseFormula(inside.swarm.formula);
        expect(program.statements.some((s) => s.name === INSIDE_LINE)).toBe(true);
    });
});
