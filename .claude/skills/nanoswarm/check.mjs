#!/usr/bin/env node
// Generated from src/element/cli.ts by `npm run build:check`. Do not edit.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// src/formula/parse.ts
var SHARED_INPUTS = {
	r: "Per-particle random number, 0 → 1",
	t: "Time in seconds",
	bass: "Bass energy, 0 → 1",
	mid: "Mid-range energy, 0 → 1",
	treble: "Treble energy, 0 → 1",
	level: "Overall loudness, 0 → 1"
};
/** Values each kind of formula can read. */
var INPUTS = {
	shape: {
		u: "Particle parameter, 0 → 2π",
		v: "Second particle parameter, 0 → 2π",
		...SHARED_INPUTS
	},
	motion: {
		x: "Where the point is now",
		y: "Where the point is now",
		z: "Where the point is now",
		...SHARED_INPUTS
	}
};
var AUDIO_INPUTS = [
	"bass",
	"mid",
	"treble",
	"level"
];
var CONSTANTS = {
	PI: Math.PI,
	TAU: Math.PI * 2,
	E: Math.E
};
/** Supported functions and their accepted argument counts. */
var FUNCTIONS = {
	sin: [1],
	cos: [1],
	tan: [1],
	asin: [1],
	acos: [1],
	atan: [1, 2],
	sqrt: [1],
	abs: [1],
	exp: [1],
	log: [1],
	floor: [1],
	ceil: [1],
	fract: [1],
	sign: [1],
	min: [2],
	max: [2],
	pow: [2],
	mod: [2],
	step: [2],
	clamp: [3],
	mix: [3],
	smoothstep: [3],
	/** spectrum(k): loudness at frequency k, 0 = deep bass → 1 = high treble. */
	spectrum: [1],
	/** noise(x, y, z): smooth random field in [-1, 1]. */
	noise: [3]
};
/** Required outputs per kind. */
var OUTPUTS = {
	shape: [
		"x",
		"y",
		"z"
	],
	motion: [
		"dx",
		"dy",
		"dz"
	]
};
var MAX_SOURCE_LENGTH = 4e3;
var IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
var NUMBER_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
var FormulaError = class extends Error {
	line;
	col;
	constructor(message, line, col) {
		super(`Line ${line}, col ${col}: ${message}`);
		this.line = line;
		this.col = col;
		this.name = "FormulaError";
	}
};
function tokenize(source) {
	const tokens = [];
	let i = 0;
	let line = 1;
	let lineStart = 0;
	const push = (type, text, start) => tokens.push({
		type,
		text,
		line,
		col: start - lineStart + 1
	});
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\n" || ch === ";") {
			push("eol", ch, i);
			i++;
			if (ch === "\n") {
				line++;
				lineStart = i;
			}
			continue;
		}
		if (ch === " " || ch === "	" || ch === "\r") {
			i++;
			continue;
		}
		if (ch === "#" || ch === "/" && source[i + 1] === "/") {
			while (i < source.length && source[i] !== "\n") i++;
			continue;
		}
		NUMBER_RE.lastIndex = i;
		const num = NUMBER_RE.exec(source);
		if (num) {
			push("num", num[0], i);
			i += num[0].length;
			continue;
		}
		IDENT_RE.lastIndex = i;
		const ident = IDENT_RE.exec(source);
		if (ident) {
			push("ident", ident[0], i);
			i += ident[0].length;
			continue;
		}
		if (ch === "*" && source[i + 1] === "*") {
			push("op", "^", i);
			i += 2;
			continue;
		}
		if ("+-*/^".includes(ch)) {
			push("op", ch, i);
			i++;
			continue;
		}
		if (ch === "(" || ch === ")" || ch === "," || ch === "=") {
			push(ch, ch, i);
			i++;
			continue;
		}
		throw new FormulaError(`Unexpected character "${ch}"`, line, i - lineStart + 1);
	}
	push("eof", "", i);
	return tokens;
}
/**
* Decide the kind from what the formula assigns (identifiers right before "="
* at the start of a statement). Mixing x/y/z with dx/dy/dz is an error.
*/
function detectKind(tokens) {
	let shapeTok = null;
	let motionTok = null;
	for (let i = 0; i < tokens.length - 1; i++) {
		if (!(i === 0 || tokens[i - 1].type === "eol") || tokens[i].type !== "ident" || tokens[i + 1].type !== "=") continue;
		const name = tokens[i].text;
		if (OUTPUTS.shape.includes(name)) shapeTok ??= tokens[i];
		if (OUTPUTS.motion.includes(name)) motionTok ??= tokens[i];
	}
	if (shapeTok && motionTok) {
		const later = shapeTok.line > motionTok.line ? shapeTok : motionTok;
		throw new FormulaError("Write either x, y, z (a shape) or dx, dy, dz (a motion) — not both", later.line, later.col);
	}
	return motionTok ? "motion" : "shape";
}
var Parser = class {
	tokens;
	kind;
	pos = 0;
	locals = /* @__PURE__ */ new Set();
	inputs;
	usesTime = false;
	usesAudio = false;
	constructor(tokens, kind) {
		this.tokens = tokens;
		this.kind = kind;
		this.inputs = INPUTS[kind];
	}
	parseProgram() {
		const statements = [];
		for (;;) {
			while (this.peek().type === "eol") this.pos++;
			if (this.peek().type === "eof") break;
			statements.push(this.parseStatement());
			const end = this.peek();
			if (end.type !== "eol" && end.type !== "eof") throw this.error(end, `Expected end of line, found "${end.text}"`);
		}
		const last = this.peek();
		for (const out of OUTPUTS[this.kind]) if (!this.locals.has(out)) throw new FormulaError(`Missing "${out} = ..."`, last.line, last.col);
		return {
			kind: this.kind,
			statements,
			usesTime: this.usesTime,
			usesAudio: this.usesAudio,
			hasColor: this.locals.has("c")
		};
	}
	parseStatement() {
		const nameTok = this.expect("ident", "Expected a name like \"x = ...\"");
		const name = nameTok.text;
		if (Object.hasOwn(this.inputs, name)) {
			const hint = this.kind === "motion" && "xyz".includes(name) ? ` — write d${name} = … to move it` : "";
			throw this.error(nameTok, `"${name}" is a built-in input and cannot be assigned${hint}`);
		}
		if (Object.hasOwn(CONSTANTS, name)) throw this.error(nameTok, `"${name}" is a constant and cannot be assigned`);
		if (Object.hasOwn(FUNCTIONS, name)) throw this.error(nameTok, `"${name}" is a function and cannot be assigned`);
		if (this.locals.has(name)) throw this.error(nameTok, `"${name}" is already defined`);
		if (name.includes("__")) throw this.error(nameTok, `Names cannot contain "__"`);
		if (name.length > 32) throw this.error(nameTok, `Name "${name.slice(0, 12)}…" is too long (max 32)`);
		this.expect("=", `Expected "=" after "${name}"`);
		const expr = this.parseExpr();
		this.locals.add(name);
		return {
			name,
			expr,
			line: nameTok.line
		};
	}
	parseExpr() {
		let left = this.parseTerm();
		while (this.isOp("+") || this.isOp("-")) left = {
			kind: "bin",
			op: this.next().text,
			left,
			right: this.parseTerm()
		};
		return left;
	}
	parseTerm() {
		let left = this.parseUnary();
		while (this.isOp("*") || this.isOp("/")) left = {
			kind: "bin",
			op: this.next().text,
			left,
			right: this.parseUnary()
		};
		return left;
	}
	parseUnary() {
		if (this.isOp("-")) {
			this.pos++;
			return {
				kind: "neg",
				arg: this.parseUnary()
			};
		}
		if (this.isOp("+")) {
			this.pos++;
			return this.parseUnary();
		}
		return this.parsePower();
	}
	parsePower() {
		const base = this.parseAtom();
		if (this.isOp("^")) {
			this.pos++;
			return {
				kind: "bin",
				op: "^",
				left: base,
				right: this.parseUnary()
			};
		}
		return base;
	}
	parseAtom() {
		const tok = this.next();
		if (tok.type === "num") {
			const value = Number(tok.text);
			if (!Number.isFinite(value)) throw this.error(tok, `Number "${tok.text}" is too large`);
			return {
				kind: "num",
				value
			};
		}
		if (tok.type === "(") {
			const inner = this.parseExpr();
			this.expect(")", "Missing \")\"");
			return inner;
		}
		if (tok.type === "ident") {
			const name = tok.text;
			if (this.peek().type === "(") return this.parseCall(tok);
			if (Object.hasOwn(FUNCTIONS, name)) throw this.error(tok, `"${name}" is a function — call it like ${name}(...)`);
			if (Object.hasOwn(CONSTANTS, name)) return {
				kind: "num",
				value: CONSTANTS[name]
			};
			if (Object.hasOwn(this.inputs, name)) {
				const input = name;
				if (input === "t") this.usesTime = true;
				if (AUDIO_INPUTS.includes(input)) this.usesAudio = true;
				return {
					kind: "input",
					name: input
				};
			}
			if (this.locals.has(name)) return {
				kind: "local",
				name
			};
			if (name === "u" || name === "v") throw this.error(tok, `"${name}" only exists in shape formulas (x, y, z); motion formulas read x, y, z instead`);
			throw this.error(tok, `Unknown name "${name}"`);
		}
		if (tok.type === "eol" || tok.type === "eof") throw this.error(tok, "Expression is incomplete");
		throw this.error(tok, `Unexpected "${tok.text}"`);
	}
	parseCall(nameTok) {
		const name = nameTok.text;
		if (!Object.hasOwn(FUNCTIONS, name)) throw this.error(nameTok, `Unknown function "${name}"`);
		const fn = name;
		this.expect("(", `Expected "(" after ${fn}`);
		const args = [];
		if (this.peek().type !== ")") {
			args.push(this.parseExpr());
			while (this.peek().type === ",") {
				this.pos++;
				args.push(this.parseExpr());
			}
		}
		this.expect(")", `Missing ")" in ${fn}(...)`);
		if (fn === "spectrum") this.usesAudio = true;
		const arities = FUNCTIONS[fn];
		if (!arities.includes(args.length)) {
			const expected = arities.join(" or ");
			throw this.error(nameTok, `${fn}() takes ${expected} argument${expected === "1" ? "" : "s"}, got ${args.length}`);
		}
		return {
			kind: "call",
			fn,
			args
		};
	}
	peek() {
		return this.tokens[this.pos];
	}
	next() {
		const tok = this.tokens[this.pos];
		if (tok.type !== "eof") this.pos++;
		return tok;
	}
	isOp(op) {
		const tok = this.peek();
		return tok.type === "op" && tok.text === op;
	}
	expect(type, message) {
		const tok = this.peek();
		if (tok.type !== type) throw this.error(tok, message);
		this.pos++;
		return tok;
	}
	error(tok, message) {
		return new FormulaError(message, tok.line, tok.col);
	}
};
function parseFormula(source) {
	if (source.length > MAX_SOURCE_LENGTH) throw new FormulaError(`Formula is too long (max ${MAX_SOURCE_LENGTH} characters)`, 1, 1);
	const tokens = tokenize(source);
	return new Parser(tokens, detectKind(tokens)).parseProgram();
}
// src/formula/noise.ts
/**
* noise(x, y, z): smooth 3D value noise in [-1, 1].
*
* The lattice hash uses 32-bit integer math only, which JavaScript
* (Math.imul, >>>) and GLSL ES 3.0 (uint) compute bit-for-bit the same —
* so the CPU and GPU backends draw the same pattern. (The usual
* fract(sin(x) * 43758.5) hash depends on each GPU's float precision.)
*/
var K1 = 2376512323;
var K2 = 3625334849;
var K3 = 3407524639;
var K4 = 1540483477;
/** Integer lattice point → [0, 1). */
function latticeHash(ix, iy, iz) {
	let h = Math.imul(ix | 0, K1) ^ Math.imul(iy | 0, K2) ^ Math.imul(iz | 0, K3);
	h = Math.imul(h ^ h >>> 13, K4);
	h ^= h >>> 15;
	return (h & 16777215) / 16777216;
}
var fade = (t) => t * t * (3 - 2 * t);
var lerp = (a, b, t) => a + (b - a) * t;
function valueNoise3(x, y, z) {
	const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
	const ux = fade(x - ix), uy = fade(y - iy), uz = fade(z - iz);
	const c000 = latticeHash(ix, iy, iz), c100 = latticeHash(ix + 1, iy, iz);
	const c010 = latticeHash(ix, iy + 1, iz), c110 = latticeHash(ix + 1, iy + 1, iz);
	const c001 = latticeHash(ix, iy, iz + 1), c101 = latticeHash(ix + 1, iy, iz + 1);
	const c011 = latticeHash(ix, iy + 1, iz + 1), c111 = latticeHash(ix + 1, iy + 1, iz + 1);
	return lerp(lerp(lerp(c000, c100, ux), lerp(c010, c110, ux), uy), lerp(lerp(c001, c101, ux), lerp(c011, c111, ux), uy), uz) * 2 - 1;
}
var hex = (n) => `0x${n.toString(16)}u`;
var NOISE_GLSL = `
float nsHash(ivec3 c) {
    uint h = (uint(c.x) * ${hex(K1)}) ^ (uint(c.y) * ${hex(K2)}) ^ (uint(c.z) * ${hex(K3)});
    h = (h ^ (h >> 13u)) * ${hex(K4)};
    h ^= h >> 15u;
    return float(h & 0xffffffu) / 16777216.0;
}
float nsNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * (3.0 - 2.0 * f);
    ivec3 c = ivec3(i);
    float v = mix(
        mix(mix(nsHash(c), nsHash(c + ivec3(1, 0, 0)), u.x),
            mix(nsHash(c + ivec3(0, 1, 0)), nsHash(c + ivec3(1, 1, 0)), u.x), u.y),
        mix(mix(nsHash(c + ivec3(0, 0, 1)), nsHash(c + ivec3(1, 0, 1)), u.x),
            mix(nsHash(c + ivec3(0, 1, 1)), nsHash(c + ivec3(1, 1, 1)), u.x), u.y),
        u.z);
    return v * 2.0 - 1.0;
}
`;
/** Runtime helpers that mirror GLSL built-ins exactly. */
var JS_HELPERS = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: (a, b) => b === void 0 ? Math.atan(a) : Math.atan2(a, b),
	sqrt: Math.sqrt,
	abs: Math.abs,
	exp: Math.exp,
	log: Math.log,
	floor: Math.floor,
	ceil: Math.ceil,
	sign: Math.sign,
	fract: (x) => x - Math.floor(x),
	min: Math.min,
	max: Math.max,
	pow: signedPow,
	mod: (x, y) => x - y * Math.floor(x / y),
	step: (edge, x) => x < edge ? 0 : 1,
	clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
	mix: (a, b, k) => a + (b - a) * k,
	smoothstep: (e0, e1, x) => {
		const k = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
		return k * k * (3 - 2 * k);
	},
	noise: valueNoise3
};
/** spectrum(k): linear interpolation over the log-spaced spectrum slices, k clamped to [0, 1]. */
function sampleSpectrum(spectrum, k) {
	const n = spectrum.length;
	if (n === 0 || !(k === k)) return 0;
	const x = Math.min(Math.max(k, 0), 1) * (n - 1);
	const i = Math.floor(x);
	const j = Math.min(i + 1, n - 1);
	return spectrum[i] + (spectrum[j] - spectrum[i]) * (x - i);
}
/** `pow` that keeps the sign for negative bases with integer exponents: (-2)^3 = -8. */
function signedPow(base, exp) {
	if (base < 0 && Number.isInteger(exp)) {
		const magnitude = Math.pow(-base, exp);
		return exp % 2 === 0 ? magnitude : -magnitude;
	}
	return Math.pow(base, exp);
}
var JS_BINARY = {
	"+": "+",
	"-": "-",
	"*": "*",
	"/": "/"
};
function jsExpr(e) {
	switch (e.kind) {
		case "num": return `(${e.value})`;
		case "input": return e.name;
		case "local": return `l_${e.name}`;
		case "neg": return `(-${jsExpr(e.arg)})`;
		case "bin":
			if (e.op === "^") return `H.pow(${jsExpr(e.left)}, ${jsExpr(e.right)})`;
			return `(${jsExpr(e.left)} ${JS_BINARY[e.op]} ${jsExpr(e.right)})`;
		case "call":
			if (e.fn === "spectrum") return `SP(S, ${jsExpr(e.args[0])})`;
			return `H.${e.fn}(${e.args.map(jsExpr).join(", ")})`;
	}
}
function toJavaScriptSource(program) {
	const body = program.statements.map((s) => `        const l_${s.name} = ${jsExpr(s.expr)};`).join("\n");
	const color = program.hasColor ? `        if (C !== null) C[i] = l_c === l_c ? (l_c < 0 ? 0 : l_c > 1 ? 1 : l_c) : 0;\n` : "";
	const motion = program.kind === "motion";
	const read = motion ? "const x = P[i3], y = P[i3 + 1], z = P[i3 + 2], r = params[i3 + 2];" : "const u = params[i3], v = params[i3 + 1], r = params[i3 + 2];";
	const [ox, oy, oz] = motion ? [
		"l_dx",
		"l_dy",
		"l_dz"
	] : [
		"l_x",
		"l_y",
		"l_z"
	];
	return `"use strict";
return function nsFormula(out, C, params, count, f, P) {
    const t = f.t, bass = f.bass, mid = f.mid, treble = f.treble, level = f.level, S = f.spectrum;
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        ${read}
${body}
        out[i3]     = Number.isFinite(${ox}) ? ${ox} : 0;
        out[i3 + 1] = Number.isFinite(${oy}) ? ${oy} : 0;
        out[i3 + 2] = Number.isFinite(${oz}) ? ${oz} : 0;
${color}    }
};`;
}
function toJavaScript(program) {
	return new Function("H", "SP", toJavaScriptSource(program))(JS_HELPERS, sampleSpectrum);
}
`${NOISE_GLSL}`;
function glslNumber(value) {
	const text = String(value);
	return /[.eE]/.test(text) ? text : `${text}.0`;
}
function glslExpr(e) {
	switch (e.kind) {
		case "num": return `(${glslNumber(e.value)})`;
		case "input": return `in_${e.name}`;
		case "local": return `l_${e.name}`;
		case "neg": return `(-${glslExpr(e.arg)})`;
		case "bin":
			if (e.op === "^") return `nsPow(${glslExpr(e.left)}, ${glslExpr(e.right)})`;
			return `(${glslExpr(e.left)} ${e.op} ${glslExpr(e.right)})`;
		case "call": {
			const args = e.args.map(glslExpr).join(", ");
			if (e.fn === "pow") return `nsPow(${args})`;
			if (e.fn === "spectrum") return `nsSpectrum(${args})`;
			if (e.fn === "noise") return `nsNoise(vec3(${args}))`;
			return `${e.fn}(${args})`;
		}
	}
}
/**
* Shapes:  `vec4 nsFormula(vec3 p, float t, vec4 audio)` → (x, y, z, color)
* Motions: `vec4 nsMotion(vec3 pos, vec3 p, float t, vec4 audio)` → (dx, dy, dz, color)
* where p = (u, v, r) and audio = (bass, mid, treble, level). Color is in
* [0, 1], or NO_COLOR if the formula has no `c`. Requires GLSL_PRELUDE.
*/
function toGLSL(program) {
	const body = program.statements.map((s) => `    float l_${s.name} = ${glslExpr(s.expr)};`).join("\n");
	const color = program.hasColor ? "clamp(nsFinite(l_c), 0.0, 1.0)" : `-1.0`;
	const shared = "float in_r = p.z; float in_t = t;\n    float in_bass = audio.x; float in_mid = audio.y; float in_treble = audio.z; float in_level = audio.w;";
	if (program.kind === "motion") return `
vec4 nsMotion(vec3 pos, vec3 p, float t, vec4 audio) {
    float in_x = pos.x; float in_y = pos.y; float in_z = pos.z;
    ${shared}
${body}
    return vec4(nsFinite(l_dx), nsFinite(l_dy), nsFinite(l_dz), ${color});
}
`;
	return `
vec4 nsFormula(vec3 p, float t, vec4 audio) {
    float in_u = p.x; float in_v = p.y;
    ${shared}
${body}
    return vec4(nsFinite(l_x), nsFinite(l_y), nsFinite(l_z), ${color});
}
`;
}
// src/formula/index.ts
/** Parse and compile a formula. Throws FormulaError with line/col on bad input. */
function compileFormula(source) {
	const program = parseFormula(source);
	return {
		source,
		program,
		evaluate: toJavaScript(program),
		glsl: toGLSL(program),
		animated: program.usesTime || program.usesAudio
	};
}
/** Non-throwing variant for editors: report errors as values. */
function checkFormula(source) {
	try {
		return {
			ok: true,
			formula: compileFormula(source)
		};
	} catch (error) {
		if (error instanceof FormulaError) return {
			ok: false,
			error
		};
		throw error;
	}
}
// src/sources/params.ts
var TAU = Math.PI * 2;
var R2_A = .7548776662466927;
var R2_B = .5698402909980532;
/** Small deterministic PRNG so every particle keeps the same `r` across rebuilds. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 >>> 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
/**
* Per-particle formula inputs, packed as (u, v, r) triplets.
* u, v ∈ [0, 2π) evenly distributed; r ∈ [0, 1) random.
*/
function createParticleParams(count, seed = 1) {
	const params = new Float32Array(count * 3);
	const random = mulberry32(seed);
	for (let i = 0; i < count; i++) {
		const i3 = i * 3;
		params[i3] = (.5 + R2_A * i) % 1 * TAU;
		params[i3 + 1] = (.5 + R2_B * i) % 1 * TAU;
		params[i3 + 2] = random();
	}
	return params;
}
// src/sources/flow.ts
/** Radius the motion is scaled to fit, in world units (same as models). */
var FLOW_RADIUS = 4.5;
/** Typical on-screen speed at speed 1, in world units per second. */
var FLOW_WORLD_SPEED = 1.6;
var TRAJECTORIES = 32;
var WARMUP_STEPS = 2e3;
/** Relative error allowed per calibration step, and the step bounds (native time). */
var TOLERANCE = .001;
var MIN_STEP = 1e-7;
var MAX_STEP = 10;
var SEED_COUNT = 4096;
/** Seeds come from within this many "radii" (95th percentile) of the center. */
var SEED_REGION = 1.5;
/** A trajectory covering this many times the typical time is coming to rest. */
var RESTING_TIME_FACTOR = 5;
/** Safe step = this × the median accurate step found while calibrating. */
var STABLE_STEP_FACTOR = 4;
var RUNAWAY = 1e5;
var STILL = {
	t: 0,
	bass: 0,
	mid: 0,
	treble: 0,
	level: 0,
	spectrum: /* @__PURE__ */ new Float32Array(0)
};
var FlowError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "FlowError";
	}
};
var isBad = (x, y, z) => !(Math.abs(x) < RUNAWAY && Math.abs(y) < RUNAWAY && Math.abs(z) < RUNAWAY);
/** Trace the motion, measure it, and return everything needed to animate it. Throws FlowError. */
function calibrateFlow(formula, seed = 11) {
	if (formula.program.kind !== "motion") throw new Error("[NanoSwarm] calibrateFlow needs a motion formula (dx, dy, dz).");
	const random = mulberry32(seed);
	const n = TRAJECTORIES;
	const params = createParticleParams(n);
	const points = /* @__PURE__ */ new Float32Array(96);
	const k1 = /* @__PURE__ */ new Float32Array(96);
	const k2 = /* @__PURE__ */ new Float32Array(96);
	const mid = /* @__PURE__ */ new Float32Array(96);
	const h = new Float32Array(n).fill(.001);
	for (let i = 0; i < 96; i++) points[i] = (random() - .5) * 2;
	const alive = new Array(n).fill(true);
	const recorded = [];
	const weights = [];
	const owners = [];
	for (let step = 0; step < 5e3; step++) {
		formula.evaluate(k1, null, params, n, STILL, points);
		for (let i = 0; i < n; i++) {
			const i3 = i * 3, half = h[i] * .5;
			mid[i3] = points[i3] + k1[i3] * half;
			mid[i3 + 1] = points[i3 + 1] + k1[i3 + 1] * half;
			mid[i3 + 2] = points[i3 + 2] + k1[i3 + 2] * half;
		}
		formula.evaluate(k2, null, params, n, STILL, mid);
		for (let i = 0; i < n; i++) {
			if (!alive[i]) continue;
			const i3 = i * 3;
			const taken = h[i];
			const x = points[i3] += k2[i3] * taken;
			const y = points[i3 + 1] += k2[i3 + 1] * taken;
			const z = points[i3 + 2] += k2[i3 + 2] * taken;
			if (isBad(x, y, z)) {
				alive[i] = false;
				continue;
			}
			const error = .5 * taken * Math.hypot(k2[i3] - k1[i3], k2[i3 + 1] - k1[i3 + 1], k2[i3 + 2] - k1[i3 + 2]);
			const tolerance = TOLERANCE * Math.max(Math.hypot(x, y, z), 1e-9);
			const factor = error > 0 ? .9 * Math.sqrt(tolerance / error) : 2;
			h[i] = Math.min(MAX_STEP, Math.max(MIN_STEP, taken * Math.min(2, Math.max(.3, factor))));
			if (step >= WARMUP_STEPS) {
				recorded.push(x, y, z);
				weights.push(taken);
				owners.push(i);
			}
		}
	}
	if (recorded.length === 0 || leftTheRegion(recorded)) throw new FlowError("This motion runs off to infinity, so particles would fly away. Try smaller numbers, or pull points back (for example \"- x\").");
	const sample = new Float32Array(recorded);
	const still = stillTrajectories(sample, weights, owners, n);
	for (let i = 0; i < weights.length; i++) if (still[owners[i]]) weights[i] = 0;
	if (weights.every((w) => w === 0)) throw new FlowError("This motion settles on a single point, so there is nothing to draw. Attractors need a motion that keeps moving.");
	const probe = pickWeighted(sample, weights, SEED_COUNT, random);
	const center = [
		median(probe, 0),
		median(probe, 1),
		median(probe, 2)
	];
	const radius = percentileDistance(probe, center, .95);
	if (radius < 1e-6) throw new FlowError("This motion settles on a single point, so there is nothing to draw. Attractors need a motion that keeps moving.");
	const scale = FLOW_RADIUS / radius;
	const regionSq = (SEED_REGION * radius) ** 2;
	const seeds = pickWeighted(sample, weights.map((w, i) => {
		const dx = sample[i * 3] - center[0], dy = sample[i * 3 + 1] - center[1], dz = sample[i * 3 + 2] - center[2];
		return dx * dx + dy * dy + dz * dz <= regionSq ? w : 0;
	}), SEED_COUNT, random);
	const velocities = new Float32Array(seeds.length);
	formula.evaluate(velocities, null, createParticleParams(SEED_COUNT), SEED_COUNT, STILL, seeds);
	const speeds = new Float32Array(SEED_COUNT);
	for (let i = 0; i < SEED_COUNT; i++) speeds[i] = Math.hypot(velocities[i * 3], velocities[i * 3 + 1], velocities[i * 3 + 2]);
	speeds.sort();
	const typicalSpeed = Math.max(speeds[2048], 1e-9);
	const steps = Float64Array.from(weights).sort();
	const maxStep = STABLE_STEP_FACTOR * steps[steps.length >> 1];
	return {
		formula,
		center,
		scale,
		stepPerSecond: FLOW_WORLD_SPEED / (typicalSpeed * scale),
		maxStep,
		seeds
	};
}
/**
* Trajectories that are coming to rest: they barely move, or — the telling
* sign when they still crawl — their adaptive steps grew so large that they
* covered far more time than the typical trajectory in the same step count.
*/
function stillTrajectories(sample, weights, owners, n) {
	const min = new Float64Array(n * 3).fill(Infinity);
	const max = new Float64Array(n * 3).fill(-Infinity);
	const time = new Float64Array(n);
	for (let i = 0; i < owners.length; i++) {
		time[owners[i]] += weights[i];
		for (let a = 0; a < 3; a++) {
			const v = sample[i * 3 + a];
			const j = owners[i] * 3 + a;
			if (v < min[j]) min[j] = v;
			if (v > max[j]) max[j] = v;
		}
	}
	const typicalTime = Float64Array.from(time).sort()[n >> 2];
	return Array.from({ length: n }, (_, t) => {
		if (!Number.isFinite(min[t * 3])) return true;
		if (time[t] > RESTING_TIME_FACTOR * typicalTime) return true;
		const size = Math.hypot(max[t * 3] - min[t * 3], max[t * 3 + 1] - min[t * 3 + 1], max[t * 3 + 2] - min[t * 3 + 2]);
		const where = Math.hypot(max[t * 3] + min[t * 3], max[t * 3 + 1] + min[t * 3 + 1], max[t * 3 + 2] + min[t * 3 + 2]) / 2;
		return size < 1e-4 * Math.max(1, where);
	});
}
function median(points, axis) {
	const values = new Float64Array(points.length / 3);
	for (let i = 0; i < values.length; i++) values[i] = points[i * 3 + axis];
	values.sort();
	return values[values.length >> 1];
}
function percentileDistance(points, center, fraction) {
	const distances = new Float64Array(points.length / 3);
	for (let i = 0; i < distances.length; i++) distances[i] = Math.hypot(points[i * 3] - center[0], points[i * 3 + 1] - center[1], points[i * 3 + 2] - center[2]);
	distances.sort();
	return distances[Math.min(distances.length - 1, Math.floor(fraction * distances.length))];
}
/** True if the later half of the recording strays well outside the region of the earlier half. */
function leftTheRegion(recorded) {
	const half = Math.floor(recorded.length / 6) * 3;
	const [center, radius] = bounds(new Float32Array(recorded.slice(0, half)));
	const limit = 2 * Math.max(radius, 1e-6);
	for (let i = half; i < recorded.length; i += 3) if (Math.hypot(recorded[i] - center[0], recorded[i + 1] - center[1], recorded[i + 2] - center[2]) > limit) return true;
	return false;
}
/** Pick `count` points with probability proportional to their weight. */
function pickWeighted(points, weights, count, random) {
	const cumulative = new Float64Array(weights.length);
	let total = 0;
	for (let i = 0; i < weights.length; i++) cumulative[i] = total += weights[i];
	const out = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const target = random() * total;
		let lo = 0, hi = cumulative.length - 1;
		while (lo < hi) {
			const m = lo + hi >> 1;
			if (cumulative[m] < target) lo = m + 1;
			else hi = m;
		}
		out[i * 3] = points[lo * 3];
		out[i * 3 + 1] = points[lo * 3 + 1];
		out[i * 3 + 2] = points[lo * 3 + 2];
	}
	return out;
}
function bounds(points) {
	const min = [
		Infinity,
		Infinity,
		Infinity
	];
	const max = [
		-Infinity,
		-Infinity,
		-Infinity
	];
	for (let i = 0; i < points.length; i += 3) for (let a = 0; a < 3; a++) {
		min[a] = Math.min(min[a], points[i + a]);
		max[a] = Math.max(max[a], points[i + a]);
	}
	const center = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2
	];
	let radius = 0;
	for (let i = 0; i < points.length; i += 3) radius = Math.max(radius, Math.hypot(points[i] - center[0], points[i + 1] - center[1], points[i + 2] - center[2]));
	return [center, radius];
}
// src/element/markup.ts
/** Every attribute the element understands (plus the standard `title`). */
var ATTRIBUTES = {
	title: "A name for this creation",
	model: "A 3D model to use instead of a formula (.glb .gltf .obj .stl .ply): a file path or a URL (another site must allow CORS). Animated .glb/.gltf files move",
	animation: "Which animation of an animated model to play, by name (default: the first)",
	colors: "Up to three colors, bottom → top (or c = 0 → 1)",
	background: "Background color",
	solid: "Opaque, shaded particles instead of glowing ones",
	bloom: "Glow around bright areas (GPU only). Optionally a strength, e.g. bloom=\"0.8\"",
	speed: "Pace: 1 normal, 2 twice as fast, 0.5 half",
	tilt: "Camera height in degrees: 0 side view, 90 top-down",
	particles: "How many particles (default: chosen for the device)",
	audio: "An audio file URL, or \"mic\". Starts on the first click",
	sensitivity: "How strongly sound moves things (default 1)",
	renderer: "\"gpu\" or \"cpu\" (default: automatic)",
	"no-pointer": "The pointer does not push particles",
	"no-rotate": "The camera does not orbit on its own"
};
Object.keys(ATTRIBUTES);
/** Accepted range of each numeric attribute; values outside are clamped. */
var NUMBER_RANGES = {
	speed: [0, 10],
	tilt: [0, 90],
	particles: [1, 1e7],
	sensitivity: [0, 5],
	bloom: [0, 3]
};
var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function hex6(color) {
	const h = color.slice(1);
	return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}
