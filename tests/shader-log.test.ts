import { describe, expect, it } from 'vitest';
import { describeShaderFailure, sourceExcerpt } from '../src/runtime/shader-log';

const source = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');

/** The few WebGL calls the report reads, answering from a table. */
function fakeGl(shaders: Record<string, { log: string; source: string }>, programLog = '') {
    return {
        getProgramInfoLog: () => programLog,
        getShaderInfoLog: (shader: string) => shaders[shader]?.log ?? null,
        getShaderSource: (shader: string) => shaders[shader]?.source ?? null,
    } as unknown as WebGL2RenderingContext;
}
const asShader = (name: string) => name as unknown as WebGLShader;

describe('sourceExcerpt', () => {
    it('numbers the lines around the error and marks the failing one', () => {
        expect(sourceExcerpt(source, 6).split('\n')).toEqual([
            '  3: line 3', '  4: line 4', '  5: line 5', '> 6: line 6', '  7: line 7', '  8: line 8', '  9: line 9',
        ]);
    });

    it('stops at the start and the end of the source', () => {
        expect(sourceExcerpt(source, 1).split('\n')[0]).toBe('> 1: line 1');
        expect(sourceExcerpt(source, 1).split('\n')).toHaveLength(4);
        expect(sourceExcerpt(source, 12).split('\n').at(-1)).toBe('> 12: line 12');
    });

    it('does not throw for a line beyond the source', () => {
        expect(sourceExcerpt('a\nb', 99)).toBe('');
    });
});

describe('describeShaderFailure', () => {
    const gl = fakeGl({
        vs: { log: '', source },
        fs: { log: "ERROR: 0:6: 'x' : undeclared identifier\n", source },
    }, 'Fragment shader is not compiled.');

    it("carries the driver's own words, which is what onShaderError used to swallow", () => {
        const text = describeShaderFailure(gl, {} as WebGLProgram, asShader('vs'), asShader('fs'));
        expect(text).toContain('[NanoSwarm] A shader failed to compile or link.');
        expect(text).toContain('Fragment shader is not compiled.');
        expect(text).toContain("Fragment shader:\nERROR: 0:6: 'x' : undeclared identifier");
    });

    it('shows the generated code around the line the driver blames', () => {
        const text = describeShaderFailure(gl, {} as WebGLProgram, asShader('vs'), asShader('fs'));
        expect(text).toContain('> 6: line 6');
        expect(text).toContain('  5: line 5');
    });

    it('leaves out a shader that compiled cleanly', () => {
        expect(describeShaderFailure(gl, {} as WebGLProgram, asShader('vs'), asShader('fs'))).not.toContain('Vertex shader');
    });

    it('still reports an error whose line it cannot read, and a missing log', () => {
        const odd = fakeGl({ vs: { log: 'something broke', source }, fs: { log: '', source } });
        const text = describeShaderFailure(odd, {} as WebGLProgram, asShader('vs'), asShader('fs'));
        expect(text).toContain('Vertex shader:\nsomething broke');
        expect(text).not.toMatch(/> \d+:/);
        const empty = fakeGl({});
        expect(describeShaderFailure(empty, {} as WebGLProgram, asShader('vs'), asShader('fs'))).toBe('[NanoSwarm] A shader failed to compile or link.');
    });
});
