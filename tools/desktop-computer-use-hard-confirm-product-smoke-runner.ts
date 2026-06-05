import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type Page } from 'playwright-core';

export const DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA =
  'sciforge.desktop.computer-use-hard-confirm-product-smoke.v1' as const;

export const DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED = [
  'electron-product-shell',
  'electron-dynamic-workspace-writer',
  'electron-native-host',
  'runtime-codex-transport',
  'computer-use-guard-or-preflight-surface',
  'computer-use-hard-confirm-surface',
] as const;

const trustedRealProductEvidence = new WeakSet<object>();

export type DesktopComputerUseHardConfirmProductRequirement =
  (typeof DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED)[number];

export type DesktopComputerUseHardConfirmProductSmokeManifest = {
  schemaVersion: typeof DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA;
  status: 'passed' | 'blocked';
  passClaim: boolean;
  claimScope: 'electron-product-computer-use-hard-confirm' | 'blocked-or-diagnostic';
  runner: 'desktop-computer-use-hard-confirm-product-smoke-runner';
  observedAt: string;
  source: 'blocked-diagnostic-no-real-product-run' | 'electron-product-runtime-codex-transport-run';
  shell: 'electron-product';
  workspaceWriter: 'electron-dynamic' | 'missing';
  nativeHost: 'sciforgeDesktop' | 'missing';
  runtimeTransport: 'runtime-codex-sse' | 'missing';
  externalSideEffects: 'not-executed';
  productRequirements: {
    required: DesktopComputerUseHardConfirmProductRequirement[];
    observed: DesktopComputerUseHardConfirmProductRequirement[];
  };
  surfaceEvidence: DesktopComputerUseHardConfirmProductSurfaceEvidence;
  realProductRun: {
    status: 'executed' | 'not-run';
    runRef: string;
    auditRefs: string[];
    blockedReason?: string;
  };
  payloadPolicy: {
    rawDom: false;
    rawScreenshot: false;
    base64: false;
    providerPayload: false;
    actCompletion: false;
  };
  forbiddenSubstitutes: {
    viteWebDev: false;
    browserOnlyContract: false;
    focusedRuntimeContractOnly: false;
    forgedComputerUseActCompletion: false;
  };
  blockers: DesktopComputerUseHardConfirmProductBlockReason[];
};

export type DesktopComputerUseHardConfirmProductSurfaceEvidence = {
  guardOrPreflight: DesktopComputerUseHardConfirmSurfaceProbe;
  hardConfirm: DesktopComputerUseHardConfirmSurfaceProbe;
};

export type DesktopComputerUseHardConfirmSurfaceProbe = {
  status: 'surfaced' | 'not-observed';
  surface: 'chat-or-runtime-codex-stream' | 'missing';
  textRef: string;
  controls: string[];
};

export type DesktopComputerUseHardConfirmProductRunEvidence = {
  status: 'executed';
  runRef: string;
  auditRefs: string[];
  observedRequirements: DesktopComputerUseHardConfirmProductRequirement[];
  surfaceEvidence: DesktopComputerUseHardConfirmProductSurfaceEvidence;
};

export type DesktopComputerUseHardConfirmProductSmokeValidation = {
  schemaVersion: typeof DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA;
  verdict: 'passed' | 'blocked';
  canClaimPass: boolean;
  blockReasons: DesktopComputerUseHardConfirmProductBlockReason[];
};

export type DesktopComputerUseHardConfirmProductBlockReason =
  | 'schema-version-mismatch'
  | 'electron-product-smoke-opt-in-required'
  | 'trusted-in-process-electron-runner-required'
  | 'strict-product-executor-blocked'
  | 'real-electron-product-run-required'
  | 'manifest-status-pass-claim-required'
  | 'blocked-manifest-must-not-claim-pass'
  | 'electron-product-shell-required'
  | 'electron-dynamic-workspace-writer-required'
  | 'electron-native-host-required'
  | 'runtime-codex-transport-required'
  | 'computer-use-guard-or-preflight-surface-required'
  | 'computer-use-hard-confirm-surface-required'
  | 'all-product-requirements-must-be-observed'
  | 'confirm-cancel-controls-required'
  | 'diagnostic-blocked-controls-required'
  | 'external-side-effects-must-not-run'
  | 'computer-use-act-completion-must-not-be-claimed'
  | 'payload-policy-must-forbid-raw-evidence'
  | 'vite-web-or-focused-contract-substitute-forbidden'
  | 'raw-dom-screenshot-base64-provider-payload-forbidden';

