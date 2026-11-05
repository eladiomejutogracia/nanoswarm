import { describe, expect, it } from 'vitest';
import { LOOK_DEFAULTS } from '../src/looks';
import {
    ATTRIBUTES,
    dedent,
    extractElement,
    formatMarkup,
    parseColors,
    parseMarkup,
    readOptions,
    type AttributeName,
    type SwarmMarkup,
} from '../src/element/markup';

const reader = (attrs: Partial<Record<AttributeName, string>>) => (name: AttributeName) => attrs[name] ?? null;

describe('readOptions', () => {
    it('gives the defaults for a bare element', () => {
        expect(readOptions(reader({}))).toEqual({
            look: LOOK_DEFAULTS,
            speed: 1,
            tilt: undefined,
            particles: undefined,
            backend: 'auto',
            sensitivity: 1,
            interactive: true,
            autoRotate: true,
        });
    });

    it('reads every attribute', () => {
        const options = readOptions(reader({
            colors: '#ff0000 #00ff00 #0000ff',
            background: '#111111',
            solid: '',
            bloom: '0.8',
            speed: '2',
            tilt: '40',
            particles: '60000',
            renderer: 'cpu',
            sensitivity: '1.5',
            'no-pointer': '',
            'no-rotate': '',
        }));
        expect(options).toEqual({
            look: { ...LOOK_DEFAULTS, colors: ['#ff0000', '#00ff00', '#0000ff'], background: '#111111', style: 'solid', bloom: 0.8 },
            speed: 2,
            tilt: 40,
            particles: 60000,
            backend: 'cpu',
            sensitivity: 1.5,
            interactive: false,
            autoRotate: false,
        });
    });

    it('treats a bare bloom attribute as a sensible default strength', () => {
        expect(readOptions(reader({ bloom: '' })).look.bloom).toBe(0.6);
    });

    it('ignores bad values instead of breaking the page', () => {
        const options = readOptions(reader({ colors: 'red', background: 'nope', speed: 'fast', renderer: 'quantum', tilt: '500' }));
        expect(options.look.colors).toEqual(LOOK_DEFAULTS.colors);
        expect(options.look.background).toBe(LOOK_DEFAULTS.background);
        expect(options.speed).toBe(1);
        expect(options.backend).toBe('auto');
        expect(options.tilt).toBe(90);
    });
});

