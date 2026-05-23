import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FeedbackCommentRecord } from '../domain';
import { FeedbackScreenshotPreview } from './FeedbackScreenshotPreview';

const baseItem: FeedbackCommentRecord = {
  id: 'feedback-viewport',
  schemaVersion: 1,
  authorId: 'local-user',
  authorName: 'Local User',
  comment: 'The captured evidence should match the visible page.',
  status: 'open',
  priority: 'normal',
  tags: [],
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
  target: {
    selector: 'button.primary',
    stableSelector: 'button.primary',
    path: 'body > button',
    domPath: 'body > button',
    text: 'Submit',
    textSnippet: 'Submit',
    tagName: 'button',
    role: 'button',
    label: 'Submit',
    ariaLabel: 'Submit',
    rect: { x: 10, y: 20, width: 100, height: 32 },
    commentPoint: { x: 60, y: 36 },
  },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 120 },
  runtime: {
    page: 'workbench',
    url: 'http://127.0.0.1:5173/',
    scenarioId: 'scenario-1',
    sessionId: 'session-1',
  },
  screenshot: {
    schemaVersion: 1,
    captureMode: 'visible-viewport',
    dataUrl: 'data:image/png;base64,abc123',
    rawDataUrl: 'data:image/png;base64,raw123',
    annotatedDataUrl: 'data:image/png;base64,annotated123',
    mediaType: 'image/png',
    width: 1280,
    height: 720,
    capturedAt: '2026-05-23T00:00:00.000Z',
    targetRect: { x: 10, y: 20, width: 100, height: 32 },
    commentPoint: { x: 60, y: 36 },
    scrollX: 0,
    scrollY: 120,
    annotationLabel: '1',
    includeForAgent: false,
    note: 'Visible viewport screenshot captured at 1280x720 CSS px.',
  },
};

test('screenshot preview labels visible viewport evidence honestly', () => {
  const html = renderToStaticMarkup(<FeedbackScreenshotPreview item={baseItem} />);

  assert.match(html, /可见视口截图证据/);
  assert.match(html, /1280x720/);
  assert.doesNotMatch(html, /整页截图证据/);
});
