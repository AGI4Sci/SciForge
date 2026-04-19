import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import { makeId, nowIso } from '../domain';
import { normalizeAgentResponse } from './agentClient';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function sendBioAgentToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  callbacks.onEvent?.(toolEvent('project-tool-start', `BioAgent ${input.agentId} project tool started`));
  const response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/bioagent/tools/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: input.agentId,
      prompt: input.prompt,
      workspacePath: input.config.workspacePath,
      roleView: input.roleView,
      artifacts: summarizeArtifacts(input),
    }),
    signal,
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep raw text for the error below.
  }
  if (!response.ok || !isRecord(json) || json.ok !== true) {
    const detail = isRecord(json) ? asString(json.error) || asString(json.message) : undefined;
    throw new Error(detail || `BioAgent project tool failed: HTTP ${response.status}`);
  }
  callbacks.onEvent?.(toolEvent('project-tool-done', `BioAgent ${input.agentId} project tool completed`));
  const result = isRecord(json.result) ? json.result : {};
  return normalizeAgentResponse(input.agentId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: makeId(`project-${input.agentId}`),
        status: 'completed',
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(result),
        },
      },
    },
  });
}

function summarizeArtifacts(input: SendAgentMessageInput) {
  return (input.artifacts ?? []).slice(0, 8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerAgent: artifact.producerAgent,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    data: artifact.data,
  }));
}

function toolEvent(type: string, detail: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail },
  };
}
