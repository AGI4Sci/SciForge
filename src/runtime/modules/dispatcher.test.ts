import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXECUTE_BOUNDED_OPERATION_INTENT,
  moduleResult,
  type ModuleDescription,
} from '@sciforge-ui/runtime-contract/modules';
import { createGuiProtocolController } from '../../ui/src/app/guiProtocol.js';
import { createGuiModuleHandler, guiResourceRef } from './gui-module-handler.js';
import {
  createRuntimeModuleDispatcher,
  createRuntimeModuleRegistry,
  RUNTIME_MODULE_IDS,
} from './dispatcher.js';

test('runtime module registry describes all Agent Host boundary modules', async () => {
  const registry = createRuntimeModuleRegistry({
    gui: createGuiModuleHandler(createGuiProtocolController()),
  });
  const dispatcher = createRuntimeModuleDispatcher(registry);

  const result = await dispatcher.describe();
  assert.equal(result.ok, true);
  const modules = (result.value as { modules: ModuleDescription[] }).modules;
  assert.deepEqual(modules.map((description) => description.moduleId), [...RUNTIME_MODULE_IDS]);
  assert.ok(modules.find((description) => description.moduleId === 'gui')?.intents?.some((intent) => intent.name === 'present'));
  assert.ok(modules.find((description) => description.moduleId === 'capabilities')?.intents?.some((intent) => intent.name === 'plan'));
});

test('actions module describe declares Computer Use L1/L0 boundary metadata', async () => {
  const dispatcher = createRuntimeModuleDispatcher();

  const result = await dispatcher.describe({ moduleId: 'actions' });

  assert.equal(result.ok, true);
  const description = result.value as ModuleDescription;
  assert.equal(description.moduleId, 'actions');
  assert.equal(description.functions.invoke, true);
  assert.match(description.summary, /Computer Use.*L1 resource\/session adapter/i);
  assert.match(description.summary, /observe, capture, ground, propose_scoped_action, execute_scoped_action, verify, write_trace, emit_event/i);
  assert.ok(description.resources?.some((resource) => resource.kind === 'computer-use-session' && resource.refPrefix === 'computer-use:session:'));
  assert.ok(description.resources?.some((resource) => resource.kind === 'computer-use-evidence' && resource.refPrefix === 'computer-use:evidence:'));
  assert.ok(description.resources?.some((resource) => resource.kind === 'computer-use-replay' && resource.refPrefix === 'computer-use:replay:'));
  const execute = description.intents?.find((intent) => intent.name === 'execute');
  assert.equal(execute?.sideEffect, 'workspace');
  assert.equal(execute?.requiresApproval, true);
  assert.equal(execute?.returnsOperation, true);
  assert.match(execute?.summary ?? '', /scoped lease\/provenance\/approval/i);
  assert.equal(description.facets?.refs, true);
  assert.equal(description.facets?.approval, true);
  assert.equal(description.facets?.events, true);
  assert.equal(description.limits?.maxInlineBytes, 16_000);
  assert.equal(description.limits?.expectedLatencyMs, 500);
});

test('runtime module dispatcher routes read by ref prefix and fails closed', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    gui: createGuiModuleHandler(createGuiProtocolController({ revision: 8 })),
  }));

  const read = await dispatcher.read({ ref: guiResourceRef('/gui/shell.json'), includeMeta: true });
  assert.equal(read.ok, true);
  assert.equal(read.moduleId, 'gui');
  assert.equal((read.value as { path: string; meta: { readonly: boolean } }).path, '/gui/shell.json');
  assert.equal((read.value as { meta: { readonly: boolean } }).meta.readonly, true);

  const missing = await dispatcher.query({ moduleId: 'missing', query: 'x' });
  assert.equal(missing.ok, false);
  assert.match(missing.error ?? '', /module_not_found:missing/);

  const unsupported = await dispatcher.invoke({ moduleId: 'skills', intent: 'execute', input: {} });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error ?? '', /unsupported_function|unsupported_intent/);
});

