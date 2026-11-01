# AGENTS.md

Guidance for AI coding agents (Claude Code, GitHub Copilot, and others) and for humans who like a short brief.
To **create shapes** with NanoSwarm (rather than change NanoSwarm itself), use the skill in
`.claude/skills/nanoswarm/`.

## What this is

NanoSwarm is one HTML element, `<nano-swarm>`: its text is a formula, its attributes are settings.
`src/` is the library, `web/` the playground, `examples/` the built-in creations.

## Layers (dependencies only point down)

```
web/            playground: edits a real <nano-swarm>; renders everything from that element
src/element/    the element; markup.ts = the attribute vocabulary as plain data; check.ts = validator
src/swarm.ts    the engine behind the element (scene, loop, backends, audio)
src/backends/   GPU (GPGPU) and CPU backends — same physics, same look
src/sources/    formulas → targets, motion calibration (flow.ts), 3D models
src/formula/    parser + JS/GLSL code generation — pure
src/audio/      Web Audio input, bands, spectrum
```

`formula/`, `sources/` (except `model.ts`), `element/markup.ts` and `element/check.ts` are pure — no DOM,
no three.js — and fully unit-tested. Keep them that way.

## Rules

These come from real mistakes; please keep them.

- **KISS, and one way to do each thing.** A new option must work for every shape (formulas, motions,
  models). No per-shape special cases, no hidden rules (e.g. "solid implies gradient").
- **The library has no presets.** Built-in creations are files in `examples/<group>/` — plain
  `<nano-swarm>` elements. Adding one needs no code.
- **One vocabulary.** Attributes are defined once in `src/element/markup.ts` (`ATTRIBUTES`,
  `NUMBER_RANGES`); the element, playground, validator and AI docs all read from there.
- **Formulas never reach `new Function` or a shader as raw text** — only code generated from the
  validated AST. Don't weaken the parser's whitelist.
- **CPU and GPU must match.** Physics lives in `backends/physics.ts` as a JS function and its GLSL twin;
  change both. `noise()` uses integer hashing so both draw the same pattern.
- **Tests for every behaviour**, and look at visual changes in a real browser (GPU and CPU).

## Generated files — don't edit by hand

| File | Regenerate with |
|---|---|
| `.claude/skills/nanoswarm/SKILL.md`, `web/public/llms.txt` | `npx vitest -u` (built from `src/ai/reference.ts`) |
| `.claude/skills/nanoswarm/check.mjs` | `npm run build:check` (built from `src/element/cli.ts`) |

CI fails if they are out of date.

## Commands

```bash
npm run dev          # playground
npm test             # vitest (all pure logic, examples, generated docs)
npm run typecheck
npm run build        # dist/ + the skill's check.mjs
npm run check -- examples   # validate <nano-swarm> files
```

Line endings are LF (`.gitattributes`); on Windows, write files with LF.
