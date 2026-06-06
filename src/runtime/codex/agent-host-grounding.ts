import {
  authorizationProfileOrDefault,
  type RuntimeReadinessValue,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { AgentHostGroundingSnapshot } from './agent-cli-adapter.js';

const GROUNDING_SOURCE = 'runtime-codex-grounding';

export type CodexAgentHostReadinessKey =
  | 'browserHostSession'
  | 'nativeBridge'
  | 'nativeSurface'
  | 'windowActionSession'
  | 'computerUseAdapter';

export interface NormalizedCodexAgentHostInput {
  schemaVersion: 'sciforge.codex-agent-host-input.v1';
  source?: string;
  intentText?: string;
  authorizationProfileId?: string;
  singleTurnOverride: boolean;
  refs: string[];
  readiness: Record<string, unknown>;
  target: Record<string, unknown>;
  observation: Record<string, unknown>;
  permissions: Record<string, unknown>;
}

export interface CodexAgentHostRuntimeTruth {
  schemaVersion: 'sciforge.agent-host.runtime-truth.v1';
  source?: string;
  readiness?: Partial<Record<CodexAgentHostReadinessKey, RuntimeReadinessValue>>;
  target?: {
    bound?: boolean;
    summary?: string;
    refs?: string[];
  };
  observation?: {
    fresh?: boolean;
    refs?: string[];
  };
  permissions?: {
    refs?: string[];
    permissionRefs?: string[];
    appAllowlistRefs?: string[];
    windowAllowlistRefs?: string[];
    riskPreviewRefs?: string[];
    scopedExecutorRefs?: string[];
    stopCancelPath?: boolean;
    controlPath?: CodexAgentHostRuntimeControlPath;
  };
  sessions?: CodexAgentHostRuntimeSessionTruth;
  adapter?: CodexAgentHostRuntimeAdapterTruth;
  controlPath?: CodexAgentHostRuntimeControlPath;
  refs?: string[];
}

export interface CodexAgentHostRuntimeSessionTruth {
  sessionReadyRefs?: string[];
  targetRefs?: string[];
  actorCursorRefs?: string[];
  inputLeaseRefs?: string[];
  focusLeaseRefs?: string[];
  observationRefs?: string[];
}

export interface CodexAgentHostRuntimeAdapterTruth {
  providerId?: string;
  refs?: string[];
  capabilityRefs?: string[];
  inputIsolation?: CodexAgentHostRuntimeAdapterInputIsolation;
}

export interface CodexAgentHostRuntimeAdapterInputIsolation {
  mode?: string;
  refsOnly: boolean;
  sharedSystemInput?: boolean;
  requiresFocusLease?: boolean;
  singleInteractiveTruth?: boolean;
  secondTruthSource?: boolean;
  refs?: string[];
}

export interface CodexAgentHostRuntimeControlPath {
  ready: boolean;
  takeoverRefs: string[];
  pauseRefs: string[];
  resumeRefs: string[];
  stopRefs: string[];
  cancelRefs: string[];
}

export interface CodexAgentHostRuntimeTruthResolverInput {
  input: unknown;
  agentHostInput: NormalizedCodexAgentHostInput;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  abortSignal?: AbortSignal;
}

export type CodexAgentHostRuntimeTruthResolver =
  (input: CodexAgentHostRuntimeTruthResolverInput) => Promise<CodexAgentHostRuntimeTruth | undefined> | CodexAgentHostRuntimeTruth | undefined;

export async function resolveCodexAgentHostRuntimeTruth(input: {
  input: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  abortSignal?: AbortSignal;
  runtimeTruthResolver?: CodexAgentHostRuntimeTruthResolver;
}): Promise<CodexAgentHostRuntimeTruth | undefined> {
  const agentHostInput = normalizeAgentHostInput(input.input);
  if (!agentHostInput || !input.runtimeTruthResolver) return undefined;
  return sanitizeRuntimeTruth(await input.runtimeTruthResolver({
    input: input.input,
    agentHostInput,
    commandText: input.commandText,
    workspacePath: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    auditMetadata: input.auditMetadata,
    abortSignal: input.abortSignal,
  }));
}

export function createCodexAgentHostGroundingSnapshot(
  input: unknown,
  options: { runtimeTruth?: CodexAgentHostRuntimeTruth } = {},
): AgentHostGroundingSnapshot | undefined {
  const agentHostInput = normalizeAgentHostInput(input);
  if (!agentHostInput) return undefined;
  const readiness = readinessFromInput(agentHostInput, options.runtimeTruth);
  const refs = refsFromInput(agentHostInput, options.runtimeTruth);
  const target = targetFromInput(agentHostInput, options.runtimeTruth);
  const observation = observationFromInput(agentHostInput, options.runtimeTruth);
  const permissions = permissionsFromInput(agentHostInput, options.runtimeTruth);
  const authorization = authorizationProfileOrDefault(agentHostInput.authorizationProfileId);
  if (authorization.source === 'declared-invalid-profile') return undefined;
  const browserBlockers = [
    readiness.browserHostSession === 'ready' ? undefined : 'browser-host-session-unavailable',
    readiness.nativeBridge === 'ready' ? undefined : 'native-bridge-unavailable',
    readiness.nativeSurface === 'ready' ? undefined : 'native-surface-unavailable',
  ].filter((value): value is string => Boolean(value));
  const computerUseBlockers = [
    ...browserBlockers,
    readiness.windowActionSession === 'ready' ? undefined : 'window-action-session-unavailable',
    readiness.computerUseAdapter === 'ready' ? undefined : 'computer-use-adapter-unavailable',
    target.bound ? undefined : 'target-unbound',
    observation.fresh ? undefined : 'needs-observation',
    permissions.refs.length ? undefined : 'permission-missing',
    permissions.scopedExecutorRefs?.length ? undefined : 'scoped-executor-missing',
    permissions.stopCancelPath ? undefined : 'cancel-path-missing',
  ].filter((value): value is string => Boolean(value));
  return {
    schemaVersion: 'sciforge.agent-host.grounding-snapshot.v1',
    source: GROUNDING_SOURCE,
    productCapabilities: {
      browser: 'supported',
      computerUse: 'supported',
    },
    runtimeReadiness: {
      browser: browserBlockers.length ? 'blocked' : 'ready',
      computerUse: computerUseBlockers.length ? 'blocked' : 'ready',
    },
    readiness,
    blockers: Array.from(new Set(computerUseBlockers)),
    authorizationProfile: {
      id: authorization.profile.id,
      publicLabel: authorization.profile.publicLabel,
      scope: authorization.profile.scope,
    },
    singleTurnOverride: agentHostInput.singleTurnOverride,
    actionContext: {
      targetBound: target.bound,
      freshObservation: observation.fresh,
      permissionRefsPresent: permissions.refs.length > 0,
      stopCancelPath: permissions.stopCancelPath,
    },
    refs: refs.slice(0, 16),
  };
}

function normalizeAgentHostInput(value: unknown): NormalizedCodexAgentHostInput | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.codex-agent-host-input.v1') return undefined;
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: stringField(value.source),
    intentText: stringField(value.intentText),
    authorizationProfileId: stringField(value.authorizationProfileId),
    singleTurnOverride: value.singleTurnOverride === true,
    refs: stringList(value.refs),
    readiness: isRecord(value.readiness) ? value.readiness : {},
    target: isRecord(value.target) ? value.target : {},
    observation: isRecord(value.observation) ? value.observation : {},
    permissions: isRecord(value.permissions) ? value.permissions : {},
  };
}

function readinessFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  const readiness = isRecord(input.readiness.readiness) ? input.readiness.readiness : input.readiness;
  const healthReadiness = readinessFromRuntimeHealthProjection(readiness);
  const truthReadiness = runtimeTruth?.readiness ?? {};
  return {
    browserHostSession: readinessValue(truthReadiness.browserHostSession, readinessValue(readiness.browserHostSession, healthReadiness.browserHostSession)),
    nativeBridge: readinessValue(truthReadiness.nativeBridge, readinessValue(readiness.nativeBridge, healthReadiness.nativeBridge)),
    nativeSurface: readinessValue(truthReadiness.nativeSurface, readinessValue(readiness.nativeSurface, healthReadiness.nativeSurface)),
    windowActionSession: readinessValue(truthReadiness.windowActionSession, readinessValue(readiness.windowActionSession, healthReadiness.windowActionSession)),
    computerUseAdapter: readinessValue(truthReadiness.computerUseAdapter, readinessValue(readiness.computerUseAdapter, healthReadiness.computerUseAdapter)),
  };
}

function readinessFromRuntimeHealthProjection(readiness: Record<string, unknown>) {
  const items = Array.isArray(readiness.items)
    ? readiness.items.filter(isRecord)
    : [];
  const workspace = items.find((item) => item.id === 'workspace');
  const workspaceOnline = workspace?.status === 'online';
  const capabilities = new Set(stringList(workspace?.capabilities));
  const nativeSurfaceReady = workspaceOnline && capabilities.has('browser-host-native-surface');
  return {
    browserHostSession: workspaceOnline && capabilities.has('browser-host-session') ? 'ready' : 'blocked',
    nativeBridge: nativeSurfaceReady ? 'ready' : 'blocked',
    nativeSurface: nativeSurfaceReady ? 'ready' : 'blocked',
    windowActionSession: workspaceOnline && capabilities.has('window-action-session') ? 'ready' : 'blocked',
    computerUseAdapter: workspaceOnline && capabilities.has('computer-use-adapter') ? 'ready' : 'blocked',
  } satisfies Record<string, RuntimeReadinessValue>;
}

