import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';
import {
  registerVirtualAppScreenSessionExecutor,
  VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
  type VirtualAppScreenSessionManagerAttachResult,
} from './computer-use/virtual-app-screen-session-manager.js';
import {
  recordVirtualAppScreenNativeHostSession,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
} from './computer-use/virtual-app-screen-native-host-session-store.js';
import { resetVirtualAppScreenProviderSessionStoreForTests } from './computer-use/virtual-app-screen-provider-session-store.js';
import type { VirtualAppScreenRuntimeCommand } from './computer-use/virtual-app-screen-command.js';
import {
  registerVirtualAppScreenInputRuntimeExecutor,
  resetVirtualAppScreenInputRuntimeExecutorsForTests,
  VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
  type VirtualAppScreenInputRuntimeProjection,
} from './computer-use/virtual-app-screen-input-runtime.js';
import type { VirtualScreenInputIntentCommand } from './computer-use/input-intent-command.js';
import { resetVirtualAppScreenRuntimeExecutorsForTests } from './computer-use/virtual-app-screen-runtime-executors.js';
import {
  ContractSmokeNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

const VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC';
process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV] = '1';

test('vision-sense wires native driver hook opt-in through env without importing smoke drivers', async () => {
  const runtimeSource = await readFile(new URL('./vision-sense-runtime.ts', import.meta.url), 'utf8');
  const diagnosticSource = await readFile(new URL('./vision-sense/virtual-app-screen-diagnostic-runtime.ts', import.meta.url), 'utf8');

  const staticVirtualAppScreenRuntimeImports = runtimeSource
    .split('\n')
    .filter((line) => /^import\s+(?!type\b).*from ['"]\.\/computer-use\/virtual-app-screen-(?:input-runtime|runtime-executors|session-manager)\.js['"]/.test(line));
  assert.deepEqual(staticVirtualAppScreenRuntimeImports, []);
  assert.match(runtimeSource, /import\('\.\/vision-sense\/virtual-app-screen-diagnostic-runtime\.js'\)/);
  assert.doesNotMatch(runtimeSource, /import\('\.\/computer-use\/virtual-app-screen-(?:input-runtime|runtime-executors|session-manager|command)\.js'\)/);
  assert.match(diagnosticSource, /import\('\.\.\/computer-use\/virtual-app-screen-runtime-executors\.js'\)/);
  assert.match(diagnosticSource, /ensureVirtualAppScreenRuntimeExecutorsRegistered\(\{\s*nativeDriverHooks:\s*\{\s*env:\s*process\.env\s*\}/);
  assert.doesNotMatch(runtimeSource, /createMacosVirtualDisplayDriverHooks|createLinuxXpraVirtualDisplayDriverHooks|createWindowsIddVirtualDisplayDriverHooks/);
  assert.doesNotMatch(diagnosticSource, /createMacosVirtualDisplayDriverHooks|createLinuxXpraVirtualDisplayDriverHooks|createWindowsIddVirtualDisplayDriverHooks/);
  assert.doesNotMatch(runtimeSource, /virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge|noVNC|RDP|QEMU|runPlaywright|import\([^)]*playwright|from ['"][^'"]*playwright/);
  assert.doesNotMatch(diagnosticSource, /virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge|noVNC|RDP|QEMU|runPlaywright|import\([^)]*playwright|from ['"][^'"]*playwright/);
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
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
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

test('vision-sense blocks VirtualAppScreen runtime commands without diagnostic opt-in', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-default-blocked-'));
  const original = process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV];
  delete process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV];
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
    assert.match(payload?.message ?? '', /VirtualAppScreen runtime commands are retired from the default Computer Use product path/);
    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'image-evidence-viewer'), false);
    assert.equal(payload?.artifacts?.some((artifact) => artifact.type === 'computer-use-virtual-screen'), false);
    assert.equal((payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined)?.diagnosticOptInEnv, VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV);
  } finally {
    if (original === undefined) {
      process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV] = '1';
    } else {
      process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV] = original;
    }
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

    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
    const screenSlot = payload?.uiManifest?.find((slot) => slot.componentId === 'image-evidence-viewer');
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

test('vision-sense accepts right pane VirtualAppScreen attach commands as fail-closed product runtime artifacts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-screen-attach-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:session-screen/screen-request"',
        '--activation-ref "computer-use:screen-activation/session-screen/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
        '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /VirtualAppScreen attach was accepted by the product runtime/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-screen-attach');
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.screenRef, 'virtual-app-screen:session-screen/screen-request');
    assert.equal(routeDecision?.adapterReadinessRef, 'computer-use:screen-activation/session-screen/provider-readiness.json');

    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
    const screenSlot = payload?.uiManifest?.find((slot) => slot.componentId === 'image-evidence-viewer');
    assert.match(stringField(screenSlot?.artifactRef), /^computer-use-virtual-screen-virtual-app-screen-screen-attach-/);
    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'blocked');
    assert.equal(screenData?.attachState, 'blocked');
    assert.equal(screenData?.surfaceMode, 'empty');
    assert.equal(screenData?.targetAppRef, 'app:profile/vscode-editor');
    assert.match(stringField(screenData?.adapterReadinessRef), /^computer-use:native-host\/preflights\/preflight-\d+\/adapter-readiness\.json$/);
    assert.equal(screenData?.providerReadinessRef, 'computer-use:screen-activation/session-screen/provider-readiness.json');
    assert.equal(screenData?.sessionRef, undefined);
    assert.equal(screenData?.liveSurfaceRef, undefined);
    assert.equal(screenData?.currentFrameRef, undefined);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.productRuntimeAccepted, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense materializes right pane VirtualAppScreen live refs from a registered runtime executor', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-screen-attached-'));
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:vision-runtime-test',
    providerId: 'provider:vision-runtime-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => validVirtualAppScreenAttachResult(command),
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:session-screen/screen-request"',
        '--activation-ref "computer-use:screen-activation/session-screen/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
        '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'done');
    assert.match(payload?.message ?? '', /registered runtime-owned native provider executor/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-screen-attach');
    assert.equal(routeDecision?.providerExecuted, true);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.sessionManagerStatus, 'attached');
    assert.equal(routeDecision?.sessionManagerExecutorId, 'native-session-manager:vision-runtime-test');

    assert.equal(payload?.uiManifest?.some((slot) => slot.componentId === 'virtual-screen-viewer'), false);
    const screenSlot = payload?.uiManifest?.find((slot) => slot.componentId === 'image-evidence-viewer');
    assert.match(stringField(screenSlot?.artifactRef), /^computer-use-virtual-screen-virtual-app-screen-screen-attach-/);
    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'ready');
    assert.equal(screenData?.attachState, 'attached');
    assert.equal(screenData?.surfaceMode, 'live');
    assert.equal(screenData?.sessionRef, 'computer-use:native-host/sessions/vision-runtime-test/session.json');
    assert.equal(screenData?.liveSurfaceRef, 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json');
    assert.equal(screenData?.frameStreamRef, 'computer-use:native-host/surfaces/vision-runtime-test/frame-stream.json');
    assert.equal(screenData?.currentFrameRef, 'computer-use:native-host/frames/vision-runtime-test/current.png');
    assert.equal((screenData?.isolationFlags as Record<string, unknown> | undefined)?.providerExecuted, true);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.completionEligible, false);
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense right pane VirtualAppScreen attach is generic and not keyed to smoke driver names', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  resetVirtualAppScreenInputRuntimeExecutorsForTests();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-generic-screen-attached-'));
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:generic-workbench-test',
    providerId: 'provider:generic-workbench-test',
    supportedProfiles: ['generic-workbench'],
    attach: (command) => {
      const result = validVirtualAppScreenAttachResult(command);
      return {
        ...result,
        executorId: 'native-session-manager:generic-workbench-test',
        providerId: 'provider:generic-workbench-test',
        evidence: {
          ...result.evidence,
          surfaceTransport: result.evidence.surfaceTransport
            ? { ...result.evidence.surfaceTransport, providerId: 'provider:generic-workbench-test' }
            : undefined,
        },
      };
    },
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "generic-workbench"',
        '--target-app-ref "app:profile/generic-workbench"',
        '--screen-ref "virtual-app-screen:generic-workbench/screen-request"',
        '--activation-ref "computer-use:screen-activation/generic-workbench/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/generic-workbench/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/generic-workbench/screen-activation.json"',
        '--gui-present-ref "gui.present:generic-workbench/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'done');
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-screen-attach');
    assert.equal(routeDecision?.profile, 'generic-workbench');
    assert.equal(routeDecision?.targetAppRef, 'app:profile/generic-workbench');
    assert.equal(routeDecision?.providerExecuted, true);
    assert.equal(routeDecision?.sessionManagerExecutorId, 'native-session-manager:generic-workbench-test');
    assert.equal(routeDecision?.sessionManagerProviderId, 'provider:generic-workbench-test');

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.attachState, 'attached');
    assert.equal(screenData?.surfaceMode, 'live');
    assert.equal(screenData?.targetAppRef, 'app:profile/generic-workbench');
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.sessionManagerExecutorId, 'native-session-manager:generic-workbench-test');
    assert.doesNotMatch(JSON.stringify({ routeDecision, screenData }), /virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge|com\.microsoft\.VSCode|noVNC|RDP|QEMU|Playwright/);
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense routes VirtualAppScreen reconnect without native attach or executor bootstrap', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-screen-reconnect-'));
  let attachCalls = 0;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:vision-runtime-test',
    providerId: 'provider:vision-runtime-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => {
      attachCalls += 1;
      return validVirtualAppScreenAttachResult(command);
    },
  });
  try {
    const seedPayload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:session-screen/screen-request"',
        '--activation-ref "computer-use:screen-activation/session-screen/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
        '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });
    assert.equal(seedPayload?.executionUnits[0]?.status, 'done', seedPayload?.message);
    const seedArtifact = seedPayload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const seedScreenData = seedArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(attachCalls, 1);
    attachCalls = 0;

    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen reconnect',
        '--source right-pane-screen',
        '--reason resize',
        `--screen-ref "${stringField(seedScreenData?.screenRef)}"`,
        `--session-ref "${stringField(seedScreenData?.sessionRef)}"`,
        `--live-surface-ref "${stringField(seedScreenData?.liveSurfaceRef)}"`,
        `--frame-stream-ref "${stringField(seedScreenData?.frameStreamRef)}"`,
        '--current-frame-ref "computer-use:native-host/frames/vision-runtime-test/current-42.png"',
        '--current-frame-sequence 42',
        `--provider-session-owner-ref "${stringField(seedScreenData?.providerSessionOwnerRef)}"`,
        `--provider-session-reconnect-ref "${stringField(seedScreenData?.providerSessionReconnectRef)}"`,
        `--surface-identity-ref "${stringField(seedScreenData?.surfaceIdentityRef)}"`,
        `--surface-owner-ref "${stringField(seedScreenData?.surfaceOwnerRef)}"`,
        `--display-owner-ref "${stringField(seedScreenData?.displayOwnerRef)}"`,
        `--live-binding-attach-grant-ref "${stringField(seedScreenData?.liveBindingAttachGrantRef)}"`,
        `--grant-validation-ref "${stringField(seedScreenData?.grantValidationRef)}"`,
        `--surface-transport-ref "${stringField(seedScreenData?.surfaceTransportRef)}"`,
      ].join(' '),
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
        },
      },
    });

    assert.equal(attachCalls, 0);
    assert.match(payload?.message ?? '', /VirtualAppScreen reconnect/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-screen-reconnect');
    assert.equal(routeDecision?.commandKind, 'screen-reconnect');
    assert.equal(routeDecision?.reconnectReason, 'resize');
    assert.equal(routeDecision?.sessionRef, 'computer-use:native-host/sessions/vision-runtime-test/session.json');
    assert.equal(routeDecision?.liveSurfaceRef, 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json');
    assert.equal(routeDecision?.frameStreamRef, 'computer-use:native-host/surfaces/vision-runtime-test/frame-stream.json');
    assert.equal(routeDecision?.currentFrameRef, 'computer-use:native-host/frames/vision-runtime-test/current-42.png');
    assert.equal(routeDecision?.currentFrameSequence, 42);
    assert.equal(routeDecision?.providerSessionOwnerRef, seedScreenData?.providerSessionOwnerRef);
    assert.equal(routeDecision?.providerSessionReconnectRef, seedScreenData?.providerSessionReconnectRef);
    assert.equal(routeDecision?.liveBindingAttachGrantRef, seedScreenData?.liveBindingAttachGrantRef);
    assert.equal(routeDecision?.surfaceTransportRef, 'computer-use:native-host/surfaces/vision-runtime-test/surface-transport.json');
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.sessionManagerStatus, 'attached');
    assert.equal((routeDecision?.runtimeExecutorBootstrap as Record<string, unknown> | undefined)?.skippedForReconnect, true);
    const sessionManagerEvidence = routeDecision?.sessionManagerEvidence as Record<string, unknown> | undefined;
    assert.equal(sessionManagerEvidence?.providerExecuted, false);
    assert.equal(sessionManagerEvidence?.nativeSessionCreated, false);
    assert.equal(sessionManagerEvidence?.liveFrameAttached, true);
    const surfaceTransport = sessionManagerEvidence?.surfaceTransport as Record<string, unknown> | undefined;
    assert.equal(surfaceTransport?.owner, 'VirtualDisplayProvider');
    assert.equal(surfaceTransport?.productFallback, false);
    assert.equal(surfaceTransport?.singleInteractiveTruth, true);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.screenRef, 'virtual-app-screen:session-screen/screen-request');
    assert.equal(screenData?.sessionRef, 'computer-use:native-host/sessions/vision-runtime-test/session.json');
    assert.equal(screenData?.liveSurfaceRef, 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json');
    assert.equal(screenData?.frameStreamRef, 'computer-use:native-host/surfaces/vision-runtime-test/frame-stream.json');
    assert.equal(screenData?.currentFrameRef, 'computer-use:native-host/frames/vision-runtime-test/current-42.png');
    assert.equal(screenData?.providerSessionOwnerRef, seedScreenData?.providerSessionOwnerRef);
    assert.equal(screenData?.providerSessionReconnectRef, seedScreenData?.providerSessionReconnectRef);
    assert.equal(screenData?.liveBindingAttachGrantRef, seedScreenData?.liveBindingAttachGrantRef);
    assert.equal(screenData?.surfaceTransportRef, 'computer-use:native-host/surfaces/vision-runtime-test/surface-transport.json');
    assert.deepEqual(screenData?.currentFrameSequence, {
      ref: 'computer-use:native-host/frames/vision-runtime-test/current-42.png',
      transport: 'native-frame-stream',
      diagnosticOnly: false,
      sequence: 42,
    });
    assert.equal((screenData?.isolationFlags as Record<string, unknown> | undefined)?.providerExecuted, false);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.providerSessionRevalidated, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    resetVirtualAppScreenProviderSessionStoreForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense fails closed when reconnect refs do not match the provider-owned session', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-screen-reconnect-mismatch-'));
  let attachCalls = 0;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:vision-runtime-test',
    providerId: 'provider:vision-runtime-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => {
      attachCalls += 1;
      return validVirtualAppScreenAttachResult(command);
    },
  });
  try {
    const seedPayload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:reconnect-mismatch/screen-request"',
        '--activation-ref "computer-use:screen-activation/reconnect-mismatch/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/reconnect-mismatch/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/reconnect-mismatch/screen-activation.json"',
        '--gui-present-ref "gui.present:reconnect-mismatch/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });
    assert.equal(seedPayload?.executionUnits[0]?.status, 'done', seedPayload?.message);
    const seedArtifact = seedPayload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const seedScreenData = seedArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(attachCalls, 1);
    attachCalls = 0;

    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen reconnect',
        '--source right-pane-screen',
        '--reason tab-switch',
        `--screen-ref "${stringField(seedScreenData?.screenRef)}"`,
        `--session-ref "${stringField(seedScreenData?.sessionRef)}"`,
        '--live-surface-ref "computer-use:session/reconnect-mismatch/wrong-live-surface.json"',
        `--frame-stream-ref "${stringField(seedScreenData?.frameStreamRef)}"`,
        '--current-frame-ref "computer-use:native-host/frames/vision-runtime-test/current-2.png"',
        '--current-frame-sequence 2',
        `--provider-session-owner-ref "${stringField(seedScreenData?.providerSessionOwnerRef)}"`,
        `--provider-session-reconnect-ref "${stringField(seedScreenData?.providerSessionReconnectRef)}"`,
        `--surface-identity-ref "${stringField(seedScreenData?.surfaceIdentityRef)}"`,
        `--surface-owner-ref "${stringField(seedScreenData?.surfaceOwnerRef)}"`,
        `--display-owner-ref "${stringField(seedScreenData?.displayOwnerRef)}"`,
        `--live-binding-attach-grant-ref "${stringField(seedScreenData?.liveBindingAttachGrantRef)}"`,
        `--grant-validation-ref "${stringField(seedScreenData?.grantValidationRef)}"`,
        `--surface-transport-ref "${stringField(seedScreenData?.surfaceTransportRef)}"`,
      ].join(' '),
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
        },
      },
    });

    assert.equal(attachCalls, 0);
    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /reconnect refs do not match the recorded runtime-owned session/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-screen-reconnect');
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.sessionManagerStatus, 'blocked');
    assert.equal((routeDecision?.runtimeExecutorBootstrap as Record<string, unknown> | undefined)?.skippedForReconnect, true);
    assert.equal((routeDecision?.sessionManagerEvidence as Record<string, unknown> | undefined)?.liveFrameAttached, false);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'blocked');
    assert.equal(screenData?.attachState, 'blocked');
    assert.equal(screenData?.sessionRef, seedScreenData?.sessionRef);
    assert.equal(screenData?.liveSurfaceRef, 'computer-use:session/reconnect-mismatch/wrong-live-surface.json');
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.productRuntimeAccepted, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    resetVirtualAppScreenProviderSessionStoreForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense permission handoff keeps provider attach gated behind readiness and recheck', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-permission-handoff-'));
  let attachCalls = 0;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:permission-handoff-tripwire',
    providerId: 'provider:permission-handoff-tripwire',
    supportedProfiles: ['*'],
    attach: (command) => {
      attachCalls += 1;
      return validVirtualAppScreenAttachResult(command);
    },
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use permission-handoff',
        '--source right-pane-screen',
        '--profile "generic-workbench"',
        '--target-app-ref "app:profile/generic-workbench"',
        '--screen-ref "virtual-app-screen:permission-handoff/screen-request"',
        '--permission-handoff-ref "computer-use:screen-activation/permission-handoff/accessibility-handoff.json"',
        '--permission-ref "permission:macos/accessibility"',
        '--adapter-readiness-ref "computer-use:screen-activation/permission-handoff/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/permission-handoff/screen-activation.json"',
        '--gui-present-ref "gui.present:permission-handoff/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(attachCalls, 0);
    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /permission handoff was accepted by the product runtime/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-permission-handoff');
    assert.equal(routeDecision?.targetRef, 'computer-use:screen-activation/permission-handoff/accessibility-handoff.json');
    assert.equal(routeDecision?.adapterReadinessRef, 'computer-use:screen-activation/permission-handoff/provider-readiness.json');
    assert.equal(routeDecision?.permissionRef, 'permission:macos/accessibility');
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.sessionManagerStatus, 'requires-handoff');

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'requires-handoff');
    assert.equal(screenData?.attachState, 'requires-handoff');
    assert.equal(screenData?.targetAppRef, 'app:profile/generic-workbench');
    assert.equal(screenData?.permissionHandoffRef, 'computer-use:screen-activation/permission-handoff/accessibility-handoff.json');
    assert.equal(screenData?.permissionRef, 'permission:macos/accessibility');
    assert.equal(screenData?.providerReadinessRef, 'computer-use:screen-activation/permission-handoff/provider-readiness.json');
    assert.equal(screenData?.sessionRef, undefined);
    assert.equal(screenData?.liveSurfaceRef, undefined);
    assert.equal(screenData?.currentFrameRef, undefined);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.productRuntimeAccepted, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense exposes Host permission handoff ledger refs for an existing Host session', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-permission-handoff-ledger-'));
  const { ledgerRef, sessionRef } = createRecordedVisionNativeHostSession();
  let attachCalls = 0;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:permission-handoff-ledger-tripwire',
    providerId: 'provider:permission-handoff-ledger-tripwire',
    supportedProfiles: ['*'],
    attach: (command) => {
      attachCalls += 1;
      return validVirtualAppScreenAttachResult(command);
    },
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use permission-handoff',
        '--source right-pane-screen',
        '--profile "generic-workbench"',
        '--target-app-ref "app:profile/generic-workbench"',
        '--screen-ref "virtual-app-screen:permission-handoff-ledger/screen-request"',
        `--session-ref "${sessionRef}"`,
        '--permission-handoff-ref "computer-use:screen-activation/permission-handoff-ledger/accessibility-handoff.json"',
        '--permission-ref "permission:macos/accessibility"',
        '--adapter-readiness-ref "computer-use:screen-activation/permission-handoff-ledger/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/permission-handoff-ledger/screen-activation.json"',
        '--gui-present-ref "gui.present:permission-handoff-ledger/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(attachCalls, 0);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-permission-handoff');
    assert.equal(routeDecision?.hostEvidenceLedgerRef, ledgerRef);
    assert.equal(routeDecision?.evidenceLedgerRef, ledgerRef);
    assert.match(
      stringField(routeDecision?.permissionHandoffLedgerEntryRef),
      /^computer-use:native-host\/ledgers\/session-\d+\/evidence-ledger\.json\/events\/\d+-permission\.handoff\.json$/,
    );
    assert.equal(routeDecision?.providerExecuted, false);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'requires-handoff');
    assert.equal(screenData?.hostEvidenceLedgerRef, ledgerRef);
    assert.equal(screenData?.evidenceLedgerRef, ledgerRef);
    assert.equal(screenData?.permissionHandoffLedgerEntryRef, routeDecision?.permissionHandoffLedgerEntryRef);
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    resetVirtualAppScreenNativeHostSessionStoreForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense continues permission recheck into native attach when a registered executor is ready', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-permission-recheck-attached-'));
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:vision-runtime-test',
    providerId: 'provider:vision-runtime-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => validVirtualAppScreenAttachResult(command),
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use permission-recheck',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:session-screen/screen-request"',
        '--permission-recheck-ref "computer-use:screen-activation/session-screen/permission-recheck.json"',
        '--permission-ref "permission:macos/accessibility"',
        '--adapter-readiness-ref "computer-use:screen-activation/session-screen/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/session-screen/screen-activation.json"',
        '--gui-present-ref "gui.present:session-screen/screen-pane-activation"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'done');
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-permission-recheck');
    assert.equal(routeDecision?.providerExecuted, true);
    assert.equal(routeDecision?.permissionRef, 'permission:macos/accessibility');
    assert.equal(routeDecision?.recheckRef, 'computer-use:screen-activation/session-screen/permission-recheck.json');
    assert.equal(routeDecision?.sessionManagerStatus, 'attached');

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.attachState, 'attached');
    assert.equal(screenData?.liveSurfaceRef, 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json');
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense rejects unsafe right pane VirtualAppScreen runtime refs before package bridge', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-screen-unsafe-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--target-app-ref "app:profile/vscode-editor"',
        '--activation-ref "data:image/png;base64,abc"',
        '--adapter-readiness-ref "computer-use:screen/readiness.json"',
      ].join(' '),
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
          runId: 'unsafe-right-pane-runtime-command',
          testActionFixtureMode: true,
          testOnlyActions: [{ type: 'type_text', text: 'must not execute' }],
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /ref --activation-ref is unsafe/);
    assert.equal((payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined)?.route, 'virtual-app-screen-runtime-command');
    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense records VirtualAppScreen canvas input intents as fail-closed runtime artifacts', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  resetVirtualAppScreenInputRuntimeExecutorsForTests();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-input-intent-canvas-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use input-intent',
        '--source virtual-app-screen-canvas',
        '--kind click',
        '--session-ref "computer-use:session/input/session.json"',
        '--screen-ref "virtual-app-screen:input/screen-a"',
        '--target-app-ref "app:vscode"',
        '--target-window-ref "window:vscode/main"',
        '--frame-ref "computer-use:session/input/frames/current.png"',
        '--input-lease-ref "computer-use:session/input/leases/active.json"',
        '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
        '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
        '--evidence-ledger-ref "computer-use:session/input/evidence-ledger.json"',
        '--frame-width 1440',
        '--frame-height 900',
        '--x-ratio 0.125',
        '--y-ratio 0.5',
      ].join(' '),
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
          runId: 'input-intent-must-not-bridge',
          testActionFixtureMode: true,
          testOnlyActions: [{ type: 'type_text', text: 'must not execute' }],
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /no runtime-owned input provider/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-input-intent');
    assert.equal(routeDecision?.source, 'virtual-app-screen-canvas');
    assert.equal(routeDecision?.inputIntentKind, 'click');
    assert.equal(routeDecision?.actionType, 'click');
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.equal(routeDecision?.sessionRef, 'computer-use:session/input/session.json');
    assert.match(stringField(routeDecision?.inputIntentRef), /^computer-use:session\/virtual-app-screen-input-intent/);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'blocked');
    assert.equal(screenData?.attachState, 'blocked');
    assert.equal(screenData?.surfaceMode, 'replay');
    assert.equal(screenData?.currentFrameRef, 'computer-use:session/input/frames/current.png');
    assert.deepEqual(screenData?.inputIntentRefs, [routeDecision?.inputIntentRef]);
    assert.equal((screenData?.isolationFlags as Record<string, unknown> | undefined)?.providerExecuted, false);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.inputIntentAccepted, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense records VirtualAppScreen lease controls as fail-closed runtime artifacts', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  resetVirtualAppScreenInputRuntimeExecutorsForTests();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-input-intent-control-blocked-'));
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use input-intent',
        '--source virtual-app-screen-control',
        '--kind takeover',
        '--session-ref "computer-use:session/input/session.json"',
        '--screen-ref "virtual-app-screen:input/screen-a"',
        '--target-app-ref "app:vscode"',
        '--target-window-ref "window:vscode/main"',
        '--input-lease-ref "computer-use:session/input/leases/active.json"',
        '--user-lease-ref "computer-use:session/input/leases/user.json"',
        '--agent-lease-ref "computer-use:session/input/leases/agent.json"',
        '--active-lease-owner-ref "computer-use:session/input/leases/owner-agent.json"',
        '--active-lease-owner-role agent',
        '--lease-control-ref "computer-use:session/input/leases/takeover.json"',
        '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
        '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
        '--evidence-ledger-ref "computer-use:session/input/evidence-ledger.json"',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'failed-with-reason');
    assert.match(payload?.message ?? '', /lease control "takeover"/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-input-intent');
    assert.equal(routeDecision?.source, 'virtual-app-screen-control');
    assert.equal(routeDecision?.controlKind, 'takeover');
    assert.equal(routeDecision?.leaseControlRef, 'computer-use:session/input/leases/takeover.json');
    assert.equal(routeDecision?.providerExecuted, false);
    assert.equal(routeDecision?.mutatingActionExecuted, false);
    assert.match(stringField(routeDecision?.agentQueueRef), /^computer-use:session\/virtual-app-screen-input-intent/);
    assert.equal(routeDecision?.agentQueueStatus, 'paused');
    assert.equal(routeDecision?.closesUserRealApp, false);
    const controlPlanePolicy = routeDecision?.controlPlanePolicy as Record<string, unknown> | undefined;
    assert.equal(controlPlanePolicy?.controlKind, 'takeover');
    assert.equal(controlPlanePolicy?.physicalDesktopInputAllowed, false);
    assert.equal(controlPlanePolicy?.sharedInputAllowed, false);
    assert.equal(controlPlanePolicy?.currentSessionOnly, true);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'blocked');
    assert.equal(screenData?.attachState, 'blocked');
    assert.equal(screenData?.surfaceMode, 'empty');
    assert.equal(screenData?.takeoverRef, 'computer-use:session/input/leases/takeover.json');
    assert.equal(screenData?.userLeaseRef, 'computer-use:session/input/leases/user.json');
    assert.equal(screenData?.agentLeaseRef, 'computer-use:session/input/leases/agent.json');
    assert.equal(screenData?.activeLeaseOwnerRole, 'agent');
    assert.equal(screenData?.agentQueueRef, routeDecision?.agentQueueRef);
    assert.equal(screenData?.closesUserRealApp, false);
    assert.equal((screenData?.runSummary as Record<string, unknown> | undefined)?.controlKind, 'takeover');
    assert.deepEqual(screenData?.inputIntentRefs, [routeDecision?.inputIntentRef]);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('vision-sense executes VirtualAppScreen input intents when a runtime-owned input executor is registered', async () => {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  resetVirtualAppScreenInputRuntimeExecutorsForTests();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-input-intent-executed-'));
  const unregister = registerVirtualAppScreenInputRuntimeExecutor({
    executorId: 'input-runtime:vision-test',
    providerId: 'provider:vision-input-test',
    execute: (command) => validInputRuntimeResult(command),
  });
  try {
    const payload = await tryRunVisionSenseRuntime({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use input-intent',
        '--source virtual-app-screen-canvas',
        '--kind click',
        '--session-ref "computer-use:session/input/session.json"',
        '--screen-ref "virtual-app-screen:input/screen-a"',
        '--target-app-ref "app:vscode"',
        '--target-window-ref "window:vscode/main"',
        '--frame-ref "computer-use:session/input/frames/current.png"',
        '--input-lease-ref "computer-use:session/input/leases/active.json"',
        '--action-adapter-ref "computer-use:session/input/adapters/native-window.json"',
        '--adapter-readiness-ref "computer-use:session/input/readiness/native-window.json"',
        '--evidence-ledger-ref "computer-use:session/input/evidence-ledger.json"',
        '--frame-width 1440',
        '--frame-height 900',
        '--x-ratio 0.125',
        '--y-ratio 0.5',
      ].join(' '),
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
        },
      },
    });

    assert.equal(payload?.executionUnits[0]?.status, 'done');
    assert.match(payload?.message ?? '', /input "click" executed/);
    const routeDecision = payload?.executionUnits[0]?.routeDecision as Record<string, unknown> | undefined;
    assert.equal(routeDecision?.route, 'virtual-app-screen-input-intent');
    assert.equal(routeDecision?.providerExecuted, true);
    assert.equal(routeDecision?.mutatingActionExecuted, true);
    assert.equal(routeDecision?.executorId, 'input-runtime:vision-test');
    assert.deepEqual(routeDecision?.inputIntentRefs, ['computer-use:session/input/executed/input-intent.json']);
    assert.equal((routeDecision?.inputRuntimeEvidence as Record<string, unknown> | undefined)?.providerExecuted, true);

    const screenArtifact = payload?.artifacts?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;
    assert.equal(screenData?.status, 'ready');
    assert.equal(screenData?.attachState, 'observe-only');
    assert.equal(screenData?.currentFrameRef, 'computer-use:session/input/frames/after.png');
    assert.deepEqual(screenData?.inputIntentRefs, ['computer-use:session/input/executed/input-intent.json']);
    assert.equal((screenData?.isolationFlags as Record<string, unknown> | undefined)?.providerExecuted, true);

    await assert.rejects(readdir(join(workspace, '.sciforge/vision-runs')));
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
    resetVirtualAppScreenInputRuntimeExecutorsForTests();
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

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function validInputRuntimeResult(
  command: VirtualScreenInputIntentCommand,
): VirtualAppScreenInputRuntimeProjection {
  return {
    runId: 'vision-input-runtime-test',
    status: 'executed',
    message: `VirtualAppScreen input "${command.intentKind}" executed through a runtime-owned provider executor.`,
    executorId: 'input-runtime:vision-test',
    providerId: 'provider:vision-input-test',
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: true,
      inputIntentRecorded: true,
      executorEventRecorded: true,
      beforeAfterFrameMaterialized: true,
      verificationRecorded: true,
      evidenceLedgerRecorded: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      evidenceRefs: [
        'computer-use:session/input/executed/input-intent.json',
        'computer-use:session/input/executed/executor-event.json',
        'computer-use:session/input/before-after/click.json',
        'computer-use:session/input/verification/click.json',
        'computer-use:session/input/evidence-ledger.json',
      ],
    },
    routeDecision: {
      schemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
      route: 'virtual-app-screen-input-intent',
      runId: 'vision-input-runtime-test',
      source: command.source,
      inputIntentKind: command.intentKind,
      actionType: command.action?.type,
      sessionRef: command.refs.sessionRef,
      screenRef: command.refs.screenRef,
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: command.refs.targetWindowRef,
      frameRef: command.refs.frameRef,
      inputLeaseRef: command.refs.inputLeaseRef,
      actionAdapterRef: command.refs.actionAdapterRef,
      adapterReadinessRef: command.refs.adapterReadinessRef,
      evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
      inputIntentRefs: ['computer-use:session/input/executed/input-intent.json'],
      executorEventRefs: ['computer-use:session/input/executed/executor-event.json'],
      beforeFrameRef: 'computer-use:session/input/frames/before.png',
      afterFrameRef: 'computer-use:session/input/frames/after.png',
      beforeAfterFrameRefs: ['computer-use:session/input/before-after/click.json'],
      verificationRefs: ['computer-use:session/input/verification/click.json'],
      currentFrameRef: 'computer-use:session/input/frames/after.png',
      terminalEquivalent: true,
      failClosed: false,
      providerExecuted: true,
      mutatingActionExecuted: true,
      currentSessionOnly: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      rawPayloadWritten: false,
      executorId: 'input-runtime:vision-test',
      providerId: 'provider:vision-input-test',
    },
    virtualScreenData: {
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      inputRuntimeSchemaVersion: VIRTUAL_APP_SCREEN_INPUT_RUNTIME_SCHEMA,
      title: 'Computer Use Virtual Screen',
      status: 'ready',
      attachState: 'observe-only',
      surfaceMode: 'replay',
      currentRunRef: '.sciforge/vision-runs/vision-input-runtime-test/current-run.json',
      screenRef: command.refs.screenRef,
      visibleScreenRefs: [command.refs.screenRef].filter(Boolean),
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: command.refs.targetWindowRef,
      sessionRef: command.refs.sessionRef,
      frameRef: 'computer-use:session/input/frames/after.png',
      currentFrameRef: 'computer-use:session/input/frames/after.png',
      beforeFrameRef: 'computer-use:session/input/frames/before.png',
      afterFrameRef: 'computer-use:session/input/frames/after.png',
      beforeAfterFrameRefs: ['computer-use:session/input/before-after/click.json'],
      inputLeaseRef: command.refs.inputLeaseRef,
      actionAdapterRef: command.refs.actionAdapterRef,
      adapterReadinessRef: command.refs.adapterReadinessRef,
      evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
      inputIntentRefs: ['computer-use:session/input/executed/input-intent.json'],
      executorEventRefs: ['computer-use:session/input/executed/executor-event.json'],
      verificationRefs: ['computer-use:session/input/verification/click.json'],
      isolationFlags: {
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        currentSessionOnly: true,
        singleInteractiveTruth: true,
        secondInteractiveSurfacePresent: false,
        providerExecuted: true,
        mutatingActionExecuted: true,
        backgroundRenderable: true,
        diagnosticOnly: false,
        failClosedByDefault: true,
      },
      runSummary: {
        status: 'executed',
        runId: 'vision-input-runtime-test',
        inputIntentAccepted: true,
        source: command.source,
        inputIntentKind: command.intentKind,
        actionType: command.action?.type,
        actor: 'user',
        frameCount: 1,
        screenCount: command.refs.screenRef ? 1 : 0,
        realNativeSidecarExecuted: true,
        providerExecuted: true,
        mutatingActionExecuted: true,
        completionEligible: false,
        evidenceLedgerRef: 'computer-use:session/input/evidence-ledger.json',
      },
    },
  };
}

