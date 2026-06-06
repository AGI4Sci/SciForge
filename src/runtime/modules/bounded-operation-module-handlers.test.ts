import assert from 'node:assert/strict';
import test from 'node:test';

import { EXECUTE_BOUNDED_OPERATION_INTENT, type BoundedOperationResultValue } from '@sciforge-ui/runtime-contract/modules';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from './dispatcher.js';
import {
  createBrowserBoundedOperationModuleHandler,
  createComputerUseBoundedOperationModuleHandler,
} from './bounded-operation-module-handlers.js';
import {
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostOpenReadInput,
  type BrowserHostOpenReadOutput,
  type BrowserHostSearchInput,
  type BrowserHostSearchOutput,
  type BrowserHostSessionManager,
} from '../browser-host-session.js';

function requiredBoundedLimits(stopConditions = ['local-operation-complete']) {
  return {
    maxSteps: 4,
    maxTimeMs: 10_000,
    maxModelCalls: 1,
    stopConditions,
  };
}

test('browser.search_read returns opened source page and page text refs, not search result page as completion evidence', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({
      searchRead: async () => ({
        sourceRefs: ['browser:source-page:frontier-models'],
        pageTextRefs: ['browser:page-text:frontier-models'],
        searchResultRefs: ['browser:search-results:query-page'],
        sourcePages: [{ title: 'Frontier models update', url: 'https://example.test/ai', textRef: 'browser:page-text:frontier-models' }],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'frontier AI model progress this week' },
      config: {
        allowedActions: ['search', 'open', 'read'],
        maxSteps: 4,
        maxTimeMs: 10_000,
        maxModelCalls: 1,
        riskPolicy: 'low',
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
        stopConditions: ['enough-source-pages'],
      },
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as BoundedOperationResultValue<{ sourcePages: unknown[] }>;
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.sourceRefs, ['browser:source-page:frontier-models']);
  assert.deepEqual(value.evidenceRefs, ['browser:source-page:frontier-models', 'browser:page-text:frontier-models']);
  assert.equal(result.refs?.includes('browser:search-results:query-page'), false);
});

test('browser bounded operation fails closed before local work when required limits are missing', async () => {
  let searchReadCalls = 0;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({
      searchRead: async () => {
        searchReadCalls += 1;
        return {
          sourceRefs: ['browser:source-page:frontier-models'],
          pageTextRefs: ['browser:page-text:frontier-models'],
        };
      },
    }),
  }));
  const validConfig = {
    allowedActions: ['search', 'open', 'read'],
    ...requiredBoundedLimits(['enough-source-pages']),
    riskPolicy: 'low',
    requiredEvidence: ['source-page-ref', 'page-text-ref'],
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
    const result = await dispatcher.invoke({
      moduleId: 'browser',
      intent: EXECUTE_BOUNDED_OPERATION_INTENT,
      input: {
        operationKind: 'browser.search_read',
        ownerModuleId: 'browser',
        targetScope: { kind: 'web-search', query: 'frontier AI' },
        config,
      },
    });

    assert.equal(result.ok, false, entry.name);
    assert.match(result.error ?? '', entry.error, entry.name);
  }
  assert.equal(searchReadCalls, 0);
});

test('browser.search_read adapter can use BrowserHostSessionManager while returning only operation evidence refs', async () => {
  const calls: Array<{ workspacePath: string; input: BrowserHostSearchInput }> = [];
  const manager = {
    async search(workspacePath: string, input: BrowserHostSearchInput): Promise<BrowserHostSearchOutput> {
      calls.push({ workspacePath, input });
      return {
        schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
        query: input.query,
        engine: 'bing',
        searchedAt: '2026-06-06T00:00:00.000Z',
        searchUrl: 'https://www.bing.com/search?q=frontier',
        finalUrl: 'https://www.bing.com/search?q=frontier',
        results: [{ title: 'Frontier model news', url: 'https://example.test/frontier', snippet: 'snippet' }],
        sourcePages: [{
          resultIndex: 0,
          title: 'Frontier model news',
          url: 'https://example.test/frontier',
          finalUrl: 'https://example.test/frontier',
          openedAt: '2026-06-06T00:00:01.000Z',
          status: 'read',
          textRef: 'browser-host-session:search/source-pages/source-1.txt',
        }],
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'search',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: '/workspace',
          requestedUrl: 'https://www.bing.com/search?q=frontier',
          url: 'https://www.bing.com/search?q=frontier',
          startedAt: '2026-06-06T00:00:00.000Z',
          updatedAt: '2026-06-06T00:00:01.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
        },
        searchResultRef: 'browser-host-session:search/search-results.json',
      };
    },
  } as unknown as BrowserHostSessionManager;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({ workspacePath: '/workspace', manager }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'frontier AI model progress this week' },
      config: {
        allowedActions: ['search', 'open', 'read'],
        ...requiredBoundedLimits(['enough-source-pages']),
        riskPolicy: 'low',
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0]?.workspacePath, '/workspace');
  assert.equal(calls[0]?.input.query, 'frontier AI model progress this week');
  const value = result.value as BoundedOperationResultValue;
  assert.deepEqual(value.sourceRefs, ['browser-host-session:search/source-pages/source-1.source.json']);
  assert.deepEqual(value.evidenceRefs, [
    'browser-host-session:search/source-pages/source-1.source.json',
    'browser-host-session:search/source-pages/source-1.txt',
  ]);
  assert.equal(result.refs?.includes('browser-host-session:search/search-results.json'), false);
});