describe('parseColors', () => {
    it('accepts spaces or commas, 3- or 6-digit hex, and normalizes to #rrggbb', () => {
        expect(parseColors('#f00, #00FF00,#00f')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    });

    it('stretches one or two colors to three', () => {
        expect(parseColors('#abcdef')).toEqual(['#abcdef', '#abcdef', '#abcdef']);
        expect(parseColors('#000000 #ffffff')).toEqual(['#000000', '#808080', '#ffffff']);
        expect(parseColors('#000 #fff')).toEqual(['#000000', '#808080', '#ffffff']);
    });

    it('rejects anything that is not 1–3 hex colors', () => {
        expect(parseColors('red')).toBeUndefined();
        expect(parseColors('#000 #111 #222 #333')).toBeUndefined();
        expect(parseColors('')).toBeUndefined();
    });
});

describe('markup', () => {
    const galaxy = [
        '<nano-swarm title="Galaxy" colors="#ff3d00 #ff9100 #ffe57f" solid tilt="40">',
        '  R = 0.4 + 5 * (v / TAU)^1.5',
        '  x = R * cos(u)',
        '  y = 0',
        '  z = R * sin(u)',
        '</nano-swarm>',
    ].join('\n');

    it('parses attributes and the formula', () => {
        expect(parseMarkup(galaxy)).toEqual({
            attributes: [['title', 'Galaxy'], ['colors', '#ff3d00 #ff9100 #ffe57f'], ['solid', ''], ['tilt', '40']],
            formula: 'R = 0.4 + 5 * (v / TAU)^1.5\nx = R * cos(u)\ny = 0\nz = R * sin(u)',
        });
    });

    it('formats back to the same HTML', () => {
        expect(formatMarkup(parseMarkup(galaxy))).toBe(galaxy);
    });

    it('pulls the element out of a whole page, exactly as written', () => {
        // Example files are pages you can open; the AI docs quote the element from them.
        const page = `<!doctype html>\n<html>\n<head>\n<script src="https://x/nano-swarm.js"></script>\n</head>\n<body>\n${galaxy}\n</body>\n</html>\n`;
        expect(extractElement(page)).toBe(galaxy);
    });

    it('says so when there is no element to pull out', () => {
        expect(() => extractElement('<p>nothing here</p>')).toThrow('No <nano-swarm> element found');
    });

    it('puts each attribute on its own line when the tag would be too long, and reads it back', () => {
        const markup = {
            attributes: [['title', 'Lorenz'], ['colors', '#1a237e #4fc3f7 #ff4081'], ['background', '#02040a'], ['speed', '2.5']],
            formula: 'dx = 1\ndy = 1\ndz = 1',
        } as SwarmMarkup;
        const html = formatMarkup(markup);
        expect(html.split('\n').slice(0, 5)).toEqual([
            '<nano-swarm',
            '    title="Lorenz"',
            '    colors="#1a237e #4fc3f7 #ff4081"',
            '    background="#02040a"',
            '    speed="2.5">',
        ]);
        expect(parseMarkup(html)).toEqual(markup);
    });

    it('orders attributes the same way every time', () => {
        expect(formatMarkup({ attributes: [['solid', ''], ['title', 'A'], ['colors', '#000']], formula: '' }))
            .toBe('<nano-swarm title="A" colors="#000" solid></nano-swarm>');
    });

    it('escapes what HTML needs escaped, and reads it back', () => {
        const markup = { attributes: [['title', 'Tom & "Jerry" <3']] as [AttributeName, string][], formula: '# a < b & c > d\nx = 1\ny = 2\nz = 3' };
        const html = formatMarkup(markup);
        expect(html).toContain('title="Tom &amp; &quot;Jerry&quot; &lt;3"');
        expect(html).toContain('# a &lt; b &amp; c &gt; d');
        expect(parseMarkup(html)).toEqual(markup);
    });

    it('keeps only the documented attributes (share links and pasted HTML are untrusted)', () => {
        const parsed = parseMarkup('<nano-swarm title="ok" onclick="alert(1)" style="x" colors=\'#000\'>x = 1</nano-swarm>');
        expect(parsed.attributes).toEqual([['title', 'ok'], ['colors', '#000']]);
        for (const [name] of parsed.attributes) expect(Object.hasOwn(ATTRIBUTES, name)).toBe(true);
    });

    it('finds the element inside a larger page and fails clearly without one', () => {
        expect(parseMarkup(`<p>hi</p>\n${galaxy}\n<p>bye</p>`).attributes[0]).toEqual(['title', 'Galaxy']);
        expect(() => parseMarkup('<div></div>')).toThrow(/No <nano-swarm>/);
    });
});

describe('dedent', () => {
    it('removes shared indentation and surrounding blank lines only', () => {
        expect(dedent('\n    a = 1\n      b = 2\n\n    c = 3\n  ')).toBe('a = 1\n  b = 2\n\nc = 3');
    });
});

describe('H5 · ">" in attributes and formulas', () => {
    it('a title with ">" survives format → parse', () => {
        const markup = { attributes: [['title', 'a > b']] as [AttributeName, string][], formula: 'x = u\ny = 0\nz = 0' };
        const html = formatMarkup(markup);
        expect(html).toContain('title="a &gt; b"');
        expect(parseMarkup(html)).toEqual(markup);
    });

    it('a formula with ">" survives format → parse', () => {
        const markup = { attributes: [] as [AttributeName, string][], formula: 'x = u > 1 ? 1 : 0\ny = 0\nz = 0' };
        expect(parseMarkup(formatMarkup(markup))).toEqual(markup);
    });

    it('a hand-written title="a > b" is read whole, not cut at the first ">"', () => {
        const parsed = parseMarkup('<nano-swarm title="a > b" solid>\n  x = u\n  y = 0\n  z = 0\n</nano-swarm>');
        expect(parsed.attributes).toEqual([['title', 'a > b'], ['solid', '']]);
        expect(parsed.formula).toBe('x = u\ny = 0\nz = 0');
    });
});
