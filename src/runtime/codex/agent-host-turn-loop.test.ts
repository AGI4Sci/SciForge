import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  boundedOperationResult,
  type ModuleInvokeRequest,
} from '../../../packages/contracts/runtime/modules.js';
import { evaluateCodexAgentHostTurnLoop, resolveCodexAgentHostRuntimeTruth } from './agent-host-turn-loop.js';
import { writeBundleLocalCuNext07Acceptance } from '../../../tests/smoke/helpers/cu-next-runner-fixtures.js';

test('Agent Host Turn Loop answers ordinary frontier AI search from browser.search_read bounded operation refs', async () => {
  const calls: ModuleInvokeRequest[] = [];
  const commandText = '搜索并总结本周前沿 AI 大模型进展';

  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-bounded-search',
    attemptId: 'codex-command-browser-bounded-search-attempt-1',
    browserBoundedOperationInvoker: async (request) => {
      calls.push(request);
      return boundedOperationResult({
        moduleId: 'browser',
        operationKind: 'browser.search_read',
        status: 'completed',
        sourceRefs: ['browser-host-session:search/source-pages/source-1.source.json'],
        evidenceRefs: [
          'browser-host-session:search/source-pages/source-1.source.json',
          'browser-host-session:search/source-pages/source-1.txt',
        ],
        value: {
          sourcePages: [{
            title: 'Frontier model update',
            finalUrl: 'https://example.test/frontier-model-update',
            textRef: 'browser-host-session:search/source-pages/source-1.txt',
            textPreview: '本周多个前沿模型进展集中在长上下文推理、工具使用代理和多模态效率提升。',
          }],
          searchResultSnippet: '诱饵：不要使用搜索结果页摘要。',
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.moduleId, 'browser');
  assert.equal(calls[0]?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
  assert.equal(calls[0]?.input?.operationKind, 'browser.search_read');
  assert.equal(calls[0]?.input?.ownerModuleId, 'browser');
  assert.equal((calls[0]?.input?.targetScope as Record<string, unknown>).kind, 'web-search');
  assert.match(String((calls[0]?.input?.targetScope as Record<string, unknown>).query), /AI|大模型|前沿/);
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).requiredEvidence, ['source-page-ref', 'page-text-ref']);

  assert.equal(result?.event.provider, 'sciforge-agent-host');
  assert.equal(result?.event.model, 'codex-agent-host-turn-loop');
  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'module.invoke');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.match(String(result?.result.message), /长上下文推理|工具使用代理|多模态效率/);
  assert.match(String(result?.result.message), /https:\/\/example\.test\/frontier-model-update/);
  assert.doesNotMatch(String(result?.result.message), /诱饵/);
  assert.deepEqual(result?.result.evidenceRefs, [
    'browser-host-session:search/source-pages/source-1.source.json',
    'browser-host-session:search/source-pages/source-1.txt',
  ]);
  assert.deepEqual((result?.result.claims as Array<Record<string, unknown>>)[0]?.supportingRefs, result?.result.evidenceRefs);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /browser_search|browser-host-search-runtime|answerEvidenceState|browser-search-results|browser-host-projection|fixture:|diagnostic|gui\.present:|replay:|history:/);
});

