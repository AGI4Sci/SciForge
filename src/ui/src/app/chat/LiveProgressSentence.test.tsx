import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveProgressSentence } from './LiveProgressSentence';

test('live progress sentence renders one aria-live status line instead of markdown answer prose', () => {
  const html = renderToStaticMarkup(createElement(LiveProgressSentence, {
    assistantDraft: 'FINAL_ANSWER_SHOULD_WAIT_UNTIL_COMPLETION',
    events: [{
      id: 'evt-live-read',
      type: 'tool-call',
      label: 'Tool call',
      detail: 'reading',
      createdAt: '2026-06-01T00:00:00.000Z',
      raw: {
        native: {
          rawType: 'tool_started',
          toolName: 'read_file',
          status: 'running',
          filePath: 'PROJECT_middle.md',
        },
      },
    }],
  }));

  assert.match(html, /class="live-progress-sentence"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Reading PROJECT_middle\.md/);
  assert.doesNotMatch(html, /FINAL_ANSWER_SHOULD_WAIT_UNTIL_COMPLETION|message-markdown|<p>/);
});