export type RunDesktopComputerUseHardConfirmProductSmokeInput = {
  outputPath?: string;
  now?: string;
  executeRealProduct?: boolean;
  realProductExecutor?: () => Promise<DesktopComputerUseHardConfirmProductRunEvidence | undefined>;
  realProductEvidence?: DesktopComputerUseHardConfirmProductRunEvidence;
};

type DesktopBridgeApi = {
  getRuntimeConfig(): Promise<unknown>;
  getRuntimeHealth(): Promise<unknown>;
  requestShutdown(): Promise<unknown>;
};

type DesktopRuntimeConfig = {
  schemaVersion: 'sciforge.desktop.runtime-config.v1';
  runtimeCodexBaseUrl: string;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
};

type BrowserHostSessionTruth = {
  sessionId: string;
  sessionRef: string;
  targetRefs: string[];
  observationRefs: string[];
};

export async function runDesktopComputerUseHardConfirmProductSmoke(
  input: RunDesktopComputerUseHardConfirmProductSmokeInput = {},
): Promise<DesktopComputerUseHardConfirmProductSmokeManifest> {
  const executeRealProduct = input.executeRealProduct === true;
  let realProductRunBlockedReason: string | undefined;
  const executorEvidence = executeRealProduct
    ? await (async () => {
        try {
          if (input.realProductExecutor) return await input.realProductExecutor();
          if (input.realProductEvidence) return undefined;
          return await runElectronProductHardConfirmSurfaceProbe();
        } catch (error) {
          realProductRunBlockedReason = boundedExecutorBlockedReason(error);
          blockedExecutorEvidence(realProductRunBlockedReason);
          return undefined;
        }
      })()
    : undefined;
  const trustedEvidence = executorEvidence
    ? trustInProcessRealProductEvidence(executorEvidence)
    : trustedEvidenceOrUndefined(input.realProductEvidence);
  const manifest = buildDesktopComputerUseHardConfirmProductSmokeManifest({
    now: input.now ?? new Date().toISOString(),
    executeRealProduct,
    realProductEvidence: executeRealProduct ? trustedEvidence : undefined,
    untrustedRealProductEvidenceSupplied: input.realProductEvidence !== undefined && !trustedEvidence,
    realProductRunBlockedReason,
  });

  if (input.outputPath) {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    assertBoundedArtifact(text);
    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, text);
  }

  return manifest;
}

export function buildDesktopComputerUseHardConfirmProductSmokeManifest(input: {
  now: string;
  executeRealProduct?: boolean;
  realProductEvidence?: DesktopComputerUseHardConfirmProductRunEvidence;
  untrustedRealProductEvidenceSupplied?: boolean;
  realProductRunBlockedReason?: string;
}): DesktopComputerUseHardConfirmProductSmokeManifest {
  const evidence = trustedEvidenceOrUndefined(input.realProductEvidence);
  const observed = uniqueRequirements(evidence?.observedRequirements ?? []);
  const manifest: DesktopComputerUseHardConfirmProductSmokeManifest = {
    schemaVersion: DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA,
    status: 'blocked',
    passClaim: false,
    claimScope: 'blocked-or-diagnostic',
    runner: 'desktop-computer-use-hard-confirm-product-smoke-runner',
    observedAt: input.now,
    source: evidence ? 'electron-product-runtime-codex-transport-run' : 'blocked-diagnostic-no-real-product-run',
    shell: observed.includes('electron-product-shell') ? 'electron-product' : 'electron-product',
    workspaceWriter: observed.includes('electron-dynamic-workspace-writer') ? 'electron-dynamic' : 'missing',
    nativeHost: observed.includes('electron-native-host') ? 'sciforgeDesktop' : 'missing',
    runtimeTransport: observed.includes('runtime-codex-transport') ? 'runtime-codex-sse' : 'missing',
    externalSideEffects: 'not-executed',
    productRequirements: {
      required: [...DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED],
      observed,
    },
    surfaceEvidence: evidence?.surfaceEvidence ?? missingSurfaceEvidence(),
    realProductRun: {
      status: evidence ? 'executed' : 'not-run',
      runRef: evidence?.runRef ?? '',
      auditRefs: evidence?.auditRefs ?? [],
      ...(input.realProductRunBlockedReason ? { blockedReason: input.realProductRunBlockedReason } : {}),
    },
    payloadPolicy: {
      rawDom: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      actCompletion: false,
    },
    forbiddenSubstitutes: {
      viteWebDev: false,
      browserOnlyContract: false,
      focusedRuntimeContractOnly: false,
      forgedComputerUseActCompletion: false,
    },
    blockers: [],
  };

  manifest.blockers = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest, {
    executeRealProduct: input.executeRealProduct === true,
    untrustedRealProductEvidenceSupplied: input.untrustedRealProductEvidenceSupplied === true,
  }).blockReasons;
  if (manifest.blockers.length === 0) {
    manifest.status = 'passed';
    manifest.passClaim = true;
    manifest.claimScope = 'electron-product-computer-use-hard-confirm';
  }
  return manifest;
}