test('Agent Host Turn Loop opens and reads explicit URL requests through browser.open_read bounded operation', async () => {
  const calls: ModuleInvokeRequest[] = [];
  const commandText = '打开并读取 https://example.test/source-page ，总结页面内容';

  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-bounded-open-read',
    attemptId: 'codex-command-browser-bounded-open-read-attempt-1',
    browserBoundedOperationInvoker: async (request) => {
      calls.push(request);
      return boundedOperationResult({
        moduleId: 'browser',
        operationKind: 'browser.open_read',
        status: 'completed',
        sourceRefs: ['browser-host-session:open/source-pages/source-1.source.json'],
        evidenceRefs: [
          'browser-host-session:open/source-pages/source-1.source.json',
          'browser-host-session:open/source-pages/source-1.txt',
        ],
        value: {
          sourcePages: [{
            title: 'Explicit source page',
            finalUrl: 'https://example.test/source-page',
            textRef: 'browser-host-session:open/source-pages/source-1.txt',
            textPreview: '这个页面介绍了 bounded operation 的 request、result 和 refs-first evidence。',
          }],
          searchResultSnippet: '诱饵：open_read 不应使用搜索结果摘要。',
        },
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.moduleId, 'browser');
  assert.equal(calls[0]?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
  assert.equal(calls[0]?.input?.operationKind, 'browser.open_read');
  assert.equal(calls[0]?.input?.ownerModuleId, 'browser');
  assert.equal((calls[0]?.input?.targetScope as Record<string, unknown>).kind, 'url');
  assert.equal((calls[0]?.input?.targetScope as Record<string, unknown>).url, 'https://example.test/source-page');
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).allowedActions, ['open', 'read']);
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).requiredEvidence, ['source-page-ref', 'page-text-ref']);
  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'module.invoke');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.match(String(result?.result.message), /bounded operation 的 request、result 和 refs-first evidence/);
  assert.match(String(result?.result.message), /https:\/\/example\.test\/source-page/);
  assert.doesNotMatch(String(result?.result.message), /诱饵/);
  assert.deepEqual(result?.result.evidenceRefs, [
    'browser-host-session:open/source-pages/source-1.source.json',
    'browser-host-session:open/source-pages/source-1.txt',
  ]);
});

test('Agent Host Turn Loop blocks Browser completion without both source page and page text refs', async () => {
  const commandText = 'What is the current Python release? Please cite source URLs.';

  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-insufficient-evidence',
    attemptId: 'codex-command-browser-insufficient-evidence-attempt-1',
    browserBoundedOperationInvoker: async () => boundedOperationResult({
      moduleId: 'browser',
      operationKind: 'browser.search_read',
      status: 'completed',
      sourceRefs: ['browser-host-session:search/source-pages/source-1.source.json'],
      evidenceRefs: ['browser-host-session:search/source-pages/source-1.source.json'],
      value: {
        sourcePages: [{
          title: 'Python release search result',
          finalUrl: 'https://example.test/python-release',
          textPreview: 'This should not be enough without a page text ref.',
        }],
      },
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /missing current-run source\/page text evidence|source-page-ref|page-text-ref/i);
  assert.doesNotMatch(String(result?.result.message), /This should not be enough/);
  assert.deepEqual(result?.result.evidenceRefs, [
    'browser-host-session:search/source-pages/source-1.source.json',
  ]);
});

test('Agent Host Turn Loop explains no-network Browser skip without invoking Browser', async () => {
  let browserCalled = false;
  const commandText = 'Do not use the internet. Summarize the current Python release from local notes only.';

  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-no-network',
    attemptId: 'codex-command-browser-no-network-attempt-1',
    browserBoundedOperationInvoker: async () => {
      browserCalled = true;
      throw new Error('Browser must not be invoked for local-only/no-network requests');
    },
  });

  assert.equal(browserCalled, false);
  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'agent-host-browser-skip');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /not call Browser|不调用 Browser|local-only|no-network/i);
  assert.match(String(result?.result.message), /local notes|本地/i);
  assert.doesNotMatch(JSON.stringify(result), /module\.invoke|browser\.search_read|browser\.open_read|browser-host-search-runtime/);
});

