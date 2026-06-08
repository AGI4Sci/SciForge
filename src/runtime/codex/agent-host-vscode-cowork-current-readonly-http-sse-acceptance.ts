import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { createCodexAppServerRuntimeAdapter } from './codex-runtime-adapter.js';
import {
  CODEX_RUNTIME_STREAM_PATH,
  handleCodexRuntimeRoutes,
} from './codex-runtime-server.js';
import type { VSCodeCoWorkLiveDiagnosticResult } from './agent-host-vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic,
} from './agent-host-vscode-cowork-current-live-diagnostic.js';
import type {
  CurrentVSCodeCoWorkLiveDiagnosticRunner,
} from './computer-use-native-route.js';

export const CURRENT_VSCODE_COWORK_READONLY_HTTP_SSE_ACCEPTANCE_SCHEMA_VERSION =
  'sciforge.current-vscode-cowork-readonly-http-sse-acceptance.v1' as const;

const DEFAULT_HTTP_SSE_READONLY_COMMAND_TEXT = '操作我已经打开的 VSCode，读取当前可见文本。';

type HttpSseAcceptanceStatus = 'passed' | 'blocked' | 'needs-confirmation';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest {
  schemaVersion: typeof CURRENT_VSCODE_COWORK_READONLY_HTTP_SSE_ACCEPTANCE_SCHEMA_VERSION;
  status: HttpSseAcceptanceStatus;
  passClaim: boolean;
  maturity: 'live-diagnostic';
  productReady: false;
  runner: 'runtime-codex-current-vscode-cowork-readonly-http-sse-acceptance';
  source: 'ordinary-chat-http-sse-current-vscode-cowork-read-visible-text';
  checkedAt: string;
  userProfileUsed: true;
  sharedSystemInputUsed: true;
  httpSseTransportUsed: boolean;
  adapterBoundaryUsed: boolean;
  vscodeLaunched: false;
  userVSCodeKilled: false;
  userProfileCleared: false;
  readiness: {
    requiredEnv: Array<{ name: string; present: boolean; valuePrinted: false }>;
    missing: string[];
  };
  operation: 'read-visible-text';
  runtimeRequest: {
    commandId?: string;
    attemptId?: string;
    eventTransport?: 'sse';
    targetKind?: 'current-vscode-cowork';
    operation?: 'read-visible-text';
    agentHostInputRefs: string[];
  };
  sseEventsObserved: string[];
  primitiveChainObserved: string[];
  finalAnswer: {
    status: VSCodeCoWorkLiveDiagnosticResult['status'];
    hostOwnsFinalAnswer: boolean;
    computerUseCorePlanning: boolean;
    userTaskCompletionClaimed: false;
    reason?: string;
  };
  evidenceRefs: string[];
  releaseEvidenceRefs: string[];
  restorationEvidenceRefs: string[];
  hostProducerEvidence?: CurrentVSCodeCoWorkReadonlyHttpSseHostProducerEvidence;
  cleanup: {
    inputLeaseReleased: boolean;
    cursorReleased: boolean;
    adapterReleased: boolean;
    frontAppRestored: boolean;
    mousePositionRestored: boolean;
    userVSCodeProcessKilled: false;
    userProfileCleared: false;
  };
  blockedReasons: string[];
  nextActions: string[];
}

export interface CurrentVSCodeCoWorkReadonlyHttpSseHostProducerEvidence {
  schemaVersion: 'sciforge.current-vscode-cowork-readonly-http-sse-host-producer-evidence.v1';
  targetKind?: 'current-vscode-cowork';
  operation?: 'read-visible-text';
  agentHostInputRefs: string[];
  targetRefs: string[];
  observationRefs: string[];
  permissionRefs: string[];
  runtimeTruthRefs: string[];
  sessionReadyRefs: string[];
  inputLeaseRefs: string[];
  adapterRefs: string[];
  evidenceRefs: string[];
}

export interface RunCurrentVSCodeCoWorkReadonlyHttpSseAcceptanceOptions {
  workspacePath?: string;
  outputDir?: string;
  env?: Record<string, string | undefined>;
  commandText?: string;
  activateCurrentVSCodeIfNeeded?: boolean;
  now?: () => Date;
  createAdapter?: (input: CurrentVSCodeCoWorkReadonlyHttpSseAdapterFactoryInput) => AgentCliAdapter;
}

