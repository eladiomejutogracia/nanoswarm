# Contributing to NanoSwarm

Thanks for helping! There are three ways in, from easiest to deepest.

## 1. Share a creation

Made something nice in the [playground](https://eladiomejutogracia.github.io/nanoswarm/)? Click
**Copy link** and post it in [Discussions → Show and tell](https://github.com/eladiomejutogracia/nanoswarm/discussions/categories/show-and-tell).

## 2. Add an example

Built-in creations are plain files — no code needed.

1. Save your element as `examples/<sound|shapes|attractors>/<name>.html` (one `<nano-swarm>` with a `title`).
2. Check it: `npm run check -- examples/shapes/<name>.html`.
3. Run `npm test` — every example must compile, stay on screen and pass the checker — and
   `npx vitest -u` if the AI docs need regenerating.
4. Open a pull request with a screenshot.

AI assistants can help: the [NanoSwarm skill](.claude/skills/nanoswarm/) works in Claude Code and
GitHub Copilot, and validates what it writes.

## 3. Change the code

You need Node 24 or later; CI uses the version in `.nvmrc` (`nvm use` picks it up).

```bash
npm install
npm run dev        # playground at http://localhost:5173
npm test
```

Read [AGENTS.md](AGENTS.md) first — the architecture fits on one page, and it lists the rules that keep
NanoSwarm simple. In short: one way to do each thing, options that work for every shape, pure and tested
logic, and CPU/GPU parity. Visual changes need a look in a real browser.

Bugs and ideas go in [Issues](https://github.com/eladiomejutogracia/nanoswarm/issues); questions in
[Discussions](https://github.com/eladiomejutogracia/nanoswarm/discussions).

By contributing you agree that your work is released under the [MIT License](LICENSE).
