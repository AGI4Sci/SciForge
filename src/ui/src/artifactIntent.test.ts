import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expectedArtifactsForCurrentTurn } from './artifactIntent';

describe('artifact intent', () => {
  it('treats literature evidence comparison as paper and evidence artifacts', () => {
    const artifacts = expectedArtifactsForCurrentTurn({
      scenarioId: 'biomedical-knowledge-graph',
      prompt: '我想比较KRAS G12D突变相关文献证据，并在需要时联动蛋白结构和知识图谱。',
      selectedComponentIds: ['graph-viewer', 'structure-viewer', 'evidence-matrix'],
    });

    assert.deepEqual(new Set(artifacts), new Set(['paper-list', 'evidence-matrix', 'structure-summary', 'knowledge-graph']));
  });

  it('does not expand component compatibility aliases into required artifacts', () => {
    const artifacts = expectedArtifactsForCurrentTurn({
      scenarioId: 'biomedical-knowledge-graph',
      prompt: '联动蛋白结构和知识图谱。',
      selectedComponentIds: ['graph-viewer', 'structure-viewer'],
    });

    assert.deepEqual(artifacts, ['structure-summary', 'knowledge-graph']);
  });
});
