/**
 * The swarm's motion model, shared by both backends.
 *
 * Every particle is pulled towards its target by a spring whose stiffness
 * varies per particle (organic, staggered morphs), with a swirl that only
 * exists while the particle is away from its target, a pointer that pushes
 * particles away, and exponential damping. Semi-implicit Euler.
 *
 * `PHYSICS_GLSL` below is the exact same math for the GPU backend —
 * change one, change the other (tests/physics.test.ts guards the JS side).
 *
 * A particle whose position or velocity stops being a finite float32 (a
 * target at 1e38 overflows the spring, say) goes back to its target at rest,
 * so no formula can lose particles for good.
 */
export const PHYSICS = {
    stiffness: 18,
    /** Per-particle stiffness = stiffness × (spreadMin + spreadRange × r). */
    spreadMin: 0.55,
    spreadRange: 0.9,
    damping: 4.5,
    swirl: 3,
    pointerRadius: 1.6,
    pointerForce: 60,
    /** Larger frame gaps are clamped so a background tab can't explode the swarm. */
    maxDelta: 1 / 30,
} as const;

export interface PointerState {
    active: boolean;
    x: number;
    y: number;
    z: number;
}

export interface StepInput {
    dt: number;
    targets: Float32Array;
    pointer: PointerState;
}

const finiteOrZero = (x: number) => (Number.isFinite(x) ? x : 0);

/** Advance positions and velocities in place. `speeds` receives |velocity| for coloring. */
export function stepParticles(
    positions: Float32Array,
    velocities: Float32Array,
    speeds: Float32Array,
    rand: Float32Array,
    { dt, targets, pointer }: StepInput,
): void {
    const count = rand.length;
    const h = Math.min(dt, PHYSICS.maxDelta);
    const keep = Math.exp(-PHYSICS.damping * h);
    const swirl = PHYSICS.swirl * h;
    const radius = PHYSICS.pointerRadius;
    const radiusSq = radius * radius;
    const push = PHYSICS.pointerForce * h;

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const px = positions[i3], py = positions[i3 + 1], pz = positions[i3 + 2];
        let vx = velocities[i3], vy = velocities[i3 + 1], vz = velocities[i3 + 2];

        const dx = targets[i3] - px;
        const dy = targets[i3 + 1] - py;
        const dz = targets[i3 + 2] - pz;

        const k = PHYSICS.stiffness * (PHYSICS.spreadMin + PHYSICS.spreadRange * rand[i]) * h;
        vx += dx * k + dz * swirl;
        vy += dy * k;
        vz += dz * k - dx * swirl;

        if (pointer.active) {
            const ox = px - pointer.x, oy = py - pointer.y, oz = pz - pointer.z;
            const distSq = ox * ox + oy * oy + oz * oz;
            if (distSq < radiusSq && distSq > 1e-8) {
                const dist = Math.sqrt(distSq);
                const f = (1 - dist / radius) * push / dist;
                vx += ox * f;
                vy += oy * f;
                vz += oz * f;
            }
        }

        // Math.fround: judge the numbers as the Float32Arrays will store them.
        vx = Math.fround(vx * keep);
        vy = Math.fround(vy * keep);
        vz = Math.fround(vz * keep);
        let nx = Math.fround(px + vx * h);
        let ny = Math.fround(py + vy * h);
        let nz = Math.fround(pz + vz * h);

        if (!Number.isFinite(vx + vy + vz + nx + ny + nz)) {
            vx = vy = vz = 0;
            nx = finiteOrZero(targets[i3]);
            ny = finiteOrZero(targets[i3 + 1]);
            nz = finiteOrZero(targets[i3 + 2]);
        }

        velocities[i3] = vx;
        velocities[i3 + 1] = vy;
        velocities[i3 + 2] = vz;
        positions[i3] = nx;
        positions[i3 + 1] = ny;
        positions[i3 + 2] = nz;
        speeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
}

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * GLSL twin of stepParticles for one particle: the new velocity and position.
 * Both physics passes call it with the same inputs, so they always agree.
 */
export const PHYSICS_GLSL = /* glsl */ `
uniform float uDelta;
uniform vec4  uPointer; // xyz + active flag

// Checks the exponent bits: fast-math compilers may delete isnan/isinf calls.
bool nsNotFinite(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
bool nsNotFinite(vec3 v) { return nsNotFinite(v.x) || nsNotFinite(v.y) || nsNotFinite(v.z); }

void nsStep(vec3 pos, vec3 vel, vec3 target, float r, out vec3 newVel, out vec3 newPos) {
    float h = min(uDelta, ${f(PHYSICS.maxDelta)});
    vec3 d = target - pos;
    float k = ${f(PHYSICS.stiffness)} * (${f(PHYSICS.spreadMin)} + ${f(PHYSICS.spreadRange)} * r) * h;
    float swirl = ${f(PHYSICS.swirl)} * h;
    vel += d * k + vec3(d.z, 0.0, -d.x) * swirl;

    if (uPointer.w > 0.5) {
        vec3 o = pos - uPointer.xyz;
        float distSq = dot(o, o);
        float radius = ${f(PHYSICS.pointerRadius)};
        if (distSq < radius * radius && distSq > 1e-8) {
            float dist = sqrt(distSq);
            vel += o * ((1.0 - dist / radius) * ${f(PHYSICS.pointerForce)} * h / dist);
        }
    }

    vel *= exp(${f(-PHYSICS.damping)} * h);
    vec3 next = pos + vel * h;
    if (nsNotFinite(vel) || nsNotFinite(next)) {
        vel = vec3(0.0);
        next = nsNotFinite(target) ? vec3(0.0) : target;
    }
    newVel = vel;
    newPos = next;
}
`;
