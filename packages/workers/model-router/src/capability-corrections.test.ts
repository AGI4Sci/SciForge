import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPABILITY_CORRECTION_MAX_ENTRIES,
  CAPABILITY_CORRECTION_TTL_MS,
  CapabilityCorrections,
  reasoningLevelRejectionEvidence,
} from './capability-corrections';

const query = {
  model: 'text-model',
  baseUrl: 'https://Models.Example/v1/',
  protocol: 'Responses',
  level: 'Max',
};

test('only explicit reasoning-level rejections count as evidence', () => {
  assert.match(
    reasoningLevelRejectionEvidence({
      status: 400,
      body: '{"error":{"message":"Unsupported reasoning effort \\"max\\" for this model"}}',
      requestedEffort: 'max',
    }) ?? '',
    /Explicitly|explicitly rejected reasoning level "max"/u,
  );
  assert.equal(
    reasoningLevelRejectionEvidence({ status: 422, body: '{"error":"不支持的思考档位"}', requestedEffort: 'high' }),
    'Upstream rejected the request citing an unsupported reasoning level.',
  );
  // Auth failures, rate limits, timeouts, and unrelated bodies are not capability changes.
  assert.equal(reasoningLevelRejectionEvidence({ status: 401, body: 'Unauthorized', requestedEffort: 'max' }), null);
  assert.equal(reasoningLevelRejectionEvidence({ status: 429, body: 'rate limit exceeded', requestedEffort: 'max' }), null);
  assert.equal(reasoningLevelRejectionEvidence({ status: 500, body: 'unsupported reasoning effort', requestedEffort: 'max' }), null);
  assert.equal(reasoningLevelRejectionEvidence({ status: 400, body: 'Bad request: missing field', requestedEffort: 'max' }), null);
  // Without an explicit level there is nothing to correct.
  assert.equal(reasoningLevelRejectionEvidence({ status: 400, body: 'Unsupported reasoning effort "max"', requestedEffort: '' }), null);
});

test('records, expires, clears, and caps negative results', () => {
  let now = 1_000;
  const corrections = new CapabilityCorrections({ now: () => now, ttlMs: 60_000 });
  const recorded = corrections.record(query, { reason: 'evidence', upstreamStatus: 400 });
  assert.equal(recorded.expiresAt, 61_000);
  assert.equal(corrections.negative(query)?.reason, 'evidence');
  // Keys normalize case and endpoint slashes so the same target stays one key.
  assert.ok(
    corrections.negative({
      model: 'TEXT-MODEL',
      baseUrl: 'https://models.example/v1',
      protocol: 'responses',
      level: 'max',
    }),
  );

  // TTL expiry drops the entry (recovery path #1).
  now = 61_000;
  assert.equal(corrections.negative(query), null);
  assert.equal(corrections.list().length, 0);

  // Explicit clear (recovery path #2 — used when a success observes the level again).
  corrections.record(query, { reason: 'evidence', upstreamStatus: 400 });
  assert.equal(corrections.clear(query), true);
  assert.equal(corrections.negative(query), null);

  // Capacity is bounded; the oldest entries are evicted first.
  for (let index = 0; index < CAPABILITY_CORRECTION_MAX_ENTRIES + 8; index += 1) {
    corrections.record({ ...query, level: `level-${index}` }, { reason: 'evidence', upstreamStatus: 400 });
  }
  assert.equal(corrections.list().length, CAPABILITY_CORRECTION_MAX_ENTRIES);
  assert.equal(corrections.negative({ ...query, level: 'level-0' }), null);
  assert.ok(corrections.negative({ ...query, level: `level-${CAPABILITY_CORRECTION_MAX_ENTRIES + 7}` }));
});

test('default TTL is the design 24h window', () => {
  const corrections = new CapabilityCorrections();
  assert.equal(corrections.ttlMs(), CAPABILITY_CORRECTION_TTL_MS);
});