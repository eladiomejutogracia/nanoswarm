import * as THREE from 'three';
import type { BackendKind } from './types';

export type BackendPreference = 'auto' | BackendKind;

/** GPU particles live one per texel in a square float texture of at most this side. */
export const GPU_TEXTURE_SIZE_MAX = 512;

export interface GpuCapabilities {
    /** Can render into float textures (needed for GPGPU). */
    floatTargets: boolean;
    /** Can render into half-float textures (lower precision fallback). */
    halfFloatTargets: boolean;
    /** Vertex shaders can sample textures. */
    vertexTextures: boolean;
    /** Software rasterizer (SwiftShader, llvmpipe…) — GPGPU would crawl. */
    software: boolean;
}

export const PARTICLE_LIMITS = {
    gpu: { default: 120_000, max: GPU_TEXTURE_SIZE_MAX * GPU_TEXTURE_SIZE_MAX },
    // CPU cost measured at ~2 ms/frame for 200k static particles on a desktop;
    // the default stays low for weak machines, the cap matches the GPU.
    cpu: { default: 30_000, max: GPU_TEXTURE_SIZE_MAX * GPU_TEXTURE_SIZE_MAX },
} as const;

export const MIN_PARTICLES = 500;

export interface BackendChoice {
    kind: BackendKind;
    dataType: THREE.TextureDataType;
    /** Why this backend was picked (shown in the playground, useful in bug reports). */
    reason: string;
}

export function chooseBackend(preference: BackendPreference, caps: GpuCapabilities): BackendChoice {
    const gpuMissing = !caps.vertexTextures
        ? 'no vertex textures'
        : !caps.floatTargets && !caps.halfFloatTargets
            ? 'no float render targets'
            : null;

    if (preference === 'cpu') return { kind: 'cpu', dataType: THREE.FloatType, reason: 'requested' };

    if (gpuMissing) {
        return { kind: 'cpu', dataType: THREE.FloatType, reason: `GPU unsupported: ${gpuMissing}` };
    }

    const dataType = caps.floatTargets ? THREE.FloatType : THREE.HalfFloatType;
    if (preference === 'gpu') return { kind: 'gpu', dataType, reason: 'requested' };
    if (caps.software) return { kind: 'cpu', dataType, reason: 'software rendering detected' };
    return { kind: 'gpu', dataType, reason: caps.floatTargets ? 'float textures' : 'half-float textures' };
}

export function clampParticles(kind: BackendKind, requested?: number): number {
    const limits = PARTICLE_LIMITS[kind];
    if (requested === undefined || !Number.isFinite(requested)) return limits.default;
    return Math.round(Math.min(limits.max, Math.max(MIN_PARTICLES, requested)));
}

const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

export function detectCapabilities(renderer: THREE.WebGLRenderer): GpuCapabilities {
    const gl = renderer.getContext();
    let software = false;
    const debug = renderer.extensions.get('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    if (debug) software = SOFTWARE_RENDERER_RE.test(String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)));

    return {
        floatTargets: renderer.extensions.has('EXT_color_buffer_float'),
        halfFloatTargets: renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'),
        vertexTextures: renderer.capabilities.maxVertexTextures > 0,
        software,
    };
}
