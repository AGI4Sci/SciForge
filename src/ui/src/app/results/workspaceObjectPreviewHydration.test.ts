import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workspaceObjectPreviewHydrationPlan } from './workspaceObjectPreviewHydration';

test('workspace object preview hydration plan hydrates only safe file and artifact paths', () => {
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'file',
    path: 'reports/result.md',
  }), { action: 'hydrate', path: 'reports/result.md' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'artifact',
    path: '.sciforge/artifacts/result.md',
  }), { action: 'hydrate', path: '.sciforge/artifacts/result.md' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'file',
    path: '.sciforge/raw/provider.json',
  }), { action: 'skip', reason: 'unsafe-path' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'file',
    path: '/tmp/private.md',
  }), { action: 'skip', reason: 'unsafe-path' });
});

test('workspace object preview hydration plan skips presentation-owned previews', () => {
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: true,
    referenceKind: 'artifact',
    path: '.sciforge/artifacts/plot.png',
  }), { action: 'skip', reason: 'inline-preview' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    presentationInputKind: 'binary',
    referenceKind: 'artifact',
    path: '.sciforge/artifacts/report.pdf',
  }), { action: 'skip', reason: 'presentation-input' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    presentationInputKind: 'unsupported',
    referenceKind: 'artifact',
    path: '.sciforge/artifacts/archive.zip',
  }), { action: 'skip', reason: 'presentation-input' });
});

test('workspace object preview hydration plan fails closed for unsupported refs and missing paths', () => {
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'url',
    path: 'reports/result.md',
  }), { action: 'skip', reason: 'unsupported-reference-kind' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'folder',
    path: 'reports',
  }), { action: 'skip', reason: 'unsupported-reference-kind' });
  assert.deepEqual(workspaceObjectPreviewHydrationPlan({
    inlinePreviewAvailable: false,
    referenceKind: 'artifact',
  }), { action: 'skip', reason: 'missing-path' });
});

test('workspace object preview hydration hook owns workspace preview hydration side effect', () => {
  const componentSource = readFileSync(new URL('./WorkspaceObjectPreview.tsx', import.meta.url), 'utf8');
  const hydrationSource = readFileSync(new URL('./workspaceObjectPreviewHydration.ts', import.meta.url), 'utf8');
  const descriptorLoadSource = readFileSync(new URL('./workspaceDescriptorPreviewLoad.ts', import.meta.url), 'utf8');

  assert.match(componentSource, /useWorkspaceObjectPreviewHydration/);
  assert.doesNotMatch(componentSource, /hydrateWorkspaceObjectPreview\s*\(/);
  assert.match(hydrationSource, /hydrateWorkspaceObjectPreview\s*\(/);
  assert.match(hydrationSource, /workspaceObjectPreviewHydrationPlan/);
  assert.match(hydrationSource, /canHydrateWorkspaceObjectPath/);
  assert.doesNotMatch(hydrationSource, /onObjectReferenceFocus|onPreviewPackageRequest|navigator\.clipboard/);
  assert.doesNotMatch(hydrationSource, /loadDescriptorPreviewFile|requestManualArtifactPreviewLoad/);
  assert.doesNotMatch(componentSource, /loadDescriptorPreviewFile|requestManualArtifactPreviewLoad/);
  assert.match(descriptorLoadSource, /loadDescriptorPreviewFile/);
  assert.match(descriptorLoadSource, /requestManualArtifactPreviewLoad/);
  assert.doesNotMatch(hydrationSource, /readWorkspaceFile\s*\(/);
  assert.doesNotMatch(hydrationSource, /readPreviewDescriptor\s*\(/);
  assert.doesNotMatch(hydrationSource, /readPreviewDerivative\s*\(/);
});
