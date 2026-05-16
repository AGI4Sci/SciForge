import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESULT_PRESENTATION_CONTRACT_ID,
  RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS,
  RESULT_PRESENTATION_PROJECTION_RULES,
  applyDefaultResultPresentationPolicy,
  createResultPresentationContract,
  diagnosticIsRawPayload,
  findingHasCitationOrUncertainty,
  projectResultPresentationVisibility,
  resultPresentationPrimaryDiagnostics,
  resultPresentationFromPayload,
  validateResultPresentationContract,
} from './result-presentation';
import type { ResultPresentationSection } from './result-presentation';

test('result presentation contract projects human-facing sections first', () => {
  const contract = createResultPresentationContract({
    answerBlocks: [{
      id: 'answer-1',
      kind: 'paragraph',
      text: 'The task completed and produced a reusable result.',
      citationIds: ['citation-1'],
    }],
    keyFindings: [{
      id: 'finding-1',
      text: 'The primary result is available as a structured artifact.',
      citationIds: ['citation-1'],
    }],
    inlineCitations: [{
      id: 'citation-1',
      label: 'Result artifact',
      kind: 'artifact',
      ref: 'artifact:result-1',
    }],
    artifactActions: [{
      id: 'artifact-action-1',
      label: 'Open result',
      action: 'preview',
      ref: 'artifact:result-1',
      primary: true,
    }],
    nextActions: [{
      id: 'next-1',
      label: 'Inspect result',
      kind: 'inspect',
      primary: true,
    }],
    confidenceExplanation: {
      level: 'medium',
      summary: 'The result has one directly linked citation.',
    },
    processSummary: {
      status: 'completed',
      summary: 'One backend run completed.',
    },
    diagnosticsRefs: [{
      id: 'diagnostic-1',
      label: 'Raw payload',
      kind: 'tool-payload',
      ref: '.sciforge/task-results/payload.json',
    }],
  });

  assert.equal(contract.contractId, RESULT_PRESENTATION_CONTRACT_ID);
  assert.deepEqual(contract.defaultExpandedSections, RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS);
  assert.deepEqual(validateResultPresentationContract(contract), { ok: true, issues: [] });
  assert.deepEqual(projectResultPresentationVisibility(contract), {
    expandedSections: ['answer', 'evidence', 'artifacts', 'actions'],
    collapsedSections: ['confidence', 'process', 'diagnostics', 'raw-payload'],
    primarySections: ['answer', 'evidence', 'artifacts', 'actions', 'confidence'],
    secondarySections: ['process', 'diagnostics'],
  });
});

test('key findings require citations or explicit uncertainty', () => {
  const invalid = createResultPresentationContract({
    answerBlocks: [{ id: 'answer-1', kind: 'paragraph', text: 'Completed.' }],
    keyFindings: [{ id: 'finding-1', text: 'This claim has no evidence marker.' }],
  });

  const invalidResult = validateResultPresentationContract(invalid);
  assert.equal(invalidResult.ok, false);
  assert.deepEqual(invalidResult.issues.map((issue) => issue.code), ['finding-missing-citation-or-uncertainty']);

  const uncertain = createResultPresentationContract({
    keyFindings: [{
      id: 'finding-1',
      text: 'This is a plausible but unverified interpretation.',
      uncertainty: { state: 'unverified', reason: 'No supporting artifact was available.' },
    }],
  });

  assert.equal(findingHasCitationOrUncertainty(uncertain.keyFindings[0]!), true);
  assert.deepEqual(validateResultPresentationContract(uncertain), { ok: true, issues: [] });
});

test('raw diagnostics cannot be primary or default-visible', () => {
  const defaultExpandedSections: ResultPresentationSection[] = ['answer', 'diagnostics'];
  const contract = {
    ...createResultPresentationContract({
      keyFindings: [{
        id: 'finding-1',
        text: 'The user-facing result is separated from raw diagnostics.',
        uncertainty: { state: 'partial', reason: 'This fixture only exercises diagnostic visibility.' },
      }],
      diagnosticsRefs: [{
        id: 'diagnostic-1',
        label: 'ToolPayload JSON',
        kind: 'tool-payload' as const,
        ref: '.sciforge/task-results/payload.json',
        primary: true,
        defaultVisible: true,
      }],
    }),
    defaultExpandedSections,
    diagnosticsRefs: [{
      id: 'diagnostic-1',
      label: 'ToolPayload JSON',
      kind: 'tool-payload' as const,
      ref: '.sciforge/task-results/payload.json',
      primary: true,
      defaultVisible: true,
      foldedByDefault: true as const,
    }],
  };

  assert.equal(diagnosticIsRawPayload(contract.diagnosticsRefs[0]!), true);
  assert.deepEqual(resultPresentationPrimaryDiagnostics(contract).map((entry) => entry.id), ['diagnostic-1']);

  const result = validateResultPresentationContract(contract);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'raw-diagnostic-primary',
    'raw-diagnostic-default-visible',
    'diagnostics-expanded-by-default',
  ]);
});

