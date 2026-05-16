import assert from 'node:assert/strict';
import test from 'node:test';

import { createResultPresentationContract } from '@sciforge-ui/runtime-contract/result-presentation';
import type { ToolPayload } from '../runtime-types';
import { attachResultPresentationContract } from './result-presentation-contract.js';

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'Fallback result should only be generated when no valid presentation exists.',
    confidence: 0.8,
    claimType: 'result',
    evidenceLevel: 'medium',
    reasoningTrace: 'runtime trace',
    claims: [],
    uiManifest: [],
    executionUnits: [],
    artifacts: [],
    ...overrides,
  };
}

test('attachResultPresentationContract preserves an existing valid result presentation', () => {
  const existing = createResultPresentationContract({
    id: 'complex-multiturn-presentation',
    status: 'partial',
    answerBlocks: [{ id: 'answer', kind: 'paragraph', text: 'Complex multiturn state is recoverable.', citations: [] }],
    keyFindings: [{
      id: 'state-boundary',
      text: 'State digest and artifact refs are authoritative.',
      verificationState: 'unverified',
      citations: [],
      uncertainty: { state: 'partial', reason: 'Synthetic fixture replay.' },
    }],
    nextActions: [{ id: 'continue', label: 'Continue pending work', kind: 'continue' }],
    diagnosticsRefs: [{ id: 'trace', label: 'Harness trace', kind: 'raw-payload', ref: 'trace:complex-multiturn', foldedByDefault: true }],
    defaultExpandedSections: ['answer', 'evidence', 'artifacts', 'next-actions'],
    generatedBy: 'harness-presentation-policy',
  });

  const attached = attachResultPresentationContract(payload({
    displayIntent: {
      resultPresentation: existing,
      viewMode: 'complex-multiturn',
    },
  }));

  assert.equal(attached.displayIntent?.resultPresentation, existing);
  assert.equal(attached.displayIntent?.viewMode, 'complex-multiturn');
});

test('attachResultPresentationContract materializes a fallback when existing presentation is invalid', () => {
  const attached = attachResultPresentationContract(payload({
    displayIntent: {
      resultPresentation: { schemaVersion: 'invalid' },
    },
  }));

  const resultPresentation = attached.displayIntent?.resultPresentation as { schemaVersion?: string; id?: string } | undefined;
  assert.equal(resultPresentation?.schemaVersion, 'sciforge.result-presentation-contract.v1');
  assert.notEqual(resultPresentation?.id, undefined);
});

test('attachResultPresentationContract separates protocol success from unmet task success', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'Search completed and a compact table is available.',
    artifacts: [{ id: 'paper-table', type: 'data-table', title: 'Paper table', data: { rows: [] } }],
    executionUnits: [{ id: 'search', status: 'done', tool: 'workspace-task', nextStep: 'Generate the requested report from preserved table refs.' }],
  }), {
    request: {
      skillDomain: 'literature',
      prompt: 'Find papers and produce a research-report artifact.',
      expectedArtifactTypes: ['research-report'],
      selectedComponentIds: ['report-viewer'],
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, unknown> | undefined;
  const proxy = projection?.userSatisfactionProxy as Record<string, unknown> | undefined;

  assert.equal(projection?.schemaVersion, 'sciforge.gateway-task-outcome-projection.v1');
  assert.equal(projection?.protocolSuccess, true);
  assert.equal(projection?.taskSuccess, false);
  assert.equal(card?.protocolStatus, 'protocol-success');
  assert.equal(card?.taskOutcome, 'needs-work');
  assert.equal(card?.status, 'needs-work');
  assert.equal(proxy?.status, 'needs-work');
  assert.equal(proxy?.usableResultVisible, true);
  const conversationProjection = projection?.conversationProjection as Record<string, unknown> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, unknown> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;
  const answerBlocks = resultPresentation?.answerBlocks as Array<Record<string, unknown>> | undefined;
  assert.equal(conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  assert.equal(visibleAnswer?.status, 'degraded-result');
  assert.match(String(visibleAnswer?.text), /Partial result artifacts are available/i);
  assert.doesNotMatch(String(visibleAnswer?.text).split('Draft result summary:')[0] ?? '', /completed|complete|已完成|完成/i);
  assert.equal(resultPresentation?.status, 'partial');
  assert.match(String(answerBlocks?.[0]?.text), /Partial result artifacts are available/i);
  assert.doesNotMatch(String(answerBlocks?.[0]?.text), /completed|complete|已完成|完成/i);
  assert.ok(Array.isArray(proxy?.reasons));
  assert.match(String(card?.nextStep), /requested report|preserved table refs/i);
});

test('attachResultPresentationContract does not treat message text alone as satisfied task outcome', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'Looks complete, but no structured task outcome was declared.',
    artifacts: [],
    executionUnits: [{ id: 'status-only', status: 'done', tool: 'workspace-task' }],
  }), {
    request: {
      skillDomain: 'literature',
      prompt: 'Summarize the current task.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  const proxy = projection?.userSatisfactionProxy as Record<string, unknown> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, unknown> | undefined;

  assert.equal(projection?.protocolSuccess, true);
  assert.equal(projection?.taskSuccess, false);
  assert.equal(card?.taskOutcome, 'needs-work');
  assert.equal(proxy?.answeredLatestRequest, false);
});

