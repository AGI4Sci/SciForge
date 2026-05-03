import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-repair-'));
await writeFile(join(workspace, 'matrix.csv'), [
  'gene,c1,c2,t1,t2',
  'IL6,8,9,42,46',
  'TNF,7,6,25,27',
  'ACTB,12,13,12,13',
].join('\n'));
await writeFile(join(workspace, 'metadata.csv'), [
  'sample,condition',
  'c1,control',
  'c2,control',
  't1,treated',
  't2,treated',
].join('\n'));

const brokenGeneratedTask = [
  'import json, sys',
  'matrix_ref = ""',
  'metadata_ref = ""',
  'if not matrix_ref or not metadata_ref:',
  '    sys.stderr.write("missing matrix/metadata refs\\n")',
  '    raise SystemExit(2)',
  'payload = {"message":"omics repaired ok","confidence":0.82,"claimType":"evidence-summary","evidenceLevel":"workspace-task","reasoningTrace":"generated omics task reran after repair","claims":[],"uiManifest":[{"componentId":"point-set-viewer","artifactRef":"omics-differential-expression","priority":1}],"executionUnits":[{"id":"omics-generated-repaired","tool":"agentserver.generated.python","status":"done"}],"artifacts":[{"id":"omics-differential-expression","type":"omics-differential-expression","producerScenario":"omics","schemaVersion":"1","metadata":{"matrixRef":matrix_ref,"metadataRef":metadata_ref},"data":{"rows":[{"gene":"IL6","log2FoldChange":2.4,"pValue":0.01}]}}]}',
  'json.dump(payload, open(sys.argv[2], "w"))',
].join('\n');

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-repair-context', status: 'active' },
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
  if (metadata.purpose === 'workspace-task-generation') {
    sendRunResponse(res, req.url, {
      ok: true,
      data: {
        run: {
          id: 'mock-agentserver-generated-omics-run',
          status: 'completed',
          output: {
            result: {
              taskFiles: [{ path: '.sciforge/tasks/omics-generated.py', language: 'python', content: brokenGeneratedTask }],
              entrypoint: { language: 'python', path: '.sciforge/tasks/omics-generated.py' },
              environmentRequirements: { language: 'python' },
              validationCommand: 'python .sciforge/tasks/omics-generated.py <input> <output>',
              expectedArtifacts: ['omics-differential-expression'],
              patchSummary: 'Generated an omics task that intentionally needs repair.',
            },
          },
        },
      },
    });
    return;
  }
  const codeRef = typeof metadata.codeRef === 'string' ? metadata.codeRef : '';
  assert.ok(codeRef.startsWith('.sciforge/tasks/'));
  const taskPath = join(workspace, codeRef);
  const source = await readFile(taskPath, 'utf8');
  const patched = source
    .replace('matrix_ref = ""', 'matrix_ref = "matrix.csv"')
    .replace('metadata_ref = ""', 'metadata_ref = "metadata.csv"');
  await writeFile(taskPath, patched);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-repair-run',
        status: 'completed',
        output: {
          result: 'Patched omics task to use workspace matrix.csv and metadata.csv when refs were omitted in this smoke.',
        },
      },
    },
  }));
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'omics',
    prompt: 'Run omics differential expression; repair smoke intentionally omits refs',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.executionUnits.length, 1);
  assert.equal(result.executionUnits[0].status, 'self-healed');
  assert.equal(result.executionUnits[0].attempt, 2);
  assert.equal(result.executionUnits[0].parentAttempt, 1);
  assert.match(String(result.executionUnits[0].diffRef || ''), /^\.sciforge\/task-diffs\/(?:generated-)?omics-/);
  assert.match(String(result.reasoningTrace), /AgentServer repair run/);

  const attemptFiles = await readdir(join(workspace, '.sciforge', 'task-attempts'));
  assert.equal(attemptFiles.length, 1);
  const attemptHistory = JSON.parse(await readFile(join(workspace, '.sciforge', 'task-attempts', attemptFiles[0]), 'utf8'));
  assert.equal(attemptHistory.attempts.length, 2);
  assert.equal(attemptHistory.attempts[0].status, 'repair-needed');
  assert.equal(attemptHistory.attempts[1].status, 'done');
  assert.equal(attemptHistory.attempts[1].parentAttempt, 1);
  assert.ok(attemptHistory.attempts[1].diffRef);

  console.log('[ok] agentserver repair smoke patches task code and reruns self-healed attempt');
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
