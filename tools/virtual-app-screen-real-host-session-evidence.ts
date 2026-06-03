import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  VirtualAppScreenInputRuntimeProjection,
} from '../src/runtime/computer-use/virtual-app-screen-input-runtime.js';
import type {
  VirtualAppScreenSessionManagerAttachResult,
} from '../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import type {
  VirtualAppScreenUserAcceptanceInput,
} from './virtual-app-screen-user-acceptance-manifest.js';

export const VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1' as const;

export type VirtualAppScreenRealHostSessionEvidenceStatus = 'passed' | 'blocked';

export interface VirtualAppScreenRealHostDogfoodRefs {
  hostSessionRef?: string;
  attachState?: string;
  status?: string;
  surfaceMode?: string;
  screenRef?: string;
  targetAppRef?: string;
  targetWindowRef?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  grantValidationStatus?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  surfaceTransportRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  currentRunPointerRef?: string;
  beforeFrameRef?: string;
  afterFrameRef?: string;
  inputLeaseRef?: string;
  activeLeaseOwnerRef?: string;
  userLeaseRef?: string;
  agentLeaseRef?: string;
  adapterReadinessRef?: string;
  evidenceLedgerRef?: string;
  guiPresentRefs?: string[];
  inputIntentRefs?: string[];
  humanInputHotPathRefs?: string[];
  inputAcceptedRefs?: string[];
  executorEventRefs?: string[];
  beforeAfterFrameRefs?: string[];
  automationBarrierRefs?: string[];
  backgroundEvidenceRefs?: string[];
  minimalEvidenceReplayRefs?: string[];
  realAgentQueueEvidenceRefs?: string[];
  takeoverRefs?: string[];
  pauseRefs?: string[];
  resumeRefs?: string[];
  closeSessionRefs?: string[];
  safeStopRefs?: string[];
  inputIntentReady?: boolean;
  leaseControlReady?: boolean;
  diagnosticOnly?: boolean;
  realHostProviderSessionRef?: string;
  realOptInRunRef?: string;
  realPlatformEvidenceRefs?: string[];
}

export interface VirtualAppScreenRealHostSessionEvidenceManifest {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA;
  status: VirtualAppScreenRealHostSessionEvidenceStatus;
  runId: string;
  platformProvider: string;
  targetAppProfile: string;
  observedAt: string;
  diagnosticOnly: boolean;
  blockedReason: string | null;
  refsFirst: true;
  dogfoodRefs: VirtualAppScreenRealHostDogfoodRefs;
  userAcceptanceInput: VirtualAppScreenUserAcceptanceInput;
  validation: {
    ok: boolean;
    missing: string[];
  };
}

export interface BuildVirtualAppScreenRealHostSessionEvidenceInput {
  runId: string;
  platformProvider: string;
  targetAppProfile?: string;
  userIntent?: string;
  createdAt?: string;
  attach: VirtualAppScreenSessionManagerAttachResult;
  input?: VirtualAppScreenInputRuntimeProjection;
  takeover?: VirtualAppScreenInputRuntimeProjection;
  resume?: VirtualAppScreenInputRuntimeProjection;
  stop?: VirtualAppScreenInputRuntimeProjection;
}

