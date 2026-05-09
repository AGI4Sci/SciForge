import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SUPPORTED_RUNTIME_AGENT_BACKENDS } from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { normalizeAgentBackend } from './runtimeConfig';

describe('agent client runtime config', () => {
  it('normalizes supported agent backends from the runtime contract policy', () => {
    for (const backend of SUPPORTED_RUNTIME_AGENT_BACKENDS) {
      assert.equal(normalizeAgentBackend(` ${backend} `), backend);
    }
  });

  it('falls back to the compatible default backend for unknown values', () => {
    assert.equal(normalizeAgentBackend('not-a-runtime-backend'), 'codex');
  });
});
