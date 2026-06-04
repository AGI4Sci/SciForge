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
  assert.deepEqual(manifest.interactionEvents, [
    'image-view-control',
    'copy-ref-request',
    'open-original-request',
    'download-image-request',
    'show-provenance-request',
  ]);
  assert.equal(manifest.safety?.executesCode, false);
  assert.match(manifest.docs.agentSummary, /refs-first/);
  assert.match(manifest.docs.agentSummary, /host-policy/);
  assert.match(manifest.docs.agentSummary, /capture providers/);
  assert.match(manifest.docs.agentSummary, /desktop window operations/);
  assert.doesNotMatch(manifest.docs.agentSummary, /WindowActionSession|executesCode|live action/);
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
  assert.match(html, /data-control-execution="host-policy"/);
  assert.match(html, /data-annotation-overlay-ref="annotation:evidence\/box-1\.json"/);
  assert.match(html, /data-annotation-overlay-ref="annotation:evidence\/label-save\.json"/);
  assert.match(html, /data-crop-bounds="40,60,320,180"/);
  assert.match(html, /data-bounds="0,0,1440,900"/);

  assert.doesNotMatch(html, /data:image|base64|live|input-intent|provider|rebind|WindowActionSession|window-operation/);
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
    assert.doesNotMatch(html, /data:image|base64|live|input-intent|provider|rebind|WindowActionSession|window-operation/);
  }
});

test('image-evidence-viewer renders empty ref state without fabricating image bytes', () => {
  const html = renderToStaticMarkup(renderImageEvidenceViewer(emptyImageEvidenceViewerFixture));

  assert.match(html, /data-status="missing-ref"/);
  assert.match(html, /No image evidence ref is attached/);
  assert.match(html, /data-view-control="copy-ref"[^>]*disabled=""/);
  assert.match(html, /data-view-control="open-original"[^>]*disabled=""/);
  assert.match(html, /data-view-control="download-image"[^>]*disabled=""/);
  assert.doesNotMatch(html, /<img\b|data:image|base64|live|input-intent|provider|rebind|WindowActionSession|window-operation/);
});

test('image-evidence-viewer renders annotation mode evidence fields as inert metadata', () => {
  const html = htmlFor({
    sourceKind: 'screen-region',
    imageRef: 'image:evidence/screen-region-001.png',
    ref: undefined,
    domTarget: {
      selector: 'button.primary[data-role="save"]',
      stableSelector: '[data-testid="save-results"]',
      domPath: 'main > form > button:nth-child(2)',
      role: 'button',
      label: 'Save results',
      textSnippet: 'Save analysis results',
      rect: { x: 10, y: 20, width: 180, height: 36 },
      outerHTML: '<button data-secret="do-not-render">Save analysis results</button>',
    },
    selector: '#save-button',
    domPath: 'main > form > button:nth-child(2)',
    selectedText: 'Save analysis results',
    screenBounds: { x: 100, y: 200, width: 640, height: 360 },
    windowBounds: { x: 80, y: 120, width: 1200, height: 800 },
    windowLocalBounds: { x: 20, y: 80, width: 640, height: 360 },
    displayId: 2,
    scale: 2,
    windowBinding: {
      status: 'auto-bound',
      confidence: 0.96,
      reason: 'Selected region is fully inside the focused application window.',
      windowRef: 'desktop-window:app:sciforge:window-7',
      appName: 'SciForge',
      bundleId: 'app.sciforge.desktop',
      pid: 9876,
      title: 'SciForge Research Workspace',
      windowBounds: { x: 80, y: 120, width: 1200, height: 800 },
      windowLocalBounds: { x: 20, y: 80, width: 640, height: 360 },
      windowActionSessionRef: 'window-action-session:should-not-render',
      actionRef: 'window-action-ref:should-not-render',
      providerAction: 'rebind',
    } as Record<string, unknown>,
    bytes: 'data:image/png;base64,SHOULD_NOT_RENDER',
    providerAction: 'WindowActionSession promotion',
  } as Partial<ImageEvidencePayload> & Record<string, unknown>);

  assert.match(html, /data-dom-target-selector="button\.primary\[data-role=&quot;save&quot;\]"/);
  assert.match(html, /data-dom-target-stable-selector="\[data-testid=&quot;save-results&quot;\]"/);
  assert.match(html, /data-dom-target-role="button"/);
  assert.match(html, /data-dom-target-label="Save results"/);
  assert.match(html, /data-dom-target-rect="10,20,180,36"/);
  assert.match(html, /data-selector="#save-button"/);
  assert.match(html, /data-dom-path="main &gt; form &gt; button:nth-child\(2\)"/);
  assert.match(html, /data-selected-text="Save analysis results"/);
  assert.match(html, /data-screen-bounds="100,200,640,360"/);
  assert.match(html, /data-window-bounds="80,120,1200,800"/);
  assert.match(html, /data-window-local-bounds="20,80,640,360"/);
  assert.match(html, /data-display-id="2"/);
  assert.match(html, /data-scale="2"/);
  assert.match(html, /data-window-binding-status="auto-bound"/);
  assert.match(html, /data-window-binding-confidence="0\.96"/);
  assert.match(html, /data-window-binding-ref="desktop-window:app:sciforge:window-7"/);
  assert.match(html, /DOM target/);
  assert.match(html, /Window binding/);
  assert.match(html, /SciForge Research Workspace/);
  assert.doesNotMatch(html, /SHOULD_NOT_RENDER|outerHTML|data-secret|data:image|base64|provider|rebind|WindowActionSession|window-action-session|window-action-ref|window-operation/);
});

test('image-evidence-viewer keeps low-confidence unbound window candidates as candidate metadata', () => {
  const html = htmlFor({
    sourceKind: 'screen-region',
    imageRef: 'image:evidence/low-confidence-region.png',
    windowRef: 'desktop-window:should-not-appear-active',
    windowBinding: {
      status: 'unbound',
      confidence: 0.36,
      reason: 'Top candidate was below the automatic binding threshold.',
      windowRef: 'desktop-window:should-not-bind',
      candidates: [{
        windowRef: 'desktop-window:app:paper-reader:window-42',
        appName: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        pid: 4242,
        title: 'Attention Is All You Need.pdf',
        confidence: 0.36,
        reason: 'Partial overlap with selected region.',
        windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
        windowLocalBounds: { x: 700, y: 60, width: 120, height: 90 },
        actionRef: 'window-action-ref:should-not-render',
      }],
    } as Record<string, unknown>,
  });

  assert.match(html, /data-window-binding-status="unbound"/);
  assert.match(html, /data-window-binding-confidence="0\.36"/);
  assert.match(html, /Top candidate was below the automatic binding threshold/);
  assert.match(html, /data-window-binding-candidate-count="1"/);
  assert.match(html, /data-window-binding-candidate-ref="desktop-window:app:paper-reader:window-42"/);
  assert.match(html, /Candidate/);
  assert.match(html, /Paper Reader/);
  assert.doesNotMatch(html, /data-window-ref="desktop-window:should-not-bind"/);
  assert.doesNotMatch(html, /data-window-ref="desktop-window:app:paper-reader:window-42"/);
  assert.doesNotMatch(html, /Active window|Bound window|window-action-ref|provider|rebind|WindowActionSession|window-operation/);
});