export function validateDesktopComputerUseHardConfirmProductSmokeManifest(
  manifest: DesktopComputerUseHardConfirmProductSmokeManifest,
  options: {
    executeRealProduct?: boolean;
    untrustedRealProductEvidenceSupplied?: boolean;
  } = {},
): DesktopComputerUseHardConfirmProductSmokeValidation {
  const blockReasons: DesktopComputerUseHardConfirmProductBlockReason[] = [];
  if (manifest.schemaVersion !== DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA) {
    blockReasons.push('schema-version-mismatch');
  }
  if (manifest.realProductRun.status !== 'executed' && options.executeRealProduct !== true) {
    blockReasons.push('electron-product-smoke-opt-in-required');
  }
  if (options.untrustedRealProductEvidenceSupplied) {
    blockReasons.push('trusted-in-process-electron-runner-required');
  }
  if (manifest.blockers?.includes('trusted-in-process-electron-runner-required')) {
    blockReasons.push('trusted-in-process-electron-runner-required');
  }
  if (manifest.realProductRun.blockedReason) {
    blockReasons.push('strict-product-executor-blocked');
  }
  if (manifest.realProductRun.status !== 'executed' || !manifest.realProductRun.runRef || manifest.realProductRun.auditRefs.length === 0) {
    blockReasons.push('real-electron-product-run-required');
  }
  if (manifest.status === 'passed' && (!manifest.passClaim || manifest.claimScope !== 'electron-product-computer-use-hard-confirm')) {
    blockReasons.push('manifest-status-pass-claim-required');
  }
  if (manifest.status === 'blocked' && (manifest.passClaim || manifest.claimScope !== 'blocked-or-diagnostic')) {
    blockReasons.push('blocked-manifest-must-not-claim-pass');
  }
  if (manifest.shell !== 'electron-product') blockReasons.push('electron-product-shell-required');
  if (manifest.workspaceWriter !== 'electron-dynamic') blockReasons.push('electron-dynamic-workspace-writer-required');
  if (manifest.nativeHost !== 'sciforgeDesktop') blockReasons.push('electron-native-host-required');
  if (manifest.runtimeTransport !== 'runtime-codex-sse') blockReasons.push('runtime-codex-transport-required');
  if (manifest.surfaceEvidence.guardOrPreflight.status !== 'surfaced') {
    blockReasons.push('computer-use-guard-or-preflight-surface-required');
  }
  if (manifest.surfaceEvidence.hardConfirm.status !== 'surfaced') {
    blockReasons.push('computer-use-hard-confirm-surface-required');
  }
  if (!allRequirementsObserved(manifest.productRequirements.observed)) {
    blockReasons.push('all-product-requirements-must-be-observed');
  }
  if (!manifest.surfaceEvidence.hardConfirm.controls.includes('Confirm') || !manifest.surfaceEvidence.hardConfirm.controls.includes('Cancel')) {
    blockReasons.push('confirm-cancel-controls-required');
  }
  if (!manifest.surfaceEvidence.guardOrPreflight.controls.includes('blocked-diagnostic')) {
    blockReasons.push('diagnostic-blocked-controls-required');
  }
  if (manifest.externalSideEffects !== 'not-executed') blockReasons.push('external-side-effects-must-not-run');
  if (manifest.payloadPolicy.actCompletion !== false) blockReasons.push('computer-use-act-completion-must-not-be-claimed');
  if (
    manifest.payloadPolicy.rawDom !== false ||
    manifest.payloadPolicy.rawScreenshot !== false ||
    manifest.payloadPolicy.base64 !== false ||
    manifest.payloadPolicy.providerPayload !== false
  ) {
    blockReasons.push('payload-policy-must-forbid-raw-evidence');
  }
  if (
    manifest.forbiddenSubstitutes.viteWebDev !== false ||
    manifest.forbiddenSubstitutes.browserOnlyContract !== false ||
    manifest.forbiddenSubstitutes.focusedRuntimeContractOnly !== false ||
    manifest.forbiddenSubstitutes.forgedComputerUseActCompletion !== false
  ) {
    blockReasons.push('vite-web-or-focused-contract-substitute-forbidden');
  }
  if (containsForbiddenRawPayload(manifest)) {
    blockReasons.push('raw-dom-screenshot-base64-provider-payload-forbidden');
  }

  const unique = [...new Set(blockReasons)];
  return {
    schemaVersion: DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA,
    verdict: unique.length === 0 ? 'passed' : 'blocked',
    canClaimPass: unique.length === 0,
    blockReasons: unique,
  };
}

