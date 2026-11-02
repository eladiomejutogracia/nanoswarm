# Public API (v1)

What `import … from 'nanoswarm'` exposes is the contract: from `1.0.0` on, removing or renaming any of it
is a major release. Adding to it is a minor release. `tests/api.test.ts` pins this list, so widening
the surface is always a deliberate edit — and this file changes with it.

The element (`<nano-swarm>`, its attributes and events) is documented in the [README](README.md).

A second entry, `import 'nanoswarm/element'`, exports nothing: importing it registers `<nano-swarm>`.
It is the only file the package marks as having side effects (`sideEffects` in `package.json`), so bundlers
keep that import and drop everything else you don't use. It shares the code of `nanoswarm` and leaves
three.js to your app, unlike the drop-in script (`dist/nano-swarm.js`), which carries its own.

## What is exported

| Export | Kind | Notes |
|---|---|---|
| `createSwarm(container, options?)` | function | The way to make a swarm from code. Throws an `Error` whose message starts `[NanoSwarm]` if the browser has no WebGL |
| `Swarm`, `SwarmOptions`, `SwarmInfo` | types | `Swarm` is what `createSwarm` returns. It is a **type only**: there is no `new Swarm` and no `extends Swarm` |
| `NanoSwarmElement`, `defineNanoSwarm()` | class, function | The custom element |
| `ATTRIBUTES`, `ATTRIBUTE_NAMES`, `AttributeName` | data, type | The attribute vocabulary: one definition read by the element, the playground, the validator and the AI docs |
| `FlowError`, `FlowErrorCode`, `FormulaError` | classes, type | What `swarm-error` / a rejected `setSource` carries for a formula that can't be drawn |
| `Source`, `ModelFormat` | types | What `setSource` accepts |
| `Look`, `LookStyle`, `AudioBands`, `AudioSource`, `BackendKind`, `BackendPreference` | types | Option shapes |
| `DEFAULT_VIEW`, `View` | value, type | The default camera (`elevation`, `distance`) |
| `VERSION` | string | The package version, e.g. `"1.0.0"` |

### `Swarm` methods

`setSource`, `setAudio`, `setLook`, `setParticles`, `setBackend`, `setInteractive`, `setSensitivity`,
`setAutoRotate`, `setSpeed`, `setTilt`, `dispose`, and the read-only `ready`, `info`, `animations`,
`spectrum`, `bands`, `audioElement`.

## Decisions taken before 1.0

**1. `createSwarm` is exported, the `Swarm` class is not.** Exporting the class as a value would make its
constructor public API and `extends Swarm` a supported use. Both would freeze the internals. As a type,
`Swarm` still lets you annotate a variable.

**2. Removed: `setCenterOffset()`, `screenshot()`, `pause()`, `resume()`.** None had a caller, a test or a
line of documentation; `setCenterOffset` was written for the playground, which stopped using it. A
method nobody uses is cheap to drop now and a breaking change after 1.0. They return as additions
(minor releases) the day someone needs them, with tests and docs. Meanwhile a swarm already stops
drawing when it is off screen, and `dispose()` ends it.

**3. Removed from the public surface: `parseMarkup`, `formatMarkup`, `readOptions`, `SwarmMarkup`,
`compileFormula`, `checkFormula`, `INPUTS`, `FUNCTIONS`, `CompiledFormula`, `FormulaCheck`,
`FormulaKind`, `detectSourceKind`.** They are plumbing of the playground (share links, paste-HTML,
editor hints), not something a page embedding a swarm needs. The playground now imports them from
`src/` directly. None is marked "experimental": a half-public API is the worst of both, so they are
simply not part of the package. To validate a formula, use the validator (`npm run check`, or the
skill's `check.mjs`).

**4. `particles` is a ceiling, not an order.** `particles` (the attribute and `SwarmOptions.particles`)
is the *most* particles you want. Auto quality stays on and may lower it if the device can't keep
30 fps; it never raises it again. To hold an exact count, pass `autoQuality: false` from code (there
is no attribute for it: an element always adapts to the device).

- `particles` omitted → a count chosen for the device (GPU 120,000; CPU 30,000).
- `setParticles(n)` changes the ceiling and **keeps** auto quality as it was. It no longer switches it off.
- Removing the attribute (or `setParticles(undefined)`) goes back to the device default and forgets any
  earlier lowering, so the swarm may grow again.
- The request is clamped to what the renderer sustains: CPU **40,000**, GPU the texture limit.

Why a ceiling: the old rule ("setting `particles` turns auto quality off, silently") made a page with
three elements, each with `particles="…"`, drop to 14 fps with no way to recover — an explicit number is
what people write to say "no more than this", not "even if it is slow". Changing the meaning after 1.0
would change what visitors see, which is why it is fixed now.

**CPU cap.** `PARTICLE_LIMITS.cpu.max` went from 262,144 to 40,000. Measured 2026-11-02, Chromium 156,
Intel i7-9750H laptop, median ms per frame of the CPU update (formula + physics, without drawing),
for an animated jellyfish / galaxy / Lorenz attractor:

| particles | jellyfish | galaxy | lorenz |
|---|---|---|---|
| 30,000 | 9.4 | 5.9 | 1.9 |
| 40,000 | 12.8 | 7.3 | 2.6 |
| 80,000 | 24.6 | 14 | 5.4 |
| 262,144 (old cap) | 82.6 | 48 | 18.1 |

At the old cap the jellyfish spends 83 ms per frame (12 fps) before drawing anything. At 40,000 the worst
case is 13 ms, leaving most of a 33 ms frame for drawing and for slower machines.

## Small pieces added while it was cheap

- `VERSION`: the package version, replaced at build time from `package.json`.
- `View`: the type of `DEFAULT_VIEW`.
- `FlowError.code`: `'diverges'` (the motion runs off to infinity) or `'rests'` (it settles on one point).
  Tell failures apart with `code`, never with the message — the wording is free to improve. New codes may
  be added; existing ones won't change.

## Errors: one contract

- A swarm made with `createSwarm` reports a failing **initial** `source` / `audio` through `onError` (or
  `console.warn` if there is none), and `ready` rejects with the same error. `ready` is already marked as
  handled, so ignoring it never logs an unhandled rejection.
- `setSource` and `setAudio` report **only** by rejecting the promise they return. They no longer also call
  `onError`: one failure, one channel. A rejected `setSource` keeps what the swarm was showing.
- The element sends every failure to the `swarm-error` event **and** to `console.warn`, so a broken formula is
  never indistinguishable from an empty element. `swarm-load` is only fired when the source really loaded.
- Messages from the library start with `[NanoSwarm]`.
