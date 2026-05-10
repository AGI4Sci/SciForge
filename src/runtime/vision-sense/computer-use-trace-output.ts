import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import type { WorkEvidence } from '../gateway/work-evidence-types.js';
import type { ScreenshotRef, TraceWindowTarget } from '../computer-use/types.js';
import { platformLabel, sanitizeId, sha256, workspaceRel } from '../computer-use/utils.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import { visionSenseTraceContractPolicy, visionSenseTraceIds, visionSenseTraceOutputPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { visionSenseTraceOutputViews } from '../../../packages/presentation/interactive-views';
import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';

export const VISION_TOOL_ID = visionSenseTraceIds.tool;
const COMPUTER_USE_CAPABILITY_ID = 'action.sciforge.computer-use';
const COMPUTER_USE_BUDGET_AUDIT_REF = 'audit:vision-sense-computer-use-loop';

type ComputerUseWorkEvidence = WorkEvidence & {
  id: string;
  budgetDebitRefs: string[];
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
}): ToolPayload {
  const traceRel = workspaceRel(params.workspace, params.tracePath);
  const allRefs = params.screenshotRefs;
  const beforeRef = allRefs.find((ref) => ref.id.includes('-before-'));
  const afterRef = [...allRefs].reverse().find((ref) => ref.id.includes('-after-'));
  const isDone = params.status === 'done';
  const executionUnitRef = `EU-vision-sense-${params.runId}`;
  const workEvidenceRef = `workEvidence:vision-sense-computer-use:${params.runId}`;
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
    evidenceRefs: [traceRel, ...[afterRef?.path].filter((ref): ref is string => Boolean(ref))],
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
  return {
    message: isDone
      ? `vision-sense generic Computer Use loop completed ${params.actionCount} action(s). Trace: ${traceRel}.`
      : `vision-sense generic Computer Use loop stopped with failed-with-reason: ${params.failureReason}`,
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
      outputArtifacts: [traceRel],
      artifacts: [traceRel],
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
    artifacts: [{
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
      },
    }],
    logs: [{
      kind: 'capability-budget-debit-audit',
      ref: COMPUTER_USE_BUDGET_AUDIT_REF,
      budgetDebitRefs,
      sinkRefs: budgetDebitRecord.sinkRefs,
    }],
    budgetDebits: [budgetDebitRecord],
  };
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
): ToolPayload {
  const runId = sanitizeId(`generic-cu-blocked-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const expectedTrace = workspaceRel(workspace, join(workspace, '.sciforge', 'vision-runs', runId, 'vision-trace.json'));
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
      supportingRefs: [VISION_TOOL_ID],
      opposingRefs: [],
    }],
    uiManifest: visionSenseTraceOutputViews({
      refs: { execution: visionSenseTraceIds.execution, trace: visionSenseTraceIds.trace },
    }),
    executionUnits: [{
      id: `EU-${runId}`,
      tool: VISION_TOOL_ID,
      status: 'failed-with-reason',
      params: JSON.stringify({ prompt: request.prompt, selectedToolIds: request.selectedToolIds }),
      hash: sha256(Buffer.from(`${runId}:${reason}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'SciForge workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [],
      artifacts: [],
      failureReason: reason,
      routeDecision,
      requiredInputs: ['ScreenCaptureProvider', ...visionSenseTraceOutputPolicy.requiredInputs.slice(1)],
      recoverActions: [...visionSenseTraceOutputPolicy.bridgeRecoverActions],
      nextStep: 'Configure the generic vision loop dependencies, then rerun the same request.',
    }],
    artifacts: [],
  };
}
