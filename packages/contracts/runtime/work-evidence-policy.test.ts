import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateWorkEvidencePolicy } from './work-evidence-policy';

test('package WorkEvidence policy flags completed external retrieval with zero results and no diagnostics', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Completed search. Retrieved 0 papers from the provider.',
    confidence: 0.92,
    claimType: 'fact',
    evidenceLevel: 'high',
    reasoningTrace: 'Search completed successfully with 0 records.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      resultCount: 0,
      evidenceRefs: ['trace:provider-search'],
      recoverActions: [],
      rawRef: 'trace:provider-search',
    }],
  }, {
    expectedEvidenceKinds: ['retrieval'],
  });

  assert.equal(finding?.kind, 'external-empty-result-without-diagnostics');
  assert.equal(finding?.severity, 'repair-needed');
});

test('package WorkEvidence policy allows external retrieval when WorkEvidence carries provider diagnostics', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Completed search with no matching records.',
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Provider status 200 totalResults=0 after fallback.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'retrieval',
      status: 'empty',
      provider: 'provider.fixture',
      resultCount: 0,
      outputSummary: 'Provider status 200 totalResults=0.',
      evidenceRefs: ['trace:provider-fixture'],
      recoverActions: ['Fallback query was attempted.'],
    }],
  }, {
    expectedEvidenceKinds: ['retrieval'],
  });

  assert.equal(finding, undefined);
});

test('package WorkEvidence policy does not infer external retrieval from prompt text', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Completed search. Retrieved 0 papers from the provider.',
    confidence: 0.92,
    claimType: 'fact',
    evidenceLevel: 'high',
    reasoningTrace: 'Search completed successfully with 0 records.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
  }, {
    prompt: 'Retrieve recent literature about contract-aware agents.',
  });

  assert.equal(finding, undefined);
});

test('package WorkEvidence policy flags successful external WorkEvidence without durable refs', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Fetch completed successfully.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'high',
    reasoningTrace: 'Fetched a source and summarized it.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'fetch', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'fetch',
      status: 'success',
      provider: 'http.fixture',
      input: 'https://example.test/source',
      outputSummary: 'Fetched source successfully.',
      evidenceRefs: [],
      recoverActions: [],
    }],
  }, {
    prompt: 'Fetch and summarize a public page.',
  });

  assert.equal(finding?.kind, 'external-io-without-durable-evidence-ref');
});

test('package WorkEvidence policy requires verified claim evidence to be record-bound', () => {
  const unrelated = evaluateWorkEvidencePolicy({
    message: 'Verified both claims.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    claims: [{
      id: 'claim-a',
      text: 'Claim A has no bound evidence.',
      verificationStatus: 'verified',
    }],
    uiManifest: [],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'claim',
      status: 'success',
      input: { claimId: 'claim-b' },
      outputSummary: 'Verified claim-b only.',
      evidenceRefs: ['file:.sciforge/evidence/claim-b.json'],
      rawRef: 'file:.sciforge/evidence/claim-b.raw.json',
      recoverActions: [],
    }],
  }, {
    prompt: 'Verify these claims.',
  });

  assert.equal(unrelated?.kind, 'verified-claim-without-evidence');

  const bound = evaluateWorkEvidencePolicy({
    message: 'Verified the claim.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    claims: [{
      id: 'claim-a',
      text: 'Claim A has bound evidence.',
      verificationStatus: 'verified',
    }],
    uiManifest: [],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'claim',
      status: 'success',
      input: { claimId: 'claim-a' },
      outputSummary: 'Verified claim-a.',
      evidenceRefs: ['file:.sciforge/evidence/claim-a.json'],
      rawRef: 'file:.sciforge/evidence/claim-a.raw.json',
      recoverActions: [],
    }],
  }, {
    prompt: 'Verify these claims.',
  });

  assert.equal(bound, undefined);
});

