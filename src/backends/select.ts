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
    // Measured 2026-11-02 in Chromium 156 on an Intel i7-9750H laptop: median ms per CpuBackend.update()
    // (formula + physics, no drawing), animated jellyfish / galaxy / lorenz attractor:
    //   30k: 9.4 / 5.9 / 1.9   40k: 12.8 / 7.3 / 2.6   80k: 24.6 / 14 / 5.4   262k (the old cap): 83 / 48 / 18
    // The old cap left the jellyfish at ~12 fps before drawing a single point. At 40k the worst case
    // costs 13 ms, so a 33 ms frame (30 fps) keeps room for drawing and for slower machines.
    cpu: { default: 30_000, max: 40_000 },
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

/** The renderer, or an Error that says in plain words why there isn't one. */
export function createRenderer(): THREE.WebGLRenderer {
    try {
        return new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch (cause) {
        throw new Error(
            '[NanoSwarm] WebGL is not available (it is turned off in this browser, or this device does not support it), so nothing can be drawn.',
            { cause },
        );
    }
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
