import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { SPECTRUM_BINS } from '../audio/bands';
import { GLSL_PRELUDE, NO_COLOR } from '../formula';
import type { Look } from '../looks';
import type { Target } from '../sources';
import { FLOW_ESCAPE, MAX_SUBSTEPS, particleSeeds, substepsFor, type FlowField } from '../sources/flow';
import { createParticleParams, createSpawnCloud } from '../sources/params';
import { applyLook, createPointsMaterial } from './material';
import { PHYSICS, PHYSICS_GLSL } from './physics';
import { GPU_TEXTURE_SIZE_MAX } from './select';
import type { Backend, FrameInput } from './types';

/** What the target pass computes. */
export type TargetMode =
    | { kind: 'static' }
    | { kind: 'shape'; glsl: string }
    | { kind: 'motion'; glsl: string };

/** The target pass reads its own previous output (motions step from where they were). */
const TARGET_SELF = 'uniform sampler2D textureTarget;\n';

/**
 * Target pass: where each particle wants to be, plus its color slot (w).
 * - static: a texture (models, raw points).
 * - shape:  the formula, evaluated once per particle per frame.
 * - motion: the particle's point on the attractor, advanced one RK2 step
 *           per frame in native units; broken or escaped points respawn.
 */
export function buildTargetShader(mode: TargetMode): string {
    let body: string;
    if (mode.kind === 'static') {
        body = `gl_FragColor = vec4(texture2D(tStatic, uv).xyz, ${NO_COLOR}.0);`;
    } else if (mode.kind === 'shape') {
        body = 'gl_FragColor = nsFormula(texture2D(tParams, uv).xyz, uTime, uAudio);';
    } else {
        body = `
    vec3 seed = texture2D(tFlowSeeds, uv).xyz;
    vec3 prm = texture2D(tParams, uv).xyz;
    vec3 next = uFlowReset > 0.5 ? seed : texture2D(textureTarget, uv).xyz;
    vec4 k2 = vec4(0.0, 0.0, 0.0, ${NO_COLOR}.0);
    for (int s = 0; s < ${MAX_SUBSTEPS}; s++) { // RK2 substeps keep long frames stable
        if (float(s) >= uFlowSubsteps) break;
        vec4 k1 = nsMotion(next, prm, uTime, uAudio);
        k2 = nsMotion(next + k1.xyz * (0.5 * uFlowStep), prm, uTime, uAudio);
        next += k2.xyz * uFlowStep;
    }
    vec3 world = (next - uFlowCenter) * uFlowScale;
    bool broken = nsIsBad(next.x) || nsIsBad(next.y) || nsIsBad(next.z) || dot(world, world) > ${FLOW_ESCAPE * FLOW_ESCAPE}.0;
    gl_FragColor = vec4(broken ? seed : next, k2.w);`;
    }
    const formula = mode.kind === 'static' ? '' : GLSL_PRELUDE + mode.glsl;
    return /* glsl */ `
uniform sampler2D tParams;
uniform sampler2D tStatic;
uniform sampler2D tFlowSeeds;
uniform float uTime;
uniform vec4 uAudio;
uniform float uFlowStep;
uniform float uFlowSubsteps;
uniform float uFlowReset;
uniform vec3 uFlowCenter;
uniform float uFlowScale;
bool nsIsBad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
${formula}
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    ${body}
}
`;
}

/**
 * Physics passes. Both compute the same velocity from the same inputs, so
 * the position pass integrates with the *new* velocity (semi-implicit Euler).
 * Targets are converted from native to world space (identity unless a motion).
 */
export function buildPhysicsShader(output: 'velocity' | 'position'): string {
    const result = output === 'velocity'
        ? 'vec4(vel, 1.0)'
        : `vec4(pos + vel * min(uDelta, ${PHYSICS.maxDelta}), 1.0)`;
    return /* glsl */ `
uniform sampler2D tParams;
uniform vec3 uFlowCenter;
uniform float uFlowScale;
${PHYSICS_GLSL}
void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D(texturePosition, uv).xyz;
    vec3 vel = texture2D(textureVelocity, uv).xyz;
    vec3 target = (texture2D(textureTarget, uv).xyz - uFlowCenter) * uFlowScale;
    vel = nsStepVelocity(pos, vel, target, texture2D(tParams, uv).z);
    gl_FragColor = ${result};
}
`;
}

