import * as THREE from 'three';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CpuBackend } from '../../src/backends/cpu';
import { GpuBackend } from '../../src/backends/gpu';
import { applyLook, createPointsMaterial } from '../../src/backends/material';
import { resolveLook } from '../../src/looks';
import { createTestRenderer, draw, examples, frame, grammarCorpus, LOUD, uncalibratedTarget } from './helpers';

/**
 * Every shader the library can generate goes through a real WebGL2 compiler. The unit tests only look at
 * the text of the GLSL; a stray parenthesis passes them all and ships as "everyone silently runs on the CPU".
 */
const { renderer, failures } = createTestRenderer();
const COUNT = 1024;
const gpu = new GpuBackend(renderer, COUNT);
afterAll(() => { gpu.dispose(); renderer.dispose(); });
afterEach(() => { failures.length = 0; }); // a broken shader fails its own test, not every one after it

function compile(source: string): void {
    gpu.setTarget(uncalibratedTarget(source));
    gpu.update(frame(0.5, LOUD));
    gpu.update(frame(0.52, LOUD));
    renderer.getContext().finish();
}

describe('the WebGL2 driver is a real one', () => {
    it('is WebGL2 with float render targets, so the GPU path is the one under test', () => {
        expect(renderer.capabilities.isWebGL2).toBe(true);
        expect(renderer.extensions.has('EXT_color_buffer_float')).toBe(true);
    });

    it('reports a deliberately broken shader (the net itself works)', () => {
        const material = new THREE.ShaderMaterial({
            vertexShader: 'void main() { gl_Position = vec4(0.0); }',
            fragmentShader: 'void main() { gl_FragColor = vec4(1.0 ; }',
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)), material);
        mesh.frustumCulled = false;
        renderer.render(new THREE.Scene().add(mesh), new THREE.PerspectiveCamera());
        expect(failures.join('\n')).toContain('Fragment shader');
    });
});

describe('GPU shaders compile', () => {
    it('the physics passes and the static target pass (what every backend starts with)', () => {
        gpu.update(frame(0));
        expect(failures).toEqual([]);
    });

    it.each(examples.map((e) => [e.name, e.formula]))('example %s', (_, formula) => {
        compile(formula);
        expect(failures).toEqual([]);
    });

    it.each(grammarCorpus())('%s', (_, source) => {
        compile(source);
        expect(failures).toEqual([]);
    });

    it('points: model and raw-points targets use the static pass', () => {
        gpu.setTarget({ kind: 'points', sample: (count) => new Float32Array(count * 3).fill(1) });
        gpu.update(frame(1));
        expect(failures).toEqual([]);
    });

    it.each(['light', 'solid'] as const)('the %s-style point material, on the GPU backend', (style) => {
        gpu.setTarget(uncalibratedTarget('x = u\ny = v\nz = r'));
        gpu.setLook(resolveLook({ style }), 1);
        gpu.update(frame(0));
        draw(renderer, gpu);
        expect(failures).toEqual([]);
    });

    it.each(['light', 'solid'] as const)('the %s-style point material, on the CPU backend', (style) => {
        const cpu = new CpuBackend(COUNT);
        cpu.setTarget(uncalibratedTarget('x = u\ny = v\nz = r\nc = r'));
        cpu.setLook(resolveLook({ style }), 1);
        cpu.update(frame(0));
        draw(renderer, cpu);
        cpu.dispose();
        expect(failures).toEqual([]);
    });

    it('applyLook can switch a compiled material between styles', () => {
        const material = createPointsMaterial('gpu');
        applyLook(material, resolveLook({ style: 'solid' }), COUNT, 1);
        applyLook(material, resolveLook({ style: 'light' }), COUNT, 1);
        expect(material.defines).not.toHaveProperty('NS_SOLID');
    });
});
