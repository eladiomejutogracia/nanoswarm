import { describe, expect, it } from 'vitest';
import type { SwarmMarkup } from '../src/element/markup';
import { decodeShare, encodeShare } from '../web/share';

const galaxy: SwarmMarkup = {
    attributes: [['title', 'Mi galaxia ñ → π'], ['colors', '#ff3d00 #ff9100 #ffe57f'], ['solid', '']],
    formula: '# comentario con < y &\nx = cos(u) * 2^3\ny = sin(v)\nz = 0',
};

describe('share links', () => {
    it('round-trip a creation, unicode and all', () => {
        expect(decodeShare(`#${encodeShare(galaxy)}`)).toEqual(galaxy);
    });

    it('are URL-safe', () => {
        expect(encodeShare(galaxy)).toMatch(/^swarm=[A-Za-z0-9_-]+$/);
    });

    it('drop attributes that are not part of the vocabulary', () => {
        const html = '<nano-swarm title="x" onclick="alert(1)">x = 1\ny = 1\nz = 1</nano-swarm>';
        const hash = `#swarm=${btoa(html).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        expect(decodeShare(hash)?.attributes).toEqual([['title', 'x']]);
    });

    it('ignore missing, broken or oversized links', () => {
        expect(decodeShare('')).toBeNull();
        expect(decodeShare('#other=1')).toBeNull();
        expect(decodeShare('#swarm=%%%')).toBeNull();
        expect(decodeShare('#swarm=_w')).toBeNull(); // invalid UTF-8
        expect(decodeShare(`#${encodeShare({ attributes: [], formula: 'x'.repeat(9000) })}`)).toBeNull();
    });
});
