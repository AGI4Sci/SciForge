import { sha1 } from '../workspace-task-runner.js';
import { tryRunRequestClarificationRuntime } from '../request-clarification-runtime.js';
import { taskProjectSkillDomain } from '../../../packages/contracts/runtime/handoff.js';
import {
  authorizationProfileOrDefault,
  capabilityAnswerProjection,
  defaultCapabilityQuestion,
  defaultGuiOperationIntent,
  evaluateComputerUsePreflight,
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
import {
  generateOnePagePresentationArtifact,
  isOnePagePresentationArtifactRequest,
} from './agent-host-artifact-generator.js';

const TOOL_ID = 'codex-agent-host-turn-loop';
const RUNTIME_GUI_COMPONENT_ID = 'runtime-gui';
const AGENT_HOST_SKILL_DOMAIN = taskProjectSkillDomain(undefined);

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

type CodexAgentHostCompletionTruth = CodexAgentHostComputerUseCompletionTruth;

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
    observedAt?: string;
    capturedAt?: string;
    freshnessCheckedAt?: string;
    freshnessCheck?: {
      status?: string;
      observedAt?: string;
      checkedAt?: string;
      maxAgeMs?: number;
    };
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

export interface CodexAgentHostTurnLoopInput {
  input: unknown;
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  auditMetadata?: unknown;
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
  runtimeTruth?: CodexAgentHostRuntimeTruth;
  runtimeTruthRefresh?: CodexAgentHostRuntimeTruthRefresh;
  computerUseActMaterializer?: CodexAgentHostComputerUseActMaterializer;
  abortSignal?: AbortSignal;
}

export async function evaluateCodexAgentHostTurnLoop(input: CodexAgentHostTurnLoopInput): Promise<CodexAgentHostTurnLoopResult | undefined> {
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
    skillDomain: AGENT_HOST_SKILL_DOMAIN,
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

  if (isOnePagePresentationArtifactRequest(semanticPrompt)) {
    const generated = await generateOnePagePresentationArtifact({
      workspacePath: input.workspacePath,
      commandId,
      attemptId,
      prompt: semanticPrompt,
    });
    const id = sha1(JSON.stringify({
      commandId,
      artifactRef: generated.artifactRef,
      validatorRef: generated.validatorRef,
    })).slice(0, 12);
    const message = `Created a one-page PPT artifact at ${generated.artifactRef}. Validator result: ${generated.validatorRef}.`;
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
          selectedRuntime: 'agent-host-artifact-generator',
          artifactRef: generated.artifactRef,
          validatorRef: generated.validatorRef,
        },
      },
      result: structuredResult({
        commandId,
        message,
        confidence: 0.86,
        claimType: 'artifact-generation',
        evidenceLevel: 'runtime',
        reasoningTrace: 'Codex Agent Host selected the artifact path for a presentation request and completed user-level acceptance with final artifact and validator refs; Computer Use did not assert completion.',
        status: 'completed',
        artifacts: [generated.artifact, generated.validatorArtifact],
        uiManifest: [{
          componentId: RUNTIME_GUI_COMPONENT_ID,
          artifactRef: generated.artifactRef,
          title: generated.title,
          priority: 1,
        }],
        executionUnits: [{
          id: `EU-agent-host-presentation-artifact-${id}`,
          tool: 'agent-host-artifact-generator',
          status: 'done',
          params: JSON.stringify({ format: 'pptx', slideCount: 1 }),
          outputRef: generated.artifactRef,
          hash: id,
        }, {
          id: `EU-agent-host-presentation-validator-${id}`,
          tool: 'agent-host-artifact-validator',
          status: 'done',
          params: JSON.stringify({ validatorRef: generated.validatorRef }),
          outputRef: generated.validatorRef,
          hash: sha1(`${id}:validator`).slice(0, 12),
        }],
        claims: [{
          id: `claim-agent-host-presentation-artifact-${id}`,
          type: 'artifact',
          text: message,
          confidence: 0.86,
          evidenceLevel: 'runtime',
          supportingRefs: generated.evidenceRefs,
          opposingRefs: [],
        }],
        evidenceRefs: generated.evidenceRefs,
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'user-task',
          status: 'satisfied',
          validator: 'sciforge-agent-host-one-page-pptx-validator',
          evidenceRefs: generated.evidenceRefs,
          currentRun: {
            runDirRef: generated.artifactRef.replace(/\/[^/]+$/, ''),
            completionEvidenceRef: generated.validatorRef,
          },
        },
      }),
    };
  }

  if (ground.intent === 'gui-operation') {
    const readiness = readinessFromInput(agentHostInput, input.runtimeTruth);
    const guiActionIntent = semanticPrompt;
    const permissions = permissionsFromInput(agentHostInput, input.runtimeTruth);
    const preflight = withAgentHostComputerUseRuntimeGuards(evaluateComputerUsePreflight({
      intent: guiActionIntent,
      target: targetFromInput(agentHostInput, input.runtimeTruth),
      readiness,
      observation: observationFromInput(agentHostInput, input.runtimeTruth),
      permissions,
      authorizationProfile,
    }), { permissions });
    const approval = computerUseGuiApprovalForPreflight({
      preflight,
      humanApproval: input.humanApproval,
      uiState: input.uiState,
    });
    const executablePreflight = approval.approved && preflight.status === 'needs-confirmation'
      ? confirmedComputerUsePreflight(preflight, approval)
      : preflight;
    if (executablePreflight.status === 'ready' && input.computerUseActMaterializer) {
      const materialized = await gateComputerUseProductCompletionClaim(sanitizeComputerUseActMaterializerResult(await input.computerUseActMaterializer({
        agentHostInput,
        preflight: executablePreflight,
        commandText: guiActionIntent,
        workspacePath: input.workspacePath,
        commandId,
        attemptId,
        runtimeTruth: input.runtimeTruth,
        refreshRuntimeTruth: input.runtimeTruthRefresh,
        abortSignal: input.abortSignal,
      }), { commandText: guiActionIntent }), {
        commandText: guiActionIntent,
        commandId,
        attemptId,
        workspacePath: input.workspacePath,
      });
      const completionTruthSatisfied = materialized?.completionTruth?.status === 'satisfied';
      const productCompletionValidated = materialized?.status === 'completed' && requiresComputerUseProductCompletionEvidence({
        commandText: guiActionIntent,
        message: materialized.message,
        claimType: materialized.claimType,
        claimTexts: (materialized.claims ?? []).map((claim) => stringField(claim.text)).filter((text): text is string => Boolean(text)),
        executionUnitTexts: (materialized.executionUnits ?? []).map((unit) => stringField(unit.status) ?? stringField(unit.tool)).filter((text): text is string => Boolean(text)),
      });
      const evidenceCheck = completionTruthSatisfied || productCompletionValidated
        ? { ok: true, reason: 'validated completion truth is satisfied' }
        : computerUseActMaterializerEvidenceCheck(materialized);
      const completed = materialized?.status === 'completed' && evidenceCheck.ok;
      const status = completed
        ? 'completed'
        : materialized?.status === 'needs-confirmation'
          ? 'needs-confirmation'
          : 'blocked';
      const actBlocked = status === 'blocked';
      const message = completed
        ? completionTruthSatisfied
          ? materialized.message
          : `Computer Use Act materializer completed the local GUI action with current target-bound action evidence refs: ${materialized.evidenceRefs.slice(0, 6).join(', ')}.`
        : materialized
          ? `Computer Use Act materializer is ${materialized.status}: ${materialized.status === 'completed' ? evidenceCheck.reason : materialized.message}.`
          : 'Computer Use Act materializer blocked: result did not include runtime-owned action evidence refs.';
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
            status,
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
          status,
          artifacts: materialized?.artifacts ?? [],
          uiManifest: materialized?.uiManifest ?? [],
          executionUnits: materialized?.executionUnits ?? [],
          claims: materialized?.claims ?? [],
          evidenceRefs: materialized?.evidenceRefs ?? [],
          completionTruth: materialized?.completionTruth,
        }),
      };
    }
    const id = sha1(JSON.stringify({ commandText: guiActionIntent, preflight, commandId })).slice(0, 12);
    const approvalRef = computerUseApprovalRefForPreflight(preflight, id);
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
        ...(preflight.status === 'needs-confirmation' ? { approvalRef } : {}),
      },
      data: preflight.status === 'needs-confirmation'
        ? preflightWithApprovalRef(preflight, approvalRef)
        : preflight,
    };
    const askUser = preflight.status === 'needs-confirmation'
      ? computerUseConfirmationAskUser({ preflight, approvalRef, artifactId: artifact.id, commandId, attemptId })
      : undefined;
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
          ...(askUser ? { askUser } : {}),
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
          ...(approvalRef && preflight.status === 'needs-confirmation' ? { approvalRef } : {}),
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
    permissions.scopedExecutorRefs?.length ? undefined : 'scoped-executor-missing',
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

