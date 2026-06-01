import assert from 'node:assert/strict';
import test from 'node:test';

import type { SciForgeMessage } from '../../domain';
import { buildChatPanelActions, buildCopyMessagesText, buildCopyRequestIdText } from './chatPanelActions';

test('chat panel actions expose Cursor-like order, effects, shortcuts, and command boundaries', () => {
  const actions = buildChatPanelActions({
    canArchive: true,
    canCopyMessages: true,
    canCopyRequestId: true,
    canFork: true,
    isSending: false,
  });

  assert.deepEqual(actions.map((action) => action.id), [
    'split-right',
    'split-down',
    'fork-chat',
    'copy-messages',
    'copy-request-id',
    'archive-chat',
  ]);
  assert.equal(actions.find((action) => action.id === 'split-right')?.effect, 'presentation');
  assert.equal(actions.find((action) => action.id === 'fork-chat')?.effect, 'thread-lifecycle');
  assert.equal(actions.find((action) => action.id === 'copy-messages')?.effect, 'clipboard');
  assert.equal(actions.find((action) => action.id === 'split-right')?.shortcut, '⌘D');
  assert.equal(actions.find((action) => action.id === 'archive-chat')?.shortcut, '⇧⌘E');
  for (const action of actions) {
    assert.match(action.commandText, /^\/chat /);
    assert.doesNotMatch(action.commandText, /provider|api.?key|authorization|modelName/i);
  }
});

test('copy messages redacts provider payloads, secrets, and private local paths', () => {
  const messages: SciForgeMessage[] = [
    {
      id: 'msg-user',
      role: 'user',
      content: 'Use /Users/alice/private/config.local.json with api_key=SECRET123',
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'msg-assistant',
      role: 'scenario',
      content: 'providerUrl=https://provider.example/v1 modelName=private-model Authorization: Bearer token123',
      createdAt: '2026-06-01T00:00:01.000Z',
    },
  ];

  const text = buildCopyMessagesText(messages);
  assert.match(text, /User:/);
  assert.match(text, /Assistant:/);
  assert.match(text, /\[local path\]/);
  assert.match(text, /\[redacted\]/);
  assert.doesNotMatch(text, /SECRET123|token123|provider\.example|private-model|\/Users\/alice/);
});

test('copy request id uses only public run or session identifiers', () => {
  assert.equal(buildCopyRequestIdText({ activeRunId: 'run-active', sessionId: 'session-a' }), 'run:run-active');
  assert.equal(buildCopyRequestIdText({ sessionId: 'session-a' }), 'session:session-a');
  assert.equal(buildCopyRequestIdText({ activeRunId: 'run active:bad token', sessionId: 'session-a' }), 'run:runactive:badtoken');
});
