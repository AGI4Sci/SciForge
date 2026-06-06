import { sha1 } from '../workspace-task-runner.js';
import { tryRunBrowserHostSearchRuntime } from '../browser-host-search-runtime.js';
import { tryRunRequestClarificationRuntime } from '../request-clarification-runtime.js';
import { taskProjectSkillDomain } from '../../../packages/contracts/runtime/handoff.js';
import {
  authorizationProfileOrDefault,
  capabilityAnswerProjection,
  defaultCapabilityQuestion,
  defaultGuiOperationIntent,
  evaluateComputerUsePreflight,
  evaluateBrowserEvidenceNeed,
  requiresComputerUseProductCompletionEvidence,
  type ComputerUsePreflightResult,
  type RuntimeReadinessValue,
} from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import {
  validateCurrentRunLiveAcceptanceBundle,
  type CuNextLiveAcceptanceBundleValidation,
} from '../../../packages/actions/computer-use/live-acceptance-bundle.js';
import type { WorkEvidence } from '../gateway/work-evidence-types.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import type { AgentHostGroundingSnapshot } from './agent-cli-adapter.js';
import { completionTruthFromPackageBridgeWorkEvidence } from './agent-host-package-bridge-completion-truth.js';

const TOOL_ID = 'codex-agent-host-turn-loop';
const RUNTIME_GUI_COMPONENT_ID = 'runtime-gui';
const BROWSER_EVIDENCE_DOMAIN = taskProjectSkillDomain(undefined);

export interface CodexAgentHostTurnLoopResult {
  event: NormalizedAgentEvent;
  result: Record<string, unknown>;
}

export interface CodexAgentHostComputerUseActMaterializerInput {
  agentHostInput: NormalizedCodexAgentHostInput;
  preflight: ComputerUsePreflightResult;
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  refreshRuntimeTruth?: CodexAgentHostRuntimeTruthRefresh;
  abortSignal?: AbortSignal;
}

export interface CodexAgentHostComputerUseActMaterializerResult {
  status: 'completed' | 'blocked' | 'needs-confirmation';
  message: string;
  evidenceRefs: string[];
  confidence?: number;
  claimType?: string;
  reasoningTrace?: string;
  artifacts?: Array<Record<string, unknown>>;
  uiManifest?: Array<Record<string, unknown>>;
  executionUnits?: Array<Record<string, unknown>>;
  claims?: Array<Record<string, unknown>>;
  workEvidence?: Array<WorkEvidence | Record<string, unknown>>;
  completionTruth?: CodexAgentHostComputerUseCompletionTruth;
}

export interface CodexAgentHostComputerUseCompletionTruth {
  schemaVersion: 'sciforge.computer-use.completion-truth.v1';
  scope: 'action' | 'user-task' | 'workflow';
  status: 'satisfied' | 'blocked' | 'needs-confirmation';
  evidenceRefs: string[];
  validator?: string;
  currentRun?: {
    runDirRef?: string;
    acceptanceManifestRef?: string;
    completionEvidenceRef?: string;
  };
  reason?: string;
}

export type CodexAgentHostComputerUseActMaterializer =
  (input: CodexAgentHostComputerUseActMaterializerInput) =>
    Promise<CodexAgentHostComputerUseActMaterializerResult | undefined> | CodexAgentHostComputerUseActMaterializerResult | undefined;

export type CodexAgentHostRuntimeTruthRefresh =
  (input: {
    step: number;
    previousResult?: CodexAgentHostComputerUseActMaterializerResult;
  }) => Promise<CodexAgentHostRuntimeTruth | undefined> | CodexAgentHostRuntimeTruth | undefined;

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