export interface CurrentVSCodeCoWorkReadonlyHttpSseAdapterFactoryInput {
  env: NodeJS.ProcessEnv;
  currentVSCodeCoWorkLiveDiagnosticRunner: CurrentVSCodeCoWorkLiveDiagnosticRunner;
  currentVSCodeCoWorkLiveDiagnosticOptions: {
    activateCurrentVSCodeIfNeeded?: boolean;
  };
}

export async function runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance(
  options: RunCurrentVSCodeCoWorkReadonlyHttpSseAcceptanceOptions = {},
): Promise<CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'test-artifacts', 'current-vscode-cowork-readonly-http-sse'));
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const env = options.env ?? process.env;
  const readiness = readinessSummary(env);
  if (readiness.missing.length) {
    return writeManifest(outputDir, baseManifest({
      checkedAt,
      readiness,
      blockedReasons: readiness.missing,
    }));
  }

  const commandText = options.commandText ?? DEFAULT_HTTP_SSE_READONLY_COMMAND_TEXT;
  const commandId = 'current-vscode-cowork-readonly-http-sse-live';
  const attemptId = 'current-vscode-cowork-readonly-http-sse-live-attempt-1';
  const agentHostInput = currentVSCodeReadonlyAgentHostInput(commandText);
  const liveRunner: CurrentVSCodeCoWorkLiveDiagnosticRunner = (runnerInput) => runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    env,
    commandText: runnerInput.commandText,
    workspacePath: runnerInput.workspacePath,
    commandId: runnerInput.commandId,
    attemptId: runnerInput.attemptId,
    authorizationProfileId: runnerInput.authorizationProfileId,
    activateCurrentVSCodeIfNeeded: runnerInput.activateCurrentVSCodeIfNeeded === true,
  });
  const adapterFactoryInput: CurrentVSCodeCoWorkReadonlyHttpSseAdapterFactoryInput = {
    env: env as NodeJS.ProcessEnv,
    currentVSCodeCoWorkLiveDiagnosticRunner: liveRunner,
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      ...(options.activateCurrentVSCodeIfNeeded === true ? { activateCurrentVSCodeIfNeeded: true } : {}),
    },
  };
  const adapter = options.createAdapter?.(adapterFactoryInput) ?? createCodexAppServerRuntimeAdapter(adapterFactoryInput);
  const httpRun = await runHttpSseRuntimeTurn({
    adapter,
    workspacePath,
    commandText,
    commandId,
    attemptId,
    agentHostInput,
  });
  const done = httpRun.events.find((event) => event.event === 'done')?.data;
  const realtimeSession = httpRun.events.find((event) => event.event === 'realtime_session')?.data;
  const turnEvent = httpRun.events.find((event) => event.event === 'turn')?.data;
  const evidenceRefs = safeRefs([
    ...safeRefs(done?.evidenceRefs),
    ...safeRefs(isRecord(done?.agentHostFinalAnswer) ? done.agentHostFinalAnswer.evidenceRefs : undefined),
  ]);
  const cleanupRefs = safeRefs(done?.cleanupRefs);
  const releaseEvidenceRefs = cleanupRefs.filter(releaseEvidenceRef);
  const restorationEvidenceRefs = cleanupRefs.filter(restorationEvidenceRef);
  const primitiveChainObserved = safePrimitiveChain(done?.primitiveChainObserved);
  const hostProducerEvidence = hostProducerEvidenceFromRoutePayload(done?.hostProducerEvidence);
  const blockedReasons = liveAcceptanceBlockers({
    responseOk: httpRun.responseOk,
    contentType: httpRun.contentType,
    events: httpRun.events,
    done,
    turnEvent,
    realtimeSession,
    primitiveChainObserved,
    evidenceRefs,
    releaseEvidenceRefs,
    restorationEvidenceRefs,
    hostProducerEvidence,
  });
  const doneStatus = liveDiagnosticStatus(done?.status);
  const status: HttpSseAcceptanceStatus = doneStatus === 'needs-confirmation'
    ? 'needs-confirmation'
    : blockedReasons.length ? 'blocked' : 'passed';

  return writeManifest(outputDir, {
    ...baseManifest({ checkedAt, readiness, blockedReasons }),
    status,
    passClaim: status === 'passed',
    httpSseTransportUsed: httpRun.contentType.toLowerCase().includes('text/event-stream') && httpRun.events.some((event) => event.event === 'realtime_session'),
    adapterBoundaryUsed: Boolean(turnEvent),
    runtimeRequest: {
      commandId,
      attemptId,
      ...(realtimeSession?.eventTransport === 'sse' ? { eventTransport: 'sse' as const } : {}),
      targetKind: 'current-vscode-cowork',
      operation: 'read-visible-text',
      agentHostInputRefs: safeRefs(agentHostInput.refs),
    },
    sseEventsObserved: uniqueStrings(httpRun.events.map((event) => event.event).filter(safeEventName)),
    primitiveChainObserved,
    finalAnswer: {
      status: liveDiagnosticStatus(isRecord(done?.agentHostFinalAnswer) ? done.agentHostFinalAnswer.status : done?.status),
      hostOwnsFinalAnswer: isRecord(done?.agentHostFinalAnswer) && done.agentHostFinalAnswer.hostOwnsFinalAnswer === true,
      computerUseCorePlanning: finalAnswerHasCorePlanning(done?.agentHostFinalAnswer),
      userTaskCompletionClaimed: false,
      ...(safeReason(done?.message) ? { reason: safeReason(done?.message) } : {}),
    },
    evidenceRefs,
    releaseEvidenceRefs,
    restorationEvidenceRefs,
    ...(hostProducerEvidence ? { hostProducerEvidence } : {}),
    cleanup: {
      inputLeaseReleased: cleanupRefs.some((ref) => ref.startsWith('scoped-input-lease:') || ref.startsWith('input-lease:')),
      cursorReleased: cleanupRefs.some((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('actor-cursor:')),
      adapterReleased: cleanupRefs.some((ref) => ref.startsWith('scoped-input-adapter:') || ref.startsWith('input-adapter:')),
      frontAppRestored: restorationEvidenceRefs.some((ref) => ref.startsWith('front-app-restore:') || ref.startsWith('focus-restore:')),
      mousePositionRestored: restorationEvidenceRefs.some((ref) => ref.startsWith('mouse-position-restore:') || ref.startsWith('cursor-position-restore:')),
      userVSCodeProcessKilled: false,
      userProfileCleared: false,
    },
    nextActions: status === 'passed' ? [] : nextActions(),
  });
}

