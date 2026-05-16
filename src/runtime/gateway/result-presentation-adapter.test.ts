import assert from 'node:assert/strict';
import test from 'node:test';

import type { ToolPayload } from '../runtime-types';
import { adaptToolPayloadToResultPresentation } from './result-presentation-adapter';

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'Completed the requested work and produced a concise result.',
    confidence: 0.86,
    claimType: 'result',
    evidenceLevel: 'medium',
    reasoningTrace: 'Called tools, retried once, and normalized the final payload.',
    claims: [{
      id: 'claim-1',
      text: 'The primary result is supported by a durable output file.',
      evidenceRefs: ['file:.sciforge/task-results/result.json'],
      confidence: 0.9,
      status: 'verified',
    }],
    uiManifest: [],
    executionUnits: [{
      id: 'unit-1',
      tool: 'generic.run',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/result.json',
      stdoutRef: 'file:.sciforge/logs/run.out',
    }],
    artifacts: [{
      id: 'artifact-1',
      type: 'report',
      title: 'Result report',
      dataRef: 'file:.sciforge/artifacts/report.md',
    }],
    ...overrides,
  };
}

test('builds a human result contract with answer, findings, inline citations, and artifact actions', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload());

  assert.equal(presentation.schemaVersion, 'sciforge.result-presentation.v1');
  assert.equal(presentation.answerBlocks[0]?.text, 'Completed the requested work and produced a concise result.');
  assert.ok(presentation.answerBlocks[0]?.citations.length);
  assert.equal(presentation.keyFindings[0]?.text, 'The primary result is supported by a durable output file.');
  assert.equal(presentation.keyFindings[0]?.verificationStatus, 'verified');
  assert.ok(presentation.keyFindings[0]?.citations.length);
  assert.deepEqual(presentation.artifactActions.map((action) => action.label), ['Result report']);
  assert.ok(presentation.inlineCitations.some((citation) => citation.ref === 'file:.sciforge/artifacts/report.md'));
  assert.ok(presentation.defaultExpandedSections.includes('answer'));
  assert.ok(presentation.defaultExpandedSections.includes('evidence'));
  assert.ok(presentation.defaultExpandedSections.includes('artifacts'));
});

test('preserves generic derivation lineage on artifact actions', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload({
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
  }));

  const action = presentation.artifactActions[0];
  assert.ok(action, 'derived artifact action should be available');
  assert.equal(action.parentArtifactRef, 'artifact:research-report');
  assert.equal(action.derivationKind, 'summary');
  assert.equal(action.derivation?.sourceLanguage, 'zh');
  assert.deepEqual(action.sourceRefs, ['artifact:research-report', 'provider:openalex:openalex-w1']);
});

test('does not project diagnostic artifact delivery as a human-facing artifact action', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload({
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
  }));

  assert.deepEqual(presentation.artifactActions.map((action) => action.ref), ['artifact:report']);
  assert.ok(presentation.inlineCitations.some((citation) => citation.ref === 'artifact:report'));
  assert.ok(!presentation.inlineCitations.some((citation) => citation.ref === 'artifact:debug-envelope'));
});

test('folds process and raw diagnostics away from primary answer sections', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload({
    logs: [{ id: 'log-1', level: 'debug', ref: 'file:.sciforge/logs/debug.log', message: 'debug details' }],
  }), {
    rawPayloadRef: 'file:.sciforge/task-results/raw-payload.json',
    schemaDiagnostics: ['schema repaired by fallback'],
  });

  assert.equal(presentation.processSummary.foldedByDefault, true);
  assert.deepEqual(presentation.processSummary.items.map((item) => item.id), ['unit-1']);
  assert.ok(!presentation.defaultExpandedSections.includes('process'));
  assert.ok(!presentation.defaultExpandedSections.includes('diagnostics'));
  assert.ok(presentation.diagnosticsRefs.some((ref) => ref.kind === 'reasoning-trace'));
  assert.ok(presentation.diagnosticsRefs.some((ref) => ref.kind === 'raw-payload'));
  assert.ok(presentation.diagnosticsRefs.some((ref) => ref.kind === 'schema'));
  assert.ok(presentation.diagnosticsRefs.some((ref) => ref.kind === 'log'));
  assert.ok(!presentation.answerBlocks[0]?.text.includes('Called tools'));
  assert.ok(!presentation.answerBlocks[0]?.text.includes('raw-payload'));
});

test('uses work evidence and verification refs without scenario-specific assumptions', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload({
    claims: [],
    workEvidence: [{
      id: 'evidence-1',
      kind: 'fetch',
      status: 'partial',
      outputSummary: 'Fetched two records before the provider limited the run.',
      evidenceRefs: ['file:.sciforge/evidence/fetch.json'],
      recoverActions: ['Retry with a smaller batch.'],
      nextStep: 'Ask whether to continue from partial records.',
      diagnostics: ['provider returned a retry-after header'],
      rawRef: 'file:.sciforge/evidence/fetch.raw.json',
    }],
    verificationResults: [{
      id: 'verify-1',
      verdict: 'uncertain',
      confidence: 0.42,
      critique: 'Only partial evidence was available.',
      evidenceRefs: ['file:.sciforge/evidence/fetch.json'],
      repairHints: ['Run an additional verifier.'],
    }],
    objectReferences: [{
      id: 'object-1',
      title: 'Fetched records',
      kind: 'file',
      ref: 'file:.sciforge/evidence/fetch.json',
      status: 'available',
    }],
  }));

  assert.equal(presentation.keyFindings[0]?.text, 'Fetched two records before the provider limited the run.');
  assert.ok(presentation.inlineCitations.some((citation) => citation.source === 'work-evidence'));
  assert.ok(presentation.inlineCitations.some((citation) => citation.source === 'verification-result'));
  assert.ok(presentation.inlineCitations.some((citation) => citation.source === 'object-reference'));
  assert.ok(presentation.nextActions.includes('Retry with a smaller batch.'));
  assert.ok(presentation.nextActions.includes('Ask whether to continue from partial records.'));
  assert.ok(presentation.nextActions.includes('Run an additional verifier.'));
  assert.ok(presentation.diagnosticsRefs.some((ref) => ref.kind === 'work-evidence'));
  assert.match(presentation.confidenceExplanation ?? '', /verification uncertain/);
});

test('marks uncited claims as unverified instead of inventing evidence', () => {
  const presentation = adaptToolPayloadToResultPresentation(payload({
    claims: [{ id: 'claim-no-ref', text: 'This claim has no supporting reference.' }],
    artifacts: [],
    executionUnits: [],
    objectReferences: [],
    workEvidence: [],
    verificationResults: [],
  }));

  assert.equal(presentation.keyFindings[0]?.verificationStatus, 'unverified');
  assert.deepEqual(presentation.keyFindings[0]?.citations, []);
  assert.ok(!presentation.defaultExpandedSections.includes('evidence'));
});
