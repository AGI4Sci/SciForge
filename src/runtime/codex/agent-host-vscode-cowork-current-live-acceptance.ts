import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic,
} from './agent-host-vscode-cowork-current-live-diagnostic.js';
import type {
  VSCodeCoWorkLiveDiagnosticResult,
} from './agent-host-vscode-cowork-live-diagnostic.js';
import type {
  CodexAppServerTurnStream,
} from './codex-app-server-adapter.js';
import {
  createComputerUseNativeRouteStream,
  type CurrentVSCodeCoWorkLiveDiagnosticRunner,
} from './computer-use-native-route.js';

export const CURRENT_VSCODE_COWORK_READONLY_LIVE_ACCEPTANCE_SCHEMA_VERSION =
  'sciforge.current-vscode-cowork-readonly-live-acceptance.v1' as const;

const DEFAULT_ORDINARY_CHAT_READONLY_COMMAND_TEXT = '操作我已经打开的 VSCode，读取当前可见文本。';

type ReadonlyLiveAcceptanceStatus = 'passed' | 'blocked' | 'needs-confirmation';

type ReadonlyLiveAcceptanceDiagnosticResult = VSCodeCoWorkLiveDiagnosticResult & {
  hostProducerEvidence?: Record<string, unknown>;
};

export interface CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest {
  schemaVersion: typeof CURRENT_VSCODE_COWORK_READONLY_LIVE_ACCEPTANCE_SCHEMA_VERSION;
  status: ReadonlyLiveAcceptanceStatus;
  passClaim: boolean;
  maturity: 'live-diagnostic';
  productReady: false;
  runner: 'runtime-codex-current-vscode-cowork-readonly-live-acceptance';
  source: 'ordinary-chat-current-vscode-cowork-read-visible-text';
  checkedAt: string;
  userProfileUsed: true;
  sharedSystemInputUsed: true;
  ordinaryChatNativeRouteUsed: boolean;
  vscodeLaunched: false;
  userVSCodeKilled: false;
  userProfileCleared: false;
  readiness: {
    requiredEnv: Array<{ name: string; present: boolean; valuePrinted: false }>;
    missing: string[];
  };
  operation: 'read-visible-text';
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
  hostProducerEvidence?: CurrentVSCodeCoWorkReadonlyHostProducerEvidence;
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

export interface CurrentVSCodeCoWorkReadonlyHostProducerEvidence {
  schemaVersion: 'sciforge.current-vscode-cowork-readonly-host-producer-evidence.v1';
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

export interface RunCurrentVSCodeCoWorkReadonlyLiveAcceptanceOptions {
  workspacePath?: string;
  outputDir?: string;
  env?: Record<string, string | undefined>;
  commandText?: string;
  activateCurrentVSCodeIfNeeded?: boolean;
  now?: () => Date;
  runReadVisibleTextLiveDiagnostic?: (
    input: Parameters<typeof runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic>[0],
  ) => Promise<VSCodeCoWorkLiveDiagnosticResult> | VSCodeCoWorkLiveDiagnosticResult;
}

export async function runCurrentVSCodeCoWorkReadonlyLiveAcceptance(
  options: RunCurrentVSCodeCoWorkReadonlyLiveAcceptanceOptions = {},
): Promise<CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest> {
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const outputDir = resolve(options.outputDir ?? join(workspacePath, 'docs', 'test-artifacts', 'current-vscode-cowork-readonly-live'));
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

  const commandText = options.commandText ?? DEFAULT_ORDINARY_CHAT_READONLY_COMMAND_TEXT;
  const routeRun = await runReadonlyLiveDiagnosticThroughOrdinaryChatNativeRoute({
    env,
    commandText,
    workspacePath,
    activateCurrentVSCodeIfNeeded: options.activateCurrentVSCodeIfNeeded,
    runReadVisibleTextLiveDiagnostic: options.runReadVisibleTextLiveDiagnostic,
  });
  const result = routeRun.result;

  const evidenceRefs = safeRefs([
    ...(result.evidenceRefs ?? []),
    ...(result.agentHostFinalAnswer?.evidenceRefs ?? []),
  ]);
  const cleanupRefs = safeRefs(result.cleanupRefs ?? []);
  const releaseEvidenceRefs = cleanupRefs.filter(releaseEvidenceRef);
  const restorationEvidenceRefs = cleanupRefs.filter(restorationEvidenceRef);
  const primitiveChainObserved = safePrimitiveChain(result.primitiveChainObserved);
  const hostProducerEvidence = hostProducerEvidenceFromResult(result);
  const blockedReasons = liveAcceptanceBlockers({
    result,
    primitiveChainObserved,
    evidenceRefs,
    releaseEvidenceRefs,
    restorationEvidenceRefs,
    cleanupRefs,
    hostProducerEvidence,
  });
  const status: ReadonlyLiveAcceptanceStatus = result.status === 'needs-confirmation'
    ? 'needs-confirmation'
    : blockedReasons.length ? 'blocked' : 'passed';

  return writeManifest(outputDir, {
    ...baseManifest({ checkedAt, readiness, blockedReasons }),
    status,
    passClaim: status === 'passed',
    ordinaryChatNativeRouteUsed: routeRun.ordinaryChatNativeRouteUsed,
    primitiveChainObserved,
    finalAnswer: {
      status: result.agentHostFinalAnswer?.status ?? result.status,
      hostOwnsFinalAnswer: result.agentHostFinalAnswer?.hostOwnsFinalAnswer === true,
      computerUseCorePlanning: finalAnswerHasCorePlanning(result.agentHostFinalAnswer),
      userTaskCompletionClaimed: false,
      ...(safeReason(result.message) ? { reason: safeReason(result.message) } : {}),
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
  readiness: CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest['readiness'];
  blockedReasons: string[];
}): CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest {
  return {
    schemaVersion: CURRENT_VSCODE_COWORK_READONLY_LIVE_ACCEPTANCE_SCHEMA_VERSION,
    status: 'blocked',
    passClaim: false,
    maturity: 'live-diagnostic',
    productReady: false,
    runner: 'runtime-codex-current-vscode-cowork-readonly-live-acceptance',
    source: 'ordinary-chat-current-vscode-cowork-read-visible-text',
    checkedAt: input.checkedAt,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    ordinaryChatNativeRouteUsed: false,
    vscodeLaunched: false,
    userVSCodeKilled: false,
    userProfileCleared: false,
    readiness: input.readiness,
    operation: 'read-visible-text',
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
  manifest: CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest,
): Promise<CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function runReadonlyLiveDiagnosticThroughOrdinaryChatNativeRoute(input: {
  env: Record<string, string | undefined>;
  commandText: string;
  workspacePath: string;
  activateCurrentVSCodeIfNeeded?: boolean;
  runReadVisibleTextLiveDiagnostic?: RunCurrentVSCodeCoWorkReadonlyLiveAcceptanceOptions['runReadVisibleTextLiveDiagnostic'];
}): Promise<{
  ordinaryChatNativeRouteUsed: boolean;
  result: ReadonlyLiveAcceptanceDiagnosticResult;
}> {
  const runner = input.runReadVisibleTextLiveDiagnostic ?? runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic;
  const liveRunner: CurrentVSCodeCoWorkLiveDiagnosticRunner = (runnerInput) => runner({
    env: input.env,
    commandText: runnerInput.commandText,
    workspacePath: runnerInput.workspacePath,
    commandId: runnerInput.commandId,
    attemptId: runnerInput.attemptId,
    authorizationProfileId: runnerInput.authorizationProfileId,
    activateCurrentVSCodeIfNeeded: runnerInput.activateCurrentVSCodeIfNeeded === true,
  });
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: input.commandText,
      workspacePath: input.workspacePath,
      commandId: 'current-vscode-cowork-readonly-live',
      attemptId: 'current-vscode-cowork-readonly-live-attempt-1',
      agentHostInput: currentVSCodeReadonlyAgentHostInput(input.commandText),
    },
    workspace: input.workspacePath,
    provider: 'host-owned-runtime',
    model: 'computer-use-native-route',
    profile: 'ordinary-chat-current-vscode-cowork-readonly-live',
    currentVSCodeCoWorkLiveDiagnosticRunner: liveRunner,
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: input.activateCurrentVSCodeIfNeeded === true,
    },
  });
  if (!stream) {
    return {
      ordinaryChatNativeRouteUsed: false,
      result: blockedRouteResult('Current VSCode read-only live acceptance did not select the ordinary chat native route.'),
    };
  }

