import * as THREE from 'three';
import { backgroundCover, type Look } from '../looks';
import type { BackendKind } from './types';

/**
 * Light style: result = particle + background × (1 − a × cover). With cover 0 (a black
 * background) this is plain additive glow; with cover 1 (white) the particle covers it like ink.
 */
const GLOW_BLENDING = {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

const VERTEX = /* glsl */ `
uniform vec3 uColors[3];
uniform float uSize;
uniform float uPixelRatio;
attribute float aRand;

#ifdef NS_GPU
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uTargets; // .w = color chosen by the formula, or < 0
attribute vec2 aRef;
#else
attribute float aSpeed;
attribute float aColor;     // color chosen by the formula, or < 0
#endif

varying vec3 vColor;

void main() {
#ifdef NS_GPU
    vec3 pos = texture2D(uPositions, aRef).xyz;
    float speed = length(texture2D(uVelocities, aRef).xyz);
    float chosen = texture2D(uTargets, aRef).w;
#else
    vec3 pos = position;
    float speed = aSpeed;
    float chosen = aColor;
#endif

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.6 + 0.8 * aRand) * (10.0 / max(-mv.z, 0.1));

    // One color rule: the formula's c if it set one, else bottom → top.
    float k = (chosen >= 0.0 ? chosen : clamp(pos.y * 0.11 + 0.5, 0.0, 1.0)) * 2.0;
    vec3 base = k < 1.0 ? mix(uColors[0], uColors[1], k) : mix(uColors[1], uColors[2], k - 1.0);
    // Moving particles glow brighter: morphs and beats read as energy.
    vColor = base * (0.75 + min(speed * 0.08, 1.2));
}
`;

const FRAGMENT = /* glsl */ `
uniform float uIntensity;
uniform float uCover;
varying vec3 vColor;

void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(c, c);
    if (d2 > 1.0) discard;
#ifdef NS_SOLID
    // Each point is a tiny lit sphere: thousands of them read as a surface.
    vec3 normal = vec3(c.x, -c.y, sqrt(1.0 - d2));
    float light = 0.3 + 0.7 * max(dot(normal, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
    gl_FragColor = vec4(vColor * light, 1.0);
#else
    float a = 1.0 - sqrt(d2);
    a *= a;
    // Premultiplied: adds the light, and hides the background by a * uCover (see GLOW_BLENDING).
    gl_FragColor = vec4(vColor * a * uIntensity, a * uCover);
#endif
}
`;

/** Light style: dim each point as the count grows, so dense areas don't burn to white. */
export function lightIntensity(count: number): number {
    return Math.min(1, Math.max(0.35, Math.sqrt(60_000 / count)));
}

/** Fewer particles → bigger points, so every count looks filled in. */
export function pointSize(look: Look, count: number): number {
    return look.size * Math.min(2.5, Math.max(0.6, Math.sqrt(100_000 / count)));
}

export function createPointsMaterial(kind: BackendKind): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        defines: kind === 'gpu' ? { NS_GPU: '' } : {},
        uniforms: {
            uColors: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
            uSize: { value: 3 },
            uPixelRatio: { value: 1 },
            uPositions: { value: null },
            uVelocities: { value: null },
            uTargets: { value: null },
            uIntensity: { value: 1 },
            uCover: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        ...GLOW_BLENDING,
    });
}

export function applyLook(material: THREE.ShaderMaterial, look: Look, count: number, pixelRatio: number): void {
    const colors = material.uniforms.uColors.value as THREE.Color[];
    look.colors.forEach((hex, i) => colors[i].set(hex));
    material.uniforms.uSize.value = pointSize(look, count) * (look.style === 'solid' ? 0.8 : 1);
    material.uniforms.uPixelRatio.value = pixelRatio;
    // Dimming only keeps added light from burning to white; covering particles don't add up.
    const cover = backgroundCover(look.background);
    material.uniforms.uCover.value = cover;
    material.uniforms.uIntensity.value = lightIntensity(count) * (1 - cover) + cover;

    const solid = look.style === 'solid';
    if (solid !== ('NS_SOLID' in material.defines)) {
        if (solid) material.defines.NS_SOLID = '';
        else delete material.defines.NS_SOLID;
        material.transparent = !solid;
        material.depthWrite = solid;
        if (solid) material.blending = THREE.NormalBlending;
        else Object.assign(material, GLOW_BLENDING);
        material.needsUpdate = true;
    }
}