function validVirtualAppScreenAttachResult(
  command: VirtualAppScreenRuntimeCommand,
): VirtualAppScreenSessionManagerAttachResult {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: 'native-session-manager:vision-runtime-test',
    providerId: 'provider:vision-runtime-test',
    refs: {
      currentRunRef: '.sciforge/vision-runs/vision-runtime-test/current-run.json',
      sessionRef: 'computer-use:native-host/sessions/vision-runtime-test/session.json',
      liveSurfaceRef: 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json',
      surfaceTransportRef: 'computer-use:native-host/surfaces/vision-runtime-test/surface-transport.json',
      frameStreamRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-stream.json',
      currentFrameRef: 'computer-use:native-host/frames/vision-runtime-test/current.png',
      currentRunPointerRef: 'computer-use:native-host/runs/vision-runtime-test/current-run-pointer.json',
      minimalEvidenceReplayRefs: visionRuntimeMinimalEvidenceReplayRefs(),
      frameTransportContractRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-transport-contract.json',
      frameTelemetryRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-telemetry.json',
      mediaChannelRef: 'computer-use:native-host/surfaces/vision-runtime-test/native-frame-stream/live',
      dataChannelRef: 'computer-use:native-host/surfaces/vision-runtime-test/native-frame-control-channel/control',
      liveBindingAttachGrantRef: 'computer-use:native-host/grants/vision-runtime-test/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0004-grant.validated.json',
      surfaceIdentityRef: 'computer-use:provider-session/vision-runtime-test/surface-identity.json',
      surfaceOwnerRef: 'computer-use:native-host/surfaces/vision-runtime-test/surface-owner.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/vision-runtime-test/display-owner.json',
      screenRef: command.refs.screenRef,
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: 'window:vision-runtime-test/main',
      inputLeaseRef: 'computer-use:native-host/input/vision-runtime-test/input-lease.json',
      actionAdapterRef: 'computer-use:native-host/input/vision-runtime-test/action-adapter.json',
      adapterReadinessRef: command.refs.readinessRef,
      platformDriverRef: 'computer-use:native-host/platform-drivers/vision-runtime-test/platform-driver.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json',
      hostEvidenceLedgerRef: 'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json',
      guiPresentRef: command.refs.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      platformDriverReady: true,
      permissionRequired: false,
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: {
        schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
        owner: 'VirtualDisplayProvider',
        providerId: 'provider:vision-runtime-test',
        transport: 'native-frame-stream',
        surfaceTransportRef: 'computer-use:native-host/surfaces/vision-runtime-test/surface-transport.json',
        liveSurfaceRef: 'computer-use:native-host/surfaces/vision-runtime-test/live-surface.json',
        frameStreamRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-stream.json',
        currentFrameRef: 'computer-use:native-host/frames/vision-runtime-test/current.png',
        frameTransportContractRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-transport-contract.json',
        frameTelemetryRef: 'computer-use:native-host/surfaces/vision-runtime-test/frame-telemetry.json',
        mediaChannelRef: 'computer-use:native-host/surfaces/vision-runtime-test/native-frame-stream/live',
        dataChannelRef: 'computer-use:native-host/surfaces/vision-runtime-test/native-frame-control-channel/control',
        currentFrameSequence: 1,
        diagnosticOnly: false,
        productFallback: false,
        singleInteractiveTruth: true,
      },
      evidenceRefs: [
        'computer-use:native-host/surfaces/vision-runtime-test/surface-transport.json',
        'computer-use:native-host/platform-drivers/vision-runtime-test/platform-driver.json',
        'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json',
        'computer-use:native-host/grants/vision-runtime-test/live-binding-attach-grant.json',
        'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0004-grant.validated.json',
        'computer-use:native-host/surfaces/vision-runtime-test/surface-owner.json',
        'computer-use:native-host/surfaces/vision-runtime-test/display-owner.json',
        'computer-use:native-host/frames/vision-runtime-test/current.png',
        'computer-use:native-host/runs/vision-runtime-test/current-run-pointer.json',
        ...visionRuntimeMinimalEvidenceReplayRefs(),
      ],
    },
  };
}

