/**
 * A share link is just the <nano-swarm> HTML, base64url-encoded in the hash.
 * Decoding never trusts it: it goes through parseMarkup, which keeps only
 * the documented attributes, and the formula still goes through the parser.
 */
import { formatMarkup, parseMarkup, type SwarmMarkup } from '../src';

const KEY = 'swarm';
const MAX_LENGTH = 8000;

function toBase64Url(text: string): string {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string | null {
    try {
        const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

export function encodeShare(markup: SwarmMarkup): string {
    return `${KEY}=${toBase64Url(formatMarkup(markup))}`;
}

/** The creation in a share hash, or null if there is none (or it is broken). */
export function decodeShare(hash: string): SwarmMarkup | null {
    const encoded = new URLSearchParams(hash.replace(/^#/, '')).get(KEY);
    if (!encoded || encoded.length > MAX_LENGTH * 2) return null;
    const html = fromBase64Url(encoded);
    if (html === null || html.length > MAX_LENGTH) return null;
    try {
        return parseMarkup(html);
    } catch {
        return null;
    }
}
