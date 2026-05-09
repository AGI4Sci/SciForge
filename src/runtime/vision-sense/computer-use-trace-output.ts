import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import type { ScreenshotRef, TraceWindowTarget } from '../computer-use/types.js';
import { platformLabel, sanitizeId, sha256, workspaceRel } from '../computer-use/utils.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
import { visionSenseTraceContractPolicy, visionSenseTraceIds, visionSenseTraceOutputPolicy } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { visionSenseTraceOutputViews } from '../../../packages/presentation/interactive-views';

export const VISION_TOOL_ID = visionSenseTraceIds.tool;

export function genericLoopPayload(params: {
  request: GatewayRequest;
  workspace: string;
  runId: string;
  tracePath: string;
  screenshotRefs: ScreenshotRef[];
  status: 'done' | 'failed-with-reason';
  failureReason: string;
  actionCount: number;
  dryRun: boolean;
  desktopPlatform: string;
  windowTarget?: TraceWindowTarget;
}): ToolPayload {
  const traceRel = workspaceRel(params.workspace, params.tracePath);
  const allRefs = params.screenshotRefs;
  const beforeRef = allRefs.find((ref) => ref.id.includes('-before-'));
  const afterRef = [...allRefs].reverse().find((ref) => ref.id.includes('-after-'));
  const isDone = params.status === 'done';
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
      id: `EU-vision-sense-${params.runId}`,
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
    }],
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
      },
    }],
  };
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
