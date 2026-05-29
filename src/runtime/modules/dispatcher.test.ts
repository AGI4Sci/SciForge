import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleResult, type ModuleDescription } from '@sciforge-ui/runtime-contract/modules';
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
