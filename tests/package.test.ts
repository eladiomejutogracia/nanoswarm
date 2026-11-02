import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

describe('package metadata (what npm and bundlers read)', () => {
    it('has everything a published package needs', () => {
        for (const field of ['name', 'version', 'description', 'license', 'author', 'homepage', 'keywords', 'files', 'exports']) {
            expect(pkg[field], field).toBeTruthy();
        }
        expect(pkg.repository.url).toContain('github.com/eladiomejutogracia/nanoswarm');
        expect(pkg.bugs.url).toContain('github.com/eladiomejutogracia/nanoswarm/issues');
        expect(pkg.files).toEqual(['dist']);
    });

    it('is not a pre-release: 1.0.0 is the first public version', () => {
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('does not tell bundlers that `import "nanoswarm/element"` may be dropped', () => {
        // `false` would let them delete it: the element would never register, only in some production builds.
        expect(pkg.sideEffects).not.toBe(false);
        expect(pkg.sideEffects).toContain(pkg.exports['./element'].import);
        expect(pkg.sideEffects).toContain(`./${pkg.unpkg}`);
    });

    it('declares types for both entries', () => {
        expect(pkg.exports['.'].types).toBe('./dist/types/index.d.ts');
        expect(pkg.exports['./element'].types).toBe('./dist/types/element/register.d.ts');
    });

    it('claims only the three.js versions CI tests: the pinned one and the lowest', () => {
        const [, floor, ceiling] = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(pkg.peerDependencies.three) ?? [];
        expect(floor, 'peer range must look like ">=0.172.0 <0.188.0"').toBeDefined();
        const order = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
        expect(order(pkg.devDependencies.three)).toBeGreaterThanOrEqual(order(floor));
        expect(order(pkg.devDependencies.three)).toBeLessThan(order(ceiling));
        // CI installs the pinned three in every job, and the lowest one in its own job.
        expect(read('.github/workflows/ci.yml')).toContain(`three@${floor}`);
        expect(read('.github/workflows/ci.yml')).toContain(`@types/three@${floor}`);
    });
});

// A real bundler run over the built package, the way an app would use it.
describe('bundling the package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nanoswarm-bundle-'));
    const installed = join(dir, 'node_modules', 'nanoswarm');

    beforeAll(async () => {
        await build({ mode: 'lib', logLevel: 'silent', build: { outDir: join(installed, 'dist'), emptyOutDir: true } });
        cpSync(join(root, 'package.json'), join(installed, 'package.json'));
        symlinkSync(join(root, 'node_modules', 'three'), join(dir, 'node_modules', 'three'), 'dir');
    }, 120_000);

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    async function bundle(entry: string): Promise<string> {
        const file = join(dir, `entry-${Math.random().toString(36).slice(2)}.js`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, entry);
        const result = await build({
            root: dir,
            configFile: false,
            logLevel: 'silent',
            build: {
                write: false,
                minify: false,
                lib: { entry: file, formats: ['es'] },
                rolldownOptions: { external: [/^three(\/.*)?$/] },
            },
        });
        const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
        return outputs.map((o) => ('code' in o ? o.code : '')).join('\n');
    }

    it('builds the files the exports point to (types come from tsc, in `npm run build`)', () => {
        for (const target of [pkg.exports['.'].import, pkg.exports['./element'].import]) {
            expect(existsSync(join(installed, target)), target).toBe(true);
        }
    });

    it('keeps `import "nanoswarm/element"` even though it imports nothing: it registers <nano-swarm>', async () => {
        const code = await bundle(`import 'nanoswarm/element';\nconsole.log('app');`);
        expect(code).toMatch(/customElements\.define/);
    });

    it('drops what an app does not use: `import { VERSION }` pulls in no element and no three.js', async () => {
        const code = await bundle(`import { VERSION } from 'nanoswarm';\nconsole.log(VERSION);`);
        expect(code).not.toMatch(/customElements/);
        expect(code).not.toMatch(/from ["']three/);
        expect(code.length).toBeLessThan(500);
    });
});
