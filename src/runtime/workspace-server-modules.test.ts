import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  type BoundedOperationResultValue,
  type ModuleResultEnvelope,
} from '@sciforge-ui/runtime-contract/modules';
import { handleWorkspaceModuleRoutes } from './workspace-server-modules.js';

test('workspace module routes dispatch files query/read/invoke through Agent Host module contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-modules-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'app.ts'), 'export {};\n', 'utf8');
  const server = await startModuleRouteServer(root);
  try {
    const query = await postModule(server, 'query', { moduleId: 'files', query: 'tree', filters: { path: 'src' } });
    assert.equal(query.result.ok, true);
    assert.equal(query.result.moduleId, 'files');
    assert.ok(query.result.refs?.includes('file:src/app.ts'));
    assert.equal(query.trace[0]?.functionName, 'query');

    const read = await postModule(server, 'read', { ref: 'file:src/app.ts' });
    assert.equal(read.result.ok, true);
    assert.equal((read.result.value as { content?: string }).content, 'export {};\n');
    assert.equal(read.trace[0]?.ref, 'file:src/app.ts');

    const approval = await postModule(server, 'invoke', {
      moduleId: 'files',
      intent: 'write',
      input: { ref: 'file:src/app.ts', content: 'blocked\n' },
    });
    assert.equal(approval.result.ok, false);
    assert.equal(approval.result.approvalRequest?.intent, 'write');
    assert.equal(await readFile(join(root, 'src', 'app.ts'), 'utf8'), 'export {};\n');

    const saved = await postModule(server, 'invoke', {
      moduleId: 'files',
      intent: 'write',
      approvalToken: 'approved-test-token',
      input: { ref: 'file:src/app.ts', content: 'export const ok = true;\n' },
    });
    assert.equal(saved.result.ok, true);
    assert.equal(saved.result.operationRef, 'files:operation:write:src%2Fapp.ts');
    assert.equal(await readFile(join(root, 'src', 'app.ts'), 'utf8'), 'export const ok = true;\n');
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace module routes dispatch automations through Agent Host module contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-modules-'));
  const server = await startModuleRouteServer(root);
  try {
    const created = await postModule(server, 'invoke', {
      moduleId: 'automations',
      intent: 'create',
      approvalToken: 'approved-test-token',
      input: {
        id: 'workspace-health',
        name: 'Workspace health',
        repositoryRef: 'workspace:current',
        repositoryLabel: 'Workspace',
        trigger: { type: 'manual' },
        tools: ['Files'],
      },
    });
    assert.equal(created.result.ok, true);
    assert.equal(created.result.operationRef, 'automations:operation:create:workspace-health');
    assert.equal(created.trace[0]?.functionName, 'invoke');

    const query = await postModule(server, 'query', { moduleId: 'automations', query: 'health' });
    assert.equal(query.result.ok, true);
    assert.equal((query.result.value as { total?: number }).total, 1);
    assert.ok(query.result.refs?.includes('automation:workspace-health'));
    assert.doesNotMatch(JSON.stringify(query), /\/tmp|Authorization|secret|token/i);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace module routes expose bounded Browser and Computer Use operation intents through module.invoke', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-modules-'));
  const server = await startModuleRouteServer(root);
  try {
    const browser = await postModule(server, 'invoke', {
      moduleId: 'browser',
      intent: EXECUTE_BOUNDED_OPERATION_INTENT,
      input: {
        operationKind: 'browser.search_read',
        ownerModuleId: 'browser',
        targetScope: { kind: 'web-search', query: 'frontier AI model progress this week' },
        config: {
          allowedActions: ['search', 'open', 'read'],
          maxSteps: 4,
          maxTimeMs: 10_000,
          maxModelCalls: 1,
          riskPolicy: 'low',
          requiredEvidence: ['source-page-ref', 'page-text-ref'],
        },
      },
    });
    assert.equal(browser.result.moduleId, 'browser');
    assert.equal(browser.result.ok, false);
    assert.equal((browser.result.value as BoundedOperationResultValue).status, 'blocked');
    assert.match((browser.result.value as BoundedOperationResultValue).blockedReason ?? '', /unsupported_operation_kind|missing_required_evidence/);
    assert.equal(JSON.stringify(browser.result).includes('base64'), false);

    const computerUse = await postModule(server, 'invoke', {
      moduleId: 'computer_use',
      intent: EXECUTE_BOUNDED_OPERATION_INTENT,
      input: {
        operationKind: 'computer_use.perform_local_action',
        ownerModuleId: 'computer_use',
        targetScope: { kind: 'window' },
        config: {
          allowedActions: ['click'],
          maxSteps: 1,
          maxModelCalls: 1,
          riskPolicy: 'low',
          requiredEvidence: ['before-evidence-ref', 'grounding-ref', 'executor-event-ref', 'after-evidence-ref'],
        },
        action: { kind: 'click', target: 'Save' },
      },
    });
    assert.equal(computerUse.result.moduleId, 'computer_use');
    assert.equal(computerUse.result.ok, false);
    const value = computerUse.result.value as BoundedOperationResultValue;
    assert.equal(value.status, 'blocked');
    assert.equal(value.blockedReason, 'missing_target_binding');
    assert.deepEqual(value.evidenceRefs, []);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace module routes keep dispatcher trace failures redacted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-modules-'));
  const server = await startModuleRouteServer(root);
  try {
    const response = await postModule(server, 'read', { ref: 'file:/Users/alice/private/token.txt?token=abc123' });

    assert.equal(response.result.ok, false);
    const text = JSON.stringify(response);
    assert.doesNotMatch(text, /\/Users\/alice|abc123/);
    assert.match(text, /\[redacted/);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

async function startModuleRouteServer(workspacePath: string): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleWorkspaceModuleRoutes(req, res, url, {
      workspaceRootFromBodyOrRequest: async (body) => (
        typeof body.workspacePath === 'string' && body.workspacePath.trim() ? body.workspacePath : workspacePath
      ),
    }).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404);
        res.end('not found');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function postModule(
  server: Server,
  functionName: 'query' | 'read' | 'invoke',
  body: Record<string, unknown>,
) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/sciforge/modules/${functionName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return await response.json() as {
    ok: boolean;
    result: ModuleResultEnvelope;
    trace: Array<{ functionName?: string; ref?: string }>;
  };
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
