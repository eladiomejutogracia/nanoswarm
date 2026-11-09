import * as THREE from 'three';
import type { GPUComputationRenderer, Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { SILENCE, type AudioBands } from '../../src/audio/bands';
import { CpuBackend } from '../../src/backends/cpu';
import { GpuBackend } from '../../src/backends/gpu';
import type { FrameInput } from '../../src/backends/types';
import { compileFormula, FUNCTIONS, INPUTS } from '../../src/formula';
import type { Target } from '../../src/sources';
import { parseMarkup } from '../../src/element/markup';
import { describeShaderFailure } from '../../src/runtime/shader-log';

/** A real WebGL2 renderer whose shader failures are collected instead of lost in the console. */
export function createTestRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(64, 64);
    const failures: string[] = [];
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
        failures.push(describeShaderFailure(gl, program, vertex, fragment));
    };
    return { renderer, failures };
}

export const SPECTRUM = Float32Array.from({ length: 64 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.7));
export const LOUD: AudioBands = { bass: 0.7, mid: 0.4, treble: 0.25, level: 0.5 };

export const frame = (time: number, bands: AudioBands = SILENCE, dt = 1 / 60): FrameInput => ({
    dt, time, speed: 1, bands, spectrum: SPECTRUM, pointer: { active: false, x: 0, y: 0, z: 0 },
});

const files = import.meta.glob('../../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Example { name: string; group: string; formula: string }

/** The same files the playground loads. */
export const examples: Example[] = Object.entries(files).map(([path, html]) => {
    const [group, file] = path.split('/').slice(-2);
    return { name: `${group}/${file}`, group, formula: parseMarkup(html).formula };
});

/**
 * Formulas that between them use every function, operator, constant and input the language has — once
 * as a shape and once as a motion, with and without a color — so no branch of the code generator goes uncompiled.
 */
export function grammarCorpus(): [name: string, source: string][] {
    const corpus: [string, string][] = [];
    const kinds = [
        { kind: 'shape', inputs: Object.keys(INPUTS.shape), out: ['x', 'y', 'z'] },
        { kind: 'motion', inputs: Object.keys(INPUTS.motion), out: ['dx', 'dy', 'dz'] },
    ] as const;

    for (const { kind, inputs, out } of kinds) {
        const [a, b, c] = inputs;
        const pick = (i: number) => inputs[i % inputs.length];
        for (const [fn, arities] of Object.entries(FUNCTIONS)) {
            for (const arity of arities as readonly number[]) {
                const args = Array.from({ length: arity }, (_, i) => pick(i + 1)).join(', ');
                corpus.push([`${kind}: ${fn}/${arity}`, `${out[0]} = ${fn}(${args})\n${out[1]} = 0\n${out[2]} = 0`]);
            }
        }
        corpus.push([`${kind}: every operator`, `k = -${a} + ${b} - ${c} * 2 / 3 ^ 2 ** 2\n${out[0]} = k\n${out[1]} = (k + 1) * -${b}\n${out[2]} = 1e-7 + 3 + 0.5 + PI + TAU + E`]);
        corpus.push([`${kind}: every input`, `s = ${inputs.join(' + ')}\n${out[0]} = s\n${out[1]} = s * 2\n${out[2]} = s * 3`]);
        corpus.push([`${kind}: with a color`, `${out[0]} = ${a}\n${out[1]} = ${b}\n${out[2]} = ${c}\nc = ${a} * 0.1`]);
        corpus.push([`${kind}: locals that shadow built-in names`, `main = 2\nvoid = main * ${a}\n${out[0]} = void\n${out[1]} = main\n${out[2]} = 0`]);
    }
    return corpus;
}

/** Draw a backend's points once, so its material's shaders compile too. */
export function draw(renderer: THREE.WebGLRenderer, backend: GpuBackend | CpuBackend): void {
    const scene = new THREE.Scene();
    scene.add(backend.object);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 14);
    renderer.render(scene, camera);
    renderer.getContext().finish();
}

/**
 * A formula as a target, motions included, without checking that the motion is a worthwhile attractor
 * (the corpus is for the compiler, not for the eye): identity transform, seeds scattered in a small cube.
 */
export function uncalibratedTarget(source: string): Target {
    const formula = compileFormula(source);
    if (formula.program.kind === 'shape') return { kind: 'shape', formula };
    const seeds = Float32Array.from({ length: 4096 * 3 }, (_, i) => Math.sin(i * 12.9898) * 2);
    return { kind: 'motion', field: { formula, center: [0, 0, 0], scale: 1, stepPerSecond: 1, maxStep: 0.01, seeds } };
}

/** What a backend keeps between frames, read straight from its buffers (CPU) or render targets (GPU). */
export type GpuChannel = 'positionVar' | 'velocityVar' | 'targetVar';

/** One GPU channel as RGBA texels, one per particle. */
export function readGpu(renderer: THREE.WebGLRenderer, gpu: GpuBackend, channel: GpuChannel): Float32Array {
    const inner = gpu as unknown as { compute: GPUComputationRenderer; size: number } & Record<GpuChannel, Variable>;
    const target = inner.compute.getCurrentRenderTarget(inner[channel]) as THREE.WebGLRenderTarget;
    const texels = new Float32Array(inner.size * inner.size * 4);
    renderer.readRenderTargetPixels(target, 0, 0, inner.size, inner.size, texels);
    return texels;
}

export function readCpu(cpu: CpuBackend, buffer: 'targets' | 'positions' | 'velocities'): Float32Array {
    return (cpu as unknown as Record<string, Float32Array>)[buffer];
}

/**
 * Per-particle worst relative error between CPU xyz triplets and GPU RGBA texels. "Relative" is to
 * max(1, |cpu|): near zero it is absolute error, so a value that should be 0 does not blow the ratio up.
 * `toWorld` maps the GPU's native-space motion targets into the CPU's world space.
 */
export function particleErrors(
    cpu: Float32Array,
    gpu: Float32Array,
    count: number,
    toWorld?: { center: readonly number[]; scale: number },
): Float64Array {
    const errors = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            const a = cpu[i * 3 + k];
            const g = gpu[i * 4 + k];
            const b = toWorld ? (g - toWorld.center[k]) * toWorld.scale : g;
            const error = a === b ? 0 : Math.abs(a - b) / Math.max(1, Math.abs(a));
            errors[i] = Math.max(errors[i], Number.isNaN(error) ? Infinity : error);
        }
    }
    return errors;
}
