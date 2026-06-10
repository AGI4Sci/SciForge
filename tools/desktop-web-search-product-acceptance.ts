import { existsSync, type Dirent } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type Page, type WebSocket as PlaywrightWebSocket } from 'playwright-core';

import {
  WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES,
  materializeWebSearchProductAcceptanceFromEvents,
  validateWebSearchProductAcceptanceManifest,
} from '../tests/smoke/helpers/web-search-product-acceptance-fixtures.js';

const DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.desktop-web-search.product-acceptance.v1';
const DEFAULT_OUT_DIR = 'docs/test-artifacts/desktop-web-search-product-acceptance';
const CODEX_RUNTIME_WEBSOCKET_PATH = '/api/sciforge/runtime/codex/realtime/ws';
const DEFAULT_COMMAND_TEXT = [
  '普通聊天入口 desktop product proof：请用 web_search 搜索 OpenAI API models 文档，',
  '用中文简要说明结果，并在最终回答中包含当前搜索结果里的 HTTP(S) 来源链接。',
  '除非任务明确要求读取页面正文，不要强制使用 web_read。',
].join('');

type TaskClass = typeof WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES[number];
type ProductProofRoute = 'native' | 'fallback';

type DesktopProductSidecar = {
  schemaVersion: typeof DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION;
  status: 'passed' | 'blocked';
  observedAt: string;
  source: 'electron-desktop-ui';
  productProof: boolean;
  releaseEligible: boolean;
  manifestPath: string;
  blockedReason?: string;
  desktop: {
    launchedElectron: boolean;
    builtMainPath: string;
    builtRendererPath: string;
    startedFreshChat: boolean;
    pageUrl?: string;
    runtimeConfigLoaded: boolean;
    workspaceWriterBaseUrl?: string;
    runtimeCodexBaseUrl?: string;
    workspacePath?: string;
  };
  uiWebSocket: {
    observed: boolean;
    url?: string;
    expectedUrl?: string;
    commandId?: string;
    attemptId?: string;
    eventLogPath?: string;
    terminalEvent?: string;
    terminalMessage?: string;
    allSocketUrls?: string[];
    unmatchedSocketUrls?: string[];
    errors?: string[];
    sentFrameCount: number;
    receivedFrameCount: number;
    currentRunFrameCount: number;
    terminalDoneObserved: boolean;
  };
  visibleSourceLink: {
    observed: boolean;
    links: string[];
  };
  diagnostics?: DesktopProductDiagnostics;
  blockers: string[];
};

type DesktopProductDiagnostics = {
  runtimeConfig?: {
    workspaceWriterBaseUrl?: string;
    runtimeCodexBaseUrl?: string;
    workspacePath?: string;
    expectedWebSocketUrl?: string;
    webSocketType?: string;
  };
  phaseLog: Array<{
    phase: string;
    status: 'started' | 'completed' | 'blocked';
    at: string;
    detail?: string;
  }>;
  submitAttempts: Array<{
    attempt: number;
    startedAt: string;
    completedAt?: string;
    stageTimeoutMs: number;
    freshChatStarted: boolean;
    sendClicked: boolean;
    sendEnabledBeforeClick?: boolean;
    textareaValueLengthAfterFill?: number;
    composerClearedAfterClick?: boolean;
    userMessageObservedAfterClick?: boolean;
    uiErrorTextAfterClick?: string;
    wsObservedWithinStage?: boolean;
    snapshotBeforeSubmitPath?: string;
    snapshotAfterSubmitPath?: string;
  }>;
  consoleMessages: Array<{ type: string; text: string; at: string }>;
  pageErrors: Array<{ message: string; at: string }>;
  failedRequests: Array<{ url: string; failureText?: string; at: string }>;
  httpErrors: Array<{ url: string; status: number; at: string }>;
  snapshots: Array<{
    label: string;
    path: string;
    screenshotPath?: string;
    at: string;
  }>;
  launcherAuditPaths: string[];
};

type CliArgs = {
  outDir: string;
  workspacePath: string;
  taskClass: TaskClass;
  commandText: string;
  route?: ProductProofRoute;
  timeoutMs: number;
  json: boolean;
};

type DesktopRuntimeConfig = {
  schemaVersion: 'sciforge.desktop.runtime-config.v1';
  workspaceWriterBaseUrl: string;
  runtimeCodexBaseUrl: string;
  workspacePath: string;
};

type UiWebSocketCapture = {
  observed: boolean;
  url?: string;
  expectedUrl?: string;
  commandId?: string;
  attemptId?: string;
  terminalEvent?: string;
  terminalMessage?: string;
  allSocketUrls: string[];
  unmatchedSocketUrls: string[];
  errors: string[];
  sentFrameCount: number;
  receivedFrameCount: number;
  currentRunFrameCount: number;
  terminalDoneObserved: boolean;
  events: unknown[];
};

type SubmitPromptResult = {
  sendClicked: boolean;
  sendEnabledBeforeClick: boolean;
  textareaValueLengthAfterFill: number;
  composerClearedAfterClick: boolean;
};

