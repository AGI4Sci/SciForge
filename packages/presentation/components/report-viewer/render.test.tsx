import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { manifest } from './manifest';
import { basicReportViewerFixture, emptyReportViewerFixture } from './fixtures/basic';
import { coerceReportPayload, renderReportViewer } from './render';

test('report-viewer package exposes manifest and renders markdown payloads', () => {
  assert.equal(manifest.componentId, 'report-viewer');
  const html = renderToStaticMarkup(React.createElement(renderReportViewer, {
    ...basicReportViewerFixture,
    helpers: {
      MarkdownBlock: ({ markdown }) => <article>{markdown}</article>,
    },
  }));
  assert.match(html, /Literature Report/);
});

test('report-viewer package renders empty state through shell helper', () => {
  const html = renderToStaticMarkup(React.createElement(renderReportViewer, {
    ...emptyReportViewerFixture,
    helpers: {
      ComponentEmptyState: ({ componentId }) => <p>empty {componentId}</p>,
    },
  }));
  assert.match(html, /empty report-viewer/);
});

test('coerceReportPayload extracts markdown refs from backend payload text', () => {
  const report = coerceReportPayload({
    markdown: '```json\n{"artifacts":[{"id":"research-report","type":"research-report","data":{"markdownRef":".sciforge/run/report.md"}}]}\n```',
  });
  assert.equal(report.reportRef, '.sciforge/run/report.md');
  assert.match(report.markdown ?? '', /Markdown report/);
});
