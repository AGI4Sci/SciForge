import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-timeout-resume-'));
const previousTimeout = process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS;
let callCount = 0;
let secondPromptText = '';

const generatedTask = [
  'import json, sys',
  'json.load(open(sys.argv[1], encoding="utf-8"))',
  'payload = {"message":"resumed ok","confidence":0.82,"claimType":"evidence-summary","evidenceLevel":"mock-agentserver","reasoningTrace":"retry resumed from timeout priorAttempts","claims":[],"uiManifest":[],"executionUnits":[{"id":"resume-eu","status":"done","tool":"agentserver.resume"}],"artifacts":[]}',
  'json.dump(payload, open(sys.argv[2], "w"))',
].join('\n');

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-timeout-context', status: 'active' },
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
  callCount += 1;
  const body = JSON.parse(await readBody(req));
  if (callCount === 1) {
    setTimeout(() => {
      if (res.destroyed) return;
      sendRunResponse(res, req.url, generationRunResponse('late-run'));
    }, 250);
    return;
  }

  const input = isRecord(body.input) ? body.input : {};
  secondPromptText = typeof input.text === 'string' ? input.text : '';
  sendRunResponse(res, req.url, generationRunResponse('mock-agentserver-resumed-run'));
});

function generationRunResponse(id: string) {
  return {
    ok: true,
    data: {
      run: {
        id,
        status: 'completed',
        output: {
          result: {
            taskFiles: [{ path: '.sciforge/tasks/resume.py', language: 'python', content: generatedTask }],
            entrypoint: { language: 'python', path: '.sciforge/tasks/resume.py' },
            expectedArtifacts: [],
          },
        },
      },
    },
  };
}

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS = '40';
  const timeoutResult = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'long AgentServer run should timeout then resume cleanly',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.match(timeoutResult.message, /timed out or was cancelled/i);
  assert.doesNotMatch(timeoutResult.message, /taskFiles and entrypoint|protocol/i);
  assert.ok(timeoutResult.executionUnits.some((unit) => isRecord(unit) && unit.status === 'repair-needed'));

  process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS = '1000';
  const resumed = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'long AgentServer run should timeout then resume cleanly',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    uiState: { forceAgentServerGeneration: true },
    artifacts: [],
  });

  assert.equal(resumed.message, 'resumed ok');
  if (secondPromptText) {
    assert.match(secondPromptText, /timed out or was cancelled/i);
    assert.match(secondPromptText, /priorAttempts/i);
  }
  const debugFiles = await collectAgentServerDebugFiles(join(workspace, '.sciforge'));
  assert.ok(debugFiles.length >= 2);
  const timeoutDebug = await Promise.all(debugFiles.map((file) => readFile(file, 'utf8')));
  assert.ok(timeoutDebug.some((text) => /"responseStatus": 0/.test(text)));
  console.log('[ok] AgentServer timeout/cancel diagnostics become repair-needed and retry resumes with priorAttempts');
} finally {
  if (previousTimeout === undefined) {
    delete process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS;
  } else {
    process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS = previousTimeout;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(req: AsyncIterable<Buffer | string>) {
  return new Promise<string>(async (resolve) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolve(Buffer.concat(chunks).toString('utf8'));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function collectAgentServerDebugFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      const rel = relative(root, full).replaceAll('\\', '/');
      if (rel.includes('/debug/agentserver/')) out.push(full);
    }
  }
  await visit(root);
  return out;
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