test('browser bounded operation enforces allowedActions and exhausted budgets before calling manager', async () => {
  let managerCalled = false;
  const manager = {
    async search() {
      managerCalled = true;
      throw new Error('manager must not be called');
    },
  } as unknown as BrowserHostSessionManager;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({ workspacePath: '/workspace', manager }),
  }));

  const disallowed = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'frontier AI' },
      config: {
        allowedActions: ['search', 'read'],
        ...requiredBoundedLimits(['action-allowed']),
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });
  assert.equal(disallowed.ok, false);
  assert.match((disallowed.value as BoundedOperationResultValue).blockedReason ?? '', /action_not_allowed:open/);

  const exhausted = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.search_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'web-search', query: 'frontier AI' },
      config: {
        allowedActions: ['search', 'open', 'read'],
        ...requiredBoundedLimits(['budget-available']),
        maxSteps: 0,
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });
  assert.equal(exhausted.ok, false);
  const exhaustedValue = exhausted.value as BoundedOperationResultValue;
  assert.equal(exhaustedValue.status, 'blocked');
  assert.match(exhaustedValue.blockedReason ?? '', /budget_exhausted:maxSteps/);
  assert.deepEqual(exhaustedValue.budgets?.exhausted, ['maxSteps']);
  assert.equal(managerCalled, false);
});

test('browser.open_read blocks when opened page text evidence is missing', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({
      openRead: async () => ({
        sourceRefs: ['browser:source-page:empty'],
        pageTextRefs: [],
        sourcePages: [{ title: 'Empty', url: 'https://example.test/empty' }],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.open_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'url', url: 'https://example.test/empty' },
      config: {
        allowedActions: ['open', 'read'],
        ...requiredBoundedLimits(['page-text-evidence-present']),
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });

  assert.equal(result.ok, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /missing_required_evidence:page-text-ref/);
  assert.deepEqual(value.evidenceRefs, ['browser:source-page:empty']);
});

test('browser.open_read adapter can use BrowserHostSessionManager for URL read evidence', async () => {
  const calls: Array<{ workspacePath: string; input: BrowserHostOpenReadInput }> = [];
  const manager = {
    async openRead(workspacePath: string, input: BrowserHostOpenReadInput): Promise<BrowserHostOpenReadOutput> {
      calls.push({ workspacePath, input });
      return {
        sourcePage: {
          resultIndex: 0,
          title: 'Open read source',
          url: input.url,
          finalUrl: input.url,
          openedAt: '2026-06-06T00:00:02.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:open/source-pages/source-1.source.json',
          textRef: 'browser-host-session:open/source-pages/source-1.txt',
          textPreview: 'Current page text evidence.',
        },
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'open',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: '/workspace',
          requestedUrl: input.url,
          url: input.url,
          startedAt: '2026-06-06T00:00:00.000Z',
          updatedAt: '2026-06-06T00:00:02.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
        },
      };
    },
  } as unknown as BrowserHostSessionManager;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({ workspacePath: '/workspace', manager }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.open_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'url', url: 'https://example.test/source', sessionId: 'open' },
      config: {
        allowedActions: ['open', 'read'],
        ...requiredBoundedLimits(['page-read']),
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0]?.workspacePath, '/workspace');
  assert.deepEqual(calls[0]?.input, {
    url: 'https://example.test/source',
    sessionId: 'open',
    title: undefined,
    timeoutMs: 10_000,
  });
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.sourceRefs, ['browser-host-session:open/source-pages/source-1.source.json']);
  assert.deepEqual(value.evidenceRefs, [
    'browser-host-session:open/source-pages/source-1.source.json',
    'browser-host-session:open/source-pages/source-1.txt',
  ]);
  assert.equal(JSON.stringify(result).includes('finalAnswer'), false);
});