export async function evaluateCodexAgentHostTurnLoop(input: {
  input: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  runtimeTruthRefresh?: CodexAgentHostRuntimeTruthRefresh;
  computerUseActMaterializer?: CodexAgentHostComputerUseActMaterializer;
  abortSignal?: AbortSignal;
}): Promise<CodexAgentHostTurnLoopResult | undefined> {
  const agentHostInput = normalizeAgentHostInput(input.input);
  if (!agentHostInput) return undefined;
  const commandId = input.commandId ?? 'codex-command-agent-host';
  const attemptId = input.attemptId ?? `${commandId}-attempt-1`;
  const ground = groundAgentHostInput(agentHostInput);
  const authorizationResolution = authorizationProfileOrDefault(agentHostInput.authorizationProfileId);
  const authorizationProfile = authorizationResolution.profile;
  const metadata = baseEventMetadata({ ...input, commandId, attemptId });
  const semanticPrompt = agentHostInput.intentText ?? input.commandText;
  const runtimeRequest = {
    skillDomain: BROWSER_EVIDENCE_DOMAIN,
    prompt: semanticPrompt,
    workspacePath: input.workspacePath,
    artifacts: [],
    references: agentHostInput.refs.map((ref) => ({ ref })),
    uiState: {},
  };

  if (authorizationResolution.source === 'declared-invalid-profile') {
    const invalidProfileId = agentHostInput.authorizationProfileId ?? 'unknown';
    const id = sha1(JSON.stringify({ invalidProfileId, commandId })).slice(0, 12);
    const message = `Invalid Autonomy profile "${invalidProfileId}" is blocked; Agent Host did not silently fall back to High Autonomy.`;
    const artifact = {
      id: `agent-host-invalid-autonomy-${id}`,
      type: 'runtime-diagnostic',
      schemaVersion: 'sciforge.runtime-diagnostic.v1',
      metadata: {
        source: TOOL_ID,
        status: 'blocked',
        profileResolution: authorizationResolution.source,
      },
      data: {
        message,
        invalidProfileId,
        profileResolution: authorizationResolution.source,
        fallbackProfileId: authorizationProfile.id,
      },
    };
    return {
      event: {
        ...metadata,
        type: 'audit',
        status: 'agent-host-turn-loop',
        message,
        raw: {
          schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
          stage: 'Guard',
          ground,
          invalidProfileId,
          profileResolution: authorizationResolution.source,
        },
      },
      result: structuredResult({
        commandId,
        message,
        confidence: 0.9,
        claimType: 'runtime-diagnostic',
        evidenceLevel: 'runtime',
        reasoningTrace: 'SciForge Agent Host rejected an unregistered explicit Autonomy profile and failed closed before downstream runtime dispatch.',
        status: 'blocked',
        artifacts: [artifact],
        uiManifest: [{
          componentId: RUNTIME_GUI_COMPONENT_ID,
          artifactRef: artifact.id,
          title: 'Invalid Autonomy profile',
          priority: 1,
        }],
        executionUnits: [{
          id: `EU-agent-host-invalid-autonomy-${id}`,
          tool: TOOL_ID,
          status: 'failed-with-reason',
          params: JSON.stringify({ invalidProfileId, profileResolution: authorizationResolution.source }),
          failureReason: message,
          outputRef: `artifact:${artifact.id}`,
          hash: id,
        }],
        claims: [{
          id: `claim-agent-host-invalid-autonomy-${id}`,
          type: 'diagnostic',
          text: message,
          confidence: 0.9,
          evidenceLevel: 'runtime',
          supportingRefs: agentHostInput.refs,
          opposingRefs: [],
        }],
        evidenceRefs: agentHostInput.refs,
      }),
    };
  }

  const clarificationPayload = tryRunRequestClarificationRuntime(runtimeRequest);
  if (clarificationPayload) {
    const message = clarificationPayload.message;
    return {
      event: {
        ...metadata,
        type: 'audit',
        status: 'agent-host-turn-loop',
        message,
        raw: {
          schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
          stage: 'Clarify',
          ground,
          selectedRuntime: 'request-clarification-runtime',
        },
      },
      result: structuredResult({
        commandId,
        message,
        confidence: clarificationPayload.confidence ?? 0.6,
        claimType: clarificationPayload.claimType,
        evidenceLevel: 'request-understanding',
        reasoningTrace: clarificationPayload.reasoningTrace,
        status: browserPayloadStatus(clarificationPayload.displayIntent),
        artifacts: clarificationPayload.artifacts ?? [],
        uiManifest: clarificationPayload.uiManifest ?? [],
        executionUnits: clarificationPayload.executionUnits ?? [],
        claims: clarificationPayload.claims ?? [],
        evidenceRefs: evidenceRefsFromToolPayload(clarificationPayload),
      }),
    };
  }

  if (ground.intent === 'capability-question' && (ground.capability === 'computer-use' || ground.capability === 'browser')) {
    const readiness = readinessFromInput(agentHostInput, input.runtimeTruth);
    const projection = capabilityAnswerProjection({
      capability: ground.capability,
      readiness,
      refs: refsFromInput(agentHostInput, input.runtimeTruth),
    });
    const id = sha1(JSON.stringify({ capability: ground.capability, readiness, commandId })).slice(0, 12);
    const artifact = {
      id: `capability-answer-${id}`,
      type: 'runtime-capability-answer',
      schemaVersion: projection.schemaVersion,
      metadata: {
        source: TOOL_ID,
        capability: ground.capability,
        runtimeReadiness: projection.runtimeReadiness,
      },
      data: projection,
    };
    return {
      event: {
        ...metadata,
        type: 'audit',
        status: 'agent-host-turn-loop',
        message: projection.answerSummary,
        raw: {
          schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
          stage: 'Act / Answer',
          ground,
          runtimeReadiness: projection.runtimeReadiness,
          blockers: projection.blockers,
        },
      },
      result: structuredResult({
        commandId,
        message: projection.answerSummary,
        confidence: 0.78,
        claimType: 'runtime-diagnostic',
        evidenceLevel: 'runtime',
        reasoningTrace: 'SciForge answered capability status from Codex Agent Host Turn Loop grounded capability readiness.',
        status: projection.runtimeReadiness === 'ready' ? 'completed' : 'blocked',
        artifacts: [artifact],
        uiManifest: [{
          componentId: RUNTIME_GUI_COMPONENT_ID,
          artifactRef: artifact.id,
          title: 'Runtime capability answer',
          priority: 1,
        }],
        executionUnits: [{
          id: `EU-capability-answer-${id}`,
          tool: TOOL_ID,
          status: projection.runtimeReadiness === 'ready' ? 'done' : 'failed-with-reason',
          params: JSON.stringify({ capability: ground.capability }),
          failureReason: projection.blockers.length ? projection.blockers.join(', ') : undefined,
          outputRef: `artifact:${artifact.id}`,
          hash: id,
        }],
        claims: [{
          id: `claim-capability-answer-${id}`,
          type: 'diagnostic',
          text: projection.answerSummary,
          confidence: 0.78,
          evidenceLevel: 'runtime',
          supportingRefs: projection.refs,
          opposingRefs: [],
        }],
        evidenceRefs: projection.refs,
      }),
    };
  }

  if (ground.intent === 'gui-operation') {
    const readiness = readinessFromInput(agentHostInput, input.runtimeTruth);
    const preflight = evaluateComputerUsePreflight({
      intent: input.commandText,
      target: targetFromInput(agentHostInput, input.runtimeTruth),
      readiness,
      observation: observationFromInput(agentHostInput, input.runtimeTruth),
      permissions: permissionsFromInput(agentHostInput, input.runtimeTruth),
      authorizationProfile,
    });
    if (preflight.status === 'ready' && input.computerUseActMaterializer) {
      const materialized = await gateComputerUseProductCompletionClaim(sanitizeComputerUseActMaterializerResult(await input.computerUseActMaterializer({
        agentHostInput,
        preflight,
        commandText: input.commandText,
        workspacePath: input.workspacePath,
        commandId,
        attemptId,
        runtimeTruth: input.runtimeTruth,
        refreshRuntimeTruth: input.runtimeTruthRefresh,
        abortSignal: input.abortSignal,
      })), {
        commandText: input.commandText,
        commandId,
        attemptId,
        workspacePath: input.workspacePath,
      });
      const actBlocked = !materialized;
      const message = materialized?.message
        ?? 'Computer Use Act materializer blocked: result did not include runtime-owned action evidence refs.';
      return {
        event: {
          ...metadata,
          type: 'audit',
          status: 'agent-host-turn-loop',
          message,
          raw: {
            schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
            stage: 'Act / Answer',
            ground,
            status: materialized?.status ?? 'blocked',
            preflightStatus: preflight.status,
          },
        },
        result: structuredResult({
          commandId,
          message,
          confidence: materialized?.confidence ?? (actBlocked ? 0.7 : 0.82),
          claimType: materialized?.claimType ?? (actBlocked ? 'runtime-diagnostic' : 'runtime-action'),
          evidenceLevel: 'runtime',
          reasoningTrace: materialized?.reasoningTrace
            ?? (actBlocked
              ? 'SciForge rejected a Computer Use Act materializer result that lacked runtime-owned action evidence.'
              : 'SciForge routed ready Computer Use Guard output into an injected runtime-owned Act materializer.'),
          status: materialized?.status ?? 'blocked',
          artifacts: materialized?.artifacts ?? [],
          uiManifest: materialized?.uiManifest ?? [],
          executionUnits: materialized?.executionUnits ?? [],
          claims: materialized?.claims ?? [],
          evidenceRefs: materialized?.evidenceRefs ?? [],
          completionTruth: materialized?.completionTruth,
        }),
      };
    }
    const id = sha1(JSON.stringify({ commandText: input.commandText, preflight, commandId })).slice(0, 12);
    const blockers = preflight.blockers.map((item) => item.reason).join(', ');
    const resultStatus = preflight.status === 'ready' ? 'ready-for-act' : preflight.status;
    const message = preflight.status === 'ready'
      ? `Computer Use Guard is ready for ${preflight.target.summary}; Act is waiting for a refs-first action runner/materializer.`
      : preflight.status === 'needs-confirmation'
        ? `Computer Use requires hard confirmation before acting on ${preflight.target.summary}: ${preflight.risk.reason}.`
        : `Computer Use Guard blocked: ${blockers}. ${preflight.blockers[0]?.recovery ?? 'Repair blockers and retry.'}`;
    const artifact = {
      id: `computer-use-preflight-${id}`,
      type: 'computer-use-preflight',
      schemaVersion: preflight.schemaVersion,
      metadata: {
        source: TOOL_ID,
        status: resultStatus,
        authorizationProfile: preflight.authorizationProfile.id,
      },
      data: preflight,
    };
    return {
      event: {
        ...metadata,
        type: 'audit',
        status: 'agent-host-turn-loop',
        message,
        raw: {
          schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
          stage: 'Guard',
          ground,
          status: resultStatus,
          preflightStatus: preflight.status,
          blockers: preflight.blockers.map((item) => item.reason),
        },
      },
      result: structuredResult({
        commandId,
        message,
        confidence: preflight.status === 'ready' ? 0.82 : 0.7,
        claimType: preflight.status === 'ready' ? 'runtime-readiness' : 'runtime-diagnostic',
        evidenceLevel: 'runtime',
        reasoningTrace: 'SciForge routed GUI-operation intent through Codex Agent Host Computer Use Guard and failed closed when readiness, target, observation, permission, or cancel path was missing.',
        status: resultStatus,
        artifacts: [artifact],
        uiManifest: [{
          componentId: RUNTIME_GUI_COMPONENT_ID,
          artifactRef: artifact.id,
          title: preflight.confirmation ? 'Computer Use confirmation' : 'Computer Use Guard',
          priority: 1,
        }],
        executionUnits: [{
          id: `EU-computer-use-preflight-${id}`,
          tool: TOOL_ID,
          status: preflight.status === 'ready' ? 'ready-for-act' : preflight.status === 'needs-confirmation' ? 'needs-human' : 'failed-with-reason',
          params: JSON.stringify({ authorizationProfile: preflight.authorizationProfile.id }),
          failureReason: preflight.status === 'blocked' ? blockers : undefined,
          outputRef: `artifact:${artifact.id}`,
          hash: id,
        }],
        claims: [{
          id: `claim-computer-use-preflight-${id}`,
          type: 'diagnostic',
          text: message,
          confidence: 0.7,
          evidenceLevel: 'runtime',
          supportingRefs: preflight.evidenceRefs,
          opposingRefs: [],
        }],
        evidenceRefs: preflight.evidenceRefs,
      }),
    };
  }

  if (ground.intent === 'browser-evidence') {
    const payload = await tryRunBrowserHostSearchRuntime(runtimeRequest);
    if (!payload) return undefined;
    const message = payload.message;
    return {
      event: {
        ...metadata,
        type: 'audit',
        status: 'agent-host-turn-loop',
        message,
        raw: {
          schemaVersion: 'sciforge.codex-agent-host-turn-loop.audit.v1',
          stage: 'Act / Answer',
          ground,
          selectedRuntime: 'browser-host-search-runtime',
        },
      },
      result: structuredResult({
        commandId,
        message,
        confidence: payload.confidence ?? 0.6,
        claimType: payload.claimType,
        evidenceLevel: 'runtime',
        reasoningTrace: payload.reasoningTrace,
        status: browserPayloadStatus(payload.displayIntent),
        artifacts: payload.artifacts ?? [],
        uiManifest: payload.uiManifest ?? [],
        executionUnits: payload.executionUnits ?? [],
        claims: payload.claims ?? [],
        evidenceRefs: evidenceRefsFromToolPayload(payload),
      }),
    };
  }

  return undefined;
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
    permissions.stopCancelPath ? undefined : 'cancel-path-missing',
  ].filter((value): value is string => Boolean(value));
  return {
    schemaVersion: 'sciforge.agent-host.grounding-snapshot.v1',
    source: TOOL_ID,
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

function browserPayloadStatus(displayIntent: unknown) {
  if (!isRecord(displayIntent)) return 'completed';
  const status = stringField(displayIntent.status);
  return status ?? 'completed';
}

function evidenceRefsFromToolPayload(payload: {
  claims?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  objectReferences?: Array<Record<string, unknown>>;
}) {
  return [
    ...(payload.claims ?? []).flatMap((claim) => stringList(claim.supportingRefs)),
    ...(payload.artifacts ?? []).flatMap((artifact) => {
      const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
      return [
        stringField(metadata.searchResultRef),
        stringField(metadata.browserSessionRef),
        stringField(metadata.projectionRef),
      ];
    }),
    ...(payload.objectReferences ?? []).flatMap((reference) => {
      const provenance = isRecord(reference.provenance) ? reference.provenance : {};
      return [
        stringField(reference.ref),
        stringField(provenance.dataRef),
        stringField(provenance.browserSessionRef),
        stringField(provenance.projectionRef),
      ];
    }),
  ].filter((ref): ref is string => Boolean(ref)).slice(0, 24);
}

function sanitizeComputerUseActMaterializerResult(
  value: CodexAgentHostComputerUseActMaterializerResult | undefined,
): CodexAgentHostComputerUseActMaterializerResult | undefined {
  if (!value) return undefined;
  const evidenceRefs = stringList(value.evidenceRefs).filter(runtimeOwnedActEvidenceRef);
  if (!evidenceRefs.length) return undefined;
  const completionTruth = sanitizeComputerUseCompletionTruth(value.completionTruth)
    ?? completionTruthFromPackageBridgeWorkEvidence({
      evidenceRefs,
      workEvidence: value.workEvidence,
    });
  return {
    status: value.status === 'completed' || value.status === 'needs-confirmation' ? value.status : 'blocked',
    message: stringField(value.message) ?? 'Computer Use Act materializer returned runtime-owned evidence.',
    evidenceRefs,
    ...(typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? { confidence: Math.min(Math.max(value.confidence, 0), 1) } : {}),
    ...(stringField(value.claimType) ? { claimType: stringField(value.claimType) } : {}),
    ...(stringField(value.reasoningTrace) ? { reasoningTrace: stringField(value.reasoningTrace) } : {}),
    artifacts: safeActMaterializerRecords(value.artifacts),
    uiManifest: safeActMaterializerRecords(value.uiManifest),
    executionUnits: safeActMaterializerRecords(value.executionUnits),
    claims: safeActMaterializerRecords(value.claims),
    ...(completionTruth ? { completionTruth } : {}),
  };
}

async function gateComputerUseProductCompletionClaim(
  value: CodexAgentHostComputerUseActMaterializerResult | undefined,
  input: {
    commandText: string;
    commandId: string;
    attemptId: string;
    workspacePath: string;
  },
): Promise<CodexAgentHostComputerUseActMaterializerResult | undefined> {
  if (!value || value.status !== 'completed') return value;
  const requiresCompletionTruthValidation = requiresUserLevelCompletionTruthValidation(value.completionTruth);
  if (requiresCompletionTruthValidation && value.completionTruth?.status !== 'satisfied') {
    return blockedComputerUseCompletionResult(value, {
      input,
      validation: {
        status: 'invalid',
        issues: [`completion-truth: user-level completion truth status is ${value.completionTruth?.status ?? 'missing'}, not satisfied.`],
        missingRefs: ['cu-user-acceptance-manifest.json'],
      },
      refs: value.evidenceRefs,
    });
  }
  if (!requiresCompletionTruthValidation && !requiresComputerUseProductCompletionEvidence({
    commandText: input.commandText,
    message: value.message,
    claimType: value.claimType,
    claimTexts: (value.claims ?? []).flatMap((claim) => [
      stringField(claim.type),
      stringField(claim.text),
    ]).filter((item): item is string => Boolean(item)),
    executionUnitTexts: (value.executionUnits ?? []).flatMap((unit) => [
      stringField(unit.tool),
      stringField(unit.status),
    ]).filter((item): item is string => Boolean(item)),
  })) return value;

  const refs = uniqueStrings([
    ...value.evidenceRefs,
    ...(value.completionTruth?.evidenceRefs ?? []),
  ]);
  const validation = await validateComputerUseProductCompletionBundle({
    workspacePath: input.workspacePath,
    refs,
  });
  if (validation.status === 'valid') {
    return requiresCompletionTruthValidation
      ? attachValidatedComputerUseCompletionTruth(value, validation)
      : value;
  }

  return blockedComputerUseCompletionResult(value, { input, validation, refs });
}

function blockedComputerUseCompletionResult(
  value: CodexAgentHostComputerUseActMaterializerResult,
  options: {
    input: {
      commandText: string;
      commandId: string;
      attemptId: string;
    };
    validation: CuNextLiveAcceptanceBundleValidation;
    refs: string[];
  },
): CodexAgentHostComputerUseActMaterializerResult {
  const id = sha1(JSON.stringify({
    commandText: options.input.commandText,
    commandId: options.input.commandId,
    attemptId: options.input.attemptId,
    evidenceRefs: options.refs,
    completionValidation: options.validation.status,
  })).slice(0, 12);
  const issueSummary = options.validation.issues.slice(0, 3).map(boundedDiagnosticText).join(' ');
  const message = [
    'Computer Use action evidence is runtime-owned, but product workflow completion is blocked: missing or invalid current-run completion evidence.',
    issueSummary || 'A validated current-run Computer Use acceptance bundle is required before claiming workflow completion.',
  ].join(' ');
  return {
    ...value,
    status: 'blocked',
    message,
    confidence: Math.min(value.confidence ?? 0.7, 0.69),
    claimType: 'runtime-diagnostic',
    reasoningTrace: 'SciForge blocked a multi-step product completion claim because single-step action evidence cannot substitute for validated current-run workflow completion evidence.',
    executionUnits: [
      ...(value.executionUnits ?? []),
      {
        id: `EU-product-completion-gate-${id}`,
        tool: TOOL_ID,
        status: 'failed-with-reason',
        failureReason: message,
        outputRef: `runtime-truth:product-completion-validator/${id}`,
        hash: id,
      },
    ],
    claims: [
      ...(value.claims ?? []),
      {
        id: `claim-product-completion-gate-${id}`,
        type: 'diagnostic',
        text: message,
        confidence: 0.69,
        evidenceLevel: 'runtime',
        supportingRefs: validationEvidenceRefs(options.validation, options.refs),
        opposingRefs: [`runtime-truth:invalid-current-run-completion-evidence/${options.validation.status}`],
      },
    ],
    ...(value.completionTruth ? {
      completionTruth: {
        schemaVersion: 'sciforge.computer-use.completion-truth.v1',
        scope: value.completionTruth.scope,
        status: 'blocked',
        evidenceRefs: value.completionTruth.evidenceRefs,
        validator: 'current-run-live-acceptance-bundle',
        reason: message,
      },
    } satisfies Pick<CodexAgentHostComputerUseActMaterializerResult, 'completionTruth'> : {}),
  };
}

function requiresUserLevelCompletionTruthValidation(value: CodexAgentHostComputerUseCompletionTruth | undefined): boolean {
  return value?.scope === 'user-task' || value?.scope === 'workflow';
}

function attachValidatedComputerUseCompletionTruth(
  value: CodexAgentHostComputerUseActMaterializerResult,
  validation: CuNextLiveAcceptanceBundleValidation,
): CodexAgentHostComputerUseActMaterializerResult {
  if (!value.completionTruth) return value;
  return {
    ...value,
    completionTruth: {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: value.completionTruth.scope,
      status: 'satisfied',
      validator: 'current-run-live-acceptance-bundle',
      evidenceRefs: value.completionTruth.evidenceRefs,
      currentRun: {
        ...(validation.runDirRef ? { runDirRef: validation.runDirRef } : {}),
        ...(validation.acceptanceManifestRef ? { acceptanceManifestRef: validation.acceptanceManifestRef } : {}),
        ...(validation.runDirRef && validation.completionEvidenceRef
          ? { completionEvidenceRef: `${validation.runDirRef}/${validation.completionEvidenceRef}` }
          : {}),
      },
    },
  };
}

async function validateComputerUseProductCompletionBundle(input: {
  workspacePath: string;
  refs: string[];
}): Promise<CuNextLiveAcceptanceBundleValidation> {
  try {
    return await validateCurrentRunLiveAcceptanceBundle(input);
  } catch (error) {
    return {
      status: 'invalid',
      issues: [`completion-grade: current-run completion validator failed closed: ${boundedDiagnosticText(error)}`],
      missingRefs: ['cu-user-acceptance-manifest.json'],
    };
  }
}

function validationEvidenceRefs(
  validation: CuNextLiveAcceptanceBundleValidation,
  fallbackRefs: string[],
): string[] {
  return [
    validation.acceptanceManifestRef,
    validation.runDirRef && validation.completionEvidenceRef
      ? `${validation.runDirRef}/${validation.completionEvidenceRef}`
      : undefined,
    ...fallbackRefs,
  ].filter((ref): ref is string => Boolean(ref)).slice(0, 16);
}

function sanitizeComputerUseCompletionTruth(value: unknown): CodexAgentHostComputerUseCompletionTruth | undefined {
  if (!isRecord(value)) return undefined;
  const scope = completionTruthScope(value.scope);
  if (!scope) return undefined;
  const evidenceRefs = stringList(value.evidenceRefs).filter(runtimeOwnedActEvidenceRef);
  const status = value.status === 'satisfied' || value.status === 'needs-confirmation'
    ? value.status
    : 'blocked';
  const validator = safeCompletionTruthValidator(value.validator);
  const reason = safeCompletionTruthReason(value.reason);
  return {
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope,
    status,
    evidenceRefs,
    ...(validator ? { validator } : {}),
    ...(reason ? { reason } : {}),
  };
}

function completionTruthScope(value: unknown): CodexAgentHostComputerUseCompletionTruth['scope'] | undefined {
  return value === 'action' || value === 'user-task' || value === 'workflow' ? value : undefined;
}

function safeCompletionTruthValidator(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text || text.length > 80) return undefined;
  if (!/^[A-Za-z0-9._:-]+$/u.test(text)) return undefined;
  if (unsafeDiagnosticText(text)) return undefined;
  return text;
}

