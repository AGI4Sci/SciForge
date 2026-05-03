import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workspace = await createRepairWorkspace('sciforge-workspace-http-repair-');

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

const agentServer = createServer(async (req, res) => {
  if (req.method === 'GET' && String(req.url).includes('/api/agent-server/agents/') && String(req.url).endsWith('/context')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        session: { id: 'mock-workspace-repair-context', status: 'active' },
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
  const agent = isRecord(body.agent) ? body.agent : {};
  const repairWorkspace = typeof agent.workingDirectory === 'string' ? agent.workingDirectory : workspace;
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
  const taskPath = join(repairWorkspace, codeRef);
  const source = await readFile(taskPath, 'utf8');
  await writeFile(taskPath, source
    .replace('matrix_ref = ""', 'matrix_ref = "matrix.csv"')
    .replace('metadata_ref = ""', 'metadata_ref = "metadata.csv"'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      run: {
        id: 'mock-agentserver-http-repair-run',
        status: 'completed',
        output: {
          result: 'Patched task code to use workspace fixture matrix.csv and metadata.csv.',
        },
      },
    },
  }));
});

await listen(agentServer);
const agentAddress = agentServer.address();
assert.ok(agentAddress && typeof agentAddress === 'object');
const agentServerBaseUrl = `http://127.0.0.1:${agentAddress.port}`;

const workspacePort = await freePort();
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, SCIFORGE_WORKSPACE_PORT: String(workspacePort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForHealth(`http://127.0.0.1:${workspacePort}/health`);
  const response = await fetch(`http://127.0.0.1:${workspacePort}/api/sciforge/tools/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skillDomain: 'omics',
      prompt: 'Run omics differential expression; repair smoke intentionally omits refs',
      workspacePath: workspace,
      agentServerBaseUrl,
    }),
  });
  assert.equal(response.status, 200);
  const json = await response.json() as unknown;
  assert.ok(isRecord(json));
  assert.equal(json.ok, true);
  const result = isRecord(json.result) ? json.result : {};
  const units = Array.isArray(result.executionUnits) ? result.executionUnits : [];
  assert.equal(units.length, 1);
  assert.equal(isRecord(units[0]) ? units[0].status : undefined, 'self-healed');
  assert.equal(isRecord(units[0]) ? units[0].attempt : undefined, 2);
  assert.equal(Array.isArray(result.artifacts) ? result.artifacts.length : 0, 1);

  await assertSelfHealedAttemptHistory(workspace);

  const configuredWorkspace = await createRepairWorkspace('sciforge-workspace-http-repair-config-');
  await mkdir(join(configuredWorkspace, '.sciforge'), { recursive: true });
  await writeFile(join(configuredWorkspace, '.sciforge', 'config.json'), JSON.stringify({ agentServerBaseUrl }, null, 2));
  const configuredResponse = await fetch(`http://127.0.0.1:${workspacePort}/api/sciforge/tools/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      skillDomain: 'omics',
      prompt: 'Run omics differential expression; repair smoke reads AgentServer URL from workspace config',
      workspacePath: configuredWorkspace,
    }),
  });
  assert.equal(configuredResponse.status, 200);
  const configuredJson = await configuredResponse.json() as unknown;
  assert.ok(isRecord(configuredJson));
  assert.equal(configuredJson.ok, true);
  const configuredResult = isRecord(configuredJson.result) ? configuredJson.result : {};
  const configuredUnits = Array.isArray(configuredResult.executionUnits) ? configuredResult.executionUnits : [];
  assert.equal(configuredUnits.length, 1);
  assert.equal(isRecord(configuredUnits[0]) ? configuredUnits[0].status : undefined, 'self-healed');
  assert.equal(isRecord(configuredUnits[0]) ? configuredUnits[0].attempt : undefined, 2);
  assert.equal(Array.isArray(configuredResult.artifacts) ? configuredResult.artifacts.length : 0, 1);
  await assertSelfHealedAttemptHistory(configuredWorkspace);

  console.log('[ok] workspace server HTTP repair smoke patches task code via request body URL and workspace config fallback');
} finally {
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => agentServer.close(() => resolve()));
}

async function listen(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function freePort() {
  const server = createServer();
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForHealth(url: string) {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait below.
    }
    if (Date.now() - started > 10000) {
      const stderr = await readPipe(child.stderr);
      throw new Error(`workspace server did not become healthy. stderr=${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  return isRecord(parsed) ? parsed : {};
}

async function readPipe(pipe: NodeJS.ReadableStream | null) {
  if (!pipe) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of pipe) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function createRepairWorkspace(prefix: string) {
  const repairWorkspace = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(repairWorkspace, 'matrix.csv'), [
    'gene,c1,c2,t1,t2',
    'IL6,8,9,42,46',
    'TNF,7,6,25,27',
    'ACTB,12,13,12,13',
  ].join('\n'));
  await writeFile(join(repairWorkspace, 'metadata.csv'), [
    'sample,condition',
    'c1,control',
    'c2,control',
    't1,treated',
    't2,treated',
  ].join('\n'));
  return repairWorkspace;
}

async function assertSelfHealedAttemptHistory(repairWorkspace: string) {
  const attemptFiles = await readdir(join(repairWorkspace, '.sciforge', 'task-attempts'));
  assert.equal(attemptFiles.length, 1);
  const attemptHistory = JSON.parse(await readFile(join(repairWorkspace, '.sciforge', 'task-attempts', attemptFiles[0]), 'utf8'));
  assert.equal(attemptHistory.attempts.length, 2);
  assert.equal(attemptHistory.attempts[0].status, 'repair-needed');
  assert.equal(attemptHistory.attempts[1].status, 'done');
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
