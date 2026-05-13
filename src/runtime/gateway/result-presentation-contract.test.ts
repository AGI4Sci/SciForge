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
  const failures = card?.failureSignatures as Array<Record<string, unknown>> | undefined;
  const suggestions = projection?.ownershipLayerSuggestions as Array<Record<string, unknown>> | undefined;

  assert.equal(card?.taskOutcome, 'needs-human');
  assert.equal(card?.status, 'needs-human');
  assert.equal(attribution?.ownerLayer, 'external-provider');
  assert.equal(failures?.[0]?.kind, 'external-transient');
  assert.ok(suggestions?.some((suggestion) => suggestion.layer === 'external-provider'));
  assert.ok(suggestions?.some((suggestion) => suggestion.layer === 'runtime-server'));
  assert.match(String(attribution?.nextStep), /provider backoff/i);
});