function safeCompletionTruthReason(value: unknown): string | undefined {
  const text = stringField(value);
  if (!text || unsafeDiagnosticText(text)) return undefined;
  return boundedDiagnosticText(text);
}

function unsafeDiagnosticText(value: string): boolean {
  return /https?:\/\/|data:image|base64|<html|raw\b|payload\b|secret|token|password|api[-_]?key|bearer/i.test(value);
}

function boundedDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function safeActMaterializerRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((record) => !actMaterializerRecordUnsafe(record))
    .slice(0, 16);
}

function actMaterializerRecordUnsafe(value: unknown): boolean {
  if (typeof value === 'string') return /^(?:gui(?:\.|:)|ui:|fixture:|replay:)/i.test(value)
    || /https?:\/\/|data:image|base64|secret|token|password|api[-_]?key|bearer/i.test(value);
  if (Array.isArray(value)) return value.some(actMaterializerRecordUnsafe);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => /raw|payload|secret|token|password|api[-_]?key/i.test(key) || actMaterializerRecordUnsafe(entry));
}

function runtimeOwnedActEvidenceRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:)/i.test(trimmed)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(trimmed)) return false;
  if (/^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(trimmed) && !trimmed.includes('..')) return true;
  return /^(?:browser-host-session:|window-action-session:|computer-use:|native-host:|action-ledger:|evidence:|workEvidence:|runtime-truth:|permission:|cancel:|adapter-registry:|desktop-native:)/i.test(trimmed);
}