test('Agent Host Turn Loop creates one-page PPT artifact with validator refs from ordinary chat', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-ppt-artifact-'));
  const commandText = '做一页 PPT，主题是 SciForge bounded modules';
  let computerUseCalled = false;
  try {
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath,
      commandId: 'codex-command-one-page-ppt',
      attemptId: 'codex-command-one-page-ppt-attempt-1',
      computerUseBoundedOperationInvoker: async () => {
        computerUseCalled = true;
        throw new Error('PPT artifact path must not call Computer Use bounded operation');
      },
    });

    assert.equal(computerUseCalled, false);
    assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'agent-host-artifact-generator');
    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    const evidenceRefs = result?.result.evidenceRefs as string[];
    assert.equal(evidenceRefs.length, 2);
    assert.match(evidenceRefs[0] ?? '', /^\.sciforge\/vision-runs\/codex-command-one-page-ppt-codex-command-one-page-ppt-attempt-1\/one-page-presentation\.pptx$/);
    assert.equal(evidenceRefs[1], `${evidenceRefs[0]}.validation.json`);
    const pptxBytes = await readFile(join(workspacePath, evidenceRefs[0] ?? 'missing'));
    assert.deepEqual([...pptxBytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const validation = JSON.parse(await readFile(join(workspacePath, evidenceRefs[1] ?? 'missing'), 'utf8')) as Record<string, unknown>;
    assert.equal(validation.status, 'passed');
    assert.equal(validation.productAcceptanceEvidence, true);
    assert.equal(validation.finalArtifactRef, evidenceRefs[0]);
    assert.equal(validation.artifactValidationRef, evidenceRefs[1]);
    assert.equal(validation.slideCount, 1);
    assert.deepEqual((result?.result.completionTruth as Record<string, unknown>).evidenceRefs, evidenceRefs);
    assert.match(String(result?.result.message), /one-page PPT artifact/);
    assert.match(JSON.stringify(result), /validator/);
    assert.doesNotMatch(JSON.stringify(result), /computer_use\.perform_local_action|browser-host-session\.computer-use-action|fixture:|replay:|history:/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop calls injected Computer Use Act materializer after ready Guard', async () => {
  let materializerCalled = false;
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer',
    attemptId: 'codex-command-act-materializer-attempt-1',
    computerUseActMaterializer: async ({ preflight }) => {
      materializerCalled = true;
      assert.equal(preflight.status, 'ready');
      return {
        status: 'completed',
        message: 'Materializer claim should not be copied as the final Host answer.',
        evidenceRefs: [
          'browser-host-session:visible/evidence/before-scroll',
          'action-ledger:browser-host-session/visible/actions/scroll-1/grounding',
          'browser-host-session:visible/action-state/scroll-1',
          'browser-host-session:visible/evidence/after-scroll',
          'browser-host-session:visible/actions/scroll-1/freshness-invalidation.json',
        ],
        executionUnits: [{
          id: 'EU-browser-host-computer-use-scroll',
          tool: 'browser-host-session.computer-use-action',
          status: 'done',
          outputRef: 'browser-host-session:visible/action-state/scroll-1',
        }],
        artifacts: [{
          id: 'browser-host-computer-use-scroll',
          type: 'computer-use-action-result',
          metadata: { source: 'browser-host-session.computer-use-adapter' },
          data: { providerId: 'sciforge.browser-host-session.computer-use-adapter' },
        }],
      };
    },
  });

  assert.equal(materializerCalled, true);
  assert.equal((result?.event.raw as Record<string, unknown> | undefined)?.stage, 'Act / Answer');
  assert.match(String(result?.result.message), /current target-bound action evidence refs/i);
  assert.doesNotMatch(String(result?.result.message), /Materializer claim should not be copied/);
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.doesNotMatch(JSON.stringify(result), /ready-for-act/);
});

test('Agent Host Turn Loop blocks completed Act materializer results without full action evidence refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer-incomplete-evidence',
    attemptId: 'codex-command-act-materializer-incomplete-evidence-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Computer Use action executed through BrowserHostSession.',
      evidenceRefs: ['browser-host-session:visible/action-state/scroll-1'],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown> | undefined)?.stage, 'Act / Answer');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /missing current target-bound action evidence/i);
  assert.match(String(result?.result.message), /before-evidence-ref|grounding-ref|after-evidence-ref|stale-invalidation-ref/i);
  assert.doesNotMatch(String(result?.result.message), /Computer Use action executed through BrowserHostSession/);
});

