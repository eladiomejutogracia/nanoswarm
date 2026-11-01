import { FormulaError, parseFormula, type Program } from './parse';
import { toGLSL, toJavaScript, type BatchEvaluator } from './emit';

export { FormulaError, INPUTS, FUNCTIONS, CONSTANTS, COLOR_OUTPUT, OUTPUTS, parseFormula } from './parse';
export type { Program, FormulaKind } from './parse';
export { GLSL_PRELUDE, NO_COLOR, type BatchEvaluator, type FormulaFrame } from './emit';

export interface CompiledFormula {
    source: string;
    program: Program;
    /** Fills `out` with xyz (and `colors` if the formula sets `c`) for particles described by `params` (u, v, r). */
    evaluate: BatchEvaluator;
    /** GLSL `vec4 nsFormula(p, t, audio)` → (x, y, z, color) for the GPU backend. */
    glsl: string;
    /** Whether results change over time or with sound (false → evaluate once). */
    animated: boolean;
}

/** Parse and compile a formula. Throws FormulaError with line/col on bad input. */
export function compileFormula(source: string): CompiledFormula {
    const program = parseFormula(source);
    return {
        source,
        program,
        evaluate: toJavaScript(program),
        glsl: toGLSL(program),
        animated: program.usesTime || program.usesAudio,
    };
}

export type FormulaCheck =
    | { ok: true; formula: CompiledFormula }
    | { ok: false; error: FormulaError };

/** Non-throwing variant for editors: report errors as values. */
export function checkFormula(source: string): FormulaCheck {
    try {
        return { ok: true, formula: compileFormula(source) };
    } catch (error) {
        if (error instanceof FormulaError) return { ok: false, error };
        throw error;
    }
}
