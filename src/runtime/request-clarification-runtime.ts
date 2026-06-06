import type { GatewayRequest, ToolPayload } from './runtime-types.js';
import { sha1 } from './workspace-task-runner.js';
import {
  resolveRequestClarificationNeed,
  type RequestClarificationNeed,
} from '@sciforge-ui/runtime-contract/request-clarification-policy';

const TOOL_ID = 'request_clarification' as const;

export function tryRunRequestClarificationRuntime(request: GatewayRequest): ToolPayload | undefined {
  const need = resolveRequestClarificationNeed(request);
  if (!need) return undefined;
  return requestClarificationPayload(request, need);
}

function requestClarificationPayload(request: GatewayRequest, need: RequestClarificationNeed): ToolPayload {
  const id = sha1(`${need.reason}:${request.prompt}`).slice(0, 12);
  return {
    message: need.message,
    confidence: 0.74,
    claimType: 'clarification-request',
    evidenceLevel: 'request-understanding',
    reasoningTrace: [
      'SciForge evaluated the request before runtime execution.',
      `clarificationReason=${need.reason}`,
      'The request is not specific enough to safely choose scope, target, or success criteria.',
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-partial',
      taskOutcome: 'needs-human',
      status: 'needs-human',
      primaryView: 'answer',
      reason: need.reason,
    },
    claims: [{
      id: `claim-request-clarification-${id}`,
      type: 'clarification',
      text: need.message,
      confidence: 0.74,
      evidenceLevel: 'request-understanding',
      supportingRefs: [],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'report-viewer',
      artifactRef: `request-clarification-${id}`,
      title: 'Clarification needed',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-request-clarification-${id}`,
      tool: TOOL_ID,
      status: 'needs-human',
      params: JSON.stringify({ reason: need.reason, prompt: request.prompt.slice(0, 240) }),
      requiredInputs: need.requiredInputs,
      nextStep: 'Wait for the user to clarify the scope or target, then continue.',
      outputRef: `artifact:request-clarification-${id}`,
      hash: id,
    }],
    artifacts: [{
      id: `request-clarification-${id}`,
      type: 'clarification-request',
      format: 'markdown',
      title: 'Clarification needed',
      data: {
        reason: need.reason,
        prompt: request.prompt,
        requiredInputs: need.requiredInputs,
      },
      content: [
        '# Clarification needed',
        '',
        need.message,
      ].join('\n'),
    }],
  };
}
