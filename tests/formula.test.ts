import { describe, expect, it } from 'vitest';
import { checkFormula, compileFormula, FormulaError } from '../src/formula';
import { JS_HELPERS, NO_COLOR, sampleSpectrum, signedPow } from '../src/formula/emit';
import { latticeHash, NOISE_GLSL, valueNoise3 } from '../src/formula/noise';

/** Evaluate a formula for a single particle and return [x, y, z]. */
function run(
    source: string,
    inputs: Partial<Record<'u' | 'v' | 'r' | 't' | 'bass' | 'mid' | 'treble' | 'level', number>> = {},
    spectrum = new Float32Array(64),
): number[] {
    const f = compileFormula(source);
    const out = new Float32Array(3);
    const params = new Float32Array([inputs.u ?? 0, inputs.v ?? 0, inputs.r ?? 0]);
    f.evaluate(out, null, params, 1, {
        t: inputs.t ?? 0, bass: inputs.bass ?? 0, mid: inputs.mid ?? 0,
        treble: inputs.treble ?? 0, level: inputs.level ?? 0, spectrum,
    });
    return Array.from(out);
}

const xyz = (x: string, y = '0', z = '0') => `x = ${x}\ny = ${y}\nz = ${z}`;

function errorOf(source: string): FormulaError {
    const result = checkFormula(source);
    if (result.ok) throw new Error(`Expected "${source}" to fail`);
    return result.error;
}

describe('formula evaluation', () => {
    it('evaluates x, y, z from per-particle inputs', () => {
        expect(run(xyz('u', 'v', 'r'), { u: 1, v: 2, r: 0.5 })).toEqual([1, 2, 0.5]);
    });

    it('supports locals, comments and semicolons', () => {
        const source = `
            # radius grows with the bass
            R = 2 + bass   // inline comment too
            x = R; y = R * 2; z = -R
        `;
        expect(run(source, { bass: 1 })).toEqual([3, 6, -3]);
    });

    it.each([
        ['2 + 3 * 4', 14],
        ['(2 + 3) * 4', 20],
        ['-2^2', -4],
        ['2^3^2', 512],
        ['2^-1', 0.5],
        ['2**3', 8],
        ['10 / 4 / 5', 0.5],
        ['- -3', 3],
        ['.5 + 1e1', 10.5],
    ])('respects precedence: %s = %d', (expr, expected) => {
        expect(run(xyz(expr))[0]).toBeCloseTo(expected);
    });

    it('exposes constants', () => {
        expect(run(xyz('PI', 'TAU', 'E'))).toEqual([Math.fround(Math.PI), Math.fround(Math.PI * 2), Math.fround(Math.E)]);
    });

    it('collapses non-finite results to 0', () => {
        expect(run(xyz('1/0', 'sqrt(-1)', 'log(0)'))).toEqual([0, 0, 0]);
    });

    it('evaluates many particles in one batch', () => {
        const f = compileFormula(xyz('u * 2', 'v + t', 'r'));
        const params = new Float32Array([1, 0, 0, 2, 1, 0, 3, 2, 1]);
        const out = new Float32Array(9);
        f.evaluate(out, null, params, 3, { t: 10, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) });
        expect(Array.from(out)).toEqual([2, 10, 0, 4, 11, 0, 6, 12, 1]);
    });

    it('flags animation only when time or audio is used', () => {
        expect(compileFormula(xyz('u')).animated).toBe(false);
        expect(compileFormula(xyz('u + t')).animated).toBe(true);
        expect(compileFormula(xyz('u * level')).animated).toBe(true);
        expect(compileFormula(xyz('u * bass')).program.usesAudio).toBe(true);
    });
});

