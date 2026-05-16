import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  JsonRecord,
  JsonValue,
  ScriptableAgentServerCompact,
  ScriptableAgentServerContext,
  ScriptableAgentServerContextWindowState,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerMockOptions,
  ScriptableAgentServerMockScript,
  ScriptableAgentServerMockStep,
  ScriptableAgentServerProvider,
  ScriptableAgentServerRecordedRequest,
  ScriptableAgentServerRunExchange,
  ScriptableAgentServerToolPayload,
} from './types.js';

const defaultSeed = 'sciforge-sa-web-19';
const defaultNow = '2026-05-16T00:00:00.000Z';

export async function startScriptableAgentServerMock(
  options: ScriptableAgentServerMockOptions = {},
): Promise<ScriptableAgentServerMockHandle> {
  let script = options.script;
  let discoveryProviders = options.discovery?.providers ?? defaultProviders();
  const seed = options.seed ?? defaultSeed;
  const fixedNow = options.fixedNow ?? defaultNow;
  const requests: ScriptableAgentServerMockHandle['requests'] = {
    discovery: [],
    context: [],
    compact: [],
    runs: [],
  };

  const digest = (value: unknown) => digestValue(value, seed);
  const server = createServer(async (request, response) => {
    try {
      setCorsHeaders(response);
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/health' || url.pathname === '/api/agent-server/health') {
        writeJson(response, { ok: true, status: 'online', digest: digest({ route: 'health' }) });
        return;
      }

      if (isDiscoveryPath(url.pathname)) {
        requests.discovery.push(url.pathname);
        writeJson(response, discoveryPayload(options.discovery?.rawPayload, discoveryProviders, options.discovery?.workers, digest));
        return;
      }

      if (isContextPath(url.pathname) && request.method === 'GET') {
        const body = recordRequest(requests.context, url.pathname, request.method, {}, digest);
        writeJson(response, contextPayload(options.context, body.digest, digest, fixedNow));
        return;
      }

      if (isCompactPath(url.pathname) && request.method === 'POST') {
        const body = await readJsonBody(request);
        const recorded = recordRequest(requests.compact, url.pathname, request.method, body, digest);
        writeJson(response, compactPayload(options.compact, recorded.digest, digest, fixedNow));
        return;
      }

      if (isRunPath(url.pathname) && request.method === 'POST') {
        const body = await readJsonBody(request);
        const recorded = recordRequest(requests.runs, url.pathname, request.method, body, digest);
        await writeRunStream(response, {
          request: body,
          exchange: { requestIndex: requests.runs.length, path: url.pathname, method: request.method },
          recorded,
          script,
          seed,
          fixedNow,
          defaultToolPayload: options.defaultToolPayload,
        });
        return;
      }

      writeJson(response, { ok: false, error: 'not found', path: url.pathname }, 404);
    } catch (error) {
      writeJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    setScript(nextScript) {
      script = nextScript;
    },
    setDiscoveryProviders(providers) {
      discoveryProviders = providers;
    },
    digest,
    close: () => closeServer(server),
  };
}

export const createScriptableAgentServerMock = startScriptableAgentServerMock;

function isDiscoveryPath(pathname: string) {
  return pathname === '/api/agent-server/tools/manifest'
    || pathname === '/api/agent-server/workers'
    || pathname === '/tools/manifest'
    || pathname === '/workers';
}

function isContextPath(pathname: string) {
  return /^\/api\/agent-server\/agents\/[^/]+\/context$/.test(pathname);
}

function isCompactPath(pathname: string) {
  return pathname === '/api/agent-server/compact'
    || pathname === '/api/agent-server/context/compact'
    || /^\/api\/agent-server\/agents\/[^/]+\/compact$/.test(pathname);
}

function isRunPath(pathname: string) {
  return pathname === '/api/agent-server/runs/stream' || pathname === '/api/agent-server/runs';
}

function discoveryPayload(
  rawPayload: JsonRecord | undefined,
  providers: ScriptableAgentServerProvider[],
  workers: JsonRecord[] | undefined,
  digest: (value: unknown) => string,
): JsonRecord {
  if (rawPayload) return withDigest(rawPayload, digest);
  return withDigest({
    providers: providers.map((provider) => ({
      providerId: provider.providerId ?? provider.id,
      workerId: provider.workerId ?? (provider.id.split('.').slice(0, -1).join('.') || provider.id),
      status: provider.status ?? 'available',
      ...provider,
    })),
    workers: workers ?? [],
  }, digest);
}

function contextPayload(
  context: ScriptableAgentServerContext | undefined,
  requestDigest: string,
  digest: (value: unknown) => string,
  fixedNow: string,
): JsonRecord {
  if (context?.rawPayload) return withDigest(context.rawPayload, digest);
  const state = context?.state ?? defaultContextWindowState();
  return withDigest({
    ok: true,
    data: {
      session: {
        id: context?.sessionId ?? context?.agentId ?? 'mock-agent',
        status: context?.status ?? 'active',
        updatedAt: fixedNow,
      },
      recentTurns: context?.recentTurns ?? [],
      currentWorkEntries: context?.currentWorkEntries ?? [],
      operationalGuidance: context?.operationalGuidance ?? { summary: ['scriptable mock context available'] },
      workBudget: context?.workBudget ?? {
        contextWindowTokens: state.contextWindowTokens ?? 1200,
        contextWindowLimit: state.contextWindowLimit ?? 200000,
        status: state.status ?? 'healthy',
      },
      contextWindowState: state,
      digest: requestDigest,
    },
  }, digest);
}

function compactPayload(
  compact: ScriptableAgentServerCompact | undefined,
  requestDigest: string,
  digest: (value: unknown) => string,
  fixedNow: string,
): JsonRecord {
  if (compact?.rawPayload) return withDigest(compact.rawPayload, digest);
  const before = compact?.before ?? defaultContextWindowState({ status: 'near-limit', contextWindowTokens: 170000, contextWindowRatio: 0.85 });
  const after = compact?.after ?? {
    ...before,
    status: 'healthy' as const,
    contextWindowTokens: 24000,
    contextWindowRatio: 0.12,
    lastCompactedAt: fixedNow,
  };
  return withDigest({
    ok: compact?.status !== 'failed',
    data: {
      id: `compact-${digest({ requestDigest, before, after }).slice(7, 19)}`,
      status: compact?.status ?? 'compacted',
      message: compact?.reason ?? 'Context compacted by scriptable AgentServer mock.',
      state: after,
      before,
      after,
      digest: requestDigest,
    },
    contextCompaction: {
      status: compact?.status ?? 'completed',
      source: 'agentserver',
      backend: after.backend ?? 'codex',
      compactCapability: after.compactCapability ?? 'agentserver',
      reason: compact?.reason ?? 'scriptable-agentserver-mock',
      completedAt: fixedNow,
      auditRefs: [`agentserver://mock/compact/${requestDigest.slice(7, 19)}`],
    },
  }, digest);
}

async function writeRunStream(
  response: ServerResponse,
  input: {
    request: JsonRecord;
    exchange: ScriptableAgentServerRunExchange;
    recorded: ScriptableAgentServerRecordedRequest;
    script: ScriptableAgentServerMockOptions['script'];
    seed: string;
    fixedNow: string;
    defaultToolPayload?: ScriptableAgentServerToolPayload;
  },
) {
  const script = normalizeScript(input.script, input.request, input.exchange);
  const runId = script.runId ?? `mock-run-${digestValue({
    seed: input.seed,
    requestDigest: input.recorded.digest,
    scriptId: script.id,
    requestIndex: input.exchange.requestIndex,
  }, input.seed).slice(7, 19)}`;
  const context = { runId, eventIndex: 0, seed: input.seed, fixedNow: input.fixedNow };
  let terminal: JsonRecord | undefined;
  let lastCheckpointRefs: string[] = [];

  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  for (const step of script.steps) {
    const result = envelopeForStep(step, context, input.defaultToolPayload);
    for (const envelope of result.envelopes) response.write(`${JSON.stringify(envelope)}\n`);
    if (result.checkpointRefs.length) lastCheckpointRefs = result.checkpointRefs;
    if (result.terminal) terminal = result.terminal;
  }

  if (!terminal) {
    const payload = lastCheckpointRefs.length
      ? backgroundToolPayload(lastCheckpointRefs, input.fixedNow)
      : input.defaultToolPayload ?? defaultToolPayload();
    terminal = runResultEnvelope(runId, 'completed', { toolPayload: payload }, input.seed);
  }

  response.end(`${JSON.stringify(terminal)}\n`);
}

function normalizeScript(
  input: ScriptableAgentServerMockOptions['script'],
  request: JsonRecord,
  exchange: ScriptableAgentServerRunExchange,
): ScriptableAgentServerMockScript {
  const resolved = typeof input === 'function' ? input(request, exchange) : input;
  if (Array.isArray(resolved)) return { steps: resolved };
  if (resolved) return resolved;
  return {
    id: 'default',
    steps: [
      { kind: 'status', status: 'running', message: 'scriptable AgentServer mock run started' },
      { kind: 'toolPayload', payload: defaultToolPayload() },
    ],
  };
}

function envelopeForStep(
  step: ScriptableAgentServerMockStep,
  context: { runId: string; eventIndex: number; seed: string; fixedNow: string },
  defaultPayload?: ScriptableAgentServerToolPayload,
): { envelopes: JsonRecord[]; terminal?: JsonRecord; checkpointRefs: string[] } {
  if (step.kind === 'toolPayload') {
    const payload = step.payload ?? defaultPayload ?? defaultToolPayload();
    return { envelopes: [], terminal: runResultEnvelope(context.runId, step.runStatus ?? 'completed', { toolPayload: payload }, context.seed), checkpointRefs: [] };
  }
  if (step.kind === 'failure') {
    const event = streamEvent(context, {
      type: 'status',
      status: 'failed',
      message: step.message,
      code: step.code ?? 'mock-agentserver-failure',
      recoverActions: step.recoverActions ?? [],
      details: step.details ?? {},
    });
    const output = {
      success: false,
      error: step.message,
      failureReason: step.code ?? step.message,
      recoverActions: step.recoverActions ?? [],
      details: step.details ?? {},
    };
    return {
      envelopes: [{ event }],
      terminal: { error: step.message, ...runResultEnvelope(context.runId, step.runStatus ?? 'failed', output, context.seed) },
      checkpointRefs: [],
    };
  }
  if (step.kind === 'degraded') {
    const payload = step.payload ?? degradedToolPayload(step.message, step.reason, step.recoverActions);
    const event = streamEvent(context, {
      type: 'status',
      status: 'degraded-result',
      message: step.message ?? 'AgentServer mock returned a degraded result.',
      reason: step.reason ?? 'mock-degraded',
      recoverActions: step.recoverActions ?? [],
    });
    return {
      envelopes: [{ event }],
      terminal: runResultEnvelope(context.runId, step.runStatus ?? 'completed', { toolPayload: payload }, context.seed),
      checkpointRefs: [],
    };
  }
  if (step.kind === 'backgroundCheckpoint') {
    const event = streamEvent(context, {
      type: 'background-checkpoint',
      status: 'running',
      message: step.message ?? 'Background continuation checkpoint recorded.',
      checkpointRefs: step.checkpointRefs,
      backgroundState: {
        status: 'running',
        checkpointRefs: step.checkpointRefs,
        updatedAt: context.fixedNow,
      },
    });
    return {
      envelopes: [{ event }],
      terminal: step.terminal
        ? runResultEnvelope(context.runId, step.runStatus ?? 'completed', { toolPayload: step.payload ?? backgroundToolPayload(step.checkpointRefs, context.fixedNow) }, context.seed)
        : undefined,
      checkpointRefs: step.checkpointRefs,
    };
  }

  return { envelopes: [{ event: eventForNonTerminalStep(step, context) }], checkpointRefs: [] };
}

function eventForNonTerminalStep(
  step: Exclude<ScriptableAgentServerMockStep, { kind: 'toolPayload' | 'failure' | 'degraded' | 'backgroundCheckpoint' }>,
  context: { runId: string; eventIndex: number; seed: string; fixedNow: string },
): JsonRecord {
  if (step.kind === 'event') return streamEvent(context, step.event);
  if (step.kind === 'status') {
    return streamEvent(context, {
      type: 'status',
      status: step.status ?? 'running',
      message: step.message,
      ...(step.fields ?? {}),
    });
  }
  if (step.kind === 'textDelta') {
    return streamEvent(context, { type: 'text_delta', delta: step.delta, ...(step.fields ?? {}) });
  }
  if (step.kind === 'usage') {
    return streamEvent(context, {
      type: 'usage-update',
      message: step.message ?? 'mock token usage',
      usage: step.usage,
    });
  }
  return streamEvent(context, {
    type: 'contextWindowState',
    contextWindowState: step.state ?? defaultContextWindowState(),
  });
}

function streamEvent(
  context: { runId: string; eventIndex: number; seed: string; fixedNow: string },
  event: JsonRecord,
): JsonRecord {
  context.eventIndex += 1;
  const payload = {
    runId: context.runId,
    sequence: context.eventIndex,
    timestamp: context.fixedNow,
    ...event,
  };
  const digest = digestValue(payload, context.seed);
  return {
    id: `${context.runId}:event-${String(context.eventIndex).padStart(3, '0')}-${digest.slice(7, 15)}`,
    digest,
    ...payload,
  };
}

function runResultEnvelope(runId: string, status: string, output: JsonRecord, seed: string): JsonRecord {
  const run = {
    id: runId,
    status,
    output,
  };
  return {
    result: {
      ok: status !== 'failed',
      data: {
        run: {
          ...run,
          digest: digestValue(run, seed),
        },
      },
    },
  };
}

function defaultProviders(): ScriptableAgentServerProvider[] {
  return [{
    id: 'sciforge.web-worker.web_search',
    providerId: 'sciforge.web-worker.web_search',
    capabilityId: 'web_search',
    workerId: 'sciforge.web-worker',
    status: 'available',
  }, {
    id: 'sciforge.web-worker.web_fetch',
    providerId: 'sciforge.web-worker.web_fetch',
    capabilityId: 'web_fetch',
    workerId: 'sciforge.web-worker',
    status: 'available',
  }];
}

function defaultContextWindowState(overrides: Partial<ScriptableAgentServerContextWindowState> = {}): ScriptableAgentServerContextWindowState {
  return {
    source: 'agentserver',
    backend: 'codex',
    provider: 'mock',
    model: 'scriptable-agentserver-mock',
    status: 'healthy',
    contextWindowTokens: 1200,
    contextWindowLimit: 200000,
    contextWindowRatio: 0.006,
    autoCompactThreshold: 0.82,
    compactCapability: 'agentserver',
    ...overrides,
  };
}

function defaultToolPayload(): ScriptableAgentServerToolPayload {
  return {
    message: 'Scriptable AgentServer mock completed.',
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: 'SA-WEB-19 scriptable AgentServer mock default response.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'EU-scriptable-agentserver-mock', tool: 'agentserver.mock', status: 'done' }],
    artifacts: [],
  };
}

function degradedToolPayload(message?: string, reason?: string, recoverActions: string[] = []): ScriptableAgentServerToolPayload {
  const visibleMessage = message ?? 'AgentServer mock returned a degraded result with recoverable refs.';
  return {
    message: visibleMessage,
    confidence: 0.62,
    claimType: 'limitation',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: reason ?? 'mock-degraded',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: 'degraded-result',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: 'scriptable-agentserver-mock',
        visibleAnswer: {
          status: 'degraded-result',
          text: visibleMessage,
          artifactRefs: [],
          diagnostic: reason ?? 'mock-degraded',
        },
        activeRun: { id: 'scriptable-agentserver-mock', status: 'degraded-result' },
        artifacts: [],
        executionProcess: [],
        recoverActions,
        diagnostics: [{
          severity: 'warning',
          code: reason ?? 'mock-degraded',
          message: visibleMessage,
          refs: [],
        }],
        auditRefs: ['agentserver://mock/degraded'],
      },
    },
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-scriptable-agentserver-degraded',
      tool: 'agentserver.mock',
      status: 'repair-needed',
      failureReason: reason ?? 'mock-degraded',
      recoverActions,
    }],
    artifacts: [],
  };
}

