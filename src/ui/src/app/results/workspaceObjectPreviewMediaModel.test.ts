import assert from 'node:assert/strict';
import test from 'node:test';

import type { SciForgeReference } from '../../domain';
import {
  copyableSciForgeReferenceJson,
  normalizedWorkspaceObjectMediaRegion,
  regionReferenceForClipboard,
  workspaceObjectMediaRegionLocator,
  workspaceObjectMediaRegionStyle,
} from './workspaceObjectPreviewMediaModel';

test('workspace object preview media model normalizes dragged regions', () => {
  assert.deepEqual(normalizedWorkspaceObjectMediaRegion({
    start: { x: 0.1, y: 0.2 },
    end: { x: 0.6, y: 0.8 },
  }), {
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.6000000000000001,
    region: '100,200,500,600',
  });

  assert.deepEqual(normalizedWorkspaceObjectMediaRegion({
    start: { x: 1.5, y: 0.9 },
    end: { x: -0.25, y: 0.1 },
  }), {
    x: 0,
    y: 0.1,
    width: 1,
    height: 0.8,
    region: '0,100,1000,800',
  });
});

test('workspace object preview media model fails closed for tiny regions and formats region styles', () => {
  assert.equal(normalizedWorkspaceObjectMediaRegion({
    start: { x: 0.2, y: 0.2 },
    end: { x: 0.205, y: 0.8 },
  }), undefined);
  assert.equal(workspaceObjectMediaRegionLocator({ x: Number.NaN, y: -1, width: 2, height: 0.25 }), '0,0,1000,250');
  assert.deepEqual(workspaceObjectMediaRegionStyle({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }), {
    left: '10%',
    top: '20%',
    width: '30%',
    height: '40%',
  });
});

test('workspace object preview media model builds region clipboard references only from explicit refs', () => {
  assert.equal(regionReferenceForClipboard(undefined, '100,100,200,200'), undefined);
  assert.equal(regionReferenceForClipboard(referenceFixture(), undefined), undefined);

  const regionReference = regionReferenceForClipboard(referenceFixture(), '100,100,200,200');

  assert.equal(regionReference?.kind, 'file-region');
  assert.equal(regionReference?.locator?.region, '100,100,200,200');
  assert.equal((regionReference?.payload as Record<string, unknown> | undefined)?.region, '100,100,200,200');
});

test('workspace object preview media model produces safe clipboard JSON for refs', () => {
  const copyable = copyableSciForgeReferenceJson({
    ...referenceFixture(),
    id: 'ref-.sciforge-raw-provider',
    title: 'Authorization: Bearer sk-title-secret-1234567890',
    ref: 'file:.sciforge/raw/provider-output.json',
    summary: 'https://provider.example.test/v1?api_key=secret',
    payload: {
      dataUrl: 'data:image/png;base64,RAW_IMAGE_BYTES',
      rawUrl: 'https://provider.example.test/raw?token=secret',
      providerPayload: { token: 'sk-provider-secret-1234567890' },
      currentReference: {
        id: 'obj-plot',
        kind: 'file',
        title: 'plot.png',
        ref: 'file:figures/plot.png',
        status: 'available',
      },
    },
  });

  assert.ok(copyable);
  assert.match(copyable, /"kind": "file"/);
  assert.match(copyable, /"ref": "reference:/);
  assert.match(copyable, /"currentReference"/);
  assert.doesNotMatch(copyable, /data:image|RAW_IMAGE_BYTES|rawUrl|providerPayload|provider\.example|api_key|sk-title-secret|sk-provider-secret|\.sciforge\/raw/);
});

function referenceFixture(): SciForgeReference {
  return {
    id: 'ref-plot',
    kind: 'file',
    title: 'plot.png',
    ref: 'file:figures/plot.png',
    summary: 'Plot image',
  };
}
