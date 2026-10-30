import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDelegatedCredentialProvider,
} from './credential';

const context = (authorization?: string) => ({
  adapterId: 'codex',
  upstreamOrigin: 'https://chatgpt.com',
  incomingHeaders: new Headers(authorization ? { authorization } : {}),
  signal: new AbortController().signal,
});

test('delegated credentials use the caller bearer token and never replace it', async () => {
  const provider = createDelegatedCredentialProvider();
  assert.equal(
    await provider.getBearerToken(context('Bearer caller-subscription-token')),
    'caller-subscription-token',
  );
});

test('delegated credentials fail closed when the caller does not provide a bearer token', async () => {
  const provider = createDelegatedCredentialProvider();
  await assert.rejects(
    provider.getBearerToken(context()),
    (error: unknown) => error instanceof Error &&
      'status' in error && error.status === 401 &&
      'code' in error && error.code === 'PLAN_AUTH_REQUIRED',
  );
  await assert.rejects(
    provider.getBearerToken(context('Basic caller-secret')),
    /Coding-plan authentication must be supplied by the calling runtime/,
  );
});
