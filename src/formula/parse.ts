/**
 * The NanoSwarm formula language.
 *
 * A formula is a tiny program: one assignment per line, and it must assign
 * `x`, `y` and `z`. Every particle runs it with its own `u`, `v`, `r`.
 *
 *     R = 4 + bass * 1.5          # locals are allowed
 *     x = R * sin(v/2) * cos(u)
 *     y = R * cos(v/2)
 *     z = R * sin(v/2) * sin(u)
 *
 * The parser builds an AST and validates every identifier against a fixed
 * whitelist. Nothing the user types is ever evaluated as JavaScript or GLSL
 * directly: both backends emit code from the validated AST only.
 */
import { float32Constant, overflowsFloat32 } from './float32';

export type BinaryOp = '+' | '-' | '*' | '/' | '^';

export type Expr =
    | { kind: 'num'; value: number }
    | { kind: 'input'; name: InputName }
    | { kind: 'local'; name: string }
    | { kind: 'neg'; arg: Expr }
    | { kind: 'bin'; op: BinaryOp; left: Expr; right: Expr }
    | { kind: 'call'; fn: FunctionName; args: Expr[] };

export interface Statement {
    name: string;
    expr: Expr;
    line: number;
}

/**
 * 'shape':  assigns x, y, z — where each particle goes.
 * 'motion': assigns dx, dy, dz — how a point at (x, y, z) moves (attractors, flows).
 */
export type FormulaKind = 'shape' | 'motion';

export interface Program {
    kind: FormulaKind;
    statements: Statement[];
    /** True if the result depends on `t` — must be re-evaluated every frame. */
    usesTime: boolean;
    /** True if the result depends on any audio band. */
    usesAudio: boolean;
    /** True if the formula assigns the optional color output `c`. */
    hasColor: boolean;
}

const SHARED_INPUTS = {
    r: 'Per-particle random number, 0 → 1',
    t: 'Time in seconds',
    bass: 'Bass energy, 0 → 1',
    mid: 'Mid-range energy, 0 → 1',
    treble: 'Treble energy, 0 → 1',
    level: 'Overall loudness, 0 → 1',
} as const;

/** Values each kind of formula can read. */
export const INPUTS = {
    shape: {
        u: 'Particle parameter, 0 → 2π',
        v: 'Second particle parameter, 0 → 2π',
        ...SHARED_INPUTS,
    },
    motion: {
        x: 'Where the point is now',
        y: 'Where the point is now',
        z: 'Where the point is now',
        ...SHARED_INPUTS,
    },
} as const;
export type InputName = keyof typeof INPUTS.shape | keyof typeof INPUTS.motion;

export const AUDIO_INPUTS: readonly InputName[] = ['bass', 'mid', 'treble', 'level'];

export const CONSTANTS: Record<string, number> = {
    PI: Math.PI,
    TAU: Math.PI * 2,
    E: Math.E,
};

/** Supported functions and their accepted argument counts. */
export const FUNCTIONS = {
    sin: [1], cos: [1], tan: [1],
    asin: [1], acos: [1], atan: [1, 2],
    sqrt: [1], abs: [1], exp: [1], log: [1],
    floor: [1], ceil: [1], fract: [1], sign: [1],
    min: [2], max: [2], pow: [2], mod: [2], step: [2],
    clamp: [3], mix: [3], smoothstep: [3],
    /** spectrum(k): loudness at frequency k, 0 = deep bass → 1 = high treble. */
    spectrum: [1],
    /** noise(x, y, z): smooth random field in [-1, 1]. */
    noise: [3],
} as const satisfies Record<string, readonly number[]>;
export type FunctionName = keyof typeof FUNCTIONS;

/** Required outputs per kind. */
export const OUTPUTS = {
    shape: ['x', 'y', 'z'],
    motion: ['dx', 'dy', 'dz'],
} as const satisfies Record<FormulaKind, readonly string[]>;
/** Optional output: palette position 0 → 1 for this particle's color. */
export const COLOR_OUTPUT = 'c';

const MAX_SOURCE_LENGTH = 4000;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

export class FormulaError extends Error {
    constructor(message: string, readonly line: number, readonly col: number) {
        super(`Line ${line}, col ${col}: ${message}`);
        this.name = 'FormulaError';
    }
}

// ─── Lexer ──────────────────────────────────────────────────────────

type TokenType = 'num' | 'ident' | 'op' | '(' | ')' | ',' | '=' | 'eol' | 'eof';

interface Token {
    type: TokenType;
    text: string;
    line: number;
    col: number;
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let line = 1;
    let lineStart = 0;
    const push = (type: TokenType, text: string, start: number) =>
        tokens.push({ type, text, line, col: start - lineStart + 1 });

