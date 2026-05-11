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