export async function runDesktopWebSearchProductAcceptanceCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return 0;
  }

  let args: CliArgs;
  try {
    args = parseArgs(argv, env);
  } catch (error) {
    process.stderr.write(`${messageFromError(error)}\n\n${helpText()}`);
    return 2;
  }

  const summary = await runDesktopWebSearchProductAcceptance(args, env);
  if (args.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    process.stdout.write([
      `desktop web_search product acceptance status: ${summary.status}`,
      `productProof: ${summary.productProof}`,
      `releaseEligible: ${summary.releaseEligible}`,
      `manifest: ${summary.manifestPath}`,
      ...(summary.blockedReason ? [`blockedReason: ${summary.blockedReason}`] : []),
      ...(summary.blockers.length ? ['blockers:', ...summary.blockers.map((blocker) => `- ${blocker}`)] : []),
      '',
    ].join('\n'));
  }
  return summary.productProof && summary.releaseEligible ? 0 : 2;
}

export async function runDesktopWebSearchProductAcceptance(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): Promise<DesktopProductSidecar> {
  const acceptanceEnv = envWithWebSearchRoute(env, args.route);
  await prepareDesktopArtifactDir(args.outDir);
  await mkdir(args.outDir, { recursive: true });
  const observedAt = new Date().toISOString();
  const diagnostics = createDesktopDiagnostics();
  const projectRoot = process.cwd();
  const mainPath = resolve(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js');
  const rendererPath = resolve(projectRoot, 'dist-ui', 'index.html');
  const manifestPath = resolve(args.outDir, 'manifest.json');
  const sidecarPath = resolve(args.outDir, 'desktop-sidecar.json');
  const baseSidecar = (
    blockers: string[],
    extra: Partial<Omit<DesktopProductSidecar, 'desktop' | 'uiWebSocket' | 'visibleSourceLink'>>
      & {
        desktop?: Partial<DesktopProductSidecar['desktop']>;
        uiWebSocket?: Partial<DesktopProductSidecar['uiWebSocket']>;
        visibleSourceLink?: Partial<DesktopProductSidecar['visibleSourceLink']>;
      } = {},
  ): DesktopProductSidecar => ({
    ...extra,
    schemaVersion: DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    observedAt,
    source: 'electron-desktop-ui',
    productProof: false,
    releaseEligible: false,
    manifestPath,
    blockedReason: blockers.join('\n') || undefined,
    desktop: {
      launchedElectron: false,
      builtMainPath: mainPath,
      builtRendererPath: rendererPath,
      startedFreshChat: false,
      runtimeConfigLoaded: false,
      ...extra.desktop,
    },
    uiWebSocket: {
      observed: false,
      expectedUrl: diagnostics.runtimeConfig?.expectedWebSocketUrl,
      sentFrameCount: 0,
      receivedFrameCount: 0,
      currentRunFrameCount: 0,
      terminalDoneObserved: false,
      ...extra.uiWebSocket,
    },
    visibleSourceLink: {
      observed: false,
      links: [],
      ...extra.visibleSourceLink,
    },
    diagnostics,
    blockers,
  });

  if (!existsSync(mainPath) || !existsSync(rendererPath)) {
    const reason = 'Electron desktop product proof requires built desktop artifacts. Run `npm run desktop:build` first.';
    const manifest = await materializeBlockedManifest({
      args,
      observedAt,
      commandId: 'desktop-web-search-product-blocked',
      reason,
    });
    const sidecar = baseSidecar([reason], { manifestPath: resolve(args.outDir, 'manifest.json') });
    await writeJson(sidecarPath, sidecar);
    await writeBlockedReadme(args.outDir, sidecar.blockedReason ?? reason);
    return { ...sidecar, manifestPath: resolve(args.outDir, 'manifest.json'), blockedReason: manifest.blockedReason ?? sidecar.blockedReason };
  }

  const scratchRoot = await mkdtemp(join(tmpdir(), 'sciforge-desktop-web-search-product-'));
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let capture: UiWebSocketCapture | undefined;
  const desktopEvidence: Partial<DesktopProductSidecar['desktop']> = {
    launchedElectron: false,
    builtMainPath: mainPath,
    builtRendererPath: rendererPath,
    startedFreshChat: false,
    runtimeConfigLoaded: false,
  };
  try {
    recordPhase(diagnostics, 'launch-electron', 'started');
    electronApp = await electron.launch({
      args: [mainPath],
      env: {
        ...acceptanceEnv,
        SCIFORGE_DESKTOP_APP_ROOT: projectRoot,
        SCIFORGE_DESKTOP_USER_DATA_DIR: join(scratchRoot, 'userData'),
        SCIFORGE_DESKTOP_WORKSPACE_PATH: args.workspacePath,
      },
      timeout: 45_000,
    });
    recordPhase(diagnostics, 'launch-electron', 'completed');
    desktopEvidence.launchedElectron = true;
    recordPhase(diagnostics, 'first-window', 'started');
    const page = await electronApp.firstWindow({ timeout: 45_000 });
    recordPhase(diagnostics, 'first-window', 'completed');
    attachPageDiagnostics(page, diagnostics);
    capture = captureRuntimeWebSocketFrames(page);
    desktopEvidence.pageUrl = page.url();
    if (page.url() !== pathToFileURL(rendererPath).href) {
      throw new Error(`Electron loaded unexpected renderer URL ${page.url()}`);
    }
    recordPhase(diagnostics, 'read-runtime-config', 'started');
    const config = await readDesktopRuntimeConfig(page);
    recordPhase(diagnostics, 'read-runtime-config', 'completed');
    const expectedWebSocketUrl = codexRuntimeWebSocketUrl(config.workspaceWriterBaseUrl);
    diagnostics.runtimeConfig = {
      workspaceWriterBaseUrl: config.workspaceWriterBaseUrl,
      runtimeCodexBaseUrl: config.runtimeCodexBaseUrl,
      workspacePath: config.workspacePath,
      expectedWebSocketUrl,
      webSocketType: await page.evaluate(() => typeof window.WebSocket).catch(() => undefined),
    };
    capture.expectedUrl = expectedWebSocketUrl;
    desktopEvidence.runtimeConfigLoaded = true;
    desktopEvidence.workspaceWriterBaseUrl = config.workspaceWriterBaseUrl;
    desktopEvidence.runtimeCodexBaseUrl = config.runtimeCodexBaseUrl;
    desktopEvidence.workspacePath = config.workspacePath;
    recordPhase(diagnostics, 'wait-workspace-writer', 'started');
    await waitForWorkspaceWriter(config.workspaceWriterBaseUrl);
    recordPhase(diagnostics, 'wait-workspace-writer', 'completed');
    recordPhase(diagnostics, 'wait-runtime-codex', 'started');
    await waitForRuntimeCodex(config.runtimeCodexBaseUrl);
    recordPhase(diagnostics, 'wait-runtime-codex', 'completed');
    const deadline = Date.now() + args.timeoutMs;
    await submitWithWebSocketRetry(page, capture, diagnostics, args, config);
    desktopEvidence.startedFreshChat = true;
    await waitForUiWebSocketDone(capture, Math.max(1_000, deadline - Date.now()));

    const commandId = capture.commandId;
    if (!commandId) throw new Error('Electron UI did not send a Runtime Codex realtime request with commandId.');
    const manifest = await materializeWebSearchProductAcceptanceFromEvents({
      workspacePath: config.workspacePath,
      artifactDir: args.outDir,
      taskClass: args.taskClass,
      commandText: args.commandText,
      commandId,
      attemptId: capture.attemptId,
      providerId: 'desktop-ui-runtime-codex',
      observedAt,
      events: capture.events,
      now: () => new Date(observedAt),
    });
    const validation = await validateWebSearchProductAcceptanceManifest(manifest, {
      artifactRoot: args.outDir,
      now: new Date(observedAt),
      requireProductProof: true,
    });
    const visibleLinks = await visibleSourceLinks(page, manifest.finalAnswer.sourceLinks);
    const blockers = [
      ...validation.blockers,
      ...(capture.observed ? [] : ['Electron UI Runtime Codex WebSocket was not observed.']),
      ...(capture.terminalDoneObserved ? [] : ['Electron UI Runtime Codex WebSocket did not reach a terminal done frame.']),
      ...(capture.terminalEvent && capture.terminalEvent !== 'done'
        ? [`Electron UI Runtime Codex WebSocket ended with terminal event ${capture.terminalEvent}${capture.terminalMessage ? `: ${capture.terminalMessage}` : ''}.`]
        : []),
      ...(visibleLinks.length ? [] : ['Final answer source link was not visible in the desktop chat UI.']),
    ];
    const eventLogPath = 'ui-websocket-events.json';
    await persistUiWebSocketEvents(args.outDir, observedAt, capture, eventLogPath);
    const passed = validation.productProof && blockers.length === 0;
    if (!passed) await downgradeManifestToBlocked(args.outDir, blockers.join('\n') || 'desktop UI product proof blocked');
    const sidecar: DesktopProductSidecar = {
      schemaVersion: DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_SCHEMA_VERSION,
      status: passed ? 'passed' : 'blocked',
      observedAt,
      source: 'electron-desktop-ui',
      productProof: passed,
      releaseEligible: passed,
      manifestPath,
      blockedReason: passed ? undefined : blockers.join('\n'),
      desktop: {
        launchedElectron: true,
        builtMainPath: mainPath,
        builtRendererPath: rendererPath,
        startedFreshChat: true,
        pageUrl: page.url(),
        runtimeConfigLoaded: true,
        workspaceWriterBaseUrl: config.workspaceWriterBaseUrl,
        runtimeCodexBaseUrl: config.runtimeCodexBaseUrl,
        workspacePath: config.workspacePath,
      },
      uiWebSocket: {
        observed: capture.observed,
        url: capture.url,
        expectedUrl: capture.expectedUrl,
        commandId: capture.commandId,
        attemptId: capture.attemptId,
        eventLogPath,
        terminalEvent: capture.terminalEvent,
        terminalMessage: capture.terminalMessage,
        allSocketUrls: capture.allSocketUrls,
        unmatchedSocketUrls: capture.unmatchedSocketUrls,
        errors: capture.errors,
        sentFrameCount: capture.sentFrameCount,
        receivedFrameCount: capture.receivedFrameCount,
        currentRunFrameCount: capture.currentRunFrameCount,
        terminalDoneObserved: capture.terminalDoneObserved,
      },
      visibleSourceLink: {
        observed: visibleLinks.length > 0,
        links: visibleLinks,
      },
      diagnostics,
      blockers,
    };
    await copyLauncherAuditLogs(scratchRoot, args.outDir, diagnostics).catch(() => undefined);
    await writeJson(sidecarPath, sidecar);
    return sidecar;
  } catch (error) {
    const reason = `desktop Electron ordinary-chat product proof is blocked: ${messageFromError(error)}`;
    recordPhase(diagnostics, 'desktop-product-proof', 'blocked', reason);
    await materializeBlockedManifest({
      args,
      observedAt,
      commandId: 'desktop-web-search-product-blocked',
      reason,
    });
    if (capture) await persistUiWebSocketEvents(args.outDir, observedAt, capture).catch(() => undefined);
    await copyLauncherAuditLogs(scratchRoot, args.outDir, diagnostics).catch(() => undefined);
    const sidecar = baseSidecar([reason], {
      desktop: {
        ...desktopEvidence,
        launchedElectron: Boolean(electronApp) || desktopEvidence.launchedElectron === true,
      },
      uiWebSocket: capture ? {
        observed: capture.observed,
        url: capture.url,
        expectedUrl: capture.expectedUrl,
        commandId: capture.commandId,
        attemptId: capture.attemptId,
        eventLogPath: 'ui-websocket-events.json',
        terminalEvent: capture.terminalEvent,
        terminalMessage: capture.terminalMessage,
        allSocketUrls: capture.allSocketUrls,
        unmatchedSocketUrls: capture.unmatchedSocketUrls,
        errors: capture.errors,
        sentFrameCount: capture.sentFrameCount,
        receivedFrameCount: capture.receivedFrameCount,
        currentRunFrameCount: capture.currentRunFrameCount,
        terminalDoneObserved: capture.terminalDoneObserved,
      } : undefined,
    });
    await writeJson(sidecarPath, sidecar);
    await writeBlockedReadme(args.outDir, reason);
    return sidecar;
  } finally {
    if (electronApp) await electronApp.close().catch(() => undefined);
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

const DESKTOP_GENERATED_ARTIFACT_NAMES = [
  'blocked-desktop-web-search-product-acceptance.md',
  'desktop-diagnostics',
  'desktop-sidecar.json',
  'final-answer.md',
  'launcher-audits',
  'manifest.json',
  'search',
  'source-pages',
  'ui-websocket-events.json',
] as const;

async function prepareDesktopArtifactDir(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all(DESKTOP_GENERATED_ARTIFACT_NAMES.map((name) =>
    rm(join(outDir, name), { recursive: true, force: true })));
}

function captureRuntimeWebSocketFrames(page: Page): UiWebSocketCapture {
  const capture: UiWebSocketCapture = {
    observed: false,
    allSocketUrls: [],
    unmatchedSocketUrls: [],
    errors: [],
    sentFrameCount: 0,
    receivedFrameCount: 0,
    currentRunFrameCount: 0,
    terminalDoneObserved: false,
    events: [],
  };
  page.on('websocket', (socket: PlaywrightWebSocket) => {
    const socketUrl = socket.url();
    capture.allSocketUrls.push(diagnosticUrl(socketUrl));
    if (!socketUrl.includes('/api/sciforge/runtime/codex/realtime/ws')) {
      capture.unmatchedSocketUrls.push(diagnosticUrl(socketUrl));
      trimDiagnosticArray(capture.unmatchedSocketUrls, 40);
      return;
    }
    capture.observed = true;
    capture.url = socketUrl;
    socket.on('framesent', (frame) => {
      capture.sentFrameCount += 1;
      const payload = parseJson(frame.payload);
      if (!isRecord(payload)) return;
      capture.commandId = stringField(payload.commandId) ?? capture.commandId;
      capture.attemptId = stringField(payload.attemptId) ?? capture.attemptId;
    });
    socket.on('framereceived', (frame) => {
      capture.receivedFrameCount += 1;
      const payload = parseJson(frame.payload);
      if (!isRecord(payload)) return;
      if (payload.type === 'event') {
        const eventName = stringField(payload.event);
        capture.currentRunFrameCount += 1;
        capture.events.push(payload.data);
        if (eventName && isRuntimeTerminalEvent(eventName)) {
          capture.terminalDoneObserved = true;
          capture.terminalEvent = eventName;
          capture.terminalMessage = terminalMessageFromPayload(payload.data);
        }
      } else if (payload.type === 'error') {
        capture.terminalDoneObserved = true;
        capture.terminalEvent = 'error';
        capture.terminalMessage = stringField(payload.error) ?? JSON.stringify(payload).slice(0, 1_000);
        capture.errors.push(capture.terminalMessage);
        trimDiagnosticArray(capture.errors, 20);
      }
    });
  });
  return capture;
}

function isRuntimeTerminalEvent(value: string): boolean {
  return /^(?:done|failed|error|cancelled|canceled)$/i.test(value);
}

function terminalMessageFromPayload(value: unknown): string | undefined {
  if (isRecord(value)) return stringField(value.message) ?? stringField(value.text) ?? stringField(value.status);
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1_000) : undefined;
}

function createDesktopDiagnostics(): DesktopProductDiagnostics {
  return {
    phaseLog: [],
    submitAttempts: [],
    consoleMessages: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    snapshots: [],
    launcherAuditPaths: [],
  };
}

function recordPhase(
  diagnostics: DesktopProductDiagnostics,
  phase: string,
  status: 'started' | 'completed' | 'blocked',
  detail?: string,
): void {
  diagnostics.phaseLog.push({
    phase,
    status,
    at: new Date().toISOString(),
    ...(detail ? { detail: detail.slice(0, 1_000) } : {}),
  });
}

function attachPageDiagnostics(page: Page, diagnostics: DesktopProductDiagnostics): void {
  page.on('console', (message) => {
    diagnostics.consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1_000),
      at: new Date().toISOString(),
    });
    trimDiagnosticArray(diagnostics.consoleMessages, 80);
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push({
      message: messageFromError(error).slice(0, 1_000),
      at: new Date().toISOString(),
    });
    trimDiagnosticArray(diagnostics.pageErrors, 40);
  });
  page.on('requestfailed', (request) => {
    diagnostics.failedRequests.push({
      url: diagnosticUrl(request.url()),
      failureText: request.failure()?.errorText?.slice(0, 500),
      at: new Date().toISOString(),
    });
    trimDiagnosticArray(diagnostics.failedRequests, 80);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (!/\/api\/sciforge\/|\/health\b|runtime\/codex|workspace/i.test(url)) return;
    diagnostics.httpErrors.push({
      url: diagnosticUrl(url),
      status,
      at: new Date().toISOString(),
    });
    trimDiagnosticArray(diagnostics.httpErrors, 80);
  });
}