test('browser.open_read adapter blocks failed manager reads without using failure metadata as evidence', async () => {
  const manager = {
    async openRead(_workspacePath: string, input: BrowserHostOpenReadInput): Promise<BrowserHostOpenReadOutput> {
      return {
        sourcePage: {
          resultIndex: 0,
          title: 'Blocked source',
          url: input.url,
          finalUrl: input.url,
          openedAt: '2026-06-06T00:00:02.000Z',
          status: 'failed',
          error: 'navigation blocked',
        },
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'blocked-open',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'failed',
          workspacePath: '/workspace',
          requestedUrl: input.url,
          url: input.url,
          startedAt: '2026-06-06T00:00:00.000Z',
          updatedAt: '2026-06-06T00:00:02.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: ['navigation blocked'],
        },
      };
    },
  } as unknown as BrowserHostSessionManager;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserBoundedOperationModuleHandler({ workspacePath: '/workspace', manager }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'browser',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'browser.open_read',
      ownerModuleId: 'browser',
      targetScope: { kind: 'url', url: 'https://example.test/blocked' },
      config: {
        allowedActions: ['open', 'read'],
        ...requiredBoundedLimits(['source-read-or-blocked']),
        requiredEvidence: ['source-page-ref', 'page-text-ref'],
      },
    },
  });

  assert.equal(result.ok, false);
  const value = result.value as BoundedOperationResultValue<{ sourcePages: unknown[] }>;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /missing_required_evidence:source-page-ref,page-text-ref/);
  assert.deepEqual(value.evidenceRefs, []);
  assert.ok(value.payload);
  assert.deepEqual(value.payload.sourcePages, []);
});

test('computer_use.perform_local_action requires target-bound fresh evidence, grounding, executor, and after evidence', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => ({
        beforeEvidenceRef: 'computer-use:evidence:before',
        groundingRefs: ['computer-use:grounding:button'],
        executorEventRef: 'computer-use:executor:event',
        afterEvidenceRef: 'computer-use:evidence:after',
        staleInvalidationRefs: ['computer-use:evidence:before#stale'],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: { kind: 'window', targetBindingRef: 'computer-use:target:window-1' },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['local-action-verified']),
        maxSteps: 1,
        riskPolicy: 'low',
        requiredEvidence: ['before-evidence-ref', 'grounding-ref', 'executor-event-ref', 'after-evidence-ref', 'stale-invalidation-ref'],
      },
      action: { kind: 'click', target: 'Save' },
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.evidenceRefs, [
    'computer-use:evidence:before',
    'computer-use:grounding:button',
    'computer-use:executor:event',
    'computer-use:evidence:after',
    'computer-use:evidence:before#stale',
  ]);
});

test('computer_use.fill_fields completes only with refs-first action evidence and never submits', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      fillFields: async () => ({
        beforeEvidenceRef: 'computer-use:evidence:form-before',
        groundingRefs: [
          'computer-use:grounding:name-input',
          'computer-use:grounding:email-input',
        ],
        executorEventRef: 'computer-use:executor:fill-fields-event',
        afterEvidenceRef: 'computer-use:evidence:form-after',
        staleInvalidationRefs: ['computer-use:evidence:form-before#stale'],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.fill_fields',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'form',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:form-1',
        permissionRefs: ['computer-use:permission:accessibility-granted'],
        scopedExecutorRef: 'computer-use:executor-scope:form-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['fill_fields'],
        ...requiredBoundedLimits(['fields-filled-without-submit']),
        maxSteps: 1,
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
          'before-evidence-ref',
          'grounding-ref',
          'executor-event-ref',
          'after-evidence-ref',
          'stale-invalidation-ref',
        ],
      },
      action: {
        kind: 'fill_fields',
        fields: [
          { ref: 'computer-use:grounding:name-input', valueRef: 'computer-use:input-value:name' },
          { ref: 'computer-use:grounding:email-input', valueRef: 'computer-use:input-value:email' },
        ],
        submit: false,
      },
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.evidenceRefs, [
    'computer-use:native-host:session-1',
    'computer-use:permission:accessibility-granted',
    'computer-use:executor-scope:form-1',
    'computer-use:stop-cancel:path-1',
    'computer-use:evidence:form-before',
    'computer-use:grounding:name-input',
    'computer-use:grounding:email-input',
    'computer-use:executor:fill-fields-event',
    'computer-use:evidence:form-after',
    'computer-use:evidence:form-before#stale',
  ]);
  assert.deepEqual(value.actionRefs, ['computer-use:executor:fill-fields-event']);
  assert.equal(JSON.stringify(result).includes('Alice'), false);
  assert.equal(JSON.stringify(result).includes('alice@example.test'), false);
});

