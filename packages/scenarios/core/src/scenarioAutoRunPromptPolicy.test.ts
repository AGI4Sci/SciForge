import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactFocusTerm,
  scenarioHandoffAutoRunPrompt,
} from './scenarioAutoRunPromptPolicy';

test('scenario auto-run prompt policy owns scenario-specific handoff templates', () => {
  const prompt = scenarioHandoffAutoRunPrompt({
    targetScenario: 'structure-exploration',
    artifact: {
      id: 'kg-braf',
      type: 'knowledge-graph',
      metadata: { entity: 'BRAF V600E' },
    },
    sourceScenarioName: '知识图谱',
    targetScenarioName: '结构探索',
  });

  assert.equal(prompt, '分析 BRAF V600E 的结构，返回 structure-summary artifact、dataRef、质量指标和 ExecutionUnit。');
});

test('scenario auto-run prompt policy derives focus from package-owned artifact shapes', () => {
  assert.equal(artifactFocusTerm({
    id: 'paper-list',
    type: 'paper-list',
    data: { rows: [{ key: 'uniprot_accession', value: 'P15056' }] },
  }), 'P15056');

  assert.equal(artifactFocusTerm({
    id: 'kg',
    type: 'knowledge-graph',
    data: { nodes: [{ id: 'TP53', type: 'gene' }, { id: 'disease-a', type: 'disease' }] },
  }), 'TP53');
});

test('scenario auto-run prompt policy falls back to generic contract handoff copy', () => {
  const prompt = scenarioHandoffAutoRunPrompt({
    targetScenario: 'omics-differential-exploration',
    artifact: { id: 'opaque', type: 'runtime-result' },
    sourceScenarioName: '源场景',
    targetScenarioName: '组学场景',
  });

  assert.match(prompt, /消费 handoff artifact opaque/);
  assert.match(prompt, /组学场景/);
});
