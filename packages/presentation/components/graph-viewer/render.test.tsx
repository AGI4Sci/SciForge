import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderGraphViewer } from './render';
import { basicGraphViewerFixture } from './fixtures/basic';
const html = renderToStaticMarkup(renderGraphViewer(basicGraphViewerFixture));
assert.match(html, /graph-viewer/);
assert.match(html, /BRAF/);