  const events = await collectRouteEvents(stream);
  const done = events.find((event) => event.type === 'done');
  if (!done) {
    const failed = events.find((event) => event.type === 'failed');
    return {
      ordinaryChatNativeRouteUsed: true,
      result: blockedRouteResult(
        safeReason(failed?.message)
          ?? 'Current VSCode read-only live acceptance native route did not produce a done event.',
      ),
    };
  }
  return {
    ordinaryChatNativeRouteUsed: true,
    result: diagnosticResultFromRouteDone(done),
  };
}

async function collectRouteEvents(stream: CodexAppServerTurnStream): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for await (const event of stream.events) {
    if (isRecord(event)) events.push(event);
  }
  return events;
}

function diagnosticResultFromRouteDone(done: Record<string, unknown>): ReadonlyLiveAcceptanceDiagnosticResult {
  return {
    status: liveDiagnosticStatus(done.status),
    message: safeReason(done.message) ?? 'Current VSCode read-only live diagnostic route completed.',
    maturity: 'live-diagnostic',
    productReady: false,
    primitiveChainObserved: safePrimitiveChain(done.primitiveChainObserved),
    evidenceRefs: safeRefs(done.evidenceRefs),
    cleanupRefs: safeRefs(done.cleanupRefs),
    ...(isRecord(done.agentHostFinalAnswer)
      ? { agentHostFinalAnswer: done.agentHostFinalAnswer as unknown as VSCodeCoWorkLiveDiagnosticResult['agentHostFinalAnswer'] }
      : {}),
    ...(isRecord(done.hostProducerEvidence) ? { hostProducerEvidence: done.hostProducerEvidence } : {}),
  };
}

