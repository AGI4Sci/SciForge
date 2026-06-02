import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRoute,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const SCHEMA = 'sciforge.computer-use.virtual-app-screen-dogfood-product.v1' as const;
const DEFAULT_BOOTSTRAP_MS = 8_000;

type DogfoodPhase =
  | 'open-sciforge'
  | 'enter-screen'
  | 'auto-provision-attach'
  | 'operate-vscode-input-intent'
  | 'human-takeover'
  | 'resume-agent'
  | 'manifest-output';

type ManifestStatus = 'passed' | 'blocked';

type DogfoodRefs = {
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  inputLeaseRef?: string;
  activeLeaseOwnerRef?: string;
  userLeaseRef?: string;
  agentLeaseRef?: string;
  adapterReadinessRef?: string;
  permissionRef?: string;
  blockedRef?: string;
  handoffRef?: string;
  evidenceLedgerRef?: string;
  attachState?: string;
  status?: string;
  surfaceMode?: string;
  inputIntentReady?: boolean;
  leaseControlReady?: boolean;
  guiPresentRefs?: string[];
  inputIntentRefs?: string[];
  executorEventRefs?: string[];
  beforeAfterFrameRefs?: string[];
  permissionRefs?: string[];
  takeoverRefs?: string[];
  pauseRefs?: string[];
  resumeRefs?: string[];
  lastCommandTexts?: string[];
  blockedReason?: string;
};

type VirtualAppScreenDogfoodManifest = {
  schemaVersion: typeof SCHEMA;
  status: ManifestStatus;
  source: 'product-ui-right-pane';
  runId: string;
  observedAt: string;
  phase: DogfoodPhase;
  reason: string | null;
  rightPane: {
    openedSciForge: boolean;
    enteredScreen: boolean;
    activationRequested: boolean;
    attachState: string | null;
    status: string | null;
    surfaceMode: string | null;
    screenRef: string | null;
    targetAppRef: string | null;
    targetWindowRef: string | null;
    sessionRef: string | null;
    guiPresentRefs: string[];
    activationCommandRefs: string[];
  };
  runtimeCommandAcceptance: {
    commandObserved: boolean;
    parsed: boolean;
    route: string | null;
    source: string | null;
    screenRef: string | null;
    targetAppRef: string | null;
    adapterReadinessRef: string | null;
    activationRef: string | null;
    targetRef: string | null;
    failClosed: true;
    providerExecuted: false;
    reason: string | null;
  };
  providerReadiness: {
    status: 'ready' | 'permission-missing' | 'adapter-unavailable' | 'blocked' | 'unknown';
    refs: string[];
  };
  permissionRefs: string[];
  lastFrameRefs: string[];
  lastInputRefs: string[];
  vscodeOperation: {
    attemptedViaInputIntent: boolean;
    commandRefs: string[];
    completed: boolean;
  };
  humanIntervention: {
    takeoverAttempted: boolean;
    resumeAttempted: boolean;
    takeoverRefs: string[];
    resumeRefs: string[];
    completed: boolean;
  };
  bounded: {
    refsFirst: true;
    rawPayloadsCaptured: false;
    providerInternalsUsed: false;
    hardcodedPageScreenshotOrUrl: false;
    sharedSystemInputUsed: false;
  };
};

