/**
 * Documentation for AI assistants, generated from the code so it never drifts:
 * the attribute list, the formula inputs and functions come from the same
 * data the parser and the element use.
 *
 * Produces two files (kept in sync by tests/ai.test.ts — run `npx vitest -u`):
 *   .claude/skills/nanoswarm/SKILL.md   an Agent Skill read by Claude Code and GitHub Copilot
 *   web/public/llms.txt                 the same reference for any assistant, served with the playground
 */
import { ATTRIBUTES } from '../element/markup';
import { CONSTANTS, FUNCTIONS, INPUTS } from '../formula/parse';

export const SITE_URL = 'https://eladiomejutogracia.github.io/nanoswarm/';
export const SCRIPT_URL = `${SITE_URL}nano-swarm.js`;

export interface ExampleFile {
    /** Folder in examples/: sound, shapes or attractors. */
    group: string;
    html: string;
}

/** Examples chosen to show each idea once, in the order an assistant should learn them. */
const SHOWCASE = ['Sphere', 'Galaxy', 'Ring', 'Lorenz'];

const DESCRIBED_FUNCTIONS: Partial<Record<keyof typeof FUNCTIONS, string>> = {
    noise: 'smooth randomness in −1 → 1 (feed it positions and `t` for organic motion)',
    spectrum: 'loudness at frequency `k`: 0 = deep bass → 1 = high treble (the music itself)',
};

function table(rows: [string, string][]): string {
    return ['| | |', '|---|---|', ...rows.map(([a, b]) => `| ${a} | ${b} |`)].join('\n');
}

/** Rows like "`x`, `y`, `z` | Where the point is now", merging inputs that share a description. */
function inputRows(inputs: Record<string, string>): [string, string][] {
    const rows: [string[], string][] = [];
    for (const [name, description] of Object.entries(inputs)) {
        const last = rows.at(-1);
        if (last && last[1] === description) last[0].push(name);
        else rows.push([[name], description]);
    }
    return rows.map(([names, description]) => [names.map((n) => `\`${n}\``).join(', '), description]);
}

function titleOf(html: string): string {
    return /title="([^"]*)"/.exec(html)?.[1] ?? '';
}

/** The reference: page setup, attributes, formula language, rules, examples. */
export function buildReference(examples: ExampleFile[]): string {
    const plainFunctions = Object.keys(FUNCTIONS).filter((fn) => !(fn in DESCRIBED_FUNCTIONS));
    const showcase = SHOWCASE
        .map((title) => examples.find((e) => titleOf(e.html) === title))
        .filter((e): e is ExampleFile => e !== undefined);

    return `## Page setup

\`\`\`html
<script src="${SCRIPT_URL}"></script>

<nano-swarm style="height: 100vh">
  y = 4 * (v / PI - 1)
  R = sqrt(16 - y*y)
  x = R * cos(u)
  z = R * sin(u)
</nano-swarm>
\`\`\`

Give the element a height with CSS (it is at least 240px tall). The formula is its text; everything else is an attribute.
The script includes three.js and picks GPU or CPU rendering by itself.

## Attributes

${table(Object.entries(ATTRIBUTES).map(([name, description]) => [`\`${name}\``, description]))}

Boolean attributes (\`solid\`, \`no-pointer\`, \`no-rotate\`, bare \`bloom\`) are written without a value.

Accessibility is built in. The element is an image for screen readers, named by \`title\` (always give it one that
says what the viewer sees). A purely decorative one, such as a hero background, should say \`aria-hidden="true"\`.
When the visitor's system asks for reduced motion, the swarm becomes a still picture; nothing to configure.

## Formulas

A formula is a list of lines \`name = expression\`, run for every particle. What it assigns decides its kind:

### Shape — assign \`x\`, \`y\`, \`z\` (where each particle goes)

${table(inputRows(INPUTS.shape))}

### Motion — assign \`dx\`, \`dy\`, \`dz\` (how a point moves; particles keep travelling along it)

${table(inputRows(INPUTS.motion))}

Motions are how strange attractors are written. Scale and pace are measured automatically —
never add a time step. A motion that runs off to infinity, or settles on a single point, is an error.

### In both

- \`c = …\` (optional): color, 0 → 1 along \`colors\`. Without it colors run bottom → top. \`c\` is reserved for this.
- Any other name is a helper you can use in later lines (no reassigning, no names containing \`__\`).
- Functions: ${Object.entries(DESCRIBED_FUNCTIONS).map(([fn, text]) => `\`${fn}\` — ${text}`).join('; ')}.
- Plus: ${plainFunctions.map((fn) => `\`${fn}\``).join(' ')}. \`pow\` and \`^\` keep the sign for negative bases with integer exponents.
- Constants: ${Object.keys(CONSTANTS).map((c) => `\`${c}\``).join(' ')}. Operators: \`+ - * / ^\` (\`-x^2\` is \`-(x^2)\`). Comments start with \`#\` or \`//\`.

## Rules of thumb

- Shapes should fit in a radius of about 4.5 units (the camera frames ±5). Motions are framed automatically.
- \`u\` and \`v\` both go 0 → 2π and are spread evenly; a curve uses only \`u\` (add a little \`v\` for thickness).
- There is no \`if\` and no comparison: use \`step(edge, x)\`, \`mix(a, b, k)\`, \`clamp\`, \`smoothstep\`.
- Only shapes and motions that read \`bass\`, \`mid\`, \`treble\`, \`level\` or \`spectrum(k)\` react to sound;
  give them some idle motion with \`t\` so they don't look dead in silence.
- Non-finite results (division by zero, \`sqrt\` of a negative) become 0 — usually a sign of a mistake.

## Examples

${showcase.map((e) => `### ${titleOf(e.html)} (${e.group})\n\n\`\`\`html\n${e.html.trim()}\n\`\`\``).join('\n\n')}

More in the repository's \`examples/\` folder and in the playground's gallery: ${SITE_URL}
`;
}

export function buildSkill(examples: ExampleFile[]): string {
    return `---
name: nanoswarm
description: Create, edit and fix <nano-swarm> particle visualizations — shapes from x/y/z formulas, strange attractors from dx/dy/dz motions, 3D models and sound-reactive scenes. Use when the user wants a NanoSwarm or <nano-swarm> element, a particle animation, a parametric shape, an attractor, or an audio visualizer with NanoSwarm.
---

# NanoSwarm

<!-- Generated from src/ai/reference.ts — do not edit by hand. -->

NanoSwarm turns a formula into a swarm of particles: one HTML element, \`<nano-swarm>\`.

## How to work

1. Write the element (in the user's page, or in a new \`.html\` file).
2. **Validate it** with the checker next to this file — it needs only Node:
   \`node <this skill's folder>/check.mjs shape.html\` (also accepts a folder).
   Fix every error and re-run until it passes; warnings usually point at a real mistake.
3. Tell the user how to see it: open the page in a browser, or paste the element into the
   playground's **Paste HTML** (${SITE_URL}).

Never invent attributes, inputs or functions: everything that exists is listed below.

${buildReference(examples)}`;
}

export function buildLlmsTxt(examples: ExampleFile[]): string {
    return `# NanoSwarm

> Particle swarms shaped by formulas, 3D models and sound — as one HTML element, \`<nano-swarm>\`.
> The formula is the element's text; settings are attributes. Playground: ${SITE_URL}

${buildReference(examples)}`;
}
