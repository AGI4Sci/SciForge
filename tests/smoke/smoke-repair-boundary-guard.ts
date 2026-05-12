import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-repair-boundary-'));
await mkdir(join(workspace, 'src', 'runtime', 'gateway'), { recursive: true });
await writeFile(join(workspace, 'PROJECT.md'), '# Fixture project\n');
await writeFile(join(workspace, 'src', 'runtime', 'gateway', 'generated-task-runner.ts'), 'export const fixture = true;\n');

let repairRequests = 0;

const brokenTask = [
  'import sys',
  'input_path = sys.argv[1]',
  'output_path = sys.argv[2]',
  'open(input_path, "r", encoding="utf-8").read(1)',
  'sys.stderr.write("generated task failed before output\\n")',
  'raise SystemExit(2)',
].join('\n');

const fixedTask = [
  'import json, sys',
  'input_path = sys.argv[1]',
  'output_path = sys.argv[2]',
  'open(input_path, "r", encoding="utf-8").read(1)',
  'payload = {"message":"boundary should have blocked this success","confidence":0.9,"claimType":"fact","evidenceLevel":"runtime","reasoningTrace":"fixed task","claims":[],"uiManifest":[],"executionUnits":[{"id":"boundary-task","status":"done"}],"artifacts":[{"id":"should-not-appear","type":"research-report","data":{"markdown":"blocked"}}]}',
  'json.dump(payload, open(output_path, "w", encoding="utf-8"))',
].join('\n');

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-repair-boundary-context', status: 'active' },
        operationalGuidance: { summary: ['context healthy'], items: [] },
        workLayout: { strategy: 'live_only', safetyPointReached: true, segments: [] },
        workBudget: { status: 'healthy', approxCurrentWorkTokens: 80 },
        recentTurns: [],
        currentWorkEntries: [],
      },
    }));
    return;
  }
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const body = await readJson(req);
  const metadata = isRecord(body.input) && isRecord(body.input.metadata) ? body.input.metadata : {};
  if (metadata.purpose === 'workspace-task-repair') {
    repairRequests += 1;
    const codeRef = String(metadata.codeRef || '');
    assert.match(codeRef, /^\.sciforge\/sessions\/.+\/tasks\/generated-literature-/);
    await writeFile(join(workspace, codeRef), fixedTask);
    await writeFile(join(workspace, 'PROJECT.md'), '# Out-of-bound repair edit\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        run: {
          id: 'mock-repair-boundary-run',
          status: 'completed',
          output: {
            result: 'Patched the generated task, but also edited PROJECT.md out of scope.',
          },
        },
      },
    }));
    return;
  }
  const result = {
    ok: true,
    data: {
      run: {
        id: 'mock-generation-boundary-run',
        status: 'completed',
        output: {
          result: {
            taskFiles: [{
              path: '.sciforge/tasks/boundary-broken-task.py',
              language: 'python',
              content: brokenTask,
            }],
            entrypoint: { language: 'python', path: '.sciforge/tasks/boundary-broken-task.py' },
            environmentRequirements: { language: 'python' },
            validationCommand: 'python .sciforge/tasks/boundary-broken-task.py <input> <output>',
            expectedArtifacts: ['research-report'],
            patchSummary: 'Generated a task that fails before output.',
          },
        },
      },
    },
  };
  sendRunResponse(res, req.url, result);
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'Run a generated literature task and repair it if needed.',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report'],
    uiState: {
      sessionId: 'session-repair-boundary',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
      forceAgentServerGeneration: true,
    },
  });

  assert.equal(repairRequests, 1);
  assert.match(result.message, /repair boundary/i);
  assert.equal(result.executionUnits[0]?.status, 'repair-needed');
  assert.equal(result.executionUnits[0]?.blocker, 'repair-boundary');
  assert.equal(result.artifacts.some((artifact) => artifact.id === 'should-not-appear'), false);

  const unitRefs = isRecord(result.executionUnits[0]?.refs) ? result.executionUnits[0].refs : {};
  const repairBoundary = isRecord(unitRefs.repairBoundary) ? unitRefs.repairBoundary : {};
  assert.equal(repairBoundary.status, 'blocked');
  assert.deepEqual(repairBoundary.blockedPaths, ['PROJECT.md']);
  assert.match(String(repairBoundary.auditRef || ''), /^\.sciforge\/repair-boundary\/.+\.json$/);

  const audit = JSON.parse(await readFile(join(workspace, String(repairBoundary.auditRef)), 'utf8')) as Record<string, unknown>;
  assert.equal(audit.policyId, 'sciforge.repair-boundary-source-edit-guard.v1');
  assert.deepEqual(audit.blockedPaths, ['PROJECT.md']);

  const diagnostic = result.artifacts.find((artifact) => artifact.type === 'runtime-diagnostic');
  assert.ok(diagnostic);
  assert.equal(isRecord(diagnostic.metadata) ? diagnostic.metadata.failureKind : undefined, 'repair-boundary');
  assert.equal(isRecord(diagnostic.data) ? isRecord(diagnostic.data.failure) && diagnostic.data.failure.failureKind : undefined, 'repair-boundary');

  const attemptsDir = join(
    workspace,
    '.sciforge',
    'sessions',
    '2026-05-12_literature_session-repair-boundary',
    'records',
    'task-attempts',
  );
  const attemptFiles = await readdir(attemptsDir);
  const attemptFile = attemptFiles.find((file) => file.startsWith('generated-literature-'));
  assert.ok(attemptFile);
  const attemptHistory = JSON.parse(await readFile(join(attemptsDir, attemptFile), 'utf8')) as Record<string, unknown>;
  const attempts = Array.isArray(attemptHistory.attempts) ? attemptHistory.attempts.filter(isRecord) : [];
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.status, 'repair-needed');
  assert.equal(attempts[1]?.status, 'repair-needed');
  assert.match(String(attempts[1]?.failureReason || ''), /outside the generated task boundary/);

  console.log('[ok] repair boundary guard rejects AgentServer source edits and emits repair-boundary diagnostic');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readJson(req: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendRunResponse(
  res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  requestUrl: string | undefined,
  result: Record<string, unknown>,
) {
  if (requestUrl === '/api/agent-server/runs/stream') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ result }) + '\n');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}