function trimDiagnosticArray<T>(items: T[], maxLength: number): void {
  if (items.length > maxLength) items.splice(0, items.length - maxLength);
}

function diagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch {
    return value.split(/[?#]/, 1)[0]?.slice(0, 500) ?? '';
  }
}

async function submitWithWebSocketRetry(
  page: Page,
  capture: UiWebSocketCapture,
  diagnostics: DesktopProductDiagnostics,
  args: CliArgs,
  config: DesktopRuntimeConfig,
): Promise<void> {
  const attempts = 2;
  const stageTimeoutMs = Math.min(20_000, Math.max(5_000, Math.floor(args.timeoutMs / 8)));
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    const attempt: DesktopProductDiagnostics['submitAttempts'][number] = {
      attempt: attemptNumber,
      startedAt: new Date().toISOString(),
      stageTimeoutMs,
      freshChatStarted: false,
      sendClicked: false,
    };
    diagnostics.submitAttempts.push(attempt);
    recordPhase(diagnostics, `submit-attempt-${attemptNumber}-fresh-chat`, 'started');
    await startFreshOrdinaryChat(page);
    attempt.freshChatStarted = true;
    recordPhase(diagnostics, `submit-attempt-${attemptNumber}-fresh-chat`, 'completed');
    attempt.snapshotBeforeSubmitPath = await captureUiSnapshot(page, diagnostics, args.outDir, `submit-${attemptNumber}-before`, {
      promptNeedle: args.commandText,
      expectedWebSocketUrl: capture.expectedUrl,
      runtimeConfig: config,
    });
    recordPhase(diagnostics, `submit-attempt-${attemptNumber}-prompt`, 'started');
    const submit = await submitOrdinaryChatPrompt(page, args.commandText);
    attempt.sendClicked = submit.sendClicked;
    attempt.sendEnabledBeforeClick = submit.sendEnabledBeforeClick;
    attempt.textareaValueLengthAfterFill = submit.textareaValueLengthAfterFill;
    attempt.composerClearedAfterClick = submit.composerClearedAfterClick;
    attempt.userMessageObservedAfterClick = await waitForUserMessageObserved(page, args.commandText, 3_000);
    attempt.uiErrorTextAfterClick = await currentUiErrorText(page);
    recordPhase(diagnostics, `submit-attempt-${attemptNumber}-prompt`, 'completed');
    const observed = await waitForUiWebSocketObserved(capture, stageTimeoutMs);
    attempt.wsObservedWithinStage = observed;
    attempt.completedAt = new Date().toISOString();
    if (observed) return;
    attempt.snapshotAfterSubmitPath = await captureUiSnapshot(page, diagnostics, args.outDir, `submit-${attemptNumber}-no-ws`, {
      promptNeedle: args.commandText,
      expectedWebSocketUrl: capture.expectedUrl,
      runtimeConfig: config,
    });
    recordPhase(
      diagnostics,
      `submit-attempt-${attemptNumber}-websocket`,
      'blocked',
      `Runtime Codex WebSocket was not observed within ${stageTimeoutMs}ms after submit.`,
    );
    if (attemptNumber < attempts) await page.waitForTimeout(1_000);
  }
  throw new Error(`desktop UI Runtime Codex WebSocket was not observed within ${stageTimeoutMs}ms after ${attempts} submit attempt(s)`);
}