test('runtime module dispatcher returns approval request before approved side effects', async () => {
  const dispatcher = createRuntimeModuleDispatcher();

  const result = await dispatcher.invoke({
    moduleId: 'memory',
    intent: 'write',
    input: { text: 'remember this' },
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /approval_required:write/);
  assert.equal(result.approvalRequest?.moduleId, 'memory');
  assert.equal(result.approvalRequest?.intent, 'write');
});

test('actions module invoke fail-closes undeclared Computer Use intents', async () => {
  const dispatcher = createRuntimeModuleDispatcher();

  const undeclared = await dispatcher.invoke({
    moduleId: 'actions',
    intent: 'execute_scoped_action',
    input: { actionKind: 'click' },
  });
  assert.equal(undeclared.ok, false);
  assert.match(undeclared.error ?? '', /unsupported_intent:execute_scoped_action/);

  const execute = await dispatcher.invoke({
    moduleId: 'actions',
    intent: 'execute',
    input: { capability: 'computer-use', handlerIntent: 'execute_scoped_action' },
  });
  assert.equal(execute.ok, false);
  assert.match(execute.error ?? '', /approval_required:execute/);
  assert.equal(execute.approvalRequest?.moduleId, 'actions');
  assert.equal(execute.approvalRequest?.intent, 'execute');
  assert.equal(execute.approvalRequest?.sideEffect, 'workspace');
});

test('bounded Computer Use confirmation is handled by module operation result, not dispatcher approval gate', async () => {
  const dispatcher = createRuntimeModuleDispatcher();

  const result = await dispatcher.invoke({
    moduleId: 'computer_use',
    intent: EXECUTE_BOUNDED_OPERATION_INTENT,
    input: {
      operationKind: 'computer_use.perform_local_action',
      ownerModuleId: 'computer_use',
      targetScope: { kind: 'window', targetBindingRef: 'computer-use:target:window-1' },
      config: {
        allowedActions: ['submit'],
        riskPolicy: 'confirmation-required',
        requiredEvidence: ['before-evidence-ref'],
      },
      action: { kind: 'submit', risk: 'high' },
    },
  });

  assert.equal(result.moduleId, 'computer_use');
  assert.equal(result.ok, false);
  assert.equal((result.value as { status?: string }).status, 'needs-confirmation');
  assert.equal(result.approvalRequest?.intent, EXECUTE_BOUNDED_OPERATION_INTENT);
  assert.doesNotMatch(result.error ?? '', /^approval_required:/);
});

test('runtime module dispatcher records scrubbed trace summaries and timing', async () => {
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    artifacts: {
      describe: async () => ({
        schemaVersion: 'sciforge.module-contract.v1',
        moduleId: 'artifacts',
        title: 'Artifacts',
        summary: 'Fixture artifact module.',
        functions: { describe: true, query: true, read: false, invoke: false },
        resources: [{ kind: 'artifact', refPrefix: 'artifact:', queryable: true, readable: false }],
      }),
      query: async () => moduleResult({
        moduleId: 'artifacts',
        ok: true,
        value: {
          url: 'https://provider.example/v1?api_key=result-secret',
          authorization: 'Bearer result-secret-token',
        },
      }),
    },
  }));

  const result = await dispatcher.query({
    moduleId: 'artifacts',
    query: 'inspect https://provider.example/input?token=input-secret',
    filters: { Authorization: 'Bearer input-secret-token' },
  });

  assert.equal(result.ok, true);
  const step = dispatcher.trace().at(-1);
  assert.equal(step?.status, 'completed');
  assert.equal(step?.moduleId, 'artifacts');
  assert.equal(typeof step?.timing?.durationMs, 'number');
  assert.doesNotMatch(`${step?.inputSummary}\n${step?.resultSummary}`, /provider\.example|input-secret|result-secret/);
  assert.match(`${step?.inputSummary}\n${step?.resultSummary}`, /\[redacted/);
});
