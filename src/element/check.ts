/**
 * Validate a <nano-swarm> without a browser: attributes, formula and (for
 * motions) whether the motion has an attractor to draw. Used by the check
 * CLI shipped in the AI skill, by CI on the examples, and by the
 * playground's "Paste HTML". Pure: no DOM, no three.js.
 */
import { checkFormula } from '../formula';
import { calibrateFlow, FlowError } from '../sources/flow';
import { HEX_RE, NUMBER_RANGES, parseColors, parseMarkup, type AttributeName, type SwarmMarkup } from './markup';

export interface CheckResult {
    /** No errors (warnings are allowed). */
    ok: boolean;
    title: string | null;
    /** What it is and what it reacts to, e.g. ["motion", "sets its own colors"]. */
    summary: string[];
    errors: string[];
    warnings: string[];
}

const BOOLEAN_ATTRIBUTES: AttributeName[] = ['solid', 'no-pointer', 'no-rotate'];

export function checkMarkup(markup: SwarmMarkup): CheckResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];
    const attr = new Map(markup.attributes);

    // Attributes: anything that would silently fall back to a default is an error.
    const colors = attr.get('colors');
    if (colors !== undefined && !parseColors(colors)) {
        errors.push(`colors="${colors}" must be 1–3 hex colors, e.g. colors="#ff3d00 #ff9100 #ffe57f"`);
    }
    const background = attr.get('background');
    if (background !== undefined && !HEX_RE.test(background.trim())) {
        errors.push(`background="${background}" must be a hex color, e.g. background="#03040a"`);
    }
    const renderer = attr.get('renderer');
    if (renderer !== undefined && renderer !== 'gpu' && renderer !== 'cpu') {
        errors.push(`renderer="${renderer}" must be "gpu" or "cpu" (leave it out for automatic)`);
    }
    for (const [name, [min, max]] of Object.entries(NUMBER_RANGES) as [keyof typeof NUMBER_RANGES, readonly [number, number]][]) {
        const value = attr.get(name);
        if (value === undefined || (name === 'bloom' && value === '')) continue;
        const n = Number(value);
        if (value.trim() === '' || !Number.isFinite(n)) errors.push(`${name}="${value}" must be a number`);
        else if (n < min || n > max) warnings.push(`${name}="${value}" is outside ${min}–${max} and will be clamped`);
    }
    for (const name of BOOLEAN_ATTRIBUTES) {
        const value = attr.get(name);
        if (value) warnings.push(`${name} is on/off — write just "${name}" (its value "${value}" is ignored)`);
    }

    // Source: a model file, or the formula.
    const model = attr.get('model');
    let listens = false;
    if (model !== undefined) {
        summary.push(`model ${model}`);
        if (markup.formula.trim()) warnings.push('the formula is ignored because model is set');
    } else if (!markup.formula.trim()) {
        summary.push('shape');
        warnings.push('the formula is empty, so the default sphere is shown');
    } else {
        const result = checkFormula(markup.formula);
        if (!result.ok) {
            errors.push(`formula ${result.error.message}`);
        } else {
            const { kind, usesTime, usesAudio, hasColor } = result.formula.program;
            listens = usesAudio;
            summary.push(kind);
            if (usesTime) summary.push('reacts to time');
            if (usesAudio) summary.push('reacts to sound');
            if (hasColor) summary.push('sets its own colors');
            if (kind === 'motion') {
                try {
                    calibrateFlow(result.formula);
                } catch (error) {
                    if (!(error instanceof FlowError)) throw error;
                    errors.push(error.message);
                }
            }
        }
    }
    if (attr.has('animation') && model === undefined) warnings.push('animation is ignored without a model');
    if (attr.has('audio') && !listens && errors.length === 0) {
        warnings.push('audio is set, but the formula never reads bass, mid, treble, level or spectrum(k)');
    }

    return { ok: errors.length === 0, title: attr.get('title') ?? null, summary, errors, warnings };
}

/** Check an HTML string (a file, a paste): it must contain one <nano-swarm>. */
export function checkHtml(html: string): CheckResult {
    let markup: SwarmMarkup;
    try {
        markup = parseMarkup(html);
    } catch {
        return { ok: false, title: null, summary: [], errors: ['no <nano-swarm>…</nano-swarm> element found'], warnings: [] };
    }
    return checkMarkup(markup);
}