function readinessValue(value: unknown, fallback: RuntimeReadinessValue = 'blocked'): RuntimeReadinessValue {
  if (value === undefined) return fallback;
  if (value === true || value === 'ready') return 'ready';
  return 'blocked';
}

function refsFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  return [
    ...input.refs,
    ...stringList(input.readiness.refs),
    ...stringList(input.readiness.evidenceRefs),
    ...stringList(input.readiness.healthRefs),
    ...stringList(runtimeTruth?.refs),
  ];
}

function targetFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.target) {
    const refs = stringList(runtimeTruth.target.refs);
    return {
      bound: runtimeTruth.target.bound === true || (runtimeTruth.target.bound !== false && refs.length > 0),
      summary: runtimeTruth.target.summary ?? 'Unbound target',
      refs,
    };
  }
  const refs = [
    ...stringList(input.target.refs),
    ...stringList(input.target.evidenceRefs),
    ...stringList(input.target.targetRefs),
  ];
  return {
    bound: input.target.bound === true || refs.length > 0,
    summary: stringField(input.target.summary) ?? stringField(input.target.title) ?? 'Unbound target',
    refs,
  };
}

function observationFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.observation) {
    return {
      fresh: runtimeTruth.observation.fresh === true,
      refs: stringList(runtimeTruth.observation.refs),
    };
  }
  const refs = [
    ...stringList(input.observation.refs),
    ...stringList(input.observation.evidenceRefs),
    ...stringList(input.observation.screenshotRefs),
  ];
  return {
    fresh: input.observation.fresh === true || input.observation.status === 'fresh',
    refs,
  };
}

function permissionsFromInput(input: NormalizedCodexAgentHostInput, runtimeTruth?: CodexAgentHostRuntimeTruth) {
  if (runtimeTruth?.permissions) {
    return {
      refs: stringList(runtimeTruth.permissions.refs),
      scopedExecutorRefs: Array.isArray(runtimeTruth.permissions.scopedExecutorRefs)
        ? stringList(runtimeTruth.permissions.scopedExecutorRefs)
        : undefined,
      stopCancelPath: runtimeTruth.permissions.stopCancelPath === true,
    };
  }
  const scopedExecutorRefs = Array.isArray(input.permissions.scopedExecutorRefs)
    ? stringList(input.permissions.scopedExecutorRefs)
    : undefined;
  return {
    refs: [
      ...stringList(input.permissions.refs),
      ...stringList(input.permissions.permissionRefs),
      ...stringList(input.permissions.evidenceRefs),
    ],
    scopedExecutorRefs,
    stopCancelPath: input.permissions.stopCancelPath === true || input.permissions.cancelPath === true || input.permissions.takeOverPath === true,
  };
}