/** xyz triplets → RGBA texels of a size×size texture (unused texels stay 0). */
export function packRGBA(data: Float32Array, size: number, into = new Float32Array(size * size * 4)): Float32Array {
    const count = data.length / 3;
    for (let i = 0; i < count; i++) {
        into[i * 4] = data[i * 3];
        into[i * 4 + 1] = data[i * 3 + 1];
        into[i * 4 + 2] = data[i * 3 + 2];
        into[i * 4 + 3] = 1;
    }
    return into;
}

function packTexture(data: Float32Array, size: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(packRGBA(data, size), size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
}

/**
 * GPU backend: GPGPU ping-pong textures for target, velocity and position.
 * Only the small target pass depends on the formula; the physics shaders
 * compile once.
 */
export class GpuBackend implements Backend {
    readonly kind = 'gpu' as const;
    readonly object: THREE.Points;

    private readonly size: number;
    private readonly compute: GPUComputationRenderer;
    private readonly targetVar: Variable;
    private readonly velocityVar: Variable;
    private readonly positionVar: Variable;
    private readonly paramsTexture: THREE.DataTexture;
    private staticTexture: THREE.DataTexture;
    private seedsTexture: THREE.DataTexture;
    private readonly material = createPointsMaterial('gpu');
    private readonly geometry = new THREE.BufferGeometry();
    private readonly uniforms = {
        tParams: { value: null as THREE.Texture | null },
        tStatic: { value: null as THREE.Texture | null },
        tFlowSeeds: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
        uAudio: { value: new THREE.Vector4() },
        uSpectrum: { value: new Float32Array(SPECTRUM_BINS) },
        uFlowStep: { value: 0 },
        uFlowSubsteps: { value: 1 },
        uFlowReset: { value: 0 },
        uFlowCenter: { value: new THREE.Vector3() },
        uFlowScale: { value: 1 },
        uDelta: { value: 0 },
        uPointer: { value: new THREE.Vector4() },
    };
    private currentShader = '';
    private flow: FlowField | null = null;

    constructor(renderer: THREE.WebGLRenderer, readonly count: number, dataType: THREE.TextureDataType = THREE.FloatType) {
        this.size = Math.ceil(Math.sqrt(count));
        if (this.size > GPU_TEXTURE_SIZE_MAX) throw new Error(`[NanoSwarm] Too many particles for the GPU backend (${count}).`);

        const params = createParticleParams(count);
        this.paramsTexture = packTexture(params, this.size);
        this.staticTexture = packTexture(new Float32Array(count * 3), this.size);
        this.seedsTexture = packTexture(new Float32Array(count * 3), this.size);
        this.uniforms.tParams.value = this.paramsTexture;
        this.uniforms.tStatic.value = this.staticTexture;
        this.uniforms.tFlowSeeds.value = this.seedsTexture;

        this.compute = new GPUComputationRenderer(this.size, this.size, renderer);
        this.compute.setDataType(dataType);

        const spawn = this.compute.createTexture();
        packRGBA(createSpawnCloud(count), this.size, spawn.image.data as unknown as Float32Array);

        this.currentShader = buildTargetShader({ kind: 'static' });
        this.targetVar = this.compute.addVariable('textureTarget', this.currentShader, this.compute.createTexture());
        this.velocityVar = this.compute.addVariable('textureVelocity', buildPhysicsShader('velocity'), this.compute.createTexture());
        this.positionVar = this.compute.addVariable('texturePosition', buildPhysicsShader('position'), spawn);
        this.compute.setVariableDependencies(this.targetVar, [this.targetVar]);
        const physicsInputs = [this.positionVar, this.velocityVar, this.targetVar];
        this.compute.setVariableDependencies(this.velocityVar, physicsInputs);
        this.compute.setVariableDependencies(this.positionVar, physicsInputs);
        for (const variable of [this.targetVar, this.velocityVar, this.positionVar]) {
            Object.assign(variable.material.uniforms, this.uniforms);
        }

        const error = this.compute.init();
        if (error) throw new Error(`[NanoSwarm] GPU backend unavailable: ${error}`);

        // Each point looks up its own texel; `position` only satisfies three.js.
        const refs = new Float32Array(count * 2);
        const rand = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            refs[i * 2] = ((i % this.size) + 0.5) / this.size;
            refs[i * 2 + 1] = (Math.floor(i / this.size) + 0.5) / this.size;
            rand[i] = params[i * 3 + 2];
        }
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        this.geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2));
        this.geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
        this.object = new THREE.Points(this.geometry, this.material);
        this.object.frustumCulled = false;
    }

    setTarget(target: Target): void {
        const u = this.uniforms;
        this.flow = null;
        u.uFlowCenter.value.set(0, 0, 0);
        u.uFlowScale.value = 1;

        if (target.kind === 'shape') {
            this.useTargetShader({ kind: 'shape', glsl: target.formula.glsl });
        } else if (target.kind === 'motion') {
            const { field } = target;
            this.replaceTexture('seedsTexture', 'tFlowSeeds', particleSeeds(field, this.count));
            u.uFlowCenter.value.fromArray(field.center);
            u.uFlowScale.value = field.scale;
            u.uFlowReset.value = 1; // first frame: every particle starts on its seed
            this.flow = field;
            this.useTargetShader({ kind: 'motion', glsl: field.formula.glsl });
        } else {
            this.replaceTexture('staticTexture', 'tStatic', target.sample(this.count));
            this.useTargetShader({ kind: 'static' });
        }
    }

    private replaceTexture(field: 'staticTexture' | 'seedsTexture', uniform: 'tStatic' | 'tFlowSeeds', data: Float32Array): void {
        const next = packTexture(data, this.size);
        this[field].dispose();
        this[field] = next;
        this.uniforms[uniform].value = next;
    }

    /** Only the target pass depends on the formula — physics shaders never recompile. */
    private useTargetShader(mode: TargetMode): void {
        const shader = buildTargetShader(mode);
        if (shader === this.currentShader) return;
        this.currentShader = shader;
        // init() prepended the self-dependency declaration once; keep it when swapping.
        this.targetVar.material.fragmentShader = TARGET_SELF + shader;
        this.targetVar.material.needsUpdate = true;
    }

    setLook(look: Look, pixelRatio: number): void {
        applyLook(this.material, look, this.count, pixelRatio);
    }

    update({ dt, time, speed, bands, spectrum, pointer }: FrameInput): void {
        const u = this.uniforms;
        u.uDelta.value = dt;
        u.uTime.value = time;
        u.uAudio.value.set(bands.bass, bands.mid, bands.treble, bands.level);
        u.uSpectrum.value.set(spectrum);
        if (this.flow) {
            const h = Math.min(dt, PHYSICS.maxDelta) * speed * this.flow.stepPerSecond;
            const substeps = substepsFor(this.flow, h);
            u.uFlowStep.value = h / substeps;
            u.uFlowSubsteps.value = substeps;
        }
        u.uPointer.value.set(pointer.x, pointer.y, pointer.z, pointer.active ? 1 : 0);

        this.compute.compute();
        u.uFlowReset.value = 0;

        const m = this.material.uniforms;
        m.uPositions.value = this.compute.getCurrentRenderTarget(this.positionVar).texture;
        m.uVelocities.value = this.compute.getCurrentRenderTarget(this.velocityVar).texture;
        m.uTargets.value = this.compute.getCurrentRenderTarget(this.targetVar).texture;
    }

    dispose(): void {
        this.compute.dispose();
        this.paramsTexture.dispose();
        this.staticTexture.dispose();
        this.seedsTexture.dispose();
        this.geometry.dispose();
        this.material.dispose();
    }
}
