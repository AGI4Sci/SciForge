import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMatrixViewer } from './render';
import { basicMatrixViewerFixture } from './fixtures/basic';
const html = renderToStaticMarkup(renderMatrixViewer(basicMatrixViewerFixture));
assert.match(html, /matrix-viewer/);
assert.match(html, /IFIT1/);
