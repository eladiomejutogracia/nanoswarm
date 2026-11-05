/**
 * Code generation from a validated formula AST.
 *
 * - JS:   a batch evaluator `(out, colors, params, count, frame, points?)` for the CPU.
 * - GLSL: `nsFormula` (shapes) or `nsMotion` (motions) for the GPU backend,
 *         so formulas run entirely on the graphics card.
 *
 * Shape formulas write positions into `out`. Motion formulas read each
 * point's current position from `points` and write its velocity into `out`.
 *
 * Both are generated only from AST nodes whose identifiers were whitelisted
 * by the parser, so the user's text never reaches `new Function` or the
 * shader compiler verbatim. Both share the same semantics: GLSL-style `mod`,
 * `fract`, `step`, sign-aware `pow`, integer-hash `noise`, and non-finite
 * results collapse to 0 — judged as float32, so 1e30 * 1e10 (which a float32 can't
 * hold) collapses to 0 on the CPU exactly as it does on the GPU. Literals are float32
 * constants (see float32.ts) and every local is rounded to float32, as on the GPU.
 *
 * Color: if the formula assigns `c`, it is clamped to [0, 1] and picks the
 * particle's color along the palette. Otherwise the color slot is NO_COLOR
 * and the renderer colors it bottom → top.
 */
import { SPECTRUM_BINS } from '../audio/bands';
import { float32Constant, float32Text } from './float32';
import { NOISE_GLSL, valueNoise3 } from './noise';
import type { Expr, FunctionName, Program } from './parse';

/** Color slot value meaning "the formula did not choose a color". */
export const NO_COLOR = -1;

/** Per-frame values a formula reads (everything that is not per-particle). */
export interface FormulaFrame {
    t: number;
    bass: number;
    mid: number;
    treble: number;
    level: number;
    spectrum: Float32Array;
}

/**
 * Evaluate `count` particles. `out` receives xyz triplets (positions for a
 * shape, velocities for a motion); `colors` (if given and the formula sets
 * `c`) receives one palette position per particle. Motions also need the
 * current `points`.
 */
export type BatchEvaluator = (
    out: Float32Array,
    colors: Float32Array | null,
    params: Float32Array,
    count: number,
    frame: FormulaFrame,
    points?: Float32Array,
) => void;

// ─── JavaScript ─────────────────────────────────────────────────────

/** Runtime helpers that mirror GLSL built-ins exactly. */
export const JS_HELPERS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos,
    atan: (a: number, b?: number) => (b === undefined ? Math.atan(a) : Math.atan2(a, b)),
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, log: Math.log,
    floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
    fract: (x: number) => x - Math.floor(x),
    min: Math.min, max: Math.max,
    pow: signedPow,
    mod: (x: number, y: number) => x - y * Math.floor(x / y),
    step: (edge: number, x: number) => (x < edge ? 0 : 1),
    clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    mix: (a: number, b: number, k: number) => a + (b - a) * k,
    smoothstep: (e0: number, e1: number, x: number) => {
        const k = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
        return k * k * (3 - 2 * k);
    },
    noise: valueNoise3,
} satisfies Record<Exclude<FunctionName, 'spectrum'>, (...args: number[]) => number>;

/** spectrum(k): linear interpolation over the log-spaced spectrum slices, k clamped to [0, 1]. */
export function sampleSpectrum(spectrum: Float32Array, k: number): number {
    const n = spectrum.length;
    if (n === 0 || !(k === k)) return 0; // empty, or NaN
    const x = Math.min(Math.max(k, 0), 1) * (n - 1);
    const i = Math.floor(x);
    const j = Math.min(i + 1, n - 1);
    return spectrum[i] + (spectrum[j] - spectrum[i]) * (x - i);
}

/** `pow` that keeps the sign for negative bases with integer exponents: (-2)^3 = -8. */
export function signedPow(base: number, exp: number): number {
    if (base < 0 && Number.isInteger(exp)) {
        const magnitude = Math.pow(-base, exp);
        return exp % 2 === 0 ? magnitude : -magnitude;
    }
    return Math.pow(base, exp);
}

const JS_BINARY: Record<string, string> = { '+': '+', '-': '-', '*': '*', '/': '/' };

function jsExpr(e: Expr): string {
    switch (e.kind) {
    case 'num': return `(${float32Constant(e.value)})`;
    case 'input': return e.name;
    case 'local': return `l_${e.name}`;
    case 'neg': return `(-${jsExpr(e.arg)})`;
    case 'bin':
        if (e.op === '^') return `H.pow(${jsExpr(e.left)}, ${jsExpr(e.right)})`;
        return `(${jsExpr(e.left)} ${JS_BINARY[e.op]} ${jsExpr(e.right)})`;
    case 'call':
        if (e.fn === 'spectrum') return `SP(S, ${jsExpr(e.args[0])})`;
        return `H.${e.fn}(${e.args.map(jsExpr).join(', ')})`;
    }
}

