import { describe, expect, it } from 'vitest';
import { checkHtml } from '../src/element/check';

const LORENZ = 'dx = 10 * (z - x)\ndz = x * (28 - y) - z\ndy = x * z - 8/3 * y';

describe('checkHtml', () => {
    it('accepts a valid shape and describes it', () => {
        const result = checkHtml('<nano-swarm title="Wave" colors="#000 #fff" tilt="30">x = u\ny = sin(t) * bass\nz = v\nc = 0.5</nano-swarm>');
        expect(result).toEqual({
            ok: true,
            title: 'Wave',
            summary: ['shape', 'reacts to time', 'reacts to sound', 'sets its own colors'],
            errors: [],
            warnings: [],
        });
    });

    it('accepts a motion that has an attractor', () => {
        expect(checkHtml(`<nano-swarm>${LORENZ}</nano-swarm>`)).toMatchObject({ ok: true, summary: ['motion'] });
    });

    it('reports formula mistakes with line and column', () => {
        const result = checkHtml('<nano-swarm>x = u\ny = radious\nz = 0</nano-swarm>');
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual(['formula Line 2, col 5: Unknown name "radious"']);
    });

    it('reports motions that run away or stop', () => {
        expect(checkHtml('<nano-swarm>dx = x*x + 1\ndy = y\ndz = z</nano-swarm>').errors[0]).toMatch(/infinity/);
        expect(checkHtml('<nano-swarm>dx = -x\ndy = -y\ndz = -z</nano-swarm>').errors[0]).toMatch(/single point/);
    });

    it('reports attribute values that would silently fall back to defaults', () => {
        const result = checkHtml('<nano-swarm colors="red" background="blue" renderer="webgpu" speed="fast">x = u\ny = v\nz = 0</nano-swarm>');
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual([
            'colors="red" must be 1–3 hex colors, e.g. colors="#ff3d00 #ff9100 #ffe57f"',
            'background="blue" must be a hex color, e.g. background="#03040a"',
            'renderer="webgpu" must be "gpu" or "cpu" (leave it out for automatic)',
            'speed="fast" must be a number',
        ]);
    });

    it('warns about things that work but probably are not what was meant', () => {
        const result = checkHtml('<nano-swarm tilt="120" solid="true" audio="song.mp3">x = u\ny = v\nz = 0</nano-swarm>');
        expect(result.ok).toBe(true);
        expect(result.warnings).toEqual([
            'tilt="120" is outside 0–90 and will be clamped',
            'solid is on/off — write just "solid" (its value "true" is ignored)',
            'audio is set, but the formula never reads bass, mid, treble, level or spectrum(k)',
        ]);
    });

    it('handles models, empty formulas and missing elements', () => {
        expect(checkHtml('<nano-swarm model="robot.glb">x = 1</nano-swarm>')).toMatchObject({
            ok: true, summary: ['model robot.glb'], warnings: ['the formula is ignored because model is set'],
        });
        expect(checkHtml('<nano-swarm></nano-swarm>').warnings).toEqual(['the formula is empty, so the default sphere is shown']);
        expect(checkHtml('<div>hi</div>')).toMatchObject({ ok: false, errors: ['no <nano-swarm>…</nano-swarm> element found'] });
    });

    it('a bare bloom is fine; a bloom strength is checked like any number', () => {
        expect(checkHtml('<nano-swarm bloom>x = u\ny = v\nz = 0</nano-swarm>').warnings).toEqual([]);
        expect(checkHtml('<nano-swarm bloom="9">x = u\ny = v\nz = 0</nano-swarm>').warnings[0]).toMatch(/outside 0–3/);
    });
});

describe('every example passes the checker', () => {
    const files = import.meta.glob('../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    it.each(Object.entries(files))('%s', (_, html) => {
        const result = checkHtml(html);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });
});
