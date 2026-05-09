import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCapabilityRegistry,
  defaultCapabilityRegistry,
  defaultCapabilitySummaries,
  type CapabilityContract,
} from './capabilityRegistry';

test('default summaries 只提供 capability metadata，不再在 TS 里生成策略 brief', () => {
  const summaries = defaultCapabilitySummaries();
  const categories = new Set(summaries.map((summary) => summary.category));
  const ids = summaries.map((summary) => summary.id);

  assert.ok(categories.has('observe'));
  assert.ok(categories.has('reasoning'));
  assert.ok(categories.has('action'));
  assert.ok(categories.has('verify'));
  assert.ok(categories.has('interactive-view'));
  assert.equal(new Set(ids).size, ids.length, 'capability id 应唯一');
  assert.ok(summaries.every((summary) => summary.oneLine && Array.isArray(summary.domains) && Array.isArray(summary.triggers)));
});

test('registry 只列出 brief，并在选中 capability 后懒加载 contract', async () => {
  let loaded = 0;
  const contract: CapabilityContract = {
    id: 'verifier.custom',
    schemaVersion: 'sciforge.capability-contract.v1',
    inputContract: { largeContract: 'only loaded after selected' },
  };
  const registry = createCapabilityRegistry([
    {
      summary: {
        id: 'verifier.custom',
        kind: 'verifier',
        category: 'verify',
        oneLine: '自定义验证器摘要。',
        domains: ['knowledge'],
        triggers: ['custom'],
        antiTriggers: [],
        modalities: ['json'],
        producesArtifactTypes: ['verification-result'],
        riskClass: 'medium',
        costClass: 'low',
        latencyClass: 'low',
        reliability: 'schema-checked',
        requiresNetwork: false,
        requiredConfig: [],
        verifierTypes: ['schema'],
        detailRef: 'local://contract',
      },
      loadContract: () => {
        loaded += 1;
        return contract;
      },
    },
  ]);

  const briefs = registry.listBriefs('verify');
  assert.equal(loaded, 0);
  assert.deepEqual(briefs.map((item) => item.id), ['verifier.custom']);
  assert.equal(briefs[0]?.oneLine, '自定义验证器摘要。');

  assert.deepEqual(await registry.loadContract('verifier.custom'), contract);
  assert.equal(loaded, 1);
});

test('default registry 按类别暴露 brief，并只在选中后加载 contract', async () => {
  const registry = defaultCapabilityRegistry();
  const verifierBriefs = registry.listBriefs('verify');
  const firstVerifier = verifierBriefs[0];

  assert.ok(firstVerifier);
  assert.ok(verifierBriefs.every((item) => item.category === 'verify'));
  assert.ok(JSON.stringify(verifierBriefs).length < 9_000, 'registry brief 应保持紧凑，避免把 contract 塞进上下文');

  const contract = await registry.loadContract(firstVerifier.id);
  assert.equal(contract?.id, firstVerifier.id);
  assert.equal(contract?.schemaVersion, 'sciforge.capability-contract.v1');
  assert.deepEqual(contract?.invocation, { loadPolicy: 'on-selected-only' });
});
