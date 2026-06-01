import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('result object focus opens the right pane without implicit composer insertion', () => {
  const source = readFileSync(new URL('./SciForgeWorkbench.tsx', import.meta.url), 'utf8');

  assert.match(source, /function handleResultObjectFocus/);
  assert.match(source, /handleObjectFocus\(reference\)/);
  assert.match(source, /createWorkbenchObjectFocusUIAction/);
  assert.match(source, /setFocusedObjectReference\(reference\)/);
  assert.match(source, /setResultsCollapsed\(false\)/);
  assert.match(source, /setMobilePane\('results'\)/);
  assert.doesNotMatch(source, /composerReferenceForObjectReference/);
  assert.doesNotMatch(source, /resultReferenceRequest|setResultReferenceRequest/);
});
