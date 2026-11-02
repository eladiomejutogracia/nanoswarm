import { compileFormula, type CompiledFormula } from '../formula';
import { calibrateFlow, type FlowField } from './flow';
import { AnimatedModel } from './animation';
import { detectModelFormat, loadModel, sampleSurface, type ModelFormat, type ModelInput } from './model';
import { normalizePoints, resamplePoints } from './params';

/**
 * What the swarm takes the shape of. There are only two real sources —
 * a formula or a file — plus raw points for programmatic use:
 *
 *   'x = cos(u)\ny = sin(u)\nz = 0'   a formula (shape: x, y, z — or motion: dx, dy, dz)
 *   { formula: '...' }                the same, explicitly
 *   { model: 'bunny.glb' }            a 3D model (URL, File, Blob or ArrayBuffer)
 *   { model: 'fox.glb', animation: 'Walk' }   …playing one of its animations (default: the first)
 *   { points: Float32Array }          your own xyz triplets
 *
 * An empty formula shows DEFAULT_FORMULA.
 */
export type Source =
    | string
    | { formula: string }
    | { model: ModelInput; format?: ModelFormat; animation?: string }
    | { points: Float32Array };

/** What an empty <nano-swarm> (or an empty formula) shows: an evenly spread sphere. */
export const DEFAULT_FORMULA = [
    'y = 4 * (v / PI - 1)',
    'R = sqrt(16 - y*y)',
    'x = R * cos(u)',
    'z = R * sin(u)',
].join('\n');

/** A source resolved into something a backend can follow. */
export type Target =
    | { kind: 'shape'; formula: CompiledFormula }
    | { kind: 'motion'; field: FlowField }
    | { kind: 'points'; sample(count: number): Float32Array }
    | { kind: 'animated'; model: AnimatedModel };

function pointsTarget(sample: (count: number) => Float32Array): Target {
    let cached: { count: number; points: Float32Array } | null = null;
    return {
        kind: 'points',
        sample(count) {
            if (!cached || cached.count !== count) cached = { count, points: sample(count) };
            return cached.points;
        },
    };
}

/** Compile a formula; motions (dx, dy, dz) are also traced once to learn their scale and pace. */
export function formulaTarget(text: string): Target {
    const formula = compileFormula(text.trim() === '' ? DEFAULT_FORMULA : text);
    if (formula.program.kind === 'motion') return { kind: 'motion', field: calibrateFlow(formula) };
    return { kind: 'shape', formula };
}

export async function resolveSource(source: Source): Promise<Target> {
    if (typeof source === 'string') return formulaTarget(source);
    if ('formula' in source) return formulaTarget(source.formula);

    if ('model' in source) {
        const model = await loadModel(source.model, source.format, source.animation);
        if (model instanceof AnimatedModel) return { kind: 'animated', model };
        return pointsTarget((count) => sampleSurface(model, count));
    }

    if ('points' in source) {
        const base = normalizePoints(source.points.slice());
        return pointsTarget((count) => resamplePoints(base, count));
    }

    throw new Error('[NanoSwarm] Unsupported source.');
}

const AUDIO_EXTENSION_RE = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i;

/** Tell a dropped file apart: is it a model to shape the swarm, or a song to drive it? */
export function detectSourceKind(file: { name: string; type?: string }): 'model' | 'audio' | null {
    if (detectModelFormat(file.name)) return 'model';
    if (file.type?.startsWith('audio/') || AUDIO_EXTENSION_RE.test(file.name)) return 'audio';
    return null;
}

export { FlowError, type FlowErrorCode, type FlowField } from './flow';
export { detectModelFormat, type ModelFormat, type ModelInput };
