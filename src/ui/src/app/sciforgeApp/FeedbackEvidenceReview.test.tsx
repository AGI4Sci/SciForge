import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedbackEvidenceReview, feedbackEvidenceSummary } from './FeedbackEvidenceReview';
import type { FeedbackCommentRecord, SciForgeConfig } from '../../domain';

test('feedback evidence summary falls back to durable refs and runtime target snapshots', () => {
  const summary = feedbackEvidenceSummary(feedbackComment({
    rawScreenshotRef: '.sciforge/feedback/feedback-1/raw.data-url',
    annotatedScreenshotRef: '.sciforge/feedback/feedback-1/annotated.data-url',
    evidenceAssets: [{
      schemaVersion: 1,
      id: 'asset-public-annotated',
      kind: 'scrubbed-annotated-screenshot',
      label: 'Scrubbed annotated screenshot',
      ref: 'repair-evidence/public/feedback-1.png',
      mediaType: 'image/png',
      uploadStatus: 'uploaded',
      visibility: 'public',
      createdAt: '2026-05-29T00:00:00.000Z',
    }],
  }));

  assert.equal(summary.status, 'complete');
  assert.equal(summary.ready, 5);
  assert.deepEqual(summary.checks.map((check) => [check.label, check.ok]), [
    ['raw screenshot', true],
    ['annotated screenshot', true],
    ['target snapshot', true],
    ['runtime snapshot', true],
    ['scrubbed', true],
  ]);
});

test('feedback evidence summary preserves explicit incomplete diagnostics', () => {
  const summary = feedbackEvidenceSummary(feedbackComment({
    rawScreenshotRef: undefined,
    annotatedScreenshotRef: undefined,
    screenshotRef: undefined,
    evidenceStatus: {
      status: 'partial',
      rawScreenshot: false,
      annotatedScreenshot: false,
      targetSnapshot: true,
      runtimeSnapshot: true,
      scrubbed: false,
      diagnostics: ['annotated screenshot missing'],
    },
  }));

  assert.equal(summary.status, 'partial');
  assert.equal(summary.ready, 2);
  assert.deepEqual(summary.diagnostics, ['annotated screenshot missing']);
});

test('feedback evidence review renders the user comment and expected/actual context', () => {
  const html = renderToStaticMarkup(
    <FeedbackEvidenceReview
      item={feedbackComment({
        comment: 'Legend overlaps the export button.',
        expectedBehavior: 'Legend stays below the toolbar.',
        actualBehavior: 'Legend covers the button.',
      })}
      config={feedbackConfig()}
    />,
  );

  assert.match(html, /截图证据、用户评论和期望实际/);
  assert.match(html, /Legend overlaps the export button/);
  assert.match(html, /Legend stays below the toolbar/);
  assert.match(html, /Legend covers the button/);
  assert.match(html, /\/chart/);
  assert.match(html, /\[data-testid=&quot;legend&quot;\]/);
});

function feedbackComment(overrides: Partial<FeedbackCommentRecord> = {}): FeedbackCommentRecord {
  return {
    schemaVersion: 1,
    id: 'feedback-1',
    authorId: 'tester',
    authorName: 'Tester',
    comment: 'Runtime repair should include evidence.',
    status: 'open',
    priority: 'normal',
    tags: ['feedback'],
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    target: {
      selector: '[data-testid="legend"]',
      path: 'body > main > svg',
      text: 'Legend',
      tagName: 'g',
      rect: { x: 10, y: 20, width: 120, height: 40 },
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    runtime: { page: '/chart', url: 'http://127.0.0.1:5173/chart', scenarioId: 'default', sessionId: 'session-1' },
    screenshotRef: '.sciforge/feedback/feedback-1/comment.json',
    evidenceBundleRef: '.sciforge/feedback/feedback-1',
    ...overrides,
  };
}

function feedbackConfig(): SciForgeConfig {
  return {
    workspacePath: '/tmp/sciforge',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
  } as SciForgeConfig;
}
