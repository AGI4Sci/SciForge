import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionBundleRel, sessionBundleRelForRequest, sessionBundleResourceRel } from './session-bundle.js';
import type { GatewayRequest } from './runtime-types.js';

test('session bundle paths include date, scenario, and session id', () => {
  assert.equal(
    sessionBundleRel({
      sessionId: 'session-workspace-literature-moqv3d2m',
      scenarioId: 'literature/evidence review',
      createdAt: '2026-05-11T04:00:00.000Z',
    }),
    '.sciforge/sessions/2026-05-11_literature_evidence_review_session-workspace-literature-moqv3d2m',
  );
});

test('request session bundle paths are resource roots for generated work', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Find papers',
    artifacts: [],
    uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-10T23:00:00.000Z' },
  };
  const bundle = sessionBundleRelForRequest(request, new Date('2026-05-11T08:00:00.000Z'));

  assert.equal(bundle, '.sciforge/sessions/2026-05-10_literature_session-1');
  assert.equal(
    sessionBundleResourceRel(bundle, 'task-results', 'generated-demo.json'),
    '.sciforge/sessions/2026-05-10_literature_session-1/task-results/generated-demo.json',
  );
});
