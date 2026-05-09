import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-acceptance-repair-'));

const generatedTask = [
  'import json, sys',
  'markdown = "# Literature report\\n\\nThis report summarizes the papers and methods, but omits the requested field labels."',
  'payload = {"message":"report written","confidence":0.8,"claimType":"evidence-summary","evidenceLevel":"workspace-task","reasoningTrace":"generated literature report","claims":[{"text":"report generated"}],"uiManifest":[{"componentId":"report-viewer","artifactRef":"research-report"}],"executionUnits":[{"id":"literature-generated","tool":"agentserver.generated.python","status":"done"}],"artifacts":[{"id":"research-report","type":"research-report","producerScenario":"literature","schemaVersion":"1","data":{"markdown":markdown}}]}',
  'json.dump(payload, open(sys.argv[2], "w"))',
].join('\n');

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-acceptance-context', status: 'active' },
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
  if (String(metadata.purpose).startsWith('workspace-task-generation')) {
    sendRunResponse(res, req.url, {
      ok: true,
      data: {
        run: {
          id: 'mock-agentserver-generated-literature-run',
          status: 'completed',
          output: {
            result: {
              taskFiles: [{ path: '.sciforge/tasks/literature-generated.py', language: 'python', content: generatedTask }],
              entrypoint: { language: 'python', path: '.sciforge/tasks/literature-generated.py' },
              environmentRequirements: { language: 'python' },
              expectedArtifacts: ['research-report'],
              patchSummary: 'Generated a report task that intentionally omits explicit requested fields.',
            },
          },
        },
      },
    });
    return;
  }

  sendRunResponse(res, req.url, {
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-repair-run',
        status: 'completed',
        output: { result: 'Patched wording but still omitted the explicit labels.' },
      },
    },
  });
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: '请生成 markdown research-report，必须包含字段：“适用场景 / 潜在影响 / 和其他论文的关系”',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
  });

  assert.equal(result.executionUnits[0].status, 'done');
  assert.equal(result.message, 'report written');
  assert.doesNotMatch(String(result.message), /did not satisfy explicit user-requested report terms\/fields/);

  const attemptFiles = await readdir(join(workspace, '.sciforge', 'task-attempts'));
  assert.equal(attemptFiles.length, 1);
  const attemptHistory = JSON.parse(await readFile(join(workspace, '.sciforge', 'task-attempts', attemptFiles[0]), 'utf8'));
  assert.equal(attemptHistory.attempts.length, 1);
  assert.equal(attemptHistory.attempts[0].status, 'done');

  console.log('[ok] agentserver acceptance smoke leaves semantic artifact completeness judgments to AgentServer');
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
