import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { compileFormula } from '../src/formula';
import { CpuBackend } from '../src/backends/cpu';
import { buildPhysicsShader, buildTargetShader, packRGBA } from '../src/backends/gpu';
import { chooseBackend, clampParticles, PARTICLE_LIMITS, type GpuCapabilities } from '../src/backends/select';
import { applyLook, createPointsMaterial, lightIntensity, pointSize } from '../src/backends/material';
import { SILENCE } from '../src/audio/bands';
import { backgroundCover, LOOK_DEFAULTS, resolveLook } from '../src/looks';
import { calibrateFlow } from '../src/sources/flow';
import type { FrameInput } from '../src/backends/types';

const FULL: GpuCapabilities = { floatTargets: true, halfFloatTargets: true, vertexTextures: true, software: false };

describe('chooseBackend', () => {
    it('picks GPU with float textures when everything is available', () => {
        expect(chooseBackend('auto', FULL)).toMatchObject({ kind: 'gpu', dataType: THREE.FloatType });
    });

    it('falls back to half floats before giving up on the GPU', () => {
        expect(chooseBackend('auto', { ...FULL, floatTargets: false })).toMatchObject({ kind: 'gpu', dataType: THREE.HalfFloatType });
    });

    it.each([
        [{ ...FULL, vertexTextures: false }, /no vertex textures/],
        [{ ...FULL, floatTargets: false, halfFloatTargets: false }, /no float render targets/],
        [{ ...FULL, software: true }, /software rendering/],
    ])('uses CPU when the GPU path is not viable', (caps, reason) => {
        const choice = chooseBackend('auto', caps);
        expect(choice.kind).toBe('cpu');
        expect(choice.reason).toMatch(reason);
    });

    it('honours explicit requests, except GPU on hardware that cannot do it', () => {
        expect(chooseBackend('cpu', FULL).kind).toBe('cpu');
        expect(chooseBackend('gpu', { ...FULL, software: true }).kind).toBe('gpu');
        expect(chooseBackend('gpu', { ...FULL, vertexTextures: false }).kind).toBe('cpu');
    });
});

describe('clampParticles', () => {
    it('uses per-backend defaults and limits', () => {
        expect(clampParticles('gpu')).toBe(PARTICLE_LIMITS.gpu.default);
        expect(clampParticles('cpu')).toBe(PARTICLE_LIMITS.cpu.default);
        expect(clampParticles('cpu', 1_000_000)).toBe(PARTICLE_LIMITS.cpu.max);
        expect(clampParticles('cpu', 200_000)).toBe(200_000);
        expect(clampParticles('gpu', 1_000_000)).toBe(PARTICLE_LIMITS.gpu.max);
        expect(clampParticles('gpu', 3)).toBe(500);
        expect(clampParticles('gpu', NaN)).toBe(PARTICLE_LIMITS.gpu.default);
    });
});

