import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import type { WorkEvidence } from '../gateway/work-evidence-types.js';
import type { ScreenshotRef, TraceWindowTarget } from '../computer-use/types.js';
import { platformLabel, sanitizeId, sha256, workspaceRel } from '../computer-use/utils.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import { visionSenseTraceContractPolicy, visionSenseTraceIds, visionSenseTraceOutputPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
import type {
  ActionResultValidationProjection,
  AuditRecord,
  RepairDecision,
  ValidationDecision,
} from '@sciforge-ui/runtime-contract/validation-repair-audit';
import {
  attachValidationRepairAuditChainToPayload,
  createValidationRepairAuditChain,
} from '../gateway/validation-repair-audit-bridge.js';
import {
  writeValidationRepairAuditSinkVerificationArtifacts,
  type ValidationRepairAuditVerificationArtifactWriteResult,
} from '../gateway/validation-repair-audit-sink.js';

export const VISION_TOOL_ID = visionSenseTraceIds.tool;
const COMPUTER_USE_CAPABILITY_ID = 'action.sciforge.computer-use';
const COMPUTER_USE_BUDGET_AUDIT_REF = 'audit:computer-use-action-provider-loop';
const COMPUTER_USE_SCREEN_EVIDENCE_COMPONENT_ID = 'image-evidence-viewer';

type ComputerUseWorkEvidence = WorkEvidence & {
  id: string;
  budgetDebitRefs: string[];
};

type VisibleLoopArtifact = Record<string, unknown>;
type VisionSenseTraceOutputViewRefs = {
  execution?: string;
  trace?: string;
};
type GenericBridgeBlockedVirtualScreen = {
  artifactId?: string;
  title?: string;
  data: Record<string, unknown>;
};