test('package WorkEvidence policy validates uiManifest artifact refs against data contracts', () => {
  const missing = evaluateWorkEvidencePolicy({
    message: 'Render the report.',
    confidence: 0.7,
    claimType: 'status',
    evidenceLevel: 'runtime',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'artifact:missing-report' }],
    executionUnits: [{ id: 'render', status: 'done' }],
    artifacts: [],
  }, {
    prompt: 'Show the report.',
  });

  assert.equal(missing?.kind, 'referenced-artifact-without-data-contract');

  const inline = evaluateWorkEvidencePolicy({
    message: 'Render the report.',
    confidence: 0.7,
    claimType: 'status',
    evidenceLevel: 'runtime',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'artifact:inline-report' }],
    executionUnits: [{ id: 'render', status: 'done' }],
    artifacts: [{
      id: 'inline-report',
      type: 'research-report',
      data: { markdown: '# Inline report' },
    }],
  }, {
    prompt: 'Show the report.',
  });

  assert.equal(inline, undefined);

  const inlineContent = evaluateWorkEvidencePolicy({
    message: 'Render the report.',
    confidence: 0.7,
    claimType: 'status',
    evidenceLevel: 'runtime',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'inline-content-report' }],
    executionUnits: [{ id: 'render', status: 'done' }],
    artifacts: [{
      id: 'inline-content-report',
      type: 'research-report',
      content: '# Inline report',
      mimeType: 'text/markdown',
    }],
  }, {
    prompt: 'Show the report.',
  });

  assert.equal(inlineContent, undefined);

  const empty = evaluateWorkEvidencePolicy({
    message: 'Render the report.',
    confidence: 0.7,
    claimType: 'status',
    evidenceLevel: 'runtime',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'empty-report' }],
    executionUnits: [{ id: 'render', status: 'done' }],
    artifacts: [{
      id: 'empty-report',
      type: 'research-report',
      data: {},
    }],
  }, {
    prompt: 'Show the report.',
  });

  assert.equal(empty?.kind, 'referenced-artifact-without-data-contract');

  const typeRouted = evaluateWorkEvidencePolicy({
    message: 'Render the report.',
    confidence: 0.7,
    claimType: 'status',
    evidenceLevel: 'runtime',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report' }],
    executionUnits: [{ id: 'render', status: 'done' }],
    artifacts: [{
      id: 'handoff-report',
      type: 'research-report',
      data: { markdown: '# Type-routed report' },
    }],
  }, {
    prompt: 'Show the report.',
  });

  assert.equal(typeRouted, undefined);
});

test('package WorkEvidence policy ignores presentation and runtime uiManifest refs for artifact data contracts', () => {
  for (const artifactRef of [
    'runtime://agent-harness/results/run-1',
    'runtime:direct-context-fast-path',
    'presentation:paper-card-list:default',
    'result-presentation:balanced-default:v1',
    'view:runtime-result',
    'execution-unit:search-run',
    'literature-runtime-result',
    'agentserver-runtime-result',
  ]) {
    const finding = evaluateWorkEvidencePolicy({
      message: 'Render runtime presentation refs.',
      confidence: 0.7,
      claimType: 'status',
      evidenceLevel: 'runtime',
      claims: [],
      uiManifest: [{ componentId: 'runtime-diagnostic-viewer', artifactRef }],
      executionUnits: [{ id: 'render', status: 'done' }],
      artifacts: [],
    }, {
      prompt: 'Show the runtime result.',
    });

    assert.equal(finding, undefined, artifactRef);
  }
});

test('package WorkEvidence policy flags verified bibliographic records without provider evidence', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Planned literature review; no provider lookup was executed.',
    confidence: 0.72,
    claimType: 'evidence-summary',
    evidenceLevel: 'preliminary',
    reasoningTrace: 'No external retrieval was requested.',
    claims: [],
    uiManifest: [{ componentId: 'paper-card-list', artifactRef: 'paper-list' }],
    executionUnits: [{ id: 'plan', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: {
        papers: [{
          title: 'A citation-looking title',
          verified_title: 'A citation-looking title',
          verification_status: 'verified',
          title_match: true,
        }],
      },
    }],
  }, {
    selectedCapabilityIds: ['literature.retrieval'],
  });

  assert.equal(finding?.kind, 'verified-bibliographic-record-without-evidence');
  assert.equal(finding?.severity, 'repair-needed');
});

test('package WorkEvidence policy does not treat ordinary verified rows as bibliographic records', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Release checklist verified by local review.',
    confidence: 0.72,
    claimType: 'status',
    evidenceLevel: 'workflow',
    claims: [],
    uiManifest: [{ componentId: 'table', artifactRef: 'release-checklist' }],
    executionUnits: [{ id: 'review', status: 'done' }],
    artifacts: [{
      id: 'release-checklist',
      type: 'release-checklist',
      schema: { type: 'object' },
      data: {
        rows: [{
          title: 'Regression gate',
          year: '2026',
          verification_status: 'verified',
        }],
      },
    }],
  }, {
    prompt: 'Summarize this release checklist.',
  });

  assert.equal(finding, undefined);
});

test('package WorkEvidence policy allows unverified bibliography and verified records with durable provider refs', () => {
  const unverified = evaluateWorkEvidencePolicy({
    message: 'Bibliography needs verification.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'plan', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: { papers: [{ title: 'A citation-looking title', verification_status: 'needs-verification' }] },
    }],
  }, {
    selectedCapabilityIds: ['literature.retrieval'],
  });
  assert.equal(unverified, undefined);

  const verified = evaluateWorkEvidencePolicy({
    message: 'Citation verification completed.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: {
        papers: [{
          title: 'A real checked title',
          doi: '10.0000/example',
          verified_title: 'A real checked title',
          verification_status: 'verified',
          title_match: true,
          evidenceRefs: ['file:.sciforge/evidence/doi-lookup.json'],
        }],
      },
    }],
    workEvidence: [{
      kind: 'citation-verification',
      status: 'success',
      provider: 'doi.fixture',
      input: { doi: '10.0000/example', recordId: 'paper-list:0' },
      outputSummary: 'Verified DOI 10.0000/example for A real checked title.',
      evidenceRefs: ['file:.sciforge/evidence/doi-lookup.json'],
      recoverActions: [],
      rawRef: 'file:.sciforge/evidence/doi-lookup.raw.json',
    }],
  }, {
    selectedCapabilityIds: ['citation.verification'],
  });
  assert.equal(verified, undefined);
});