function baseManifest(input: {
  checkedAt: string;
  readiness: CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest['readiness'];
  blockedReasons: string[];
}): CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest {
  return {
    schemaVersion: CURRENT_VSCODE_COWORK_READONLY_HTTP_SSE_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    passClaim: false,
    maturity: 'live-diagnostic',
    productReady: false,
    runner: 'runtime-codex-current-vscode-cowork-readonly-http-sse-acceptance',
    source: 'ordinary-chat-http-sse-current-vscode-cowork-read-visible-text',
    checkedAt: input.checkedAt,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    httpSseTransportUsed: false,
    adapterBoundaryUsed: false,
    vscodeLaunched: false,
    userVSCodeKilled: false,
    userProfileCleared: false,
    readiness: input.readiness,
    operation: 'read-visible-text',
    runtimeRequest: {
      agentHostInputRefs: [],
    },
    sseEventsObserved: [],
    primitiveChainObserved: [],
    finalAnswer: {
      status: 'blocked',
      hostOwnsFinalAnswer: false,
      computerUseCorePlanning: false,
      userTaskCompletionClaimed: false,
    },
    evidenceRefs: [],
    releaseEvidenceRefs: [],
    restorationEvidenceRefs: [],
    cleanup: {
      inputLeaseReleased: false,
      cursorReleased: false,
      adapterReleased: false,
      frontAppRestored: false,
      mousePositionRestored: false,
      userVSCodeProcessKilled: false,
      userProfileCleared: false,
    },
    blockedReasons: input.blockedReasons,
    nextActions: nextActions(),
  };
}