function sanitizeRuntimeTruth(value: unknown): CodexAgentHostRuntimeTruth | undefined {
  if (!isRecord(value)) return undefined;
  const readiness = isRecord(value.readiness) ? value.readiness : {};
  const sanitizedReadiness: Partial<Record<CodexAgentHostReadinessKey, RuntimeReadinessValue>> = {};
  for (const key of ['browserHostSession', 'nativeBridge', 'nativeSurface', 'windowActionSession', 'computerUseAdapter'] as const) {
    if (readiness[key] !== undefined) sanitizedReadiness[key] = readinessValue(readiness[key]);
  }
  const target = isRecord(value.target) ? {
    ...(typeof value.target.bound === 'boolean' ? { bound: value.target.bound } : {}),
    ...(stringField(value.target.summary) ? { summary: stringField(value.target.summary) } : {}),
    refs: [
      ...stringList(value.target.refs),
      ...stringList(value.target.evidenceRefs),
      ...stringList(value.target.targetRefs),
    ].filter(runtimeOwnedRuntimeTruthRef),
  } : undefined;
  const observation = isRecord(value.observation) ? {
    fresh: value.observation.fresh === true || value.observation.status === 'fresh',
    refs: [
      ...stringList(value.observation.refs),
      ...stringList(value.observation.evidenceRefs),
      ...stringList(value.observation.screenshotRefs),
    ].filter(runtimeOwnedRuntimeTruthRef),
  } : undefined;
  const permissions = isRecord(value.permissions) ? {
    refs: [
      ...stringList(value.permissions.refs),
      ...stringList(value.permissions.permissionRefs),
      ...stringList(value.permissions.evidenceRefs),
    ].filter(runtimeOwnedRuntimeTruthRef),
    permissionRefs: stringList(value.permissions.permissionRefs).filter(runtimeOwnedRuntimeTruthRef),
    scopedExecutorRefs: stringList(value.permissions.scopedExecutorRefs).filter(runtimeOwnedRuntimeTruthRef),
    appAllowlistRefs: stringList(value.permissions.appAllowlistRefs).filter(runtimeOwnedRuntimeTruthRef),
    windowAllowlistRefs: stringList(value.permissions.windowAllowlistRefs).filter(runtimeOwnedRuntimeTruthRef),
    riskPreviewRefs: stringList(value.permissions.riskPreviewRefs).filter(runtimeOwnedRuntimeTruthRef),
    stopCancelPath: value.permissions.stopCancelPath === true || value.permissions.cancelPath === true || value.permissions.takeOverPath === true,
    ...(sanitizeRuntimeControlPath(value.permissions.controlPath) ? { controlPath: sanitizeRuntimeControlPath(value.permissions.controlPath) } : {}),
  } : undefined;
  const sessions = sanitizeRuntimeSessionTruth(value.sessions);
  const adapter = sanitizeRuntimeAdapterTruth(value.adapter);
  const controlPath = sanitizeRuntimeControlPath(value.controlPath);
  return {
    schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
    ...(stringField(value.source) ? { source: stringField(value.source) } : {}),
    ...(Object.keys(sanitizedReadiness).length ? { readiness: sanitizedReadiness } : {}),
    ...(target ? { target } : {}),
    ...(observation ? { observation } : {}),
    ...(permissions ? { permissions } : {}),
    ...(sessions ? { sessions } : {}),
    ...(adapter ? { adapter } : {}),
    ...(controlPath ? { controlPath } : {}),
    refs: stringList(value.refs).filter(runtimeOwnedRuntimeTruthRef),
  };
}

function sanitizeRuntimeSessionTruth(value: unknown): CodexAgentHostRuntimeSessionTruth | undefined {
  if (!isRecord(value)) return undefined;
  const sessionReadyRefs = stringList(value.sessionReadyRefs).filter(runtimeOwnedRuntimeTruthRef);
  const targetRefs = stringList(value.targetRefs).filter(runtimeOwnedRuntimeTruthRef);
  const actorCursorRefs = stringList(value.actorCursorRefs).filter(runtimeOwnedRuntimeTruthRef);
  const inputLeaseRefs = stringList(value.inputLeaseRefs).filter(runtimeOwnedRuntimeTruthRef);
  const focusLeaseRefs = stringList(value.focusLeaseRefs).filter(runtimeOwnedRuntimeTruthRef);
  const observationRefs = stringList(value.observationRefs).filter(runtimeOwnedRuntimeTruthRef);
  if (!sessionReadyRefs.length && !targetRefs.length && !actorCursorRefs.length && !inputLeaseRefs.length && !focusLeaseRefs.length && !observationRefs.length) {
    return undefined;
  }
  return {
    ...(sessionReadyRefs.length ? { sessionReadyRefs } : {}),
    ...(targetRefs.length ? { targetRefs } : {}),
    ...(actorCursorRefs.length ? { actorCursorRefs } : {}),
    ...(inputLeaseRefs.length ? { inputLeaseRefs } : {}),
    ...(focusLeaseRefs.length ? { focusLeaseRefs } : {}),
    ...(observationRefs.length ? { observationRefs } : {}),
  };
}