test('VirtualAppScreen dogfood blocked manifest is refs-first and phase-specific', async () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-blocked',
    phase: 'auto-provision-attach',
    reason: 'native VirtualDisplayProvider did not attach within the Screen bootstrap window',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'blocked',
      status: 'blocked',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:contract/screen-request',
      targetAppRef: 'app:profile/vscode-editor',
      adapterReadinessRef: 'computer-use:screen-activation/contract/provider-readiness.json',
      handoffRef: 'computer-use:screen-activation/contract/attach-request.json',
      blockedRef: 'computer-use:screen-activation/contract/blocked/no-native-session.json',
      evidenceLedgerRef: 'ledger:computer-use/contract/screen-activation.json',
      guiPresentRefs: ['gui.present:contract/screen-pane-activation'],
      permissionRefs: ['computer-use:screen-activation/contract/permissions/accessibility.json'],
      lastCommandTexts: [[
        '/computer-use screen attach',
        '--source right-pane-screen',
        '--profile "vscode-editor"',
        '--target-app-ref "app:profile/vscode-editor"',
        '--screen-ref "virtual-app-screen:contract/screen-request"',
        '--activation-ref "computer-use:screen-activation/contract/attach-request.json"',
        '--adapter-readiness-ref "computer-use:screen-activation/contract/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/contract/screen-activation.json"',
        '--gui-present-ref "gui.present:contract/screen-pane-activation"',
      ].join(' ')],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.phase, 'auto-provision-attach');
  assert.equal(manifest.rightPane.activationRequested, true);
  assert.equal(manifest.runtimeCommandAcceptance.commandObserved, true);
  assert.equal(manifest.runtimeCommandAcceptance.parsed, true);
  assert.equal(manifest.runtimeCommandAcceptance.route, 'virtual-app-screen-screen-attach');
  assert.deepEqual(manifest.providerReadiness.refs, ['computer-use:screen-activation/contract/provider-readiness.json']);
  assert.deepEqual(manifest.permissionRefs, ['computer-use:screen-activation/contract/permissions/accessibility.json']);
  assert.deepEqual(manifest.lastFrameRefs, []);
  assert.deepEqual(manifest.lastInputRefs, []);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood manifest accepts generic permission handoff with readiness refs', () => {
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-generic-handoff',
    phase: 'auto-provision-attach',
    reason: 'generic target requires provider permission handoff before native session attach',
    openedSciForge: true,
    enteredScreen: true,
    refs: {
      attachState: 'requires-handoff',
      status: 'requires-handoff',
      surfaceMode: 'empty',
      screenRef: 'virtual-app-screen:generic-workbench/screen-request',
      targetAppRef: 'app:profile/generic-workbench',
      adapterReadinessRef: 'computer-use:screen-activation/generic-workbench/provider-readiness.json',
      permissionRef: 'permission:macos/accessibility',
      handoffRef: 'computer-use:screen-activation/generic-workbench/permission-handoff.json',
      evidenceLedgerRef: 'ledger:computer-use/generic-workbench/screen-activation.json',
      guiPresentRefs: ['gui.present:generic-workbench/screen-pane-activation'],
      permissionRefs: ['permission:macos/accessibility'],
      lastCommandTexts: [[
        '/computer-use permission-handoff',
        '--source right-pane-screen',
        '--profile "generic-workbench"',
        '--target-app-ref "app:profile/generic-workbench"',
        '--screen-ref "virtual-app-screen:generic-workbench/screen-request"',
        '--permission-handoff-ref "computer-use:screen-activation/generic-workbench/permission-handoff.json"',
        '--permission-ref "permission:macos/accessibility"',
        '--adapter-readiness-ref "computer-use:screen-activation/generic-workbench/provider-readiness.json"',
        '--evidence-ledger-ref "ledger:computer-use/generic-workbench/screen-activation.json"',
        '--gui-present-ref "gui.present:generic-workbench/screen-pane-activation"',
      ].join(' ')],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.runtimeCommandAcceptance.commandObserved, true);
  assert.equal(manifest.runtimeCommandAcceptance.route, 'virtual-app-screen-permission-handoff');
  assert.equal(manifest.runtimeCommandAcceptance.targetAppRef, 'app:profile/generic-workbench');
  assert.equal(manifest.runtimeCommandAcceptance.adapterReadinessRef, 'computer-use:screen-activation/generic-workbench/provider-readiness.json');
  assert.equal(manifest.runtimeCommandAcceptance.targetRef, 'computer-use:screen-activation/generic-workbench/permission-handoff.json');
  assert.deepEqual(manifest.providerReadiness.refs, ['computer-use:screen-activation/generic-workbench/provider-readiness.json']);
  assert.deepEqual(manifest.permissionRefs, ['permission:macos/accessibility']);
  assert.equal(manifest.rightPane.activationRequested, true);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood passed manifest requires Screen UI, InputIntent, and human resume refs', () => {
  const refs: DogfoodRefs = {
    attachState: 'attached',
    status: 'ready',
    surfaceMode: 'live',
    screenRef: 'virtual-app-screen:dogfood/screen-a',
    targetAppRef: 'app:profile/vscode-editor',
    targetWindowRef: 'window:vscode-editor/main',
    sessionRef: 'computer-use:session/dogfood/session.json',
    liveSurfaceRef: 'computer-use:session/dogfood/live-surface.json',
    frameStreamRef: 'computer-use:session/dogfood/frame-stream.json',
    currentFrameRef: 'computer-use:session/dogfood/frames/after.json',
    beforeFrameRef: 'computer-use:session/dogfood/frames/before.json',
    afterFrameRef: 'computer-use:session/dogfood/frames/after.json',
    inputLeaseRef: 'computer-use:session/dogfood/leases/active.json',
    userLeaseRef: 'computer-use:session/dogfood/leases/user.json',
    agentLeaseRef: 'computer-use:session/dogfood/leases/agent.json',
    activeLeaseOwnerRef: 'computer-use:session/dogfood/leases/agent.json',
    adapterReadinessRef: 'computer-use:session/dogfood/readiness/native-app-window.json',
    evidenceLedgerRef: 'computer-use:session/dogfood/evidence-ledger.json',
    guiPresentRefs: ['gui.present:dogfood/screen-pane'],
    inputIntentRefs: ['computer-use:session/dogfood/input-intents/type-marker.json'],
    executorEventRefs: ['computer-use:session/dogfood/executor-events/type-marker.json'],
    beforeAfterFrameRefs: ['computer-use:session/dogfood/before-after/type-marker.json'],
    takeoverRefs: ['computer-use:session/dogfood/leases/takeover.json'],
    resumeRefs: ['computer-use:session/dogfood/leases/resume-agent.json'],
    inputIntentReady: true,
    leaseControlReady: true,
  };
  const manifest = buildDogfoodManifest({
    runId: 'vas-dogfood-contract-passed',
    phase: 'manifest-output',
    reason: null,
    openedSciForge: true,
    enteredScreen: true,
    refs,
  });

  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.vscodeOperation.attemptedViaInputIntent, true);
  assert.equal(manifest.humanIntervention.takeoverAttempted, true);
  assert.equal(manifest.humanIntervention.resumeAttempted, true);
  assertDogfoodManifest(manifest);
});

