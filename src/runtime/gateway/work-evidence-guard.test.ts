import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest, ToolPayload } from '../runtime-types';
import { evaluateToolPayloadEvidence } from './work-evidence-guard';
import { collectWorkEvidence, parseWorkEvidence } from './work-evidence-types';

const request = {
  prompt: '调研最近一周公开文献并总结趋势',
} as GatewayRequest;

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'Retrieved 0 papers from external search.',
    confidence: 0.9,
    claimType: 'literature_survey',
    evidenceLevel: 'high',
    reasoningTrace: 'Queried provider API. Retrieved 0 papers.',
    claims: [{ text: '检索到 0 篇论文', confidence: 0.9 }],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done', tool: 'provider.search' }],
    artifacts: [],
    ...overrides,
  };
}

test('flags external zero-result payloads that lack provider diagnostics', () => {
  const finding = evaluateToolPayloadEvidence(payload(), request);

  assert.equal(finding?.kind, 'external-empty-result-without-diagnostics');
  assert.equal(finding?.severity, 'repair-needed');
  assert.match(finding?.reason ?? '', /provider status|fallback|failed-with-reason/);
});

test('work evidence schema accepts the runtime-side evidence contract', () => {
  const parsed = parseWorkEvidence({
    kind: 'retrieval',
    status: 'empty',
    provider: 'generic-search',
    input: { query: 'recent papers' },
    resultCount: 0,
    outputSummary: 'Provider returned no records.',
    evidenceRefs: ['trace:search-1'],
    failureReason: 'No matching records after fallback.',
    recoverActions: ['Try a broader query.'],
    nextStep: 'Ask user whether to broaden the date window.',
    diagnostics: ['provider status 200 totalResults=0'],
    rawRef: 'file:.sciforge/raw/search.json',
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value?.kind, 'retrieval');
  assert.equal(parsed.value?.resultCount, 0);
  assert.equal(parsed.value?.nextStep, 'Ask user whether to broaden the date window.');
  assert.deepEqual(parsed.value?.diagnostics, ['provider status 200 totalResults=0']);
  assert.deepEqual(parsed.value?.evidenceRefs, ['trace:search-1']);
});

test('work evidence schema rejects non-numeric resultCount and non-array diagnostics', () => {
  const parsed = parseWorkEvidence({
    kind: 'retrieval',
    status: 'empty',
    resultCount: '0',
    diagnostics: 'provider status 200',
    evidenceRefs: ['trace:search-1'],
    recoverActions: [],
  });

  assert.equal(parsed.ok, false);
  assert.ok(parsed.issues.some((issue) => issue.path === 'resultCount'));
  assert.ok(parsed.issues.some((issue) => issue.path === 'diagnostics'));
});

test('work evidence schema rejects missing required kind/status fields', () => {
  const parsed = parseWorkEvidence({
    evidenceRefs: ['trace:search-1'],
    recoverActions: [],
  });

  assert.equal(parsed.ok, false);
  assert.ok(parsed.issues.some((issue) => issue.path === 'kind'));
  assert.ok(parsed.issues.some((issue) => issue.path === 'status'));
});

test('work evidence collector does not mistake TaskStage records for evidence', () => {
  const records = collectWorkEvidence({
    schemaVersion: 'sciforge.task-stage.v1',
    id: '1-search',
    projectId: 'project-1',
    kind: 'search',
    status: 'done',
    goal: 'Search records.',
    evidenceRefs: ['file:.sciforge/projects/project-1/evidence/search.json'],
    recoverActions: [],
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      resultCount: 2,
      outputSummary: 'Two records.',
      evidenceRefs: ['trace:search'],
      recoverActions: [],
    }],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.kind, 'retrieval');
  assert.equal(records[0]?.resultCount, 2);
});

test('allows zero-result payloads when explicit fallback or provider status evidence is present', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    reasoningTrace: [
      'provider status 200 totalResults=0',
      'fallback query attempted against secondary provider status 200 totalResults=0',
      'empty result after fallback was reported honestly',
    ].join('\n'),
  }), request);

  assert.equal(finding, undefined);
});

