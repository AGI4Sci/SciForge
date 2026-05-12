import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { readCapabilityEvolutionRecords } from '../../src/runtime/capability-evolution-ledger.js';
import { readTaskAttempts } from '../../src/runtime/task-attempt-history.js';
import {
  buildValidationRepairTelemetrySummary,
  readValidationRepairTelemetrySpanRecords,
} from '../../src/runtime/gateway/validation-repair-telemetry-sink.js';

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
  if (metadata.purpose === 'workspace-task-generation' || metadata.purpose === 'workspace-task-generation-inline') {
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
  assert.match(codeRef, /^\.sciforge\/(?:sessions\/.+\/)?tasks\//, `expected repair metadata.codeRef to point at generated task, got ${codeRef || '<missing>'}`);
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

  assert.ok(result.artifacts.some((artifact) => artifact.id === 'omics-differential-expression'));
  assert.equal(result.executionUnits.length, 1);
  assert.equal(result.executionUnits[0].status, 'self-healed');
  assert.equal(result.executionUnits[0].attempt, 2);
  assert.equal(result.executionUnits[0].parentAttempt, 1);
  assert.match(String(result.executionUnits[0].diffRef || ''), /^\.sciforge\/task-diffs\/(?:generated-)?omics-/);
  assert.match(String(result.reasoningTrace), /AgentServer repair run/);
  const repairRerunAudit = (result.executionUnits[0].refs as {
    validationRepairAudit?: {
      validationDecision?: { subject?: { kind?: string }; status?: string };
      repairDecision?: { action?: string };
      auditRecord?: { outcome?: string; contractId?: string };
    };
  } | undefined)?.validationRepairAudit;
  assert.equal(repairRerunAudit?.validationDecision?.subject?.kind, 'repair-rerun-result');
  assert.equal(repairRerunAudit?.validationDecision?.status, 'pass');
  assert.equal(repairRerunAudit?.repairDecision?.action, 'none');
  assert.equal(repairRerunAudit?.auditRecord?.outcome, 'accepted');
  assert.equal(repairRerunAudit?.auditRecord?.contractId, 'sciforge.repair-rerun-result.v1');
  const telemetryRefs = (result as typeof result & {
    refs?: { validationRepairTelemetry?: Array<{ ref?: string; spanKinds?: string[]; recordRefs?: string[] }> };
  }).refs?.validationRepairTelemetry ?? [];
  assert.equal(telemetryRefs[0]?.ref, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.ok(telemetryRefs.some((ref) => ref.spanKinds?.includes('repair-rerun')));
  assert.ok(telemetryRefs.some((ref) => ref.spanKinds?.includes('repair-decision')));
  assert.ok(telemetryRefs.some((ref) => (ref.recordRefs?.length ?? 0) > 0));

  const telemetryRecords = await readValidationRepairTelemetrySpanRecords({ workspacePath: workspace });
  assert.ok(telemetryRecords.some((record) => record.spanKind === 'repair-rerun' && record.outcome === 'accepted'));
  assert.ok(telemetryRecords.some((record) => record.spanKind === 'repair-decision' && record.action === 'none'));
  assert.ok(telemetryRecords.some((record) => record.subject?.kind === 'repair-rerun-result'));
  const telemetrySummary = await buildValidationRepairTelemetrySummary({ workspacePath: workspace });
  assert.equal(telemetrySummary.sourceRef, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.ok((telemetrySummary.spanKindCounts['repair-rerun'] ?? 0) >= 1);
  assert.ok(telemetrySummary.auditIds.some((auditId) => auditId.startsWith('audit:repair-rerun:')));

  const taskId = String(result.executionUnits[0].diffRef || '').match(/task-diffs\/(.+)-attempt-\d+\.diff\.txt/)?.[1];
  assert.ok(taskId);
  const attemptHistory = await readTaskAttempts(workspace, taskId);
  assert.equal(attemptHistory.length, 2);
  assert.equal(attemptHistory[0].status, 'repair-needed');
  assert.equal(attemptHistory[1].status, 'done');
  assert.equal(attemptHistory[1].parentAttempt, 1);
  assert.ok(attemptHistory[1].diffRef);
  const enrichedAttempts = attemptHistory as Array<{
    refs?: {
      validationRepairAudit?: Array<{ subject?: { kind?: string }; outcome?: string }>;
      validationRepairTelemetry?: Array<{ ref?: string; spanKinds?: string[]; recordRefs?: string[] }>;
    };
  }>;
  assert.equal(enrichedAttempts[1]?.refs?.validationRepairAudit?.[0]?.subject?.kind, 'repair-rerun-result');
  assert.equal(enrichedAttempts[1]?.refs?.validationRepairAudit?.[0]?.outcome, 'accepted');
  assert.equal(enrichedAttempts[1]?.refs?.validationRepairTelemetry?.[0]?.ref, '.sciforge/validation-repair-telemetry/spans.jsonl');
  assert.ok(enrichedAttempts[1]?.refs?.validationRepairTelemetry?.some((ref) => ref.spanKinds?.includes('repair-rerun')));

  const capabilityRecords = await readCapabilityEvolutionRecords({ workspacePath: workspace });
  assert.ok(capabilityRecords.some((record) => record.recoverActions.includes('repair-generated-task')));
  assert.ok(capabilityRecords.some((record) => record.finalStatus === 'repair-succeeded'
    && record.repairAttempts.some((attempt) => attempt.status === 'succeeded')));

  console.log('[ok] agentserver repair smoke patches task code, reruns self-healed attempt, and records repair-rerun telemetry');
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
