import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ObjectReference, PreviewDescriptor, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import type { UserActionApi } from '../projectionApi';
import type { ArtifactPreviewHydrationApi } from './artifactPreviewHydrationApi';
import {
  ArtifactFallbackPreview,
  DescriptorPreview,
  PresentationInputNotice,
  UnsupportedPreviewPackageNotice,
  formatWorkspaceObjectPreviewBytes,
} from './workspaceObjectPreviewFallback';

test('workspace object preview fallback renders unavailable state with bounded diagnostics', () => {
  const html = renderToStaticMarkup(createElement(ArtifactFallbackPreview, {
    reference: redactedReference(),
    artifact: {
      id: 'artifact-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      metadata: { title: 'Recovered report' },
      data: {},
    } satisfies RuntimeArtifact,
    path: 'reports/recovered.md',
    reason: 'read-failed',
    diagnostic: [
      'Could not read file.',
      'Authorization: Bearer PLACEHOLDER_TOKEN_FOR_REDACTION',
      '/Users/alice/private/provider-output.json',
      'x'.repeat(5_000),
    ].join('\n'),
  }));

  assert.match(html, /Preview unavailable/);
  assert.match(html, /Recovered report/);
  assert.match(html, /Preview details/);
  assert.match(html, /redacted-secret|redacted-local-path|preview truncated/);
  assert.doesNotMatch(html, /PLACEHOLDER_TOKEN_FOR_REDACTION|\/Users\/alice\/private/);
});

test('workspace object preview package notice exposes explicit request affordance without executing it', () => {
  const calls: Array<{ ref: string; path?: string; kind?: string }> = [];
  const descriptor: PreviewDescriptor = {
    kind: 'office',
    source: 'path',
    ref: 'reports/table.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    inlinePolicy: 'external',
    actions: ['system-open'],
  };
  const enabledHtml = renderToStaticMarkup(createElement(UnsupportedPreviewPackageNotice, {
    reference: fileReference(),
    path: 'reports/table.xlsx',
    descriptor,
    diagnostic: 'RAW_PLACEHOLDER_BODY_SHOULD_NOT_RENDER',
    onRequest: (reference, path, nextDescriptor) => calls.push({ ref: reference.ref, path, kind: nextDescriptor?.kind }),
  }));
  const disabledHtml = renderToStaticMarkup(createElement(UnsupportedPreviewPackageNotice, {
    reference: fileReference(),
    path: 'reports/table.xlsx',
    descriptor,
  }));

  assert.match(enabledHtml, /Request preview support/);
  assert.doesNotMatch(enabledHtml, /disabled=""/);
  assert.match(enabledHtml, /redacted-raw/);
  assert.match(disabledHtml, /disabled=""/);
  assert.deepEqual(calls, []);
});

test('workspace object preview presentation input notice stays compact and redacted', () => {
  const binaryHtml = renderToStaticMarkup(createElement(PresentationInputNotice, {
    reference: artifactReference(),
    input: {
      kind: 'binary',
      ref: 'reports/deck.pdf',
      title: 'Deck',
      rawRef: '.sciforge/artifacts/raw-output.json',
      artifactRef: 'artifact:deck',
      openMode: 'system',
      previewPolicy: 'open-system',
    },
    path: 'reports/deck.pdf',
  }));
  const unsupportedHtml = renderToStaticMarkup(createElement(PresentationInputNotice, {
    reference: artifactReference(),
    input: {
      kind: 'unsupported',
      title: 'Unsupported provider result',
      rawRef: '.sciforge/artifacts/provider-raw.json',
      artifactRef: 'artifact:deck',
      reason: 'delivery previewPolicy is unsupported',
      previewPolicy: 'unsupported',
    },
  }));

  assert.match(binaryHtml, /Open externally/);
  assert.match(binaryHtml, /Source material is available from run details/);
  assert.doesNotMatch(binaryHtml, /\.sciforge\/artifacts\/raw-output/);
  assert.match(unsupportedHtml, /Preview unavailable/);
  assert.doesNotMatch(unsupportedHtml, /provider-raw/);
});

test('workspace descriptor preview adapter gates large descriptors and projects derived errors safely', () => {
  const descriptor: PreviewDescriptor = {
    kind: 'markdown',
    source: 'path',
    ref: 'reports/large-report.md',
    sizeBytes: 2_000_000,
    inlinePolicy: 'extract',
    actions: ['extract-text'],
  };
  const html = renderToStaticMarkup(createElement(DescriptorPreview, {
    descriptor,
    config: testConfig(),
    reference: {
      id: 'artifact-large-report-preview',
      kind: 'file',
      title: 'large-report.md',
      ref: 'artifact:large-report',
    },
    objectReference: artifactReference(),
    objectReferences: [],
    session: testSession(),
    userActionApi: {
      async loadArtifactPreview() {
        throw new Error('SSR render should not execute manual preview action');
      },
    } as unknown as UserActionApi,
    hydrationApi: {
      async loadDescriptorPreviewFile() {
        throw new Error('SSR render should not execute descriptor hydration');
      },
    } as unknown as ArtifactPreviewHydrationApi,
  }));

  assert.match(html, /Large file preview/);
  assert.match(html, /Load preview/);
  assert.match(html, /workspace-object-load-preview-action/);
});

test('workspace object preview fallback helper owns fallback and descriptor presentation extraction', () => {
  const componentSource = readFileSync(new URL('./WorkspaceObjectPreview.tsx', import.meta.url), 'utf8');
  const helperSource = readFileSync(new URL('./workspaceObjectPreviewFallback.tsx', import.meta.url), 'utf8');

  assert.match(componentSource, /workspaceObjectPreviewFallback/);
  assert.doesNotMatch(componentSource, /function ArtifactFallbackPreview|function PresentationInputNotice|function UnsupportedPreviewPackageNotice|function DescriptorPreview|function PreviewDiagnosticFold|function userPreviewKindLabel|function artifactFallbackTitle|function formatBytes/);
  assert.match(helperSource, /function ArtifactFallbackPreview/);
  assert.match(helperSource, /function DescriptorPreview/);
  assert.doesNotMatch(helperSource, /readWorkspaceFile|writeWorkspaceFile|BrowserHostSession|terminalPane|filesPaneModulePort|navigator\.clipboard/);
  assert.equal(formatWorkspaceObjectPreviewBytes(512), '512 B');
  assert.equal(formatWorkspaceObjectPreviewBytes(1536), '1.5 KB');
});

function fileReference(): ObjectReference {
  return {
    id: 'file-report',
    kind: 'file',
    title: 'Report file',
    ref: 'file:reports/table.xlsx',
    status: 'available',
  };
}

function redactedReference(): ObjectReference {
  return {
    id: 'artifact-redacted',
    kind: 'artifact',
    title: 'artifact:[redacted-unsafe-preview-ref]',
    ref: 'artifact:[redacted-unsafe-preview-ref]',
    status: 'available',
  };
}

function artifactReference(): ObjectReference {
  return {
    id: 'artifact-report',
    kind: 'artifact',
    title: 'Report artifact',
    ref: 'artifact:large-report',
    artifactType: 'research-report',
    status: 'available',
  };
}

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
    workspacePath: '/tmp/ws',
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 1000,
    maxContextWindowTokens: 200000,
    visionAllowSharedSystemInput: true,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function testSession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-workspace-object-preview-fallback',
    scenarioId: 'literature-evidence-review',
    title: 'Workspace object preview fallback',
    messages: [],
    runs: [],
    artifacts: [],
    claims: [],
    notebook: [],
    uiManifest: [],
    executionUnits: [],
    versions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
