import { nowIso, type AgentStreamEvent, type SendAgentMessageInput } from '../../domain';
import { DEFAULT_AGENT_SERVER_URL } from '@sciforge-ui/runtime-contract/handoff';
import { SCENARIO_SPECS } from '../../scenarioSpecs';
import { builtInScenarioIdForInput, normalizeAgentBackend } from './runtimeConfig';
import { compactCapabilityForBackend, normalizeContextCompaction } from './contextTelemetry';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function compactAgentContext(input: SendAgentMessageInput, reason: string, signal?: AbortSignal): Promise<NonNullable<AgentStreamEvent['contextCompaction']>> {
  const baseUrl = (input.config.agentServerBaseUrl || DEFAULT_AGENT_SERVER_URL).replace(/\/+$/, '');
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const scenario = SCENARIO_SPECS[builtInScenarioId];
  const payload = {
    reason,
    project: 'SciForge',
    source: 'sciforge-web-ui',
    agent: {
      id: scenario.runtimeId,
      backend: normalizeAgentBackend(input.config.agentBackend),
      workspace: input.config.workspacePath,
    },
    contextPolicy: {
      includeCurrentWork: Boolean(input.sessionId),
      includeRecentTurns: Boolean(input.sessionId),
      persistRunSummary: true,
    },
    mode: 'auto',
    decisionBy: 'agent',
    metadata: {
      sessionId: input.sessionId,
      scenarioId: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      modelProvider: input.config.modelProvider,
      modelName: input.config.modelName,
    },
  };
  const endpoints = [
    `${baseUrl}/api/agent-server/compact`,
    `${baseUrl}/api/agent-server/context/compact`,
    `${baseUrl}/api/agent-server/agents/${encodeURIComponent(scenario.runtimeId)}/compact`,
  ];
  const errors: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        errors.push(`${response.status} ${endpoint}`);
        continue;
      }
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) as unknown : {};
      } catch {
        json = { message: text };
      }
      if (isRecord(json) && 'data' in json && json.data === null) {
        return {
          status: 'skipped',
          source: 'agentserver',
          backend: input.config.agentBackend,
          compactCapability: compactCapabilityForBackend(input.config.agentBackend),
          completedAt: nowIso(),
          reason,
          message: 'AgentServer compact returned no compaction tag; current backend/session did not find compressible work.',
          auditRefs: [`agentserver-compact:no-op:${input.sessionId ?? 'no-session'}:${reason}`],
        };
      }
      const data = isRecord(json) && isRecord(json.data) ? json.data : json;
      const event = normalizeContextCompaction(isRecord(data) ? data.contextCompaction ?? data.compaction ?? data : data, 'contextCompaction', isRecord(data) ? data : {});
      return event ?? {
        status: 'completed',
        source: 'agentserver',
        backend: input.config.agentBackend,
        compactCapability: 'agentserver',
        completedAt: nowIso(),
        lastCompactedAt: nowIso(),
        reason,
        auditRefs: [`agentserver-compact:${input.sessionId ?? 'no-session'}:${reason}`],
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    status: 'skipped',
    source: 'unknown',
    backend: input.config.agentBackend,
    compactCapability: 'unknown',
    reason,
    message: `AgentServer compact API unavailable: ${errors.slice(0, 2).join('; ') || 'no endpoint responded'}`,
    auditRefs: [`agentserver-compact-unavailable:${input.sessionId ?? 'no-session'}:${reason}`],
  };
}