export function buildVirtualAppScreenRealHostSessionEvidenceManifest(
  input: BuildVirtualAppScreenRealHostSessionEvidenceInput,
): VirtualAppScreenRealHostSessionEvidenceManifest {
  const targetAppProfile = input.targetAppProfile ?? targetAppProfileFromAttach(input.attach);
  const evidenceLedgerRef = input.attach.refs.evidenceLedgerRef;
  const currentRunPointerRef = input.attach.refs.currentRunPointerRef;
  const inputRefs = projectionRefs(input.input);
  const takeoverRefs = projectionRefs(input.takeover);
  const resumeRefs = projectionRefs(input.resume);
  const stopRefs = projectionRefs(input.stop);
  const minimalEvidenceReplayRefs = minimalReplayRefs(input.attach, input.input, input.takeover, input.resume, input.stop);
  const realHostProviderSessionRef = nativeHostRealRef('real-provider-sessions', input.runId, 'session.json');
  const realOptInRunRef = nativeHostRealRef('real-opt-in-runs', input.runId, 'run.json');
  const diagnosticOnlyFalseRef = nativeHostRealRef('real-opt-in-runs', input.runId, 'diagnostic-only-false.json');
  const realPlatformEvidenceRefs = uniqueRefs([
    diagnosticOnlyFalseRef,
    realOptInRunRef,
    input.attach.refs.platformDriverRef,
    input.attach.refs.adapterReadinessRef,
    evidenceLedgerRef,
  ]).filter(isNativeHostProductRef);
  const realAgentQueueEvidenceRefs = uniqueRefs([
    routeString(input.takeover, 'agentQueueRef'),
    routeString(input.resume, 'agentQueueRef'),
    routeString(input.resume, 'currentFrameRefreshRef'),
  ]).filter(isNativeHostProductRef);
  const dogfoodRefs: VirtualAppScreenRealHostDogfoodRefs = stripUndefined({
    hostSessionRef: input.attach.refs.sessionRef,
    attachState: input.attach.status,
    status: input.attach.status === 'attached' ? 'ready' : input.attach.status,
    surfaceMode: input.attach.status === 'attached' ? 'live' : 'empty',
    screenRef: input.attach.refs.screenRef,
    targetAppRef: input.attach.refs.targetAppRef,
    targetWindowRef: input.attach.refs.targetWindowRef,
    sessionRef: input.attach.refs.sessionRef,
    liveSurfaceRef: input.attach.refs.liveSurfaceRef,
    liveBindingAttachGrantRef: input.attach.refs.liveBindingAttachGrantRef,
    grantValidationRef: input.attach.refs.grantValidationRef,
    grantValidationStatus: input.attach.refs.grantValidationRef ? 'validated' : undefined,
    surfaceOwnerRef: input.attach.refs.surfaceOwnerRef,
    displayOwnerRef: input.attach.refs.displayOwnerRef,
    surfaceTransportRef: input.attach.refs.surfaceTransportRef,
    frameStreamRef: input.attach.refs.frameStreamRef,
    currentFrameRef: routeString(input.resume, 'currentFrameRef') ?? routeString(input.input, 'currentFrameRef') ?? input.attach.refs.currentFrameRef,
    currentRunPointerRef,
    beforeFrameRef: routeString(input.input, 'beforeFrameRef') ?? input.attach.refs.currentFrameRef,
    afterFrameRef: routeString(input.resume, 'currentFrameRef') ?? routeString(input.input, 'currentFrameRef') ?? input.attach.refs.currentFrameRef,
    inputLeaseRef: input.attach.refs.inputLeaseRef,
    adapterReadinessRef: input.attach.refs.adapterReadinessRef,
    evidenceLedgerRef,
    guiPresentRefs: uniqueRefs([input.attach.refs.guiPresentRef]),
    inputIntentRefs: inputRefs.inputIntentRefs,
    humanInputHotPathRefs: uniqueRefs([
      input.attach.refs.actionAdapterRef,
      ...inputRefs.inputIntentRefs,
      ...inputRefs.executorEventRefs,
    ]),
    inputAcceptedRefs: inputAcceptedRefs(input),
    executorEventRefs: inputRefs.executorEventRefs,
    beforeAfterFrameRefs: uniqueRefs([
      ...inputRefs.beforeAfterFrameRefs,
      ...takeoverRefs.beforeAfterFrameRefs,
      ...resumeRefs.beforeAfterFrameRefs,
    ]),
    automationBarrierRefs: uniqueRefs([
      routeString(input.takeover, 'agentQueueRef'),
      routeString(input.resume, 'agentQueueRef'),
      routeString(input.resume, 'currentFrameRefreshRef'),
      ...eventRefsFor(input.takeover, 'agent.paused'),
      ...eventRefsFor(input.resume, 'agent.resumed'),
    ]),
    backgroundEvidenceRefs: uniqueRefs([
      input.attach.refs.frameStreamRef,
      input.attach.refs.surfaceTransportRef,
      input.attach.refs.frameTelemetryRef,
      input.attach.refs.frameTransportContractRef,
      routeString(input.resume, 'currentFrameRef'),
    ]),
    minimalEvidenceReplayRefs,
    realAgentQueueEvidenceRefs,
    takeoverRefs: uniqueRefs([
      routeString(input.takeover, 'agentQueueRef'),
      ...eventRefsFor(input.takeover, 'agent.paused'),
    ]),
    pauseRefs: uniqueRefs([
      routeString(input.takeover, 'agentQueueRef'),
      ...eventRefsFor(input.takeover, 'agent.paused'),
    ]),
    resumeRefs: uniqueRefs([
      routeString(input.resume, 'agentQueueRef'),
      routeString(input.resume, 'currentFrameRefreshRef'),
      ...eventRefsFor(input.resume, 'agent.resumed'),
    ]),
    closeSessionRefs: uniqueRefs([
      routeString(input.stop, 'agentQueueRef'),
      ...eventRefsFor(input.stop, 'session.closed'),
    ]),
    safeStopRefs: uniqueRefs([
      routeString(input.stop, 'safeStopRef'),
    ]),
    inputIntentReady: Boolean(input.input?.status === 'executed'),
    leaseControlReady: Boolean(input.takeover?.status === 'executed' && input.resume?.status === 'executed'),
    diagnosticOnly: input.attach.evidence.diagnosticOnly === false ? false : true,
    realHostProviderSessionRef,
    realOptInRunRef,
    realPlatformEvidenceRefs,
  });
  const missing = missingProofs(dogfoodRefs, input);
  const diagnosticOnly = input.attach.evidence.diagnosticOnly !== false;
  const userAcceptanceInput = buildUserAcceptanceInput({
    runId: input.runId,
    targetAppProfile,
    userIntent: input.userIntent,
    createdAt: input.createdAt,
    dogfoodRefs,
    attach: input.attach,
    inputRefs,
    takeoverRefs,
    resumeRefs,
    stopRefs,
    realHostProviderSessionRef,
    realOptInRunRef,
    realPlatformEvidenceRefs,
    proofComplete: missing.length === 0 && !diagnosticOnly,
  });
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
    status: missing.length === 0 && !diagnosticOnly ? 'passed' : 'blocked',
    runId: input.runId,
    platformProvider: input.platformProvider,
    targetAppProfile,
    observedAt: input.createdAt ?? new Date().toISOString(),
    diagnosticOnly,
    blockedReason: missing.length === 0 && !diagnosticOnly
      ? null
      : [
        diagnosticOnly ? 'diagnosticOnly=false proof is required.' : undefined,
        ...missing,
      ].filter((reason): reason is string => Boolean(reason)).join(' '),
    refsFirst: true,
    dogfoodRefs,
    userAcceptanceInput,
    validation: {
      ok: missing.length === 0 && !diagnosticOnly,
      missing,
    },
  };
}