test('attachResultPresentationContract treats complete evidenced presentation as satisfied', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'Provider route returned two public records and produced the requested answer.',
    claims: [{
      id: 'claim-provider-records',
      text: 'Ready provider route returned public records.',
      supportingRefs: ['provider:sciforge.web-worker.web_search'],
    }],
    artifacts: [{
      id: 'research-report',
      type: 'research-report',
      title: 'Research report',
      dataRef: '.sciforge/task-results/research-report.md',
      delivery: {
        contractId: 'sciforge.artifact-delivery.v1',
        ref: 'artifact:research-report',
        role: 'primary-deliverable',
        declaredMediaType: 'text/markdown',
        declaredExtension: 'md',
        contentShape: 'raw-file',
        readableRef: '.sciforge/task-results/research-report.md',
        previewPolicy: 'inline',
      },
    }],
    executionUnits: [{
      id: 'provider-search',
      status: 'done',
      tool: 'sciforge.web-worker.web_search',
      outputRef: 'provider-result:ready',
    }],
  }), {
    request: {
      skillDomain: 'literature',
      prompt: 'Use the ready provider route and answer with two public records.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  const proxy = projection?.userSatisfactionProxy as Record<string, unknown> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, unknown> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, unknown> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, unknown> | undefined;

  assert.equal(projection?.taskSuccess, true);
  assert.equal(card?.taskOutcome, 'satisfied');
  assert.equal(proxy?.answeredLatestRequest, true);
  assert.equal(visibleAnswer?.status, 'satisfied');
});

