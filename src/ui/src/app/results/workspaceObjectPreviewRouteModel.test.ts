import assert from 'node:assert/strict';
import test from 'node:test';

import type { ObjectReference, PreviewDescriptor } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import { workspaceObjectPreviewRoute } from './workspaceObjectPreviewRouteModel';

test('workspace object preview route model handles URL, folder, and unsupported refs without hydration ownership', () => {
  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('url', 'url:https://docs.example.test/guide', 'Docs'),
  }), {
    kind: 'url',
    title: 'Docs',
    url: 'https://docs.example.test/guide',
    href: 'https://docs.example.test/guide',
  });

  const unsafeUrl = workspaceObjectPreviewRoute({
    reference: objectReference('url', 'url:https://provider.example.test/v1?api_key=sk-url-secret-1234567890', 'Provider URL'),
  });
  assert.equal(unsafeUrl.kind, 'url');
  assert.equal(unsafeUrl.href, undefined);

  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('folder', 'folder:src/ui', 'UI folder'),
    path: 'src/ui',
  }), {
    kind: 'folder',
    label: 'src/ui',
  });

  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('scenario-package', 'scenario-package:lit-review', 'Scenario package'),
  }), {
    kind: 'unsupported-reference',
  });
});

test('workspace object preview route model preserves preview priority before path hydration checks', () => {
  const unsafeArtifact = objectReference('artifact', 'artifact:inline-image', 'Inline image');
  const inlineRoute = workspaceObjectPreviewRoute({
    reference: unsafeArtifact,
    path: '/tmp/private.png',
    inlinePreview: {
      kind: 'image',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      title: 'Inline image',
      mimeType: 'image/png',
      size: 512,
    },
    presentationInput: {
      kind: 'binary',
      ref: '/tmp/private.png',
      title: 'Binary image',
      artifactRef: 'artifact:inline-image',
      openMode: 'system',
      previewPolicy: 'open-system',
    },
  });
  assert.equal(inlineRoute.kind, 'inline-preview');
  assert.equal(inlineRoute.reference.kind, 'file-region');

  const presentationRoute = workspaceObjectPreviewRoute({
    reference: unsafeArtifact,
    path: '/tmp/private.pdf',
    presentationInput: {
      kind: 'binary',
      ref: '/tmp/private.pdf',
      title: 'Binary paper',
      artifactRef: 'artifact:inline-image',
      openMode: 'system',
      previewPolicy: 'open-system',
    },
    subagentPreview: { refs: ['file:PROJECT.md'], resultSummary: 'done' },
  });
  assert.equal(presentationRoute.kind, 'presentation-input');

  const subagentRoute = workspaceObjectPreviewRoute({
    reference: objectReference('artifact', 'artifact:subagent-result-abc123', 'Subtask'),
    path: '/tmp/private-transcript.json',
    subagentPreview: { refs: ['file:PROJECT.md'], resultSummary: 'done' },
  });
  assert.equal(subagentRoute.kind, 'subagent-preview');

  const transcriptRoute = workspaceObjectPreviewRoute({
    reference: objectReference('artifact', 'artifact:subagent-transcript-abc123', 'Transcript'),
    subagentPreview: { transcriptRef: 'artifact:subagent-transcript-abc123', refs: [] },
  });
  assert.equal(transcriptRoute.kind, 'subagent-preview');
});

test('workspace object preview route model fails closed for unsafe or missing paths', () => {
  const unsafeRoute = workspaceObjectPreviewRoute({
    reference: objectReference('file', 'file:/tmp/private.md', '/tmp/private.md'),
    path: '/tmp/private.md',
    loadingPath: '/tmp/private.md',
  });
  assert.equal(unsafeRoute.kind, 'unsafe-path');
  assert.equal(unsafeRoute.reference.ref, 'file:[redacted-unsafe-preview-ref]');
  assert.equal(unsafeRoute.reference.provenance, undefined);

  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('artifact', 'artifact:missing-report', 'Missing report'),
    loadingPath: 'reports/missing.md',
  }), {
    kind: 'missing-path',
  });
});

test('workspace object preview route model projects hydration lifecycle, descriptors, and files', () => {
  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('file', 'file:reports/report.md', 'Report'),
    path: 'reports/report.md',
    loadingPath: 'reports/report.md',
    error: 'read failed after loading starts',
  }), {
    kind: 'loading',
    label: 'reports/report.md',
    source: 'hydration',
  });

  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('file', 'file:reports/report.md', 'Report'),
    path: 'reports/report.md',
    error: 'Cannot read report',
  }), {
    kind: 'error',
    path: 'reports/report.md',
    diagnostic: 'Cannot read report',
  });

  const descriptor: PreviewDescriptor = {
    kind: 'office',
    source: 'path',
    ref: 'reports/deck.pptx',
    inlinePolicy: 'external',
    actions: ['system-open'],
    title: 'Deck',
  };
  const descriptorRoute = workspaceObjectPreviewRoute({
    reference: objectReference('artifact', 'artifact:deck', 'Deck'),
    path: 'reports/deck.pptx',
    descriptor,
  });
  assert.equal(descriptorRoute.kind, 'descriptor');
  assert.equal(descriptorRoute.needsPackage, true);
  assert.equal(descriptorRoute.reference.ref, 'artifact:deck');

  assert.deepEqual(workspaceObjectPreviewRoute({
    reference: objectReference('file', 'file:reports/pending.md', 'Pending'),
    path: 'reports/pending.md',
  }), {
    kind: 'loading',
    label: 'reports/pending.md',
    source: 'pending-file',
  });

  const file = workspaceFile('reports/report.md');
  const fileRoute = workspaceObjectPreviewRoute({
    reference: objectReference('file', 'file:reports/report.md', 'Report'),
    path: 'reports/report.md',
    file,
  });
  assert.equal(fileRoute.kind, 'file');
  assert.equal(fileRoute.file, file);
  assert.equal(fileRoute.reference.ref, 'file:reports/report.md');
});

function objectReference(kind: ObjectReference['kind'], ref: string, title: string): ObjectReference {
  return {
    id: `obj-${ref.replace(/[^a-z0-9]+/gi, '-')}`,
    kind,
    ref,
    title,
    status: 'available',
  };
}

function workspaceFile(path: string): WorkspaceFileContent {
  return {
    path,
    name: path.split('/').pop() ?? path,
    content: '# Report',
    size: 8,
    language: 'markdown',
    encoding: 'utf8',
    mimeType: 'text/markdown',
  };
}
