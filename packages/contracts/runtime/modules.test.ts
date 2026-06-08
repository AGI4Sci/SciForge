import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  boundedOperationResult,
  sanitizeBoundedOperationResult,
  validateBoundedOperationRequest,
  createModuleDescription,
  moduleIntent,
  moduleIntentRequiresApproval,
  moduleResult,
  moduleSupportsFacet,
  moduleSupportsFunction,
} from './modules';

test('module description declares supported functions from resources and intents', () => {
  const description = createModuleDescription({
    moduleId: 'gui',
    title: 'GUI',
    summary: 'Presentation and interaction module.',
    resources: [{ kind: 'hot-region', refPrefix: 'gui:', queryable: true, readable: true }],
    intents: [{ name: 'present', sideEffect: 'local' }],
  });

  assert.equal(moduleSupportsFunction(description, 'describe'), true);
  assert.equal(moduleSupportsFunction(description, 'query'), true);
  assert.equal(moduleSupportsFunction(description, 'read'), true);
  assert.equal(moduleSupportsFunction(description, 'invoke'), true);
});

test('module functions and facets fail closed when not declared', () => {
  const description = createModuleDescription({
    moduleId: 'skills',
    title: 'Skills',
    summary: 'Skill catalog.',
    functions: { query: true, read: false, invoke: false },
    facets: { refs: true },
  });

  assert.equal(moduleSupportsFunction(description, 'query'), true);
  assert.equal(moduleSupportsFunction(description, 'read'), false);
  assert.equal(moduleSupportsFunction(description, 'invoke'), false);
  assert.equal(moduleSupportsFacet(description, 'refs'), true);
  assert.equal(moduleSupportsFacet(description, 'events'), false);
});

test('module intents expose approval and operation metadata', () => {
  const description = createModuleDescription({
    moduleId: 'connectors',
    title: 'Connectors',
    summary: 'External app connectors.',
    intents: [
      { name: 'draft_message', sideEffect: 'local' },
      { name: 'send_message', sideEffect: 'external', requiresApproval: true, returnsOperation: true },
    ],
    facets: { approval: true, events: true, refs: true },
  });

  assert.equal(moduleIntent(description, 'send_message')?.sideEffect, 'external');
  assert.equal(moduleIntentRequiresApproval(description, 'send_message'), true);
  assert.equal(moduleIntentRequiresApproval(description, 'draft_message'), false);
  assert.equal(moduleSupportsFacet(description, 'approval'), true);
});

test('module result envelopes carry the contract schema version', () => {
  const result = moduleResult({
    moduleId: 'memory',
    ok: true,
    value: { ref: 'memory:project:1' },
    refs: ['memory:project:1'],
  });

  assert.equal(result.schemaVersion, 'sciforge.module-contract.v1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.refs, ['memory:project:1']);
});

test('bounded operation request is a typed module.invoke intent with boundary-only config', () => {
  const validation = validateBoundedOperationRequest({
    moduleId: 'knowledge',
    intent: 'executeBoundedOperation',
    input: {
      operationKind: 'knowledge.collect_evidence',
      ownerModuleId: 'knowledge',
      targetScope: { kind: 'topic', query: 'frontier AI model progress this week' },
      config: {
        allowedActions: ['query', 'read', 'summarize'],
        maxSteps: 4,
        maxTimeMs: 10_000,
        maxModelCalls: 1,
        riskPolicy: 'low',
        requiredEvidence: ['source-ref', 'summary-ref'],
        stopConditions: ['enough-evidence'],
      },
    },
  });

  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test('bounded operation request rejects missing required budgets and stop conditions', () => {
  const validConfig = {
    allowedActions: ['search', 'open', 'read'],
    maxSteps: 4,
    maxTimeMs: 10_000,
    maxModelCalls: 1,
    riskPolicy: 'low',
    requiredEvidence: ['source-page-ref', 'page-text-ref'],
    stopConditions: ['enough-source-pages'],
  };
  const cases: Array<{ name: string; omit?: keyof typeof validConfig; override?: Record<string, unknown>; error: RegExp }> = [
    { name: 'maxSteps', omit: 'maxSteps', error: /missing_budget:config\.maxSteps/ },
    { name: 'maxTimeMs', omit: 'maxTimeMs', error: /missing_budget:config\.maxTimeMs/ },
    { name: 'maxModelCalls', omit: 'maxModelCalls', error: /missing_budget:config\.maxModelCalls/ },
    { name: 'stopConditions', omit: 'stopConditions', error: /invalid_string_list:config\.stopConditions/ },
    { name: 'empty stopConditions', override: { stopConditions: [] }, error: /invalid_string_list:config\.stopConditions/ },
  ];

  for (const entry of cases) {
    const config: Record<string, unknown> = { ...validConfig, ...entry.override };
    if (entry.omit) delete config[entry.omit];
    const validation = validateBoundedOperationRequest({
      moduleId: 'browser',
      intent: 'executeBoundedOperation',
      input: {
        operationKind: 'browser.search_read',
        ownerModuleId: 'browser',
        targetScope: { kind: 'web-search', query: 'frontier AI model progress this week' },
        config,
      },
    });

    assert.equal(validation.ok, false, entry.name);
    assert.match(validation.errors.join('\n'), entry.error, entry.name);
  }
});

test('bounded operation request rejects config fields outside the boundary contract', () => {
  const validation = validateBoundedOperationRequest({
    moduleId: 'browser',
    intent: 'executeBoundedOperation',
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'frontier AI model progress this week' },
      config: {
        allowedActions: ['search', 'open', 'read'],
        maxSteps: 4,
        maxTimeMs: 10_000,
        maxModelCalls: 1,
        stopConditions: ['enough-source-pages'],
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
        promptRewrite: 'search for a broader topic',
      },
    },
  });

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /unknown_boundary_config_field:config\.promptRewrite/);
});

