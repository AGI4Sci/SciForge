import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeedbackCodexPtyClientMessage, ptyDimension } from './workspace-server-feedback-terminal-protocol.js';

test('parseFeedbackCodexPtyClientMessage preserves input payload shape', () => {
  assert.deepEqual(parseFeedbackCodexPtyClientMessage(JSON.stringify({
    type: 'input',
    data: 'npm test\n',
  })), {
    type: 'input',
    data: 'npm test\n',
  });

  assert.deepEqual(parseFeedbackCodexPtyClientMessage(JSON.stringify({ type: 'input', data: 42 })), {
    type: 'input',
    data: '',
  });
});

test('parseFeedbackCodexPtyClientMessage clamps resize dimensions like the inline parser', () => {
  assert.deepEqual(parseFeedbackCodexPtyClientMessage(JSON.stringify({
    type: 'resize',
    cols: '999.7',
    rows: 3,
  })), {
    type: 'resize',
    cols: 240,
    rows: 12,
  });

  assert.deepEqual(parseFeedbackCodexPtyClientMessage(JSON.stringify({
    type: 'resize',
    cols: 'wide',
    rows: undefined,
  })), {
    type: 'resize',
    cols: 110,
    rows: 28,
  });
});

test('parseFeedbackCodexPtyClientMessage handles stop and rejects malformed messages', () => {
  assert.deepEqual(parseFeedbackCodexPtyClientMessage(JSON.stringify({ type: 'stop' })), { type: 'stop' });
  assert.equal(parseFeedbackCodexPtyClientMessage('not-json'), undefined);
  assert.equal(parseFeedbackCodexPtyClientMessage(JSON.stringify({ type: 'unknown' })), undefined);
  assert.equal(parseFeedbackCodexPtyClientMessage(JSON.stringify(['resize'])), undefined);
});

test('ptyDimension floors finite values and preserves fallback for non-finite values', () => {
  assert.equal(ptyDimension(120.9, 110, 40, 240), 120);
  assert.equal(ptyDimension('35', 28, 12, 80), 35);
  assert.equal(ptyDimension(Number.POSITIVE_INFINITY, 110, 40, 240), 110);
});
