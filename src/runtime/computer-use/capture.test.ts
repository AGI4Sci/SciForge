import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureDisplays, parseMacVisionOcrLines } from './capture.js';
import {
  executeIndependentInputAdapterAction,
  SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
} from './independent-input-adapter.js';
import type { ComputerUseConfig, ResolvedWindowTarget } from './types.js';

test('macOS Vision OCR parser returns compact visible text lines', () => {
  assert.deepEqual(
    parseMacVisionOcrLines(JSON.stringify([
      'SciForge L3 计算机使用源',
      '  TUI 主机调用 computer_use.runTask  ',
      '',
      42,
      'KV-Ground 定位可见的浏览器和滑动控件',
    ])),
    [
      'SciForge L3 计算机使用源',
      'TUI 主机调用 computer_use.runTask',
      'KV-Ground 定位可见的浏览器和滑动控件',
    ],
  );
});

test('macOS Vision OCR parser fails closed on non-json output', () => {
  assert.deepEqual(parseMacVisionOcrLines('not json'), []);
});

test('independent remote-desktop capture renders a virtual session screenshot instead of a placeholder', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-virtual-remote-capture-'));
  try {
    const config = independentConfig('virtual-remote-capture');
    const targetResolution = resolvedWindowTarget();
    await executeIndependentInputAdapterAction({
      type: 'open_app',
      appName: 'SciForge T084 Harness',
    }, config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 0,
    });
    await executeIndependentInputAdapterAction({
      type: 'type_text',
      text: 'Visible source text for virtual capture',
    }, config, targetResolution, {
      workspace,
      runDir: workspace,
      stepIndex: 1,
    });

    const refs = await captureDisplays(workspace, workspace, 'step-001-before', config, targetResolution);
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.width, 960);
    assert.equal(refs[0]?.height, 540);
    assert.notEqual(refs[0]?.bytes, 70);
    assert.match(refs[0]?.captureProvider ?? '', /sciforge-simulated-remote-desktop-capture/);
    const session = JSON.parse(await readFile(join(workspace, 'virtual-remote-session.json'), 'utf8')) as Record<string, any>;
    assert.equal(session.frames[0]?.screenshotRef, 'step-001-before-window-101.png');
    assert.ok(session.frames[0]?.visibleTexts.includes('Visible source text for virtual capture'));
    assert.deepEqual(
      [
        'Search field',
        'Filter dropdown',
        'Export button',
        'Share button',
        'Save button',
        'Auto refresh toggle',
        'Include archived checkbox',
      ].filter((text) => !session.frames[0]?.visibleTexts.includes(text)),
      [],
    );
    assert.doesNotMatch(await readFile(refs[0]!.absPath, 'utf8').catch(() => ''), /data:image\/|;base64,/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function independentConfig(runId: string): ComputerUseConfig {
  return {
    desktopBridgeEnabled: true,
    dryRun: false,
    captureDisplays: [1],
    desktopPlatform: 'darwin',
    windowTarget: {
      enabled: true,
      required: true,
      mode: 'app-window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    runId,
    maxSteps: 3,
    allowHighRiskActions: false,
    inputAdapter: 'remote-desktop',
    independentInputAdapterProvider: SCIFORGE_SIMULATED_REMOTE_DESKTOP_PROVIDER,
    planner: { allowOpenAiRuntime: false, timeoutMs: 1000, maxTokens: 512 },
    grounder: { timeoutMs: 1000, allowServiceLocalPaths: false },
    testActionFixtureMode: true,
    testOnlyPlannedActions: [],
  };
}

function resolvedWindowTarget(): ResolvedWindowTarget {
  return {
    ok: true,
    target: {
      enabled: true,
      required: true,
      mode: 'app-window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
      inputIsolation: 'require-focused-target',
    },
    captureKind: 'window',
    windowId: 101,
    appName: 'Remote Session',
    title: 'Independent session',
    displayId: 1,
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
    schedulerLockId: 'remote-session-101',
    source: 'config',
    diagnostics: [],
  };
}