function sanitizeRuntimeAdapterTruth(value: unknown): CodexAgentHostRuntimeAdapterTruth | undefined {
  if (!isRecord(value)) return undefined;
  const refs = stringList(value.refs).filter(runtimeOwnedRuntimeTruthRef);
  const capabilityRefs = stringList(value.capabilityRefs).filter(runtimeOwnedRuntimeTruthRef);
  const inputIsolation = sanitizeRuntimeInputIsolation(value.inputIsolation);
  const providerId = safeRuntimeTruthStringField(value.providerId);
  if (!providerId && !refs.length && !capabilityRefs.length && !inputIsolation) return undefined;
  return {
    ...(providerId ? { providerId } : {}),
    ...(refs.length ? { refs } : {}),
    ...(capabilityRefs.length ? { capabilityRefs } : {}),
    ...(inputIsolation ? { inputIsolation } : {}),
  };
}

function sanitizeRuntimeInputIsolation(value: unknown): CodexAgentHostRuntimeAdapterInputIsolation | undefined {
  if (!isRecord(value)) return undefined;
  const refs = stringList(value.refs).filter(runtimeOwnedRuntimeTruthRef);
  const mode = safeRuntimeTruthStringField(value.mode);
  return {
    ...(mode ? { mode } : {}),
    refsOnly: value.refsOnly !== false,
    ...(typeof value.sharedSystemInput === 'boolean' ? { sharedSystemInput: value.sharedSystemInput } : {}),
    ...(typeof value.requiresFocusLease === 'boolean' ? { requiresFocusLease: value.requiresFocusLease } : {}),
    ...(typeof value.singleInteractiveTruth === 'boolean' ? { singleInteractiveTruth: value.singleInteractiveTruth } : {}),
    ...(typeof value.secondTruthSource === 'boolean' ? { secondTruthSource: value.secondTruthSource } : {}),
    ...(refs.length ? { refs } : {}),
  };
}

function safeRuntimeTruthStringField(value: unknown): string | undefined {
  const text = stringField(value);
  return text && !unsafeDiagnosticText(text) ? text : undefined;
}

function sanitizeRuntimeControlPath(value: unknown): CodexAgentHostRuntimeControlPath | undefined {
  if (!isRecord(value)) return undefined;
  const takeoverRefs = stringList(value.takeoverRefs).filter(runtimeOwnedRuntimeTruthRef);
  const pauseRefs = stringList(value.pauseRefs).filter(runtimeOwnedRuntimeTruthRef);
  const resumeRefs = stringList(value.resumeRefs).filter(runtimeOwnedRuntimeTruthRef);
  const stopRefs = stringList(value.stopRefs).filter(runtimeOwnedRuntimeTruthRef);
  const cancelRefs = stringList(value.cancelRefs).filter(runtimeOwnedRuntimeTruthRef);
  if (!takeoverRefs.length && !pauseRefs.length && !resumeRefs.length && !stopRefs.length && !cancelRefs.length) {
    return undefined;
  }
  return {
    ready: value.ready === true,
    takeoverRefs,
    pauseRefs,
    resumeRefs,
    stopRefs,
    cancelRefs,
  };
}

function runtimeOwnedRuntimeTruthRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:|history:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|virtual-app-screen:|computer-use:|native-adapter:|desktop-native:|permission:|approval:|cancel:|stop:|lease:|adapter-registry:|window:|action-ledger:|evidence:|workEvidence:|native-host:|audit:)/i.test(trimmed);
}

function unsafeDiagnosticText(value: string): boolean {
  return /https?:\/\/|data:image|base64|secret|token|password|api[-_]?key|bearer/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 16);
}
