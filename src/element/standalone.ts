// Entry for the drop-in script: <script src="nano-swarm.js"></script>.
// Bundles three.js and registers <nano-swarm> right away.
import { defineNanoSwarm } from './element';

defineNanoSwarm();

export * from '../index';
export { NanoSwarmElement, defineNanoSwarm } from './element';
