import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { FlowError } from '../src/sources';
import { compileFormula } from '../src/formula';
import { calibrateFlow } from '../src/sources/flow';

/**
 * The v1 contract. Adding to a list is cheap (a minor release); removing or renaming is a major
 * release. If this test fails, you are changing the public API: update API.md in the same commit.
 */
const VALUE_EXPORTS = [
    'ATTRIBUTES', 'ATTRIBUTE_NAMES', 'DEFAULT_VIEW', 'FlowError', 'FormulaError', 'NanoSwarmElement',
    'VERSION', 'createSwarm', 'defineNanoSwarm',
];

const TYPE_EXPORTS = [
    'AttributeName', 'AudioBands', 'AudioSource', 'BackendKind', 'BackendPreference', 'FlowErrorCode',
    'Look', 'LookStyle', 'ModelFormat', 'Source', 'Swarm', 'SwarmInfo', 'SwarmOptions', 'View',
];

/** Names in `export type { … }` clauses and in `type X` specifiers, read from the source text. */
function typeExportsOf(source: string): string[] {
    const code = source.replace(/\/\/.*$/gm, '');
    const names: string[] = [];
    for (const [, kind, list] of code.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
        for (const specifier of list.split(',').map((s) => s.trim()).filter(Boolean)) {
            const typeOnly = Boolean(kind) || specifier.startsWith('type ');
            if (typeOnly) names.push(specifier.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!);
        }
    }
    return names.sort();
}

describe('public API (v1)', () => {
    it('exports exactly the documented values', () => {
        expect(Object.keys(api).sort()).toEqual([...VALUE_EXPORTS].sort());
    });

    it('exports exactly the documented types', () => {
        expect(typeExportsOf(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'))).toEqual([...TYPE_EXPORTS].sort());
    });

    it('exports the createSwarm function, not the Swarm class (Swarm is a type only)', () => {
        expect(typeof api.createSwarm).toBe('function');
        expect('Swarm' in api).toBe(false);
    });

    it('has no setters for what was removed before v1', () => {
        const swarmSource = readFileSync(new URL('../src/swarm.ts', import.meta.url), 'utf8');
        for (const removed of ['setCenterOffset', 'screenshot', 'pause()', 'resume()']) {
            expect(swarmSource).not.toContain(removed);
        }
    });

    it('VERSION is the version in package.json', () => {
        const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(api.VERSION).toBe(version);
    });

    it('DEFAULT_VIEW has the shape of the View type', () => {
        const view: api.View = api.DEFAULT_VIEW;
        expect(Object.keys(view).sort()).toEqual(['distance', 'elevation']);
    });
});

describe('FlowError.code', () => {
    const codeOf = (formula: string) => {
        try { calibrateFlow(compileFormula(formula)); } catch (error) { return (error as FlowError).code; }
        return undefined;
    };

    it('is "diverges" for a motion that runs off to infinity', () => {
        expect(codeOf('dx = x * x + 1\ndy = y\ndz = z')).toBe('diverges');
    });

    it('is "rests" for a motion that settles on a point', () => {
        expect(codeOf('dx = -x\ndy = -y\ndz = -z')).toBe('rests');
    });

    it('is still an Error with a readable message', () => {
        expect(new FlowError('rests', 'text')).toBeInstanceOf(Error);
    });
});