test('Agent Host Turn Loop can route ready Computer Use Guard into bounded perform_local_action operation', async () => {
  const calls: ModuleInvokeRequest[] = [];
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-bounded-operation',
    attemptId: 'codex-command-cu-bounded-operation-attempt-1',
    computerUseBoundedOperationInvoker: async (request) => {
      calls.push(request);
      return boundedOperationResult({
        moduleId: 'computer_use',
        operationKind: 'computer_use.perform_local_action',
        status: 'completed',
        evidenceRefs: [
          'computer-use:evidence:before-scroll',
          'computer-use:grounding:scroll-region',
          'computer-use:executor:event-scroll',
          'computer-use:evidence:after-scroll',
          'computer-use:evidence:before-scroll#stale',
        ],
        actionRefs: ['computer-use:executor:event-scroll'],
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.moduleId, 'computer_use');
  assert.equal(calls[0]?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
  assert.equal(calls[0]?.input?.operationKind, 'computer_use.perform_local_action');
  assert.equal(calls[0]?.input?.ownerModuleId, 'computer_use');
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).allowedActions, ['scroll']);
  assert.deepEqual((calls[0]?.input?.config as Record<string, unknown>).requiredEvidence, [
    'before-evidence-ref',
    'grounding-ref',
    'executor-event-ref',
    'after-evidence-ref',
    'stale-invalidation-ref',
  ]);
  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'module.invoke');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.match(String(result?.result.message), /local GUI action|局部|bounded operation/i);
  assert.deepEqual(result?.result.evidenceRefs, [
    'computer-use:evidence:before-scroll',
    'computer-use:grounding:scroll-region',
    'computer-use:executor:event-scroll',
    'computer-use:evidence:after-scroll',
    'computer-use:evidence:before-scroll#stale',
  ]);
  assert.notEqual((result?.result.completionTruth as Record<string, unknown> | undefined)?.scope, 'user-task');
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied".*workflow|gui\.present:|fixture:|replay:|history:/);
});

test('Agent Host Turn Loop blocks ordinary chat Computer Use when any user-level guard evidence is missing and explains recovery', async () => {
  const commandText = 'Click the visible export button in the current window.';
  const cases = [
    {
      name: 'native host',
      input: {
        ...readyAgentHostInput(commandText),
        readiness: {
          ...readyAgentHostInput(commandText).readiness,
          nativeBridge: 'blocked',
          nativeSurface: 'blocked',
        },
      },
      reason: 'native-bridge-unavailable',
      recovery: /Start or reconnect the Desktop native bridge|Desktop native Browser surface/i,
    },
    {
      name: 'target binding',
      input: {
        ...readyAgentHostInput(commandText),
        target: {
          bound: false,
          summary: 'No selected target',
          refs: [],
        },
      },
      reason: 'target-unbound',
      recovery: /Select or bind a Browser session, app window, screen region, file, terminal, or workspace object/i,
    },
    {
      name: 'fresh evidence',
      input: {
        ...readyAgentHostInput(commandText),
        observation: {
          fresh: false,
          refs: [],
        },
      },
      reason: 'needs-observation',
      recovery: /Capture a fresh observation ref/i,
    },
    {
      name: 'permission refs',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: [],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: true,
        },
      },
      reason: 'permission-missing',
      recovery: /Collect a scoped permission ref/i,
    },
    {
      name: 'scoped executor',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: [],
          stopCancelPath: true,
        },
      },
      reason: 'scoped-executor-missing',
      recovery: /Provide a scoped executor ref/i,
    },
    {
      name: 'stop cancel path',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: false,
        },
      },
      reason: 'cancel-path-missing',
      recovery: /Provide a stop, cancel, or take-over path/i,
    },
  ];

  for (const entry of cases) {
    let executorCalled = false;
    const result = await evaluateCodexAgentHostTurnLoop({
      input: entry.input,
      commandText,
      workspacePath: '/tmp/workspace',
      commandId: `codex-command-cu-blocker-${entry.name.replace(/\s+/g, '-')}`,
      attemptId: `codex-command-cu-blocker-${entry.name.replace(/\s+/g, '-')}-attempt-1`,
      computerUseBoundedOperationInvoker: async () => {
        executorCalled = true;
        throw new Error(`Computer Use executor must not run when ${entry.name} is missing`);
      },
    });

    assert.equal(executorCalled, false, entry.name);
    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked', entry.name);
    assert.match(String(result?.result.message), new RegExp(entry.reason), entry.name);
    assert.match(String(result?.result.message), entry.recovery, entry.name);
    assert.match(JSON.stringify(result), new RegExp(entry.reason), entry.name);
    assert.doesNotMatch(JSON.stringify(result), /ready-for-act|taskOutcome":"satisfied"/, entry.name);
  }
});

