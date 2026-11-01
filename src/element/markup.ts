/**
 * The <nano-swarm> vocabulary, as plain data — no DOM, so it is testable and
 * shared by the element, the playground's code panel, example files and
 * share links.
 *
 *   <nano-swarm title="Galaxy" colors="#ff3d00 #ff9100 #ffe57f" solid>
 *     x = …            ← the formula is the element's text
 *   </nano-swarm>
 */
import type { BackendPreference } from '../backends/select';
import { LOOK_DEFAULTS, type Look } from '../looks';

/** Every attribute the element understands (plus the standard `title`). */
export const ATTRIBUTES = {
    title: 'A name for this creation',
    model: 'A 3D model to use instead of a formula (.glb .gltf .obj .stl .ply): a file path or a URL (another site must allow CORS). Animated .glb/.gltf files move',
    animation: 'Which animation of an animated model to play, by name (default: the first)',
    colors: 'Up to three colors, bottom → top (or c = 0 → 1)',
    background: 'Background color',
    solid: 'Opaque, shaded particles instead of glowing ones',
    bloom: 'Glow around bright areas (GPU only). Optionally a strength, e.g. bloom="0.8"',
    speed: 'Pace: 1 normal, 2 twice as fast, 0.5 half',
    tilt: 'Camera height in degrees: 0 side view, 90 top-down',
    particles: 'How many particles (default: chosen for the device)',
    audio: 'An audio file URL, or "mic". Starts on the first click',
    sensitivity: 'How strongly sound moves things (default 1)',
    renderer: '"gpu" or "cpu" (default: automatic)',
    'no-pointer': 'The pointer does not push particles',
    'no-rotate': 'The camera does not orbit on its own',
} as const;
export type AttributeName = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTES) as AttributeName[];

export const DEFAULT_BLOOM = 0.6;
/** Accepted range of each numeric attribute; values outside are clamped. */
export const NUMBER_RANGES = {
    speed: [0, 10],
    tilt: [0, 90],
    particles: [1, 1e7],
    sensitivity: [0, 5],
    bloom: [0, 3],
} as const satisfies Partial<Record<AttributeName, readonly [number, number]>>;
export const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Longest opening tag kept on one line when formatting. */
const MAX_TAG_LINE = 80;

/** Options the element passes to the swarm, read from its attributes. */
export interface ElementOptions {
    look: Look;
    speed: number;
    tilt?: number;
    particles?: number;
    backend: BackendPreference;
    sensitivity: number;
    interactive: boolean;
    autoRotate: boolean;
}

export type AttributeReader = (name: AttributeName) => string | null;

function number(value: string | null, name: keyof typeof NUMBER_RANGES): number | undefined {
    if (value === null || value.trim() === '') return undefined;
    const n = Number(value);
    const [min, max] = NUMBER_RANGES[name];
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

function hex6(color: string): string {
    const h = color.slice(1);
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

function midpoint(a: string, b: string): string {
    const pa = hex6(a), pb = hex6(b);
    const channel = (i: number) =>
        Math.round((parseInt(pa.slice(i, i + 2), 16) + parseInt(pb.slice(i, i + 2), 16)) / 2)
            .toString(16).padStart(2, '0');
    return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * "#f00 #0f0 #00f" (spaces or commas) → three "#rrggbb" colors (the form
 * <input type="color"> expects). One or two colors are stretched to three.
 */
export function parseColors(value: string | null): [string, string, string] | undefined {
    if (!value) return undefined;
    const colors = value.split(/[\s,]+/).filter(Boolean);
    if (colors.length === 0 || colors.length > 3 || !colors.every((c) => HEX_RE.test(c))) return undefined;
    const [a, b, c] = colors.map((color) => hex6(color).toLowerCase());
    if (colors.length === 1) return [a, a, a];
    if (colors.length === 2) return [a, midpoint(a, b), b];
    return [a, b, c];
}

/** Turn attributes into swarm options. Bad values fall back to defaults instead of breaking the page. */
export function readOptions(get: AttributeReader): ElementOptions {
    const background = get('background');
    const bloom = get('bloom');
    const renderer = get('renderer');
    return {
        look: {
            ...LOOK_DEFAULTS,
            colors: parseColors(get('colors')) ?? LOOK_DEFAULTS.colors,
            background: background && HEX_RE.test(background.trim()) ? hex6(background.trim()).toLowerCase() : LOOK_DEFAULTS.background,
            style: get('solid') !== null ? 'solid' : 'light',
            bloom: bloom === null ? 0 : (number(bloom, 'bloom') ?? DEFAULT_BLOOM),
        },
        speed: number(get('speed'), 'speed') ?? 1,
        tilt: number(get('tilt'), 'tilt'),
        particles: number(get('particles'), 'particles'),
        backend: renderer === 'gpu' || renderer === 'cpu' ? renderer : 'auto',
        sensitivity: number(get('sensitivity'), 'sensitivity') ?? 1,
        interactive: get('no-pointer') === null,
        autoRotate: get('no-rotate') === null,
    };
}

// ─── Markup ──────────────────────────────────────────────────────

/** A <nano-swarm> as data: its attributes in order, and its formula text. */
export interface SwarmMarkup {
    attributes: [AttributeName, string][];
    formula: string;
}

const escapeAttribute = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = (v: string) => v
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Remove common indentation and surrounding blank lines. */
export function dedent(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
    return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/** Pretty HTML for a <nano-swarm>: attributes in a stable order, formula indented. */
export function formatMarkup({ attributes, formula }: SwarmMarkup): string {
    const order = (name: AttributeName) => ATTRIBUTE_NAMES.indexOf(name);
    const parts = [...attributes]
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([name, value]) => (value === '' ? name : `${name}="${escapeAttribute(value)}"`));
    // One line while it fits; otherwise one attribute per line, so none hides off-screen.
    const oneLine = parts.map((part) => ` ${part}`).join('');
    const attrs = `<nano-swarm${oneLine}>`.length <= MAX_TAG_LINE
        ? oneLine
        : parts.map((part) => `\n    ${part}`).join('');
    const body = dedent(formula);
    if (!body) return `<nano-swarm${attrs}></nano-swarm>`;
    const content = body.split('\n').map((line) => (line ? `  ${escapeText(line)}` : '')).join('\n');
    return `<nano-swarm${attrs}>\n${content}\n</nano-swarm>`;
}

const ELEMENT_RE = /<nano-swarm\b([^>]*)>([\s\S]*?)<\/nano-swarm>/i;
const ATTRIBUTE_RE = /([a-z][a-z-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi;

/**
 * Read a <nano-swarm> out of an HTML string (an example file, a share link).
 * Unknown attributes are dropped — only the documented vocabulary survives.
 */
export function parseMarkup(html: string): SwarmMarkup {
    const match = ELEMENT_RE.exec(html);
    if (!match) throw new Error('[NanoSwarm] No <nano-swarm> element found.');
    const attributes: [AttributeName, string][] = [];
    for (const [, name, double, single, bare] of match[1].matchAll(ATTRIBUTE_RE)) {
        const key = name.toLowerCase();
        if (!Object.hasOwn(ATTRIBUTES, key) || attributes.some(([n]) => n === key)) continue;
        attributes.push([key as AttributeName, unescape(double ?? single ?? bare ?? '')]);
    }
    return { attributes, formula: dedent(unescape(match[2])) };
}