test('package WorkEvidence policy binds bibliographic verification evidence to the matching record', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Citation verification completed for one paper.',
    claims: [],
    uiManifest: [{ componentId: 'paper-card-list', artifactRef: 'paper-list' }],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: {
        papers: [
          {
            id: 'paper-a',
            title: 'A checked evidence-bound title',
            doi: '10.0000/checked',
            verified_title: 'A checked evidence-bound title',
            verification_status: 'verified',
            title_match: true,
          },
          {
            id: 'paper-b',
            title: 'An unbound citation-looking title',
            verified_title: 'An unbound citation-looking title',
            verification_status: 'verified',
            title_match: true,
          },
        ],
      },
    }],
    workEvidence: [{
      kind: 'citation-verification',
      status: 'success',
      provider: 'doi.fixture',
      input: { doi: '10.0000/checked', paperId: 'paper-a' },
      outputSummary: 'Verified paper-a with DOI 10.0000/checked.',
      evidenceRefs: ['file:.sciforge/evidence/doi-lookup-a.json'],
      recoverActions: [],
      rawRef: 'file:.sciforge/evidence/doi-lookup-a.raw.json',
    }],
  }, {
    selectedCapabilityIds: ['citation.verification'],
  });

  assert.equal(finding?.kind, 'verified-bibliographic-record-without-evidence');
});

test('package WorkEvidence policy rejects copied bibliographic evidence refs bound to another record', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Citation verification completed for one paper.',
    claims: [],
    uiManifest: [{ componentId: 'paper-card-list', artifactRef: 'paper-list' }],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: {
        papers: [
          {
            id: 'paper-a',
            title: 'A checked evidence-bound title',
            doi: '10.0000/checked-a',
            verification_status: 'verified',
            evidenceRefs: ['file:.sciforge/evidence/doi-lookup-a.json'],
          },
          {
            id: 'paper-b',
            title: 'A different checked title',
            doi: '10.0000/checked-b',
            verification_status: 'verified',
            evidenceRefs: ['file:.sciforge/evidence/doi-lookup-a.json'],
          },
        ],
      },
    }],
    workEvidence: [{
      kind: 'citation-verification',
      status: 'success',
      provider: 'doi.fixture',
      input: { doi: '10.0000/checked-a', recordId: 'paper-a' },
      outputSummary: 'Verified paper-a with DOI 10.0000/checked-a.',
      evidenceRefs: ['file:.sciforge/evidence/doi-lookup-a.json'],
      recoverActions: [],
      rawRef: 'file:.sciforge/evidence/doi-lookup-a.raw.json',
    }],
  }, {
    selectedCapabilityIds: ['citation.verification'],
  });

  assert.equal(finding?.kind, 'verified-bibliographic-record-without-evidence');
});

test('package WorkEvidence policy rejects title-similar bibliographic evidence with conflicting identifier context', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Citation verification completed.',
    claims: [],
    uiManifest: [{ componentId: 'paper-card-list', artifactRef: 'paper-list' }],
    executionUnits: [{ id: 'verify', status: 'done' }],
    artifacts: [{
      id: 'paper-list',
      type: 'paper-list',
      schema: { type: 'object' },
      data: {
        papers: [{
          id: 'paper-b',
          title: 'Contract aware agent planning for scientific workflows',
          doi: '10.0000/current',
          year: 2024,
          journal: 'Journal of Runtime Contracts',
          verification_status: 'verified',
        }],
      },
    }],
    workEvidence: [{
      kind: 'citation-verification',
      status: 'success',
      provider: 'doi.fixture',
      input: { doi: '10.0000/other', recordId: 'paper-a' },
      outputSummary: 'Verified Contract aware agent planning for scientific workflows, DOI 10.0000/other, 2021, Journal of Planning Systems.',
      evidenceRefs: ['file:.sciforge/evidence/doi-lookup-other.json'],
      recoverActions: [],
      rawRef: 'file:.sciforge/evidence/doi-lookup-other.raw.json',
    }],
  }, {
    selectedCapabilityIds: ['citation.verification'],
  });

  assert.equal(finding?.kind, 'verified-bibliographic-record-without-evidence');
});