test('default presentation policy collapses process and diagnostics without scenario hints', () => {
  const contract = createResultPresentationContract({
    defaultExpandedSections: ['answer', 'process', 'diagnostics', 'evidence'],
    processSummary: { status: 'running', summary: 'Still running.' },
    diagnosticsRefs: [{ id: 'trace-1', label: 'Trace', kind: 'trace', ref: 'run:trace-1' }],
  });

  assert.deepEqual(contract.defaultExpandedSections, ['answer', 'evidence']);
  assert.equal(contract.fieldOrigins?.defaultExpandedSections, 'harness-presentation-policy');
  assert.deepEqual(validateResultPresentationContract(contract), { ok: true, issues: [] });
});

test('projection rules are scenario-agnostic and protect the human result layer', () => {
  assert.match(RESULT_PRESENTATION_PROJECTION_RULES.join('\n'), /Answer, evidence, artifact actions/);
  assert.match(RESULT_PRESENTATION_PROJECTION_RULES.join('\n'), /Raw JSON, ToolPayload/);
  assert.match(RESULT_PRESENTATION_PROJECTION_RULES.join('\n'), /Every key finding/);

  const contract = applyDefaultResultPresentationPolicy(createResultPresentationContract({
    answerBlocks: [{ id: 'answer-1', kind: 'status', text: 'Recovered partial result.' }],
    keyFindings: [{
      id: 'finding-1',
      kind: 'partial-result',
      text: 'Only part of the requested work completed.',
      uncertainty: { state: 'partial', reason: 'Backend stopped before all artifacts were produced.' },
    }],
    nextActions: [{ id: 'recover-1', label: 'Retry missing part', kind: 'recover' }],
    diagnosticsRefs: [{ id: 'stderr-1', label: 'stderr', kind: 'stderr', ref: 'run:stderr-1', defaultVisible: false }],
  }));

  const projection = projectResultPresentationVisibility(contract);
  assert.deepEqual(projection.expandedSections, ['answer', 'evidence', 'artifacts', 'actions']);
  assert.deepEqual(projection.secondarySections, ['diagnostics']);
});

test('artifact actions preserve generic derivation lineage from artifact metadata', () => {
  const presentation = resultPresentationFromPayload({
    payload: {
      message: 'Derived summary is ready.',
      artifacts: [{
        id: 'english-summary',
        type: 'research-report',
        title: 'English executive summary',
        dataRef: 'artifact:bilingual-executive-summary',
        metadata: {
          derivation: {
            schemaVersion: 'sciforge.artifact-derivation.v1',
            kind: 'summary',
            parentArtifactRef: 'artifact:research-report',
            sourceRefs: ['artifact:research-report', 'provider:openalex:openalex-w1'],
            sourceLanguage: 'zh',
            targetLanguage: 'en',
            verificationStatus: 'unverified',
          },
        },
      }],
    },
  });

  const action = presentation.artifactActions[0];
  assert.ok(action, 'derived artifact action should be projected');
  assert.equal(action.parentArtifactRef, 'artifact:research-report');
  assert.equal(action.derivationKind, 'summary');
  assert.equal(action.derivation?.targetLanguage, 'en');
  assert.deepEqual(action.sourceRefs, ['artifact:research-report', 'provider:openalex:openalex-w1']);
});

test('explicit diagnostic artifact delivery stays out of human-facing citations and actions', () => {
  const presentation = resultPresentationFromPayload({
    payload: {
      message: 'Readable report is ready; diagnostics are audit-only.',
      artifacts: [{
        id: 'report',
        type: 'report',
        title: 'Readable report',
        dataRef: 'artifact:report',
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:report',
          role: 'primary-deliverable',
          declaredMediaType: 'text/markdown',
          declaredExtension: '.md',
          contentShape: 'raw-file',
          readableRef: 'artifact:report',
          previewPolicy: 'inline',
        },
      }, {
        id: 'debug-envelope',
        type: 'debug-json',
        title: 'Debug envelope',
        dataRef: 'artifact:debug-envelope',
        delivery: {
          contractId: 'sciforge.artifact-delivery.v1',
          ref: 'artifact:debug-envelope',
          role: 'diagnostic',
          declaredMediaType: 'application/json',
          declaredExtension: '.json',
          contentShape: 'json-envelope',
          readableRef: 'artifact:debug-envelope',
          previewPolicy: 'audit-only',
        },
      }],
    },
  });

  assert.deepEqual(presentation.artifactActions.map((action) => action.ref), ['artifact:report']);
  assert.ok(presentation.inlineCitations.some((citation) => citation.ref === 'artifact:report'));
  assert.ok(!presentation.inlineCitations.some((citation) => citation.ref === 'artifact:debug-envelope'));
});
