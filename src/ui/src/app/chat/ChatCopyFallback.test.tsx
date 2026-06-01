import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildChatCopyFallback, ChatCopyFallback } from './ChatCopyFallback';

test('chat copy fallback renders a read-only manual copy surface without private provider copy', () => {
  const fallback = buildChatCopyFallback({
    kind: 'messages',
    title: 'Copy Messages',
    text: 'User: summarize results\n\nAssistant: providerUrl=[redacted] token=[redacted] path=[local path]',
    error: new Error('Copy failed: clipboard access was blocked.'),
  });

  const html = renderToStaticMarkup(React.createElement(ChatCopyFallback, {
    fallback,
    onDismiss: () => undefined,
    onRetry: () => undefined,
  }));

  assert.match(html, /data-chat-copy-fallback="messages"/);
  assert.match(html, /Manual chat copy fallback/);
  assert.match(html, /Copy Messages/);
  assert.match(html, /readOnly/);
  assert.match(html, /Try copy again/);
  assert.match(html, /User: summarize results/);
  assert.match(html, /\[redacted\]/);
  assert.match(html, /\[local path\]/);
  assert.doesNotMatch(html, /private-provider|SECRET|\/Users\/alice|raw provider payload/i);
});
