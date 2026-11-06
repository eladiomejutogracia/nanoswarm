---
name: nanoswarm
description: Create, edit and fix <nano-swarm> particle visualizations — shapes from x/y/z formulas, strange attractors from dx/dy/dz motions, 3D models and sound-reactive scenes. Use when the user wants a NanoSwarm or <nano-swarm> element, a particle animation, a parametric shape, an attractor, or an audio visualizer with NanoSwarm.
---

# NanoSwarm

<!-- Generated from src/ai/reference.ts — do not edit by hand. -->

NanoSwarm turns a formula into a swarm of particles: one HTML element, `<nano-swarm>`.

## How to work

1. Write the element (in the user's page, or in a new `.html` file).
2. **Validate it** with the checker next to this file — it needs only Node:
   `node <this skill's folder>/check.mjs shape.html` (also accepts a folder).
   Fix every error and re-run until it passes; warnings usually point at a real mistake.
3. Tell the user how to see it: open the page in a browser, or paste the element into the
   playground's **Paste HTML** (https://eladiomejutogracia.github.io/nanoswarm/).

Never invent attributes, inputs or functions: everything that exists is listed below.

## Page setup

```html
<script src="https://eladiomejutogracia.github.io/nanoswarm/nano-swarm.js"></script>

<nano-swarm style="height: 100vh">
  y = 4 * (v / PI - 1)
  R = sqrt(16 - y*y)
  x = R * cos(u)
  z = R * sin(u)
</nano-swarm>
```

Give the element a height with CSS (it is at least 240px tall). The formula is its text; everything else is an attribute.
The script includes three.js and picks GPU or CPU rendering by itself.

## Attributes

| | |
|---|---|
| `title` | A name for this creation; screen readers announce it as the description of the image |
| `model` | A 3D model to use instead of a formula (.glb .gltf .obj .stl .ply): a file path or a URL (another site must allow CORS). Animated .glb/.gltf files move |
| `animation` | Which animation of an animated model to play, by name (default: the first) |
| `colors` | Up to three colors, bottom → top (or c = 0 → 1) |
| `background` | Background color |
| `solid` | Opaque, shaded particles instead of glowing ones |
| `bloom` | Glow around bright areas (GPU only). Optionally a strength, e.g. bloom="0.8" |
| `speed` | Pace: 1 normal, 2 twice as fast, 0.5 half |
| `tilt` | Camera height in degrees: 0 side view, 90 top-down |
| `particles` | The most particles to draw (default: chosen for the device; lowered if it runs slow) |
| `audio` | An audio file URL, or "mic". Starts on the first click |
| `sensitivity` | How strongly sound moves things (default 1) |
| `renderer` | "gpu" or "cpu" (default: automatic) |
| `no-pointer` | The pointer does not push particles |
| `no-rotate` | The camera does not orbit on its own |

Boolean attributes (`solid`, `no-pointer`, `no-rotate`, bare `bloom`) are written without a value.

Accessibility is built in. The element is an image for screen readers, named by `title` (always give it one that
says what the viewer sees). A purely decorative one, such as a hero background, should say `aria-hidden="true"`.
When the visitor's system asks for reduced motion, the swarm becomes a still picture; nothing to configure.

## Formulas

A formula is a list of lines `name = expression`, run for every particle. What it assigns decides its kind:

### Shape — assign `x`, `y`, `z` (where each particle goes)

| | |
|---|---|
| `u` | Particle parameter, 0 → 2π |
| `v` | Second particle parameter, 0 → 2π |
| `r` | Per-particle random number, 0 → 1 |
| `t` | Time in seconds |
| `bass` | Bass energy, 0 → 1 |
| `mid` | Mid-range energy, 0 → 1 |
| `treble` | Treble energy, 0 → 1 |
| `level` | Overall loudness, 0 → 1 |

### Motion — assign `dx`, `dy`, `dz` (how a point moves; particles keep travelling along it)

| | |
|---|---|
| `x`, `y`, `z` | Where the point is now |
| `r` | Per-particle random number, 0 → 1 |
| `t` | Time in seconds |
| `bass` | Bass energy, 0 → 1 |
| `mid` | Mid-range energy, 0 → 1 |
| `treble` | Treble energy, 0 → 1 |
| `level` | Overall loudness, 0 → 1 |

Motions are how strange attractors are written. Scale and pace are measured automatically —
never add a time step. A motion that runs off to infinity, or settles on a single point, is an error.

### In both

- `c = …` (optional): color, 0 → 1 along `colors`. Without it colors run bottom → top. `c` is reserved for this.
- Any other name is a helper you can use in later lines (no reassigning, no names containing `__`).
- Functions: `noise` — smooth randomness in −1 → 1 (feed it positions and `t` for organic motion); `spectrum` — loudness at frequency `k`: 0 = deep bass → 1 = high treble (the music itself).
- Plus: `sin` `cos` `tan` `asin` `acos` `atan` `sqrt` `abs` `exp` `log` `floor` `ceil` `fract` `sign` `min` `max` `pow` `mod` `step` `clamp` `mix` `smoothstep`. `pow` and `^` keep the sign for negative bases with integer exponents.
- Constants: `PI` `TAU` `E`. Operators: `+ - * / ^` (`-x^2` is `-(x^2)`). Comments start with `#` or `//`.

## Rules of thumb

- Shapes should fit in a radius of about 4.5 units (the camera frames ±5). Motions are framed automatically.
- `u` and `v` both go 0 → 2π and are spread evenly; a curve uses only `u` (add a little `v` for thickness).
- There is no `if` and no comparison: use `step(edge, x)`, `mix(a, b, k)`, `clamp`, `smoothstep`.
- Only shapes and motions that read `bass`, `mid`, `treble`, `level` or `spectrum(k)` react to sound;
  give them some idle motion with `t` so they don't look dead in silence.
- Non-finite results (division by zero, `sqrt` of a negative) become 0 — usually a sign of a mistake.

## Examples

### Sphere (shapes)

```html
<nano-swarm title="Sphere">
  # Evenly spread sphere (Archimedes' trick)
  y = 4 * (v / PI - 1)
  R = sqrt(16 - y*y)
  x = R * cos(u)
  z = R * sin(u)
</nano-swarm>
```

### Galaxy (shapes)

```html
<nano-swarm title="Galaxy" colors="#ff3d00 #ff9100 #ffe57f" background="#070201" tilt="40">
  # r picks one of three arms; v walks outwards along it
  R = 0.4 + 5 * (v / TAU)^1.5
  arm = floor(r * 3) * TAU / 3
  a = arm + 1.2*R - 0.15*t + 0.5*(u/TAU - 0.5)
  x = R * cos(a)
  z = R * sin(a)
  y = 0.25 * sin(3*u) * (1 - R/6)
  # hot core, cool edges
  c = 1 - R / 5.5
</nano-swarm>
```

### Ring (sound)

```html
<nano-swarm title="Ring" tilt="24">
  # 64 bars in a circle, mirrored: bass at the back, treble at the front
  bar = floor(u / TAU * 64)
  k = abs(bar - 32) / 32
  a = (bar + 0.55 * fract(u / TAU * 64)) / 64 * TAU
  idle = 0.15 * (1 + sin(3*t + 6*k))
  h = 0.3 + idle + spectrum(k) * 5
  w = 3.5 + (v / TAU - 0.5) * 0.25
  x = w * cos(a)
  z = w * sin(a)
  y = r * h - 1.5
  # loud frequencies light up
  c = 0.15 + spectrum(k) * 0.85
</nano-swarm>
```

### Lorenz (attractors)

```html
<nano-swarm title="Lorenz" colors="#1a237e #4fc3f7 #ff4081" background="#02040a">
  # The Lorenz butterfly, with y as the up axis
  dx = 10 * (z - x)
  dz = x * (28 - y) - z
  dy = x * z - 8/3 * y
  # fast stretches glow hot
  c = sqrt(dx*dx + dy*dy + dz*dz) / 180
</nano-swarm>
```

More in the repository's `examples/` folder and in the playground's gallery: https://eladiomejutogracia.github.io/nanoswarm/
