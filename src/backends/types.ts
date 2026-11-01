import type * as THREE from 'three';
import type { AudioBands } from '../audio/bands';
import type { Look } from '../looks';
import type { Target } from '../sources';
import type { PointerState } from './physics';

export type BackendKind = 'gpu' | 'cpu';

export interface FrameInput {
    dt: number;
    /** Formula time `t` — already multiplied by speed. */
    time: number;
    /** Pace multiplier: scales how fast motions (dx, dy, dz) advance. */
    speed: number;
    bands: AudioBands;
    /** Log-spaced spectrum for formulas that call spectrum(k). */
    spectrum: Float32Array;
    pointer: PointerState;
}

/**
 * A backend owns the particle simulation and the THREE.Points that draws it.
 * Both backends follow the same physics and draw with the same material,
 * so switching between them changes speed, not looks.
 */
export interface Backend {
    readonly kind: BackendKind;
    readonly count: number;
    readonly object: THREE.Points;
    setTarget(target: Target): void;
    setLook(look: Look, pixelRatio: number): void;
    update(frame: FrameInput): void;
    dispose(): void;
}