function midpoint(a, b) {
	const pa = hex6(a), pb = hex6(b);
	const channel = (i) => Math.round((parseInt(pa.slice(i, i + 2), 16) + parseInt(pb.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, "0");
	return `#${channel(1)}${channel(3)}${channel(5)}`;
}
/**
* "#f00 #0f0 #00f" (spaces or commas) → three "#rrggbb" colors (the form
* <input type="color"> expects). One or two colors are stretched to three.
*/
function parseColors(value) {
	if (!value) return void 0;
	const colors = value.split(/[\s,]+/).filter(Boolean);
	if (colors.length === 0 || colors.length > 3 || !colors.every((c) => HEX_RE.test(c))) return void 0;
	const [a, b, c] = colors.map((color) => hex6(color).toLowerCase());
	if (colors.length === 1) return [
		a,
		a,
		a
	];
	if (colors.length === 2) return [
		a,
		midpoint(a, b),
		b
	];
	return [
		a,
		b,
		c
	];
}
var unescape = (v) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Remove common indentation and surrounding blank lines. */
function dedent(text) {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	while (lines.length && lines[0].trim() === "") lines.shift();
	while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
	const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
	return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}
var ELEMENT_RE = /<nano-swarm\b([^>]*)>([\s\S]*?)<\/nano-swarm>/i;
var ATTRIBUTE_RE = /([a-z][a-z-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi;
/**
* Read a <nano-swarm> out of an HTML string (an example file, a share link).
* Unknown attributes are dropped — only the documented vocabulary survives.
*/
function parseMarkup(html) {
	const match = ELEMENT_RE.exec(html);
	if (!match) throw new Error("[NanoSwarm] No <nano-swarm> element found.");
	const attributes = [];
	for (const [, name, double, single, bare] of match[1].matchAll(ATTRIBUTE_RE)) {
		const key = name.toLowerCase();
		if (!Object.hasOwn(ATTRIBUTES, key) || attributes.some(([n]) => n === key)) continue;
		attributes.push([key, unescape(double ?? single ?? bare ?? "")]);
	}
	return {
		attributes,
		formula: dedent(unescape(match[2]))
	};
}
// src/element/check.ts
/**
* Validate a <nano-swarm> without a browser: attributes, formula and (for
* motions) whether the motion has an attractor to draw. Used by the check
* CLI shipped in the AI skill, by CI on the examples, and by the
* playground's "Paste HTML". Pure: no DOM, no three.js.
*/
var BOOLEAN_ATTRIBUTES = [
	"solid",
	"no-pointer",
	"no-rotate"
];
function checkMarkup(markup) {
	const errors = [];
	const warnings = [];
	const summary = [];
	const attr = new Map(markup.attributes);
	const colors = attr.get("colors");
	if (colors !== void 0 && !parseColors(colors)) errors.push(`colors="${colors}" must be 1–3 hex colors, e.g. colors="#ff3d00 #ff9100 #ffe57f"`);
	const background = attr.get("background");
	if (background !== void 0 && !HEX_RE.test(background.trim())) errors.push(`background="${background}" must be a hex color, e.g. background="#03040a"`);
	const renderer = attr.get("renderer");
	if (renderer !== void 0 && renderer !== "gpu" && renderer !== "cpu") errors.push(`renderer="${renderer}" must be "gpu" or "cpu" (leave it out for automatic)`);
	for (const [name, [min, max]] of Object.entries(NUMBER_RANGES)) {
		const value = attr.get(name);
		if (value === void 0 || name === "bloom" && value === "") continue;
		const n = Number(value);
		if (value.trim() === "" || !Number.isFinite(n)) errors.push(`${name}="${value}" must be a number`);
		else if (n < min || n > max) warnings.push(`${name}="${value}" is outside ${min}–${max} and will be clamped`);
	}
	for (const name of BOOLEAN_ATTRIBUTES) {
		const value = attr.get(name);
		if (value) warnings.push(`${name} is on/off — write just "${name}" (its value "${value}" is ignored)`);
	}
	const model = attr.get("model");
	let listens = false;
	if (model !== void 0) {
		summary.push(`model ${model}`);
		if (markup.formula.trim()) warnings.push("the formula is ignored because model is set");
	} else if (!markup.formula.trim()) {
		summary.push("shape");
		warnings.push("the formula is empty, so the default sphere is shown");
	} else {
		const result = checkFormula(markup.formula);
		if (!result.ok) errors.push(`formula ${result.error.message}`);
		else {
			const { kind, usesTime, usesAudio, hasColor } = result.formula.program;
			listens = usesAudio;
			summary.push(kind);
			if (usesTime) summary.push("reacts to time");
			if (usesAudio) summary.push("reacts to sound");
			if (hasColor) summary.push("sets its own colors");
			if (kind === "motion") try {
				calibrateFlow(result.formula);
			} catch (error) {
				if (!(error instanceof FlowError)) throw error;
				errors.push(error.message);
			}
		}
	}
	if (attr.has("animation") && model === void 0) warnings.push("animation is ignored without a model");
	if (attr.has("audio") && !listens && errors.length === 0) warnings.push("audio is set, but the formula never reads bass, mid, treble, level or spectrum(k)");
	return {
		ok: errors.length === 0,
		title: attr.get("title") ?? null,
		summary,
		errors,
		warnings
	};
}
/** Check an HTML string (a file, a paste): it must contain one <nano-swarm>. */
function checkHtml(html) {
	let markup;
	try {
		markup = parseMarkup(html);
	} catch {
		return {
			ok: false,
			title: null,
			summary: [],
			errors: ["no <nano-swarm>…</nano-swarm> element found"],
			warnings: []
		};
	}
	return checkMarkup(markup);
}
// src/element/cli.ts
/**
* nanoswarm check — validate <nano-swarm> files from the terminal.
*
*   node check.mjs shape.html             one file
*   node check.mjs examples/              every .html in a folder (recursively)
*
* Prints what each file is, or what is wrong and how to fix it.
* Exit code 1 if any file has errors (warnings don't fail).
*/
function htmlFiles(path) {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => htmlFiles(join(path, name))).filter((file) => file.endsWith(".html"));
}
var args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help")) {
	console.log("Usage: node check.mjs <file.html | folder> [...more]\nValidates <nano-swarm> elements: attributes, formula, and motions.");
	process.exit(args.length === 0 ? 1 : 0);
}
var failed = 0;
for (const missing of args.filter((path) => !existsSync(path))) {
	console.log(`✗ ${missing} — file not found`);
	failed++;
}
for (const file of args.filter(existsSync).flatMap(htmlFiles)) {
	const result = checkHtml(readFileSync(file, "utf8"));
	const name = result.title ? `${file} (${result.title})` : file;
	console.log(`${result.ok ? "✓" : "✗"} ${name}${result.summary.length ? ` — ${result.summary.join(", ")}` : ""}`);
	for (const error of result.errors) console.log(`    error: ${error}`);
	for (const warning of result.warnings) console.log(`    warning: ${warning}`);
	if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
