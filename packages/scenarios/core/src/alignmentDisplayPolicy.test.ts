import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alignmentContractTimelineDisplay,
  alignmentDefaultContractData,
  alignmentFeasibilityRows,
  alignmentPageDisplayPolicy,
  alignmentRuntimeTimelineDisplay,
  alignmentTimelineClassNames,
} from './alignmentDisplayPolicy';

describe('alignment display policy', () => {
  it('owns alignment contract defaults and source labels', () => {
    assert.match(alignmentDefaultContractData.feasibilityMatrix, /source=AI-draft/);
    assert.match(alignmentDefaultContractData.feasibilitySourceNotes, /artifact-statistic/);
    assert.equal(alignmentPageDisplayPolicy.contractArtifactLabel, 'alignment-contract');
    assert.equal(alignmentPageDisplayPolicy.feasibility.statusBadge, 'needs-data');
  });

  it('owns alignment survey and feasibility vocabulary', () => {
    assert.ok(alignmentPageDisplayPolicy.steps.includes('方案共识'));
    assert.ok(alignmentPageDisplayPolicy.surveyMetrics.bio.some((metric) => metric.id === 'omics-modalities'));
    assert.ok(alignmentFeasibilityRows.some((row) => row.dim === '标签质量'));
    assert.equal(alignmentPageDisplayPolicy.feasibility.unknownStateCode, 'state=unknown until sourceRefs are attached');
  });

  it('projects alignment contracts into timeline display records', () => {
    const item = alignmentContractTimelineDisplay({
      id: 'contract-1',
      title: '契约',
      reason: 'saved',
      checksum: 'abc123',
      sourceRefs: ['artifact:contract-1'],
    });

    assert.equal(item.scenario, 'biomedical-knowledge-graph');
    assert.equal(item.action, 'alignment.contract');
    assert.match(item.desc, /alignment-contract contract-1/);
    assert.deepEqual(item.refs, ['artifact:contract-1']);
  });

  it('projects runtime events through package-owned timeline fallback labels', () => {
    const item = alignmentRuntimeTimelineDisplay({
      action: 'run.failed',
      subject: 'stage',
      artifactRefs: ['artifact:a'],
      executionUnitRefs: ['unit:b'],
    });

    assert.equal(item.scenario, 'literature-evidence-review');
    assert.equal(item.confidence, 0.35);
    assert.match(item.desc, /artifacts=1/);
    assert.deepEqual(item.refs, ['artifact:a', 'unit:b']);
  });

  it('owns timeline shell class tokens consumed by the UI page', () => {
    assert.equal(alignmentTimelineClassNames.list, 'timeline-list');
    assert.equal(alignmentTimelineClassNames.card, 'timeline-card');
  });
});
