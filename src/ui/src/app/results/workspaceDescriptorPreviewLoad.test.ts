import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ObjectReference, PreviewDescriptor, SciForgeSession } from '../../domain';
import {
  WORKSPACE_DESCRIPTOR_PREVIEW_INLINE_LIMIT_BYTES,
  descriptorNeedsManualPreviewLoad,
  requestManualArtifactPreviewLoad,
  workspaceDescriptorPreviewLoadKey,
  workspaceDescriptorPreviewLoadPlan,
} from './workspaceDescriptorPreviewLoad';

test('workspace descriptor preview load plan waits for explicit load for large descriptors', () => {
  const descriptor = descriptorFixture({
    ref: '.sciforge/artifacts/large-report.md',
    sizeBytes: WORKSPACE_DESCRIPTOR_PREVIEW_INLINE_LIMIT_BYTES + 1,
    inlinePolicy: 'inline',
  });
  const descriptorLoadKey = workspaceDescriptorPreviewLoadKey(descriptor);

  assert.equal(descriptorNeedsManualPreviewLoad(descriptor), true);
  assert.deepEqual(workspaceDescriptorPreviewLoadPlan({ descriptor }), {
    action: 'wait-for-manual-load',
    descriptorLoadKey,
  });
  assert.deepEqual(workspaceDescriptorPreviewLoadPlan({ descriptor, requestedLoadKey: descriptorLoadKey }), {
    action: 'load',
    descriptorLoadKey,
  });
});

test('workspace descriptor preview load plan autoloads small inline text descriptors', () => {
  const descriptor = descriptorFixture({
    ref: '.sciforge/artifacts/small-report.md',
    sizeBytes: 512,
    inlinePolicy: 'inline',
  });
  const descriptorLoadKey = workspaceDescriptorPreviewLoadKey(descriptor);

  assert.equal(descriptorNeedsManualPreviewLoad(descriptor), false);
  assert.deepEqual(workspaceDescriptorPreviewLoadPlan({ descriptor }), {
    action: 'load',
    descriptorLoadKey,
  });
});

test('workspace descriptor preview load plan skips unsupported preview descriptor kinds', () => {
  const descriptor = descriptorFixture({
    kind: 'pdf',
    ref: '.sciforge/artifacts/paper.pdf',
    inlinePolicy: 'stream',
  });

  assert.equal(descriptorNeedsManualPreviewLoad(descriptor), false);
  assert.deepEqual(workspaceDescriptorPreviewLoadPlan({ descriptor }), {
    action: 'skip',
    reason: 'unsupported-descriptor',
    descriptorLoadKey: workspaceDescriptorPreviewLoadKey(descriptor),
  });
});

test('requestManualArtifactPreviewLoad routes only artifact refs through UserActionApi', async () => {
  const session = testSession();
  const calls: Array<{ artifactRef: string; byteLimit?: number }> = [];
  const artifactResult = await requestManualArtifactPreviewLoad({
    session,
    reference: objectReference('artifact:large-report', 'artifact'),
    byteLimit: 4096,
    userActionApi: {
      async loadArtifactPreview(input) {
        calls.push({ artifactRef: input.artifactRef, byteLimit: input.byteLimit });
        return {
          artifactRef: input.artifactRef,
          status: 'ready',
          title: 'large-report',
          actions: [],
        };
      },
    },
  });
  const fileResult = await requestManualArtifactPreviewLoad({
    session,
    reference: objectReference('file:reports/large-report.md', 'file'),
    userActionApi: {
      async loadArtifactPreview() {
        throw new Error('file refs must not request artifact preview actions');
      },
    },
  });

  assert.deepEqual(calls, [{ artifactRef: 'artifact:large-report', byteLimit: 4096 }]);
  assert.equal(artifactResult?.artifactRef, 'artifact:large-report');
  assert.equal(fileResult, undefined);
});

test('workspace descriptor preview load helper owns manual descriptor side effects', () => {
  const componentSource = readFileSync(new URL('./WorkspaceObjectPreview.tsx', import.meta.url), 'utf8');
  const adapterSource = readFileSync(new URL('./workspaceObjectPreviewFallback.tsx', import.meta.url), 'utf8');
  const helperSource = readFileSync(new URL('./workspaceDescriptorPreviewLoad.ts', import.meta.url), 'utf8');
  const hydrationSource = readFileSync(new URL('./workspaceObjectPreviewHydration.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(componentSource, /useWorkspaceDescriptorPreviewLoad|loadDescriptorPreviewFile|requestManualArtifactPreviewLoad/);
  assert.match(adapterSource, /useWorkspaceDescriptorPreviewLoad/);
  assert.doesNotMatch(adapterSource, /loadDescriptorPreviewFile|requestManualArtifactPreviewLoad|readWorkspaceFile\s*\(|readPreviewDescriptor\s*\(|readPreviewDerivative\s*\(/);
  assert.doesNotMatch(componentSource, /loadDescriptorPreviewFile|requestManualArtifactPreviewLoad/);
  assert.match(helperSource, /loadDescriptorPreviewFile/);
  assert.match(helperSource, /requestManualArtifactPreviewLoad/);
  assert.doesNotMatch(helperSource, /readWorkspaceFile\s*\(|readPreviewDescriptor\s*\(|readPreviewDerivative\s*\(/);
  assert.doesNotMatch(helperSource, /onObjectReferenceFocus|onPreviewPackageRequest|navigator\.clipboard/);
  assert.doesNotMatch(hydrationSource, /requestManualArtifactPreviewLoad/);
});

function descriptorFixture(overrides: Partial<PreviewDescriptor>): PreviewDescriptor {
  return {
    kind: 'markdown',
    source: 'path',
    ref: '.sciforge/artifacts/report.md',
    inlinePolicy: 'inline',
    actions: ['copy-ref'],
    ...overrides,
  };
}

function objectReference(ref: string, kind: ObjectReference['kind']): ObjectReference {
  return {
    id: `obj-${ref.replace(/[^a-z0-9]+/gi, '-')}`,
    title: ref,
    kind,
    ref,
    status: 'available',
  };
}

function testSession(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'Test session',
    messages: [],
    artifacts: [],
    claims: [],
    notebook: [],
    runs: [],
    uiManifest: [],
    executionUnits: [],
    versions: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