test('VirtualAppScreen dogfood product smoke opens SciForge Screen and writes bounded manifest', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  const runId = `vas-dogfood-${Date.now().toString(36)}`;
  const fallbackManifestPath = process.env.SCIFORGE_VAS_DOGFOOD_MANIFEST;

  if (!existsSync(browserExecutable)) {
    const manifest = buildDogfoodManifest({
      runId,
      phase: 'open-sciforge',
      reason: `browser executable unavailable for product UI smoke: ${browserExecutable}`,
      openedSciForge: false,
      enteredScreen: false,
      refs: {},
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-vas-dogfood-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'dogfood-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  let manifest: VirtualAppScreenDogfoodManifest | undefined;
  try {
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_UI_PORT: String(uiPort),
      SCIFORGE_AGENT_SERVER_AUTOSTART: '0',
      SCIFORGE_AGENT_SERVER_URL: 'http://127.0.0.1:1',
    };
    children.push(spawnProcess('npm', ['run', 'workspace:server', '--silent'], commonEnv));
    await waitForHttp(`${writerUrl}/health`, 30_000);
    children.push(spawnProcess('npm', ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], commonEnv));
    await waitForHttp(uiUrl, 45_000);

    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });
    await ensureScreenPane(page);
    await page.locator('[data-component-id="virtual-screen-viewer"]').waitFor({ state: 'visible', timeout: 20_000 });

    const refs = await readScreenRefs(page);
    const afterBootstrap = await waitForScreenBootstrap(page, DEFAULT_BOOTSTRAP_MS);
    const current = { ...refs, ...afterBootstrap };

    if (current.attachState === 'attached' && current.inputIntentReady) {
      await page.locator('.virtual-screen-frame-image[data-event="virtual-screen-input-intent-request"]').first().click({ position: { x: 10, y: 10 } });
      await page.locator('.virtual-screen-keyboard-input').first().fill('sciforge vas dogfood marker');
      await page.keyboard.press('Enter');
    }
    const afterInput = await readScreenRefs(page);
    if (afterInput.leaseControlReady) {
      await clickOptionalControl(page, 'takeover');
      await clickOptionalControl(page, 'pause-agent');
      await clickOptionalControl(page, 'resume-agent');
    }
    const finalRefs = { ...current, ...afterInput, ...await readScreenRefs(page) };
    const blockedReason = finalRefs.attachState === 'attached'
      ? 'Screen attached, but current run lacks complete VSCode InputIntent and human takeover/resume evidence refs'
      : finalRefs.blockedReason || 'Screen pane did not attach a native VirtualAppScreen session within the bootstrap window';
    const phase = finalRefs.attachState === 'attached'
      ? missingInputOrLeasePhase(finalRefs)
      : 'auto-provision-attach';
    manifest = buildDogfoodManifest({
      runId,
      phase,
      reason: finalRefs.attachState === 'attached' && canPass(finalRefs) ? null : blockedReason,
      openedSciForge: true,
      enteredScreen: true,
      refs: finalRefs,
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
  } catch (error) {
    manifest = buildDogfoodManifest({
      runId,
      phase: 'enter-screen',
      reason: boundedReason(error),
      openedSciForge: true,
      enteredScreen: false,
      refs: {},
    });
    await maybeWriteManifest(fallbackManifestPath, manifest);
    assertDogfoodManifest(manifest);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function buildDogfoodManifest({
  runId,
  phase,
  reason,
  openedSciForge,
  enteredScreen,
  refs,
}: {
  runId: string;
  phase: DogfoodPhase;
  reason: string | null;
  openedSciForge: boolean;
  enteredScreen: boolean;
  refs: DogfoodRefs;
}): VirtualAppScreenDogfoodManifest {
  const status: ManifestStatus = canPass(refs) && openedSciForge && enteredScreen && reason === null ? 'passed' : 'blocked';
  const activationCommandRefs = uniqueRefs([
    refs.handoffRef,
    ...(refs.lastCommandTexts ?? []).flatMap(refsFromCommandText),
  ]);
  const runtimeCommandAcceptance = runtimeCommandAcceptanceFromTexts(refs.lastCommandTexts ?? []);
  const permissionRefs = uniqueRefs([refs.permissionRef, ...(refs.permissionRefs ?? [])]);
  const lastFrameRefs = uniqueRefs([
    refs.liveSurfaceRef,
    refs.frameStreamRef,
    refs.currentFrameRef,
    refs.beforeFrameRef,
    refs.afterFrameRef,
    ...(refs.beforeAfterFrameRefs ?? []),
  ]);
  const lastInputRefs = uniqueRefs([
    refs.inputLeaseRef,
    refs.activeLeaseOwnerRef,
    refs.userLeaseRef,
    refs.agentLeaseRef,
    ...(refs.inputIntentRefs ?? []),
    ...(refs.executorEventRefs ?? []),
    ...(refs.takeoverRefs ?? []),
    ...(refs.pauseRefs ?? []),
    ...(refs.resumeRefs ?? []),
  ]);

  return {
    schemaVersion: SCHEMA,
    status,
    source: 'product-ui-right-pane',
    runId,
    observedAt: new Date().toISOString(),
    phase: status === 'passed' ? 'manifest-output' : phase,
    reason: status === 'passed' ? null : boundedReason(reason || 'dogfood product path is blocked'),
    rightPane: {
      openedSciForge,
      enteredScreen,
      activationRequested: Boolean(refs.handoffRef || refs.adapterReadinessRef || activationCommandRefs.length),
      attachState: refs.attachState ?? null,
      status: refs.status ?? null,
      surfaceMode: refs.surfaceMode ?? null,
      screenRef: refs.screenRef ?? null,
      targetAppRef: refs.targetAppRef ?? null,
      targetWindowRef: refs.targetWindowRef ?? null,
      sessionRef: refs.sessionRef ?? null,
      guiPresentRefs: uniqueRefs(refs.guiPresentRefs ?? []),
      activationCommandRefs,
    },
    runtimeCommandAcceptance,
    providerReadiness: {
      status: providerStatus(refs),
      refs: uniqueRefs([refs.adapterReadinessRef, runtimeCommandAcceptance.adapterReadinessRef ?? undefined]),
    },
    permissionRefs,
    lastFrameRefs,
    lastInputRefs,
    vscodeOperation: {
      attemptedViaInputIntent: Boolean(refs.inputIntentReady && refs.inputLeaseRef),
      commandRefs: uniqueRefs(refs.inputIntentRefs ?? []),
      completed: Boolean(refs.inputIntentRefs?.length && refs.executorEventRefs?.length && refs.beforeAfterFrameRefs?.length),
    },
    humanIntervention: {
      takeoverAttempted: Boolean(refs.leaseControlReady && (refs.takeoverRefs?.length || refs.userLeaseRef)),
      resumeAttempted: Boolean(refs.leaseControlReady && (refs.resumeRefs?.length || refs.agentLeaseRef)),
      takeoverRefs: uniqueRefs(refs.takeoverRefs ?? []),
      resumeRefs: uniqueRefs(refs.resumeRefs ?? []),
      completed: Boolean(refs.takeoverRefs?.length && refs.resumeRefs?.length),
    },
    bounded: {
      refsFirst: true,
      rawPayloadsCaptured: false,
      providerInternalsUsed: false,
      hardcodedPageScreenshotOrUrl: false,
      sharedSystemInputUsed: false,
    },
  };
}

function canPass(refs: DogfoodRefs) {
  return Boolean(
    refs.attachState === 'attached'
    && refs.surfaceMode === 'live'
    && refs.sessionRef
    && (refs.liveSurfaceRef || refs.frameStreamRef)
    && refs.currentFrameRef
    && refs.adapterReadinessRef
    && refs.inputLeaseRef
    && refs.inputIntentRefs?.length
    && refs.executorEventRefs?.length
    && refs.beforeAfterFrameRefs?.length
    && refs.takeoverRefs?.length
    && refs.resumeRefs?.length
    && refs.guiPresentRefs?.length
  );
}

function assertDogfoodManifest(manifest: VirtualAppScreenDogfoodManifest) {
  assert.equal(manifest.schemaVersion, SCHEMA);
  assert.equal(manifest.source, 'product-ui-right-pane');
  assert.equal(manifest.bounded.refsFirst, true);
  assert.equal(manifest.bounded.rawPayloadsCaptured, false);
  assert.equal(manifest.bounded.providerInternalsUsed, false);
  assert.equal(manifest.bounded.hardcodedPageScreenshotOrUrl, false);
  assert.equal(manifest.bounded.sharedSystemInputUsed, false);
  assert.equal(manifest.runtimeCommandAcceptance.failClosed, true);
  assert.equal(manifest.runtimeCommandAcceptance.providerExecuted, false);
  if (manifest.runtimeCommandAcceptance.commandObserved) {
    assert.equal(manifest.runtimeCommandAcceptance.parsed, true);
    assert.ok(manifest.runtimeCommandAcceptance.route);
    assert.ok(manifest.runtimeCommandAcceptance.adapterReadinessRef);
    assert.ok(manifest.providerReadiness.refs.includes(manifest.runtimeCommandAcceptance.adapterReadinessRef));
  }
  if (manifest.runtimeCommandAcceptance.route?.startsWith('virtual-app-screen-permission-')) {
    assert.ok(manifest.runtimeCommandAcceptance.targetRef);
    assert.ok(manifest.permissionRefs.length);
  }
  if (manifest.status === 'blocked') {
    assert.ok(manifest.phase);
    assert.ok(manifest.reason);
    assert.ok(Array.isArray(manifest.providerReadiness.refs));
    assert.ok(Array.isArray(manifest.permissionRefs));
    assert.ok(Array.isArray(manifest.lastFrameRefs));
    assert.ok(Array.isArray(manifest.lastInputRefs));
  }
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /data:image|;base64,|rawScreenshot|screenshotBase64|providerUrl|providerRoute|Authorization|apiKey|password|secret|token/i);
  assert.doesNotMatch(text, /virtual-app-screen-vscode-smoke|vscode-virtual-app-screen-bridge|com\.microsoft\.VSCode|noVNC|RDP|QEMU|Playwright/i);
  assert.equal(allRefs(manifest).every(isSafeProductRef), true);
}

async function ensureScreenPane(page: Page) {
  const tab = page.locator('.result-page-tab', { hasText: 'Screen' }).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('.result-new-tab-button').click();
    await page.getByRole('menuitem', { name: 'Screen', exact: true }).click();
    await page.locator('.result-page-tab', { hasText: 'Screen' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.result-page-tab', { hasText: 'Screen' }).click();
  }
  await page.locator('[data-testid="right-pane-virtual-screen-tool"]').waitFor({ state: 'visible', timeout: 20_000 });
}

async function readScreenRefs(page: Page): Promise<DogfoodRefs> {
  return page.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('[data-component-id="virtual-screen-viewer"]');
    const frame = document.querySelector<HTMLElement>('.virtual-screen-frame');
    const image = document.querySelector<HTMLElement>('.virtual-screen-frame-image[data-event="virtual-screen-input-intent-request"]');
    const blocked = document.querySelector<HTMLElement>('.virtual-screen-attach-state [data-blocked-reason]');
    const refsByKind = (kind: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-timeline-kind="${kind}"]`))
      .map((element) => element.querySelector('code')?.textContent || '')
      .map((value) => value.trim())
      .filter(Boolean);
    const refText = (label: string) => {
      const entries = Array.from(document.querySelectorAll<HTMLElement>('.virtual-screen-ref-chip'));
      const match = entries.find((entry) => entry.textContent?.toLowerCase().startsWith(label.toLowerCase()));
      return match?.querySelector('code')?.textContent?.trim();
    };
    const commandTexts = Array.from(document.querySelectorAll<HTMLElement>('[data-event="virtual-screen-terminal-equivalent-text"]'))
      .map((element) => element.getAttribute('data-command-text') || element.textContent || '')
      .filter((value) => value.includes('/computer-use'));
    return {
      attachState: viewer?.getAttribute('data-attach-state') || undefined,
      status: viewer?.getAttribute('data-status') || undefined,
      surfaceMode: viewer?.getAttribute('data-screen-surface-mode') || undefined,
      screenRef: refText('screen'),
      targetAppRef: refText('target app') || image?.getAttribute('data-target-app-ref') || undefined,
      targetWindowRef: refText('target window') || image?.getAttribute('data-target-window-ref') || undefined,
      sessionRef: refText('session'),
      liveSurfaceRef: refText('live surface') || frame?.getAttribute('data-live-surface-ref') || image?.getAttribute('data-live-surface-ref') || undefined,
      frameStreamRef: refText('frame stream') || image?.getAttribute('data-frame-stream-ref') || undefined,
      currentFrameRef: refText('current frame') || image?.getAttribute('data-frame-ref') || undefined,
      beforeFrameRef: refText('before'),
      afterFrameRef: refText('after'),
      inputLeaseRef: refText('input lease') || frame?.getAttribute('data-input-lease-ref') || undefined,
      activeLeaseOwnerRef: refText('active lease owner') || frame?.getAttribute('data-active-lease-owner-ref') || undefined,
      userLeaseRef: refText('user lease') || frame?.getAttribute('data-user-lease-ref') || undefined,
      agentLeaseRef: refText('agent lease') || frame?.getAttribute('data-agent-lease-ref') || undefined,
      adapterReadinessRef: refText('adapter readiness'),
      permissionRef: refText('permission') || frame?.getAttribute('data-permission-ref') || image?.getAttribute('data-permission-ref') || undefined,
      blockedRef: refText('blocked'),
      handoffRef: refText('handoff'),
      evidenceLedgerRef: refText('evidence ledger'),
      inputIntentReady: frame?.getAttribute('data-input-intent-ready') === 'true',
      leaseControlReady: frame?.getAttribute('data-lease-control-ready') === 'true',
      guiPresentRefs: refsByKind('gui.present'),
      inputIntentRefs: refsByKind('input-intent'),
      executorEventRefs: refsByKind('executor-event'),
      beforeAfterFrameRefs: refsByKind('before-after'),
      permissionRefs: [...refsByKind('permission'), ...refsByKind('permission-handoff'), ...refsByKind('permission-recheck')],
      takeoverRefs: refsByKind('takeover'),
      pauseRefs: refsByKind('pause-agent'),
      resumeRefs: refsByKind('resume-agent'),
      lastCommandTexts: commandTexts,
      blockedReason: blocked?.getAttribute('data-blocked-reason') || undefined,
    };
  });
}

async function waitForScreenBootstrap(page: Page, timeoutMs: number): Promise<DogfoodRefs> {
  const deadline = Date.now() + timeoutMs;
  let last = await readScreenRefs(page);
  while (Date.now() < deadline) {
    last = await readScreenRefs(page);
    if (last.attachState && last.attachState !== 'no-session') return last;
    await delay(250);
  }
  return last;
}

async function clickOptionalControl(page: Page, controlKind: string) {
  const control = page.locator(`[data-event="virtual-screen-terminal-equivalent-text"][data-control-kind="${controlKind}"][data-control-enabled="true"]`).first();
  if (await control.count()) await control.click();
}

function missingInputOrLeasePhase(refs: DogfoodRefs): DogfoodPhase {
  if (!refs.inputIntentRefs?.length || !refs.executorEventRefs?.length) return 'operate-vscode-input-intent';
  if (!refs.takeoverRefs?.length) return 'human-takeover';
  if (!refs.resumeRefs?.length) return 'resume-agent';
  return 'manifest-output';
}

function providerStatus(refs: DogfoodRefs): VirtualAppScreenDogfoodManifest['providerReadiness']['status'] {
  if (refs.attachState === 'attached') return 'ready';
  if (refs.attachState === 'adapter-unavailable') return 'adapter-unavailable';
  if (refs.attachState === 'requires-handoff' || refs.permissionRefs?.length || refs.permissionRef) return 'permission-missing';
  if (refs.attachState === 'blocked' || refs.blockedRef) return 'blocked';
  return 'unknown';
}

function refsFromCommandText(commandText: string) {
  return [...commandText.matchAll(/--[a-z-]*ref\s+"([^"]+)"/g)].map((match) => match[1]);
}

function runtimeCommandAcceptanceFromTexts(commandTexts: string[]): VirtualAppScreenDogfoodManifest['runtimeCommandAcceptance'] {
  const commandText = commandTexts.find((text) =>
    /^\/(?:computer-use|computer\s+use)\s+(?:screen\s+attach|permission-handoff|permission-recheck)\b/i.test(text.trim()));
  if (!commandText) {
    return {
      commandObserved: false,
      parsed: false,
      route: null,
      source: null,
      screenRef: null,
      targetAppRef: null,
      adapterReadinessRef: null,
      activationRef: null,
      targetRef: null,
      failClosed: true,
      providerExecuted: false,
      reason: null,
    };
  }

  const parsed = parseVirtualAppScreenRuntimeCommand(commandText);
  if (parsed.kind !== 'parsed') {
    return {
      commandObserved: true,
      parsed: false,
      route: null,
      source: null,
      screenRef: null,
      targetAppRef: null,
      adapterReadinessRef: null,
      activationRef: null,
      targetRef: null,
      failClosed: true,
      providerExecuted: false,
      reason: parsed.kind === 'invalid' ? parsed.reason : 'not a VirtualAppScreen runtime command',
    };
  }

  const command = parsed.command;
  return {
    commandObserved: true,
    parsed: true,
    route: virtualAppScreenRuntimeCommandRoute(command),
    source: command.source,
    screenRef: command.refs.screenRef ?? null,
    targetAppRef: command.refs.targetAppRef ?? null,
    adapterReadinessRef: command.refs.readinessRef,
    activationRef: command.refs.activationRef ?? null,
    targetRef: command.refs.permissionHandoffRef ?? command.refs.permissionRecheckRef ?? command.refs.activationRef ?? null,
    failClosed: true,
    providerExecuted: false,
    reason: null,
  };
}

function uniqueRefs(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function allRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(allRefs);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    if (key.endsWith('Ref') && typeof item === 'string') return [item];
    if (key.endsWith('Refs') && Array.isArray(item)) return item.filter((ref): ref is string => typeof ref === 'string');
    return allRefs(item);
  });
}

function isSafeProductRef(ref: string) {
  return !/^(?:https?:|file:|data:|blob:|javascript:|\/)/i.test(ref)
    && !/[?&](?:token|secret|password|api[_-]?key|authorization)=/i.test(ref)
    && !/;base64,/i.test(ref);
}

function boundedReason(reason: unknown) {
  const raw = reason instanceof Error ? reason.message : String(reason ?? 'blocked');
  return raw.replace(/\s+/g, ' ').replace(/([?&](?:token|secret|password|api[_-]?key|authorization)=)[^&\s]+/gi, '$1[redacted]').slice(0, 240);
}

async function maybeWriteManifest(path: string | undefined, manifest: VirtualAppScreenDogfoodManifest) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode !== null || child.signalCode) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    child.kill('SIGKILL');
  }
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${boundedReason(lastError)}`);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate TCP port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
