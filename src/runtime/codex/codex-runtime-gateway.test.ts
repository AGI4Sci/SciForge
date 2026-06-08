import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transform } from 'esbuild';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

test('runtime gateway fails closed when Codex completes without a Host final answer', async () => {
  const progressOnlyGateway = await importGatewayWithEvents([
    {
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'operation_progress',
      status: 'running',
      message: 'Codex is still working.',
      timestamp: '2026-06-09T00:00:00.000Z',
      provider: 'codex-app-server',
      model: 'app-server-native',
      profile: 'codex-app-server',
      workspace: '/tmp/sciforge-empty-runtime-gateway',
      commandId: 'codex-empty-answer',
      attemptId: 'codex-empty-answer-attempt-1',
      evidenceRefs: ['audit:codex-runtime:codex-empty-answer:normalized-events'],
    },
    {
      schemaVersion: 'sciforge.codex.normalized-event.v1',
      type: 'done',
      status: 'done',
      timestamp: '2026-06-09T00:00:01.000Z',
      provider: 'codex-app-server',
      model: 'app-server-native',
      profile: 'codex-app-server',
      workspace: '/tmp/sciforge-empty-runtime-gateway',
      commandId: 'codex-empty-answer',
      attemptId: 'codex-empty-answer-attempt-1',
      evidenceRefs: ['audit:codex-runtime:codex-empty-answer:normalized-events'],
    },
  ]);

  const result = await progressOnlyGateway.tryRunCodexRuntimeGateway(runtimeCodexRequest());

  assert.ok(result, 'runtime gateway should handle the Runtime Codex request');
  assert.notEqual(result.message, 'Runtime Codex completed without a text response.');
  assert.equal(result.executionUnits[0]?.status, 'blocked');
  assert.match(JSON.stringify(result), /final-answer-required/);
});

async function importGatewayWithEvents(events: Array<Record<string, unknown>>): Promise<{
  tryRunCodexRuntimeGateway: (
    request: GatewayRequest,
  ) => Promise<ToolPayload | undefined>;
}> {
  const sourcePath = join(currentDir, 'codex-runtime-gateway.ts');
  const source = await readFile(sourcePath, 'utf8');
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    sourcemap: false,
  });
  const adapterModuleUrl = dataModuleUrl(`
    export function createCodexAppServerRuntimeAdapter() {
      return {
        async startTurn() {
          return {
            turnId: 'codex-empty-answer',
            events: (async function* () {
              for (const event of ${JSON.stringify(events)}) yield event;
            })(),
          };
        },
      };
    }
  `);
  const serverModuleUrl = dataModuleUrl(`
    export function codexRuntimeBridgeRequested() {
      return true;
    }
  `);
  const workspaceEventsModuleUrl = dataModuleUrl(`
    export function emitWorkspaceRuntimeEvent(callbacks, event) {
      if (callbacks && typeof callbacks.onEvent === 'function') callbacks.onEvent(event);
    }
  `);
  const code = transformed.code
    .replaceAll('"./codex-runtime-adapter.js"', JSON.stringify(adapterModuleUrl))
    .replaceAll('"./codex-runtime-server.js"', JSON.stringify(serverModuleUrl))
    .replaceAll('"../workspace-runtime-events.js"', JSON.stringify(workspaceEventsModuleUrl));
  return await import(dataModuleUrl(code));
}

function dataModuleUrl(code: string): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

function runtimeCodexRequest(): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: 'Use Runtime Codex.',
    workspacePath: '/tmp/sciforge-empty-runtime-gateway',
    artifacts: [],
    uiState: { runtimeCodexBridge: true },
  };
}