function blockedRouteResult(message: string): ReadonlyLiveAcceptanceDiagnosticResult {
  return {
    status: 'blocked',
    message,
    maturity: 'live-diagnostic',
    productReady: false,
    primitiveChainObserved: [],
    evidenceRefs: [],
    cleanupRefs: [],
  };
}

function liveDiagnosticStatus(value: unknown): ReadonlyLiveAcceptanceDiagnosticResult['status'] {
  return value === 'completed' || value === 'needs-confirmation' || value === 'blocked'
    ? value
    : 'blocked';
}

function readinessSummary(env: Record<string, string | undefined>): CurrentVSCodeCoWorkReadonlyLiveAcceptanceManifest['readiness'] {
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

function currentVSCodeReadonlyAgentHostInput(commandText: string): Record<string, unknown> {
  const sessionRef = 'window-action-session:current-vscode-cowork:readonly-live';
  const windowRef = 'window:vscode:readonly-live';
  const fileRef = 'file-ref:vscode:readonly-live';
  const requestRef = 'chat-request:vscode-cowork:readonly-live';
  const permissionRef = `permission:current-vscode-cowork:full-access:${sessionRef}:${fileRef}`;
  const targetRefs = [
    'macos-app:vscode:readonly-live',
    'process:vscode:readonly-live',
    windowRef,
    'text:title:vscode:readonly-live',
    'frontmost:vscode:readonly-live',
    fileRef,
  ];
  const observationRefs = [
    sessionRef,
    windowRef,
    'observation:vscode:readonly-live-before-read',
    'image:vscode:readonly-live-before-read',
    'accessibility:vscode:readonly-live-before-read',
    'text:vscode:visible-readonly-live',
    'element:vscode:editor-readonly-live',
    'freshness:vscode:readonly-live-before-read',
    fileRef,
  ];
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'current-vscode-cowork-readonly-live-acceptance',
    intentText: commandText,
    authorizationProfileId: 'high-autonomy',
    policyOwner: 'codex-agent-host-runtime',
    refs: [
      'intent:current-vscode-cowork',
      requestRef,
      ...targetRefs,
      ...observationRefs,
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
      refs: targetRefs,
      vscodeCoWork: {
        operation: 'read-visible-text',
        refs: [requestRef, windowRef, fileRef],
      },
    },
    observation: {
      fresh: true,
      refs: observationRefs,
      vscodeCoWork: {
        windowRef,
        selectedFileRef: fileRef,
        refs: observationRefs,
      },
    },
    permissions: {
      refs: [permissionRef],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function liveAcceptanceBlockers(input: {
  result: ReadonlyLiveAcceptanceDiagnosticResult;
  primitiveChainObserved: string[];
  evidenceRefs: string[];
  releaseEvidenceRefs: string[];
  restorationEvidenceRefs: string[];
  cleanupRefs: string[];
  hostProducerEvidence?: CurrentVSCodeCoWorkReadonlyHostProducerEvidence;
}): string[] {
  return [
    input.result.status === 'completed' ? undefined : `runner-status:${input.result.status}`,
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
    input.result.agentHostFinalAnswer?.hostOwnsFinalAnswer === true ? undefined : 'missing-host-owned-final-answer',
    input.result.agentHostFinalAnswer?.computerUseCorePlanning === false ? undefined : 'computer-use-core-planning-not-false',
  ].filter((item): item is string => Boolean(item));
}

function hostProducerEvidenceFromResult(
  result: ReadonlyLiveAcceptanceDiagnosticResult,
): CurrentVSCodeCoWorkReadonlyHostProducerEvidence | undefined {
  const routeProducerEvidence = hostProducerEvidenceFromRoutePayload(result.hostProducerEvidence);
  if (routeProducerEvidence) return routeProducerEvidence;
  const agentHostInput = isRecord(result.agentHostInput) ? result.agentHostInput : undefined;
  const runtimeTruth = isRecord(result.runtimeTruth) ? result.runtimeTruth : undefined;
  if (!agentHostInput && !runtimeTruth) return undefined;
  const target = isRecord(agentHostInput?.target) ? agentHostInput.target : undefined;
  const vscodeCoWork = isRecord(target?.vscodeCoWork) ? target.vscodeCoWork : undefined;
  const observation = isRecord(agentHostInput?.observation) ? agentHostInput.observation : undefined;
  const permissions = isRecord(agentHostInput?.permissions) ? agentHostInput.permissions : undefined;
  const runtimeTarget = isRecord(runtimeTruth?.target) ? runtimeTruth.target : undefined;
  const runtimeObservation = isRecord(runtimeTruth?.observation) ? runtimeTruth.observation : undefined;
  const runtimePermissions = isRecord(runtimeTruth?.permissions) ? runtimeTruth.permissions : undefined;
  const sessions = isRecord(runtimeTruth?.sessions) ? runtimeTruth.sessions : undefined;
  const adapter = isRecord(runtimeTruth?.adapter) ? runtimeTruth.adapter : undefined;
  const inputIsolation = isRecord(adapter?.inputIsolation) ? adapter.inputIsolation : undefined;
  const agentHostInputRefs = safeRefs(agentHostInput?.refs);
  const targetRefs = uniqueStrings([
    ...safeRefs(target?.refs),
    ...safeRefs(runtimeTarget?.refs),
  ]);
  const observationRefs = uniqueStrings([
    ...safeRefs(observation?.refs),
    ...safeRefs(runtimeObservation?.refs),
    ...safeRefs(sessions?.observationRefs),
  ]);
  const permissionRefs = uniqueStrings([
    ...safeRefs(permissions?.refs),
    ...safeRefs(permissions?.permissionRefs),
    ...safeRefs(runtimePermissions?.refs),
    ...safeRefs(runtimePermissions?.permissionRefs),
  ]);
  const runtimeTruthRefs = safeRefs(runtimeTruth?.refs);
  const sessionReadyRefs = safeRefs(sessions?.sessionReadyRefs);
  const inputLeaseRefs = uniqueStrings([
    ...safeRefs(sessions?.inputLeaseRefs),
    ...safeRefs(inputIsolation?.refs).filter((ref) => ref.startsWith('scoped-input-lease:') || ref.startsWith('input-lease:')),
  ]);
  const adapterRefs = safeRefs(adapter?.refs);
  const evidenceRefs = uniqueStrings([
    ...agentHostInputRefs,
    ...targetRefs,
    ...observationRefs,
    ...permissionRefs,
    ...runtimeTruthRefs,
    ...sessionReadyRefs,
    ...inputLeaseRefs,
    ...adapterRefs,
  ]);
  return {
    schemaVersion: 'sciforge.current-vscode-cowork-readonly-host-producer-evidence.v1',
    ...(target?.kind === 'current-vscode-cowork' ? { targetKind: 'current-vscode-cowork' as const } : {}),
    ...(vscodeCoWork?.operation === 'read-visible-text' ? { operation: 'read-visible-text' as const } : {}),
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

function hostProducerEvidenceFromRoutePayload(value: unknown): CurrentVSCodeCoWorkReadonlyHostProducerEvidence | undefined {
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
    schemaVersion: 'sciforge.current-vscode-cowork-readonly-host-producer-evidence.v1',
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

function safeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === 'string' && safeRef(item)));
}

function safeRef(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 260) return false;
  if (/https?:\/\/|data:|base64|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|raw-/i.test(text)) return false;
  return /^(?:intent:|chat-request:|decision:|macos-app:|process:|window:|frontmost:|file-ref:|text:|text-ref:|image:|accessibility:|element:|freshness:|observation:|window-action-session:|computer-use-session:|computer-use:|permission:|risk:|action:|executor-event:|input-event:|input-lease:|scoped-input-lease:|actor-cursor:|cursor-marker:|scoped-input-adapter:|input-adapter:|stale-invalidation:|control:|front-app-restore:|focus-restore:|mouse-position-restore:|cursor-position-restore:)[^\s/\\]*$/i.test(text);
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

function safeReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 400) return undefined;
  if (/https?:\/\/|data:|base64|secret|token|password|api[-_]?key|bearer|provider[-_/]?(?:payload|input|request|response)|raw-|product-ready|kill-vscode|clear-profile/i.test(text)) return undefined;
  return text;
}

function nextActions(): string[] {
  return [
    `Set ${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}=1 only when the user is ready to run the current VSCode read-only live diagnostic.`,
    'Keep VSCode frontmost and visible, or pass --activate-vscode only when exactly one VSCode window is the intended target; if evidence cannot identify one target, return needs-confirmation or blocked.',
  ];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
