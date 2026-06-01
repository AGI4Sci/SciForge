import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('primary result adapter owns primary view rendering outside ResultsRenderer', () => {
  const adapterSource = readFileSync(new URL('./primaryResultAdapter.tsx', import.meta.url), 'utf8');
  const surfaceSource = readFileSync(new URL('./rightPaneSurfaceAdapter.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../ResultsRenderer.tsx', import.meta.url), 'utf8');

  assert.match(adapterSource, /export function PrimaryResultAdapter/);
  assert.match(adapterSource, /function PrimaryResultItemsSection/);
  assert.match(adapterSource, /function RightPaneToolDock/);
  assert.match(adapterSource, /data-testid="runtime-visible-state"/);
  assert.match(surfaceSource, /from '.\/primaryResultAdapter'/);
  assert.match(rendererSource, /from '.\/results\/rightPaneSurfaceAdapter'/);
  assert.doesNotMatch(rendererSource, /function PrimaryResult\(/);
  assert.doesNotMatch(rendererSource, /function ResultItemsSection\(/);
  assert.doesNotMatch(rendererSource, /function RightPaneToolDock\(/);
});
