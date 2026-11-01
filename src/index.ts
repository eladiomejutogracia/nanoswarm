// NanoSwarm — particle swarms shaped by formulas, 3D models and sound.
//
// Most people use the <nano-swarm> element (see ./element). This module is the
// JavaScript API underneath it, for when you want to drive a swarm from code.

export { createSwarm, Swarm, type SwarmOptions, type SwarmInfo } from './swarm';
export { DEFAULT_VIEW } from './runtime/view';

// The <nano-swarm> element and its vocabulary
export { NanoSwarmElement, defineNanoSwarm } from './element/element';
export {
    ATTRIBUTES,
    ATTRIBUTE_NAMES,
    formatMarkup,
    parseMarkup,
    readOptions,
    type AttributeName,
    type SwarmMarkup,
} from './element/markup';

// Sources: a formula or a file
export { detectSourceKind, FlowError, type Source, type ModelFormat } from './sources';

// Formulas
export {
    compileFormula,
    checkFormula,
    FormulaError,
    INPUTS,
    FUNCTIONS,
    type CompiledFormula,
    type FormulaCheck,
    type FormulaKind,
} from './formula';

// Looks
export type { Look, LookStyle } from './looks';

// Audio
export type { AudioSource } from './audio/input';
export type { AudioBands } from './audio/bands';

// Backends
export type { BackendPreference } from './backends/select';
export type { BackendKind } from './backends/types';
