import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkResearchSvgFile, checkResearchSvgLayout } from './research-ui-kit-layout-check.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(srcDir, '..');
const repoRoot = resolve(pluginRoot, '../..');
const uiKitRoot = join(pluginRoot, 'ui-kit', 'sciforge_research');
const demoSvgRoot = join(repoRoot, 'presentations', 'sciforge-research-ui-kit-demo_ppt169_20260621', 'svg_output');

test('preset exposes a testable research layout contract', async () => {
  const preset = JSON.parse(await readFile(join(uiKitRoot, 'preset.json'), 'utf8')) as {
    layoutContract?: {
      canvas?: { width?: number; height?: number };
      safeArea?: { left?: number; top?: number; right?: number; bottom?: number };
      footer?: { top?: number; bottom?: number };
      figureSlots?: Record<string, unknown>;
      calloutSlots?: Record<string, unknown>;
    };
  };

  assert.equal(preset.layoutContract?.canvas?.width, 1280);
  assert.equal(preset.layoutContract?.canvas?.height, 720);
  assert.deepEqual(preset.layoutContract?.safeArea, {
    left: 64,
    top: 56,
    right: 1216,
    bottom: 650
  });
  assert.equal(preset.layoutContract?.footer?.top, 628);
  assert.ok(preset.layoutContract?.figureSlots?.mainFigure);
  assert.ok(preset.layoutContract?.calloutSlots?.rightRail);
});

test('sciforge research templates and demo slides pass visual layout checks', async () => {
  const templateFiles = await svgFiles(join(uiKitRoot, 'layouts'));
  assert.equal(templateFiles.length, 5);
  const demoFiles = existsSync(demoSvgRoot) ? await svgFiles(demoSvgRoot) : [];
  if (demoFiles.length > 0) assert.equal(demoFiles.length, 5);

  for (const file of [...templateFiles, ...demoFiles]) {
    const issues = await checkResearchSvgFile(file);
    assert.deepEqual(issues, [], issues.map(formatIssue).join('\n'));
  }
});

test('layout checker reports text overflow that ppt-master technical QA would miss', () => {
  const issues = checkResearchSvgLayout(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <rect x="0" y="0" width="1280" height="720" fill="#F7F5F0"/>
      <text x="96" y="220" font-size="24" data-max-width="120">This sentence is much too long for the slot.</text>
    </svg>
  `);

  assert.ok(issues.some((issue) => issue.code === 'text-overflow'));
});

async function svgFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => file.toLowerCase().endsWith('.svg'))
    .sort()
    .map((file) => join(directory, file));
}

function formatIssue(issue: { severity: string; code: string; fileName?: string; element?: string; message: string }): string {
  return `[${issue.severity}] ${issue.code}: ${issue.fileName ?? ''} ${issue.element ?? ''} ${issue.message}`;
}