test('Agent Host Turn Loop blocks Computer Use completion without full local action evidence refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-incomplete-action-evidence',
    attemptId: 'codex-command-cu-incomplete-action-evidence-attempt-1',
    computerUseBoundedOperationInvoker: async () => boundedOperationResult({
      moduleId: 'computer_use',
      operationKind: 'computer_use.perform_local_action',
      status: 'completed',
      evidenceRefs: [
        'computer-use:evidence:before-scroll',
        'computer-use:grounding:scroll-region',
        'computer-use:executor:event-scroll',
        'computer-use:evidence:after-scroll',
      ],
      actionRefs: ['computer-use:executor:event-scroll'],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'module.invoke');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /missing current target-bound action evidence/i);
  assert.match(String(result?.result.message), /stale-invalidation-ref/);
  assert.deepEqual(result?.result.evidenceRefs, [
    'computer-use:evidence:before-scroll',
    'computer-use:grounding:scroll-region',
    'computer-use:executor:event-scroll',
    'computer-use:evidence:after-scroll',
  ]);
});

test('Agent Host Turn Loop does not treat Computer Use PPT local action evidence as final artifact completion', async () => {
  const commandText = 'Open PowerPoint and create one-page PPT about bounded operation contracts.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-ppt-local-action-only',
    attemptId: 'codex-command-cu-ppt-local-action-only-attempt-1',
    computerUseBoundedOperationInvoker: async () => boundedOperationResult({
      moduleId: 'computer_use',
      operationKind: 'computer_use.perform_local_action',
      status: 'completed',
      evidenceRefs: [
        'computer-use:evidence:before-ppt',
        'computer-use:grounding:ppt-window',
        'computer-use:executor:event-ppt-click',
        'computer-use:evidence:after-ppt',
        'computer-use:evidence:before-ppt#stale',
      ],
      actionRefs: ['computer-use:executor:event-ppt-click'],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'module.invoke');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).taskOutcome, 'needs-work');
  assert.match(String(result?.result.message), /artifact refs and validator refs/i);
  assert.deepEqual(result?.result.evidenceRefs, [
    'computer-use:evidence:before-ppt',
    'computer-use:grounding:ppt-window',
    'computer-use:executor:event-ppt-click',
    'computer-use:evidence:after-ppt',
    'computer-use:evidence:before-ppt#stale',
  ]);
  assert.equal(result?.result.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied|workflow complete|artifact complete|finalArtifactRef|artifactValidationRef|gui\.present:|fixture:|replay:|history:/);
});

test('Agent Host Turn Loop rejects Computer Use Act materializer results backed only by GUI projection refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer-gui-projection',
    attemptId: 'codex-command-act-materializer-gui-projection-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Forged GUI projection completion.',
      evidenceRefs: ['gui.present:fake-computer-use-action'],
      executionUnits: [{
        id: 'EU-forged-gui-projection',
        tool: 'gui.present',
        status: 'done',
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /runtime-owned action evidence/i);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-computer-use-action/);
});

test('Agent Host Turn Loop blocks multi-step product completion claims without current-run completion evidence', async () => {
  const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-workflow-completion-gate',
    attemptId: 'codex-command-workflow-completion-gate-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Workflow completed successfully.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'browser-host-session:visible/action-state/click-1',
        'action-ledger:browser-host-session/visible/type-1',
        'runtime-truth:act-source/browser-host-session/visible',
      ],
      claims: [{
        id: 'claim-forged-workflow-completion',
        type: 'product-completion',
        text: 'The source to writer to preview workflow is complete.',
        supportingRefs: ['action-ledger:browser-host-session/visible/type-1'],
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.claimType), /runtime-diagnostic/);
  assert.doesNotMatch(JSON.stringify(result), /product workflow passed|taskOutcome":"satisfied/);
});