describe('GLSL-compatible helpers', () => {
    it('mod and fract follow GLSL for negative numbers', () => {
        expect(JS_HELPERS.mod(-1, 3)).toBe(2);
        expect(JS_HELPERS.fract(-0.25)).toBe(0.75);
    });

    it('pow keeps the sign for negative bases with integer exponents', () => {
        expect(signedPow(-2, 3)).toBe(-8);
        expect(signedPow(-2, 2)).toBe(4);
        expect(run(xyz('(-2)^3'))[0]).toBe(-8);
    });

    it('atan takes one or two arguments', () => {
        expect(run(xyz('atan(1)', 'atan(1, -1)'))).toEqual([Math.fround(Math.PI / 4), Math.fround((3 * Math.PI) / 4), 0]);
    });

    it('step, clamp, mix, smoothstep', () => {
        expect(run(xyz('step(0.5, 0.7)', 'clamp(5, 0, 2)', 'mix(0, 10, 0.25)'))).toEqual([1, 2, 2.5]);
        expect(run(xyz('smoothstep(0, 1, 0.5)'))[0]).toBeCloseTo(0.5);
    });
});

describe('spectrum(k)', () => {
    const ramp = new Float32Array([0, 0.5, 1]);

    it('interpolates between slices and clamps k to [0, 1]', () => {
        expect(sampleSpectrum(ramp, 0)).toBe(0);
        expect(sampleSpectrum(ramp, 0.25)).toBeCloseTo(0.25);
        expect(sampleSpectrum(ramp, 1)).toBe(1);
        expect(sampleSpectrum(ramp, -3)).toBe(0);
        expect(sampleSpectrum(ramp, 9)).toBe(1);
        expect(sampleSpectrum(ramp, NaN)).toBe(0);
        expect(sampleSpectrum(new Float32Array(0), 0.5)).toBe(0);
    });

    it('is callable from formulas and marks them as audio-driven', () => {
        const spectrum = new Float32Array(64).fill(0.5);
        expect(run(xyz('spectrum(0.3) * 4'), {}, spectrum)[0]).toBeCloseTo(2);
        expect(compileFormula(xyz('spectrum(u)')).program.usesAudio).toBe(true);
        expect(compileFormula(xyz('spectrum(u)')).animated).toBe(true);
    });

    it('compiles to the GLSL spectrum lookup', () => {
        expect(compileFormula(xyz('spectrum(r)')).glsl).toContain('nsSpectrum(in_r)');
    });
});

describe('color output c', () => {
    const frame = { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) };

    it('is optional and writes a clamped palette position per particle', () => {
        const f = compileFormula('x = u\ny = 0\nz = 0\nc = u - 1');
        expect(f.program.hasColor).toBe(true);
        const colors = new Float32Array(3);
        f.evaluate(new Float32Array(9), colors, new Float32Array([0.5, 0, 0, 1.5, 0, 0, 9, 0, 0]), 3, frame);
        expect(Array.from(colors)).toEqual([0, 0.5, 1]);
    });

    it('turns NaN colors into 0 and tolerates a missing color buffer', () => {
        const f = compileFormula(`${xyz('1')}\nc = sqrt(-1)`);
        const colors = new Float32Array(1).fill(0.7);
        f.evaluate(new Float32Array(3), colors, new Float32Array(3), 1, frame);
        expect(colors[0]).toBe(0);
        expect(() => f.evaluate(new Float32Array(3), null, new Float32Array(3), 1, frame)).not.toThrow();
    });

    it('is reported to the GPU as the 4th component, or NO_COLOR when absent', () => {
        expect(compileFormula(`${xyz('1')}\nc = r`).glsl).toContain('clamp(nsFinite(l_c), 0.0, 1.0)');
        expect(compileFormula(xyz('1')).glsl).toContain(`${NO_COLOR}.0)`);
        expect(compileFormula(xyz('1')).program.hasColor).toBe(false);
    });
});

