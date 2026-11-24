import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_UPSTREAM_RETRY_POLICY,
  isRetryableUpstreamFailureCode,
  parseRetryAfterMs,
  planUpstreamRetry,
  resolveUpstreamRetryPolicy,
  sleepWithAbort,
} from './upstream-retry';

test('classifies only transient upstream failures as retryable', () => {
  for (const code of [
    'upstream_timeout',
    'upstream_network_error',
    'upstream_http_408',
    'upstream_http_425',
    'upstream_http_429',
    'upstream_http_500',
    'upstream_http_502',
    'upstream_http_503',
    'upstream_http_504',
  ]) {
    assert.equal(isRetryableUpstreamFailureCode(code), true, `${code} must be retryable`);
  }

  // Contract, auth, quota, and capability failures never become transient by retrying.
  for (const code of [
    'upstream_http_400',
    'upstream_http_401',
    'upstream_http_402',
    'upstream_http_403',
    'upstream_http_404',
    'upstream_http_422',
    'upstream_invalid_response',
    'upstream_error_payload',
    'upstream_protocol_unsupported',
    'upstream_protocol_capability_unsupported',
    'structured_output_invalid',
    'unsupported_reasoning_effort',
  ]) {
    assert.equal(isRetryableUpstreamFailureCode(code), false, `${code} must not be retryable`);
  }
});

test('parses Retry-After as delta seconds and as an HTTP date', () => {
  const now = Date.parse('2026-11-06T10:00:00Z');
  assert.equal(parseRetryAfterMs('1', now), 1_000);
  assert.equal(parseRetryAfterMs(' 30 ', now), 30_000);
  assert.equal(parseRetryAfterMs('Fri, 06 Nov 2026 10:00:05 GMT', now), 5_000);
  // A date in the past means "retry now", never a negative delay.
  assert.equal(parseRetryAfterMs('Fri, 06 Nov 2026 09:59:00 GMT', now), 0);
  assert.equal(parseRetryAfterMs(undefined, now), undefined);
  assert.equal(parseRetryAfterMs('', now), undefined);
  assert.equal(parseRetryAfterMs('soon', now), undefined);
});

test('backoff doubles from the base delay and is bounded by the cap', () => {
  // A generous attempt budget isolates the delay curve from attempt exhaustion,
  // which the dedicated policy test covers separately.
  const policy = resolveUpstreamRetryPolicy({ baseDelayMs: 500, maxDelayMs: 2_000, maxAttempts: 12 });
  const plan = (retryNumber: number, random: number) => planUpstreamRetry({
    retryNumber,
    policy,
    nowMs: 0,
    deadlineMs: 1_000_000,
    random: () => random,
  });

  // Equal jitter: the delay sits between 50% and 100% of the exponential value.
  assert.deepEqual(plan(1, 0), { retry: true, delayMs: 250 });
  assert.deepEqual(plan(1, 1), { retry: true, delayMs: 500 });
  assert.deepEqual(plan(2, 1), { retry: true, delayMs: 1_000 });
  assert.deepEqual(plan(3, 1), { retry: true, delayMs: 2_000 });
  // The cap keeps later retries bounded instead of growing without limit.
  assert.deepEqual(plan(9, 1), { retry: true, delayMs: 2_000 });
});

test('a Retry-After value replaces the exponential delay and is capped', () => {
  const policy = resolveUpstreamRetryPolicy({ baseDelayMs: 500, maxDelayMs: 8_000, maxRetryAfterMs: 10_000 });
  assert.deepEqual(planUpstreamRetry({
    retryNumber: 1, policy, nowMs: 0, deadlineMs: 1_000_000, retryAfterMs: 3_000, random: () => 0,
  }), { retry: true, delayMs: 3_000 });
  // Above maxRetryAfterMs the server's pacing is clamped, never ignored upward.
  assert.deepEqual(planUpstreamRetry({
    retryNumber: 1, policy, nowMs: 0, deadlineMs: 1_000_000, retryAfterMs: 120_000, random: () => 0,
  }), { retry: true, delayMs: 10_000 });
});

test('stops retrying when attempts, the deadline, or Retry-After demand it', () => {
  const policy = DEFAULT_UPSTREAM_RETRY_POLICY;
  assert.deepEqual(planUpstreamRetry({
    retryNumber: policy.maxAttempts, policy, nowMs: 0, deadlineMs: 1_000_000,
  }), { retry: false, reason: 'attempts-exhausted' });
  assert.deepEqual(planUpstreamRetry({
    retryNumber: 1, policy, nowMs: 5_000, deadlineMs: 5_000,
  }), { retry: false, reason: 'deadline-exceeded' });
  // Waiting as long as the upstream asks would exceed the remaining budget.
  assert.deepEqual(planUpstreamRetry({
    retryNumber: 1, policy, nowMs: 0, deadlineMs: 2_000, retryAfterMs: 30_000,
  }), { retry: false, reason: 'retry-after-exceeded' });
  // The exponential delay itself is clamped to the remaining budget.
  assert.deepEqual(planUpstreamRetry({
    retryNumber: 2, policy: resolveUpstreamRetryPolicy({ baseDelayMs: 8_000, maxDelayMs: 8_000 }),
    nowMs: 0, deadlineMs: 3_000, random: () => 1,
  }), { retry: true, delayMs: 3_000 });
});

test('resolveUpstreamRetryPolicy keeps documented defaults and rejects impossible overrides', () => {
  assert.deepEqual(resolveUpstreamRetryPolicy(), DEFAULT_UPSTREAM_RETRY_POLICY);
  assert.equal(DEFAULT_UPSTREAM_RETRY_POLICY.maxAttempts, 3);
  const resolved = resolveUpstreamRetryPolicy({ maxAttempts: 0, baseDelayMs: -1, retryBudgetMs: 1_000 });
  assert.equal(resolved.maxAttempts, DEFAULT_UPSTREAM_RETRY_POLICY.maxAttempts);
  assert.equal(resolved.baseDelayMs, DEFAULT_UPSTREAM_RETRY_POLICY.baseDelayMs);
  assert.equal(resolved.retryBudgetMs, 1_000);
});

test('the abort-aware delay resolves immediately on an already-aborted signal', async () => {
  const controller = new AbortController();
  controller.abort();
  const startedAt = Date.now();
  await sleepWithAbort(60_000, controller.signal);
  assert.ok(Date.now() - startedAt < 1_000);
});