test('does not apply external retrieval guard to non-retrieval requests', () => {
  const finding = evaluateToolPayloadEvidence(payload(), {
    prompt: '整理当前工作台状态',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('allows external zero-result payloads when WorkEvidence records provider status and recovery', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    reasoningTrace: 'Retrieved 0 records.',
    workEvidence: [{
      kind: 'retrieval',
      status: 'empty',
      provider: 'generic-provider',
      input: { query: 'latest public records' },
      outputSummary: 'Provider status 200, totalResults=0.',
      evidenceRefs: ['trace:provider-200'],
      recoverActions: ['Fallback provider was queried.'],
    }],
  } as Partial<ToolPayload>), request);

  assert.equal(finding, undefined);
});

test('allows thin adapter retrieval payloads with structured WorkEvidence and refs', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Thin adapter searched one provider and returned 3 current records.',
    confidence: 0.88,
    evidenceLevel: 'high',
    reasoningTrace: 'Adapter wrote bounded query, provider status, raw response ref, and result refs.',
    executionUnits: [{ id: 'thin-search', status: 'done', tool: 'thin-reproducible-adapter.search' }],
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      provider: 'generic-search',
      input: { query: 'recent public records', limit: 5 },
      resultCount: 3,
      outputSummary: 'Provider status 200; returned 3 records.',
      evidenceRefs: ['file:.sciforge/projects/p1/evidence/search-summary.json'],
      recoverActions: [],
      rawRef: 'file:.sciforge/projects/p1/evidence/search-raw.json',
    }],
  } as Partial<ToolPayload>), {
    prompt: '检索最近公开资料并给出简短摘要',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('flags external WorkEvidence success without durable refs', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Fetch completed with a summarized answer.',
    confidence: 0.88,
    reasoningTrace: 'Backend fetched a public source and summarized it.',
    executionUnits: [{ id: 'fetch', status: 'done', tool: 'backend.fetch' }],
    workEvidence: [{
      kind: 'fetch',
      status: 'success',
      provider: 'generic-http',
      input: 'https://example.test/source',
      outputSummary: 'Fetched source successfully.',
      evidenceRefs: [],
      recoverActions: [],
    }],
  } as Partial<ToolPayload>), {
    prompt: '抓取公开网页并总结',
  } as GatewayRequest);

  assert.equal(finding?.kind, 'external-io-without-durable-evidence-ref');
  assert.equal(finding?.severity, 'repair-needed');
});

test('allows external WorkEvidence success when rawRef is durable', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Fetch completed with a summarized answer.',
    confidence: 0.88,
    reasoningTrace: 'Backend fetched a public source and summarized it.',
    executionUnits: [{ id: 'fetch', status: 'done', tool: 'backend.fetch' }],
    workEvidence: [{
      kind: 'fetch',
      status: 'success',
      provider: 'generic-http',
      input: 'https://example.test/source',
      outputSummary: 'Fetched source successfully.',
      evidenceRefs: [],
      recoverActions: [],
      rawRef: 'agentserver://run/fetch/raw',
    }],
  } as Partial<ToolPayload>), {
    prompt: '抓取公开网页并总结',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('flags verified claims without evidence refs', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Claim verified.',
    reasoningTrace: 'Validated from available context.',
    claims: [{ text: 'Result is 已验证', status: 'verified', confidence: 0.92 }],
    executionUnits: [{ id: 'claim', status: 'done' }],
  }), {
    prompt: '总结当前结果',
  } as GatewayRequest);

  assert.equal(finding?.kind, 'verified-claim-without-evidence');
  assert.equal(finding?.severity, 'repair-needed');
});

test('allows verified claims when evidence refs are present', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Claim verified.',
    reasoningTrace: 'Validated from cited evidence.',
    claims: [{ text: 'Result is 已验证', status: 'verified', evidenceRefs: ['artifact:claim-source'] }],
    executionUnits: [{ id: 'claim', status: 'done' }],
  }), {
    prompt: '总结当前结果',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('flags non-zero command exitCode hidden behind successful payload status', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Command completed successfully.',
    confidence: 0.94,
    reasoningTrace: 'Shell command completed.',
    executionUnits: [{ id: 'cmd', tool: 'shell', status: 'done', exitCode: 2 }],
  }), {
    prompt: '运行本地命令并总结',
  } as GatewayRequest);

  assert.equal(finding?.kind, 'command-failed-but-successful-payload');
  assert.equal(finding?.severity, 'repair-needed');
});