export async function writeVirtualAppScreenRealHostSessionEvidenceManifest(
  outPath: string,
  input: BuildVirtualAppScreenRealHostSessionEvidenceInput,
): Promise<VirtualAppScreenRealHostSessionEvidenceManifest> {
  const manifest = buildVirtualAppScreenRealHostSessionEvidenceManifest(input);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export function defaultVirtualAppScreenRealHostSessionEvidenceManifestPath(runId: string): string {
  return join('docs', 'test-artifacts', 'virtual-app-screen-real-app-session', safeSegment(runId), 'manifest.json');
}

function buildUserAcceptanceInput(input: {
  runId: string;
  targetAppProfile: string;
  userIntent?: string;
  createdAt?: string;
  dogfoodRefs: VirtualAppScreenRealHostDogfoodRefs;
  attach: VirtualAppScreenSessionManagerAttachResult;
  inputRefs: ProjectionRefs;
  takeoverRefs: ProjectionRefs;
  resumeRefs: ProjectionRefs;
  stopRefs: ProjectionRefs;
  realHostProviderSessionRef: string;
  realOptInRunRef: string;
  realPlatformEvidenceRefs: string[];
  proofComplete: boolean;
}): VirtualAppScreenUserAcceptanceInput {
  const refs = input.dogfoodRefs;
  return {
    taskId: `P0-CU-REAL-HOST-${safeSegment(input.runId)}`,
    scenarioId: `virtual-app-screen-real-host-${safeSegment(input.targetAppProfile)}`,
    userIntent: input.userIntent ?? 'Run a real VirtualAppScreen app session with attach, human input, takeover, and resume evidence.',
    targetAppRefs: uniqueRefs([refs.targetAppRef]),
    targetWindowRefs: uniqueRefs([refs.targetWindowRef]),
    sessionRefs: uniqueRefs([refs.sessionRef]),
    adapterReadinessRefs: uniqueRefs([refs.adapterReadinessRef]),
    adapterReadinessRecords: [{
      adapterKind: 'native-virtual-app-screen-host',
      targetScope: 'app',
      supportedActions: ['click', 'type', 'scroll', 'hotkey', 'takeover', 'resume-agent'],
      captureSupported: true,
      backgroundRenderable: input.attach.evidence.backgroundRenderable === true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      blockedReason: null,
      schemaRefs: [
        'schema:computer-use/action-adapter-readiness.v1',
        input.attach.refs.adapterReadinessRef,
      ].filter((ref): ref is string => Boolean(ref)),
    }],
    screenFrameRefs: uniqueRefs([refs.beforeFrameRef, refs.afterFrameRef, refs.currentFrameRef]),
    inputIntentRefs: refs.inputIntentRefs ?? [],
    executorEventRefs: uniqueRefs([
      ...(input.inputRefs.executorEventRefs ?? []),
      ...(input.takeoverRefs.executorEventRefs ?? []),
      ...(input.resumeRefs.executorEventRefs ?? []),
      ...(input.stopRefs.executorEventRefs ?? []),
    ]),
    beforeAfterFrameRefs: refs.beforeAfterFrameRefs ?? [],
    annotationProposalRefs: uniqueRefs([
      nativeHostRealRef('real-opt-in-runs', input.runId, 'annotation-proposal.json'),
    ]),
    artifactRefs: uniqueRefs([
      nativeHostRealRef('real-opt-in-runs', input.runId, 'real-app-session-artifact.json'),
    ]),
    verificationRefs: uniqueRefs([
      ...(input.inputRefs.verificationRefs ?? []),
      ...(input.takeoverRefs.verificationRefs ?? []),
      ...(input.resumeRefs.verificationRefs ?? []),
      ...(input.stopRefs.verificationRefs ?? []),
    ]),
    guiPresentRefs: refs.guiPresentRefs ?? [],
    replayRef: nativeHostRealRef('real-opt-in-runs', input.runId, 'minimal-replay.json'),
    evidenceLedgerRef: refs.evidenceLedgerRef,
    isolationFlags: {
      backgroundRenderable: input.attach.evidence.backgroundRenderable === true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: input.attach.evidence.diagnosticOnly !== false,
    },
    evidenceClaims: [{
      id: 'real-virtual-app-screen',
      kind: 'real-virtual-app-screen',
      status: input.proofComplete ? 'present' : 'blocked',
      ref: refs.evidenceLedgerRef,
      refs: uniqueRefs([refs.currentRunPointerRef, refs.realOptInRunRef]),
      evidenceRefs: uniqueRefs([
        ...(refs.inputAcceptedRefs ?? []),
        ...(refs.automationBarrierRefs ?? []),
        ...(refs.backgroundEvidenceRefs ?? []),
        ...(refs.realAgentQueueEvidenceRefs ?? []),
        ...(refs.closeSessionRefs ?? []),
        ...(refs.safeStopRefs ?? []),
      ]),
      sessionRefs: uniqueRefs([refs.sessionRef]),
      realHostProviderSessionRef: input.realHostProviderSessionRef,
      realOptInRunRef: input.realOptInRunRef,
      currentRunPointerRef: refs.currentRunPointerRef,
      realPlatformEvidenceRefs: input.realPlatformEvidenceRefs,
      minimalEvidenceReplayRefs: refs.minimalEvidenceReplayRefs,
      diagnosticOnly: input.proofComplete ? false : true,
    }],
    createdAt: input.createdAt,
    metadata: {
      realHostEvidenceSchemaVersion: VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
      runId: input.runId,
    },
  };
}

interface ProjectionRefs {
  inputIntentRefs: string[];
  executorEventRefs: string[];
  beforeAfterFrameRefs: string[];
  verificationRefs: string[];
  evidenceRefs: string[];
}

function projectionRefs(projection: VirtualAppScreenInputRuntimeProjection | undefined): ProjectionRefs {
  const route = projection?.routeDecision ?? {};
  return {
    inputIntentRefs: stringList(route.inputIntentRefs),
    executorEventRefs: stringList(route.executorEventRefs),
    beforeAfterFrameRefs: stringList(route.beforeAfterFrameRefs),
    verificationRefs: stringList(route.verificationRefs),
    evidenceRefs: stringList(projection?.evidence.evidenceRefs),
  };
}

function inputAcceptedRefs(input: BuildVirtualAppScreenRealHostSessionEvidenceInput): string[] {
  return uniqueRefs([
    ...eventRefsFor(input.input, 'human-input.accepted'),
    ...projectionRefs(input.input).executorEventRefs.filter((ref) => /\/inputs\//u.test(ref)),
  ]);
}

function minimalReplayRefs(
  attach: VirtualAppScreenSessionManagerAttachResult,
  input?: VirtualAppScreenInputRuntimeProjection,
  takeover?: VirtualAppScreenInputRuntimeProjection,
  resume?: VirtualAppScreenInputRuntimeProjection,
  stop?: VirtualAppScreenInputRuntimeProjection,
) {
  return uniqueRefs([
    ...(attach.refs.minimalEvidenceReplayRefs ?? []),
    ...stringList(input?.routeDecision.minimalEvidenceReplayRefs),
    ...stringList(takeover?.routeDecision.minimalEvidenceReplayRefs),
    ...stringList(resume?.routeDecision.minimalEvidenceReplayRefs),
    ...stringList(stop?.routeDecision.minimalEvidenceReplayRefs),
    ...eventRefsFor(input, 'human-input.accepted'),
    ...eventRefsFor(takeover, 'agent.paused'),
    ...eventRefsFor(resume, 'agent.resumed'),
    ...eventRefsFor(stop, 'session.closed'),
  ]);
}

function missingProofs(
  refs: VirtualAppScreenRealHostDogfoodRefs,
  input: BuildVirtualAppScreenRealHostSessionEvidenceInput,
): string[] {
  return [
    input.attach.status === 'attached' ? undefined : 'attached real Host session is required.',
    refs.sessionRef ? undefined : 'sessionRef is required.',
    refs.liveSurfaceRef ? undefined : 'liveSurfaceRef is required.',
    refs.currentFrameRef ? undefined : 'currentFrameRef is required.',
    refs.currentRunPointerRef ? undefined : 'currentRunPointerRef is required.',
    refs.evidenceLedgerRef ? undefined : 'evidenceLedgerRef is required.',
    refs.realHostProviderSessionRef ? undefined : 'realHostProviderSessionRef is required.',
    refs.realOptInRunRef ? undefined : 'realOptInRunRef is required.',
    refs.realPlatformEvidenceRefs?.length ? undefined : 'realPlatformEvidenceRefs are required.',
    input.input?.status === 'executed' ? undefined : 'executed human input projection is required.',
    input.takeover?.status === 'executed' ? undefined : 'executed takeover proof is required.',
    input.resume?.status === 'executed' ? undefined : 'executed resume proof is required.',
    refs.inputAcceptedRefs?.length ? undefined : 'human input proof is required.',
    refs.takeoverRefs?.length ? undefined : 'takeover proof is required.',
    refs.resumeRefs?.length ? undefined : 'resume proof is required.',
    refs.automationBarrierRefs?.length ? undefined : 'automation barrier proof is required.',
    refs.realAgentQueueEvidenceRefs?.length && refs.realAgentQueueEvidenceRefs.length >= 3
      ? undefined
      : 'real agent queue evidence is required.',
    refs.backgroundEvidenceRefs?.length ? undefined : 'background frame evidence is required.',
    refs.minimalEvidenceReplayRefs?.some((ref) => ref.includes('human-input.accepted')) ? undefined : 'human-input.accepted replay proof is required.',
    refs.minimalEvidenceReplayRefs?.some((ref) => ref.includes('agent.resumed')) ? undefined : 'agent.resumed replay proof is required.',
  ].filter((entry): entry is string => Boolean(entry));
}

function eventRefsFor(
  projection: VirtualAppScreenInputRuntimeProjection | undefined,
  eventType: string,
): string[] {
  return stringList(projection?.evidence.evidenceRefs)
    .filter((ref) => ref.includes(eventType));
}

function routeString(projection: VirtualAppScreenInputRuntimeProjection | undefined, key: string): string | undefined {
  const value = projection?.routeDecision[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function targetAppProfileFromAttach(attach: VirtualAppScreenSessionManagerAttachResult): string {
  return attach.refs.targetAppRef?.split('/').filter(Boolean).at(-1) ?? 'generic-workbench';
}

function nativeHostRealRef(scope: string, runId: string, leaf: string): string {
  return `computer-use:native-host/${scope}/${safeSegment(runId)}/${leaf}`;
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'run';
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim());
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isNativeHostProductRef(ref: string): boolean {
  return ref.startsWith('computer-use:native-host/')
    && !/(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu.test(ref)
    && !/^(?:https?:|file:|data:|blob:|javascript:|\/)/iu.test(ref)
    && !/;base64,/iu.test(ref);
}