function withAgentHostComputerUseRuntimeGuards(
  preflight: ComputerUsePreflightResult,
  input: { permissions: ReturnType<typeof permissionsFromInput> },
): ComputerUsePreflightResult {
  const scopedExecutorRefs = input.permissions.scopedExecutorRefs;
  if (!Array.isArray(scopedExecutorRefs) || scopedExecutorRefs.length > 0) return preflight;
  const scopedExecutorBlocker = {
    reason: 'scoped-executor-missing',
    recovery: 'Provide a scoped executor ref for the current target before executing Computer Use.',
  };
  return {
    ...preflight,
    status: 'blocked',
    blockers: [...preflight.blockers, scopedExecutorBlocker] as ComputerUsePreflightResult['blockers'],
  };
}

function computerUseGuiApprovalForPreflight(input: {
  preflight: ComputerUsePreflightResult;
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
}): { approved: true; approvalRef: string; evidenceRefs: string[] } | { approved: false } {
  if (input.preflight.status !== 'needs-confirmation') return { approved: false };
  const humanRef = safeComputerUseApprovalRef(stringField(input.humanApproval?.approvalRef));
  if (!humanRef) return { approved: false };
  if (stringField(input.humanApproval?.decision)?.toLowerCase() !== 'approved') return { approved: false };
  if (stringField(input.humanApproval?.source) !== RUNTIME_GUI_COMPONENT_ID) return { approved: false };
  const uiRef = safeComputerUseApprovalRef(
    stringField(input.uiState?.computerUseApprovalRef) ?? stringField(input.uiState?.approvalRef),
  );
  if (input.uiState && uiRef !== humanRef) return { approved: false };
  const provenance = isRecord(input.humanApproval?.approvalProvenance) ? input.humanApproval.approvalProvenance : {};
  const sourceStatus = stringField(provenance.sourceStatus) ?? stringField(provenance.status);
  if (sourceStatus && sourceStatus !== 'needs-confirmation') return { approved: false };
  return {
    approved: true,
    approvalRef: humanRef,
    evidenceRefs: uniqueStrings([
      humanRef,
      ...stringList(provenance.refs),
      ...input.preflight.evidenceRefs,
    ]),
  };
}