describe('noise(x, y, z)', () => {
    it('stays in [-1, 1] and is deterministic', () => {
        for (let i = 0; i < 2000; i++) {
            const n = valueNoise3(i * 0.37 - 300, i * 0.11, -i * 0.23);
            expect(n).toBeGreaterThanOrEqual(-1);
            expect(n).toBeLessThanOrEqual(1);
        }
        expect(valueNoise3(1.3, -2.7, 0.4)).toBe(valueNoise3(1.3, -2.7, 0.4));
    });

    it('is smooth: nearby points give nearby values', () => {
        for (let i = 0; i < 200; i++) {
            const x = i * 0.173, y = i * 0.091, z = -i * 0.057;
            expect(Math.abs(valueNoise3(x, y, z) - valueNoise3(x + 0.01, y, z))).toBeLessThan(0.05);
        }
    });

    it('hits the lattice hash exactly at integer points (incl. negative)', () => {
        expect(valueNoise3(3, -4, 5)).toBeCloseTo(latticeHash(3, -4, 5) * 2 - 1, 12);
    });

    it('uses the same integer constants in GLSL as in JavaScript', () => {
        for (const k of ['0x8da6b343u', '0xd8163841u', '0xcb1ab31fu', '0x5bd1e995u']) expect(NOISE_GLSL).toContain(k);
    });

    it('is callable from formulas and compiles for both backends', () => {
        expect(run(xyz('noise(3, -4, 5)'))[0]).toBeCloseTo(latticeHash(3, -4, 5) * 2 - 1, 5);
        expect(compileFormula(xyz('noise(u, v, t)')).glsl).toContain('nsNoise(vec3(in_u, in_v, in_t))');
    });
});

describe('formula errors', () => {
    it.each([
        ['x = 1\ny = 2', 'Missing "z'],
        [xyz('foo'), 'Unknown name "foo"'],
        [xyz('sin'), 'is a function'],
        [xyz('blah(1)'), 'Unknown function "blah"'],
        [xyz('sin(1, 2)'), 'sin() takes 1 argument, got 2'],
        [xyz('clamp(1)'), 'takes 3 arguments'],
        [xyz('(1 + 2'), 'Missing ")"'],
        [xyz('1 +'), 'incomplete'],
        [xyz('1 2'), 'Expected end of line'],
        ['u = 1\n' + xyz('1'), 'built-in input'],
        ['PI = 3\n' + xyz('1'), 'constant'],
        ['x = 1\nx = 2\ny = 0\nz = 0', 'already defined'],
        [xyz('a') + '\na = 1', 'Unknown name "a"'],
        [xyz('1 $ 2'), 'Unexpected character "$"'],
    ])('%j → %s', (source, message) => {
        expect(errorOf(source).message).toContain(message);
    });

    it('reports line and column', () => {
        const error = errorOf('x = 1\ny = 2 + nope\nz = 0');
        expect(error.line).toBe(2);
        expect(error.col).toBe(9);
    });

    it('rejects very long sources', () => {
        expect(errorOf(xyz('1' + ' + 1'.repeat(2000))).message).toContain('too long');
    });
});

