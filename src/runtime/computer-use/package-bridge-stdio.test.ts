import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

import {
  hostPortResultLine,
  isClosedPipeError,
  writeHostPortResult,
} from './package-bridge-stdio.js';

test('package bridge stdio helper formats host port result JSONL', () => {
  const line = hostPortResultLine('capture-1', true, { ref: 'screenshot.png' });
  assert.equal(line.endsWith('\n'), true);

  const message = JSON.parse(line) as Record<string, unknown>;
  assert.equal(message.schemaVersion, 'sciforge.computer-use.host-port-result.v1');
  assert.equal(message.type, 'hostPortResult');
  assert.equal(message.id, 'capture-1');
  assert.equal(message.ok, true);
  assert.deepEqual(message.result, { ref: 'screenshot.png' });
  assert.equal(message.error, undefined);
});

test('package bridge stdio helper writes host port result to child stdin', () => {
  const stdin = new PassThrough();

  writeHostPortResult({ stdin }, 'locate-1', false, undefined, 'grounding failed');

  const line = stdin.read()?.toString('utf8') ?? '';
  const message = JSON.parse(line) as Record<string, unknown>;
  assert.equal(message.id, 'locate-1');
  assert.equal(message.ok, false);
  assert.equal(message.error, 'grounding failed');
});

test('package bridge stdio helper ignores closed child stdin', () => {
  let writes = 0;
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      writes += 1;
      callback();
    },
  });
  stdin.destroy();

  assert.doesNotThrow(() => writeHostPortResult({ stdin }, 'execute-1', true, { ok: true }));
  assert.equal(writes, 0);
});

test('package bridge stdio helper classifies closed pipe errors', () => {
  assert.equal(isClosedPipeError({ code: 'EPIPE' }), true);
  assert.equal(isClosedPipeError({ code: 'ERR_STREAM_DESTROYED' }), true);
  assert.equal(isClosedPipeError({ code: 'ECONNRESET' }), false);
  assert.equal(isClosedPipeError(new Error('plain error')), false);
});
