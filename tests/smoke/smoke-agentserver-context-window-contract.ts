import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { readRecentTaskAttempts } from '../../src/runtime/task-attempt-history.js';

const AGENT_BACKENDS = ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'] as const;
type AgentBackend = typeof AGENT_BACKENDS[number];

const stateReadsByBackend = new Map<AgentBackend, number>();
const compactionsByBackend = new Map<AgentBackend, number>();
const compactRequestsByBackend = new Map<AgentBackend, Record<string, unknown>[]>();
const dispatchMetadataByBackend = new Map<AgentBackend, Record<string, unknown>>();
const contextEventsByBackend = new Map<AgentBackend, Array<Record<string, unknown>>>();
const compactionEventsByBackend = new Map<AgentBackend, Array<Record<string, unknown>>>();
const rateLimitEventsByBackend = new Map<AgentBackend, Array<Record<string, unknown>>>();
const recoveryDispatchesByKey = new Map<string, number>();
let activeBackend: AgentBackend = 'codex';
let recoveryMode: '' | 'success' | 'failure' = '';

const server = createServer(async (req, res) => {
  const url = String(req.url || '');
  if (req.method === 'GET' && url.includes('/api/agent-server/agents/') && url.endsWith('/context')) {
    const backend = activeBackend;
    stateReadsByBackend.set(backend, (stateReadsByBackend.get(backend) ?? 0) + 1);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: backend === 'hermes-agent' ? {
        session: { id: `context-window-${backend}`, status: 'active' },
        hermes: {
          context_compressor: {
            context_length: 91_000,
            max_context_length: 100_000,
            compression_threshold: 0.82,
            status: 'near-limit',
            prompt_tokens: 86_000,
            completion_tokens: 4_000,
            cache_read: 1_000,
          },
          rate_limit: {
            limited: false,
            rate_limit_reset_at: '2026-05-02T02:30:00.000Z',
          },
        },
        recentTurns: [],
        currentWorkEntries: [],
      } : {
        session: { id: `context-window-${backend}`, status: 'active' },
        contextWindow: {
          tokens: 91_000,
          limit: 100_000,
          ratio: 0.91,
          autoCompactThreshold: 0.82,
          status: 'near-limit',
        },
        workBudget: { status: 'near-limit', approxCurrentWorkTokens: 91_000 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }
  if (req.method === 'POST' && url.includes('/api/agent-server/agents/') && url.endsWith('/compact')) {
    const backend = activeBackend;
    const body = await readJson(req);
    compactRequestsByBackend.set(backend, [...(compactRequestsByBackend.get(backend) ?? []), body]);
    compactionsByBackend.set(backend, (compactionsByBackend.get(backend) ?? 0) + 1);
    if (backend === 'openclaw') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'compact unavailable for compatibility backend' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        message: `compacted ${backend}`,
        state: backend === 'hermes-agent' ? {
          context_compressor: {
            context_length: 24_000,
            max_context_length: 100_000,
            compression_threshold: 0.82,
            status: 'healthy',
            last_compressed_at: '2026-05-02T02:00:00.000Z',
          },
        } : {
          contextWindow: {
            tokens: 24_000,
            limit: 100_000,
            ratio: 0.24,
            autoCompactThreshold: 0.82,
            status: 'healthy',
          },
        },
      },
    }));
    return;
  }
  if (req.method !== 'POST' || url !== '/api/agent-server/runs/stream') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }

  const body = await readJson(req);
  const agent = isRecord(body.agent) ? body.agent : {};
  const input = isRecord(body.input) ? body.input : {};
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const text = typeof input.text === 'string' ? input.text : '';
  const backend = String(agent.backend || '') as AgentBackend;
  assert.ok(AGENT_BACKENDS.includes(backend));
  dispatchMetadataByBackend.set(backend, metadata);
  const recoveryScenario = text.includes('compact retry success')
    ? 'success'
    : text.includes('compact retry failure')
      ? 'failure'
      : recoveryMode;
  if (recoveryScenario) {
    const recoveryKey = `${backend}:${recoveryScenario}`;
    const count = (recoveryDispatchesByKey.get(recoveryKey) ?? 0) + 1;
    recoveryDispatchesByKey.set(recoveryKey, count);
    if (count === 1 || recoveryScenario === 'failure') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end(JSON.stringify({ error: `contextWindowExceeded: mocked ${recoveryScenario} overflow for ${backend}` }) + '\n');
      return;
    }
    const result = {
      ok: true,
      data: {
        run: {
          id: `context-window-recovered-${backend}`,
          status: 'completed',
          output: { result: directPayload(`${backend}-recovered`) },
        },
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ result }) + '\n');
    return;
  }

  const result = {
    ok: true,
    data: {
      run: {
        id: `context-window-contract-${backend}`,
        status: 'completed',
        output: { result: directPayload(backend) },
      },
    },
  };
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  const eventLines = backend === 'hermes-agent'
    ? [
        {
          event: {
            type: 'context_compressor',
            backend,
            context_compressor: {
              context_length: 73_000,
              max_context_length: 100_000,
              compression_threshold: 0.82,
              status: 'watch',
              last_compressed_at: '2026-05-02T02:01:00.000Z',
            },
          },
        },
        {
          event: {
            type: 'rate_limit',
            backend,
            rate_limit: {
              limited: false,
              rate_limit_reset_at: '2026-05-02T02:30:00.000Z',
            },
          },
        },
      ].map((line) => JSON.stringify(line)).join('\n') + '\n'
    : '';
  res.end(eventLines + JSON.stringify({ result }) + '\n');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  for (const backend of AGENT_BACKENDS) {
    activeBackend = backend;
    const workspace = await mkdtemp(join(tmpdir(), `bioagent-context-window-${backend}-`));
    const events: Array<Record<string, unknown>> = [];
    const payload = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      agentBackend: backend,
      modelName: 'gpt-5',
      workspacePath: workspace,
      agentServerBaseUrl: baseUrl,
      prompt: `T057 context window contract smoke for ${backend}`,
      expectedArtifactTypes: ['research-report'],
      artifacts: [{ id: 'prior-report', type: 'research-report', dataRef: '.bioagent/artifacts/prior-report.json' }],
      uiState: {
        sessionId: `context-window-${backend}`,
        currentPrompt: `T057 context window contract smoke for ${backend}`,
        recentConversation: ['user: previous turn', 'assistant: previous answer'],
        recentExecutionRefs: [{ id: 'prior-run', status: 'done', outputRef: '.bioagent/task-results/prior.json' }],
        forceAgentServerGeneration: true,
      },
    }, {
      onEvent: (event) => {
        if (event.contextWindowState && isRecord(event.contextWindowState)) {
          events.push(event.contextWindowState);
        }
        if (event.type === 'contextCompaction' && isRecord(event.contextCompaction)) {
          compactionEventsByBackend.set(backend, [...(compactionEventsByBackend.get(backend) ?? []), event.contextCompaction]);
        }
        if (event.type === 'rateLimit' && isRecord(event.rateLimit)) {
          rateLimitEventsByBackend.set(backend, [...(rateLimitEventsByBackend.get(backend) ?? []), event.rateLimit]);
        }
      },
    });
    contextEventsByBackend.set(backend, events);
    assert.match(payload.message, new RegExp(backend.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const backend of AGENT_BACKENDS) {
    assert.ok((stateReadsByBackend.get(backend) ?? 0) >= 1, `${backend} should read context window state before dispatch`);
    assert.equal(compactionsByBackend.get(backend), 1, `${backend} should attempt preflight compaction near limit`);
    const metadata = dispatchMetadataByBackend.get(backend);
    assert.ok(metadata, `${backend} should dispatch after preflight`);
    const capabilities = isRecord(metadata.backendCapabilities) ? metadata.backendCapabilities : {};
    assert.equal(typeof capabilities.contextWindowTelemetry, 'boolean');
    assert.equal(typeof capabilities.nativeCompaction, 'boolean');
    assert.equal(typeof capabilities.compactionDuringTurn, 'boolean');
    assert.equal(typeof capabilities.rateLimitTelemetry, 'boolean');
    assert.equal(typeof capabilities.sessionRotationSafe, 'boolean');
    const contextWindow = isRecord(metadata.contextWindow) ? metadata.contextWindow : {};
    assert.equal(contextWindow.status, backend === 'openclaw' ? 'watch' : 'healthy');
    assert.equal(contextWindow.backend, backend);
    assert.equal(typeof contextWindow.usedTokens, 'number');
    assert.equal(typeof contextWindow.window, 'number');
    assert.equal(typeof contextWindow.ratio, 'number');
    assert.ok(['native', 'agentserver-estimate'].includes(String(contextWindow.source)), `${backend} should use a unified context source`);
    assert.ok(['native', 'agentserver', 'handoff-only', 'session-rotate', 'none'].includes(String(contextWindow.compactCapability)));
    if (backend === 'gemini') {
      assert.equal(contextWindow.compactCapability, 'session-rotate', 'Gemini should be marked as AgentServer/session-rotate fallback when native compact/reset is not exposed');
      assert.equal(capabilities.nativeCompaction, false, 'Gemini SDK/API has no native compact/reset capability in the current adapter surface');
      assert.equal(capabilities.sessionRotationSafe, true, 'Gemini fallback should be safe to recover by rotating SDK sessions');
    }
    if (backend === 'hermes-agent') {
      assert.equal(contextWindow.source, 'native', 'Hermes context_compressor telemetry should normalize as native source');
      assert.equal(contextWindow.compactCapability, 'native', 'Hermes context compressor should keep native compact capability');
    }
    if (backend === 'openteam_agent') {
      assert.equal(contextWindow.compactCapability, 'agentserver', 'OpenTeam should use AgentServer managed session/current-work compaction');
      assert.equal(capabilities.nativeCompaction, false, 'OpenTeam managed compaction is exposed through AgentServer, not a separate native backend API');
      const compactRequest = compactRequestsByBackend.get(backend)?.[0] ?? {};
      assert.equal(compactRequest.backend, 'openteam_agent');
      assert.equal(compactRequest.compactionScope, 'session-current-work');
      assert.equal(compactRequest.strategy, 'agentserver-session-current-work');
      assert.ok(isRecord(compactRequest.contextWindow), 'OpenTeam compact should carry the preflight context window state into AgentServer');
    }
    const contextCompaction = isRecord(metadata.contextCompaction) ? metadata.contextCompaction : {};
    assert.equal(contextCompaction.ok, backend !== 'openclaw');
    assert.equal(contextCompaction.strategy, backend === 'openclaw' ? 'handoff-slimming' : capabilities.nativeCompaction ? 'native' : 'agentserver');
    if (backend === 'openclaw') {
      assert.equal(contextCompaction.status, 'skipped', 'OpenClaw compact endpoint 404 should be surfaced as skipped for UI compaction state');
      assert.equal(capabilities.nativeCompaction, false, 'OpenClaw compatibility backend should not pretend native compact succeeded');
      assert.equal(contextWindow.compactCapability, 'handoff-only', 'OpenClaw without native compact should be handoff-only');
      assert.ok(Array.isArray(contextCompaction.auditRefs) && contextCompaction.auditRefs.length > 0, 'OpenClaw unsupported compact should carry audit refs');
      assert.match(String(contextCompaction.message || ''), /compact unavailable|no native compaction|handoff/i);
    } else {
      assert.equal(contextCompaction.status, 'completed');
    }
    const contextEvents = contextEventsByBackend.get(backend) ?? [];
    const slimmedEvent = contextEvents.find((event) => isRecord(event.budget) && Array.isArray(event.auditRefs) && event.auditRefs.length > 0);
    assert.ok(slimmedEvent, `${backend} should emit refreshed context window state after handoff slimming`);
    assert.equal(slimmedEvent.source, 'estimate');
    assert.equal(typeof slimmedEvent.usedTokens, 'number');
    assert.equal(typeof slimmedEvent.windowTokens, 'number');
    assert.equal(typeof slimmedEvent.ratio, 'number');
    const budget = slimmedEvent.budget as Record<string, unknown>;
    assert.equal(typeof budget.rawRef, 'string');
    assert.equal(typeof budget.normalizedTokens, 'number');
    assert.ok(
      Number(budget.normalizedTokens) <= Number(budget.rawTokens) || Number(budget.savedTokens) >= 0,
      `${backend} handoff context tokens should shrink or emit a refreshed budget audit`,
    );
  }
  const hermesNativeEvents = contextEventsByBackend.get('hermes-agent') ?? [];
  assert.ok(hermesNativeEvents.some((event) => event.source === 'native'), 'Hermes compat context_compressor event should normalize to contextWindowState');
  assert.ok((compactionEventsByBackend.get('hermes-agent') ?? []).some((event) => event.status === 'completed' && event.compactCapability === 'native'), 'Hermes compat compressor event should normalize to contextCompaction');
  assert.ok((rateLimitEventsByBackend.get('hermes-agent') ?? []).some((event) => event.resetAt === '2026-05-02T02:30:00.000Z'), 'Hermes compat rate-limit reset should normalize to rateLimit event');

  activeBackend = 'openteam_agent';
  const recoverySuccessWorkspace = await mkdtemp(join(tmpdir(), 'bioagent-openteam-context-window-retry-success-'));
  const recoveryEvents: Record<string, unknown>[] = [];
  recoveryMode = 'success';
  const recovered = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    agentBackend: 'openteam_agent',
    modelName: 'gpt-5',
    workspacePath: recoverySuccessWorkspace,
    agentServerBaseUrl: baseUrl,
    prompt: 'T057 openteam_agent context window compact retry success',
    expectedArtifactTypes: ['research-report'],
    artifacts: [],
    uiState: { forceAgentServerGeneration: true },
  }, {
    onEvent: (event) => recoveryEvents.push(event as unknown as Record<string, unknown>),
  });
  recoveryMode = '';
  assert.match(recovered.message, /context window contract smoke/i);
  assert.equal(recoveryDispatchesByKey.get('openteam_agent:success'), 2, 'contextWindowExceeded recovery should dispatch exactly twice on success');
  assert.ok((compactionsByBackend.get('openteam_agent') ?? 0) >= 3, 'OpenTeam success recovery should compact during preflight and after contextWindowExceeded');
  assert.ok((compactRequestsByBackend.get('openteam_agent') ?? []).some((request) =>
    String(request.reason || '').startsWith('contextWindowExceeded:')
    && request.compactionScope === 'session-current-work'
    && request.strategy === 'agentserver-session-current-work'
  ), 'OpenTeam contextWindowExceeded recovery should use AgentServer session/current-work compaction');
  assert.ok(recoveryEvents.some((event) => event.type === 'agentserver-context-window-recovery' && event.status === 'completed'));
  const successAttempts = await readRecentTaskAttempts(recoverySuccessWorkspace, 'literature', 8);
  assert.ok(successAttempts.some((attempt) => attempt.contextRecovery?.retrySucceeded === true), 'successful retry should be written to attempt audit');

  for (const backend of AGENT_BACKENDS) {
    activeBackend = backend;
    const recoveryFailureWorkspace = await mkdtemp(join(tmpdir(), `bioagent-${backend}-context-window-retry-failure-`));
    recoveryMode = 'failure';
    const failed = await runWorkspaceRuntimeGateway({
      skillDomain: 'literature',
      agentBackend: backend,
      modelName: 'gpt-5',
      workspacePath: recoveryFailureWorkspace,
      agentServerBaseUrl: baseUrl,
      prompt: `T057 ${backend} context window compact retry failure`,
      expectedArtifactTypes: ['research-report'],
      artifacts: [],
      uiState: { forceAgentServerGeneration: true },
    });
    recoveryMode = '';
    assert.equal(recoveryDispatchesByKey.get(`${backend}:failure`), 2, `${backend} contextWindowExceeded recovery should not retry more than once`);
    assert.ok((stateReadsByBackend.get(backend) ?? 0) >= 1, `${backend} recovery should read context window state or fallback before retry`);
    assert.ok((compactRequestsByBackend.get(backend) ?? []).some((request) =>
      String(request.reason || '').startsWith('contextWindowExceeded:')
    ), `${backend} recovery should attempt compact/fallback after contextWindowExceeded`);
    const failedUnit = failed.executionUnits.find((unit) => isRecord(unit) && unit.status === 'repair-needed') as Record<string, unknown> | undefined;
    assert.ok(failedUnit, `${backend} failed recovery should return repair-needed execution unit`);
    assert.equal(failedUnit.blocker, 'contextWindowExceeded');
    assert.match(String(failedUnit.failureReason || ''), /contextWindowExceeded|retryResult=failed/);
    const refs = isRecord(failedUnit.refs) ? failedUnit.refs : {};
    assert.equal(refs.backend, backend);
    assert.ok(typeof refs.provider === 'string' && refs.provider.length > 0, `${backend} failed recovery should include provider ref`);
    assert.match(String(refs.sessionRef || ''), /\/api\/agent-server\/agents\/bioagent-literature-/);
    assert.ok(isRecord(refs.compactResult), `${backend} failed recovery should include compact result refs`);
    const compactResult = refs.compactResult as Record<string, unknown>;
    if (backend === 'openclaw') {
      assert.equal(compactResult.status, 'unsupported');
      assert.equal(compactResult.strategy, 'handoff-slimming');
      assert.ok(Array.isArray(compactResult.auditRefs) && compactResult.auditRefs.length > 0, 'OpenClaw recovery should expose unsupported compact audit refs');
      assert.match(String(failedUnit.failureReason || ''), /unsupported|handoff-slimming/);
    }
    if (backend === 'gemini') {
      assert.equal(compactResult.strategy, 'agentserver', 'Gemini should use AgentServer compact plus session-rotate capability fallback, not native compact');
      assert.equal(isRecord(compactResult.after) ? compactResult.after.compactCapability : undefined, 'session-rotate');
    }
    assert.ok((failedUnit.recoverActions as string[] | undefined)?.some((action) => /context compaction|larger context|reducing artifacts/i.test(action)), `${backend} final failure should include recovery actions`);
    const failedAttempts = await readRecentTaskAttempts(recoveryFailureWorkspace, 'literature', 8);
    assert.ok(failedAttempts.some((attempt) => attempt.contextRecovery?.retryAttempted === true && attempt.contextRecovery.retrySucceeded === false), `${backend} failed retry should be written to attempt audit`);
  }

  console.log('[ok] AgentServer context window contract normalizes backend telemetry, preflight compaction, and handoff fallback');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function directPayload(backend: string) {
  return {
    message: `${backend} completed context window contract smoke.`,
    confidence: 0.82,
    claimType: 'contract-smoke',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: `${backend} received a normalized AgentServer context preflight.`,
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 }],
    executionUnits: [{ id: `${backend}-context-window`, status: 'record-only', tool: `agentserver.${backend}.context-window` }],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      schemaVersion: '1',
      data: { markdown: `${backend} context window contract smoke passed.` },
    }],
  };
}

async function readJson(req: AsyncIterable<Buffer | string>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
