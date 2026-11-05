/**
 * The first thirty seconds: what a visitor reads before anything runs.
 *
 * These files are not generated, so nothing else stops them from drifting —
 * a README snippet that no longer compiles, an example that shows plain text
 * when you open it, or a social card pointing at an image that isn't deployed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkHtml } from '../src/element/check';
import { parseMarkup } from '../src/element/markup';
import { SCRIPT_URL, SITE_URL } from '../src/ai/reference';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const readme = read('README.md');
const indexHtml = read('web/index.html');
const previewHtml = read('web/public/preview.html');

const htmlBlocks = [...readme.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]);

// Same loader as the playground and the gallery, so all three read the very same files.
const files = import.meta.glob('../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples = Object.entries(files).map(([path, html]) => [path.split('/').slice(-2).join('/'), html] as const);

describe('README', () => {
    it('shows at least one <nano-swarm>', () => {
        expect(htmlBlocks.length).toBeGreaterThan(0);
    });

    it.each(htmlBlocks.map((html, i) => [i, html] as const))('snippet %i passes the checker', (_, html) => {
        const result = checkHtml(html);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('gives its first snippet a height, so copying it literally fills the page', () => {
        // Without a height the element falls back to 240px and the result looks nothing like the picture.
        expect(htmlBlocks[0]).toMatch(/height:\s*100vh/);
    });

    it('shows the same creation as the header image', () => {
        // The picture is a screenshot of web/public/preview.html: same attributes, same formula.
        expect(parseMarkup(htmlBlocks[0])).toEqual(parseMarkup(previewHtml));
    });

    it('points at the header image where it is deployed from', () => {
        expect(readme).toContain('(web/public/preview.jpg)');
    });
});

describe('examples', () => {
    it.each(examples)('%s is a page a browser can open', (_, html) => {
        expect(html.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain(`<script src="${SCRIPT_URL}"></script>`);
        expect(html).toContain('<meta name="viewport"'); // or phones render it at 980px
        expect(html).toMatch(/nano-swarm \{ height: 100vh \}/); // or it is a 240px strip
    });
});

describe('the playground page', () => {
    it('has a title that says what NanoSwarm is', () => {
        const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1] ?? '';
        expect(title.startsWith('NanoSwarm')).toBe(true);
        expect(title.length).toBeGreaterThan('NanoSwarm'.length + 20);
    });

    it.each(['og:title', 'og:description', 'og:image', 'og:url', 'og:type'])('has a %s, so shared links are not a grey line', (name) => {
        expect(indexHtml).toContain(`property="${name}"`);
    });

    it('asks for a large image card', () => {
        expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
    });

    it('builds its absolute addresses on SITE_URL', () => {
        for (const url of [...indexHtml.matchAll(/(?:content|href)="(https:\/\/eladiomejutogracia[^"]*)"/g)].map((m) => m[1])) {
            expect(url.startsWith(SITE_URL)).toBe(true);
        }
        expect(indexHtml).toContain(`content="${SITE_URL}preview.jpg"`);
        expect(indexHtml).toContain(`href="${SITE_URL}"`);
    });

    it('serves the card image from web/public, so it is actually deployed', () => {
        expect(() => readFileSync(new URL('../web/public/preview.jpg', import.meta.url))).not.toThrow();
    });

    it('links out: the code, the docs, the licence, the author and the AI skill', () => {
        for (const href of [
            'https://github.com/eladiomejutogracia/nanoswarm',
            'https://github.com/eladiomejutogracia/nanoswarm#readme',
            'https://github.com/eladiomejutogracia/nanoswarm/blob/main/LICENSE',
            'https://github.com/eladiomejutogracia',
            './nanoswarm-skill.zip',
        ]) {
            expect(indexHtml).toContain(`href="${href}"`);
        }
    });

    it('credits the fox on the page, because CC BY 4.0 requires it', () => {
        expect(indexHtml).toContain('https://creativecommons.org/licenses/by/4.0/');
        expect(indexHtml).toContain('PixelMannen');
    });
});