function confirmedComputerUsePreflight(
  preflight: ComputerUsePreflightResult,
  approval: { approved: true; approvalRef: string; evidenceRefs: string[] },
): ComputerUsePreflightResult {
  return {
    ...preflight,
    status: 'ready',
    evidenceRefs: uniqueStrings([...preflight.evidenceRefs, approval.approvalRef, ...approval.evidenceRefs]),
    confirmation: undefined,
  };
}

function preflightWithApprovalRef(preflight: ComputerUsePreflightResult, approvalRef: string): Record<string, unknown> {
  return {
    ...preflight,
    approvalRef,
    approvalRequestId: approvalRef,
    confirmation: preflight.confirmation
      ? {
        ...preflight.confirmation,
        id: approvalRef,
        approvalRef,
        approvalRequestId: approvalRef,
      }
      : undefined,
  };
}

function computerUseConfirmationAskUser(input: {
  preflight: ComputerUsePreflightResult;
  approvalRef: string;
  artifactId: string;
  commandId: string;
  attemptId: string;
}) {
  const approvalCommand = `/computer-use approve --approval-ref "${input.approvalRef}"`;
  const rejectCommand = `/computer-use reject --approval-ref "${input.approvalRef}"`;
  return {
    source: TOOL_ID,
    kind: 'confirmation',
    title: 'Computer Use confirmation required',
    message: `Confirm before Computer Use acts on ${input.preflight.target.summary}: ${input.preflight.risk.reason}.`,
    approvalRequest: {
      id: input.approvalRef,
      approvalRef: input.approvalRef,
      status: 'needs-confirmation',
      action: input.preflight.confirmation?.action,
      target: input.preflight.target.summary,
      reason: input.preflight.risk.reason,
      category: input.preflight.risk.category,
      evidenceRefs: input.preflight.evidenceRefs,
      artifactRef: input.artifactId,
      commandId: input.commandId,
      attemptId: input.attemptId,
    },
    choices: [
      { label: 'Confirm', commandText: approvalCommand, style: 'primary' },
      { label: 'Cancel', commandText: rejectCommand, style: 'secondary' },
    ],
    displayedRefs: input.preflight.evidenceRefs,
    relatedRefs: [input.artifactId, ...input.preflight.evidenceRefs],
  };
}

function computerUseApprovalRefForPreflight(preflight: ComputerUsePreflightResult, id: string) {
  const category = preflight.risk.category.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `approval:computer-use:${category || 'action'}-${id}`;
}