async function captureUiSnapshot(
  page: Page,
  diagnostics: DesktopProductDiagnostics,
  outDir: string,
  label: string,
  context: {
    promptNeedle?: string;
    expectedWebSocketUrl?: string;
    runtimeConfig?: DesktopRuntimeConfig;
  } = {},
): Promise<string | undefined> {
  const diagnosticsDir = join(outDir, 'desktop-diagnostics');
  await mkdir(diagnosticsDir, { recursive: true });
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
  const timestamp = Date.now();
  const path = `desktop-diagnostics/${safeLabel}-${timestamp}.json`;
  const screenshotPath = `desktop-diagnostics/${safeLabel}-${timestamp}.png`;
  const snapshot = await page.evaluate((input) => {
    const textarea = document.querySelector('[data-testid="chat-composer-textarea"]') as HTMLTextAreaElement | null;
    const collapsed = document.querySelector('[data-testid="chat-composer-collapsed-button"]');
    const sendButton = document.querySelector('[data-testid="chat-composer-send-button"]') as HTMLButtonElement | null;
    const normalizedPrompt = (input.promptNeedle ?? '').replace(/\s+/g, ' ').trim();
    const messages = Array.from(document.querySelectorAll('[data-testid="chat-message"]'))
      .map((element) => ({
        text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        className: element instanceof HTMLElement ? element.className : '',
      }))
      .filter((message) => message.text);
    const messageLikeTexts = [
      ...messages.map((message) => message.text),
      ...Array.from(document.querySelectorAll('.messages-stack, .messages'))
        .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    ]
      .filter(Boolean);
    const userMessages = messages.filter((message) => /\buser\b/.test(message.className));
    const errorTexts = Array.from(document.querySelectorAll('[role="alert"], [data-testid*="error"], .chat-error, .error-message'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);
    const activeElement = document.activeElement;
    return {
      url: location.href,
      readyState: document.readyState,
      webSocketType: typeof window.WebSocket,
      expectedWebSocketUrl: input.expectedWebSocketUrl,
      runtimeConfig: input.runtimeConfig ? {
        workspaceWriterBaseUrl: input.runtimeConfig.workspaceWriterBaseUrl,
        runtimeCodexBaseUrl: input.runtimeConfig.runtimeCodexBaseUrl,
        workspacePath: input.runtimeConfig.workspacePath,
      } : undefined,
      composerTextareaPresent: Boolean(textarea),
      composerTextareaVisible: Boolean(textarea && textarea.offsetParent !== null),
      composerCollapsedPresent: Boolean(collapsed),
      composerCollapsedVisible: Boolean(collapsed && (collapsed as HTMLElement).offsetParent !== null),
      sendButtonPresent: Boolean(sendButton),
      sendButtonVisible: Boolean(sendButton && sendButton.offsetParent !== null),
      sendButtonDisabled: sendButton?.disabled,
      textareaValueLength: textarea?.value.length ?? 0,
      activeElementTestId: activeElement instanceof HTMLElement ? activeElement.dataset.testid : undefined,
      messageLikeNodeCount: messageLikeTexts.length,
      chatMessageCount: messages.length,
      userMessageCount: userMessages.length,
      userMessageContainingPromptObserved: Boolean(normalizedPrompt && userMessages.some((message) => message.text.includes(normalizedPrompt.slice(0, 240)))),
      runningAssistantObserved: Boolean(document.querySelector('[data-is-sending="true"]')) || /Running|运行中/.test(messageLikeTexts.join(' ')),
      uiErrorText: errorTexts.join('\n').slice(0, 1_000),
      lastMessagePreview: messageLikeTexts.at(-1)?.slice(0, 500),
    };
  }, context);
  await writeJson(join(outDir, path), snapshot);
  try {
    await page.screenshot({ path: join(outDir, screenshotPath), fullPage: true });
  } catch {
    // Screenshot capture is best-effort diagnostic evidence; JSON snapshot remains authoritative.
  }
  diagnostics.snapshots.push({
    label,
    path,
    screenshotPath,
    at: new Date().toISOString(),
  });
  return path;
}

async function persistUiWebSocketEvents(
  outDir: string,
  observedAt: string,
  capture: UiWebSocketCapture,
  eventLogPath = 'ui-websocket-events.json',
): Promise<void> {
  await writeJson(join(outDir, eventLogPath), {
    schemaVersion: 'sciforge.desktop-web-search.ui-websocket-events.v1',
    observedAt,
    commandId: capture.commandId,
    attemptId: capture.attemptId,
    eventCount: capture.events.length,
    expectedUrl: capture.expectedUrl,
    observedUrl: capture.url,
    allSocketUrls: capture.allSocketUrls,
    unmatchedSocketUrls: capture.unmatchedSocketUrls,
    terminalEvent: capture.terminalEvent,
    terminalMessage: capture.terminalMessage,
    terminalDoneObserved: capture.terminalDoneObserved,
    errors: capture.errors,
    events: capture.events,
  });
}

async function materializeBlockedManifest(input: {
  args: CliArgs;
  observedAt: string;
  commandId: string;
  reason: string;
}) {
  const manifest = await materializeWebSearchProductAcceptanceFromEvents({
    workspacePath: input.args.workspacePath,
    artifactDir: input.args.outDir,
    taskClass: input.args.taskClass,
    commandText: input.args.commandText,
    commandId: input.commandId,
    observedAt: input.observedAt,
    events: [],
    now: () => new Date(input.observedAt),
  });
  return downgradeManifestToBlocked(input.args.outDir, input.reason, manifest);
}

async function downgradeManifestToBlocked(
  outDir: string,
  reason: string,
  existing?: Awaited<ReturnType<typeof materializeWebSearchProductAcceptanceFromEvents>>,
) {
  const manifestPath = join(outDir, 'manifest.json');
  const manifest = existing ?? JSON.parse(await readFile(manifestPath, 'utf8'));
  const blocked = {
    ...manifest,
    status: 'blocked',
    proofLevel: 'diagnostic-scaffold',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    provider: {
      ...manifest.provider,
      kind: 'acceptance-scaffold',
      live: false,
    },
    blockedReason: reason,
    userRecoveryPath: 'Build desktop artifacts, configure live LLM/search provider env, then rerun npm run desktop-web-search-product-acceptance.',
    runner: {
      ...manifest.runner,
      externalRunStatus: 'blocked',
    },
  };
  await writeJson(manifestPath, blocked);
  return blocked;
}

async function readDesktopRuntimeConfig(page: Page): Promise<DesktopRuntimeConfig> {
  await page.waitForFunction(() => typeof (globalThis as typeof globalThis & {
    sciforgeDesktop?: { getRuntimeConfig?: () => Promise<unknown> };
  }).sciforgeDesktop?.getRuntimeConfig === 'function', undefined, { timeout: 15_000 });
  const config = await page.evaluate(() =>
    (globalThis as typeof globalThis & { sciforgeDesktop: { getRuntimeConfig(): Promise<unknown> } }).sciforgeDesktop.getRuntimeConfig(),
  ) as Partial<DesktopRuntimeConfig>;
  if (config.schemaVersion !== 'sciforge.desktop.runtime-config.v1') throw new Error('desktop runtime config schema mismatch');
  if (!config.workspaceWriterBaseUrl) throw new Error('desktop runtime config missing workspaceWriterBaseUrl');
  if (!config.runtimeCodexBaseUrl) throw new Error('desktop runtime config missing runtimeCodexBaseUrl');
  if (!config.workspacePath) throw new Error('desktop runtime config missing workspacePath');
  return config as DesktopRuntimeConfig;
}

async function submitOrdinaryChatPrompt(page: Page, prompt: string): Promise<SubmitPromptResult> {
  const textarea = page.getByTestId('chat-composer-textarea');
  await page.waitForFunction(() => Boolean(
    document.querySelector('[data-testid="chat-composer-textarea"]')
      || document.querySelector('[data-testid="chat-composer-collapsed-button"]'),
  ), undefined, { timeout: 60_000 });
  if (!await textarea.isVisible().catch(() => false)) {
    const collapsed = page.getByTestId('chat-composer-collapsed-button');
    await collapsed.waitFor({ state: 'visible', timeout: 60_000 });
    await collapsed.click({ force: true });
    await page.waitForTimeout(250);
  }
  await textarea.waitFor({ state: 'visible', timeout: 60_000 });
  await textarea.fill(prompt);
  const sendButton = page.getByTestId('chat-composer-send-button');
  await sendButton.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="chat-composer-send-button"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  }, undefined, { timeout: 60_000 });
  const sendEnabledBeforeClick = await sendButton.evaluate((button) =>
    button instanceof HTMLButtonElement && !button.disabled);
  const textareaValueLengthAfterFill = await textarea.evaluate((element) =>
    element instanceof HTMLTextAreaElement ? element.value.length : 0);
  await sendButton.click();
  const composerClearedAfterClick = await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="chat-composer-textarea"]');
    return element instanceof HTMLTextAreaElement && element.value.length === 0;
  }, undefined, { timeout: 3_000 }).then(() => true).catch(() => false);
  return {
    sendClicked: true,
    sendEnabledBeforeClick,
    textareaValueLengthAfterFill,
    composerClearedAfterClick,
  };
}

