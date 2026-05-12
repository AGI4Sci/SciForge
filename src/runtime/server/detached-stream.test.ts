import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import test from 'node:test';
import { createDetachedStreamResponse } from './detached-stream.js';

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];

  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }

  end() {
    this.writableEnded = true;
  }
}

function fakeResponse() {
  return new FakeResponse() as unknown as ServerResponse & FakeResponse;
}

test('passive client close detaches the stream without aborting runtime work', () => {
  const res = fakeResponse();
  const stream = createDetachedStreamResponse(res);

  assert.equal(stream.write({ event: { type: 'started' } }), true);
  res.emit('close');

  assert.equal(stream.clientConnected, false);
  assert.equal(stream.signal.aborted, false);
  assert.equal(stream.write({ event: { type: 'still-running' } }), false);
  stream.end();
  assert.equal(res.writableEnded, true);
  assert.equal(res.writes.length, 1);
});

test('explicit abort remains available for user-initiated cancellation', () => {
  const stream = createDetachedStreamResponse(fakeResponse());

  stream.abort('user cancelled');

  assert.equal(stream.signal.aborted, true);
});
