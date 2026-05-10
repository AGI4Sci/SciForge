import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_HANDOFF_BUDGET, normalizeBackendHandoff } from '../../src/runtime/workspace-task-input.js';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-handoff-budget-'));
const hugeText = 'STDOUT-LINE '.repeat(80_000);
const hugeJson = {
  rows: Array.from({ length: 12_000 }, (_, index) => ({
    id: index,
    gene: `GENE${index}`,
    score: index / 10,
    note: 'long-json-cell '.repeat(10),
  })),
};
const pngDataUrl = `data:image/png;base64,${Buffer.from('fake-png-binary'.repeat(40_000)).toString('base64')}`;
const priorAttempts = Array.from({ length: 40 }, (_, index) => ({
  id: `attempt-${index}`,
  attempt: index,
  status: 'failed-with-reason',
  stdoutRef: `.sciforge/logs/attempt-${index}.stdout.log`,
  stderrRef: `.sciforge/logs/attempt-${index}.stderr.log`,
  stdout: hugeText,
  stderr: `${hugeText} stderr ${index}`,
  failureReason: `failure ${index} ${hugeText}`,
  schemaErrors: Array.from({ length: 100 }, (_, errorIndex) => `schema ${errorIndex} ${hugeText.slice(0, 500)}`),
}));

const result = await normalizeBackendHandoff({
  agent: { id: 'sciforge-test', backend: 'test' },
  input: {
    text: `Generate a task from compact context\n${hugeText}`,
    metadata: {
      purpose: 'contract-test',
      agentHarnessHandoff: {
        schemaVersion: 'sciforge.agent-harness-handoff.v1',
        harnessContractRef: 'harness-contract:budget-smoke',
        harnessTraceRef: 'harness-trace:budget-smoke',
      },
    },
    stdout: hugeText,
    stderr: `${hugeText} stderr-root`,
  },
  artifacts: [
    {
      id: 'large-json',
      type: 'research-report',
      dataRef: '.sciforge/artifacts/large-json.json',
      data: hugeJson,
    },
    {
      id: 'binary-image',
      type: 'image-preview',
      mimeType: 'image/png',
      dataRef: '.sciforge/artifacts/image.png',
      data: pngDataUrl,
    },
  ],
  priorAttempts,
}, {
  workspacePath: workspace,
  purpose: 'contract-test',
});

const serialized = JSON.stringify(result.payload);
assert.ok(result.normalizedBytes <= DEFAULT_BACKEND_HANDOFF_BUDGET.maxPayloadBytes, `handoff exceeded budget: ${result.normalizedBytes}`);
assert.ok(serialized.length <= DEFAULT_BACKEND_HANDOFF_BUDGET.maxPayloadBytes, `serialized handoff exceeded budget: ${serialized.length}`);
assert.ok(!serialized.includes(hugeText.slice(0, 50_000)), 'large stdout leaked inline');
assert.ok(!serialized.includes(pngDataUrl.slice(0, 50_000)), 'binary image leaked inline');

const payload = result.payload as Record<string, unknown>;
const manifest = payload._sciforgeHandoffManifest as Record<string, unknown>;
assert.equal(manifest.rawRef, result.rawRef);
assert.equal(typeof manifest.rawSha1, 'string');
assert.equal(manifest.slimmingTraceRef, result.slimmingTraceRef);
assert.equal(manifest.slimmingDecisionCount, result.slimmingTrace.decisions.length);
assert.equal(manifest.slimmingDecisionDigest, result.slimmingTrace.decisionDigest);
assert.deepEqual(manifest.sourceRefs, {
  harnessContractRef: 'harness-contract:budget-smoke',
  harnessTraceRef: 'harness-trace:budget-smoke',
  agentHarnessHandoffSchemaVersion: 'sciforge.agent-harness-handoff.v1',
});
assert.ok(result.auditRefs.includes(result.rawRef), 'handoff audit refs should include raw ref');
assert.ok(result.auditRefs.includes(result.slimmingTraceRef), 'handoff audit refs should include slimming trace ref');
assert.ok(result.contextEstimate.rawTokens > result.contextEstimate.normalizedTokens, 'handoff context estimate should reflect slimming');
assert.equal(result.contextEstimate.normalizedTokens, Math.ceil(result.normalizedBytes / 4));
assert.ok(result.contextEstimate.normalizedBudgetRatio <= 1, 'normalized handoff should fit payload budget');
assert.ok(result.decisions.some((decision) => decision.kind === 'tool-output'), 'stdout/stderr slimming should produce budget decisions');
assert.ok(result.decisions.some((decision) => decision.kind === 'binary' || decision.reason === 'binary-artifact-data'), 'binary slimming should produce budget decisions');
assert.ok(result.decisions.some((decision) => decision.kind === 'prior-attempts' && decision.omittedCount && decision.omittedCount > 0), 'prior attempt slimming should produce budget decisions');
const input = payload.input as Record<string, unknown>;
assert.equal(typeof input.text, 'string', 'backend input.text must remain a string for AgentServer compatibility');
assert.ok(isRecord(input.textSummary), 'large backend input.text should carry a structured summary');