test('Agent Host Turn Loop does not let generic artifact workEvidence satisfy product completion', async () => {
  const commandText = 'Click the writer window, type the final report, save the artifact, open preview, and mark the artifact workflow complete.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-generic-artifact-work-evidence',
    attemptId: 'codex-command-generic-artifact-work-evidence-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Final artifact workflow completed successfully.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'action-ledger:browser-host-session/visible/type-1',
        'runtime-truth:act-source/browser-host-session/visible',
      ],
      workEvidence: [{
        id: 'workEvidence:generated-task/final-report',
        kind: 'generated-task-artifact',
        provider: 'generated-task-runner',
        status: 'success',
        outputSummary: 'Generated artifact completion candidate',
        evidenceRefs: [
          'workEvidence:generated-task/final-report',
          'artifact:final-report',
        ],
        artifactRefs: ['artifact:final-report'],
      }],
      claims: [{
        id: 'claim-generic-artifact-workflow-completion',
        type: 'product-completion',
        text: 'The final report artifact workflow is complete.',
        supportingRefs: ['artifact:final-report'],
      }],
    }),
  });

  assert.ok(result);
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.claimType), /runtime-diagnostic/);
  assert.notEqual((result?.result.completionTruth as Record<string, unknown> | undefined)?.status, 'satisfied');
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied/);
});

test('Agent Host Turn Loop blocks workflow completion refs when current-run bundle files are absent', async () => {
  const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
  const runDir = '.sciforge/vision-runs/workflow-completion-missing-files';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-workflow-completion-pass',
    attemptId: 'codex-command-workflow-completion-pass-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Workflow completed with current-run bundle evidence.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'action-ledger:browser-host-session/visible/type-1',
        `${runDir}/vision-trace.json`,
        `${runDir}/tui-host-run-task-chain.json`,
        `${runDir}/current-run.json`,
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      claims: [{
        id: 'claim-workflow-completion-pass',
        type: 'product-completion',
        text: 'The workflow is complete.',
        supportingRefs: [`${runDir}/cu-user-acceptance-manifest.json`],
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.reasoningTrace), /validated current-run workflow completion evidence/i);
});

test('Agent Host Turn Loop allows workflow completion claims with validated current-run bundle evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-completion-bundle-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-workflow-completion-validated-pass',
      attemptId: 'codex-command-workflow-completion-validated-pass-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Workflow completed with validated current-run bundle evidence.',
        claimType: 'product-workflow-completion',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/tui-host-run-task-chain.json`,
          `${runDir}/cu-user-acceptance-manifest.json`,
          `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
        ],
        claims: [{
          id: 'claim-workflow-completion-validated-pass',
          type: 'product-completion',
          text: 'The workflow is complete.',
          supportingRefs: [`${runDir}/cu-user-acceptance-manifest.json`],
        }],
      }),
    });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.equal(result?.result.claimType, 'product-workflow-completion');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop blocks explicit completionTruth when refs are GUI projection only', async () => {
  const commandText = 'Type notes into the visible editor.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-explicit-completion-truth-gui',
    attemptId: 'codex-command-explicit-completion-truth-gui-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Runtime action executed.',
      claimType: 'runtime-action',
      evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
      completionTruth: {
        schemaVersion: 'sciforge.computer-use.completion-truth.v1',
        scope: 'workflow',
        status: 'satisfied',
        validator: 'current-run-live-acceptance-bundle',
        evidenceRefs: ['gui.present:fake-completion'],
      },
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence|completion truth/i);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-completion/);
});

