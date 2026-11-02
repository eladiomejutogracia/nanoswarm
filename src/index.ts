// NanoSwarm — particle swarms shaped by formulas, 3D models and sound.
//
// Most people use the <nano-swarm> element (see ./element). This module is the
// JavaScript API underneath it, for when you want to drive a swarm from code.
//
// Everything exported here is the v1 contract (see API.md); tests/api.test.ts
// pins the list, so widening it is a deliberate change.

// A swarm from code. `Swarm` is a type only: make swarms with createSwarm.
export { createSwarm, type Swarm, type SwarmOptions, type SwarmInfo } from './swarm';
export { VERSION } from './version';
export { DEFAULT_VIEW, type View } from './runtime/view';

// The <nano-swarm> element and its attribute vocabulary
export { NanoSwarmElement, defineNanoSwarm } from './element/element';
export { ATTRIBUTES, ATTRIBUTE_NAMES, type AttributeName } from './element/markup';

// Sources, and the errors a bad one raises (swarm-error carries one of these, or a plain Error)
export type { Source, ModelFormat } from './sources';
export { FlowError, type FlowErrorCode } from './sources';
export { FormulaError } from './formula';

// Looks
export type { Look, LookStyle } from './looks';

// Audio
export type { AudioSource } from './audio/input';
export type { AudioBands } from './audio/bands';

// Backends
export type { BackendPreference } from './backends/select';
export type { BackendKind } from './backends/types';