    while (i < source.length) {
        const ch = source[i];

        if (ch === '\n' || ch === ';') {
            push('eol', ch, i);
            i++;
            if (ch === '\n') {
                line++;
                lineStart = i;
            }
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            i++;
            continue;
        }
        if (ch === '#' || (ch === '/' && source[i + 1] === '/')) {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }

        NUMBER_RE.lastIndex = i;
        const num = NUMBER_RE.exec(source);
        if (num) {
            push('num', num[0], i);
            i += num[0].length;
            continue;
        }

        IDENT_RE.lastIndex = i;
        const ident = IDENT_RE.exec(source);
        if (ident) {
            push('ident', ident[0], i);
            i += ident[0].length;
            continue;
        }

        if (ch === '*' && source[i + 1] === '*') {
            push('op', '^', i);
            i += 2;
            continue;
        }
        if ('+-*/^'.includes(ch)) {
            push('op', ch, i);
            i++;
            continue;
        }
        if (ch === '(' || ch === ')' || ch === ',' || ch === '=') {
            push(ch, ch, i);
            i++;
            continue;
        }

        throw new FormulaError(`Unexpected character "${ch}"`, line, i - lineStart + 1);
    }

    push('eof', '', i);
    return tokens;
}

// ─── Parser ─────────────────────────────────────────────────────────

/**
 * Decide the kind from what the formula assigns (identifiers right before "="
 * at the start of a statement). Mixing x/y/z with dx/dy/dz is an error.
 */
function detectKind(tokens: Token[]): FormulaKind {
    let shapeTok: Token | null = null;
    let motionTok: Token | null = null;
    for (let i = 0; i < tokens.length - 1; i++) {
        const atStart = i === 0 || tokens[i - 1].type === 'eol';
        if (!atStart || tokens[i].type !== 'ident' || tokens[i + 1].type !== '=') continue;
        const name = tokens[i].text;
        if ((OUTPUTS.shape as readonly string[]).includes(name)) shapeTok ??= tokens[i];
        if ((OUTPUTS.motion as readonly string[]).includes(name)) motionTok ??= tokens[i];
    }
    if (shapeTok && motionTok) {
        const later = shapeTok.line > motionTok.line ? shapeTok : motionTok;
        throw new FormulaError(
            'Write either x, y, z (a shape) or dx, dy, dz (a motion) — not both',
            later.line,
            later.col,
        );
    }
    return motionTok ? 'motion' : 'shape';
}

class Parser {
    private pos = 0;
    private readonly locals = new Set<string>();
    private readonly inputs: Record<string, string>;
    private usesTime = false;
    private usesAudio = false;

    constructor(private readonly tokens: Token[], private readonly kind: FormulaKind) {
        this.inputs = INPUTS[kind];
    }

    parseProgram(): Program {
        const statements: Statement[] = [];

        for (;;) {
            while (this.peek().type === 'eol') this.pos++;
            if (this.peek().type === 'eof') break;
            statements.push(this.parseStatement());
            const end = this.peek();
            if (end.type !== 'eol' && end.type !== 'eof') {
                throw this.error(end, `Expected end of line, found "${end.text}"`);
            }
        }

        const last = this.peek();
        for (const out of OUTPUTS[this.kind]) {
            if (!this.locals.has(out)) {
                throw new FormulaError(`Missing "${out} = ..."`, last.line, last.col);
            }
        }

        return {
            kind: this.kind,
            statements,
            usesTime: this.usesTime,
            usesAudio: this.usesAudio,
            hasColor: this.locals.has(COLOR_OUTPUT),
        };
    }

    private parseStatement(): Statement {
        const nameTok = this.expect('ident', 'Expected a name like "x = ..."');
        const name = nameTok.text;

        if (Object.hasOwn(this.inputs, name)) {
            const hint = this.kind === 'motion' && 'xyz'.includes(name) ? ` — write d${name} = … to move it` : '';
            throw this.error(nameTok, `"${name}" is a built-in input and cannot be assigned${hint}`);
        }
        if (Object.hasOwn(CONSTANTS, name)) throw this.error(nameTok, `"${name}" is a constant and cannot be assigned`);
        if (Object.hasOwn(FUNCTIONS, name)) throw this.error(nameTok, `"${name}" is a function and cannot be assigned`);
        if (this.locals.has(name)) throw this.error(nameTok, `"${name}" is already defined`);
        // GLSL reserves identifiers containing "__"; keep both backends in sync.
        if (name.includes('__')) throw this.error(nameTok, `Names cannot contain "__"`);
        if (name.length > 32) throw this.error(nameTok, `Name "${name.slice(0, 12)}…" is too long (max 32)`);

        this.expect('=', `Expected "=" after "${name}"`);
        const expr = this.parseExpr();
        this.locals.add(name);
        return { name, expr, line: nameTok.line };
    }

