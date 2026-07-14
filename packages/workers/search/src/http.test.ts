import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchJson, fetchText } from './http.js';

describe('search HTTP cancellation', () => {
  it('does not call fetchText network code for an already-aborted signal', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('should not be reached');
    };
    const controller = new AbortController();
    controller.abort(new Error('cancelled before fetchText'));
    try {
      await assert.rejects(
        fetchText('https://example.test', 1_000, controller.signal, {}),
        /cancelled before fetchText/
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not call fetchJson network code for an already-aborted signal', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    };
    const controller = new AbortController();
    controller.abort(new Error('cancelled before fetchJson'));
    try {
      await assert.rejects(
        fetchJson('https://example.test', 1_000, controller.signal, {}),
        /cancelled before fetchJson/
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
