import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// `vite` / `vite build`         → the playground web page (web/)
// `vite build --mode lib`       → dist/nanoswarm.js — ES module, three.js as a peer dependency
// `vite build --mode element`   → dist/nano-swarm.js — one drop-in <script>, three.js included
// `vite build --mode check`     → .claude/skills/nanoswarm/check.mjs — the validator, Node only
export default defineConfig(({ mode }) => {
    if (mode === 'lib') {
        return {
            build: {
                outDir: 'dist',
                emptyOutDir: true,
                // ESM only: three's example modules (OrbitControls, GPGPU…) have no UMD globals.
                lib: {
                    entry: resolve(root, 'src/index.ts'),
                    formats: ['es'],
                    fileName: 'nanoswarm',
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
            include: ['tests/**/*.test.ts'],
            environment: 'node',
        },
    };
});
