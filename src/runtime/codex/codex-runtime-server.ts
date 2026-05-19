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
    const commandText = stringField(body.commandText) ?? stringField(body.prompt);
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
    writeSse(res, 'turn', { turnId: turn.turnId, codexSessionId: turn.codexSessionId });
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
