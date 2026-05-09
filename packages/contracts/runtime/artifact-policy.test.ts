import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
  CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID,
  DIRECT_CONTEXT_FAST_PATH_POLICY,
  agentServerArtifactSelectionPromptPolicyLines,
  agentServerBibliographicVerificationPromptPolicyLines,
  agentServerCurrentReferencePromptPolicyLines,
  agentServerToolPayloadProtocolContractLines,
  artifactDataForUnparsedPathText,
  artifactDataReadRequestsForPolicy,
  buildCurrentReferenceDigestRecoveryPayload,
  buildDirectContextFastPathItems,
  CURRENT_REFERENCE_GATE_TOOL_ID,
  currentReferenceDigestFailureCanRecover,
  currentReferenceDigestRecoveryCandidates,
  defaultArtifactSchemaForSkillDomain,
  directContextFastPathMessage,
  directContextFastPathSupportingRefs,
  materializedMarkdownMetadataForArtifact,
  materializedMarkdownTextForArtifact,
  normalizeArtifactDataWithPolicy,
} from './artifact-policy';

test('runtime artifact policy owns AgentServer ToolPayload prompt contract', () => {
  assert.equal(CURRENT_REFERENCE_GATE_TOOL_ID, 'sciforge.current-reference-gate');
  assert.deepEqual(defaultArtifactSchemaForSkillDomain('literature'), { type: 'paper-list' });

  const protocol = agentServerToolPayloadProtocolContractLines().join('\n');
  assert.match(protocol, /ToolPayload schema is strict/);
  assert.match(protocol, /unknown-artifact-inspector/);

  const selection = agentServerArtifactSelectionPromptPolicyLines().join('\n');
  assert.match(selection, /Only treat expectedArtifactTypes as required/);
  assert.match(selection, /generate a coordinated Python task/);

  const currentRefs = agentServerCurrentReferencePromptPolicyLines().join('\n');
  assert.match(currentRefs, /currentReferences/);
  assert.match(currentRefs, /failed-with-reason/);

  const bibliography = agentServerBibliographicVerificationPromptPolicyLines().join('\n');
  assert.match(bibliography, /Bibliographic verification contract/);
  assert.match(bibliography, /verified_title/);
});

test('runtime artifact policy owns current-reference digest recovery payload shape', () => {
  assert.equal(CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID, 'sciforge.current-reference-digest-recovery');
  assert.equal(CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE, 'agentserver-digest-recovery');
  assert.equal(CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH, 'current-reference-digest-recovery');
  assert.equal(currentReferenceDigestFailureCanRecover('context window exceeded'), true);
  assert.equal(currentReferenceDigestFailureCanRecover('plain validation failure'), false);

  const candidates = currentReferenceDigestRecoveryCandidates([
    { status: 'ready', sourceRef: 'reports/a.md', digestRef: 'file:.sciforge/digests/a.md', digestText: '## Summary\nUseful result' },
    { status: 'failed', sourceRef: 'ignored.md', digestText: 'ignored' },
  ]);
  assert.deepEqual(candidates, [{
    sourceRef: 'reports/a.md',
    digestRef: '.sciforge/digests/a.md',
    inlineText: '## Summary\nUseful result',
  }]);

  const payload = buildCurrentReferenceDigestRecoveryPayload({
    prompt: 'summarize current refs',
    skillDomain: 'literature',
    skillId: 'agentserver.generate.literature',
    failureReason: 'context window exceeded',
    uiManifest: [{ componentId: 'report-viewer', artifactRef: CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID }],
    sources: [{ sourceRef: 'reports/a.md', digestRef: '.sciforge/digests/a.md', text: '## Summary\nUseful result' }],
    shortHash: () => 'abcd1234',
  });

  assert.equal(payload.claimType, 'current-reference-digest-recovery');
  assert.equal(payload.executionUnits[0]?.tool, CURRENT_REFERENCE_DIGEST_RECOVERY_TOOL_ID);
  assert.equal(payload.artifacts[0]?.id, CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID);
  assert.match(String((payload.artifacts[0]?.data as Record<string, unknown>).markdown), /summarize current refs/);
  assert.deepEqual(payload.objectReferences?.map((ref) => ref.id), ['source-abcd1234', 'digest-abcd1234']);
});

