import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference } from '../../domain';
import { WorkspaceFileInlineViewer } from './workspaceFileInlineViewer';

test('workspace file inline viewer upgrades markdown refs without owning workspace IO', () => {
  const reportRef: ObjectReference = {
    id: 'obj-report-file',
    kind: 'file',
    title: 'Generated report',
    ref: 'file:reports/generated-report.md',
    status: 'available',
    provenance: { path: 'reports/generated-report.md' },
  };
  const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
    file: {
      path: 'reports/generated-report.md',
      name: 'generated-report.md',
      content: 'Open `generated-report.md` and keep `missing-report.md` literal.',
      size: 72,
      language: 'markdown',
      encoding: 'utf8',
      mimeType: 'text/markdown',
    },
    objectReferences: [reportRef],
    onObjectReferenceFocus: () => undefined,
  }));

  assert.equal((html.match(/data-sciforge-reference=/g) ?? []).length, 1);
  assert.match(html, /markdown-object-ref/);
  assert.match(html, /Generated report/);
  assert.match(html, /<code>missing-report\.md<\/code>/);
});

test('workspace file inline viewer redacts structured JSON and bounded diff previews', () => {
  const jsonHtml = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
    file: {
      path: 'reports/provider-output.json',
      name: 'provider-output.json',
      content: JSON.stringify({
        authorization: 'Bearer sk-json-secret-1234567890',
        endpoint: 'https://provider.example.test/v1?api_key=abc123',
        rawProviderPayload: { body: 'RAW_PROVIDER_BODY_SHOULD_NOT_RENDER' },
        artifactRef: 'artifact:safe-table',
        text: 'x'.repeat(13_000),
      }),
      size: 13_400,
      language: 'json',
      encoding: 'utf8',
      mimeType: 'application/json',
    },
  }));
  const diffHtml = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
    file: {
      path: 'patches/fix.patch',
      name: 'fix.patch',
      content: [
        '--- /tmp/private/old.ts',
        '+++ src/app.ts',
        '@@ -1 +1 @@',
        '-const token = sk-diff-secret-1234567890;',
        '+const token = "ok";',
        '.sciforge/audit/raw-output.json',
      ].join('\n'),
      size: 180,
      language: 'patch',
      encoding: 'utf8',
      mimeType: 'text/x-patch',
    },
  }));

  assert.doesNotMatch(jsonHtml, /sk-json-secret|provider\.example|api_key=abc123|RAW_PROVIDER_BODY/);
  assert.match(jsonHtml, /redacted-secret|redacted-url|right-pane-sensitive-object|preview truncated/);
  assert.match(jsonHtml, /artifact:safe-table/);
  assert.match(diffHtml, /workspace-object-diff/);
  assert.match(diffHtml, /@@ -1 \+1 @@/);
  assert.doesNotMatch(diffHtml, /\/tmp\/private|sk-diff-secret|\.sciforge\/audit\/raw-output/);
});

test('workspace file inline viewer renders bounded tabular previews', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
    file: {
      path: 'tables/results.csv',
      name: 'results.csv',
      content: [
        'Paper,Status,Score',
        'A,read,0.9',
        'B,queued,0.4',
      ].join('\n'),
      size: 48,
      language: 'csv',
      encoding: 'utf8',
      mimeType: 'text/csv',
    },
  }));

  assert.match(html, /data-preview-table/);
  assert.match(html, /<th>Paper<\/th>/);
  assert.match(html, /<td>read<\/td>/);
});

test('workspace file inline viewer keeps workspace image and PDF binaries ref-first', () => {
  const cases = [{
    label: 'image',
    file: {
      path: 'figures/provider-plot.png',
      name: 'provider-plot.png',
      content: 'aW1hZ2UtYmluYXJ5',
      size: 16,
      language: 'image',
      encoding: 'base64' as const,
      mimeType: 'image/png',
    },
    expectedCopy: /Copy image reference/,
    forbidden: /data:image|<img\b|aW1hZ2UtYmluYXJ5/i,
  }, {
    label: 'pdf',
    file: {
      path: 'papers/provider-paper.pdf',
      name: 'provider-paper.pdf',
      content: 'JVBERi0xLjQKc2VjcmV0',
      size: 20,
      language: 'pdf',
      encoding: 'base64' as const,
      mimeType: 'application/pdf',
    },
    expectedCopy: /Copy PDF reference/,
    forbidden: /data:application\/pdf|<object\b|<iframe\b|JVBERi0xLjQKc2VjcmV0/i,
  }];

  for (const { label, file, expectedCopy, forbidden } of cases) {
    const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, { file }));

    assert.match(html, /data-sciforge-reference=/, label);
    assert.match(html, new RegExp(file.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), label);
    assert.match(html, expectedCopy, label);
    assert.doesNotMatch(html, forbidden, label);
  }
});

test('workspace file inline viewer renders office files as context notices', () => {
  const html = renderToStaticMarkup(createElement(WorkspaceFileInlineViewer, {
    file: {
      path: 'slides/deck.pptx',
      name: 'deck.pptx',
      content: 'BINARY_OFFICE_BYTES_SHOULD_NOT_RENDER',
      size: 64,
      language: 'presentation',
      encoding: 'base64',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
  }));

  assert.match(html, /Presentation file is attached/);
  assert.match(html, /slides\/deck\.pptx/);
  assert.match(html, /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/);
  assert.doesNotMatch(html, /BINARY_OFFICE_BYTES_SHOULD_NOT_RENDER/);
});

test('workspace file inline viewer owns file content presentation extracted from WorkspaceObjectPreview', () => {
  const componentSource = readFileSync(new URL('./WorkspaceObjectPreview.tsx', import.meta.url), 'utf8');
  const helperSource = readFileSync(new URL('./workspaceFileInlineViewer.tsx', import.meta.url), 'utf8');

  assert.match(componentSource, /workspaceFileInlineViewer/);
  assert.doesNotMatch(componentSource, /function WorkspaceFileInlineViewer|DelimitedTextPreview|formatJsonLike|officePreviewLabel|referenceForWorkspaceFile/);
  assert.match(helperSource, /function WorkspaceFileInlineViewer/);
  assert.match(helperSource, /WorkspaceFileMediaReferenceNotice/);
  assert.doesNotMatch(helperSource, /readWorkspaceFile|readPreviewDescriptor|readPreviewDerivative|UserActionApi|ArtifactPreviewHydrationApi|navigator\.clipboard/);
});
