import type { IncomingMessage, ServerResponse } from 'node:http';
import { CodexExecJsonAdapter } from './codex-exec-json-adapter.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { isRecord, readJson, writeJson } from '../server/http.js';

export async function handleCodexRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  adapter: AgentCliAdapter = new CodexExecJsonAdapter(),
): Promise<boolean> {
  if (url.pathname !== '/api/sciforge/runtime/codex/stream') return false;
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' });
    return true;
  }

  const abort = new AbortController();
  req.on('close', () => abort.abort());
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const body = await readJson(req);
    assertCodexRuntimeRequestBoundary(body);
    const commandText = stringField(body.commandText);
    const workspacePath = stringField(body.workspacePath);
    if (!commandText) throw new Error('commandText is required');
    if (!workspacePath) throw new Error('workspacePath is required');
    const turn = await adapter.startTurn({
      commandText,
      workspacePath,
      profile: stringField(body.profile),
      codexSessionId: stringField(body.codexSessionId) ?? stringField(body.nativeSessionId),
      allowOpenAiRuntime: body.allowOpenAiRuntime === true,
      guiExtension: isRecord(body.guiExtension)
        ? {
          enabled: body.guiExtension.enabled !== false,
          statePath: stringField(body.guiExtension.statePath),
        }
        : undefined,
      abortSignal: abort.signal,
    });
    writeSse(res, 'turn', { turnId: turn.turnId, attemptId: turn.attemptId, codexSessionId: turn.codexSessionId });
    for await (const event of turn.events) {
      writeSse(res, event.type, event);
    }
  } catch (error) {
    writeSse(res, 'error', { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
  return true;
}

export function writeSse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function codexRuntimeBridgeRequested(body: Record<string, unknown>): boolean {
  const uiState = isRecord(body.uiState) ? body.uiState : {};
  return body.runtimeBridge === 'codex-exec-json'
    || body.useCodexRuntimeBridge === true
    || uiState.runtimeBridge === 'codex-exec-json'
    || uiState.useCodexRuntimeBridge === true;
}

const CODEX_RUNTIME_REQUEST_ALLOWED_KEYS = new Set([
  'schemaVersion',
  'commandText',
  'workspacePath',
  'commandId',
  'attemptId',
  'profile',
  'codexSessionId',
  'nativeSessionId',
  'allowOpenAiRuntime',
  'guiExtension',
  'auditMetadata',
]);

const CODEX_RUNTIME_GUI_EXTENSION_ALLOWED_KEYS = new Set([
  'enabled',
  'statePath',
]);

const CODEX_RUNTIME_FORBIDDEN_NESTED_KEYS = new Set([
  'prompt',
  'messages',
  'transcript',
  'sessionMessages',
  'seedMessages',
  'demoMessages',
  'artifacts',
  'artifactBody',
  'artifactData',
  'claims',
  'claim',
  'expectedArtifactTypes',
  'expectedResult',
  'expectedResults',
  'selectedSkillIds',
  'selectedToolIds',
  'toolProviderRoutes',
  'providerRoute',
  'toolRoute',
  'routeDecision',
  'failureRecoveryPolicy',
  'uiState',
  'references',
  'transportAgentContext',
]);

function assertCodexRuntimeRequestBoundary(body: unknown): asserts body is Record<string, unknown> {
  if (!isRecord(body)) throw new Error('Runtime Codex request body must be an object');
  const extraKeys = Object.keys(body).filter((key) => !CODEX_RUNTIME_REQUEST_ALLOWED_KEYS.has(key));
  if (extraKeys.length) {
    throw new Error(`Runtime Codex request contains non-adapter fields: ${extraKeys.join(', ')}`);
  }
  if (isRecord(body.guiExtension)) {
    const extraGuiKeys = Object.keys(body.guiExtension).filter((key) => !CODEX_RUNTIME_GUI_EXTENSION_ALLOWED_KEYS.has(key));
    if (extraGuiKeys.length) {
      throw new Error(`Runtime Codex guiExtension contains non-adapter fields: ${extraGuiKeys.join(', ')}`);
    }
  }
  if (isRecord(body.auditMetadata)) {
    const forbiddenAuditKeys = nestedForbiddenKeys(body.auditMetadata, CODEX_RUNTIME_FORBIDDEN_NESTED_KEYS);
    if (forbiddenAuditKeys.length) {
      throw new Error(`Runtime Codex auditMetadata contains non-adapter fields: ${forbiddenAuditKeys.slice(0, 8).join(', ')}`);
    }
  }
}

function nestedForbiddenKeys(value: unknown, forbiddenKeys: Set<string>, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => nestedForbiddenKeys(item, forbiddenKeys, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const current = path ? `${path}.${key}` : key;
    const hit = forbiddenKeys.has(key) ? [current] : [];
    return [...hit, ...nestedForbiddenKeys(entry, forbiddenKeys, current)];
  });
}
