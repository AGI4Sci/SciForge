import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-entrypoint-direct-retry-'));
let requestCount = 0;
const promptTexts: string[] = [];

const directPayload = {
  message: 'Strict retry direct payload completed.',
  confidence: 0.88,
  claimType: 'evidence-summary',
  evidenceLevel: 'mock-agentserver',
  reasoningTrace: 'AgentServer retried a report entrypoint as a direct payload.',
  claims: [],
  uiManifest: [{ componentId: 'report-viewer', artifactRef: 'entrypoint-retry-report' }],
  executionUnits: [{ id: 'entrypoint-retry-eu', status: 'done', tool: 'agentserver.entrypoint-direct-retry' }],
  artifacts: [{
    id: 'entrypoint-retry-report',
    type: 'research-report',
    data: { markdown: 'The strict retry returned a valid direct ToolPayload.' },
  }],
};

const server = createServer(async (req, res) => {
  if (!['/api/agent-server/runs', '/api/agent-server/runs/stream'].includes(String(req.url)) || req.method !== 'POST') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  requestCount += 1;
  const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
  const input = isRecord(body.input) ? body.input : {};
  promptTexts.push(String(input.text || ''));
  const result = requestCount === 1
    ? {
        ok: true,
        data: {
          run: {
            id: 'mock-agentserver-entrypoint-report-run',
            status: 'completed',
            output: {
              taskFiles: [{
                path: '.sciforge/tasks/report.md',
                language: 'markdown',
                content: '# This is a report, not executable task code\n',
              }],
              entrypoint: { language: 'markdown', path: '.sciforge/tasks/report.md' },
              expectedArtifacts: ['research-report'],
              patchSummary: 'Returned a non-executable report as the entrypoint.',
            },
          },
        },
      }
    : {
        ok: true,
        data: {
          run: {
            id: 'mock-agentserver-entrypoint-direct-retry-run',
            status: 'completed',
            output: { result: directPayload },
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
  const events: Array<Record<string, unknown>> = [];
  const result = await runWorkspaceRuntimeGateway({
    skillDomain: 'literature',
    prompt: 'entrypoint report should strict-retry into a direct payload',
    workspacePath: workspace,
    agentServerBaseUrl: baseUrl,
    expectedArtifactTypes: ['research-report'],
    selectedComponentIds: ['report-viewer'],
    artifacts: [],
  }, {
    onEvent(event) {
      events.push(event as unknown as Record<string, unknown>);
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.message, 'Strict retry direct payload completed.');
  assert.ok(result.executionUnits.some((unit) => isRecord(unit) && unit.tool === 'agentserver.entrypoint-direct-retry'));
  assert.ok(result.artifacts.some((artifact) => artifact.id === 'entrypoint-retry-report'));
  assert.ok(events.some((event) => event.type === 'agentserver-generation-retry'));
  assert.match(promptTexts[1] || '', /non-executable artifact\/report as entrypoint/);
  assert.match(promptTexts[1] || '', /direct ToolPayload/);
  console.log('[ok] entrypoint contract strict retry can return a direct ToolPayload');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function readBody(req: AsyncIterable<Buffer | string>) {
  return new Promise<string>(async (resolve) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    resolve(Buffer.concat(chunks).toString('utf8'));
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
