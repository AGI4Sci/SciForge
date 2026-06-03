import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicImageEvidenceViewerFixture } from './fixtures/basic';
import { emptyImageEvidenceViewerFixture } from './fixtures/empty';
import { manifest } from './manifest';
import {
  IMAGE_EVIDENCE_SOURCE_KINDS,
  renderImageEvidenceViewer,
  type ImageEvidencePayload,
} from './render';

function htmlFor(payload: Partial<ImageEvidencePayload> = {}) {
  return renderToStaticMarkup(renderImageEvidenceViewer({
    ...basicImageEvidenceViewerFixture,
    artifact: {
      ...basicImageEvidenceViewerFixture.artifact,
      data: {
        ...(basicImageEvidenceViewerFixture.artifact?.data as ImageEvidencePayload),
        ...payload,
      },
    },
  }));
}

test('image-evidence-viewer exposes a generic refs-first image evidence manifest', () => {
  assert.equal(manifest.componentId, 'image-evidence-viewer');
  assert.deepEqual(IMAGE_EVIDENCE_SOURCE_KINDS, [
    'annotation-crop',
    'screenshot',
    'browser-evidence',
    'window-capture',
    'screen-region',
    'artifact',
    'replay',
  ]);
  assert.equal(manifest.safety?.executesCode, false);
  assert.match(manifest.docs.agentSummary, /refs-first/);
});

test('image-evidence-viewer renders refs-first image preview controls and evidence metadata', () => {
  const html = htmlFor();

  assert.match(html, /image-evidence-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /data-source-kind="annotation-crop"/);
  assert.match(html, /data-image-ref="image:evidence\/crop-001\.png"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=image%3Aevidence%2Fcrop-001\.png"/);
  assert.match(html, /data-mime="image\/png"/);
  assert.match(html, /data-sha256="abc123def456"/);
  assert.match(html, /data-provenance-ref="prov:evidence\/crop-001\.json"/);
  assert.match(html, /data-provenance-ref="ledger:evidence\/crop-001\.json"/);
  assert.match(html, /data-target-ref="target:ui\/button-save"/);
  assert.match(html, /data-window-ref="window:research-app\/main"/);
  assert.match(html, /data-browser-session-ref="browser-session:evidence-demo"/);
  assert.match(html, /data-artifact-ref="artifact:run-output\/figure\.png"/);
  assert.match(html, /data-redact-ref="mask:evidence\/crop-001\.json"/);
  assert.match(html, /data-view-control="zoom-in"/);
  assert.match(html, /data-view-control="zoom-out"/);
  assert.match(html, /data-view-control="pan"/);
  assert.match(html, /data-view-control="fit"/);
  assert.match(html, /data-view-control="actual-size"/);
  assert.match(html, /data-view-control="copy-ref"/);
  assert.match(html, /data-view-control="open-original"/);
  assert.match(html, /data-view-control="download-image"/);
  assert.match(html, /data-view-control="provenance"/);
  assert.match(html, /data-event="image-view-control"/);
  assert.match(html, /data-event="copy-ref-request"/);
  assert.match(html, /data-event="open-original-request"/);
  assert.match(html, /data-event="download-image-request"/);
  assert.match(html, /data-event="show-provenance-request"/);
  assert.match(html, /data-control-execution="host-policy"/);
  assert.doesNotMatch(html, /data-view-control="copy-ref"[^>]*disabled=""/);
  assert.doesNotMatch(html, /data-view-control="open-original"[^>]*disabled=""/);
  assert.doesNotMatch(html, /data-view-control="download-image"[^>]*disabled=""/);
  assert.match(html, /data-annotation-overlay-ref="annotation:evidence\/box-1\.json"/);
  assert.match(html, /data-annotation-overlay-ref="annotation:evidence\/label-save\.json"/);
  assert.match(html, /data-crop-bounds="40,60,320,180"/);
  assert.match(html, /data-bounds="0,0,1440,900"/);

  assert.doesNotMatch(html, /data:image|base64|live|input-intent|provider|action/);
});

test('image-evidence-viewer supports every declared sourceKind without inline bytes', () => {
  for (const sourceKind of IMAGE_EVIDENCE_SOURCE_KINDS) {
    const html = htmlFor({
      sourceKind,
      imageRef: `image:evidence/${sourceKind}.png`,
      ref: undefined,
    });

    assert.match(html, new RegExp(`data-source-kind="${sourceKind}"`));
    assert.match(html, new RegExp(`image:evidence/${sourceKind}\\.png`));
    assert.doesNotMatch(html, /data:image|base64|live|input-intent|provider|action/);
  }
});

test('image-evidence-viewer renders empty ref state without fabricating image bytes', () => {
  const html = renderToStaticMarkup(renderImageEvidenceViewer(emptyImageEvidenceViewerFixture));

  assert.match(html, /data-status="missing-ref"/);
  assert.match(html, /No image evidence ref is attached/);
  assert.match(html, /data-view-control="copy-ref"[^>]*disabled=""/);
  assert.match(html, /data-view-control="open-original"[^>]*disabled=""/);
  assert.match(html, /data-view-control="download-image"[^>]*disabled=""/);
  assert.doesNotMatch(html, /<img\b|data:image|base64|live|input-intent|provider|action/);
});