async function writeManifest(
  outputDir: string,
  manifest: CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest,
): Promise<CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function readinessSummary(env: Record<string, string | undefined>): CurrentVSCodeCoWorkReadonlyHttpSseAcceptanceManifest['readiness'] {
  const requiredEnv = [{
    name: VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
    present: env[VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV] === '1',
    valuePrinted: false as const,
  }];
  return {
    requiredEnv,
    missing: requiredEnv.filter((item) => !item.present).map((item) => `missing-env:${item.name}`),
  };
}

function currentVSCodeReadonlyAgentHostInput(commandText: string) {
  const sessionRef = 'window-action-session:current-vscode-cowork:http-sse-readonly';
  const windowRef = 'window:vscode:http-sse-readonly';
  const fileRef = 'file-ref:vscode:http-sse-readonly';
  const requestRef = 'chat-request:vscode-cowork:http-sse-readonly';
  const permissionRef = `permission:current-vscode-cowork:full-access:${sessionRef}:${fileRef}`;
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'current-vscode-cowork-readonly-http-sse-acceptance',
    intentText: commandText,
    authorizationProfileId: 'high-autonomy',
    policyOwner: 'codex-agent-host-runtime',
    refs: [
      'intent:current-vscode-cowork',
      requestRef,
      sessionRef,
      windowRef,
      fileRef,
      'text:vscode:http-sse-title',
      'frontmost:vscode:http-sse-readonly',
      permissionRef,
    ],
    readiness: {
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      kind: 'current-vscode-cowork',
      refs: [
        windowRef,
        fileRef,
        'macos-app:vscode:http-sse-readonly',
        'process:vscode:http-sse-readonly',
        'text:vscode:http-sse-title',
        'frontmost:vscode:http-sse-readonly',
      ],
      vscodeCoWork: {
        operation: 'read-visible-text',
        refs: [requestRef, windowRef, fileRef],
      },
    },
    observation: {
      fresh: true,
      refs: [
        'observation:vscode:http-sse-before-read',
        'image:vscode:http-sse-before-read',
        'accessibility:vscode:http-sse-before-read',
        'text:vscode:http-sse-visible',
        'element:vscode:http-sse-editor',
        'freshness:vscode:http-sse-before-read',
      ],
      vscodeCoWork: {
        windowRef,
        selectedFileRef: fileRef,
        refs: [
          'observation:vscode:http-sse-before-read',
          'text:vscode:http-sse-visible',
          'element:vscode:http-sse-editor',
        ],
      },
    },
    permissions: {
      refs: [permissionRef],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

async function runHttpSseRuntimeTurn(input: {
  adapter: AgentCliAdapter;
  workspacePath: string;
  commandText: string;
  commandId: string;
  attemptId: string;
  agentHostInput: Record<string, unknown>;
}): Promise<{
  responseOk: boolean;
  contentType: string;
  events: SseEvent[];
}> {
  const server = await startRuntimeServer(input.adapter);
  try {
    const response = await fetch(`${serverBaseUrl(server)}${CODEX_RUNTIME_STREAM_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 'sciforge.codex-runtime-stream-request.v1',
        commandText: input.commandText,
        workspacePath: input.workspacePath,
        commandId: input.commandId,
        attemptId: input.attemptId,
        profile: 'sciforge-runtime-default',
        agentHostInput: input.agentHostInput,
        guiExtension: { enabled: true },
        realtimeSession: {
          schemaVersion: 'sciforge.codex-realtime-session.v1',
          bridge: 'codex-native-realtime-session',
          streamKind: 'structured-events-plus-terminal-equivalent-text',
          eventTransport: 'sse',
          eventContract: 'structured-events',
          inputTextKind: 'terminal-equivalent-text',
          rawTerminal: false,
          commandId: input.commandId,
          attemptId: input.attemptId,
          resumeRequested: false,
        },
      }),
    });
    const text = await response.text();
    return {
      responseOk: response.ok,
      contentType: response.headers.get('content-type') ?? '',
      events: parseSseEvents(text),
    };
  } finally {
    await closeServer(server);
  }
}

async function startRuntimeServer(adapter: AgentCliAdapter): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter).then((handled) => {
      if (handled || res.writableEnded) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    }).catch((error: unknown) => {
      if (res.writableEnded) return;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Runtime server did not bind to a TCP port.');
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (!event || !dataLines.length) continue;
    try {
      const data = JSON.parse(dataLines.join('\n'));
      if (isRecord(data)) events.push({ event, data });
    } catch {
      // Text-only diagnostics are intentionally not promoted into acceptance evidence.
    }
  }
  return events;
}

function liveAcceptanceBlockers(input: {
  responseOk: boolean;
  contentType: string;
  events: SseEvent[];
  done?: Record<string, unknown>;
  turnEvent?: Record<string, unknown>;
  realtimeSession?: Record<string, unknown>;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  releaseEvidenceRefs: string[];
  restorationEvidenceRefs: string[];
  hostProducerEvidence?: CurrentVSCodeCoWorkReadonlyHttpSseHostProducerEvidence;
}): string[] {
  return [
    input.responseOk ? undefined : 'http-response-not-ok',
    input.contentType.toLowerCase().includes('text/event-stream') ? undefined : 'missing-http-sse-content-type',
    input.realtimeSession?.eventTransport === 'sse' ? undefined : 'missing-realtime-session-sse-event',
    input.turnEvent ? undefined : 'missing-turn-event',
    input.done ? undefined : 'missing-done-event',
    liveDiagnosticStatus(input.done?.status) === 'completed' ? undefined : `runner-status:${liveDiagnosticStatus(input.done?.status)}`,
    primitiveChainMatches(input.primitiveChainObserved) ? undefined : 'primitive-chain-incomplete',
    input.evidenceRefs.some((ref) => ref.startsWith('decision:')) ? undefined : 'missing-host-decision-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('observation:')) ? undefined : 'missing-observation-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('text:')) ? undefined : 'missing-text-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('image:')) ? undefined : 'missing-image-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('accessibility:')) ? undefined : 'missing-accessibility-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('element:')) ? undefined : 'missing-editor-element-ref',
    input.evidenceRefs.some((ref) => ref.startsWith('freshness:')) ? undefined : 'missing-freshness-ref',
    input.releaseEvidenceRefs.some((ref) => ref.startsWith('scoped-input-lease:') || ref.startsWith('input-lease:')) ? undefined : 'missing-input-lease-release-ref',
    input.releaseEvidenceRefs.some((ref) => ref.startsWith('scoped-input-adapter:') || ref.startsWith('input-adapter:')) ? undefined : 'missing-input-adapter-release-ref',
    input.releaseEvidenceRefs.some((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('actor-cursor:')) ? undefined : 'missing-cursor-release-ref',
    input.restorationEvidenceRefs.some((ref) => ref.startsWith('front-app-restore:') || ref.startsWith('focus-restore:')) ? undefined : 'missing-front-app-restore-ref',
    input.restorationEvidenceRefs.some((ref) => ref.startsWith('mouse-position-restore:') || ref.startsWith('cursor-position-restore:')) ? undefined : 'missing-mouse-position-restore-ref',
    input.hostProducerEvidence ? undefined : 'missing-host-producer-evidence',
    input.hostProducerEvidence?.operation === 'read-visible-text' ? undefined : 'missing-host-producer-read-visible-text-operation',
    isRecord(input.done?.agentHostFinalAnswer) && input.done.agentHostFinalAnswer.hostOwnsFinalAnswer === true ? undefined : 'missing-host-owned-final-answer',
    isRecord(input.done?.agentHostFinalAnswer) && input.done.agentHostFinalAnswer.computerUseCorePlanning === false ? undefined : 'computer-use-core-planning-not-false',
  ].filter((item): item is string => Boolean(item));
}

function hostProducerEvidenceFromRoutePayload(value: unknown): CurrentVSCodeCoWorkReadonlyHttpSseHostProducerEvidence | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.codex-agent-host.current-vscode-cowork-live-producer-evidence.v1') return undefined;
  const agentHostInputRefs = safeRefs(value.agentHostInputRefs);
  const targetRefs = safeRefs(value.targetRefs);
  const observationRefs = safeRefs(value.observationRefs);
  const permissionRefs = safeRefs(value.permissionRefs);
  const runtimeTruthRefs = safeRefs(value.runtimeTruthRefs);
  const sessionReadyRefs = safeRefs(value.sessionReadyRefs);
  const inputLeaseRefs = safeRefs(value.inputLeaseRefs);
  const adapterRefs = safeRefs(value.adapterRefs);
  const evidenceRefs = uniqueStrings([
    ...safeRefs(value.evidenceRefs),
    ...agentHostInputRefs,
    ...targetRefs,
    ...observationRefs,
    ...permissionRefs,
    ...runtimeTruthRefs,
    ...sessionReadyRefs,
    ...inputLeaseRefs,
    ...adapterRefs,
  ]);
  if (!evidenceRefs.length) return undefined;
  return {
    schemaVersion: 'sciforge.current-vscode-cowork-readonly-http-sse-host-producer-evidence.v1',
    ...(value.targetKind === 'current-vscode-cowork' ? { targetKind: 'current-vscode-cowork' as const } : {}),
    ...(value.operation === 'read-visible-text' ? { operation: 'read-visible-text' as const } : {}),
    agentHostInputRefs,
    targetRefs,
    observationRefs,
    permissionRefs,
    runtimeTruthRefs,
    sessionReadyRefs,
    inputLeaseRefs,
    adapterRefs,
    evidenceRefs,
  };
}

function liveDiagnosticStatus(value: unknown): VSCodeCoWorkLiveDiagnosticResult['status'] {
  return value === 'completed' || value === 'needs-confirmation' || value === 'blocked'
    ? value
    : 'blocked';
}

function safeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === 'string' && safeRef(item)));
}

function safeRef(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 260) return false;
  if (/https?:\/\/|data:|base64|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|raw-/i.test(text)) return false;
  return /^(?:intent:|chat-request:|decision:|macos-app:|process:|window:|frontmost:|file-ref:|text:|text-ref:|image:|accessibility:|element:|freshness:|observation:|window-action-session:|computer-use-session:|computer-use:|permission:|risk:|action:|executor-event:|input-event:|input-lease:|scoped-input-lease:|actor-cursor:|cursor-marker:|scoped-input-adapter:|input-adapter:|stale-invalidation:|control:|front-app-restore:|focus-restore:|mouse-position-restore:|cursor-position-restore:|runtime-truth:|audit:)[^\s/\\]*$/i.test(text);
}

function safePrimitiveChain(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => /^(?:bind|observe|host-decision|act|control\(release\))$/i.test(item));
}

function primitiveChainMatches(chain: string[]): boolean {
  return JSON.stringify(chain) === JSON.stringify(['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
}

function finalAnswerHasCorePlanning(value: unknown): boolean {
  const record = isRecord(value) ? value : undefined;
  return record?.computerUseCorePlanning === true;
}

function releaseEvidenceRef(ref: string): boolean {
  return /^(?:scoped-input-lease:|input-lease:|scoped-input-adapter:|input-adapter:|cursor-marker:|actor-cursor:|control:)/i.test(ref);
}

function restorationEvidenceRef(ref: string): boolean {
  return /^(?:front-app-restore:|focus-restore:|mouse-position-restore:|cursor-position-restore:)/i.test(ref);
}

function safeEventName(value: string): boolean {
  return /^(?:realtime_session|process-progress|heartbeat|turn|run_started|message|done|failed|error)$/i.test(value);
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 400) return undefined;
  if (/https?:\/\/|data:|base64|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|raw-|product-ready|kill-vscode|clear-profile/i.test(text)) return undefined;
  return text;
}

function nextActions(): string[] {
  return [
    `Set ${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}=1 only when the user is ready to run the current VSCode read-only HTTP/SSE live diagnostic.`,
    'Keep the HTTP/SSE request refs-first: Host must provide current VSCode target/observe refs, then Computer Use returns refs for the next Host decision.',
    'If the current VSCode window, editor, file, or observation freshness cannot be uniquely proven, return needs-confirmation or blocked before any primitive beyond observe.',
  ];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