export function toJavaScriptSource(program: Program): string {
    const body = program.statements
        .map((s) => `        const l_${s.name} = fr(${jsExpr(s.expr)});`)
        .join('\n');
    const color = program.hasColor
        ? `        if (C !== null) { const c = Math.fround(l_c); C[i] = Number.isFinite(c) ? (c < 0 ? 0 : c > 1 ? 1 : c) : 0; }\n`
        : '';

    const motion = program.kind === 'motion';
    const read = motion
        ? 'const x = P[i3], y = P[i3 + 1], z = P[i3 + 2], r = params[i3 + 2];'
        : 'const u = params[i3], v = params[i3 + 1], r = params[i3 + 2];';
    const [ox, oy, oz] = motion ? ['l_dx', 'l_dy', 'l_dz'] : ['l_x', 'l_y', 'l_z'];

    return `"use strict";
return function nsFormula(out, C, params, count, f, P) {
    const fr = Math.fround;
    const t = fr(f.t), bass = fr(f.bass), mid = fr(f.mid), treble = fr(f.treble), level = fr(f.level), S = f.spectrum;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        ${read}
${body}
        const ox = Math.fround(${ox}), oy = Math.fround(${oy}), oz = Math.fround(${oz});
        out[i3]     = Number.isFinite(ox) ? ox : 0;
        out[i3 + 1] = Number.isFinite(oy) ? oy : 0;
        out[i3 + 2] = Number.isFinite(oz) ? oz : 0;
${color}    }
};`;
}

export function toJavaScript(program: Program): BatchEvaluator {
    // Safe: the source is generated from whitelisted AST nodes only (see parse.ts).
    const factory = new Function('H', 'SP', toJavaScriptSource(program)) as (
        h: typeof JS_HELPERS,
        sp: typeof sampleSpectrum,
    ) => BatchEvaluator;
    return factory(JS_HELPERS, sampleSpectrum);
}

// ─── GLSL ───────────────────────────────────────────────────────────

/** Helpers every generated GLSL formula relies on. Include once per shader. */
export const GLSL_PRELUDE = /* glsl */ `
uniform float uSpectrum[${SPECTRUM_BINS}];
float nsSpectrum(float k) {
    float x = clamp(k, 0.0, 1.0) * ${SPECTRUM_BINS - 1}.0;
    int i = clamp(int(floor(x)), 0, ${SPECTRUM_BINS - 1}); // also tames NaN
    int j = min(i + 1, ${SPECTRUM_BINS - 1});
    return mix(uSpectrum[i], uSpectrum[j], x - float(i));
}
float nsPow(float b, float e) {
    if (b < 0.0 && floor(e) == e) {
        float m = pow(-b, e);
        return mod(e, 2.0) == 0.0 ? m : -m;
    }
    return pow(b, e);
}
// Checks the exponent bits instead of calling isnan/isinf: fast-math shader
// compilers (ANGLE → HLSL on Windows) may assume NaN never happens and
// delete those calls, letting a NaN target swallow particles forever.
float nsFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u ? 0.0 : x; }
${NOISE_GLSL}`;

/** A float literal the shader reads as the very float32 the CPU uses. Throws rather than emit one it cannot hold. */
export function glslNumber(value: number): string {
    const text = float32Text(value);
    return /[.eE]/.test(text) ? text : `${text}.0`;
}

function glslExpr(e: Expr): string {
    switch (e.kind) {
    case 'num': return `(${glslNumber(e.value)})`;
    case 'input': return `in_${e.name}`;
    case 'local': return `l_${e.name}`;
    case 'neg': return `(-${glslExpr(e.arg)})`;
    case 'bin':
        if (e.op === '^') return `nsPow(${glslExpr(e.left)}, ${glslExpr(e.right)})`;
        return `(${glslExpr(e.left)} ${e.op} ${glslExpr(e.right)})`;
    case 'call': {
        const args = e.args.map(glslExpr).join(', ');
        if (e.fn === 'pow') return `nsPow(${args})`;
        if (e.fn === 'spectrum') return `nsSpectrum(${args})`;
        if (e.fn === 'noise') return `nsNoise(vec3(${args}))`;
        return `${e.fn}(${args})`;
    }
    }
}

/**
 * Shapes:  `vec4 nsFormula(vec3 p, float t, vec4 audio)` → (x, y, z, color)
 * Motions: `vec4 nsMotion(vec3 pos, vec3 p, float t, vec4 audio)` → (dx, dy, dz, color)
 * where p = (u, v, r) and audio = (bass, mid, treble, level). Color is in
 * [0, 1], or NO_COLOR if the formula has no `c`. Requires GLSL_PRELUDE.
 */
export function toGLSL(program: Program): string {
    const body = program.statements
        .map((s) => `    float l_${s.name} = ${glslExpr(s.expr)};`)
        .join('\n');
    const color = program.hasColor ? 'clamp(nsFinite(l_c), 0.0, 1.0)' : `${NO_COLOR}.0`;
    const shared = 'float in_r = p.z; float in_t = t;\n'
        + '    float in_bass = audio.x; float in_mid = audio.y; float in_treble = audio.z; float in_level = audio.w;';

    if (program.kind === 'motion') {
        return /* glsl */ `
vec4 nsMotion(vec3 pos, vec3 p, float t, vec4 audio) {
    float in_x = pos.x; float in_y = pos.y; float in_z = pos.z;
    ${shared}
${body}
    return vec4(nsFinite(l_dx), nsFinite(l_dy), nsFinite(l_dz), ${color});
}
`;
    }
    return /* glsl */ `
vec4 nsFormula(vec3 p, float t, vec4 audio) {
    float in_u = p.x; float in_v = p.y;
    ${shared}
${body}
    return vec4(nsFinite(l_x), nsFinite(l_y), nsFinite(l_z), ${color});
}
`;
}