describe('formula safety', () => {
    it.each([
        xyz('constructor'),
        xyz('toString'),
        xyz('__proto__'),
        xyz('alert(1)'),
        xyz('globalThis'),
        xyz('H'),
        xyz('out'),
        xyz('Math.sin(1)'),
        xyz('"str"'),
        xyz('`tpl`'),
        xyz('x[0]'),
        '__proto__ = 1\n' + xyz('1'),
        'a__b = 1\n' + xyz('1'),
        xyz('(function(){ return 1 })()'),
    ])('rejects %j', (source) => {
        expect(() => compileFormula(source)).toThrow(FormulaError);
    });

    it('treats prototype names as plain locals (they are prefixed in generated code)', () => {
        expect(run('constructor = 2\ntoString = 3\n' + xyz('constructor * toString'))[0]).toBe(6);
    });

    it('never puts raw identifiers into the generated GLSL', () => {
        const { glsl } = compileFormula('main = 2\nx = main * u\ny = t\nz = bass');
        expect(glsl).toContain('float l_main = (2.0);');
        expect(glsl).toContain('(l_main * in_u)');
        expect(glsl).not.toMatch(/\bmain\b(?!\s*=)/);
    });

    it('guards non-finite GLSL results with a bit test that fast-math cannot remove', async () => {
        const { GLSL_PRELUDE } = await import('../src/formula/emit');
        expect(GLSL_PRELUDE).toContain('floatBitsToUint');
        expect(GLSL_PRELUDE).not.toMatch(/\bisnan\s*\(|\bisinf\s*\(/);
    });

    it('writes GLSL float literals with a decimal point', () => {
        const { glsl } = compileFormula(xyz('3 + 0.5 + 1e-7'));
        expect(glsl).toContain('(3.0)');
        expect(glsl).toContain('(0.5)');
        expect(glsl).toContain('(1e-7)');
    });
});

describe('motion formulas (dx, dy, dz)', () => {
    const lorenz = 'dx = 10 * (y - x)\ndy = x * (28 - z) - y\ndz = x * y - 8/3 * z';
    const frame = { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) };

    it('are recognised by what they assign', () => {
        expect(compileFormula(lorenz).program.kind).toBe('motion');
        expect(compileFormula(xyz('u')).program.kind).toBe('shape');
    });

    it('read the current point and return its velocity', () => {
        const f = compileFormula(lorenz);
        const out = new Float32Array(3);
        f.evaluate(out, null, new Float32Array(3), 1, frame, new Float32Array([1, 2, 3]));
        expect(Array.from(out)).toEqual([10, Math.fround(1 * 25 - 2), Math.fround(2 - 8)]);
    });

    it('can still use color, time, audio and helpers', () => {
        const f = compileFormula('k = 1 + bass\ndx = -x * k\ndy = t\ndz = 0\nc = r');
        const out = new Float32Array(3);
        const colors = new Float32Array(1);
        f.evaluate(out, colors, new Float32Array([0, 0, 0.25]), 1, { ...frame, t: 2, bass: 1 }, new Float32Array([1, 0, 0]));
        expect(Array.from(out)).toEqual([-2, 2, 0]);
        expect(colors[0]).toBe(0.25);
    });

    it('compile to an nsMotion GLSL function', () => {
        const { glsl } = compileFormula(lorenz);
        expect(glsl).toContain('vec4 nsMotion(vec3 pos, vec3 p, float t, vec4 audio)');
        expect(glsl).toContain('float in_x = pos.x;');
    });

    it.each([
        ['x = 1\ny = 1\nz = 1\ndx = 1\ndy = 1\ndz = 1', 'not both'],
        ['dx = 1\ndy = 1', 'Missing "dz'],
        ['dx = u\ndy = 0\ndz = 0', '"u" only exists in shape formulas'],
        ['x = 2\ndx = 0\ndy = 0\ndz = 0', 'not both'],
        ['q = x\ndx = 0\ndy = 0\ndz = 0\nx2 = 1', ''],
    ])('%j → %s', (source, message) => {
        if (!message) {
            expect(() => compileFormula(source)).not.toThrow();
            return;
        }
        expect(() => compileFormula(source)).toThrow(message);
    });

    it('explain that x, y, z are inputs in a motion', () => {
        expect(() => compileFormula('dx = 0\ndy = 0\ndz = 0\nk = 1\nr = 2')).toThrow('built-in input');
    });
});

import { float32Constant, float32Text, overflowsFloat32 } from '../src/formula/float32';
import { glslNumber } from '../src/formula/emit';

describe('H1 · values float32 cannot hold', () => {
    it('x = 1e39 collapses to 0, as it does on the GPU, instead of staying a huge double', () => {
        expect(run(xyz('1e30 * 1e10', '-1e30 * 1e10', 'exp(1000)'))).toEqual([0, 0, 0]);
    });

    it('a motion that overflows float32 stops (0) rather than flinging the particle away', () => {
        const f = compileFormula('dx = 1e30 * 1e10\ndy = 1\ndz = -1e30 * 1e10');
        const out = new Float32Array(3);
        f.evaluate(out, null, new Float32Array(3), 1, { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) }, new Float32Array(3));
        expect(Array.from(out)).toEqual([0, 1, 0]);
    });

    it('a color that overflows or is NaN is 0, matching clamp(nsFinite(c), 0, 1) in GLSL', () => {
        const f = compileFormula('x = u\ny = 0\nz = 0\nc = 1e30 * 1e10');
        const out = new Float32Array(3);
        const colors = new Float32Array(1);
        f.evaluate(out, colors, new Float32Array(3), 1, { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(64) });
        expect(colors[0]).toBe(0);
    });

    it.each(['1e39', '1e300', '3.5e38', '1e308'])('the literal %s is rejected: no float32 holds it, so no shader could read it', (literal) => {
        expect(errorOf(xyz(literal)).message).toContain('too large');
        expect(errorOf(`dx = ${literal}\ndy = 0\ndz = 0`).message).toContain('too large');
    });

    it('the largest and smallest literals a float32 holds still compile, and tiny ones become 0', () => {
        expect(run(xyz('3.4e38'))[0]).toBe(Math.fround(3.4e38));
        const { glsl } = compileFormula(xyz('1e-320', '1e-39', '1e-37'));
        expect(glsl).toContain('(0.0)');
        expect(glsl).toContain('(1e-37)');
        expect(run(xyz('1e-320', '1e-39', '1e-37')).slice(0, 2)).toEqual([0, 0]);
    });

    it('literals are the float32 the GPU reads, not the double JavaScript parses', () => {
        // 0.1 is not exact in either width, but the CPU must hold the GPU's 0.1.
        expect(run(`a = 0.1\n${xyz('a * 3 - 0.3')}`)[0]).toBe(Math.fround(Math.fround(0.1) * 3 - Math.fround(0.3)));
    });

    it('every statement is rounded to float32, as a GPU local is', () => {
        const big = 16777216; // 2^24: the first integer whose successor float32 cannot hold
        expect(run(`a = ${big} + 1\n${xyz('a - ' + big)}`)[0]).toBe(0);
    });

    it('the literal is judged as float32 inside functions too (sin(PI) is the float32 PI\'s sine)', () => {
        expect(run(xyz('sin(PI)'))[0]).toBe(Math.fround(Math.sin(Math.fround(Math.PI))));
    });

    it('ordinary values are untouched', () => {
        expect(run(xyz('1e30', '-2.5', '0.125'))[0]).toBe(Math.fround(1e30));
        expect(run(xyz('1e30', '-2.5', '0.125')).slice(1)).toEqual([-2.5, 0.125]);
    });
});