export function genericLoopPayload(params: {
  request: GatewayRequest;
  workspace: string;
  runId: string;
  tracePath: string;
  screenshotRefs: ScreenshotRef[];
  status: 'done' | 'failed-with-reason';
  failureReason: string;
  actionCount: number;
  maxSteps: number;
  dryRun: boolean;
  desktopPlatform: string;
  windowTarget?: TraceWindowTarget;
  visibleArtifacts?: VisibleLoopArtifact[];
  finalArtifactRef?: string;
  finalArtifactRefs?: string[];
  finalVisibleScreenshotRef?: string;
  createdAt?: string;
}): ToolPayload {
  const traceRel = workspaceRel(params.workspace, params.tracePath);
  const allRefs = params.screenshotRefs;
  const beforeRef = allRefs.find((ref) => ref.id.includes('-before-'));
  const afterRef = [...allRefs].reverse().find((ref) => ref.id.includes('-after-'));
  const visibleArtifacts = normalizeVisibleLoopArtifacts(params.visibleArtifacts);
  const visibleArtifactRefs = uniqueStrings(visibleArtifacts.flatMap(visibleLoopArtifactRefs));
  const finalArtifactRefs = uniqueStrings([
    params.finalArtifactRef,
    ...(params.finalArtifactRefs ?? []),
  ].filter((ref): ref is string => Boolean(ref?.trim())));
  const finalArtifactRef = params.finalArtifactRef ?? finalArtifactRefs[0];
  const isDone = params.status === 'done';
  const executionUnitRef = `EU-computer-use-${params.runId}`;
  const workEvidenceRef = `workEvidence:computer-use-action-provider:${params.runId}`;
  const budgetDebitRecord = createComputerUseBudgetDebitRecord({
    runId: params.runId,
    traceRel,
    executionUnitRef,
    workEvidenceRef,
    actionCount: params.actionCount,
    maxSteps: params.maxSteps,
    screenshotRefs: allRefs,
    status: params.status,
    failureReason: params.failureReason,
    dryRun: params.dryRun,
    desktopPlatform: params.desktopPlatform,
  });
  const budgetDebitRefs = [budgetDebitRecord.debitId];
  const workEvidence: ComputerUseWorkEvidence = {
    id: workEvidenceRef,
    kind: 'action',
    status: isDone ? 'success' : 'failed-with-reason',
    provider: VISION_TOOL_ID,
    input: {
      prompt: params.request.prompt,
      runId: params.runId,
      maxSteps: params.maxSteps,
      dryRun: params.dryRun,
      desktopPlatform: params.desktopPlatform,
      windowTarget: params.windowTarget,
    },
    resultCount: params.actionCount,
    outputSummary: isDone
      ? `Executed ${params.actionCount} generic Computer Use action(s).`
      : `Stopped after ${params.actionCount} generic Computer Use action(s): ${params.failureReason}`,
    evidenceRefs: uniqueStrings([traceRel, ...[afterRef?.path].filter((ref): ref is string => Boolean(ref)), ...visibleArtifactRefs, ...finalArtifactRefs]),
    failureReason: params.failureReason || undefined,
    recoverActions: params.status === 'done' ? [] : [...visionSenseTraceOutputPolicy.recoverActions],
    nextStep: params.status === 'done' ? undefined : 'Review the vision trace and rerun with corrected planner, grounder, or bridge configuration.',
    diagnostics: [
      `budgetDebitRef=${budgetDebitRecord.debitId}`,
      `screenshotRefs=${allRefs.length}`,
    ],
    rawRef: traceRel,
    budgetDebitRefs,
  };
  const payload: ToolPayload = {
    message: isDone
      ? `Computer Use action provider completed ${params.actionCount} action(s). Trace: ${traceRel}.`
      : `Computer Use action provider stopped with failed-with-reason: ${params.failureReason}`,
    confidence: isDone ? 0.72 : 0.35,
    claimType: 'execution',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      visionSenseTraceOutputPolicy.selectedRuntimeReason,
      visionSenseTraceOutputPolicy.genericActionSchemaReason,
      params.failureReason || `Executed ${params.actionCount} generic action(s).`,
      visionSenseTraceOutputPolicy.noAppSpecificShortcutReason,
    ].filter(Boolean).join('\n'),
    claims: [{
      text: isDone
        ? visionSenseTraceOutputPolicy.successClaim
        : params.failureReason,
      type: isDone ? 'execution' : 'failure',
      confidence: isDone ? 0.72 : 0.35,
      evidenceLevel: 'runtime',
      supportingRefs: [traceRel],
      opposingRefs: [],
    }],
    uiManifest: visionSenseTraceOutputViews({
      includeTrace: true,
      refs: { execution: visionSenseTraceIds.execution, trace: visionSenseTraceIds.trace },
    }),
    executionUnits: [{
      id: executionUnitRef,
      tool: VISION_TOOL_ID,
      status: params.status,
      params: JSON.stringify({ prompt: params.request.prompt, runId: params.runId, actionCount: params.actionCount, windowTarget: params.windowTarget }),
      hash: sha256(Buffer.from(`${params.runId}:${traceRel}:${params.status}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: params.dryRun
        ? `SciForge dry-run generic GUI executor (${platformLabel(params.desktopPlatform)})`
        : `${platformLabel(params.desktopPlatform)} screenshot + generic GUI executor`,
      inputData: [params.request.prompt],
      outputArtifacts: uniqueStrings([traceRel, ...visibleArtifactRefs, ...finalArtifactRefs]),
      artifacts: uniqueStrings([traceRel, ...visibleArtifactRefs, ...finalArtifactRefs]),
      codeRef: 'src/runtime/vision-sense-runtime.ts',
      outputRef: traceRel,
      screenshotRef: afterRef?.path,
      beforeScreenshotRef: beforeRef?.path,
      failureReason: params.failureReason || undefined,
      routeDecision: { selectedRuntime: visionSenseTraceIds.runtime, selectedToolId: VISION_TOOL_ID },
      requiredInputs: params.status === 'done' ? undefined : [...visionSenseTraceOutputPolicy.requiredInputs],
      recoverActions: params.status === 'done' ? undefined : [...visionSenseTraceOutputPolicy.recoverActions],
      budgetDebitRefs,
    }],
    workEvidence: [workEvidence],
    artifacts: [
      {
        id: visionSenseTraceIds.trace,
        type: visionSenseTraceIds.traceKind,
        path: traceRel,
        dataRef: traceRel,
        producerTool: VISION_TOOL_ID,
        schemaVersion: visionSenseTraceIds.traceSchema,
        metadata: {
          runId: params.runId,
          imageMemoryPolicy: visionSenseTraceContractPolicy.imageMemory.policy,
          screenshotRefs: allRefs.map(toTraceScreenshotRef),
          windowTarget: params.windowTarget,
          noInlineImages: true,
          appSpecificShortcuts: [],
          budgetDebitRefs,
          visibleArtifactRefs,
          finalArtifactRef,
          finalArtifactRefs,
          finalVisibleScreenshotRef: params.finalVisibleScreenshotRef,
        },
      },
      ...visibleArtifacts,
    ],
    logs: [{
      kind: 'capability-budget-debit-audit',
      ref: COMPUTER_USE_BUDGET_AUDIT_REF,
      budgetDebitRefs,
      sinkRefs: budgetDebitRecord.sinkRefs,
    }],
    budgetDebits: [budgetDebitRecord],
  };
  if (isDone) return payload;
  const chain = createComputerUseActionValidationRepairAuditChain({
    ...params,
    traceRel,
    screenshotRefs: allRefs,
    visibleArtifactRefs,
    executionUnitRef,
    workEvidenceRef,
    budgetDebitRecord,
  });
  return attachValidationRepairAuditChainToPayload(payload, chain);
}

export async function writeGenericLoopPayloadValidationRepairAuditSink(
  payload: ToolPayload,
  options: { workspacePath: string; now?: () => Date },
): Promise<ValidationRepairAuditVerificationArtifactWriteResult[]> {
  const chain = validationRepairAuditPayloadChain(payload);
  if (!chain) return [];
  const writes = await writeValidationRepairAuditSinkVerificationArtifacts({
    validationDecision: chain.validationDecision,
    repairDecision: chain.repairDecision,
    auditRecord: chain.auditRecord,
  }, options);
  if (!writes.length) return writes;
  const payloadWithRefs = payload as ToolPayload & { refs?: Record<string, unknown> };
  payloadWithRefs.refs = {
    ...(payloadWithRefs.refs ?? {}),
    validationRepairAuditActionResultArtifacts: writes.map((write) => ({
      kind: 'validation-repair-audit-action-result-artifact',
      ref: write.ref,
      auditId: write.fact.auditId,
      sourceSinkRef: write.fact.sourceSinkRef,
      contractId: write.fact.contractId,
      failureKind: write.fact.failureKind,
      outcome: write.fact.outcome,
      sinkRefs: write.fact.sinkRefs,
    })),
  };
  return writes;
}

function createComputerUseActionValidationRepairAuditChain(params: {
  request: GatewayRequest;
  runId: string;
  traceRel: string;
  screenshotRefs: ScreenshotRef[];
  visibleArtifactRefs: string[];
  status: 'done' | 'failed-with-reason';
  failureReason: string;
  actionCount: number;
  maxSteps: number;
  dryRun: boolean;
  desktopPlatform: string;
  windowTarget?: TraceWindowTarget;
  executionUnitRef: string;
  workEvidenceRef: string;
  budgetDebitRecord: CapabilityInvocationBudgetDebitRecord;
  createdAt?: string;
}) {
  const safeRunId = sanitizeId(params.runId);
  const artifactRefs = [params.traceRel, ...params.screenshotRefs.map((ref) => ref.path), ...params.visibleArtifactRefs];
  const actionResult: ActionResultValidationProjection = {
    id: `action-result:${safeRunId}`,
    status: 'failed',
    actionId: VISION_TOOL_ID,
    providerId: COMPUTER_USE_CAPABILITY_ID,
    message: params.failureReason,
    failureMode: computerUseActionFailureMode(params.failureReason),
    traceRef: params.traceRel,
    artifactRefs,
    relatedRefs: [
      params.traceRel,
      params.executionUnitRef,
      params.workEvidenceRef,
      params.budgetDebitRecord.debitId,
    ],
    diagnostics: [
      `runtime=${visionSenseTraceIds.workspaceRuntime}`,
      `tool=${VISION_TOOL_ID}`,
      `desktopPlatform=${params.desktopPlatform}`,
      `dryRun=${params.dryRun}`,
      `actionCount=${params.actionCount}`,
      `maxSteps=${params.maxSteps}`,
      `budgetDebitRef=${params.budgetDebitRecord.debitId}`,
      params.windowTarget ? `windowTarget=${params.windowTarget.captureKind}:${params.windowTarget.source}` : undefined,
    ].filter((value): value is string => Boolean(value)),
    confidence: 0.35,
  };
  return createValidationRepairAuditChain({
    chainId: `computer-use-action:${safeRunId}`,
    subject: {
      kind: 'action-result',
      id: params.runId,
      capabilityId: COMPUTER_USE_CAPABILITY_ID,
      contractId: 'sciforge.action-response.v1',
      actionTraceRef: params.traceRel,
      artifactRefs,
      currentRefs: params.request.selectedToolIds ?? [VISION_TOOL_ID],
    },
    actionResult,
    relatedRefs: [
      params.traceRel,
      params.executionUnitRef,
      params.workEvidenceRef,
      params.budgetDebitRecord.debitId,
    ],
    repairBudget: {
      maxAttempts: 1,
      remainingAttempts: 1,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    sinkRefs: [
      `appendTaskAttempt:action-result:${safeRunId}`,
      `ledger:action-result:${safeRunId}`,
      `verification-artifact:action-results/${safeRunId}.json`,
    ],
    telemetrySpanRefs: [
      `span:action-result:${safeRunId}`,
      `span:repair-decision:action-result:${safeRunId}`,
    ],
    createdAt: params.createdAt,
  });
}

function normalizeVisibleLoopArtifacts(value: unknown): VisibleLoopArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((artifact) => {
      const id = firstArtifactString(artifact.id, artifact.ref, artifact.dataRef, artifact.path, artifact.sessionRef);
      const normalized: VisibleLoopArtifact = {
        ...artifact,
        ...(id && !artifact.id ? { id } : {}),
        type: firstArtifactString(artifact.type, artifact.kind) ?? 'computer-use-visible-artifact',
        producerTool: firstArtifactString(artifact.producerTool) ?? VISION_TOOL_ID,
      };
      return normalized;
    })
    .filter((artifact) => Boolean(firstArtifactString(artifact.id, artifact.ref, artifact.dataRef, artifact.path, artifact.sessionRef)));
}

function visibleLoopArtifactRefs(artifact: VisibleLoopArtifact): string[] {
  const refs = [
    firstArtifactString(artifact.ref),
    firstArtifactString(artifact.dataRef),
    firstArtifactString(artifact.path),
    firstArtifactString(artifact.sessionRef),
    artifactIdRef(firstArtifactString(artifact.id)),
  ].filter((ref): ref is string => Boolean(ref));
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : undefined;
  return [
    ...refs,
    ...stringArray(metadata?.artifactRefs),
    ...stringArray(metadata?.sessionRefs),
  ];
}

function artifactIdRef(id: string | undefined) {
  if (!id) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(id) || id.startsWith('.sciforge/') || id.startsWith('/')) return id;
  return `artifact:${id}`;
}

function firstArtifactString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function visionSenseTraceOutputViews(options: {
  includeTrace?: boolean;
  refs?: VisionSenseTraceOutputViewRefs;
} = {}) {
  const executionRef = options.refs?.execution ?? 'vision-sense-generic-execution';
  const traceRef = options.refs?.trace ?? 'vision-sense-trace';
  const views: Array<Record<string, unknown>> = [{
    componentId: 'execution-unit-table',
    title: 'Execution units',
    artifactRef: executionRef,
    priority: 1,
  }];
  if (options.includeTrace) {
    views.push({
      componentId: 'unknown-artifact-inspector',
      title: 'Vision trace',
      artifactRef: traceRef,
      priority: 2,
    });
  }
  return views;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validationRepairAuditPayloadChain(payload: ToolPayload) {
  const refs = (payload as ToolPayload & { refs?: { validationRepairAudit?: unknown } }).refs;
  const chain = refs?.validationRepairAudit;
  if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return undefined;
  const record = chain as Record<string, unknown>;
  if (!record.auditRecord || typeof record.auditRecord !== 'object') return undefined;
  return record as {
    validationDecision?: ValidationDecision;
    repairDecision?: RepairDecision;
    auditRecord: AuditRecord;
  };
}

function computerUseActionFailureMode(reason: string) {
  if (/provider|unavailable|not configured|no real generic gui executor|no executable adapter/i.test(reason)) return 'provider-unavailable';
  if (/high-risk|confirmation|safety/i.test(reason)) return 'safety-blocked';
  if (/timeout|lock/i.test(reason)) return 'timeout';
  if (/ground/i.test(reason)) return 'grounding-failed';
  if (/window|target|focus|isolation/i.test(reason)) return 'target-unavailable';
  return 'action-failed';
}

function createComputerUseBudgetDebitRecord(params: {
  runId: string;
  traceRel: string;
  executionUnitRef: string;
  workEvidenceRef: string;
  actionCount: number;
  maxSteps: number;
  screenshotRefs: ScreenshotRef[];
  status: 'done' | 'failed-with-reason';
  failureReason: string;
  dryRun: boolean;
  desktopPlatform: string;
}): CapabilityInvocationBudgetDebitRecord {
  const screenshotCount = params.screenshotRefs.length;
  const totalScreenshotBytes = params.screenshotRefs.reduce((total, ref) => total + (Number.isFinite(ref.bytes) ? ref.bytes : 0), 0);
  const debitLines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'actionSteps',
      amount: params.actionCount,
      limit: params.maxSteps,
      remaining: params.maxSteps - params.actionCount,
      reason: 'generic Computer Use action steps executed or blocked',
      sourceRef: params.executionUnitRef,
    },
    {
      dimension: 'observeCalls',
      amount: screenshotCount,
      reason: 'screenshot observations captured for the Computer Use trace',
      sourceRef: params.traceRel,
    },
    {
      dimension: 'downloadBytes',
      amount: totalScreenshotBytes,
      reason: 'screenshot bytes retained as file refs for visual Computer Use evidence',
      sourceRef: params.traceRel,
    },
  ];

  return createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:computer-use:${sanitizeId(params.runId)}`,
    invocationId: `capabilityInvocation:computer-use:${sanitizeId(params.runId)}`,
    capabilityId: COMPUTER_USE_CAPABILITY_ID,
    candidateId: VISION_TOOL_ID,
    manifestRef: `capability:${COMPUTER_USE_CAPABILITY_ID}`,
    subjectRefs: [
      params.traceRel,
      ...params.screenshotRefs.map((ref) => ref.path),
    ],
    debitLines,
    sinkRefs: {
      executionUnitRef: params.executionUnitRef,
      workEvidenceRefs: [params.workEvidenceRef],
      auditRefs: [COMPUTER_USE_BUDGET_AUDIT_REF, params.traceRel],
    },
    metadata: {
      runtime: visionSenseTraceIds.workspaceRuntime,
      tool: VISION_TOOL_ID,
      status: params.status,
      failureReason: params.failureReason || undefined,
      dryRun: params.dryRun,
      desktopPlatform: params.desktopPlatform,
      screenshotCount,
    },
  });
}

export function genericBridgeBlockedPayload(
  request: GatewayRequest,
  workspace: string,
  reason: string,
  routeDecision: Record<string, unknown>,
  options: {
    runId?: string;
    virtualScreen?: GenericBridgeBlockedVirtualScreen;
  } = {},
): ToolPayload {
  const runId = sanitizeId(options.runId || `generic-cu-blocked-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const expectedTrace = workspaceRel(workspace, join(workspace, '.sciforge', 'vision-runs', runId, 'vision-trace.json'));
  const virtualScreenArtifact = options.virtualScreen
    ? genericBridgeBlockedVirtualScreenArtifact(runId, options.virtualScreen)
    : undefined;
  const virtualScreenArtifactRefs = virtualScreenArtifact ? [virtualScreenArtifact.id] : [];
  const uiManifest = visionSenseTraceOutputViews({
    refs: { execution: visionSenseTraceIds.execution, trace: visionSenseTraceIds.trace },
  });
  if (virtualScreenArtifact) {
    uiManifest.unshift({
      componentId: COMPUTER_USE_SCREEN_EVIDENCE_COMPONENT_ID,
      title: options.virtualScreen?.title ?? 'Computer Use screen',
      artifactRef: virtualScreenArtifact.id,
      priority: -6,
    });
  }
  return {
    message: `vision-sense generic Computer Use bridge is not ready: ${reason}`,
    confidence: 0.25,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'local.vision-sense was selected for a Computer Use request.',
      reason,
      `Expected generic trace shape: ${expectedTrace} with screenshot refs, generic actions, executor result, and verifier result.`,
      'No app-specific shortcut or AgentServer fallback was used.',
    ].join('\n'),
    claims: [{
      text: reason,
      type: 'failure',
      confidence: 0.25,
      evidenceLevel: 'runtime',
      supportingRefs: [VISION_TOOL_ID, ...virtualScreenArtifactRefs],
      opposingRefs: [],
    }],
    uiManifest,
    executionUnits: [{
      id: `EU-${runId}`,
      tool: VISION_TOOL_ID,
      status: 'failed-with-reason',
      params: JSON.stringify({ prompt: request.prompt, selectedToolIds: request.selectedToolIds }),
      hash: sha256(Buffer.from(`${runId}:${reason}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'SciForge workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: virtualScreenArtifactRefs,
      artifacts: virtualScreenArtifactRefs,
      failureReason: reason,
      routeDecision,
      requiredInputs: ['ScreenCaptureProvider', ...visionSenseTraceOutputPolicy.requiredInputs.slice(1)],
      recoverActions: [...visionSenseTraceOutputPolicy.bridgeRecoverActions],
      nextStep: 'Configure the generic vision loop dependencies, then rerun the same request.',
    }],
    artifacts: virtualScreenArtifact ? [virtualScreenArtifact] : [],
  };
}

