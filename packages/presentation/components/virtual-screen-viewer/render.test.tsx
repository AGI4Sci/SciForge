import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicVirtualScreenViewerFixture } from './fixtures/basic';
import { emptyVirtualScreenViewerFixture } from './fixtures/empty';
import { refsContractVirtualScreenViewerFixture } from './fixtures/refs-contract';
import { visualRegressionVirtualScreenViewerFixture } from './fixtures/visual-regression';
import { manifest } from './manifest';
import { renderVirtualScreenViewer } from './render';

function countMatches(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].length;
}

function requireBlock(html: string, pattern: RegExp, label: string) {
  const match = html.match(pattern);
  assert.ok(match, `${label} should be present`);
  return match[0];
}

test('virtual-screen-viewer renders refs-first screen state and actor cursors', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(basicVirtualScreenViewerFixture));

  assert.equal(manifest.componentId, 'virtual-screen-viewer');
  assert.match(html, /virtual-screen-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /computer-use:session\/basic\/virtual-desktop-session-manifest\.json/);
  assert.match(html, /computer-use:session\/basic\/frames\/latest\.png/);
  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Fbasic%2Fframes%2Flatest\.png"/);
  assert.match(html, /computer-use:session\/basic\/virtual-screens\.json#screen-2/);
  assert.match(html, /computer-use:session\/basic\/cursor-overlays\/latest\.json/);
  assert.match(html, /computer-use:session\/basic\/leases\/screen-1-active\.json/);
  assert.match(html, /computer-use:session\/basic\/proposals\/agent-click\.json/);
  assert.match(html, /computer-use:session\/basic\/evidence\/before-observe\.json/);
  assert.match(html, /computer-use:session\/basic\/evidence\/completion\.json/);
  assert.match(html, /data-proposal-status="needs-confirmation"/);
  assert.match(html, /data-cursor-state="proposing"/);
  assert.match(html, /data-control-flag="permission required"/);
  assert.match(html, /User/);
  assert.match(html, /Agent/);
  assert.match(html, /shared input/);
  assert.match(html, /virtual-screen-timeline/);
  assert.match(html, /data-event="virtual-screen-terminal-equivalent-text"/);
  assert.match(html, /\/computer-use observe --screen-ref/);
  assert.match(html, /\/computer-use replay --replay-ref/);
  assert.match(html, /\/computer-use stop --stop-ref/);
  assert.doesNotMatch(html, /data:image|do-not-render|desktopBridge/);
});

test('virtual-screen-viewer keeps replay preview, overlays, timeline, and lease status visually materialized', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(visualRegressionVirtualScreenViewerFixture));
  const stageHtml = requireBlock(html, /<section class="virtual-screen-stage"[\s\S]*?<\/section>/, 'screen stage');
  const footerHtml = requireBlock(html, /<footer class="virtual-screen-footer"[\s\S]*?<\/footer>/, 'screen footer');
  const imageMatch = stageHtml.match(/<img\b[^>]*class="virtual-screen-frame-image"[^>]*src="([^"]+)"[^>]*>/);

  assert.equal(countMatches(html, /class="virtual-screen-stage"/g), 1);
  assert.equal(countMatches(stageHtml, /class="virtual-screen-frame-image"/g), 1);
  assert.ok(imageMatch, 'active frame preview image should render');
  assert.equal(
    imageMatch?.[1],
    '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Fvisual-regression%2Fframes%2Factive.png',
  );
  assert.match(imageMatch?.[0] ?? '', /alt="active replay frame"/);
  assert.match(imageMatch?.[0] ?? '', /data-frame-ref="computer-use:session\/visual-regression\/frames\/active\.png"/);
  assert.match(imageMatch?.[0] ?? '', /data-screen-ref="computer-use:session\/visual-regression\/screens\.json#main"/);
  assert.doesNotMatch(imageMatch?.[1] ?? '', /^computer-use:session\//);
  assert.doesNotMatch(stageHtml, />\s*computer-use:session\/visual-regression\/frames\/active\.png\s*</);

  assert.equal(countMatches(stageHtml, /class="virtual-screen-cursor"/g), 2);
  assert.match(stageHtml, /data-cursor-state="observing"/);
  assert.match(stageHtml, /data-cursor-state="lease-held"/);
  assert.match(footerHtml, /class="virtual-screen-lease-owners"/);
  assert.match(footerHtml, /main screen lease/);
  assert.match(footerHtml, /data-status-detail="lease">lease: <strong>held<\/strong>/);
  assert.match(footerHtml, /data-control-flag="lease status" data-control-value="held"/);
  assert.match(footerHtml, /class="virtual-screen-run-summary"/);
  assert.match(footerHtml, /data-run-summary-field="screens">screens: <strong>2<\/strong>/);
  assert.match(footerHtml, /data-run-summary-field="actor cursors">actor cursors: <strong>2<\/strong>/);
  assert.match(footerHtml, /data-run-summary-field="sidecar">sidecar: <strong>macos-native-virtual-screen<\/strong>/);
  assert.match(footerHtml, /data-run-summary-field="validation">validation: <strong>accepted<\/strong>/);
  assert.match(footerHtml, /data-run-summary-field="validation ok">validation ok: <strong>true<\/strong>/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/validation\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/evidence\/index\.json/);
  assert.match(footerHtml, /data-proposal-status="needs-confirmation"/);
  assert.match(footerHtml, /class="virtual-screen-timeline"/);
  assert.match(footerHtml, /data-timeline-kind="frame" data-active-frame="true"/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/overlays\/cursors-active\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/leases\/main-held\.json/);
  assert.match(footerHtml, /computer-use:session\/visual-regression\/proposals\/click-confirm\.json/);

  assert.doesNotMatch(html, /data-status="empty"|Virtual screen refs are not attached/);
  assert.doesNotMatch(stageHtml, /Frame preview unavailable|Waiting for virtual display frame|placeholder|data:image|base64/);
  assert.doesNotMatch(html, /rawScreenshot|screenshotBase64|rawTrace|providerRoute|executorLease|schedulerParams/);
});

