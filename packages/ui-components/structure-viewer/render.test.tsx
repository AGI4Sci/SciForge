import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderStructureViewer } from './render';
import { basicStructureViewerFixture } from './fixtures/basic';
const html = renderToStaticMarkup(renderStructureViewer(basicStructureViewerFixture));
assert.match(html, /structure-viewer/);
assert.match(html, /1CRN/);
