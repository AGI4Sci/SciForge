import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { SciForgeReference } from '../../domain';
import {
  UploadedDataUrlPreview,
  WorkspaceFileMediaReferenceNotice,
} from './workspaceObjectPreviewMedia';

test('workspace object preview media renders uploaded image references without leaking sensitive titles', () => {
  const html = renderToStaticMarkup(createElement(UploadedDataUrlPreview, {
    kind: 'image',
    dataUrl: 'blob:sciforge-image-preview',
    title: 'Figure Authorization: Bearer sk-image-title-secret',
    mimeType: 'image/png',
    reference: referenceFixture('figure.png', 'file:.sciforge/artifacts/figure.png'),
  }));

  assert.match(html, /workspace-object-image-frame/);
  assert.match(html, /data-sciforge-reference=/);
  assert.match(html, /<img/);
  assert.match(html, /blob:sciforge-image-preview/);
  assert.match(html, /Select region/);
  assert.match(html, /Copy reference/);
  assert.match(html, /redacted-secret/);
  assert.doesNotMatch(html, /Bearer|sk-image-title-secret/);
});

test('workspace object preview media renders uploaded PDF with reference and region affordances', () => {
  const html = renderToStaticMarkup(createElement(UploadedDataUrlPreview, {
    kind: 'pdf',
    dataUrl: 'blob:sciforge-pdf-preview',
    title: 'Paper access_token=pdf-title-secret',
    mimeType: 'application/pdf',
    reference: referenceFixture('paper.pdf', 'file:.sciforge/artifacts/paper.pdf'),
  }));

  assert.match(html, /workspace-object-pdf-shell/);
  assert.match(html, /data-sciforge-reference=/);
  assert.match(html, /<object/);
  assert.match(html, /<iframe/);
  assert.match(html, /blob:sciforge-pdf-preview/);
  assert.match(html, /Select region/);
  assert.match(html, /Copy reference/);
  assert.match(html, /redacted-secret/);
  assert.doesNotMatch(html, /pdf-title-secret/);
});

test('workspace object preview media keeps workspace image and PDF file content ref-first', () => {
  const cases = [{
    label: 'image',
    kind: 'image' as const,
    path: 'figures/plot.png',
    mimeType: 'image/png',
    encoding: 'base64' as const,
    content: 'RAW_IMAGE_BYTES_SHOULD_NOT_RENDER',
    copyLabel: /Copy image reference/,
  }, {
    label: 'pdf',
    kind: 'pdf' as const,
    path: 'papers/article.pdf',
    mimeType: 'application/pdf',
    encoding: 'base64' as const,
    content: 'RAW_PDF_BYTES_SHOULD_NOT_RENDER',
    copyLabel: /Copy PDF reference/,
  }];

  for (const item of cases) {
    const html = renderToStaticMarkup(createElement(WorkspaceFileMediaReferenceNotice, {
      kind: item.kind,
      file: {
        path: item.path,
        name: item.path.split('/').at(-1) || item.path,
        content: item.content,
        size: item.content.length,
        language: item.kind,
        encoding: item.encoding,
        mimeType: item.mimeType,
      },
      reference: referenceFixture(item.path, `file:${item.path}`),
    }));

    assert.match(html, /workspace-object-media-note/, item.label);
    assert.match(html, /data-sciforge-reference=/, item.label);
    assert.match(html, new RegExp(item.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), item.label);
    assert.match(html, new RegExp(item.mimeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), item.label);
    assert.match(html, item.copyLabel, item.label);
    assert.doesNotMatch(html, new RegExp(item.content), item.label);
    assert.doesNotMatch(html, /<img|<object|<iframe|data:image|data:application\/pdf/i, item.label);
  }
});

test('workspace object preview media helper owns clipboard, region, and object-url presentation details', () => {
  const componentSource = readFileSync(new URL('./WorkspaceObjectPreview.tsx', import.meta.url), 'utf8');
  const helperSource = readFileSync(new URL('./workspaceObjectPreviewMedia.tsx', import.meta.url), 'utf8');

  assert.match(componentSource, /workspaceObjectPreviewMedia/);
  assert.doesNotMatch(componentSource, /navigator\.clipboard|withRegionLocator|RegionPickState|PreviewReferenceHint|fetch\(dataUrl\)|URL\.createObjectURL/);

  assert.match(helperSource, /navigator\.clipboard/);
  assert.match(helperSource, /regionReferenceForClipboard/);
  assert.match(helperSource, /RegionPickState/);
  assert.match(helperSource, /URL\.createObjectURL/);
  assert.doesNotMatch(helperSource, /readWorkspaceFile|readPreviewDescriptor|readPreviewDerivative|UserActionApi|ArtifactPreviewHydrationApi/);
});

function referenceFixture(title: string, ref: string): SciForgeReference {
  return {
    id: `ref-${title.replace(/[^a-z0-9]+/gi, '-')}`,
    kind: 'file',
    title,
    ref,
    summary: 'Fixture reference',
  };
}