describe('CpuBackend', () => {
    const frame = (overrides: Partial<FrameInput> = {}): FrameInput => ({
        dt: 1 / 60,
        time: 0,
        speed: 1,
        bands: SILENCE,
        spectrum: new Float32Array(64),
        pointer: { active: false, x: 0, y: 0, z: 0 },
        ...overrides,
    });

    function positions(backend: CpuBackend): Float32Array {
        return backend.object.geometry.attributes.position.array as Float32Array;
    }

    it('flies particles onto a formula', () => {
        const backend = new CpuBackend(1000);
        backend.setTarget({ kind: 'shape', formula: compileFormula('x = 1\ny = 2\nz = 3') });
        for (let i = 0; i < 400; i++) backend.update(frame());
        const pos = positions(backend);
        expect(pos[0]).toBeCloseTo(1, 1);
        expect(pos[1]).toBeCloseTo(2, 1);
        expect(pos[2999]).toBeCloseTo(3, 1);
    });

    it('re-evaluates animated formulas with time and audio', () => {
        const backend = new CpuBackend(10);
        backend.setTarget({ kind: 'shape', formula: compileFormula('x = t\ny = bass\nz = 0') });
        for (let i = 0; i < 600; i++) backend.update(frame({ time: 2, bands: { ...SILENCE, bass: 1 } }));
        expect(positions(backend)[0]).toBeCloseTo(2, 1);
        expect(positions(backend)[1]).toBeCloseTo(1, 1);
    });

    it('keeps motions moving along their attractor, on screen', () => {
        const field = calibrateFlow(compileFormula('dx = 10 * (y - x)\ndy = x * (28 - z) - y\ndz = x * y - 8/3 * z'));
        const backend = new CpuBackend(300);
        backend.setTarget({ kind: 'motion', field });
        for (let i = 0; i < 300; i++) backend.update(frame());
        const before = positions(backend).slice();
        for (let i = 0; i < 30; i++) backend.update(frame());
        const after = positions(backend);
        let moved = 0;
        for (let i = 0; i < after.length; i += 3) {
            expect(Math.hypot(after[i], after[i + 1], after[i + 2])).toBeLessThan(8);
            if (Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2]) > 0.05) moved++;
        }
        expect(moved).toBeGreaterThan(250); // nearly every particle keeps travelling
    });

    it('moves motions faster with a higher speed', () => {
        const field = calibrateFlow(compileFormula('b = 0.208186\ndx = sin(y) - b*x\ndy = sin(z) - b*y\ndz = sin(x) - b*z'));
        const travelled = (speed: number) => {
            const backend = new CpuBackend(200);
            backend.setTarget({ kind: 'motion', field });
            for (let i = 0; i < 120; i++) backend.update(frame({ speed }));
            const start = positions(backend).slice();
            for (let i = 0; i < 60; i++) backend.update(frame({ speed }));
            const end = positions(backend);
            let sum = 0;
            for (let i = 0; i < end.length; i += 3) sum += Math.hypot(end[i] - start[i], end[i + 1] - start[i + 1], end[i + 2] - start[i + 2]);
            return sum;
        };
        expect(travelled(2)).toBeGreaterThan(travelled(1) * 1.5);
    });

    it('writes formula colors and resets them when the next shape has none', () => {
        const backend = new CpuBackend(4);
        const colors = backend.object.geometry.attributes.aColor.array as Float32Array;
        expect(Array.from(colors)).toEqual([-1, -1, -1, -1]);
        backend.setTarget({ kind: 'shape', formula: compileFormula('x = 0\ny = 0\nz = 0\nc = 0.25') });
        backend.update(frame());
        expect(Array.from(colors)).toEqual([0.25, 0.25, 0.25, 0.25]);
        backend.setTarget({ kind: 'shape', formula: compileFormula('x = 0\ny = 0\nz = 0') });
        expect(Array.from(colors)).toEqual([-1, -1, -1, -1]);
    });

    it('flags buffers for upload every frame', () => {
        const backend = new CpuBackend(10);
        const attribute = backend.object.geometry.attributes.position as THREE.BufferAttribute;
        const before = attribute.version;
        backend.update(frame());
        expect(attribute.version).toBeGreaterThan(before);
    });
});

