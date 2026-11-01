import { describe, expect, it } from 'vitest';
import { buildLlmsTxt, buildSkill, type ExampleFile } from '../src/ai/reference';
import { checkHtml } from '../src/element/check';
import { ATTRIBUTE_NAMES } from '../src/element/markup';
import { FUNCTIONS, INPUTS } from '../src/formula/parse';

const files = import.meta.glob('../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples: ExampleFile[] = Object.entries(files).map(([path, html]) => ({ group: path.split('/').at(-2)!, html }));

describe('AI documentation', () => {
    // These two files are generated. If a test fails here, the code changed:
    // run `npx vitest -u` to regenerate them, and review the diff.
    it('SKILL.md is up to date', async () => {
        await expect(buildSkill(examples)).toMatchFileSnapshot('../.claude/skills/nanoswarm/SKILL.md');
    });

    it('llms.txt is up to date', async () => {
        await expect(buildLlmsTxt(examples)).toMatchFileSnapshot('../web/public/llms.txt');
    });

    it('mentions every attribute, input and function', () => {
        const text = buildLlmsTxt(examples);
        for (const name of ATTRIBUTE_NAMES) expect(text).toContain(`\`${name}\``);
        for (const name of [...Object.keys(INPUTS.shape), ...Object.keys(INPUTS.motion)]) expect(text).toContain(`\`${name}\``);
        for (const name of Object.keys(FUNCTIONS)) expect(text).toContain(`\`${name}\``);
    });

    it('only shows examples that pass the checker', () => {
        const shown = [...buildLlmsTxt(examples).matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]);
        expect(shown.length).toBeGreaterThanOrEqual(5); // the page setup + the showcase
        for (const html of shown) expect(checkHtml(html).errors).toEqual([]);
    });

    it('has the frontmatter Claude Code and Copilot need', () => {
        const skill = buildSkill(examples);
        expect(skill).toMatch(/^---\nname: nanoswarm\ndescription: .{50,1024}\n---\n/);
    });
});
