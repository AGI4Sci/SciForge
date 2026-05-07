import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import type { ScreenshotRef, TraceWindowTarget } from '../computer-use/types.js';
import { platformLabel, sanitizeId, sha256, workspaceRel } from '../computer-use/utils.js';
import { toTraceScreenshotRef } from '../computer-use/capture.js';
export const VISION_TOOL_ID = 'local.vision-sense';

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
      'local.vision-sense was selected and routed to the generic Computer Use loop.',
      'The runtime uses app-agnostic screenshot refs and generic mouse/keyboard action schema.',
      params.failureReason || `Executed ${params.actionCount} generic action(s).`,
      'No app-specific shortcut or AgentServer repository scan was used.',
    ].filter(Boolean).join('\n'),
    claims: [{
      text: isDone
        ? 'SciForge executed generic Computer Use actions and wrote file-ref-only visual memory.'
        : params.failureReason,
      type: isDone ? 'execution' : 'failure',
      confidence: isDone ? 0.72 : 0.35,
      evidenceLevel: 'runtime',
      supportingRefs: [traceRel],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'vision-sense-generic-execution', priority: 1 },
      { componentId: 'unknown-artifact-inspector', title: 'Vision trace', artifactRef: 'vision-sense-trace', priority: 2 },
    ],
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
      routeDecision: { selectedRuntime: 'vision-sense-generic-computer-use-loop', selectedToolId: VISION_TOOL_ID },
      requiredInputs: params.status === 'done' ? undefined : ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
      recoverActions: params.status === 'done' ? undefined : [
        'Provide a generic VisionPlanner that emits the action schema recorded in the trace.',
        'Configure KV-Ground or another Grounder so target descriptions become target-window coordinates.',
        'Keep app-specific APIs out of the primary path; only mouse/keyboard executor actions should be required.',
      ],
    }],
    artifacts: [{
      id: 'vision-sense-trace',
      type: 'vision-trace',
      path: traceRel,
      dataRef: traceRel,
      producerTool: VISION_TOOL_ID,
      schemaVersion: 'sciforge.vision-trace.v1',
      metadata: {
        runId: params.runId,
        imageMemoryPolicy: 'file-ref-only',
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
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'vision-sense-generic-execution', priority: 1 },
    ],
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
      requiredInputs: ['ScreenCaptureProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
      recoverActions: [
        'Enable the generic desktop bridge with SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
        'Configure capture displays with SCIFORGE_VISION_CAPTURE_DISPLAYS=1,2 or visionSense.captureDisplays.',
        'Provide a planner/grounder that emits app-agnostic mouse and keyboard actions.',
      ],
      nextStep: 'Configure the generic vision loop dependencies, then rerun the same request.',
    }],
    artifacts: [],
  };
}
