import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { copyDesktopStaticAssets } from './copy-desktop-static-assets.js';

test('copyDesktopStaticAssets materializes runtime JSON manifests and Computer Use TS package assets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-assets-'));
  await writeRequiredStaticAssetFixture(workspace);

  const result = await copyDesktopStaticAssets({ rootDir: workspace });

  assert.equal(result.files, 11);
  assert.equal(result.dirs, 2);
  assert.equal(
    await readFile(join(workspace, 'dist-desktop/packages/actions/computer-use/action-provider.manifest.json'), 'utf8'),
    '{"id":"sciforge.computer-use"}\n',
  );
  assert.equal(
    await readFile(join(workspace, 'dist-desktop/packages/observe/web/capabilities/browser_runtime.manifest.json'), 'utf8'),
    '{"id":"browser_runtime"}\n',
  );
  await assert.rejects(
    stat(join(workspace, 'dist-desktop/packages/actions/computer-use/fixtures/__pycache__/stale.pyc')),
    /ENOENT/u,
  );
});

async function writeRequiredStaticAssetFixture(workspace: string): Promise<void> {
  const files: Record<string, string> = {
    'packages/actions/computer-use/action-provider.manifest.json': '{"id":"sciforge.computer-use"}\n',
    'packages/actions/computer-use/native-window-capability.manifest.json': '{"id":"native-window"}\n',
    'packages/actions/computer-use/README.md': '# Computer Use\n',
    'packages/actions/computer-use/fixtures/sample.json': '{}\n',
    'packages/actions/computer-use/fixtures/__pycache__/stale.pyc': 'cache',
    'packages/actions/computer-use/skills/sciforge-computer-use/SKILL.md': '# Skill\n',
    'packages/observe/web/capabilities/web_search.manifest.json': '{"id":"web_search"}\n',
    'packages/observe/web/capabilities/web_fetch.manifest.json': '{"id":"web_fetch"}\n',
    'packages/observe/web/capabilities/browser_search.manifest.json': '{"id":"browser_search"}\n',
    'packages/observe/web/capabilities/browser_fetch.manifest.json': '{"id":"browser_fetch"}\n',
    'packages/observe/web/capabilities/browser_runtime.manifest.json': '{"id":"browser_runtime"}\n',
    'packages/observe/web/capabilities/playwright_browser_automation.manifest.json': '{"id":"playwright_browser_automation"}\n',
    'packages/observe/web/capabilities/playwright_edge_browser.manifest.json': '{"id":"playwright_edge_browser"}\n',
    'packages/verifiers/fixtures/human-approval.manifest.json': '{"id":"human-approval"}\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(workspace, relativePath);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
}
