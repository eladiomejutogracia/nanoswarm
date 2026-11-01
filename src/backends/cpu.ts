import * as THREE from 'three';
import { NO_COLOR, type CompiledFormula, type FormulaFrame } from '../formula';
import type { Look } from '../looks';
import type { Target } from '../sources';
import { FLOW_ESCAPE, particleSeeds, stepFlow, substepsFor, type FlowField } from '../sources/flow';
import { createParticleParams, createSpawnCloud } from '../sources/params';
import { applyLook, createPointsMaterial } from './material';
import { PHYSICS, stepParticles } from './physics';
import type { Backend, FrameInput } from './types';

/** A motion being animated: each particle's own point on the attractor, in native units. */
interface FlowState {
    field: FlowField;
    points: Float32Array;
    seeds: Float32Array;
    k: Float32Array;
    mid: Float32Array;
}

/**
 * CPU backend: physics in a plain Float32Array, drawn as THREE.Points.
 * Needs no float render targets and no vertex-shader textures, so it runs
 * where GPGPU can't (software rendering, old integrated GPUs, some mobiles).
 */
export class CpuBackend implements Backend {
    readonly kind = 'cpu' as const;
    readonly object: THREE.Points;

    private readonly params: Float32Array;
    private readonly rand: Float32Array;
    private readonly positions: Float32Array;
    private readonly velocities: Float32Array;
    private readonly speeds: Float32Array;
    private readonly targets: Float32Array;
    /** Palette position per particle chosen by the formula's `c`, or NO_COLOR. */
    private readonly colors: Float32Array;
    private readonly geometry = new THREE.BufferGeometry();
    private readonly material = createPointsMaterial('cpu');
    /** Reused every frame to avoid allocating in the render loop. */
    private readonly frame: FormulaFrame = { t: 0, bass: 0, mid: 0, treble: 0, level: 0, spectrum: new Float32Array(0) };
    private formula: CompiledFormula | null = null;
    private formulaDirty = false;
    private flow: FlowState | null = null;

    constructor(readonly count: number) {
        this.params = createParticleParams(count);
        this.rand = new Float32Array(count);
        for (let i = 0; i < count; i++) this.rand[i] = this.params[i * 3 + 2];
        this.positions = createSpawnCloud(count);
        this.velocities = new Float32Array(count * 3);
        this.speeds = new Float32Array(count);
        this.targets = new Float32Array(count * 3);
        this.colors = new Float32Array(count).fill(NO_COLOR);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('aSpeed', new THREE.BufferAttribute(this.speeds, 1).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('aRand', new THREE.BufferAttribute(this.rand, 1));
        this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 1).setUsage(THREE.DynamicDrawUsage));
        this.object = new THREE.Points(this.geometry, this.material);
        this.object.frustumCulled = false;
    }

    setTarget(target: Target): void {
        this.formula = null;
        this.flow = null;

        if (target.kind === 'shape') {
            this.formula = target.formula;
            this.formulaDirty = true;
        } else if (target.kind === 'motion') {
            const seeds = particleSeeds(target.field, this.count);
            this.flow = {
                field: target.field,
                points: seeds.slice(),
                seeds,
                k: new Float32Array(this.count * 3),
                mid: new Float32Array(this.count * 3),
            };
            this.writeFlowTargets(this.flow);
        } else {
            this.targets.set(target.sample(this.count));
        }

        const colored = (target.kind === 'shape' && target.formula.program.hasColor)
            || (target.kind === 'motion' && target.field.formula.program.hasColor);
        if (!colored) {
            this.colors.fill(NO_COLOR);
            this.geometry.attributes.aColor.needsUpdate = true;
        }
    }

    setLook(look: Look, pixelRatio: number): void {
        applyLook(this.material, look, this.count, pixelRatio);
    }

    update({ dt, time, speed, bands, spectrum, pointer }: FrameInput): void {
        const f = this.frame;
        f.t = time;
        f.bass = bands.bass;
        f.mid = bands.mid;
        f.treble = bands.treble;
        f.level = bands.level;
        f.spectrum = spectrum;

        const formula = this.formula;
        if (formula && (formula.animated || this.formulaDirty)) {
            const colored = formula.program.hasColor;
            formula.evaluate(this.targets, colored ? this.colors : null, this.params, this.count, f);
            if (colored) this.geometry.attributes.aColor.needsUpdate = true;
            this.formulaDirty = false;
        }

        const flow = this.flow;
        if (flow) {
            const h = Math.min(dt, PHYSICS.maxDelta) * speed * flow.field.stepPerSecond;
            const substeps = substepsFor(flow.field, h);
            const colored = flow.field.formula.program.hasColor;
            for (let s = 0; s < substeps; s++) {
                const last = s === substeps - 1;
                stepFlow(flow.field.formula, flow.points, this.params, this.count, h / substeps, f, flow.k, flow.mid, colored && last ? this.colors : null);
            }
            if (colored) this.geometry.attributes.aColor.needsUpdate = true;
            this.writeFlowTargets(flow);
        }

        stepParticles(this.positions, this.velocities, this.speeds, this.rand, { dt, targets: this.targets, pointer });

        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.aSpeed.needsUpdate = true;
    }

    /** Native flow points → world targets; points that escaped or broke go back to their seed. */
    private writeFlowTargets({ field, points, seeds }: FlowState): void {
        const [cx, cy, cz] = field.center;
        const scale = field.scale;
        const escapeSq = FLOW_ESCAPE * FLOW_ESCAPE;
        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3;
            let x = (points[i3] - cx) * scale;
            let y = (points[i3 + 1] - cy) * scale;
            let z = (points[i3 + 2] - cz) * scale;
            if (!(x * x + y * y + z * z < escapeSq)) { // also catches NaN
                points[i3] = seeds[i3];
                points[i3 + 1] = seeds[i3 + 1];
                points[i3 + 2] = seeds[i3 + 2];
                x = (points[i3] - cx) * scale;
                y = (points[i3 + 1] - cy) * scale;
                z = (points[i3 + 2] - cz) * scale;
            }
            this.targets[i3] = x;
            this.targets[i3 + 1] = y;
            this.targets[i3 + 2] = z;
        }
    }

    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}