test('Agent Host Turn Loop exposes validated explicit completionTruth for user-level completion', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-explicit-completion-truth-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Type notes into the visible editor.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-explicit-completion-truth-valid',
      attemptId: 'codex-command-explicit-completion-truth-valid-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Runtime action executed.',
        claimType: 'runtime-action',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/tui-host-run-task-chain.json`,
        ],
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'workflow',
          status: 'satisfied',
          validator: 'current-run-live-acceptance-bundle',
          evidenceRefs: [
            `${runDir}/cu-user-acceptance-manifest.json`,
            `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
          ],
        },
      }),
    });

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    assert.doesNotMatch(JSON.stringify(result), /gui\.present/);
    assert.deepEqual(result?.result.completionTruth, {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'workflow',
      status: 'satisfied',
      validator: 'current-run-live-acceptance-bundle',
      evidenceRefs: [
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      currentRun: {
        runDirRef: runDir,
        acceptanceManifestRef: `${runDir}/cu-user-acceptance-manifest.json`,
        completionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop maps package bridge workEvidence to validated workflow completionTruth', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-package-bridge-completion-truth-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Type notes into the visible editor.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-package-bridge-completion-truth-valid',
      attemptId: 'codex-command-package-bridge-completion-truth-valid-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Runtime action executed.',
        claimType: 'runtime-action',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/tui-host-run-task-chain.json`,
        ],
        workEvidence: [{
          kind: 'validate',
          provider: 'computer-use-package-bridge',
          status: 'verified',
          outputSummary: 'Computer Use completion-grade evidence',
          evidenceRefs: [
            `${runDir}/cu-user-acceptance-manifest.json`,
            `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
            'gui.present:fake-completion',
          ],
        }],
      }),
    });

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    assert.deepEqual(result?.result.completionTruth, {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'workflow',
      status: 'satisfied',
      validator: 'current-run-live-acceptance-bundle',
      evidenceRefs: [
        `${runDir}/vision-trace.json`,
        `${runDir}/tui-host-run-task-chain.json`,
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      currentRun: {
        runDirRef: runDir,
        acceptanceManifestRef: `${runDir}/cu-user-acceptance-manifest.json`,
        completionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-completion/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop sanitizes action-scoped completionTruth metadata', async () => {
  const commandText = 'Type notes into the visible editor.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-action-completion-truth-sanitize',
    attemptId: 'codex-command-action-completion-truth-sanitize-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Runtime action executed.',
      claimType: 'runtime-action',
      evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
      completionTruth: {
        schemaVersion: 'sciforge.computer-use.completion-truth.v1',
        scope: 'action',
        status: 'satisfied',
        validator: 'unsafe-token-secret-12345678',
        reason: 'raw token secret should not leave materializer output',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          'https://example.test/leak',
          'gui.present:fake-action-truth',
        ],
      },
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.deepEqual(result?.result.completionTruth, {
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope: 'action',
    status: 'satisfied',
    evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token|https:\/\/example\.test|gui\.present/);
});

test('Agent Host runtime truth sanitizer preserves bounded human takeover controlPath refs', async () => {
  const truth = await resolveCodexAgentHostRuntimeTruth({
    input: readyAgentHostInput('Type notes into the visible editor.'),
    commandText: 'Type notes into the visible editor.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-runtime-truth-control-path',
    attemptId: 'codex-command-runtime-truth-control-path-attempt-1',
    runtimeTruthResolver: async () => ({
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      permissions: {
        refs: ['permission:turn/runtime-control', 'gui.present:fake-permission'],
        stopCancelPath: true,
        controlPath: {
          ready: true,
          takeoverRefs: ['lease:human-takeover/lease-1', 'gui.present:fake-takeover'],
          pauseRefs: ['lease:human-takeover/lease-1/pause', 'ui:fake-pause'],
          resumeRefs: ['lease:human-takeover/lease-1/resume', 'https://example.invalid/resume'],
          stopRefs: ['lease:human-takeover/lease-1/stop', 'fixture:fake-stop'],
          cancelRefs: ['cancel:runtime-codex/codex-command-runtime-truth-control-path/attempt-1', 'token=secret'],
        },
      },
      refs: [
        'runtime-truth:act-source/runtime-control',
        'lease:human-takeover/lease-1/resume',
        'https://example.invalid/leak',
      ],
    }),
  });

  assert.deepEqual(truth?.permissions?.controlPath, {
    ready: true,
    takeoverRefs: ['lease:human-takeover/lease-1'],
    pauseRefs: ['lease:human-takeover/lease-1/pause'],
    resumeRefs: ['lease:human-takeover/lease-1/resume'],
    stopRefs: ['lease:human-takeover/lease-1/stop'],
    cancelRefs: ['cancel:runtime-codex/codex-command-runtime-truth-control-path/attempt-1'],
  });
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|https?:\/\/|token/);
});

function readyAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText,
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Current browser page',
      refs: ['browser-host-session:visible'],
    },
    observation: {
      fresh: true,
      refs: ['browser-host-session:visible/frame.png'],
    },
    permissions: {
      refs: ['permission:turn/low-risk-navigation'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
      stopCancelPath: true,
    },
  };
}