test('computer_use blocks when GUI projection or inline payload is offered as action evidence', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => ({
        beforeEvidenceRef: 'computer-use:evidence:before',
        groundingRefs: ['computer-use:grounding:button'],
        executorEventRef: 'gui-projection:executor-event',
        afterEvidenceRef: 'gui-projection:after-click',
        staleInvalidationRefs: ['data:application/json;base64,eyJzdGFsZSI6dHJ1ZX0='],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRefs: ['computer-use:permission:accessibility-granted'],
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['valid-action-evidence-present']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
          'before-evidence-ref',
          'grounding-ref',
          'executor-event-ref',
          'after-evidence-ref',
          'stale-invalidation-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
    },
  });

  assert.equal(result.ok, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /missing_required_evidence:executor-event-ref,after-evidence-ref,stale-invalidation-ref/);
  assert.deepEqual(value.evidenceRefs, [
    'computer-use:native-host:session-1',
    'computer-use:permission:accessibility-granted',
    'computer-use:executor-scope:window-1',
    'computer-use:stop-cancel:path-1',
    'computer-use:evidence:before',
    'computer-use:grounding:button',
  ]);
  assert.deepEqual(value.actionRefs, []);
  assert.equal(JSON.stringify(result).includes('gui-projection:executor-event'), false);
  assert.equal(JSON.stringify(result).includes('gui-projection:after-click'), false);
  assert.equal(JSON.stringify(result).includes('data:application/json'), false);
});

test('computer_use blocks missing native host, permission, scoped executor, and stop/cancel path before executor', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        return {
          beforeEvidenceRef: 'computer-use:evidence:before',
          groundingRefs: ['computer-use:grounding:button'],
          executorEventRef: 'computer-use:executor:event',
          afterEvidenceRef: 'computer-use:evidence:after',
          staleInvalidationRefs: ['computer-use:evidence:before#stale'],
        };
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        targetBindingRef: 'computer-use:target:window-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['target-evidence-present']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
          'before-evidence-ref',
          'grounding-ref',
          'executor-event-ref',
          'after-evidence-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /missing_required_evidence:native-host-ref,permission-ref,scoped-executor-ref,stop-cancel-ref/);
  assert.match(value.repairHint ?? '', /native host/i);
});

test('computer_use preflight blocked result preserves existing target evidence refs', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRefs: ['computer-use:permission:accessibility-granted'],
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['target-evidence-present']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /missing_required_evidence:scoped-executor-ref,stop-cancel-ref/);
  assert.deepEqual(value.evidenceRefs, [
    'computer-use:native-host:session-1',
    'computer-use:permission:accessibility-granted',
  ]);
  assert.deepEqual(result.refs, [
    'computer-use:native-host:session-1',
    'computer-use:permission:accessibility-granted',
  ]);
});

test('computer_use bounded operation treats Model Router output as candidate and blocks policy violations', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: { kind: 'window', targetBindingRef: 'computer-use:target:window-1' },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['candidate-policy-valid']),
        riskPolicy: 'low',
        requiredEvidence: ['before-evidence-ref'],
      },
      modelRouterCandidate: {
        action: { kind: 'type_text', text: 'candidate only' },
        riskPolicy: 'high',
        completionTruth: { status: 'completed' },
        finalAnswer: 'Done',
      },
    },
  });

  assert.equal(result.ok, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /candidate_action_not_allowed:type_text/);
  assert.equal(JSON.stringify(result).includes('finalAnswer'), false);
  assert.equal(JSON.stringify(result).includes('completionTruth'), false);
});

test('computer_use blocks Model Router candidate action until Host binds the executable action', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['host-bound-action-present']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
        ],
      },
      modelRouterCandidate: {
        action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
        uncertainty: 'target label may refer to one of two nearby buttons',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /candidate_action_requires_host_binding/);
});