export function virtualAppScreenRuntimePayload(
  request: GatewayRequest,
  workspace: string,
  params: {
    runId: string;
    status: 'done' | 'failed-with-reason';
    message: string;
    routeDecision: Record<string, unknown>;
    virtualScreen: GenericBridgeBlockedVirtualScreen;
  },
): ToolPayload {
  const runId = sanitizeId(params.runId);
  const isDone = params.status === 'done';
  const expectedTrace = workspaceRel(workspace, join(workspace, '.sciforge', 'vision-runs', runId, 'vision-trace.json'));
  const virtualScreenArtifact = genericBridgeBlockedVirtualScreenArtifact(runId, params.virtualScreen);
  const uiManifest = visionSenseTraceOutputViews({
    refs: { execution: visionSenseTraceIds.execution, trace: visionSenseTraceIds.trace },
  });
  uiManifest.unshift({
    componentId: COMPUTER_USE_SCREEN_EVIDENCE_COMPONENT_ID,
    title: params.virtualScreen.title ?? 'Computer Use screen',
    artifactRef: virtualScreenArtifact.id,
    priority: -6,
  });
  return {
    message: isDone
      ? params.message
      : `vision-sense generic Computer Use bridge is not ready: ${params.message}`,
    confidence: isDone ? 0.58 : 0.25,
    claimType: isDone ? 'execution' : 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'local.vision-sense accepted a terminal-equivalent VirtualAppScreen runtime command.',
      params.message,
      'The Screen artifact is refs-first and exposes only the runtime-owned VirtualAppScreen presentation contract.',
      `Trace/evidence refs remain external to inline payloads; default trace path: ${expectedTrace}.`,
      'No app-specific shortcut, shell-only runner, noVNC, or AgentServer fallback was used.',
    ].join('\n'),
    claims: [{
      text: params.message,
      type: isDone ? 'execution' : 'failure',
      confidence: isDone ? 0.58 : 0.25,
      evidenceLevel: 'runtime',
      supportingRefs: [VISION_TOOL_ID, virtualScreenArtifact.id],
      opposingRefs: [],
    }],
    uiManifest,
    executionUnits: [{
      id: `EU-${runId}`,
      tool: VISION_TOOL_ID,
      status: params.status,
      params: JSON.stringify({ prompt: request.prompt, selectedToolIds: request.selectedToolIds }),
      hash: sha256(Buffer.from(`${runId}:${params.status}:${params.message}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'SciForge workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [virtualScreenArtifact.id],
      artifacts: [virtualScreenArtifact.id],
      failureReason: isDone ? undefined : params.message,
      routeDecision: params.routeDecision,
      requiredInputs: isDone ? undefined : ['ScreenCaptureProvider', ...visionSenseTraceOutputPolicy.requiredInputs.slice(1)],
      recoverActions: isDone ? undefined : [...visionSenseTraceOutputPolicy.bridgeRecoverActions],
      nextStep: isDone ? undefined : 'Configure the generic vision loop dependencies, then rerun the same request.',
    }],
    artifacts: [virtualScreenArtifact],
  };
}

function genericBridgeBlockedVirtualScreenArtifact(
  runId: string,
  projection: GenericBridgeBlockedVirtualScreen,
) {
  const id = sanitizeId(projection.artifactId || `computer-use-virtual-screen-${runId}`);
  return {
    id,
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: {
      title: projection.title ?? 'Computer Use screen',
      presentationRole: 'primary-deliverable',
      producer: 'workspace-runtime',
      runId,
    },
    data: projection.data,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role: 'primary-deliverable',
      declaredMediaType: 'application/vnd.sciforge.computer-use-virtual-screen+json',
      declaredExtension: '.json',
      contentShape: 'external-ref',
      readableRef: `artifact:${id}`,
      previewPolicy: 'inline',
    },
  };
}