function safeComputerUseApprovalRef(value: string | undefined): string | undefined {
  if (!value || value.length > 180) return undefined;
  if (!/^approval:computer-use:[A-Za-z0-9._:-]+$/u.test(value)) return undefined;
  if (/(?:secret|password|credential|token|bearer|api[_-]?key|https?:\/\/|\/)/i.test(value)) return undefined;
  return value;
}

function computerUseLocalActionEvidenceCheck(
  evidenceRefs: string[],
  operationValue: { status?: string; actionRefs?: string[]; blockedReason?: string } | undefined,
) {
  if (operationValue?.status !== 'completed') {
    return { ok: false, reason: operationValue?.blockedReason ?? 'missing current target-bound action evidence' };
  }
  const refs = uniqueStrings([
    ...evidenceRefs,
    ...(operationValue.actionRefs ?? []),
  ]).filter(runtimeOwnedRuntimeTruthRef);
  const hasBefore = refs.some((ref) => /(?:before|pre[-_]?action|pre[-_]?observation)/i.test(ref));
  const hasGrounding = refs.some((ref) => /(?:grounding|planner|target[-_]?binding|visible[-_]?action|actor[-_]?cursor|binding)/i.test(ref));
  const hasExecutor = refs.some((ref) => /(?:executor|action[-_]?event|action[-_]?state|event)/i.test(ref));
  const hasAfter = refs.some((ref) => /(?:after|post[-_]?action|post[-_]?observation)/i.test(ref));
  const hasStaleInvalidation = refs.some((ref) => /(?:stale|freshness[-_]?invalidation|invalidat)/i.test(ref));
  const missing = [
    hasBefore ? undefined : 'before-evidence-ref',
    hasGrounding ? undefined : 'grounding-ref',
    hasExecutor ? undefined : 'executor-event-ref',
    hasAfter ? undefined : 'after-evidence-ref',
    hasStaleInvalidation ? undefined : 'stale-invalidation-ref',
  ].filter((item): item is string => Boolean(item));
  return {
    ok: missing.length === 0,
    reason: missing.length
      ? `missing current target-bound action evidence (${missing.join(', ')})`
      : 'missing current target-bound action evidence',
  };
}

function computerUseActMaterializerEvidenceCheck(
  materialized: CodexAgentHostComputerUseActMaterializerResult | undefined,
) {
  return computerUseLocalActionEvidenceCheck(materialized?.evidenceRefs ?? [], {
    status: materialized?.status,
    actionRefs: materialized?.evidenceRefs,
  });
}

function requiresComputerUseArtifactCompletionRefs(commandText: string) {
  const compact = commandText.replace(/\s+/g, ' ').trim();
  return /(?:pptx?|power\s*point|presentation|slide\s*deck|slides?|deck|演示文稿|幻灯片|幻灯|PPT)/i.test(compact)
    && /(?:create|make|generate|draft|build|save|export|做|生成|制作|创建|写|保存|导出|产出)/i.test(compact);
}

