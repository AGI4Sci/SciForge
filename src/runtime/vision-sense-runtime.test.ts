import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';

test('vision-sense runtime does not import retired VirtualAppScreen diagnostic paths', async () => {
  const runtimeSource = await readFile(new URL('./vision-sense-runtime.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(runtimeSource, /virtual-app-screen-diagnostic-runtime/);
  assert.doesNotMatch(runtimeSource, /import\('\.\/computer-use\/virtual-app-screen-(?:input-runtime|runtime-executors|session-manager|command)\.js'\)/);
});

test('vision-sense does not intercept explicit Playwright Edge MCP browser provider requests', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-edge-mcp-sense-skip-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'literature',
      prompt: '请调用 playwright_edge_browser / sciforge.observe.playwright-edge-mcp，用 Microsoft Edge + Playwright MCP 打开网页并读取正文。',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: { desktopBridgeEnabled: false },
        toolProviderRoutes: {
          playwright_edge_browser: {
            enabled: true,
            capabilityId: 'playwright_edge_browser',
            source: 'mcp',
            primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
            health: 'ready',
            endpoint: 'http://localhost:8931/mcp',
          },
        },
      },
    });

    assert.equal(payload, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense does not intercept literature research topics that mention computer use', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-literature-topic-sense-skip-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'literature',
      prompt: 'Research today arxiv papers about agent computer use. Read full text or PDF as much as possible. Write a Chinese summary report artifact.',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: { desktopBridgeEnabled: true },
      },
    });

    assert.equal(payload, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense blocks retired VirtualAppScreen slash commands unconditionally', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-default-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: '/computer-use screen attach --source right-pane-screen --profile "vscode-editor" --target-app-ref "app:profile/vscode-editor"',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: true,
          runId: 'vas-default-blocked',
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /VirtualAppScreen runtime commands are retired/);
    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
    assert.equal(payload?.artifacts?.some((artifact) => artifact.type === 'computer-use-virtual-screen'), false);
    assert.equal((payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined)?.route, 'virtual-app-screen-runtime-command');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense blocks retired VirtualAppScreen silent/background requests before bridge launch', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-background-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: 'Use Computer Use only in a silent background virtual screen without disturbing the physical desktop.',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          requireSilentBackgroundVirtualAppScreen: true,
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /VirtualAppScreen runtime commands are retired/);
    assert.equal((payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined)?.route, 'virtual-app-screen-silent-background');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
