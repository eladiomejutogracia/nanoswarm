/**
 * noise(x, y, z): smooth 3D value noise in [-1, 1].
 *
 * The lattice hash uses 32-bit integer math only, which JavaScript
 * (Math.imul, >>>) and GLSL ES 3.0 (uint) compute bit-for-bit the same —
 * so the CPU and GPU backends draw the same pattern. (The usual
 * fract(sin(x) * 43758.5) hash depends on each GPU's float precision.)
 */

const K1 = 0x8da6b343;
const K2 = 0xd8163841;
const K3 = 0xcb1ab31f;
const K4 = 0x5bd1e995;

/** Integer lattice point → [0, 1). */
export function latticeHash(ix: number, iy: number, iz: number): number {
    let h = Math.imul(ix | 0, K1) ^ Math.imul(iy | 0, K2) ^ Math.imul(iz | 0, K3);
    h = Math.imul(h ^ (h >>> 13), K4);
    h ^= h >>> 15;
    return (h & 0xffffff) / 16777216;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function valueNoise3(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const ux = fade(x - ix), uy = fade(y - iy), uz = fade(z - iz);

    const c000 = latticeHash(ix, iy, iz), c100 = latticeHash(ix + 1, iy, iz);
    const c010 = latticeHash(ix, iy + 1, iz), c110 = latticeHash(ix + 1, iy + 1, iz);
    const c001 = latticeHash(ix, iy, iz + 1), c101 = latticeHash(ix + 1, iy, iz + 1);
    const c011 = latticeHash(ix, iy + 1, iz + 1), c111 = latticeHash(ix + 1, iy + 1, iz + 1);

    const value = lerp(
        lerp(lerp(c000, c100, ux), lerp(c010, c110, ux), uy),
        lerp(lerp(c001, c101, ux), lerp(c011, c111, ux), uy),
        uz,
    );
    return value * 2 - 1;
}

const hex = (n: number) => `0x${n.toString(16)}u`;

export const NOISE_GLSL = /* glsl */ `
float nsHash(ivec3 c) {
    uint h = (uint(c.x) * ${hex(K1)}) ^ (uint(c.y) * ${hex(K2)}) ^ (uint(c.z) * ${hex(K3)});
    h = (h ^ (h >> 13u)) * ${hex(K4)};
    h ^= h >> 15u;
    return float(h & 0xffffffu) / 16777216.0;
}
float nsNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * (3.0 - 2.0 * f);
    ivec3 c = ivec3(i);
    float v = mix(
        mix(mix(nsHash(c), nsHash(c + ivec3(1, 0, 0)), u.x),
            mix(nsHash(c + ivec3(0, 1, 0)), nsHash(c + ivec3(1, 1, 0)), u.x), u.y),
        mix(mix(nsHash(c + ivec3(0, 0, 1)), nsHash(c + ivec3(1, 0, 1)), u.x),
            mix(nsHash(c + ivec3(0, 1, 1)), nsHash(c + ivec3(1, 1, 1)), u.x), u.y),
        u.z);
    return v * 2.0 - 1.0;
}
`;