test('bounded operation request rejects nested operations and workflow DSL fields', () => {
  const validation = validateBoundedOperationRequest({
    moduleId: 'browser',
    intent: 'executeBoundedOperation',
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'x' },
      config: {
        allowedActions: ['search'],
        maxSteps: 1,
        maxTimeMs: 10_000,
        maxModelCalls: 0,
        requiredEvidence: ['source-page-ref'],
        stopConditions: ['nested-operation-detected'],
        if: 'result.count === 0',
        loop: { until: 'done' },
      },
      steps: [{ intent: 'executeBoundedOperation' }],
    },
  });

  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /forbidden_dsl_field:config\.if/);
  assert.match(validation.errors.join('\n'), /forbidden_dsl_field:config\.loop/);
  assert.match(validation.errors.join('\n'), /nested_executeBoundedOperation_forbidden/);
});

test('bounded operation result covers canonical statuses and keeps evidence refs-first', () => {
  const statuses = ['completed', 'partial', 'blocked', 'needs-confirmation', 'failed'] as const;

  for (const status of statuses) {
    const result = boundedOperationResult({
      moduleId: 'knowledge',
      operationKind: 'knowledge.read_source',
      status,
      evidenceRefs: [`knowledge:evidence:${status}`],
      value: {
        status,
        screenshotBase64: 'raw-data-must-not-stay-inline',
        nested: {
          providerPayload: { token: 'secret', body: 'large raw provider response' },
          useful: 'kept',
        },
      },
    });

    const sanitized = sanitizeBoundedOperationResult(result);
    assert.equal(sanitized.value?.status, status);
    assert.deepEqual(sanitized.refs, [`knowledge:evidence:${status}`]);
    assert.equal(JSON.stringify(sanitized).includes('raw-data-must-not-stay-inline'), false);
    assert.equal(JSON.stringify(sanitized).includes('large raw provider response'), false);
    assert.equal((sanitized.value?.payload as { nested?: { useful?: string } }).nested?.useful, 'kept');
  }
});

test('bounded operation result reports budget exhaustion without automatic repair', () => {
  const result = boundedOperationResult({
    moduleId: 'computer_use',
    operationKind: 'computer_use.perform_local_action',
    status: 'blocked',
    blockedReason: 'budget_exhausted:maxSteps',
    repairHint: 'Ask the Host for a narrower target scope or a larger explicit budget.',
    evidenceRefs: ['computer-use:evidence:before-1'],
    budgets: { maxSteps: 1, stepsUsed: 1, exhausted: ['maxSteps'] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.value?.status, 'blocked');
  assert.equal(result.value?.blockedReason, 'budget_exhausted:maxSteps');
  assert.equal(result.value?.repairHint?.includes('Ask the Host'), true);
  assert.equal(JSON.stringify(result).includes('autoRepair'), false);
});

test('bounded operation result filters inline, fixture, replay, and historical refs from evidence', () => {
  const result = boundedOperationResult({
    moduleId: 'knowledge',
    operationKind: 'knowledge.collect_evidence',
    status: 'completed',
    evidenceRefs: [
      'knowledge:current/source-pages/source-1.txt',
      'data:image/png;base64,abc',
      'fixture:knowledge/source-page',
      'history:run-123/evidence',
      'replay:old-module-projection',
      'raw:provider-payload',
    ],
  });

  assert.deepEqual(result.refs, ['knowledge:current/source-pages/source-1.txt']);
  assert.deepEqual(result.value?.evidenceRefs, ['knowledge:current/source-pages/source-1.txt']);
});