function visionRuntimeMinimalEvidenceReplayRefs() {
  return [
    'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0001-session.created.json',
    'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0003-surface.attached.json',
    'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0004-grant.validated.json',
    'computer-use:native-host/ledgers/vision-runtime-test/evidence-ledger.json/events/0005-frame.read.json',
  ];
}

function createRecordedVisionNativeHostSession(
  screenRef = 'virtual-app-screen:permission-handoff-ledger/screen-request',
) {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const created = host.createSession(
    { profileId: 'generic-workbench', defaultSurfaceTransport: 'native-frame-stream' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:run/vision-native-host/current-run.json',
      evidenceRootRef: 'computer-use:run/vision-native-host/evidence',
    },
  );
  assert.equal(created.status, 'ok');
  if (created.status !== 'ok') throw new Error('expected Native Host session creation');

  const launched = host.launchOrAttachApp(created.value.sessionId, {
    appId: 'generic-workbench',
    appRef: 'app:profile/generic-workbench',
  });
  assert.equal(launched.status, 'ok');

  const attached = host.attachSurface(created.value.sessionId, {
    screenRef,
    targetWindowRef: 'window:vision-runtime-test/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  if (attached.status !== 'ok') throw new Error('expected Native Host surface attach');

  const frame = host.readFrame(created.value.sessionId);
  assert.equal(frame.status, 'ok');
  if (frame.status !== 'ok') throw new Error('expected Native Host frame read');

  const record = recordVirtualAppScreenNativeHostSession({
    host,
    session: created.value,
    surface: attached.value,
    frame: frame.value,
    refs: {
      adapterReadinessRef: created.value.readiness.adapterReadinessRef,
      evidenceLedgerRef: created.value.ledgerRef,
    },
  });
  return {
    host,
    session: created.value,
    sessionRef: record.sessionRef,
    ledgerRef: record.evidenceLedgerRef,
  };
}
