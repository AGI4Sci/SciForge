import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderPointSetViewer } from './render';
import { basicPointSetViewerFixture } from './fixtures/basic';
const html = renderToStaticMarkup(renderPointSetViewer(basicPointSetViewerFixture));
assert.match(html, /point-set-viewer/);
assert.match(html, /IFIT1/);