test('computer_use blocks Model Router candidate cross-module next step, confirmation bypass, and auto repair', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['confirmation-policy-preserved']),
        riskPolicy: 'confirmation-required',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
      modelRouterCandidate: {
        action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
        nextStep: { moduleId: 'browser', operationKind: 'browser.open_read' },
        approvalToken: 'candidate-token',
        autoRepair: { retryWith: { action: { kind: 'click' } } },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /candidate_cross_module_next_step_forbidden/);
  assert.equal(JSON.stringify(result).includes('candidate-token'), false);
});

test('computer_use blocks stale or non-host Model Router candidate evidence before executor', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['fresh-candidate-evidence']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
      modelRouterCandidate: {
        action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
        freshEvidenceRefs: ['history:previous-run-screenshot'],
        freshness: { status: 'stale', reason: 'observation belongs to a previous run' },
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /candidate_fresh_evidence_invalid/);
  assert.equal(JSON.stringify(result).includes('history:previous-run-screenshot'), false);
});

test('computer_use accepts local Model Router candidate only as Host-bound action guidance', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => ({
        beforeEvidenceRef: 'computer-use:evidence:before',
        groundingRefs: ['computer-use:grounding:button'],
        executorEventRef: 'computer-use:executor:event',
        afterEvidenceRef: 'computer-use:evidence:after',
        staleInvalidationRefs: ['computer-use:evidence:before#stale'],
      }),
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['local-action-guidance-only']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
          'before-evidence-ref',
          'grounding-ref',
          'executor-event-ref',
          'after-evidence-ref',
          'stale-invalidation-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
      modelRouterCandidate: {
        action: { kind: 'click', target: 'Save button' },
        nextIntent: { ownerModuleId: 'computer_use', operationKind: 'computer_use.perform_local_action' },
        beforeAfterComparison: 'button remains visible; click only changes local focus state',
        uncertainty: 'low',
      },
    },
  });

  assert.equal(result.ok, true);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.actionRefs, ['computer-use:executor:event']);
  assert.equal(JSON.stringify(result).includes('beforeAfterComparison'), false);
});

test('computer_use executeBoundedOperation may call Model Router port for local candidate guidance', async () => {
  let routerCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      modelRouterCandidate: async () => {
        routerCalled = true;
        return {
          action: { kind: 'click', target: 'Save button' },
          uncertainty: 'low',
        };
      },
      executeLocalAction: async () => ({
        beforeEvidenceRef: 'computer-use:evidence:before',
        groundingRefs: ['computer-use:grounding:button'],
        executorEventRef: 'computer-use:executor:event',
        afterEvidenceRef: 'computer-use:evidence:after',
        staleInvalidationRefs: ['computer-use:evidence:before#stale'],
      }),
    } as Parameters<typeof createComputerUseBoundedOperationModuleHandler>[0] & {
      modelRouterCandidate(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['local-candidate-guidance']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
          'before-evidence-ref',
          'grounding-ref',
          'executor-event-ref',
          'after-evidence-ref',
          'stale-invalidation-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
    },
  });

  assert.equal(routerCalled, true);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('Save button'), false);
});

test('computer_use blocks invalid Model Router port candidate before owner executor', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      modelRouterCandidate: async () => ({
        action: { kind: 'type_text', text: 'candidate only' },
      }),
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    } as Parameters<typeof createComputerUseBoundedOperationModuleHandler>[0] & {
      modelRouterCandidate(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: {
        kind: 'window',
        nativeHostRef: 'computer-use:native-host:session-1',
        targetBindingRef: 'computer-use:target:window-1',
        permissionRef: 'computer-use:permission:accessibility-granted',
        scopedExecutorRef: 'computer-use:executor-scope:window-1',
        stopCancelRef: 'computer-use:stop-cancel:path-1',
      },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['candidate-valid-before-executor']),
        riskPolicy: 'low',
        requiredEvidence: [
          'native-host-ref',
          'permission-ref',
          'scoped-executor-ref',
          'stop-cancel-ref',
        ],
      },
      action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(executorCalled, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'blocked');
  assert.match(value.blockedReason ?? '', /candidate_action_not_allowed:type_text/);
});

