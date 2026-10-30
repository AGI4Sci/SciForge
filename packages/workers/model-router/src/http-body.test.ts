import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { IncomingMessage } from 'node:http';

import { RequestBodyTooLargeError, readIncomingMessageBody } from './http-body';

test('readIncomingMessageBody rejects declared bodies over the limit', async () => {
  const request = Readable.from([Buffer.from('{}')]) as IncomingMessage;
  request.headers = { 'content-length': '12' };

  await assert.rejects(
    readIncomingMessageBody(request, 4),
    (error) => error instanceof RequestBodyTooLargeError && error.status === 413,
  );
});

test('readIncomingMessageBody rejects streamed bodies over the limit', async () => {
  const request = Readable.from([Buffer.from('abc'), Buffer.from('def')]) as IncomingMessage;
  request.headers = {};

  await assert.rejects(
    readIncomingMessageBody(request, 4),
    (error) => error instanceof RequestBodyTooLargeError && error.status === 413,
  );
});

test('readIncomingMessageBody returns text for bodies within the limit', async () => {
  const request = Readable.from([Buffer.from('{"ok":true}')]) as IncomingMessage;
  request.headers = {};

  await assert.doesNotReject(async () => {
    assert.equal(await readIncomingMessageBody(request, 32), '{"ok":true}');
  });
});