    // expr := term (('+' | '-') term)*
    private parseExpr(): Expr {
        let left = this.parseTerm();
        while (this.isOp('+') || this.isOp('-')) {
            const op = this.next().text as BinaryOp;
            left = { kind: 'bin', op, left, right: this.parseTerm() };
        }
        return left;
    }

    // term := unary (('*' | '/') unary)*
    private parseTerm(): Expr {
        let left = this.parseUnary();
        while (this.isOp('*') || this.isOp('/')) {
            const op = this.next().text as BinaryOp;
            left = { kind: 'bin', op, left, right: this.parseUnary() };
        }
        return left;
    }

    // unary := ('-' | '+') unary | power     →  -x^2 == -(x^2)
    private parseUnary(): Expr {
        if (this.isOp('-')) {
            this.pos++;
            return { kind: 'neg', arg: this.parseUnary() };
        }
        if (this.isOp('+')) {
            this.pos++;
            return this.parseUnary();
        }
        return this.parsePower();
    }

    // power := atom ('^' unary)?           →  right-associative, 2^-1 allowed
    private parsePower(): Expr {
        const base = this.parseAtom();
        if (this.isOp('^')) {
            this.pos++;
            return { kind: 'bin', op: '^', left: base, right: this.parseUnary() };
        }
        return base;
    }

    private parseAtom(): Expr {
        const tok = this.next();

        if (tok.type === 'num') {
            const value = Number(tok.text);
            if (overflowsFloat32(value)) throw this.error(tok, `Number "${tok.text}" is too large (the most a formula can hold is about 3.4e38)`);
            return { kind: 'num', value: float32Constant(value) };
        }

        if (tok.type === '(') {
            const inner = this.parseExpr();
            this.expect(')', 'Missing ")"');
            return inner;
        }

        if (tok.type === 'ident') {
            const name = tok.text;
            if (this.peek().type === '(') return this.parseCall(tok);
            if (Object.hasOwn(FUNCTIONS, name)) throw this.error(tok, `"${name}" is a function — call it like ${name}(...)`);
            if (Object.hasOwn(CONSTANTS, name)) return { kind: 'num', value: float32Constant(CONSTANTS[name]) };
            if (Object.hasOwn(this.inputs, name)) {
                const input = name as InputName;
                if (input === 't') this.usesTime = true;
                if (AUDIO_INPUTS.includes(input)) this.usesAudio = true;
                return { kind: 'input', name: input };
            }
            if (this.locals.has(name)) return { kind: 'local', name };
            if (name === 'u' || name === 'v') {
                throw this.error(tok, `"${name}" only exists in shape formulas (x, y, z); motion formulas read x, y, z instead`);
            }
            throw this.error(tok, `Unknown name "${name}"`);
        }

        if (tok.type === 'eol' || tok.type === 'eof') throw this.error(tok, 'Expression is incomplete');
        throw this.error(tok, `Unexpected "${tok.text}"`);
    }

    private parseCall(nameTok: Token): Expr {
        const name = nameTok.text;
        if (!(Object.hasOwn(FUNCTIONS, name))) throw this.error(nameTok, `Unknown function "${name}"`);
        const fn = name as FunctionName;

        this.expect('(', `Expected "(" after ${fn}`);
        const args: Expr[] = [];
        if (this.peek().type !== ')') {
            args.push(this.parseExpr());
            while (this.peek().type === ',') {
                this.pos++;
                args.push(this.parseExpr());
            }
        }
        this.expect(')', `Missing ")" in ${fn}(...)`);
        if (fn === 'spectrum') this.usesAudio = true;

        const arities: readonly number[] = FUNCTIONS[fn];
        if (!arities.includes(args.length)) {
            const expected = arities.join(' or ');
            throw this.error(nameTok, `${fn}() takes ${expected} argument${expected === '1' ? '' : 's'}, got ${args.length}`);
        }
        return { kind: 'call', fn, args };
    }

    private peek(): Token {
        return this.tokens[this.pos];
    }

    private next(): Token {
        const tok = this.tokens[this.pos];
        if (tok.type !== 'eof') this.pos++;
        return tok;
    }

    private isOp(op: string): boolean {
        const tok = this.peek();
        return tok.type === 'op' && tok.text === op;
    }

    private expect(type: TokenType, message: string): Token {
        const tok = this.peek();
        if (tok.type !== type) throw this.error(tok, message);
        this.pos++;
        return tok;
    }

    private error(tok: Token, message: string): FormulaError {
        return new FormulaError(message, tok.line, tok.col);
    }
}

export function parseFormula(source: string): Program {
    if (source.length > MAX_SOURCE_LENGTH) {
        throw new FormulaError(`Formula is too long (max ${MAX_SOURCE_LENGTH} characters)`, 1, 1);
    }
    const tokens = tokenize(source);
    return new Parser(tokens, detectKind(tokens)).parseProgram();
}