test('computer_use blocks each forbidden Model Router ownership boundary independently', async () => {
  const cases: Array<{ name: string; candidate: Record<string, unknown>; reason: RegExp }> = [
    {
      name: 'risk policy change',
      candidate: { action: { kind: 'click' }, riskPolicy: 'high' },
      reason: /candidate_risk_policy_change_forbidden/,
    },
    {
      name: 'completion truth',
      candidate: { action: { kind: 'click' }, completionTruth: { status: 'completed' } },
      reason: /candidate_completion_boundary_forbidden/,
    },
    {
      name: 'final answer',
      candidate: { action: { kind: 'click' }, finalAnswer: 'Done' },
      reason: /candidate_completion_boundary_forbidden/,
    },
    {
      name: 'confirmation bypass',
      candidate: { action: { kind: 'click' }, approvalToken: 'candidate-token' },
      reason: /candidate_confirmation_bypass_forbidden/,
    },
    {
      name: 'auto repair',
      candidate: { action: { kind: 'click' }, autoRepair: { retryWith: { action: { kind: 'click' } } } },
      reason: /candidate_auto_repair_forbidden/,
    },
    {
      name: 'executable binding',
      candidate: { action: { kind: 'click' }, inputLeaseRef: 'computer-use:session/input/leases/active.json' },
      reason: /candidate_executable_binding_forbidden/,
    },
  ];

  for (const entry of cases) {
    let executorCalled = false;
    const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
      computer_use: createComputerUseBoundedOperationModuleHandler({
        executeLocalAction: async () => {
          executorCalled = true;
          throw new Error(`executor must not be called for ${entry.name}`);
        },
      }),
    }));

    const result = await dispatcher.invoke({
      moduleId: 'computer_use',
      intent: EXECUTE_BOUNDED_OPERATION_INTENT,
      input: {
        operationKind: 'computer_use.perform_local_action',
        ownerModuleId: 'computer_use',
        targetScope: {
          kind: 'window',
          nativeHostRef: 'computer-use:native-host:session-1',
          targetBindingRef: 'computer-use:target:window-1',
          permissionRef: 'computer-use:permission:accessibility-granted',
          scopedExecutorRef: 'computer-use:executor-scope:window-1',
          stopCancelRef: 'computer-use:stop-cancel:path-1',
        },
        config: {
          allowedActions: ['click'],
          ...requiredBoundedLimits(['ownership-boundary-preserved']),
          riskPolicy: 'low',
          requiredEvidence: [
            'native-host-ref',
            'permission-ref',
            'scoped-executor-ref',
            'stop-cancel-ref',
          ],
        },
        action: { kind: 'click', targetRef: 'computer-use:grounding:button' },
        modelRouterCandidate: entry.candidate,
      },
    });

    assert.equal(result.ok, false, entry.name);
    assert.equal(executorCalled, false, entry.name);
    const value = result.value as BoundedOperationResultValue;
    assert.equal(value.status, 'blocked', entry.name);
    assert.match(value.blockedReason ?? '', entry.reason, entry.name);
  }
});

test('computer_use bounded operation enforces actual allowed action before executor', async () => {
  let executorCalled = false;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        executorCalled = true;
        throw new Error('executor must not be called');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: { kind: 'window', targetBindingRef: 'computer-use:target:window-1' },
      config: {
        allowedActions: ['click'],
        ...requiredBoundedLimits(['actual-action-allowed']),
        riskPolicy: 'low',
        requiredEvidence: ['before-evidence-ref'],
      },
      action: { kind: 'type_text', text: 'not allowed' },
    },
  });

  assert.equal(result.ok, false);
  assert.match((result.value as BoundedOperationResultValue).blockedReason ?? '', /action_not_allowed:type_text/);
  assert.equal(executorCalled, false);
});

test('computer_use high-risk action returns needs-confirmation until Host supplies approval', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    computer_use: createComputerUseBoundedOperationModuleHandler({
      executeLocalAction: async () => {
        throw new Error('executor must not run before confirmation');
      },
    }),
  }));

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: { kind: 'window', targetBindingRef: 'computer-use:target:window-1' },
      config: {
        allowedActions: ['submit'],
        ...requiredBoundedLimits(['confirmed-before-submit']),
        riskPolicy: 'confirmation-required',
        requiredEvidence: ['before-evidence-ref'],
      },
      action: { kind: 'submit', risk: 'high' },
    },
  });

  assert.equal(result.ok, false);
  const value = result.value as BoundedOperationResultValue;
  assert.equal(value.status, 'needs-confirmation');
  assert.equal(result.approvalRequest?.moduleId, 'computer_use');
  assert.equal(result.approvalRequest?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
});
