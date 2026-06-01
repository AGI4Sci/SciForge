import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';

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

test('vision-sense honors explicit Computer Use action selection even when the prompt asks for a report', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-explicit-cu-action-selection-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'literature',
      prompt: '/computer-use Use the visible desktop to inspect the current active window and produce a short visible report naming the visible app/window, one visible UI fact, and the evidence refs. Do not click, type, scroll, send, delete, upload, submit, or modify files.',
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
          runId: 'cu-explicit-action-selection',
          captureDisplays: [1],
          testActionFixtureMode: true,
          testOnlyActions: [],
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.tool, 'local.vision-sense');
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-explicit-action-selection/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    assert.equal((trace.packageBridge as Record<string, unknown>).actionProvider, 'action.sciforge.computer-use');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense keeps Computer Use blocked when the desktop bridge is disabled', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-desktop-bridge-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type a low risk local smoke string',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: {
          desktopBridgeEnabled: false,
          dryRun: true,
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /generic Computer Use bridge is not ready/);
    assert.match(String(payload?.executionUnits[0]?.failureReason ?? ''), /desktop bridge is disabled at preflight/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense blocks silent background VirtualAppScreen before shared-system app launch', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-silent-virtual-screen-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: '/computer-use 请在 SciForge 虚拟屏幕后台静默打开并展示 vscode，不要干扰用户桌面屏幕，只在 SciForge 虚拟屏幕上展示 app 页面内容。',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: false,
          runId: 'cu-silent-vscode-blocked',
          captureDisplays: [1],
          inputAdapter: 'shared-system',
          allowSharedSystemInput: true,
          windowTarget: {
            mode: 'app-window',
            appName: 'Code',
            bundleId: 'com.microsoft.VSCode',
            coordinateSpace: 'window-local',
            inputIsolation: 'require-focused-target',
          },
          testActionFixtureMode: true,
          testOnlyActions: [{ type: 'open_app', appName: 'Code' }],
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /Silent\/background VirtualAppScreen was requested/);
    assert.match(String(payload?.executionUnits[0]?.failureReason ?? ''), /blocked before launching or activating the desktop app/);
    assert.equal((payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined)?.route, 'virtual-app-screen-silent-background');

    const screenSlot = payload?.uiManifest?.find((slot) => slot.componentId === 'virtual-screen-viewer');
    assert.equal(screenSlot?.artifactRef, 'computer-use-virtual-screen-cu-silent-vscode-blocked');
    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'blocked');
    assert.equal(screenData?.attachState, 'blocked');
    assert.equal(screenData?.surfaceMode, 'empty');
    assert.equal(screenData?.targetAppRef, 'app:com.microsoft.VSCode');
    assert.equal(screenData?.currentFrameRef, undefined);
    assert.equal(screenData?.targetWindowRef, undefined);
    const isolation = screenData?.isolationFlags as Record<string, unknown> | undefined;
    assert.equal(isolation?.affectsPhysicalDisplay, false);
    assert.equal(isolation?.sharedSystemInputUsed, false);
    assert.equal(isolation?.systemPointerMoved, false);
    assert.equal(isolation?.systemKeyboardEventsSent, false);
    assert.equal(isolation?.requestedSharedSystemInput, true);
    assert.equal(isolation?.sharedSystemInputRisk, true);
    assert.equal(isolation?.requiresFocusSteal, true);
    assert.equal(isolation?.backgroundRenderable, false);
    assert.equal(isolation?.diagnosticOnly, true);

    await assert.rejects(
      readFile(join(workspace, '.sciforge/vision-runs/cu-silent-vscode-blocked/vision-trace.json'), 'utf8'),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense routes Computer Use requests through the Python package bridge after desktop bridge is enabled', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-package-bridge-runtime-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: '/computer-use run type a low risk local smoke string',
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: true,
          runId: 'cu-package-runtime-selection',
          captureDisplays: [1],
          testActionFixtureMode: true,
          testOnlyActions: [{ type: 'type_text', text: 'SciForge package bridge runtime selection' }],
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'done');
    const trace = JSON.parse(await readFile(join(workspace, '.sciforge/vision-runs/cu-package-runtime-selection/vision-trace.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(trace.schemaVersion, 'sciforge.vision-trace.v1');
    assert.equal((trace.packageBridge as Record<string, unknown>).schemaVersion, 'sciforge.computer-use.package-bridge-trace.v1');
    assert.equal((trace.packageResult as Record<string, unknown>).status, 'completed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