describe('H2 · glslNumber never writes a literal the shader cannot represent', () => {
    it.each([
        [3, '3.0'], [0.5, '0.5'], [-2, '-2.0'], [1e-7, '1e-7'], [0.1, '0.1'], [16777217, '16777216.0'], [1e30, '1e+30'],
    ])('%s → %s', (value, text) => {
        expect(glslNumber(value)).toBe(text);
    });

    it.each([1e39, -1e39, 1e308, Infinity, -Infinity, NaN])('refuses %s', (value) => {
        expect(() => glslNumber(value)).toThrow(RangeError);
    });

    it.each([1e-320, 1e-39, -1e-45, 5e-324])('writes %s as 0.0, as a flush-to-zero GPU would', (value) => {
        expect(glslNumber(value)).toBe('0.0');
    });

    it('prints the largest float32 and reads back as exactly that', () => {
        const max = 3.4028234663852886e38;
        expect(float32Constant(max)).toBe(max);
        expect(Number(float32Text(max))).not.toBe(Infinity);
        expect(Math.fround(Number(float32Text(max)))).toBe(max);
        expect(overflowsFloat32(3.4028235e38)).toBe(false); // rounds down to the max
        expect(overflowsFloat32(3.4028236e38)).toBe(true);
    });

    it('every float32 prints as text that rounds back to the same float32, in 9 digits or fewer', () => {
        const bytes = new DataView(new ArrayBuffer(4));
        let seed = 12345;
        for (let n = 0; n < 5000; n++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            bytes.setUint32(0, seed);
            const value = bytes.getFloat32(0);
            if (!Number.isFinite(value) || Math.abs(value) < 1.1754943508222875e-38) continue;
            const text = float32Text(value);
            expect(Math.fround(Number(text))).toBe(value);
            expect(text.replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(9);
        }
    });

    it('is the only way a number reaches the shader: no generated literal is out of range', () => {
        const { glsl } = compileFormula('a = 1e-38\nb = 3.4e38\nx = a + b + PI + 0.1\ny = 1e-45\nz = 7');
        for (const [literal] of glsl.matchAll(/(?<![A-Za-z_0-9])\d+\.?\d*(?:e[+-]?\d+)?/g)) {
            expect(Number.isFinite(Math.fround(Number(literal)))).toBe(true);
        }
    });
});
