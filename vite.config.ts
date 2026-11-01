import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// `vite` / `vite build`         → the playground web page (web/)
// `vite build --mode lib`       → dist/nanoswarm.js — ES module, three.js as a peer dependency
// `vite build --mode element`   → dist/nano-swarm.js — one drop-in <script>, three.js included
export default defineConfig(({ mode }) => {
    if (mode === 'lib') {
        return {
            build: {
                outDir: 'dist',
                emptyOutDir: true,
                // ESM only: three's example modules (OrbitControls, GPGPU…) have no UMD globals.
                lib: {
                    entry: resolve(__dirname, 'src/index.ts'),
                    formats: ['es'],
                    fileName: 'nanoswarm',
                },
                rollupOptions: {
                    external: [/^three(\/.*)?$/],
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
                    entry: resolve(__dirname, 'src/element/standalone.ts'),
                    formats: ['iife'],
                    name: 'NanoSwarm',
                    fileName: () => 'nano-swarm.js',
                },
                rollupOptions: {
                    output: { inlineDynamicImports: true }, // model loaders are imported on demand
                },
            },
        };
    }

    return {
        root: 'web',
        base: './',
        // three.js alone is ~600 kB minified; that is expected for the playground.
        build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
        test: {
            root: __dirname,
            include: ['tests/**/*.test.ts'],
            environment: 'node',
        },
    };
});