async function waitForUserMessageObserved(page: Page, prompt: string, timeoutMs: number): Promise<boolean> {
  const promptNeedle = prompt.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!promptNeedle) return false;
  return page.waitForFunction((needle) => {
    const messages = Array.from(document.querySelectorAll('[data-testid="chat-message"].user, [data-testid="chat-message"][class*="user"]'));
    return messages.some((element) =>
      (element.textContent ?? '').replace(/\s+/g, ' ').includes(needle));
  }, promptNeedle, { timeout: timeoutMs }).then(() => true).catch(() => false);
}

async function currentUiErrorText(page: Page): Promise<string | undefined> {
  const value = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"], [data-testid*="error"], .chat-error, .error-message'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .slice(0, 1_000)).catch(() => '');
  return value.trim() || undefined;
}

async function startFreshOrdinaryChat(page: Page): Promise<void> {
  const newAgentButton = page.getByRole('button', { name: /New Agent|新建智能体/i }).first();
  await newAgentButton.waitFor({ state: 'visible', timeout: 60_000 });
  await newAgentButton.click({ force: true });
  await page.waitForFunction(() => Boolean(
    document.querySelector('[data-testid="chat-composer-textarea"]')
      || document.querySelector('[data-testid="chat-composer-collapsed-button"]'),
  ), undefined, { timeout: 60_000 });
  await page.waitForTimeout(250);
}

