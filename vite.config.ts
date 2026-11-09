import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';

const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

// `vite` / `vite build`         → the playground web page (web/)
// `vite build --mode lib`       → dist/nanoswarm.js + dist/element.js — ES modules, three.js as a peer dependency
// `vite build --mode element`   → dist/nano-swarm.js — one drop-in <script>, three.js included
// `vite build --mode check`     → .claude/skills/nanoswarm/check.mjs — the validator, Node only
export default defineConfig(({ mode }) => ({
    define: { __VERSION__: JSON.stringify(version) },
    ...configFor(mode),
}));

function configFor(mode: string) {
    if (mode === 'lib') {
        return {
            build: {
                outDir: 'dist',
                emptyOutDir: true,
                // ESM only: three's example modules (OrbitControls, GPGPU…) have no UMD globals.
                lib: {
                    entry: {
                        nanoswarm: resolve(root, 'src/index.ts'),
                        element: resolve(root, 'src/element/register.ts'), // `nanoswarm/element`
                    },
                    formats: ['es'],
                    fileName: (_format: string, name: string) => `${name}.js`,
                },
                rolldownOptions: {
                    external: [/^three(\/.*)?$/],
                },
            },
        };
    }

    if (mode === 'check') {
        return {
            build: {
                outDir: '.claude/skills/nanoswarm',
                emptyOutDir: false, // the folder also holds SKILL.md
                minify: false, // keep it readable: people (and agents) may open it
                target: 'node18',
                lib: {
                    entry: resolve(root, 'src/element/cli.ts'),
                    formats: ['es'],
                    fileName: () => 'check.mjs',
                },
                rolldownOptions: {
                    external: [/^node:/],
                    output: { banner: '#!/usr/bin/env node\n// Generated from src/element/cli.ts by `npm run build:check`. Do not edit.' },
                },
            },
        };
    }

    if (mode === 'element') {
        return {
            build: {
                outDir: 'dist',
                emptyOutDir: false, // runs after the lib build
                chunkSizeWarningLimit: 900,
                lib: {
                    entry: resolve(root, 'src/element/standalone.ts'),
                    formats: ['iife'],
                    name: 'NanoSwarm',
                    fileName: () => 'nano-swarm.js',
                },
            },
        };
    }

    return {
        root: 'web',
        base: './',
        // three.js alone is ~600 kB minified; that is expected for the playground.
        build: { outDir: resolve(root, 'dist-web'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
        test: {
            root,
            projects: [
                // Pure logic: fast, no browser.
                { extends: true, test: { name: 'unit', root, include: ['tests/*.test.ts'], environment: 'node' } },
                // The generated GLSL, compiled and run by a real WebGL2 driver (headless Chromium's software
                // renderer): the only place a shader can actually fail to compile.
                {
                    extends: true,
                    test: {
                        name: 'gpu',
                        root,
                        include: ['tests/gpu/*.test.ts'],
                        browser: {
                            enabled: true,
                            headless: true,
                            screenshotFailures: false,
                            provider: playwright({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } }),
                            instances: [{ browser: 'chromium' }],
                        },
                    },
                },
            ],
        },
    };
}
