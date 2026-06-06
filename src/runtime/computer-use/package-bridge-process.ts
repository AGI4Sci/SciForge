import { isRecord } from '../gateway-utils.js';
import {
  computerUseRequiresVisibleArtifact,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import {
  genericActionTextRequiresConfirmation,
} from './actions.js';
import {
  type HostPortCall,
} from './package-bridge-stdio.js';

export type PackageBridgeHostPortHandler = (call: HostPortCall) => Promise<unknown>;

export type RunComputerUsePackageProcessOptions = {
  actionProviderRequest: Record<string, unknown>;
  callbacks: WorkspaceRuntimeCallbacks;
  handleHostPortCall: PackageBridgeHostPortHandler;
  processEnv?: NodeJS.ProcessEnv;
};

export async function runComputerUsePackageProcess(
  options: RunComputerUsePackageProcessOptions,
): Promise<Record<string, unknown>> {
  const maxSteps = positiveInteger(options.actionProviderRequest.maxSteps) ?? 1;
  const history: Record<string, unknown>[] = [];
  let finalObservationRef = '';

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const abort = runtimeAbortFailure(options.callbacks.signal);
    if (abort) return abort;
    const stepNumber = stepIndex + 1;
    try {
      const before = await callHostPort(options, {
        id: `capture-${String(stepNumber).padStart(3, '0')}-before`,
        port: 'capture',
        args: [options.actionProviderRequest, history],
      });
      finalObservationRef = stringAt(before, 'ref') ?? finalObservationRef;
      const plan = await callHostPort(options, {
        id: `plan-${String(stepNumber).padStart(3, '0')}`,
        port: 'plan',
        args: [options.actionProviderRequest, before, history],
      });
      if (plan.done === true) {
        return packageLoopResult({
          status: 'failed-with-reason',
          reason: 'Computer Use TypeScript host-port planner reported done without executing and verifying a current action.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber,
          failureDiagnostics: {
            failedStage: 'plan',
            plan,
          },
        });
      }
      const plannedKind = stringAt(plan, 'kind') ?? stringAt(plan, 'type');
      if (!plannedKind) {
        return packageLoopResult({
          status: 'failed-with-reason',
          reason: stringAt(plan, 'reason') ?? 'Computer Use TypeScript host-port planner emitted no executable generic action.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber,
          failureDiagnostics: {
            failedStage: 'plan',
            plan,
          },
        });
      }
      if (planRequiresConfirmation(plan) && !requestHasConfirmedApproval(options.actionProviderRequest)) {
        const approvalRequest = approvalRequestFromPlan(plan, stepIndex);
        const step = packageStep({
          status: 'blocked',
          before,
          action: plan,
          verification: {
            ok: false,
            done: false,
            reason: stringAt(approvalRequest, 'reason') ?? 'Computer Use action requires confirmation.',
          },
        });
        history.push(step);
        return packageLoopResult({
          status: 'needs-confirmation',
          reason: stringAt(approvalRequest, 'reason') ?? 'Computer Use action requires confirmation.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber,
          approvalRequest,
          failureDiagnostics: {
            failedStage: 'approval-gate',
            plan,
          },
        });
      }
      const locate = await callHostPort(options, {
        id: `locate-${String(stepNumber).padStart(3, '0')}`,
        port: 'locate',
        args: [before, recordAt(plan, 'target') ?? {}, history],
      });
      if (locate.ok === false) {
        const blocked = packageStep({
          status: 'blocked',
          before,
          action: plan,
          grounding: locate,
          verification: {
            ok: false,
            done: false,
            reason: stringAt(locate, 'reason') ?? 'Computer Use TypeScript host-port grounder could not locate the target.',
          },
        });
        history.push(blocked);
        return packageLoopResult({
          status: 'failed-with-reason',
          reason: stringAt(locate, 'reason') ?? 'Computer Use TypeScript host-port grounder could not locate the target.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber,
          failureDiagnostics: {
            failedStage: 'locate',
            grounding: locate,
          },
        });
      }
      const execution = await callHostPort(options, {
        id: `execute-${String(stepNumber).padStart(3, '0')}`,
        port: 'execute',
        args: [plan, locate, options.actionProviderRequest, history],
      });
      const after = await callHostPort(options, {
        id: `capture-${String(stepNumber).padStart(3, '0')}-after`,
        port: 'capture',
        args: [options.actionProviderRequest, history],
        kwargs: { query: 'after-action' },
      });
      finalObservationRef = stringAt(after, 'ref') ?? finalObservationRef;
      const verification = await callHostPort(options, {
        id: `verify-${String(stepNumber).padStart(3, '0')}`,
        port: 'verify',
        args: [options.actionProviderRequest, before, after, plan, execution, history],
      });
      const executionOk = execution.ok === true && execution.blocked !== true;
      const verificationDone = verification.done === true;
      const step = packageStep({
        status: executionOk ? 'done' : 'blocked',
        before,
        after,
        action: plan,
        grounding: locate,
        execution,
        verification,
      });
      history.push(step);
      if (!executionOk) {
        const approvalRequest = approvalRequestFromExecution(execution, plan, stepIndex);
        return packageLoopResult({
          status: approvalRequest ? 'needs-confirmation' : 'failed-with-reason',
          reason: execution.ok !== true && execution.blocked !== true
            ? 'Computer Use TypeScript host-port executor did not report ok=true; completion requires explicit execute evidence.'
            : stringAt(execution, 'message') ?? stringAt(recordAt(execution, 'metadata'), 'stderr') ?? 'Computer Use TypeScript host-port executor blocked the action.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber + 1,
          approvalRequest,
          failureDiagnostics: {
            failedStage: 'execute',
            execution,
          },
        });
      }
      if (verification.ok === false) {
        return packageLoopResult({
          status: 'failed-with-reason',
          reason: stringAt(verification, 'reason') ?? 'Computer Use TypeScript host-port verifier rejected the action.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber + 1,
          failureDiagnostics: {
            failedStage: 'verify',
            verification,
          },
        });
      }
      const completionEvidenceFailure = verificationDone
        ? packageCompletionEvidenceFailure({
          request: options.actionProviderRequest,
          after,
          execution,
          verification,
        })
        : undefined;
      if (completionEvidenceFailure) {
        return packageLoopResult({
          status: 'failed-with-reason',
          reason: completionEvidenceFailure.reason,
          steps: history,
          finalObservationRef,
          observationCount: stepNumber + 1,
          failureDiagnostics: completionEvidenceFailure.failureDiagnostics,
        });
      }
      if (verificationDone) {
        return packageLoopResult({
          status: 'completed',
          reason: stringAt(verification, 'reason') ?? 'Computer Use TypeScript host-port verifier accepted final action.',
          steps: history,
          finalObservationRef,
          observationCount: stepNumber + 1,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return packageLoopResult({
        status: 'failed-with-reason',
        reason,
        steps: history,
        finalObservationRef,
        observationCount: stepIndex + 1,
        failureDiagnostics: {
          failedStage: 'package-bridge-host-port',
          error: reason,
        },
      });
    }
  }

  return packageLoopResult({
    status: 'max-steps',
    reason: `Computer Use TypeScript host-port loop reached maxSteps=${maxSteps} before completion.`,
    steps: history,
    finalObservationRef,
    observationCount: maxSteps,
    failureDiagnostics: {
      failedStage: 'max-steps',
      maxSteps,
    },
  });
}

function runtimeAbortReason(signal: AbortSignal | undefined) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message.trim()) return reason.message.trim();
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  return '';
}

function runtimeAbortFailure(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return undefined;
  const reason = runtimeAbortReason(signal);
  return packageLoopResult({
    status: 'failed-with-reason',
    reason: reason
      ? `Computer Use TypeScript host-port loop aborted by workspace runtime signal: ${reason}.`
      : 'Computer Use TypeScript host-port loop aborted by workspace runtime signal.',
    steps: [],
    finalObservationRef: '',
    observationCount: 0,
    failureDiagnostics: {
      failedStage: 'package-bridge-abort',
      reason,
    },
  });
}

async function callHostPort(
  options: RunComputerUsePackageProcessOptions,
  call: Omit<HostPortCall, 'type'>,
) {
  const abort = runtimeAbortFailure(options.callbacks.signal);
  if (abort) throw new Error(stringAt(abort, 'reason') ?? 'Computer Use TypeScript host-port loop aborted.');
  const result = await options.handleHostPortCall({ type: 'hostPortCall', ...call });
  return isRecord(result) ? result : { value: result };
}

function packageLoopResult(input: {
  status: 'completed' | 'failed-with-reason' | 'max-steps' | 'needs-confirmation';
  reason: string;
  steps: Record<string, unknown>[];
  finalObservationRef: string;
  observationCount: number;
  approvalRequest?: Record<string, unknown>;
  failureDiagnostics?: Record<string, unknown>;
}) {
  const finalArtifactRefs = uniqueStrings(input.steps.flatMap((step) => collectVerifiedFinalArtifactRefs(step)));
  return {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: input.status,
    reason: input.reason,
    message: input.reason,
    ...(input.approvalRequest ? { approvalRequest: input.approvalRequest } : input.status === 'completed' ? { approvalRequest: null } : {}),
    ...(input.finalObservationRef ? { finalObservationRef: input.finalObservationRef } : {}),
    ...(finalArtifactRefs.length ? { finalArtifactRefs } : {}),
    ...(input.failureDiagnostics ? { failureDiagnostics: input.failureDiagnostics } : {}),
    traceRefs: [],
    metrics: {
      actionCount: input.steps.filter((step) => step.status === 'done').length,
      stepCount: input.steps.length,
      observationCount: input.observationCount,
    },
    steps: input.steps,
  };
}

function packageStep(input: {
  status: 'done' | 'blocked';
  before: Record<string, unknown>;
  after?: Record<string, unknown>;
  action: Record<string, unknown>;
  grounding?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  verification: Record<string, unknown>;
}) {
  return {
    status: input.status,
    beforeRef: stringAt(input.before, 'ref') ?? null,
    afterRef: stringAt(input.after, 'ref') ?? null,
    action: input.action,
    grounding: input.grounding ?? null,
    execution: input.execution ?? null,
    verification: input.verification,
  };
}

function planRequiresConfirmation(plan: Record<string, unknown>) {
  const target = recordAt(plan, 'target');
  const targetDescription = stringAt(target, 'description')
    ?? stringAt(target, 'targetDescription')
    ?? stringAt(target, 'target_description')
    ?? stringAt(plan, 'targetDescription')
    ?? stringAt(plan, 'target_description')
    ?? stringAt(plan, 'description');
  const targetRegionDescription = stringAt(target, 'regionDescription')
    ?? stringAt(target, 'region_description')
    ?? stringAt(target, 'targetRegionDescription')
    ?? stringAt(target, 'target_region_description')
    ?? stringAt(plan, 'targetRegionDescription')
    ?? stringAt(plan, 'target_region_description');
  return stringAt(plan, 'riskLevel') === 'high'
    || stringAt(plan, 'risk_level') === 'high'
    || plan.requiresConfirmation === true
    || plan.requires_confirmation === true
    || genericActionTextRequiresConfirmation(
      targetDescription ?? targetRegionDescription,
      stringAt(plan, 'confirmationText'),
      stringAt(plan, 'confirmation_text'),
    );
}

function requestHasConfirmedApproval(request: Record<string, unknown>) {
  const riskPolicy = stringAt(request, 'riskPolicy') ?? stringAt(request, 'risk_policy');
  const approvalRef = approvalRefFromRequest(request);
  if (riskPolicy !== 'allow-confirmed' || !approvalRef) return false;
  return approvalProvenanceMatchesRequest(request, approvalRef);
}

function approvalRefFromRequest(request: Record<string, unknown>) {
  const metadata = recordAt(request, 'metadata');
  return stringAt(request, 'approvalRef')
    ?? stringAt(request, 'approval_ref')
    ?? stringAt(metadata, 'approvalRef')
    ?? stringAt(metadata, 'approval_ref');
}

function approvalProvenanceMatchesRequest(request: Record<string, unknown>, approvalRef: string) {
  const metadata = recordAt(request, 'metadata');
  const provenance = recordAt(request, 'approvalProvenance')
    ?? recordAt(request, 'approval_provenance')
    ?? recordAt(metadata, 'approvalProvenance')
    ?? recordAt(metadata, 'approval_provenance');
  if (!provenance) return false;
  if (!approvalProvenanceRefs(provenance).includes(approvalRef)) return false;
  if (approvalProvenanceRiskActionHashes(provenance).length === 0) return false;
  return approvalProvenanceHasPriorBoundary(provenance);
}

function approvalProvenanceRefs(provenance: Record<string, unknown>) {
  const approvalRequest = recordAt(provenance, 'approvalRequest') ?? recordAt(provenance, 'approval_request');
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const guiAskUserPayload = recordAt(guiAskUserSidecar, 'payload');
  const guiAskUserApprovalRequest = recordAt(guiAskUserPayload, 'approvalRequest') ?? recordAt(guiAskUserPayload, 'approval_request');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  const approvalDecisionSidecar = recordAt(provenance, 'approvalDecisionSidecar') ?? recordAt(provenance, 'approval_decision_sidecar');
  const confirmedRequestSidecar = recordAt(provenance, 'confirmedRequestSidecar') ?? recordAt(provenance, 'confirmed_request_sidecar');
  return uniqueStrings([
    stringAt(provenance, 'approvalRef'),
    stringAt(provenance, 'approval_ref'),
    stringAt(approvalRequest, 'approvalRef'),
    stringAt(approvalRequest, 'approval_ref'),
    stringAt(approvalRequestSidecar, 'approvalRef'),
    stringAt(approvalRequestSidecar, 'approval_ref'),
    stringAt(guiAskUserSidecar, 'approvalRef'),
    stringAt(guiAskUserSidecar, 'approval_ref'),
    stringAt(guiAskUserApprovalRequest, 'approvalRef'),
    stringAt(guiAskUserApprovalRequest, 'approval_ref'),
    stringAt(riskAuditSidecar, 'approvalRef'),
    stringAt(riskAuditSidecar, 'approval_ref'),
    stringAt(approvalDecisionSidecar, 'approvalRef'),
    stringAt(approvalDecisionSidecar, 'approval_ref'),
    stringAt(confirmedRequestSidecar, 'approvalRef'),
    stringAt(confirmedRequestSidecar, 'approval_ref'),
  ].filter((value): value is string => Boolean(value)));
}

function approvalProvenanceRiskActionHashes(provenance: Record<string, unknown>) {
  const approvalRequest = recordAt(provenance, 'approvalRequest') ?? recordAt(provenance, 'approval_request');
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const guiAskUserPayload = recordAt(guiAskUserSidecar, 'payload');
  const guiAskUserApprovalRequest = recordAt(guiAskUserPayload, 'approvalRequest') ?? recordAt(guiAskUserPayload, 'approval_request');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  const approvalDecisionSidecar = recordAt(provenance, 'approvalDecisionSidecar') ?? recordAt(provenance, 'approval_decision_sidecar');
  const confirmedRequestSidecar = recordAt(provenance, 'confirmedRequestSidecar') ?? recordAt(provenance, 'confirmed_request_sidecar');
  return uniqueStrings([
    stringAt(provenance, 'riskActionHash'),
    stringAt(provenance, 'risk_action_hash'),
    stringAt(approvalRequest, 'riskActionHash'),
    stringAt(approvalRequest, 'risk_action_hash'),
    stringAt(approvalRequestSidecar, 'riskActionHash'),
    stringAt(approvalRequestSidecar, 'risk_action_hash'),
    stringAt(guiAskUserSidecar, 'riskActionHash'),
    stringAt(guiAskUserSidecar, 'risk_action_hash'),
    stringAt(guiAskUserApprovalRequest, 'riskActionHash'),
    stringAt(guiAskUserApprovalRequest, 'risk_action_hash'),
    stringAt(riskAuditSidecar, 'riskActionHash'),
    stringAt(riskAuditSidecar, 'risk_action_hash'),
    stringAt(approvalDecisionSidecar, 'riskActionHash'),
    stringAt(approvalDecisionSidecar, 'risk_action_hash'),
    stringAt(confirmedRequestSidecar, 'riskActionHash'),
    stringAt(confirmedRequestSidecar, 'risk_action_hash'),
  ].filter((value): value is string => Boolean(value)));
}

function approvalProvenanceHasPriorBoundary(provenance: Record<string, unknown>) {
  const sourceApprovalRequestRef = stringAt(provenance, 'sourceApprovalRequestRef') ?? stringAt(provenance, 'source_approval_request_ref');
  const sourceGuiAskUserRecordRef = stringAt(provenance, 'sourceGuiAskUserRecordRef') ?? stringAt(provenance, 'source_gui_ask_user_record_ref');
  const sourceRiskAuditRef = stringAt(provenance, 'sourceRiskAuditRef') ?? stringAt(provenance, 'source_risk_audit_ref');
  if (sourceApprovalRequestRef && sourceGuiAskUserRecordRef && sourceRiskAuditRef) return true;
  const approvalRequestSidecar = recordAt(provenance, 'approvalRequestSidecar') ?? recordAt(provenance, 'approval_request_sidecar');
  const guiAskUserSidecar = recordAt(provenance, 'guiAskUserSidecar') ?? recordAt(provenance, 'gui_ask_user_sidecar');
  const riskAuditSidecar = recordAt(provenance, 'riskAuditSidecar') ?? recordAt(provenance, 'risk_audit_sidecar');
  if (approvalRequestSidecar && guiAskUserSidecar && riskAuditSidecar) return true;
  return false;
}

function approvalRequestFromPlan(plan: Record<string, unknown>, blockedActionIndex: number) {
  const approvalRequestId = `approval-request:computer-use:${blockedActionIndex}`;
  return {
    id: approvalRequestId,
    approvalRequestId,
    status: 'needs-confirmation',
    action_kind: stringAt(plan, 'kind') ?? stringAt(plan, 'type'),
    target: recordAt(plan, 'target'),
    blocked_action_index: blockedActionIndex,
    reason: 'approval-required: high-risk Computer Use action stopped before grounding or executor event creation',
    metadata: {
      riskActionHash: `risk-action:computer-use:${blockedActionIndex}`,
    },
  };
}

function approvalRequestFromExecution(
  execution: Record<string, unknown>,
  plan: Record<string, unknown>,
  blockedActionIndex: number,
) {
  const metadata = recordAt(execution, 'metadata');
  const schedulerDecision = recordAt(metadata, 'schedulerDecision');
  const status = stringAt(schedulerDecision, 'status');
  if (status !== 'needs-confirmation') return undefined;
  const approvalRequestId = stringAt(recordAt(schedulerDecision, 'schedulerDecisionRefs'), 'approvalRequestRef')
    ?? `approval-request:computer-use:${blockedActionIndex}`;
  return {
    id: approvalRequestId,
    approvalRequestId,
    status: 'needs-confirmation',
    action_kind: stringAt(plan, 'kind') ?? stringAt(plan, 'type'),
    target: recordAt(plan, 'target'),
    blocked_action_index: blockedActionIndex,
    reason: stringAt(schedulerDecision, 'reason') ?? stringAt(execution, 'message') ?? 'Computer Use action requires confirmation.',
    metadata: {
      riskActionHash: stringAt(recordAt(schedulerDecision, 'schedulerDecisionRefs'), 'riskActionHash'),
      schedulerDecision,
    },
  };
}

function packageCompletionEvidenceFailure(input: {
  request: Record<string, unknown>;
  after: Record<string, unknown>;
  execution: Record<string, unknown>;
  verification: Record<string, unknown>;
}) {
  if (input.execution.ok !== true || input.execution.blocked === true) {
    return {
      reason: 'Computer Use TypeScript host-port completion requires explicit execute ok=true evidence.',
      failureDiagnostics: {
        failedStage: 'execute',
        execution: input.execution,
      },
    };
  }
  if (input.verification.ok !== true) {
    return {
      reason: 'Computer Use TypeScript host-port completion requires explicit verifier ok=true evidence.',
      failureDiagnostics: {
        failedStage: 'verify',
        verification: input.verification,
      },
    };
  }
  if (!stringAt(input.after, 'ref')) {
    return {
      reason: 'Computer Use TypeScript host-port completion requires a current after-action observation ref.',
      failureDiagnostics: {
        failedStage: 'capture',
        after: input.after,
      },
    };
  }
  const artifactIntentText = packageArtifactIntentText(input.request);
  if (computerUseRequiresVisibleArtifact(artifactIntentText) && verifiedFinalArtifactRefs(input.verification).length === 0) {
    return {
      reason: 'Computer Use TypeScript host-port artifact completion requires verified final artifact evidence.',
      failureDiagnostics: {
        failedStage: 'verify',
        verification: input.verification,
        requiredEvidence: 'finalArtifactRefs',
      },
    };
  }
  return undefined;
}

function collectVerifiedFinalArtifactRefs(step: Record<string, unknown>): string[] {
  if (step.status !== 'done') return [];
  const verification = recordAt(step, 'verification');
  if (!verification || verification.ok !== true || verification.done !== true) return [];
  return verifiedFinalArtifactRefs(verification);
}

function verifiedFinalArtifactRefs(verification: Record<string, unknown>): string[] {
  const metadata = recordAt(verification, 'metadata');
  return uniqueStrings([
    ...refsFromFinalArtifactValue(verification.finalArtifactRefs),
    ...refsFromFinalArtifactValue(verification.finalArtifactRef),
    ...refsFromFinalArtifactValue(metadata?.finalArtifactRefs),
    ...refsFromFinalArtifactValue(metadata?.finalArtifactRef),
  ]);
}

function refsFromFinalArtifactValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(refsFromFinalArtifactValue);
  if (!isRecord(value)) return [];
  return uniqueStrings([
    stringAt(value, 'artifactRef'),
    stringAt(value, 'artifact_ref'),
    stringAt(value, 'dataRef'),
    stringAt(value, 'data_ref'),
    stringAt(value, 'path'),
    stringAt(value, 'ref'),
    ...Object.entries(value).flatMap(([key, item]) => isFinalArtifactKey(key) ? refsFromFinalArtifactValue(item) : []),
  ].filter((ref): ref is string => Boolean(ref)));
}

function isFinalArtifactKey(key: string) {
  const normalized = key.replace(/[-_\s]+/g, '').toLowerCase();
  return normalized === 'finalartifactref'
    || normalized === 'finalartifactrefs'
    || normalized === 'finalartifact'
    || normalized === 'finalartifacts';
}

function packageArtifactIntentText(request: Record<string, unknown>) {
  const metadata = recordAt(request, 'metadata');
  return [
    stringAt(request, 'task'),
    stringAt(request, 'text'),
    metadata ? JSON.stringify(recordAt(metadata, 'plannerAcceptanceContract') ?? {}) : '',
  ].filter((value) => value && value.trim()).join('\n');
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function positiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < 1) return undefined;
  return number;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
