import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeArtifact, SciForgeSession } from '../../domain';
import { RightPaneArtifactInspectorDrawer } from './rightPaneArtifactInspectorAdapter';

test('right pane artifact inspector adapter owns drawer rendering extraction from ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./rightPaneArtifactInspectorAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /ArtifactInspectorDrawer/);
  assert.match(adapterSource, /executionFocus/);
  assert.match(rendererSource, /from '.\/results\/rightPaneArtifactInspectorAdapter'/);
  assert.match(rendererSource, /<RightPaneArtifactInspectorDrawer/);
  assert.doesNotMatch(rendererSource, /from '.\/results-renderer-artifact-inspector'/);
  assert.doesNotMatch(rendererSource, /<ArtifactInspectorDrawer\b/);
  assert.doesNotMatch(rendererSource, /drawer=\{!executionFocus/);
});

test('right pane artifact inspector adapter renders only outside execution focus', () => {
  const artifact: RuntimeArtifact = {
    id: 'artifact-inspector-adapter',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Adapter report' },
  };
  const props = {
    scenarioId: 'literature-evidence-review' as const,
    session: sessionFixture(artifact),
    artifact,
    onClose: () => undefined,
    onArtifactHandoff: () => undefined,
  };

  const html = renderToStaticMarkup(createElement(RightPaneArtifactInspectorDrawer, {
    ...props,
    executionFocus: false,
  }));
  assert.match(html, /Result details/);
  assert.match(html, /artifact-inspector-adapter/);
  assert.match(html, /Adapter report/);

  assert.equal(renderToStaticMarkup(createElement(RightPaneArtifactInspectorDrawer, {
    ...props,
    executionFocus: true,
  })), '');
  assert.equal(renderToStaticMarkup(createElement(RightPaneArtifactInspectorDrawer, {
    ...props,
    artifact: undefined,
    executionFocus: false,
  })), '');
});

function sessionFixture(artifact: RuntimeArtifact): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-artifact-inspector-adapter',
    scenarioId: 'literature-evidence-review',
    title: 'Artifact inspector adapter',
    createdAt: '2026-06-01T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [artifact],
    notebook: [],
    versions: [],
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
