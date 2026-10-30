import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkResearchSvgFile, type LayoutIssue } from './research-ui-kit-layout-check.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(srcDir, '..');
const repoRoot = resolve(pluginRoot, '../..');

const defaultTargets = [
  join(pluginRoot, 'ui-kit', 'sciforge_research', 'layouts'),
  join(repoRoot, 'presentations', 'sciforge-research-ui-kit-demo_ppt169_20260621', 'svg_output')
].filter((target) => existsSync(target));

const targets = process.argv.slice(2).map((target) => resolve(target));
const paths = await collectSvgPaths(targets.length > 0 ? targets : defaultTargets);
const issues: LayoutIssue[] = [];

for (const path of paths) {
  issues.push(...await checkResearchSvgFile(path));
}

if (issues.length === 0) {
  console.log(`Research UI Kit layout check passed (${paths.length} SVG file${paths.length === 1 ? '' : 's'}).`);
} else {
  for (const item of issues) {
    console.error(`[${item.severity}] ${item.code}: ${item.fileName ?? '(inline SVG)'}${item.element ? ` :: ${item.element}` : ''}`);
    console.error(`  ${item.message}`);
  }
  process.exitCode = 1;
}

async function collectSvgPaths(targetPaths: string[]): Promise<string[]> {
  const allPaths: string[] = [];
  for (const target of targetPaths) {
    const targetStat = await stat(target);
    if (targetStat.isDirectory()) {
      const entries = await readdir(target);
      allPaths.push(
        ...entries
          .filter((entry) => entry.toLowerCase().endsWith('.svg'))
          .sort()
          .map((entry) => join(target, entry))
      );
    } else if (target.toLowerCase().endsWith('.svg')) {
      allPaths.push(target);
    }
  }
  return allPaths;
}
