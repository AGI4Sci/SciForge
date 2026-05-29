import type { SendAgentMessageInput } from '../../domain';

export function createSseResponse(body: string | string[]): Response {
  return new Response(Array.isArray(body) ? body.join('') : body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

export function createNdjsonResponse(entries: unknown[] | string): Response {
  return new Response(typeof entries === 'string' ? entries : entries.map((entry) => JSON.stringify(entry)).join('\n'), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

export function runtimeRequestInput(): SendAgentMessageInput {
  return {
    sessionId: 'session-test',
    scenarioId: 'literature-evidence-review',
    agentName: 'Literature',
    agentDomain: 'literature',
    prompt: 'Summarize current context',
    references: [{
      id: 'ref-report',
      kind: 'task-result',
      title: 'Report',
      ref: 'artifact:report-1',
      payload: { selectedText: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    roleView: 'researcher',
    messages: [{
      id: 'seed-demo',
      role: 'scenario',
      content: 'SEED_MESSAGE_SHOULD_NOT_LEAK',
      createdAt: '2026-05-19T00:00:00.000Z',
      status: 'completed',
    }],
    artifacts: [{
      id: 'report-1',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: 'ARTIFACT_BODY_SHOULD_NOT_LEAK' },
    }],
    claims: [{
      id: 'claim-1',
      text: 'CLAIM_BODY_SHOULD_NOT_LEAK',
      type: 'inference',
      confidence: 0.8,
      evidenceLevel: 'review',
    }],
    executionUnits: [],
    runs: [],
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/tmp/current',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 60_000,
      maxContextWindowTokens: 200000,
      visionAllowSharedSystemInput: true,
      updatedAt: '2026-05-19T00:00:00.000Z',
    },
    scenarioOverride: {
      title: 'Test scenario',
      description: 'Test scenario override',
      skillDomain: 'literature',
      scenarioMarkdown: '# Test',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      selectedSkillIds: ['legacy.skill'],
      toolProviderRoutes: {
        web: { source: 'mcp', endpoint: 'http://127.0.0.1:7777/mcp' },
      },
      failureRecoveryPolicy: {
        mode: 'preserve-context',
      },
    },
    availableComponentIds: ['report-viewer'],
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1', source: 'built-in' },
    skillPlanRef: 'skill-plan.test',
    uiPlanRef: 'ui-plan.test',
  };
}

export function recursiveForbiddenKeys(value: unknown, forbiddenKeys: string[], path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => recursiveForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbiddenKeys.includes(key) ? [current] : [];
    return [...hit, ...recursiveForbiddenKeys(entry, forbiddenKeys, current)];
  });
}
