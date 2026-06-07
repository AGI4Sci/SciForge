import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { LEGACY_TOOLS_RUN_STREAM_SCHEMA } from './legacy-tools-run-guard.js';
import {
  LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
  handleLegacyToolsRunStreamRoute,
  handleWorkspaceCors,
  legacyToolsRunSyncDecision,
  workspaceRequestUrl,
} from './workspace-server-http.js';

test('workspaceRequestUrl preserves host, path, and query string', () => {
  const url = workspaceRequestUrl({
    headers: { host: 'localhost:4876' },
    url: '/api/sciforge/config?workspacePath=%2Ftmp%2Fwork',
  });

  assert.equal(url.origin, 'http://localhost:4876');
  assert.equal(url.pathname, '/api/sciforge/config');
  assert.equal(url.searchParams.get('workspacePath'), '/tmp/work');
});

test('workspaceRequestUrl falls back to loopback host for missing Host header', () => {
  const url = workspaceRequestUrl({ headers: {}, url: undefined });

  assert.equal(url.origin, 'http://127.0.0.1');
  assert.equal(url.pathname, '/');
});

test('handleWorkspaceCors records headers without ending non-OPTIONS requests', () => {
  const response = createCorsResponse();

  assert.equal(handleWorkspaceCors({ method: 'POST' }, response), false);
  assert.equal(response.status, undefined);
  assert.equal(response.ended, false);
  assert.deepEqual(response.headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
});

test('handleWorkspaceCors answers OPTIONS preflight with 204', () => {
  const response = createCorsResponse();

  assert.equal(handleWorkspaceCors({ method: 'OPTIONS' }, response), true);
  assert.equal(response.status, 204);
  assert.equal(response.ended, true);
  assert.deepEqual(response.headers, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
});

test('/api/sciforge/tools/run/stream route returns 410 for ordinary payloads before running tools', async () => {
  let runs = 0;
  const server = await startLegacyToolsRunStreamRouteServer(async () => {
    runs += 1;
    return { status: 'unexpected' };
  });
  try {
    const response = await postLegacyToolsRunStream(server, {
      skillDomain: 'knowledge',
      prompt: 'Summarize this workspace',
      workspacePath: '/tmp/workspace',
    });
    const body = await response.json() as Record<string, unknown>;

    assert.equal(response.status, 410);
    assert.equal(body.ok, false);
    assert.match(String(body.error), /Runtime Codex stream/);
    assert.equal(body.replacementPath, '/api/sciforge/runtime/codex/stream');
    assert.equal(runs, 0);
  } finally {
    await closeServer(server);
  }
});

test('/api/sciforge/tools/run/stream route allows explicit diagnostic shims into NDJSON stream', async () => {
  const server = await startLegacyToolsRunStreamRouteServer(async (body, callbacks) => {
    assert.equal(body.kind, 'legacy-diagnostic-shim');
    callbacks.onEvent?.({ type: 'current-plan', detail: 'entered legacy diagnostic route' });
    return { status: 'ok', mode: 'diagnostic' };
  });
  try {
    const response = await postLegacyToolsRunStream(server, {
      schemaVersion: LEGACY_TOOLS_RUN_STREAM_SCHEMA,
      kind: 'legacy-diagnostic-shim',
      diagnosticOnly: true,
      prompt: '/computer-use diagnostic --legacy-workspace-gateway inspect refs',
      workspacePath: '/tmp/workspace',
      uiState: {
        diagnosticOnly: true,
        legacyWorkspaceGatewayShim: true,
      },
    });
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    assert.deepEqual(lines, [
      { event: { type: 'current-plan', detail: 'entered legacy diagnostic route' } },
      { result: { status: 'ok', mode: 'diagnostic' } },
    ]);
  } finally {
    await closeServer(server);
  }
});

test('legacy sync tools run guard blocks ordinary payloads before running old gateway', () => {
  const decision = legacyToolsRunSyncDecision({
    prompt: 'Summarize the workspace',
    workspacePath: '/tmp/workspace',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.statusCode, 410);
  assert.match(decision.reason, /Runtime Codex stream/);
});

test('legacy sync tools run guard rejects retired repair harness payloads even with explicit loopback', () => {
  const explicitHarness = legacyToolsRunSyncDecision({
    schemaVersion: LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
    kind: 'legacy-agentserver-repair-harness',
    repairHarnessOnly: true,
    handoffSource: 'test',
    agentServerBaseUrl: 'http://127.0.0.1:43111',
    workspacePath: '/tmp/workspace',
  });
  assert.equal(explicitHarness.allowed, false);
  assert.equal(explicitHarness.statusCode, 410);
  assert.match(explicitHarness.reason, /retired/);

  const routed = legacyToolsRunSyncDecision({
    schemaVersion: LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
    kind: 'legacy-agentserver-repair-harness',
    repairHarnessOnly: true,
    handoffSource: 'test',
    agentServerBaseUrl: 'http://127.0.0.1:43111',
    selectedToolIds: ['action.sciforge.computer-use'],
  });
  assert.equal(routed.allowed, false);
  assert.equal(routed.statusCode, 410);
  assert.match(routed.reason, /forbidden route fields/);

  const nestedProviderRoutes = legacyToolsRunSyncDecision({
    schemaVersion: LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
    kind: 'legacy-agentserver-repair-harness',
    repairHarnessOnly: true,
    handoffSource: 'test',
    agentServerBaseUrl: 'http://127.0.0.1:43111',
    uiState: {
      capabilityProviderRoutes: [{ capabilityId: 'browser', providerId: 'remote' }],
    },
  });
  assert.equal(nestedProviderRoutes.allowed, false);
  assert.match(nestedProviderRoutes.reason, /forbidden route fields: uiState\.capabilityProviderRoutes/);

  const diagnosticBoundaryRouteField = legacyToolsRunSyncDecision({
    schemaVersion: LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
    kind: 'legacy-agentserver-repair-harness',
    repairHarnessOnly: true,
    handoffSource: 'test',
    agentServerBaseUrl: 'http://127.0.0.1:43111',
    diagnosticBoundary: {
      selectedActionIds: ['action.sciforge.computer-use'],
    },
  });
  assert.equal(diagnosticBoundaryRouteField.allowed, false);
  assert.match(diagnosticBoundaryRouteField.reason, /diagnosticBoundary\.selectedActionIds/);

  const unsupported = legacyToolsRunSyncDecision({
    schemaVersion: LEGACY_TOOLS_RUN_REPAIR_HARNESS_SCHEMA,
    kind: 'legacy-agentserver-repair-harness',
    repairHarnessOnly: true,
    handoffSource: 'test',
    agentServerBaseUrl: 'http://127.0.0.1:43111',
    artifacts: [],
  });
  assert.equal(unsupported.allowed, false);
  assert.match(unsupported.reason, /unsupported fields: artifacts/);
});

function createCorsResponse() {
  return {
    ended: false,
    headers: {} as Record<string, string | number | readonly string[]>,
    status: undefined as number | undefined,
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    writeHead(status: number) {
      this.status = status;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

async function startLegacyToolsRunStreamRouteServer(
  runTool: Parameters<typeof handleLegacyToolsRunStreamRoute>[2],
): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/api/sciforge/tools/run/stream' && req.method === 'POST') {
      void handleLegacyToolsRunStreamRoute(req, res, runTool);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function postLegacyToolsRunStream(server: Server, body: Record<string, unknown>) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return await fetch(`http://127.0.0.1:${address.port}/api/sciforge/tools/run/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
