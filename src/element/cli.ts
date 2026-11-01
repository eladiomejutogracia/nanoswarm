/// <reference types="node" />
/**
 * nanoswarm check — validate <nano-swarm> files from the terminal.
 *
 *   node check.mjs shape.html             one file
 *   node check.mjs examples/              every .html in a folder (recursively)
 *
 * Prints what each file is, or what is wrong and how to fix it.
 * Exit code 1 if any file has errors (warnings don't fail).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkHtml } from './check';

function htmlFiles(path: string): string[] {
    if (!statSync(path).isDirectory()) return [path];
    return readdirSync(path)
        .flatMap((name) => htmlFiles(join(path, name)))
        .filter((file) => file.endsWith('.html'));
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: node check.mjs <file.html | folder> [...more]\nValidates <nano-swarm> elements: attributes, formula, and motions.');
    process.exit(args.length === 0 ? 1 : 0);
}

let failed = 0;
for (const missing of args.filter((path) => !existsSync(path))) {
    console.log(`✗ ${missing} — file not found`);
    failed++;
}
for (const file of args.filter(existsSync).flatMap(htmlFiles)) {
    const result = checkHtml(readFileSync(file, 'utf8'));
    const name = result.title ? `${file} (${result.title})` : file;
    console.log(`${result.ok ? '✓' : '✗'} ${name}${result.summary.length ? ` — ${result.summary.join(', ')}` : ''}`);
    for (const error of result.errors) console.log(`    error: ${error}`);
    for (const warning of result.warnings) console.log(`    warning: ${warning}`);
    if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
