import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSenseInvocationPlan,
  compactSenseTraceRefs,
  runSenseInvocationPlan,
  type SenseProviderRuntime,
} from './senseOrchestration.js';

test('sense orchestration plans multiple instructions over the same image as distinct traceable calls', async () => {
  const image = { kind: 'image', ref: 'artifact:image-1', mimeType: 'image/png' };
  const provider: SenseProviderRuntime = {
    contract: {
      id: 'local.vision-sense',
      acceptedModalities: ['image', 'screenshot'],
      outputKind: 'text',
      expectedMultipleCalls: true,
    },
    async invoke(input) {
      return {
        text: `observed ${input.instruction}`,
        artifactRefs: input.modalities.map((modality) => modality.ref),
        traceRef: `${input.callRef}:trace`,
        compactSummary: `summary for ${input.instruction}`,
      };
    },
  };

  const plan = buildSenseInvocationPlan({
    goal: '理解图片并检查局部文字',
    runRef: 'run:vision-001',
    providers: [provider.contract],
    intents: [
      { instruction: '先描述整体布局', modalities: [image] },
      { instruction: '再读取右下角小字', modalities: [image] },
    ],
  });

  assert.deepEqual(plan.invocations.map((call) => call.callRef), [
    'run:vision-001:sense:001',
    'run:vision-001:sense:002',
  ]);
  assert.equal(plan.invocations[0].modalities[0].ref, plan.invocations[1].modalities[0].ref);
  assert.notEqual(plan.invocations[0].instruction, plan.invocations[1].instruction);

  const records = await runSenseInvocationPlan(plan, [provider]);
  assert.deepEqual(records.map((record) => record.status), ['ok', 'ok']);
  assert.deepEqual(compactSenseTraceRefs(records).map((record) => record.traceRef), [
    'run:vision-001:sense:001:trace',
    'run:vision-001:sense:002:trace',
  ]);
});

test('sense orchestration records unavailable provider failures without losing call refs', async () => {
  const plan = buildSenseInvocationPlan({
    goal: '观察截图',
    runRef: 'run:missing-provider',
    providers: [{ id: 'local.vision-sense', acceptedModalities: ['screenshot'], outputKind: 'text' }],
    intents: [{ instruction: '读取窗口标题', modalities: [{ kind: 'screenshot', ref: 'artifact:screenshot-1' }] }],
  });

  const records = await runSenseInvocationPlan(plan, []);
  assert.equal(records[0].callRef, 'run:missing-provider:sense:001');
  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].diagnostics?.code, 'sense-provider-unavailable');
});