async function runElectronProductHardConfirmSurfaceProbe(): Promise<DesktopComputerUseHardConfirmProductRunEvidence> {
  const projectRoot = process.cwd();
  const mainPath = resolve(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js');
  const rendererPath = resolve(projectRoot, 'dist-ui', 'index.html');
  if (!existsSync(mainPath) || !existsSync(rendererPath)) {
    throw new Error('Electron product Computer Use smoke requires built desktop artifacts. Run `npm run desktop:build` first.');
  }

  const scratchRoot = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-hard-confirm-product-'));
  const dummyProvider = await startDummyProvider();
  const fixture = await startHardConfirmFixture();
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    electronApp = await electron.launch({
      args: [mainPath],
      env: {
        ...process.env,
        SCIFORGE_DESKTOP_APP_ROOT: projectRoot,
        SCIFORGE_DESKTOP_USER_DATA_DIR: join(scratchRoot, 'userData'),
        SCIFORGE_DESKTOP_WORKSPACE_PATH: join(scratchRoot, 'workspace'),
        SCIFORGE_CONFIG_PATH: join(scratchRoot, 'missing-config.local.json'),
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: dummyProvider.url,
        SCIFORGE_PROXY_API_KEY_ENV: 'SCIFORGE_DESKTOP_CU_HARD_CONFIRM_DUMMY_KEY',
        SCIFORGE_DESKTOP_CU_HARD_CONFIRM_DUMMY_KEY: 'sciforge-desktop-cu-hard-confirm-dummy-key',
        SCIFORGE_PROXY_DEFAULT_MODEL: 'sciforge-desktop-cu-hard-confirm-dummy-model',
        SCIFORGE_PROXY_QUIET: '1',
      },
      timeout: 45_000,
    });
    const page = await electronApp.firstWindow({ timeout: 45_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    const pageUrl = page.url();
    assert.equal(pageUrl, pathToFileURL(rendererPath).href);
    await page.waitForFunction(() => typeof (globalThis as typeof globalThis & {
      sciforgeDesktop?: DesktopBridgeApi;
    }).sciforgeDesktop?.getRuntimeConfig === 'function', undefined, { timeout: 10_000 });

    const config = await readDesktopRuntimeConfig(page);
    await waitForWorkspaceWriter(config.workspaceWriterBaseUrl, config.workspacePath);
    await waitForRuntimeCodex(config.runtimeCodexBaseUrl);
    await openBrowserPaneAt(page, fixture.url);
    const browserSession = await waitForNativeBrowserHostSession(page, config);
    const guardText = await postRuntimeCodex(config.runtimeCodexBaseUrl, blockedGuardRequest(config.workspacePath));
    assert.match(guardText, /event: agent_host_turn_loop/);
    assert.match(guardText, /Computer Use Guard blocked/i);
    const hardConfirmText = await postRuntimeCodex(config.runtimeCodexBaseUrl, hardConfirmRequest(config.workspacePath, browserSession));
    assertHardConfirmSurface(hardConfirmText);

    await page.evaluate(() =>
      (globalThis as typeof globalThis & { sciforgeDesktop: DesktopBridgeApi }).sciforgeDesktop.requestShutdown(),
    ).catch(() => undefined);
    await electronApp.close();
    electronApp = undefined;

    return {
      status: 'executed',
      runRef: `desktop-cu-hard-confirm-product-run:${Date.now().toString(36)}`,
      auditRefs: [
        'electron-product-shell:dist-ui-index',
        'electron-dynamic-workspace-writer:runtime-config-health',
        'electron-native-host:sciforgeDesktop',
        'runtime-codex-transport:sse-agent-host-turn-loop',
        'computer-use-guard:blocked-preflight-surface',
        'computer-use-hard-confirm:confirm-cancel-surface',
      ],
      observedRequirements: [...DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED],
      surfaceEvidence: {
        guardOrPreflight: {
          status: 'surfaced',
          surface: 'chat-or-runtime-codex-stream',
          textRef: 'runtime-codex-transport:guard-blocked-text',
          controls: ['blocked-diagnostic', 'recovery-action'],
        },
        hardConfirm: {
          status: 'surfaced',
          surface: 'chat-or-runtime-codex-stream',
          textRef: 'runtime-codex-transport:hard-confirm-text',
          controls: ['Confirm', 'Cancel'],
        },
      },
    };
  } finally {
    if (electronApp) await electronApp.close().catch(() => undefined);
    await dummyProvider.close();
    await fixture.close();
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

function blockedExecutorEvidence(reason: string): undefined {
  process.stderr.write(`[blocked] Electron product Computer Use smoke did not pass: ${reason}\n`);
  return undefined;
}

function boundedExecutorBlockedReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeDiagnosticText(message);
}

async function readDesktopRuntimeConfig(page: Page): Promise<DesktopRuntimeConfig> {
  const config = await page.evaluate(() =>
    (globalThis as typeof globalThis & { sciforgeDesktop: DesktopBridgeApi }).sciforgeDesktop.getRuntimeConfig(),
  ) as Partial<DesktopRuntimeConfig>;
  if (config.schemaVersion !== 'sciforge.desktop.runtime-config.v1') throw new Error('desktop runtime config schema mismatch');
  if (!config.runtimeCodexBaseUrl) throw new Error('desktop runtime config missing runtimeCodexBaseUrl');
  if (!config.workspaceWriterBaseUrl) throw new Error('desktop runtime config missing workspaceWriterBaseUrl');
  if (!config.workspacePath) throw new Error('desktop runtime config missing workspacePath');
  return config as DesktopRuntimeConfig;
}

async function waitForWorkspaceWriter(baseUrl: string, workspacePath: string): Promise<void> {
  let last = '';
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/health`);
      const health = await response.json() as {
        ok?: unknown;
        service?: unknown;
        capabilities?: unknown;
      };
      const capabilities = Array.isArray(health.capabilities) ? health.capabilities : [];
      if (
        response.ok &&
        health.ok === true &&
        health.service === 'sciforge-workspace-writer' &&
        capabilities.includes('runtime-module-dispatcher') &&
        capabilities.includes('browser-host-session') &&
        workspacePath.trim().length > 0
      ) {
        return;
      }
      last = `${response.status} ${JSON.stringify(health).slice(0, 600)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`Electron dynamic Workspace Writer did not become healthy: ${sanitizeDiagnosticText(last)}`);
}

async function waitForRuntimeCodex(baseUrl: string): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      last = `${response.status} ${await response.text()}`;
      if (response.ok) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Runtime Codex sidecar did not become healthy: ${sanitizeDiagnosticText(last)}`);
}

async function openBrowserPaneAt(page: Page, url: string): Promise<void> {
  await page.getByRole('tab', { name: /^(Browser|浏览器)$/ }).click({ timeout: 15_000 });
  await page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 15_000 });
  const address = page.getByLabel('Browser URL');
  await address.fill(url);
  await address.press('Enter');
}

async function waitForNativeBrowserHostSession(
  page: Page,
  config: DesktopRuntimeConfig,
): Promise<BrowserHostSessionTruth> {
  const nativeFrame = page.locator('[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"]');
  await nativeFrame.waitFor({ state: 'visible', timeout: 30_000 });
  const liveSurfaceRef = await nativeFrame.getAttribute('data-browser-live-surface-ref');
  const sessionId = sessionIdFromLiveSurfaceRef(liveSurfaceRef);
  const deadline = Date.now() + 20_000;
  let lastState = '';
  while (Date.now() < deadline) {
    const state = await readBrowserHostSessionState(config.workspaceWriterBaseUrl, config.workspacePath, sessionId);
    lastState = JSON.stringify({
      status: state.status,
      liveSurfaceTransport: state.liveSurfaceTransport,
      liveSurfaceRef: state.liveSurfaceRef,
      frameRef: state.frameRef,
      screenshotRef: state.screenshotRef,
      updatedAt: state.updatedAt,
    }).slice(0, 700);
    const observationRefs = [
      stringField(state.frameRef),
      stringField(state.screenshotRef),
      stringField(state.domSnapshotRef),
      stringField(state.axSnapshotRef),
    ].filter((ref): ref is string => Boolean(ref));
    if (
      state.status === 'ready' &&
      state.providerId === 'sciforge.browser-host-session' &&
      state.liveSurfaceTransport === 'native-embedded' &&
      state.singleInteractiveTruth === true &&
      state.secondTruthSource === false &&
      observationRefs.length > 0
    ) {
      const sessionRef = `browser-host-session:${sessionId}`;
      return {
        sessionId,
        sessionRef,
        targetRefs: [sessionRef, stringField(state.liveSurfaceRef)].filter((ref): ref is string => Boolean(ref)),
        observationRefs,
      };
    }
    await sleep(250);
  }
  throw new Error(`BrowserHostSession did not become runtime-verifiable for hard-confirm smoke: ${sanitizeDiagnosticText(lastState)}`);
}

async function readBrowserHostSessionState(
  baseUrl: string,
  workspacePath: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetch(url.href);
  const json = await response.json() as unknown;
  if (!response.ok || !isRecord(json) || !isRecord(json.session)) {
    throw new Error(`BrowserHostSession state unavailable: ${sanitizeDiagnosticText(JSON.stringify(json).slice(0, 700))}`);
  }
  return json.session;
}

function sessionIdFromLiveSurfaceRef(value: string | null): string {
  const match = /^browser-host-session:([a-zA-Z0-9._:-]{1,160})\/live-surface$/.exec(value ?? '');
  if (!match?.[1]) throw new Error(`Missing BrowserHostSession live surface ref: ${sanitizeDiagnosticText(String(value))}`);
  return match[1];
}

async function postRuntimeCodex(baseUrl: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${baseUrl}/api/sciforge/runtime/codex/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, 200, sanitizeDiagnosticText(text));
  return text;
}

function blockedGuardRequest(workspacePath: string): Record<string, unknown> {
  return {
    commandText: 'Click the visible export button in the current window.',
    workspacePath,
    commandId: 'desktop-cu-product-guard-blocked',
    attemptId: 'desktop-cu-product-guard-blocked-attempt-1',
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'desktop-product-smoke',
      intentText: 'Click the visible export button in the current window.',
      authorizationProfileId: 'high-autonomy',
      policyOwner: 'codex-agent-host-runtime',
      readiness: {
        browserHostSession: 'missing',
        nativeBridge: 'missing',
        nativeSurface: 'missing',
        windowActionSession: 'missing',
        computerUseAdapter: 'missing',
      },
      target: { bound: false, summary: 'Unbound current window target', refs: [] },
      observation: { fresh: false, refs: [] },
      permissions: { refs: [], stopCancelPath: false },
    },
  };
}

function hardConfirmRequest(workspacePath: string, browserSession: BrowserHostSessionTruth): Record<string, unknown> {
  return {
    commandText: 'Submit the registration form in the current browser window.',
    workspacePath,
    commandId: 'desktop-cu-product-hard-confirm',
    attemptId: 'desktop-cu-product-hard-confirm-attempt-1',
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'desktop-product-smoke',
      intentText: 'Submit the registration form in the current browser window.',
      authorizationProfileId: 'high-autonomy',
      policyOwner: 'codex-agent-host-runtime',
      readiness: {
        browserHostSession: 'ready',
        nativeBridge: 'ready',
        nativeSurface: 'ready',
        windowActionSession: 'ready',
        computerUseAdapter: 'ready',
      },
      refs: [browserSession.sessionRef],
      target: { bound: true, summary: 'Registration form', refs: browserSession.targetRefs },
      observation: { fresh: true, refs: browserSession.observationRefs },
      permissions: { refs: [], stopCancelPath: false },
    },
  };
}

function assertHardConfirmSurface(text: string): void {
  assert.match(text, /event: agent_host_turn_loop/);
  assert.match(text, /requires hard confirmation/i);
  assert.match(text, /needs-confirmation/);
  assert.ok(
    hasConfirmCancelControls(text),
    `Hard-confirm surface did not expose Confirm/Cancel controls: ${sanitizeDiagnosticText(text)}`,
  );
}

function hasConfirmCancelControls(text: string): boolean {
  const candidates = [
    text,
    text.replace(/\\"/g, '"'),
  ];
  return candidates.some((candidate) =>
    /"controls"\s*:\s*\[\s*"Confirm"\s*,\s*"Cancel"\s*\]/.test(candidate),
  );
}

function trustInProcessRealProductEvidence(
  evidence: DesktopComputerUseHardConfirmProductRunEvidence,
): DesktopComputerUseHardConfirmProductRunEvidence {
  trustedRealProductEvidence.add(evidence);
  return evidence;
}

function trustedEvidenceOrUndefined(
  evidence?: DesktopComputerUseHardConfirmProductRunEvidence,
): DesktopComputerUseHardConfirmProductRunEvidence | undefined {
  return evidence && trustedRealProductEvidence.has(evidence) ? evidence : undefined;
}

function missingSurfaceEvidence(): DesktopComputerUseHardConfirmProductSurfaceEvidence {
  return {
    guardOrPreflight: {
      status: 'not-observed',
      surface: 'missing',
      textRef: '',
      controls: [],
    },
    hardConfirm: {
      status: 'not-observed',
      surface: 'missing',
      textRef: '',
      controls: [],
    },
  };
}

function uniqueRequirements(input: DesktopComputerUseHardConfirmProductRequirement[]): DesktopComputerUseHardConfirmProductRequirement[] {
  return DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED.filter((required) => input.includes(required));
}

function allRequirementsObserved(input: DesktopComputerUseHardConfirmProductRequirement[]): boolean {
  return DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_REQUIRED.every((required) => input.includes(required));
}

function containsForbiddenRawPayload(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /<html|outerHTML|innerHTML|data:image|;base64,|"rawScreenshot"\s*:\s*(?!false\b)|"rawDom"\s*:\s*(?!false\b)|"providerPayload"\s*:\s*(?!false\b)|"actCompletion"\s*:\s*true/i.test(text);
}

function assertBoundedArtifact(text: string): void {
  if (text.length > 24_000) throw new Error('Desktop Computer Use product smoke artifact is too large.');
  if (/<html|outerHTML|innerHTML|data:image|;base64,|sk-[a-z0-9_-]+/i.test(text)) {
    throw new Error('Desktop Computer Use product smoke artifact includes forbidden raw payload.');
  }
}

function sanitizeDiagnosticText(text: string): string {
  return text.replace(/sk-[a-z0-9_-]+/gi, 'sk-REDACTED').slice(0, 1_000);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function startDummyProvider(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'dummy_provider_unavailable',
        message: `No real provider is available for desktop Computer Use product smoke: ${req.method ?? 'GET'} ${req.url ?? '/'}`,
      },
    }));
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolvePort(address.port);
    });
  });
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => closeServer(server),
  };
}

async function startHardConfirmFixture(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
  <head><title>SciForge Hard Confirm Fixture</title></head>
  <body>
    <main>
      <h1>Registration form</h1>
      <form>
        <label>Name <input name="name" value="Research User" /></label>
        <button type="submit">Submit registration</button>
      </form>
    </main>
  </body>
</html>`);
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolvePort(address.port);
    });
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

if (process.argv[1]?.endsWith('desktop-computer-use-hard-confirm-product-smoke-runner.ts')) {
  const outputPath = process.env.SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_OUTPUT
    ? resolve(process.cwd(), process.env.SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_OUTPUT)
    : resolve(process.cwd(), 'docs', 'test-artifacts', 'desktop-computer-use-hard-confirm-product', 'manifest.json');
  const executeRealProduct = process.env.SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_EXECUTE_REAL === '1';
  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    outputPath,
    executeRealProduct,
  });
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest, { executeRealProduct });
  process.stdout.write(`[${manifest.status}] Desktop Computer Use hard-confirm product smoke wrote ${outputPath}; canClaimPass=${validation.canClaimPass}; blockers=${validation.blockReasons.join(',') || 'none'}\n`);
  if (executeRealProduct && !validation.canClaimPass) process.exitCode = 1;
}