function backgroundToolPayload(checkpointRefs: string[], fixedNow: string): ScriptableAgentServerToolPayload {
  return {
    message: 'Background continuation checkpoint recorded.',
    confidence: 0.74,
    claimType: 'status',
    evidenceLevel: 'mock-agentserver',
    reasoningTrace: 'mock-background-checkpoint',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'partial',
      status: 'background-running',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: 'scriptable-agentserver-mock',
        visibleAnswer: {
          status: 'background-running',
          text: 'Background continuation is running from checkpoint refs.',
          artifactRefs: checkpointRefs,
        },
        activeRun: { id: 'scriptable-agentserver-mock', status: 'background-running' },
        artifacts: checkpointRefs.map((ref) => ({ id: ref, type: 'checkpoint', ref })),
        executionProcess: [],
        recoverActions: ['Resume from checkpoint refs'],
        backgroundState: {
          status: 'running',
          checkpointRefs,
          updatedAt: fixedNow,
        },
        auditRefs: checkpointRefs,
      },
    },
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-scriptable-agentserver-background',
      tool: 'agentserver.mock.background',
      status: 'running',
      outputRef: checkpointRefs[0] ?? 'checkpoint:scriptable-agentserver-mock',
    }],
    artifacts: [],
  };
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  return isJsonRecord(parsed) ? parsed : { value: toJsonValue(parsed) };
}

function recordRequest(
  target: ScriptableAgentServerRecordedRequest[],
  path: string,
  method: string,
  body: JsonRecord,
  digest: (value: unknown) => string,
) {
  const recorded = { path, method, body, digest: digest({ path, method, body }) };
  target.push(recorded);
  return recorded;
}

function writeJson(response: ServerResponse, payload: JsonRecord, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function withDigest<T extends JsonRecord>(payload: T, digest: (value: unknown) => string): T & { digest: string } {
  return { ...payload, digest: digest(payload) };
}

function digestValue(value: unknown, seed: string) {
  return `sha256:${createHash('sha256').update(`${seed}:${canonicalJson(value)}`).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: JsonRecord = {};
    for (const key of Object.keys(record).sort()) {
      const nested = record[key];
      if (typeof nested !== 'undefined') output[key] = canonicalize(nested);
    }
    return output;
  }
  return String(value);
}

function toJsonValue(value: unknown): JsonValue {
  return canonicalize(value);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
