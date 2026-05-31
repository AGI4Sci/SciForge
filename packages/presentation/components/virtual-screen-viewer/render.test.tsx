import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { basicVirtualScreenViewerFixture } from './fixtures/basic';
import { emptyVirtualScreenViewerFixture } from './fixtures/empty';
import { manifest } from './manifest';
import { renderVirtualScreenViewer } from './render';

test('virtual-screen-viewer renders refs-first screen state and actor cursors', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(basicVirtualScreenViewerFixture));

  assert.equal(manifest.componentId, 'virtual-screen-viewer');
  assert.match(html, /virtual-screen-viewer/);
  assert.match(html, /data-render-boundary="presentation-only"/);
  assert.match(html, /computer-use:session\/basic\/virtual-desktop-session-manifest\.json/);
  assert.match(html, /computer-use:session\/basic\/frames\/latest\.png/);
  assert.match(html, /User/);
  assert.match(html, /Agent/);
  assert.match(html, /shared input/);
  assert.match(html, /\/computer-use observe --screen-ref/);
  assert.doesNotMatch(html, /data:image|base64|executorLease|providerRoute|desktopBridge/);
});

test('virtual-screen-viewer shows empty state without fabricating a screen', () => {
  const html = renderToStaticMarkup(renderVirtualScreenViewer(emptyVirtualScreenViewerFixture));

  assert.match(html, /data-status="empty"/);
  assert.match(html, /Virtual screen refs are not attached/);
  assert.doesNotMatch(html, /virtual-screen-frame-ref/);
});

test('virtual-screen-viewer imports no Computer Use executor modules', () => {
  const source = readFileSync(new URL('./render.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /packages\/actions\/computer-use|observe\/vision|src\/runtime\/computer-use|executeScoped|runComputerUse|desktopBridge|providerRoute|schedulerParams/);
});