const rawPath = join(workspace, result.rawRef);
assert.ok((await stat(rawPath)).size > result.normalizedBytes, 'raw handoff ref should preserve full data');
const raw = await readFile(rawPath, 'utf8');
assert.ok(raw.includes(hugeText.slice(0, 50_000)), 'raw handoff ref should contain full stdout');
assert.ok(raw.includes(pngDataUrl.slice(0, 50_000)), 'raw handoff ref should contain full image data');

const tracePath = join(workspace, result.slimmingTraceRef);
const trace = JSON.parse(await readFile(tracePath, 'utf8')) as Record<string, unknown>;
assert.equal(trace.schemaVersion, 'sciforge.backend-handoff-slimming-trace.v1');
assert.equal(trace.rawRef, result.rawRef);
assert.equal(trace.rawSha1, result.rawSha1);
assert.equal(trace.normalizedBytes, result.normalizedBytes);
assert.equal(trace.deterministic, true);
assert.deepEqual(trace.sourceRefs, manifest.sourceRefs);
assert.equal(trace.decisionDigest, result.slimmingTrace.decisionDigest);
const traceDecisions = trace.decisions as Array<Record<string, unknown>>;
assert.equal(traceDecisions.length, result.decisions.length);
assert.ok(traceDecisions.every((decision, index) => decision.ordinal === index && typeof decision.decisionRef === 'string'));
assert.ok(traceDecisions.some((decision) => decision.kind === 'backend-input-text' && decision.pointer === '/input/text'));

const artifacts = payload.artifacts as Array<Record<string, unknown>>;
assert.equal(artifacts[0].dataOmitted, true);
assert.equal(artifacts[0].dataRef, '.sciforge/artifacts/large-json.json');
assert.equal(artifacts[1].dataOmitted, true);
assert.equal(artifacts[1].dataRef, '.sciforge/artifacts/image.png');
assert.ok(isRecord(artifacts[1].dataSummary));
assert.equal((artifacts[1].dataSummary as Record<string, unknown>).reason, 'binary-artifact-data');

const attempts = payload.priorAttempts as Record<string, unknown>;
assert.equal(attempts.kind, 'prior-attempts');
assert.equal(attempts.itemCount, 40);
assert.ok((attempts.attempts as unknown[]).length <= DEFAULT_BACKEND_HANDOFF_BUDGET.maxPriorAttempts);

const retryResult = await normalizeBackendHandoff({
  retryAudit: {
    schemaVersion: 'sciforge.agentserver-generation-retry.v1',
    attempt: 2,
    maxAttempts: 2,
    trigger: {
      kind: 'http-429',
      categories: ['http-429', 'rate-limit', 'retry-budget'],
      provider: 'mock-provider',
      model: 'mock-model',
      httpStatus: 429,
      retryAfterMs: 0,
      message: '429 Too Many Requests / retry budget exhausted',
    },
    firstFailedAt: new Date().toISOString(),
    backoffMs: 0,
    recoveryActions: ['wait for reset', 'reduce context'],
    contextPolicy: { mode: 'delta', handoff: 'slimmed', compactBeforeRetry: true, maxRetryCount: 1 },
    priorHandoff: { rawRef: result.rawRef, rawBytes: result.rawBytes, normalizedBytes: result.normalizedBytes },
  },
  agent: { id: 'sciforge-test', backend: 'test' },
  input: {
    text: `Retry after 429 with compact context\n${hugeText}`,
    metadata: { purpose: 'rate-limit-retry' },
  },
  artifacts: result.payload && isRecord(result.payload) ? (result.payload.artifacts as unknown[]) : [],
  priorAttempts,
}, {
  workspacePath: workspace,
  purpose: 'contract-rate-limit-retry',
  budget: {
    maxPayloadBytes: 96_000,
    maxInlineStringChars: 6_000,
    maxInlineJsonBytes: 18_000,
    maxArrayItems: 10,
    maxObjectKeys: 48,
    maxDepth: 5,
    headChars: 1_200,
    tailChars: 1_200,
    maxPriorAttempts: 1,
  },
});

const retrySerialized = JSON.stringify(retryResult.payload);
assert.ok(retryResult.normalizedBytes <= 96_000, `retry handoff exceeded compact retry budget: ${retryResult.normalizedBytes}`);
assert.ok(retrySerialized.includes('sciforge.agentserver-generation-retry.v1'), 'retry audit should survive handoff slimming');
assert.ok(!retrySerialized.includes(hugeText.slice(0, 50_000)), 'retry handoff should not re-inline large prior context');

console.log('[ok] backend handoff budget keeps large artifacts, binary images, stdout, prior attempts, and rate-limit retry handoffs compact with raw refs');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