test('runtime artifact policy normalizes report markdown and path text', () => {
  const artifact = {
    id: 'report-1',
    type: 'research-report',
    metadata: {
      reportRef: '.sciforge/task-results/report.md',
      realDataPlanRef: '.sciforge/task-results/plan.json',
    },
    data: { report: '## Inline\n\nFallback.' },
  };

  assert.equal(materializedMarkdownTextForArtifact(artifact), '## Inline\n\nFallback.');
  assert.deepEqual(materializedMarkdownMetadataForArtifact(artifact.metadata, '.sciforge/task-results/report.md'), {
    reportRef: '.sciforge/task-results/report.md',
    markdownRef: '.sciforge/task-results/report.md',
  });
  assert.deepEqual(artifactDataReadRequestsForPolicy(artifact), [
    { key: 'reportMarkdown', kind: 'text', ref: '.sciforge/task-results/report.md' },
    { key: 'realDataPlan', kind: 'text', ref: '.sciforge/task-results/plan.json' },
  ]);

  const normalized = normalizeArtifactDataWithPolicy(artifact, {}, {
    reportMarkdown: '## From file\n\nBody.',
    realDataPlan: '{"steps":["read"]}',
  });
  assert.equal(normalized.markdown, '## From file\n\nBody.');
  assert.deepEqual(normalized.sections, [{ title: 'From file', content: 'Body.' }]);
  assert.deepEqual(normalized.realDataPlan, { steps: ['read'] });
  assert.deepEqual(artifactDataForUnparsedPathText({ type: 'summary-report' }, '# Summary'), {
    markdown: '# Summary',
    content: '# Summary',
  });
});

test('runtime artifact policy owns direct context fast path semantics', () => {
  assert.equal(DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId, 'sciforge.direct-context-fast-path');
  assert.equal(DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactType, 'research-report');

  const items = buildDirectContextFastPathItems({
    artifacts: [{
      id: 'report-1',
      type: 'research-report',
      data: { markdown: '## Summary\n\nA compact report.' },
    }],
    currentReferences: [{ ref: 'file:paper.md', title: 'Paper', summary: 'current file' }],
    executionUnits: [{ id: 'run-1', outputRef: 'runtime://out', stderrRef: 'runtime://err' }],
  });

  assert.deepEqual(items.map((item) => item.kind), ['artifact', 'file', 'execution-unit']);
  assert.equal(items[0]?.summary, '## Summary A compact report.');
  assert.deepEqual(directContextFastPathSupportingRefs(items), [
    'artifact:report-1',
    'file:paper.md',
    'runtime://out',
  ]);
  assert.match(directContextFastPathMessage(items), /1\. research-report report-1: ## Summary A compact report\./);
});

test('runtime artifact policy normalizes omics differential expression refs', () => {
  const artifact = {
    id: 'de',
    type: 'omics-differential-expression',
    metadata: {
      markerRef: 'markers.csv',
      qcRef: 'qc.csv',
      compositionRef: 'composition.csv',
      volcanoRef: 'volcano.csv',
      umapSvgRef: 'umap.svg',
      heatmapSvgRef: 'heatmap.svg',
    },
  };

  assert.deepEqual(artifactDataReadRequestsForPolicy(artifact), [
    { key: 'markerRows', kind: 'csv', ref: 'markers.csv' },
    { key: 'qcRows', kind: 'csv', ref: 'qc.csv' },
    { key: 'compositionRows', kind: 'csv', ref: 'composition.csv' },
    { key: 'volcanoRows', kind: 'csv', ref: 'volcano.csv' },
    { key: 'umapSvgText', kind: 'text', ref: 'umap.svg' },
    { key: 'heatmapSvgText', kind: 'text', ref: 'heatmap.svg' },
  ]);

  const normalized = normalizeArtifactDataWithPolicy(artifact, {}, {
    markerRows: [{ gene: 'IL6' }],
    volcanoRows: [{ gene: 'IL6', log2FC: 2.4, pval_adj: 2 }],
    umapSvgText: '<svg />',
  });
  assert.deepEqual(normalized.markers, [{ gene: 'IL6' }]);
  assert.deepEqual(normalized.points, [{
    gene: 'IL6',
    logFC: 2.4,
    negLogP: 2,
    significant: true,
    cluster: '',
  }]);
  assert.equal(normalized.umapSvgText, '<svg />');
});
