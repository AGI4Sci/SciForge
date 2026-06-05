import type { IncomingMessage, ServerResponse } from 'node:http';
import { legacyToolsRunStreamDecision } from './legacy-tools-run-guard.js';
import { createDetachedStreamResponse } from './server/detached-stream.js';
import { isRecord, readJson, writeJson } from './server/http.js';

type HeaderValue = number | string | readonly string[];

export interface LegacyToolsRunStreamCallbacks {
  signal?: AbortSignal;
  onEvent?(event: unknown): void;
}

export type LegacyToolsRunStreamRunner = (
  body: Record<string, unknown>,
  callbacks: LegacyToolsRunStreamCallbacks,
) => Promise<unknown>;

export const LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA = 'sciforge.legacy-tools-run-repair-harness.v1';

export interface LegacyToolsRunSyncDecision {
  allowed: boolean;
  reason: string;
  statusCode: number;
}

interface WorkspaceCorsResponse {
  end(): unknown;
  setHeader(name: string, value: HeaderValue): unknown;
  writeHead(statusCode: number): unknown;
}

export function workspaceRequestUrl(req: Pick<IncomingMessage, 'headers' | 'url'>) {
  return new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
}

export function handleWorkspaceCors(
  req: Pick<IncomingMessage, 'method'>,
  res: WorkspaceCorsResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204);
  res.end();
  return true;
}

export function legacyToolsRunSyncDecision(body: unknown): LegacyToolsRunSyncDecision {
  if (!isRecord(body)) return syncBlocked('legacy sync tools run requires a structured request body');
  const forbidden = forbiddenLegacySyncKeys(body);
  if (forbidden.length) return syncBlocked(`legacy sync tools run repair harness contains forbidden route fields: ${forbidden.join(', ')}`);
  const unexpected = unexpectedLegacySyncKeys(body);
  if (unexpected.length) return syncBlocked(`legacy sync tools run repair harness contains unsupported fields: ${unexpected.join(', ')}`);
  if (body.schemaVersion !== LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA) {
    return syncBlocked('legacy sync tools run is sealed; use Runtime Codex stream for product turns');
  }
  if (body.kind !== 'legacy-agentserver-repair-harness') return syncBlocked('legacy sync tools run only accepts the explicit legacy AgentServer repair harness');
  if (body.repairHarnessOnly !== true || body.handoffSource !== 'test') {
    return syncBlocked('legacy sync tools run repair harness requires repairHarnessOnly=true and handoffSource=test');
  }
  const agentServerBaseUrl = typeof body.agentServerBaseUrl === 'string' ? body.agentServerBaseUrl.trim() : '';
  if (!agentServerBaseUrl) {
    return syncBlocked('legacy sync tools run repair harness requires explicit loopback agentServerBaseUrl');
  }
  if (!loopbackHttpUrl(agentServerBaseUrl)) {
    return syncBlocked('legacy sync tools run repair harness requires loopback agentServerBaseUrl');
  }
  return {
    allowed: true,
    reason: 'legacy-agentserver-repair-harness',
    statusCode: 200,
  };
}

export async function handleLegacyToolsRunStreamRoute(
  req: IncomingMessage,
  res: ServerResponse,
  runTool: LegacyToolsRunStreamRunner,
) {
  try {
    const body = await readJson(req);
    const legacyDecision = legacyToolsRunStreamDecision(body);
    if (!legacyDecision.allowed) {
      writeJson(res, 410, {
        ok: false,
        error: legacyDecision.reason,
        replacementPath: '/api/sciforge/runtime/codex/stream',
      });
      return;
    }
    const stream = createDetachedStreamResponse(res);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const result = await runTool(body, {
      signal: stream.signal,
      onEvent(event) {
        stream.write({ event });
      },
    });
    stream.write({ result });
    stream.end();
  } catch (err) {
    if (!res.headersSent) {
      writeJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const stream = createDetachedStreamResponse(res);
    stream.write({ error: err instanceof Error ? err.message : String(err) });
    stream.end();
  }
}

function syncBlocked(reason: string): LegacyToolsRunSyncDecision {
  return { allowed: false, reason, statusCode: 410 };
}

function forbiddenLegacySyncKeys(value: Record<string, unknown>, prefix = ''): string[] {
  const forbidden = new Set([
    'agentBackend',
    'agentServerProviderAvailability',
    'capabilityProviderAvailability',
    'capabilityProviderRoutes',
    'llmEndpoint',
    'modelName',
    'modelProvider',
    'providerRoute',
    'selectedActionIds',
    'selectedSenseIds',
    'selectedProviderIds',
    'selectedToolIds',
    'toolProviderRoutes',
  ]);
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (forbidden.has(key)) found.push(path);
    if (isRecord(entry)) found.push(...forbiddenLegacySyncKeys(entry, path));
  }
  return found.slice(0, 12);
}

function unexpectedLegacySyncKeys(value: Record<string, unknown>) {
  const allowed = new Set([
    'agentServerBaseUrl',
    'handoffSource',
    'kind',
    'prompt',
    'repairHarnessOnly',
    'schemaVersion',
    'skillDomain',
    'workspacePath',
  ]);
  return Object.keys(value).filter((key) => !allowed.has(key)).slice(0, 12);
}

function loopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');
  } catch {
    return false;
  }
}
