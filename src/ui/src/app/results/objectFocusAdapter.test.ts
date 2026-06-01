import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ObjectReference, SciForgeConfig, SciForgeSession } from '../../domain';
import { RightPaneObjectFocusSurface, visibleObjectFocusActions } from './objectFocusAdapter';

test('object focus adapter owns banner and preview extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./objectFocusAdapter.tsx', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function RightPaneObjectFocusSurface/);
  assert.match(adapterSource, /WorkspaceObjectPreview/);
  assert.match(adapterSource, /availableObjectActions/);
  assert.match(surfaceSource, /from '.\/objectFocusAdapter'/);
  assert.match(rendererSource, /from '.\/results\/rightPaneSurfaceAdapter'/);
  assert.doesNotMatch(rendererSource, /function ObjectFocusBanner/);
  assert.doesNotMatch(rendererSource, /<WorkspaceObjectPreview\b/);
  assert.doesNotMatch(rendererSource, /availableObjectActions/);
  assert.doesNotMatch(rendererSource, /objectActionLabel/);
  assert.doesNotMatch(rendererSource, /objectReferenceKindLabel/);
});

test('object focus adapter filters focus action from visible command row', () => {
  assert.deepEqual(
    visibleObjectFocusActions(['focus-right-pane', 'pin', 'compare', 'inspect', 'copy-path', 'open-external', 'reveal-in-folder']),
    ['pin', 'compare', 'inspect', 'copy-path', 'open-external', 'reveal-in-folder'],
  );
});

test('object focus surface renders bounded banner actions without forcing preview hydration', () => {
  const reference: ObjectReference = {
    id: 'obj-file',
    kind: 'file',
    title: 'Important file',
    summary: 'Workspace preview source',
    ref: 'file:src/app.ts',
    actions: ['focus-right-pane', 'pin', 'compare'],
  };
  const pinned: ObjectReference = {
    id: 'obj-pinned',
    kind: 'url',
    title: 'Pinned URL',
    ref: 'url:https://example.org',
  };
  const html = renderToStaticMarkup(createElement(RightPaneObjectFocusSurface, {
    reference,
    pinnedReferences: [pinned],
    session: sessionFixture(),
    config: configFixture(),
    previewDisabled: true,
    notice: 'Ready',
    onAction: () => undefined,
    onClear: () => undefined,
  }));

  assert.match(html, /object-focus-banner/);
  assert.match(html, /Important file/);
  assert.match(html, /Pin/);
  assert.match(html, /对比/);
  assert.match(html, /Pinned URL/);
  assert.match(html, /Ready/);
  assert.doesNotMatch(html, /聚焦/);
});

test('object focus surface keeps error-only state available while execution focus suppresses preview UI', () => {
  const html = renderToStaticMarkup(createElement(RightPaneObjectFocusSurface, {
    reference: {
      id: 'obj-hidden',
      kind: 'url',
      title: 'Hidden URL',
      ref: 'url:https://example.org',
    },
    pinnedReferences: [],
    session: sessionFixture(),
    config: configFixture(),
    suppressReferenceUi: true,
    error: 'Failed to inspect hidden object',
    onAction: () => undefined,
    onClear: () => undefined,
  }));

  assert.match(html, /object-action-error/);
  assert.match(html, /Failed to inspect hidden object/);
  assert.doesNotMatch(html, /Hidden URL/);
});

function sessionFixture(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-object-focus-adapter',
    scenarioId: 'research' as never,
    title: 'Object focus adapter',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function configFixture(): SciForgeConfig {
  return {
    workspacePath: '/workspace',
    locale: 'zh-CN',
  } as SciForgeConfig;
}
