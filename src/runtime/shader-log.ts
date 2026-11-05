/**
 * What the driver said when a shader failed to compile or link.
 *
 * three.js only prints this when `renderer.debug.onShaderError` is not set, and there is no
 * exported default handler to call — so we print the same facts ourselves: the program log,
 * both shader logs, and the source lines around the first error.
 */
type GlLike = WebGLRenderingContext | WebGL2RenderingContext;

const CONTEXT_LINES = 3;

/** Numbered source lines around `line` (1-based), so the message points at the generated code. */
export function sourceExcerpt(source: string, line: number): string {
    const lines = source.split('\n');
    const from = Math.max(0, line - 1 - CONTEXT_LINES);
    const to = Math.min(lines.length, line + CONTEXT_LINES);
    return lines.slice(from, to).map((text, i) => `${from + i + 1 === line ? '>' : ' '} ${from + i + 1}: ${text}`).join('\n');
}

function shaderReport(gl: GlLike, shader: WebGLShader, type: string): string {
    const log = (gl.getShaderInfoLog(shader) ?? '').trim();
    if (log === '') return '';
    const at = /ERROR: \d+:(\d+)/.exec(log);
    const excerpt = at ? `\n${sourceExcerpt(gl.getShaderSource(shader) ?? '', Number(at[1]))}` : '';
    return `${type} shader:\n${log}${excerpt}`;
}

export function describeShaderFailure(gl: GlLike, program: WebGLProgram, vertex: WebGLShader, fragment: WebGLShader): string {
    return [
        '[NanoSwarm] A shader failed to compile or link.',
        (gl.getProgramInfoLog(program) ?? '').trim(),
        shaderReport(gl, vertex, 'Vertex'),
        shaderReport(gl, fragment, 'Fragment'),
    ].filter((part) => part !== '').join('\n\n');
}
