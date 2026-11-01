# NanoSwarm

[![CI](https://github.com/eladiomejutogracia/nanoswarm/actions/workflows/ci.yml/badge.svg)](https://github.com/eladiomejutogracia/nanoswarm/actions/workflows/ci.yml)
[![Playground](https://github.com/eladiomejutogracia/nanoswarm/actions/workflows/pages.yml/badge.svg)](https://eladiomejutogracia.github.io/nanoswarm/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Particle swarms shaped by **formulas**, **3D models** and **sound** — as one HTML element.

[![A spiral galaxy made of particles, drawn by a formula inside a nano-swarm element](.github/preview.jpg)](https://eladiomejutogracia.github.io/nanoswarm/)

```html
<script src="https://eladiomejutogracia.github.io/nanoswarm/nano-swarm.js"></script>

<nano-swarm title="Torus" colors="#ff6e7f #bf5af2 #0a84ff" solid>
  R = 3 + 1.2 * cos(v)
  x = R * cos(u)
  y = 1.2 * sin(v)
  z = R * sin(u)
</nano-swarm>
```

The formula is the element's text. Everything else is an attribute. That's the whole idea.
The script is served from the [playground](https://eladiomejutogracia.github.io/nanoswarm/) site and always
tracks the latest version; an npm package with pinned versions will come later.
The script includes three.js; it picks the GPU when the browser can and the CPU when it can't.

The [playground](web/) is a live editor for one of these elements: every control just edits it,
and the **</> Code** panel shows it as it is. Save it as a page or copy a link.

## Formulas

A formula is a list of lines `name = expression`. There are two kinds — what you write decides which.

### Shapes: where each particle goes

Write `x`, `y`, `z`. Every particle has its own `u` and `v` (0 → 2π, evenly spread) and `r` (random, 0 → 1).

```
# A sphere that breathes with the music
h = v / PI - 1
ring = sqrt(1 - h*h)
R = 3.5 + bass * 1.5
x = R * ring * cos(u)
y = R * h
z = R * ring * sin(u)
```

### Motions: how a point moves

Write `dx`, `dy`, `dz` — the velocity of a point at `x, y, z`. Particles keep travelling along it,
which is exactly what strange attractors are:

```
dx = 10 * (z - x)
dz = x * (28 - y) - z
dy = x * z - 8/3 * y
```

There is no time step or scale to set. NanoSwarm traces the motion once, measures where it lives and
how fast it moves, and frames it with a comfortable pace. If it runs off to infinity, or stops at a
single point, you get a message saying so.

### In both

| | |
|---|---|
| `c = …` | Optional color, 0 → 1 along `colors`. Without it, colors run bottom → top. |
| `t` | Time in seconds (scaled by `speed`) |
| `bass` `mid` `treble` `level` | Sound energy, 0 → 1 |
| `spectrum(k)` | Loudness at frequency `k`: 0 = deep bass → 1 = high treble |
| `noise(x, y, z)` | Smooth randomness, −1 → 1 — same pattern on CPU and GPU |
| other names | Helpers for later lines |

**Functions:** `sin cos tan asin acos atan sqrt abs exp log floor ceil fract sign min max pow mod step clamp mix smoothstep noise spectrum`
**Constants:** `PI TAU E` · **Operators:** `+ - * / ^` · **Comments:** `#` or `//`

Formulas are parsed into an AST and compiled to JavaScript (CPU) or GLSL (GPU) from that AST only —
the text is never run directly, so formulas from a shared link are safe.

## Attributes

| Attribute | |
|---|---|
| `title` | A name for the creation |
| `model="robot.glb"` | Use a 3D model instead of a formula (GLB, GLTF, OBJ, STL, PLY) |
| `colors="#a #b #c"` | Up to three colors, bottom → top (or `c` = 0 → 1) |
| `background="#000"` | Background color |
| `solid` | Opaque, shaded particles — gives models volume |
| `bloom` | Glow on bright areas (GPU only); `bloom="0.8"` for a strength |
| `speed="2"` | Pace: multiplies `t` for shapes and travel speed for motions |
| `tilt="40"` | Camera height in degrees: 0 side view, 90 top-down |
| `audio="song.mp3"` / `audio="mic"` | Sound to react to — starts on the first click (browser rule) |
| `sensitivity="1.5"` | How strongly sound moves things |
| `particles="60000"` | Particle count (default: chosen for the device, lowered if it runs slow) |
| `renderer="cpu"` | Force `gpu` or `cpu` (default: automatic) |
| `no-pointer` | The pointer doesn't push particles |
| `no-rotate` | The camera doesn't orbit on its own |

Bad values fall back to defaults instead of breaking the page. Change any attribute at any time and
the swarm follows — particles fly to new shapes.

## Examples

[`examples/`](examples/) holds the built-in creations — plain `<nano-swarm>` files, grouped in
`sound/`, `shapes/` and `attractors/`. The playground's gallery is built from that folder, and the tests
check that every example compiles, stays on screen and uses its colors well. Add a file, and it
shows up.

## With AI assistants

NanoSwarm ships an **Agent Skill** that works in both **Claude Code** and **GitHub Copilot** (agent mode,
CLI and cloud agent): it teaches the assistant the element and the formula language, and includes a
validator so the assistant checks its own work before showing it to you.

- **Install:** download [nanoswarm-skill.zip](https://eladiomejutogracia.github.io/nanoswarm/nanoswarm-skill.zip)
  and unzip it into `~/.claude/skills/` (both tools read that folder), or into your project's
  `.claude/skills/` or `.github/skills/`.
- **Then ask:** *"make me a nano-swarm that looks like a jellyfish pulsing with the bass"*.
- **Any other assistant:** point it at [llms.txt](https://eladiomejutogracia.github.io/nanoswarm/llms.txt),
  the same reference in one file.
- **Check a file yourself:** `node check.mjs shape.html` (the script is in the skill), or paste the element
  into the playground's **Paste HTML**.

The skill and `llms.txt` are generated from the code, so they always match the current version.

## JavaScript

The element is built on a small API you can use directly:

```js
import { createSwarm } from 'nanoswarm';

const swarm = createSwarm(container, {
    source: 'dx = -y\ndy = x\ndz = 0.1 * sin(t)',  // or { model: file }
    look: { colors: ['#ff3d00', '#ff9100', '#ffe57f'], style: 'solid' },
    speed: 1.5,
});
swarm.setAudio('mic');
```

`document.querySelector('nano-swarm').swarm` gives you the same object for an element.
Events: the element fires `swarm-error` (`event.detail` is the Error) for a bad formula, model or audio.

## GPU and CPU

`renderer` defaults to automatic: the GPU (GPGPU float textures; the formula runs once per particle
per frame in a small target pass) unless the browser lacks float render targets or vertex textures,
or renders in software. The CPU path uses plain `Float32Array` physics, no bloom, pixel ratio 1 —
about 2 ms per frame for 200k particles on a model. Both share one physics model, so they look the same.

## Develop

```bash
npm run dev         # playground
npm test            # vitest
npm run typecheck
npm run build       # dist/nanoswarm.js (ES module, three.js peer) + dist/nano-swarm.js (drop-in)
npm run build:web   # playground → dist-web/
```

`main` is protected: changes arrive through pull requests, and **CI** must pass before they merge.

GitHub Actions: **CI** runs types, tests and both builds on every push, and on pull requests also
checks new dependencies for known vulnerabilities; **Playground** deploys `web/` to GitHub Pages;
**Publish to npm** runs when a release is published — bump `version` in `package.json`, merge, then
publish a release tagged `vX.Y.Z` (needs an `NPM_TOKEN` repository secret). Pre-releases stay on GitHub.
CodeQL scans the code for security issues, and Dependabot proposes dependency updates every week.
Found a security problem? See [SECURITY.md](SECURITY.md).

```
src/
  element/   <nano-swarm>: the element, its vocabulary as plain data (markup.ts), the validator (check.ts)
  ai/        generates the AI skill and llms.txt from the code
  formula/   parser, JS + GLSL code generation, noise
  sources/   formulas, motions (flow calibration), models, particle params
  audio/     Web Audio input, bands + spectrum
  backends/  physics, GPU and CPU backends, backend selection
  runtime/   pointer, auto quality, camera tilt
  swarm.ts   the engine behind the element
examples/    the built-in creations, one <nano-swarm> per file
.claude/skills/nanoswarm/   the AI skill (SKILL.md + check.mjs), generated
web/         the playground
```

## Contributing

Creations, examples and code are all welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Working with an AI agent? It will find [AGENTS.md](AGENTS.md).