test('virtual-screen-viewer shows empty state without fabricating a screen', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(emptyVirtualScreenViewerFixture));

  assert.match(html, /data-status="empty"/);
  assert.match(html, /Virtual screen refs are not attached/);
  assert.doesNotMatch(html, /virtual-screen-frame-ref/);
});

test('virtual-screen-viewer supports replay contract refs and rejects unsafe inline/provider inputs', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(refsContractVirtualScreenViewerFixture));

  assert.match(html, /data-status="error"/);
  assert.doesNotMatch(html, /src="https:\/\/preview\.invalid\/sciforge\/frame-after\.png"/);
  assert.match(html, /computer-use:session\/contract\/frame-data\/after\.json/);
  assert.match(html, /computer-use:session\/contract\/frames\/after\.png/);
  assert.match(html, /computer-use:session\/contract\/frames\/before\.png/);
  assert.match(html, /computer-use:session\/contract\/overlays\/cursors\.json/);
  assert.match(html, /computer-use:session\/contract\/leases\/screen-a\.json/);
  assert.match(html, /computer-use:session\/contract\/proposals\/click\.json/);
  assert.match(html, /computer-use:session\/contract\/evidence\/completion\.json/);
  assert.match(html, /computer-use:session\/contract\/blocked\/permission\.json/);
  assert.match(html, /computer-use:session\/contract\/errors\/latest\.json/);
  assert.match(html, /data-unsafe-input-rejected="true"/);
  assert.match(html, /data-rejection-kind="raw-json" data-rejected-field="rawJson"/);
  assert.match(html, /data-rejection-kind="unsafe-preview-url" data-rejected-field="frameRefs\[0\]\.framePreviewUrl"/);
  assert.match(html, /data-rejection-kind="unsafe-preview-url" data-rejected-field="frameRefs\[1\]\.thumbnailPreviewUrl"/);
  assert.match(html, /inline screenshot/);
  assert.match(html, /base64 image payload/);
  assert.match(html, /raw trace payload/);
  assert.match(html, /raw JSON payload/);
  assert.match(html, /provider route/);
  assert.match(html, /executor lease parameters/);
  assert.doesNotMatch(html, /data:image|blocked&quot;|do-not-render|\/private\/provider|preview\.invalid/);
});