async function waitForUiWebSocketDone(capture: UiWebSocketCapture, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (capture.terminalDoneObserved) return;
    await sleep(250);
  }
  throw new Error(`desktop UI Runtime Codex WebSocket timed out after ${timeoutMs}ms`);
}

async function waitForUiWebSocketObserved(capture: UiWebSocketCapture, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (capture.observed) return true;
    await sleep(250);
  }
  return capture.observed;
}

function codexRuntimeWebSocketUrl(workspaceWriterBaseUrl: string): string {
  const url = new URL(CODEX_RUNTIME_WEBSOCKET_PATH, workspaceWriterBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function copyLauncherAuditLogs(
  scratchRoot: string,
  outDir: string,
  diagnostics: DesktopProductDiagnostics,
): Promise<void> {
  const auditPaths = await findFilesNamed(scratchRoot, 'runtime-launcher-audit.ndjson', 6);
  if (auditPaths.length === 0) return;
  const relativeDir = 'launcher-audits';
  const absoluteDir = join(outDir, relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  for (let index = 0; index < auditPaths.length; index += 1) {
    const relativePath = join(relativeDir, `runtime-launcher-audit-${index + 1}.ndjson`);
    await copyFile(auditPaths[index]!, join(outDir, relativePath));
    diagnostics.launcherAuditPaths.push(relativePath);
  }
}

async function findFilesNamed(root: string, fileName: string, maxDepth: number): Promise<string[]> {
  if (maxDepth < 0) return [];
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) matches.push(absolutePath);
    else if (entry.isDirectory()) matches.push(...await findFilesNamed(absolutePath, fileName, maxDepth - 1));
  }
  return matches;
}

async function visibleSourceLinks(page: Page, links: string[]): Promise<string[]> {
  const visible: string[] = [];
  for (const link of links) {
    if (await page.getByText(link, { exact: false }).first().isVisible().catch(() => false)) {
      visible.push(link);
    }
  }
  return visible;
}

async function waitForWorkspaceWriter(baseUrl: string): Promise<void> {
  await waitForHttpOk(`${baseUrl.replace(/\/+$/, '')}/health`, 'Workspace Writer');
}

async function waitForRuntimeCodex(baseUrl: string): Promise<void> {
  await waitForHttpOk(`${baseUrl.replace(/\/+$/, '')}/health`, 'Runtime Codex');
}

async function waitForHttpOk(url: string, label: string): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      last = `${response.status} ${await response.text()}`;
      if (response.ok) return;
    } catch (error) {
      last = messageFromError(error);
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become healthy: ${last.slice(0, 500)}`);
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown positional argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  const taskClass = values.get('task-class') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_TASK_CLASS ?? 'ordinary-web-lookup';
  if (!WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.includes(taskClass as TaskClass)) {
    throw new Error(`Invalid --task-class ${taskClass}; expected one of ${WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.join(', ')}`);
  }
  return {
    outDir: resolve(values.get('out') ?? values.get('out-dir') ?? env.SCIFORGE_DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_OUT ?? DEFAULT_OUT_DIR),
    workspacePath: resolve(values.get('workspace') ?? env.SCIFORGE_WORKSPACE_PATH ?? process.cwd()),
    taskClass: taskClass as TaskClass,
    commandText: values.get('prompt') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_PROMPT ?? DEFAULT_COMMAND_TEXT,
    route: productProofRoute(values.get('route') ?? env.SCIFORGE_WEB_SEARCH_PRODUCT_ACCEPTANCE_ROUTE),
    timeoutMs: positiveInteger(values.get('timeout-ms') ?? env.SCIFORGE_DESKTOP_WEB_SEARCH_PRODUCT_ACCEPTANCE_TIMEOUT_MS) ?? 240_000,
    json,
  };
}

function helpText(): string {
  return [
    'Usage: tsx tools/desktop-web-search-product-acceptance.ts [--out dir] [--workspace path] [--task-class class] [--prompt text] [--json]',
    '',
    'Runs the real Electron desktop ordinary-chat product proof for current-run web_search evidence plus final source links.',
    'It launches built SciForge desktop artifacts, submits through the visible chat composer, captures Runtime Codex WebSocket current-run frames, and reuses the web_search product validator.',
    'Read-required prompts still fail closed unless current-run web_read source/page text evidence is present.',
    '',
    'Fail-closed rules:',
    '  - missing dist-desktop/dist-ui artifacts writes blocked manifest + desktop-sidecar.json and exits non-zero.',
    '  - missing LLM/search provider, timeout, missing UI WebSocket, or missing visible source link writes blocked evidence and exits non-zero.',
    '',
    'Required before live pass:',
    '  npm run desktop:build',
    '  config.local.json member-model settings for the SciForge Model Router plus a live web_search provider such as SCIFORGE_SEARXNG_BASE_URL.',
    '  --route native|fallback selects Codex native web_search or SciForge fallback web_search via SCIFORGE_WEB_SEARCH_MODE.',
    '',
    `  --task-class class        ${WEB_SEARCH_PRODUCT_ACCEPTANCE_TASK_CLASSES.join(' | ')}. Default: ordinary-web-lookup.`,
    `  --out dir                 Artifact directory. Default: ${DEFAULT_OUT_DIR}`,
    '  --route native|fallback   Select Codex native web_search or SciForge fallback web_search. Maps to SCIFORGE_WEB_SEARCH_MODE.',
    '  --timeout-ms ms           Desktop UI/Runtime Codex timeout. Default: 240000.',
    '',
  ].join('\n');
}

async function writeBlockedReadme(outDir: string, reason: string): Promise<void> {
  await writeFile(join(outDir, 'blocked-desktop-web-search-product-acceptance.md'), [
    '# Desktop web search product acceptance blocked',
    '',
    `Reason: ${reason}`,
    '',
    'Rerun after building desktop artifacts and configuring config.local.json member-model settings plus live search provider environment.',
    '',
  ].join('\n'), 'utf8');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseJson(value: string | Buffer): unknown {
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function productProofRoute(value: string | undefined): ProductProofRoute | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'native' || normalized === 'fallback') return normalized;
  throw new Error(`Invalid --route ${value}; expected native or fallback`);
}

function envWithWebSearchRoute(env: NodeJS.ProcessEnv, route: ProductProofRoute | undefined): NodeJS.ProcessEnv {
  if (!route) return env;
  return {
    ...env,
    SCIFORGE_WEB_SEARCH_MODE: route,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const exitCode = await runDesktopWebSearchProductAcceptanceCli();
  process.exitCode = exitCode;
}