describe('GPU compute shaders', () => {
    it('evaluates a shape formula once, in the target pass, with its color slot', () => {
        const formula = compileFormula('x = u\ny = v\nz = bass\nc = r');
        const glsl = buildTargetShader({ kind: 'shape', glsl: formula.glsl });
        expect(glsl).toContain('gl_FragColor = nsFormula(texture2D(tParams, uv).xyz, uTime, uAudio);');
        expect(glsl).not.toContain('nsStepVelocity');
    });

    it('steps a motion from its own previous value, respawning broken points', () => {
        const formula = compileFormula('dx = -y\ndy = x\ndz = 0');
        const glsl = buildTargetShader({ kind: 'motion', glsl: formula.glsl });
        expect(glsl).toContain('texture2D(textureTarget, uv).xyz');
        expect(glsl).toContain('nsMotion(next + k1.xyz * (0.5 * uFlowStep)');
        expect(glsl).toContain('if (float(s) >= uFlowSubsteps) break;'); // long frames are split
        expect(glsl).toContain('broken ? seed : next');
    });

    it('reads static targets from a texture, with no color', () => {
        const glsl = buildTargetShader({ kind: 'static' });
        expect(glsl).toContain('texture2D(tStatic, uv).xyz, -1.0)');
        expect(glsl).not.toContain('nsFormula');
        expect(glsl).not.toContain('uSpectrum'); // no audio prelude needed for static shapes
    });

    it('keeps formulas out of the physics passes (they compile once)', () => {
        for (const output of ['velocity', 'position'] as const) {
            const glsl = buildPhysicsShader(output);
            expect(glsl).toContain('(texture2D(textureTarget, uv).xyz - uFlowCenter) * uFlowScale');
            expect(glsl).not.toContain('nsFormula');
            expect(glsl).not.toContain('nsMotion');
        }
        expect(buildPhysicsShader('position')).toContain('pos + vel * min(uDelta');
    });

    it('packs xyz into RGBA texels', () => {
        expect(Array.from(packRGBA(new Float32Array([1, 2, 3]), 2))).toEqual([1, 2, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
});

describe('looks', () => {
    const look = resolveLook();

    it('fills anything left out from the defaults', () => {
        expect(resolveLook()).toEqual(LOOK_DEFAULTS);
        expect(resolveLook({ colors: ['#000', '#111', '#222'], style: 'solid' })).toEqual({
            ...LOOK_DEFAULTS, colors: ['#000', '#111', '#222'], style: 'solid',
        });
    });

    it('defaults to the light style and no bloom', () => {
        expect(LOOK_DEFAULTS).toMatchObject({ style: 'light', bloom: 0 });
    });

    it('switches the material between light (glow) and solid (opaque, depth-tested)', () => {
        const material = createPointsMaterial('cpu');
        applyLook(material, { ...look, style: 'solid' }, 50_000, 1);
        expect(material.defines).toHaveProperty('NS_SOLID');
        expect(material.blending).toBe(THREE.NormalBlending);
        expect(material.depthWrite).toBe(true);
        expect(material.transparent).toBe(false);

        applyLook(material, look, 50_000, 1);
        expect(material.defines).not.toHaveProperty('NS_SOLID');
        expect(material.blending).toBe(THREE.CustomBlending);
        expect([material.blendSrc, material.blendDst]).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
        expect(material.depthWrite).toBe(false);
    });

    it('light particles add up on dark backgrounds and cover bright ones', () => {
        expect(backgroundCover('#000000')).toBe(0);
        expect(backgroundCover('#fff')).toBeCloseTo(1, 6);
        expect(backgroundCover('#03040a')).toBeLessThan(0.03); // the default stays glow
        expect(backgroundCover('#808080')).toBeCloseTo(0.5, 1);
        expect(backgroundCover('#ffff00')).toBeGreaterThan(backgroundCover('#0000ff')); // by brightness, not just value
        const material = createPointsMaterial('gpu');
        applyLook(material, { ...look, background: '#ffffff' }, 50_000, 1);
        expect(material.uniforms.uCover.value).toBeCloseTo(1, 6);
    });

    it('dims light-style points as the count grows so dense areas do not burn white', () => {
        expect(lightIntensity(20_000)).toBe(1);
        expect(lightIntensity(240_000)).toBeLessThan(lightIntensity(120_000));
        expect(lightIntensity(10_000_000)).toBe(0.35);
    });

    it('grows points as the particle count drops', () => {
        expect(pointSize(look, 20_000)).toBeGreaterThan(pointSize(look, 200_000));
    });
});