test('allows non-zero command exitCode when payload is explicitly failed', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Command failed with exit code 2.',
    confidence: 0.2,
    claimType: 'error',
    reasoningTrace: 'stderr captured.',
    executionUnits: [{ id: 'cmd', tool: 'shell', status: 'failed', exitCode: 2 }],
  }), {
    prompt: '运行本地命令并总结',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('flags swallowed fetch timeout or 429 in high-confidence success payloads', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Fetch completed successfully with high confidence.',
    confidence: 0.96,
    evidenceLevel: 'high',
    reasoningTrace: 'Primary fetch hit HTTP 429 and timed out, final answer completed successfully.',
    executionUnits: [{ id: 'fetch', status: 'done', tool: 'fetch' }],
  }), {
    prompt: '抓取公开网页并总结',
  } as GatewayRequest);

  assert.equal(finding?.kind, 'fetch-failure-swallowed-by-success');
  assert.equal(finding?.severity, 'repair-needed');
});

test('allows fetch timeout or 429 when recovery evidence is recorded', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Fetch completed after fallback.',
    confidence: 0.91,
    evidenceLevel: 'high',
    reasoningTrace: 'Primary fetch returned HTTP 429. Retried with fallback provider and recovered.',
    executionUnits: [{ id: 'fetch', status: 'done', tool: 'fetch' }],
    workEvidence: [{
      kind: 'fetch',
      status: 'partial',
      provider: 'generic-http',
      input: 'https://example.test',
      outputSummary: '429 on primary; fallback succeeded.',
      evidenceRefs: ['trace:fetch-fallback'],
      recoverActions: ['Retry with backoff.'],
    }],
  } as Partial<ToolPayload>), {
    prompt: '抓取公开网页并总结',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('flags uiManifest-referenced artifacts without dataRef or schema', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Generated table artifact.',
    reasoningTrace: 'Artifact ready.',
    uiManifest: [{ component: 'table', artifactId: 'artifact-1' }],
    artifacts: [{ id: 'artifact-1', type: 'table', title: 'Rows' }],
  }), {
    prompt: '生成一个结果表',
  } as GatewayRequest);

  assert.equal(finding?.kind, 'referenced-artifact-without-data-contract');
  assert.equal(finding?.severity, 'repair-needed');
});

test('allows uiManifest-referenced artifacts with dataRef or schema', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Generated table artifact.',
    reasoningTrace: 'Artifact ready.',
    uiManifest: [{ component: 'table', artifactId: 'artifact-1' }],
    artifacts: [{ id: 'artifact-1', type: 'table', dataRef: 'file:.sciforge/artifacts/table.json', schema: { type: 'object' } }],
  }), {
    prompt: '生成一个结果表',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});

test('allows a healthy successful payload with complete evidence', () => {
  const finding = evaluateToolPayloadEvidence(payload({
    message: 'Completed successfully.',
    confidence: 0.93,
    evidenceLevel: 'high',
    reasoningTrace: 'Command exited with exitCode 0 and artifact was produced.',
    claims: [{ text: 'Result is verified', status: 'verified', evidenceRefs: ['artifact:artifact-1'] }],
    executionUnits: [{ id: 'cmd', status: 'done', exitCode: 0 }],
    uiManifest: [{ component: 'table', artifactId: 'artifact-1' }],
    artifacts: [{ id: 'artifact-1', dataRef: 'file:.sciforge/artifacts/table.json', schema: { type: 'object' } }],
    workEvidence: [{
      kind: 'command',
      status: 'success',
      provider: 'local-shell',
      input: { command: 'node task.js' },
      outputSummary: 'exitCode 0',
      evidenceRefs: ['artifact:artifact-1'],
      recoverActions: [],
      rawRef: 'file:.sciforge/logs/cmd.json',
    }],
  } as Partial<ToolPayload>), {
    prompt: '生成一个结果表',
  } as GatewayRequest);

  assert.equal(finding, undefined);
});
