import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

describe('playground keyboard access', () => {
    const fileInputs = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((m) => m[0]);

    it('has the two file loaders (model, audio)', () => {
        expect(fileInputs.map((input) => /id="([^"]+)"/.exec(input)?.[1])).toEqual(['model-input', 'audio-input']);
    });

    it('keeps them focusable: `hidden` / display:none would take them out of the tab order', () => {
        for (const input of fileInputs) {
            expect(input).not.toMatch(/\shidden(\s|\/|>|=)/);
            expect(input).not.toMatch(/tabindex="-1"/);
            expect(input).toMatch(/class="visually-hidden"/);
        }
        const rule = /\.visually-hidden\s*{([^}]*)}/.exec(css)?.[1] ?? '';
        expect(rule).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
        expect(rule).toMatch(/position\s*:\s*absolute/);
    });

    it('shows where the focus is on the visible label', () => {
        expect(css).toMatch(/\.button:has\(:focus-visible\)/);
        expect(css).toMatch(/\.drop:has\(:focus-visible\)/);
    });
});