function runDirRefFromArtifactRef(ref: string | undefined) {
  if (!ref) return undefined;
  const match = ref.match(/^(\.sciforge\/vision-runs\/[^/]+)/u);
  return match?.[1];
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
  context: { commandText?: string } = {},
): CodexAgentHostComputerUseActMaterializerResult | undefined {
  if (!value) return undefined;
  const evidenceRefs = stringList(value.evidenceRefs).filter(runtimeOwnedActEvidenceRef);
  if (!evidenceRefs.length) return undefined;
  const requestedStatus = value.status === 'completed' || value.status === 'needs-confirmation' ? value.status : 'blocked';
  const completionTruth = sanitizeComputerUseCompletionTruth(value.completionTruth)
    ?? completionTruthFromPackageBridgeWorkEvidence({
      evidenceRefs,
      workEvidence: value.workEvidence,
    });
  const productCompletionClaim = requiresComputerUseProductCompletionEvidence({
    commandText: context.commandText ?? '',
    message: stringField(value.message),
    claimType: stringField(value.claimType),
    claimTexts: safeActMaterializerRecords(value.claims).map((claim) => stringField(claim.text)).filter((text): text is string => Boolean(text)),
    executionUnitTexts: safeActMaterializerRecords(value.executionUnits).map((unit) => stringField(unit.failureReason) ?? stringField(unit.outputRef)).filter((text): text is string => Boolean(text)),
  });
  const requireLocalActionEvidence = requestedStatus === 'completed' && !completionTruth && !productCompletionClaim;
  const actionEvidenceCheck = requireLocalActionEvidence
    ? computerUseRuntimeActionEvidenceCheck(evidenceRefs)
    : { ok: true, reason: 'missing current target-bound action evidence' };
  const status = requireLocalActionEvidence && !actionEvidenceCheck.ok ? 'blocked' : requestedStatus;
  return {
    status,
    message: status === 'completed'
      ? productCompletionClaim || completionTruth
        ? stringField(value.message) ?? 'Computer Use Act materializer returned validated completion evidence.'
        : `Computer Use Act materializer completed the local GUI action with current target-bound action evidence refs: ${evidenceRefs.slice(0, 6).join(', ')}.`
      : status === 'blocked' && requestedStatus === 'completed'
        ? `Computer Use Act materializer is blocked: ${actionEvidenceCheck.reason}.`
        : stringField(value.message) ?? 'Computer Use Act materializer returned runtime-owned evidence.',
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

function computerUseRuntimeActionEvidenceCheck(evidenceRefs: string[]) {
  const refs = uniqueStrings(evidenceRefs).filter(runtimeOwnedActEvidenceRef);
  const hasBefore = refs.some((ref) => /(?:^|[:/._-])(?:before|before[-_/]frame|before[-_/]screenshot|pre[-_/]action|pre[-_/]observation)(?:[:/._-]|$)/i.test(ref));
  const hasGrounding = refs.some((ref) => /(?:^|[:/._-])(?:grounding|planner|target[-_/]binding|visible[-_/]action|actor[-_/]cursor|binding)(?:[:/._-]|$)/i.test(ref));
  const hasExecutor = refs.some((ref) => /(?:^|[:/._-])(?:executor|executor[-_/]event|action[-_/]state|action[-_/]event|adapter[-_/]registry)(?:[:/._-]|$)/i.test(ref));
  const hasAfter = refs.some((ref) => /(?:^|[:/._-])(?:after|after[-_/]frame|after[-_/]screenshot|post[-_/]action|post[-_/]observation)(?:[:/._-]|$)/i.test(ref));
  const hasStaleInvalidation = refs.some((ref) => /(?:^|[:/._-])(?:freshness(?:[-_/](?:check|invalidation|invalidated))?|stale(?:[-_/]invalidation)?|invalidat(?:e|ed|ion))(?:[:/._-]|$)/i.test(ref));
  const missing = [
    hasBefore ? undefined : 'before-evidence-ref',
    hasGrounding ? undefined : 'grounding-ref',
    hasExecutor ? undefined : 'executor-event-ref',
    hasAfter ? undefined : 'after-evidence-ref',
    hasStaleInvalidation ? undefined : 'stale-invalidation-ref',
  ].filter((item): item is string => Boolean(item));
  return {
    ok: missing.length === 0,
    reason: missing.length
      ? `missing current target-bound action evidence (${missing.join(', ')})`
      : 'missing current target-bound action evidence',
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
      : attachValidatedComputerUseCompletionTruth({
        ...value,
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'workflow',
          status: 'satisfied',
          evidenceRefs: validationEvidenceRefs(validation, refs),
        },
      }, validation);
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
  return /^(?:browser-host-session:|window-action-session:|computer-use:|observation:|executor-event:|input-event:|native-host:|action-ledger:|evidence:|workEvidence:|runtime-truth:|permission:|cancel:|adapter-registry:|desktop-native:|desktop-window:|window:|appium-mac2:|app-native-command:|accessibility-ui-automation:|terminal-pty:|file-manager:|actor-cursor:|scoped-input-adapter:|focus-lease:)/i.test(trimmed);
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
  completionTruth?: CodexAgentHostCompletionTruth;
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
  if (agentHostLocalGuiOperationIntent(prompt)) return { intent: 'gui-operation' };
  if (defaultGuiOperationIntent({ prompt })) return { intent: 'gui-operation' };
  return { intent: 'answer' };
}

function agentHostLocalGuiOperationIntent(prompt: string) {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  if (/(?:search|browse|web|网页|检索|搜索|最新|今天|arxiv|http:\/\/|https:\/\/)/i.test(compact)) return false;
  return /(?:click|type|press|scroll|drag|select|save|open\s+(?:the\s+)?(?:preview|window|app|application)|点击|输入|按下|滚动|拖动|选择|保存|打开.*(?:窗口|预览|应用))/i.test(compact);
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
  return /^(?:runtime-truth:|browser-host-session:|window-action-session:|computer-use:|observation:|executor-event:|input-event:|native-adapter:|desktop-native:|desktop-window:|permission:|approval:|cancel:|stop:|lease:|input-lease:|adapter-registry:|window:|action-ledger:|evidence:|workEvidence:|native-host:|audit:|appium-mac2:|app-native-command:|accessibility-ui-automation:|terminal-pty:|file-manager:|actor-cursor:|scoped-input-adapter:|focus-lease:)/i.test(trimmed);
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