function structuredResult(input: {
  commandId: string;
  message: string;
  confidence: number;
  claimType: string;
  evidenceLevel: string;
  reasoningTrace: string;
  status: string;
  artifacts: Array<Record<string, unknown>>;
  uiManifest: Array<Record<string, unknown>>;
  executionUnits: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown>>;
  evidenceRefs: string[];
  completionTruth?: CodexAgentHostComputerUseCompletionTruth;
}) {
  return {
    type: 'done',
    status: input.status === 'blocked' ? 'failed' : 'done',
    commandId: input.commandId,
    message: input.message,
    confidence: input.confidence,
    claimType: input.claimType,
    evidenceLevel: input.evidenceLevel,
    reasoningTrace: input.reasoningTrace,
    displayIntent: {
      protocolStatus: input.status === 'completed' ? 'protocol-success' : input.status === 'ready-for-act' || input.status === 'needs-confirmation' ? 'protocol-paused' : 'protocol-blocked',
      taskOutcome: input.status === 'completed' ? 'satisfied' : 'needs-work',
      status: input.status,
    },
    claims: input.claims,
    uiManifest: input.uiManifest,
    executionUnits: input.executionUnits,
    artifacts: input.artifacts,
    evidenceRefs: input.evidenceRefs,
    ...(input.completionTruth ? { completionTruth: input.completionTruth } : {}),
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

function groundAgentHostInput(input: NormalizedCodexAgentHostInput) {
  const prompt = input.intentText ?? '';
  const capability = defaultCapabilityQuestion(prompt);
  if (capability) return { intent: 'capability-question', capability };
  if (defaultGuiOperationIntent({ prompt })) return { intent: 'gui-operation' };
  const browserEvidence = evaluateBrowserEvidenceNeed({ prompt });
  if (browserEvidence.decision === 'search') return { intent: 'browser-evidence', browserEvidence };
  return { intent: 'answer' };
}

function baseEventMetadata(input: {
  commandText: string;
  workspacePath: string;
  commandId: string;
  attemptId: string;
}) {
  return {
    schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
    timestamp: new Date().toISOString(),
    provider: 'sciforge-agent-host',
    model: 'codex-agent-host-turn-loop',
    profile: 'sciforge-runtime-default',
    workspace: input.workspacePath,
    commandId: input.commandId,
    attemptId: input.attemptId,
    evidenceRefs: [`audit:codex-agent-host-turn-loop:${input.commandId}:${input.attemptId}`],
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
      stopCancelPath: runtimeTruth.permissions.stopCancelPath === true,
    };
  }
  return {
    refs: [
      ...stringList(input.permissions.refs),
      ...stringList(input.permissions.permissionRefs),
      ...stringList(input.permissions.evidenceRefs),
    ],
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