test('attachResultPresentationContract does not downgrade direct-context answers for visible non-required unverified markers', () => {
  const answer = [
    'Answered directly from the selected report; no new workspace task was started.',
    '',
    '- Credibility verdict: credible as a toy reproduction because the selected report says "Reproduction success: YES".',
    '- Supporting metric: r true 0.5000, fitted 0.4767, error 4.67%',
    '- Supporting metric: K true 200.0, fitted 201.5, error 0.77%',
    '- Supporting metric: RMSE 4.3505',
  ].join('\n');
  const attached = attachResultPresentationContract(payload({
    message: answer,
    confidence: 0.74,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    claims: [{
      id: 'direct-context-claim',
      text: 'Answered directly from the selected report.',
      supportingRefs: ['artifact:reproduction-report'],
    }],
    artifacts: [{
      id: 'direct-context-summary',
      type: 'runtime-context-summary',
      title: 'Direct context answer',
      data: { markdown: answer },
    }],
    executionUnits: [{
      id: 'EU-direct-context-report-followup',
      status: 'done',
      tool: 'sciforge.direct-context-fast-path',
      outputRef: 'runtime://direct-context-fast-path/report-followup',
    }],
    verificationResults: [{
      id: 'verification-visible-unverified',
      verdict: 'unverified',
      confidence: 0,
      evidenceRefs: ['execution-unit:EU-direct-context-report-followup'],
      repairHints: [],
      diagnostics: {
        required: false,
        visibleUnverified: true,
      },
    }],
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
  }), {
    request: {
      skillDomain: 'literature',
      prompt: 'Using only the selected reproduction report, tell me whether this toy reproduction is credible. List the exact metrics that support the verdict.',
      artifacts: [],
      uiState: {
        conversationPolicy: {
          executionModePlan: { executionMode: 'direct-context-answer' },
          responsePlan: { initialResponseMode: 'direct-context-answer' },
        },
      },
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, any> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, any> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, any> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;

  assert.equal(projection?.protocolSuccess, true);
  assert.equal(projection?.taskSuccess, true);
  assert.equal(card?.taskOutcome, 'satisfied');
  assert.equal(visibleAnswer?.status, 'satisfied');
  assert.match(String(visibleAnswer?.text), /Answered directly from the selected report/);
  assert.doesNotMatch(String(visibleAnswer?.text), /required verification is still unverified|Partial result artifacts/i);
  assert.equal(resultPresentation?.status, 'complete');
});

test('attachResultPresentationContract rebuilds stale partial presentation when recomputed direct-context projection is satisfied', () => {
  const request = {
    skillDomain: 'literature' as const,
    prompt: 'Using only the selected reproduction report, tell me whether this toy reproduction is credible and list exact metrics plus one next validation step.',
    artifacts: [],
    uiState: {
      conversationPolicy: {
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
    },
  };
  const answer = [
    'Answered directly from the selected report; no new workspace task was started.',
    '',
    '- Credibility verdict: credible as a toy reproduction because the selected report says "Reproduction success: YES".',
    '- Supporting metric: r true 0.5000, fitted 0.4767, error 4.67%',
    '- Next validation step: repeat across multiple random seeds.',
  ].join('\n');
  const staleNeedsWork = attachResultPresentationContract(payload({
    message: answer,
    confidence: 0.74,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    claims: [{ id: 'direct-context-claim', text: 'Answered directly from the selected report.', supportingRefs: ['artifact:reproduction-report'] }],
    artifacts: [{ id: 'direct-context-summary', type: 'runtime-context-summary', title: 'Direct context answer', data: { markdown: answer } }],
    executionUnits: [{ id: 'EU-direct-context-report-followup', status: 'done', tool: 'sciforge.direct-context-fast-path' }],
    verificationResults: [{
      id: 'verification-required-unverified',
      verdict: 'unverified',
      confidence: 0,
      evidenceRefs: ['execution-unit:EU-direct-context-report-followup'],
      repairHints: [],
      diagnostics: { required: true },
    }],
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
  }), { request });

  const attached = attachResultPresentationContract(payload({
    message: answer,
    confidence: 0.74,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    claims: [{ id: 'direct-context-claim', text: 'Answered directly from the selected report.', supportingRefs: ['artifact:reproduction-report'] }],
    artifacts: [{ id: 'direct-context-summary', type: 'runtime-context-summary', title: 'Direct context answer', data: { markdown: answer } }],
    executionUnits: [{ id: 'EU-direct-context-report-followup', status: 'done', tool: 'sciforge.direct-context-fast-path' }],
    verificationResults: [{
      id: 'verification-visible-unverified',
      verdict: 'unverified',
      confidence: 0,
      evidenceRefs: ['execution-unit:EU-direct-context-report-followup'],
      repairHints: [],
      diagnostics: { required: false, visibleUnverified: true },
    }],
    displayIntent: {
      ...staleNeedsWork.displayIntent,
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
  }), { request });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;
  const answerBlocks = resultPresentation?.answerBlocks as Array<Record<string, unknown>> | undefined;
  const visibleAnswer = (projection?.conversationProjection as Record<string, any> | undefined)?.visibleAnswer as Record<string, any> | undefined;

  assert.equal(projection?.taskSuccess, true);
  assert.equal(visibleAnswer?.status, 'satisfied');
  assert.equal(resultPresentation?.status, 'complete');
  assert.doesNotMatch(String(answerBlocks?.[0]?.text), /Partial result artifacts|required verification|human approval/i);
  assert.match(String(answerBlocks?.[0]?.text), /Answered directly from the selected report/);
});

test('attachResultPresentationContract blocks satisfied outcome when required verification remains unverified', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'Protocol artifact is ready.',
    claims: [{
      id: 'claim-protocol-ready',
      text: 'Protocol artifact is ready.',
      supportingRefs: ['artifact:protocol'],
    }],
    artifacts: [{
      id: 'protocol',
      type: 'markdown',
      title: 'Protocol',
      dataRef: '.sciforge/task-results/protocol.md',
    }],
    executionUnits: [{
      id: 'protocol-generation',
      status: 'done',
      tool: 'workspace-task',
      outputRef: '.sciforge/task-results/protocol.md',
    }],
    verificationResults: [{
      id: 'verification-required',
      verdict: 'unverified',
      confidence: 0,
      evidenceRefs: ['execution-unit:protocol-generation'],
      repairHints: ['Run an appropriate verifier or request human approval.'],
      diagnostics: {
        required: true,
        visibleUnverified: true,
      },
    }],
    displayIntent: {
      taskOutcome: 'satisfied',
      resultPresentation: createResultPresentationContract({
        id: 'protocol-presentation',
        status: 'complete',
        answerBlocks: [{ id: 'answer', kind: 'paragraph', text: 'Protocol artifact is ready.', citationIds: ['artifact-protocol'] }],
        keyFindings: [{
          id: 'protocol-ready',
          text: 'Protocol artifact is ready.',
          verificationState: 'supported',
          citationIds: ['artifact-protocol'],
        }],
        inlineCitations: [{ id: 'artifact-protocol', label: 'Protocol', ref: '.sciforge/task-results/protocol.md', kind: 'artifact' }],
        artifactActions: [{ id: 'protocol', label: 'Protocol', ref: '.sciforge/task-results/protocol.md', action: 'inspect', kind: 'inspect' }],
      }),
    },
  }), {
    request: {
      skillDomain: 'knowledge',
      prompt: 'Create and verify a protocol artifact.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const proxy = projection?.userSatisfactionProxy as Record<string, any> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, any> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, any> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, any> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;
  const answerBlocks = resultPresentation?.answerBlocks as Array<Record<string, unknown>> | undefined;

  assert.equal(projection?.protocolSuccess, true);
  assert.equal(projection?.taskSuccess, false);
  assert.equal(card?.taskOutcome, 'needs-work');
  assert.equal(card?.status, 'needs-work');
  assert.equal(proxy?.status, 'needs-work');
  assert.equal(conversationProjection?.verificationState?.status, 'unverified');
  assert.equal(visibleAnswer?.status, 'degraded-result');
  assert.match(String(visibleAnswer?.text), /required verification is still unverified/i);
  assert.doesNotMatch(String(visibleAnswer?.text).split('Draft result summary:')[0] ?? '', /ready|completed|已完成/i);
  assert.equal(resultPresentation?.status, 'partial');
  assert.match(String(answerBlocks?.[0]?.text), /Partial result artifacts are available/i);
  assert.doesNotMatch(String(answerBlocks?.[0]?.text), /ready|completed|已完成|完成/i);
  assert.match(String(card?.nextStep), /verifier|human approval/i);
});

test('attachResultPresentationContract blocks satisfied outcome when request requires verification but no verdict exists', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'P5 methodology review is complete. Please see the generated report.',
    claims: [{
      id: 'claim-methodology-review',
      text: 'A methodology report was generated.',
      supportingRefs: ['artifact:methodology-report'],
    }],
    artifacts: [{
      id: 'methodology-report',
      type: 'markdown',
      title: 'Methodology report',
      dataRef: '.sciforge/task-results/methodology-report.md',
    }],
    executionUnits: [{
      id: 'methodology-review',
      status: 'done',
      tool: 'workspace-task',
      outputRef: '.sciforge/task-results/methodology-report.md',
    }],
    displayIntent: {
      taskOutcome: 'satisfied',
      verificationStatus: {
        response: 'Verification: 未验证',
      },
      resultPresentation: createResultPresentationContract({
        id: 'methodology-review-presentation',
        status: 'complete',
        answerBlocks: [{ id: 'answer', kind: 'paragraph', text: 'P5 methodology review is complete.', citationIds: ['artifact-report'] }],
        keyFindings: [{
          id: 'review-ready',
          text: 'A methodology report was generated.',
          verificationState: 'supported',
          citationIds: ['artifact-report'],
        }],
        inlineCitations: [{ id: 'artifact-report', label: 'Report', ref: '.sciforge/task-results/methodology-report.md', kind: 'artifact' }],
        artifactActions: [{ id: 'methodology-report', label: 'Report', ref: '.sciforge/task-results/methodology-report.md', action: 'inspect', kind: 'inspect' }],
      }),
    },
  }), {
    request: {
      skillDomain: 'knowledge',
      prompt: 'Create the methodology review, but required verification must pass before you can claim completion.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const proxy = projection?.userSatisfactionProxy as Record<string, any> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, any> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, any> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, any> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;
  const answerBlocks = resultPresentation?.answerBlocks as Array<Record<string, unknown>> | undefined;

  assert.equal(projection?.taskSuccess, false);
  assert.equal(card?.taskOutcome, 'needs-work');
  assert.equal(proxy?.status, 'needs-work');
  assert.equal(visibleAnswer?.status, 'degraded-result');
  assert.match(String(visibleAnswer?.text), /required verification is still unverified/i);
  assert.equal(resultPresentation?.status, 'partial');
  assert.match(String(answerBlocks?.[0]?.text), /Partial result artifacts are available/i);
  assert.doesNotMatch(String(answerBlocks?.[0]?.text), /complete|完成/i);
  assert.match(String(card?.nextStep), /required verifier|human approval/i);
});

test('attachResultPresentationContract recomputes stale needs-work projection when current presentation completes the request', () => {
  const request = {
    skillDomain: 'literature' as const,
    prompt: 'Create a concise memo artifact.',
    artifacts: [],
  };
  const stale = attachResultPresentationContract(payload({
    message: 'Memo is ready.',
    artifacts: [],
    executionUnits: [{ id: 'generate-memo', status: 'done', tool: 'workspace-task' }],
  }), { request });
  const staleProjection = stale.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  assert.equal(staleProjection?.taskSuccess, false);
  const completePresentation = createResultPresentationContract({
    id: 'memo-complete-presentation',
    status: 'complete',
    answerBlocks: [{ id: 'answer', kind: 'paragraph', text: 'Memo is ready.', citationIds: ['artifact-memo'] }],
    keyFindings: [{
      id: 'memo-ready',
      text: 'Memo is ready.',
      verificationState: 'supported',
      citationIds: ['artifact-memo'],
    }],
    inlineCitations: [{ id: 'artifact-memo', label: 'Memo', ref: '.sciforge/task-results/memo.md', kind: 'artifact', source: 'artifact' }],
    artifactActions: [{ id: 'memo', label: 'Memo', ref: '.sciforge/task-results/memo.md', kind: 'inspect', action: 'inspect' }],
    nextActions: [{ id: 'inspect', label: 'Inspect generated artifacts and evidence.', kind: 'inspect' }],
    defaultExpandedSections: ['answer', 'evidence', 'artifacts'],
  });

  const attached = attachResultPresentationContract(payload({
    message: 'Memo is ready.',
    artifacts: [{
      id: 'memo',
      type: 'research-report',
      title: 'Memo',
      dataRef: '.sciforge/task-results/memo.md',
    }],
    executionUnits: [{ id: 'generate-memo', status: 'done', tool: 'workspace-task', outputRef: '.sciforge/task-results/memo.md' }],
    displayIntent: {
      ...stale.displayIntent,
      resultPresentation: completePresentation,
    },
  }), { request });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, unknown> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, unknown> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, unknown> | undefined;

  assert.equal(projection?.taskSuccess, true);
  assert.equal(card?.taskOutcome, 'satisfied');
  assert.equal(visibleAnswer?.status, 'satisfied');
});

test('attachResultPresentationContract attributes transient failure next step to external provider', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'External provider returned 429 Too Many Requests; partial metadata is preserved.',
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime-log',
    artifacts: [{ id: 'partial-metadata', type: 'paper-list', title: 'Partial metadata', dataRef: '.sciforge/task-results/partial.json' }],
    executionUnits: [{
      id: 'provider-fetch',
      status: 'needs-human',
      tool: 'workspace-task',
      stdoutRef: '.sciforge/logs/fetch.stdout.log',
      stderrRef: '.sciforge/logs/fetch.stderr.log',
      externalDependencyStatus: 'transient-unavailable',
      failureReason: 'HTTP 429 Too Many Requests',
      nextStep: 'Retry after provider backoff or continue with cached evidence.',
    }],
  }), {
    request: {
      skillDomain: 'literature',
      prompt: 'Retrieve current papers.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, unknown> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, unknown> | undefined;
  const attribution = projection?.nextStepAttribution as Record<string, unknown> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, unknown> | undefined;
  const visibleAnswer = conversationProjection?.visibleAnswer as Record<string, unknown> | undefined;
  const displayProjection = attached.displayIntent?.conversationProjection as Record<string, unknown> | undefined;
  const failures = card?.failureSignatures as Array<Record<string, unknown>> | undefined;
  const suggestions = projection?.ownershipLayerSuggestions as Array<Record<string, unknown>> | undefined;

  assert.equal(card?.taskOutcome, 'needs-human');
  assert.equal(card?.status, 'needs-human');
  assert.equal(attribution?.ownerLayer, 'external-provider');
  assert.equal(conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  assert.equal(displayProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  assert.equal(visibleAnswer?.status, 'external-blocked');
  assert.equal(failures?.[0]?.kind, 'external-transient');
  assert.ok(suggestions?.some((suggestion) => suggestion.layer === 'external-provider'));
  assert.ok(suggestions?.some((suggestion) => suggestion.layer === 'runtime-server'));
  assert.match(String(attribution?.nextStep), /provider backoff/i);
});

test('attachResultPresentationContract maps failed runs through ConversationProjection recovery state', () => {
  const attached = attachResultPresentationContract(payload({
    message: 'Workspace task failed validation; checkpoint is preserved for repair.',
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime-log',
    executionUnits: [{
      id: 'validate-report',
      status: 'failed-with-reason',
      tool: 'workspace-task',
      outputRef: '.sciforge/task-results/report.json',
      stderrRef: '.sciforge/debug/report.stderr.log',
      failureReason: 'Verifier failed release gate for missing evidence.',
      recoverActions: ['Supplement verifier evidence before presenting as verified.'],
      verificationRef: 'verification:release-gate',
      verificationVerdict: 'fail',
    }],
    verificationResults: [{
      id: 'release-gate',
      verdict: 'fail',
      confidence: 0.8,
      evidenceRefs: ['.sciforge/debug/report.stderr.log'],
      repairHints: ['Supplement verifier evidence before presenting as verified.'],
    }],
    displayIntent: {
      backgroundState: {
        status: 'running',
        checkpointRefs: ['.sciforge/checkpoints/report-repair.json'],
        revisionPlan: 'Repair the missing verifier evidence.',
      },
    },
  }), {
    refs: {
      outputRel: '.sciforge/task-results/report.json',
      stderrRel: '.sciforge/debug/report.stderr.log',
    },
    request: {
      skillDomain: 'knowledge',
      prompt: 'Produce and verify a report.',
      artifacts: [],
    },
  });

  const projection = attached.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const card = attached.displayIntent?.taskRunCard as Record<string, any> | undefined;
  const conversationProjection = projection?.conversationProjection as Record<string, any> | undefined;
  const summary = card?.conversationProjectionSummary as Record<string, any> | undefined;
  const resultPresentation = attached.displayIntent?.resultPresentation as Record<string, any> | undefined;

  assert.equal(conversationProjection?.schemaVersion, 'sciforge.conversation-projection.v1');
  assert.equal(conversationProjection?.verificationState?.status, 'failed');
  assert.equal(conversationProjection?.backgroundState?.status, 'running');
  assert.ok(conversationProjection?.recoverActions?.some((action: string) => /verifier evidence/i.test(action)));
  assert.equal(summary?.failureOwner?.ownerLayer, 'verification');
  assert.equal(summary?.verificationState?.status, 'failed');
  assert.equal(summary?.backgroundState?.status, 'running');
  assert.equal(card?.conversationProjectionRef, '.sciforge/task-results/report.json#displayIntent.conversationProjection');
  assert.equal(resultPresentation?.conversationProjectionSummary?.failureOwner?.ownerLayer, 'verification');
});

test('attachResultPresentationContract restores ConversationProjection from persisted event log', () => {
  const first = attachResultPresentationContract(payload({
    message: 'Search completed and a compact table is available.',
    artifacts: [{ id: 'paper-table', type: 'data-table', title: 'Paper table', dataRef: '.sciforge/task-results/table.json' }],
    executionUnits: [{ id: 'search', status: 'done', tool: 'workspace-task', nextStep: 'Generate the requested report from preserved table refs.' }],
  }), {
    refs: {
      outputRel: '.sciforge/task-results/search-output.json',
    },
    request: {
      skillDomain: 'literature',
      prompt: 'Find papers and produce a research-report artifact.',
      expectedArtifactTypes: ['research-report'],
      artifacts: [],
    },
  });

  const firstOutcome = first.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  assert.equal(firstOutcome?.conversationEventLog?.schemaVersion, 'sciforge.conversation-event-log.v1');
  assert.match(String(firstOutcome?.conversationEventLogDigest), /^sha256:/);
  assert.equal(firstOutcome?.conversationEventLogRef, '.sciforge/task-results/search-output.json#displayIntent.conversationEventLog');
  assert.equal(firstOutcome?.projectionRestore?.source, 'conversation-event-log');

  const polluted = JSON.parse(JSON.stringify(first)) as ToolPayload & { displayIntent: Record<string, any> };
  polluted.displayIntent.conversationProjection.visibleAnswer.status = 'satisfied';
  polluted.displayIntent.taskOutcomeProjection.conversationProjection.visibleAnswer.status = 'satisfied';
  polluted.displayIntent.taskRunCard.conversationProjectionSummary.status = 'satisfied';

  const restored = attachResultPresentationContract(polluted, {
    refs: {
      outputRel: '.sciforge/task-results/search-output.json',
    },
  });
  const restoredOutcome = restored.displayIntent?.taskOutcomeProjection as Record<string, any> | undefined;
  const restoredDisplayProjection = restored.displayIntent?.conversationProjection as Record<string, any> | undefined;
  const restoredCard = restored.displayIntent?.taskRunCard as Record<string, any> | undefined;

  assert.equal(restoredOutcome?.conversationProjection?.visibleAnswer?.status, 'degraded-result');
  assert.equal(restoredDisplayProjection?.visibleAnswer?.status, 'degraded-result');
  assert.equal(restoredCard?.conversationProjectionSummary?.status, 'degraded-result');
  assert.equal(restoredOutcome?.conversationEventLogDigest, firstOutcome?.conversationEventLogDigest);
  assert.equal(restoredOutcome?.projectionRestore?.eventCount, firstOutcome?.conversationEventLog?.events?.length);
});