test('virtual-screen-viewer materializes frame records from frames while retaining ref chips', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Materialized Frame' },
    artifact: {
      id: 'materialized-frame',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        sessionRef: 'computer-use:session/materialized/manifest.json',
        screenRef: 'computer-use:session/materialized/screens.json#screen',
        frameRefs: ['computer-use:session/materialized/frames/current.png'],
        frames: [
          {
            frameRef: 'computer-use:session/materialized/frames/current.png',
            thumbnailPreviewUrl: '/api/sciforge/preview/thumbnail?ref=computer-use%3Asession%2Fmaterialized%2Fframes%2Fcurrent.png',
            cursorOverlayRefs: ['computer-use:session/materialized/overlays/cursors.json'],
            leaseOwnerRefs: ['computer-use:session/materialized/leases/screen.json'],
            proposalRef: 'computer-use:session/materialized/proposals/point.json',
          },
        ],
      },
    },
  }));

  assert.match(html, /class="virtual-screen-frame-image"/);
  assert.match(html, /src="\/api\/sciforge\/preview\/thumbnail\?ref=computer-use%3Asession%2Fmaterialized%2Fframes%2Fcurrent\.png"/);
  assert.match(html, /computer-use:session\/materialized\/frames\/current\.png/);
  assert.match(html, /computer-use:session\/materialized\/overlays\/cursors\.json/);
  assert.match(html, /computer-use:session\/materialized\/leases\/screen\.json/);
  assert.match(html, /computer-use:session\/materialized\/proposals\/point\.json/);
});

test('virtual-screen-viewer renders host frameUrl and frameDataRef sources without inline base64', () => {
  const frameUrlHtml = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Host Frame URL' },
    artifact: {
      id: 'host-frame-url',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        sessionRef: 'computer-use:session/host-url/manifest.json',
        frameRefs: [{
          ref: 'computer-use:session/host-url/frames/latest.png',
          frameUrl: '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Fhost-url%2Fframes%2Flatest.png',
          frameDataRef: 'computer-use:session/host-url/frame-data/latest.json',
          screenshotRef: 'computer-use:session/host-url/screenshots/latest.png',
        }],
      },
    },
  }));
  const frameDataRefHtml = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Host Frame Data Ref' },
    artifact: {
      id: 'host-frame-data-ref',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        sessionRef: 'computer-use:session/host-data/manifest.json',
        frameRefs: [{
          frameDataRef: '/api/sciforge/preview/raw?ref=computer-use%3Asession%2Fhost-data%2Fframes%2Flatest.png',
        }],
      },
    },
  }));

  assert.match(frameUrlHtml, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Fhost-url%2Fframes%2Flatest\.png"/);
  assert.match(frameUrlHtml, /data-frame-data-ref="computer-use:session\/host-url\/frame-data\/latest\.json"/);
  assert.match(frameUrlHtml, /data-screenshot-ref="computer-use:session\/host-url\/screenshots\/latest\.png"/);
  assert.match(frameDataRefHtml, /src="\/api\/sciforge\/preview\/raw\?ref=computer-use%3Asession%2Fhost-data%2Fframes%2Flatest\.png"/);
  assert.doesNotMatch(`${frameUrlHtml}\n${frameDataRefHtml}`, /data:image|base64/);
});

test('virtual-screen-viewer drops unsafe frame URLs instead of rendering raw screenshots or provider/private paths', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer({
    slot: { componentId: 'virtual-screen-viewer', title: 'Unsafe Frame' },
    artifact: {
      id: 'unsafe-frame',
      type: 'computer-use-virtual-screen',
      producerScenario: 'computer-use',
      schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
      data: {
        sessionRef: 'computer-use:session/unsafe/manifest.json',
        screenRef: 'computer-use:session/unsafe/screens.json#screen',
        frameRefs: [
          { ref: 'computer-use:session/unsafe/frames/latest.png', rawUrl: 'data:image/png;base64,abc' },
          { ref: 'computer-use:session/unsafe/frames/provider.png', framePreviewUrl: 'https://provider.example.test/v1?api_key=abc123.png' },
          { ref: 'computer-use:session/unsafe/frames/private.png', frameUrl: '/Users/alice/private/frame.png' },
        ],
      },
    },
  }));

  assert.match(html, /Frame preview unavailable/);
  assert.match(html, /computer-use:session\/unsafe\/frames\/latest\.png/);
  assert.match(html, /data-rejection-kind="unsafe-preview-url" data-rejected-field="frameRefs\[0\]\.rawUrl"/);
  assert.match(html, /data-rejection-kind="unsafe-preview-url" data-rejected-field="frameRefs\[1\]\.framePreviewUrl"/);
  assert.match(html, /data-rejection-kind="unsafe-preview-url" data-rejected-field="frameRefs\[2\]\.frameUrl"/);
  assert.doesNotMatch(html, /<img|data:image|base64,abc|provider\.example|api_key=abc123|\/Users\/alice/);
});

test('virtual-screen-viewer imports no Computer Use executor modules', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /packages\/actions\/computer-use|observe\/vision|src\/runtime\/computer-use|executeScoped|runComputerUse/);
});
