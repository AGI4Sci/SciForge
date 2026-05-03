import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { renderRecordTable } from './render';
import { basicRecordTableFixture } from './fixtures/basic';

const html = renderToStaticMarkup(renderRecordTable(basicRecordTableFixture));
assert.match(html, /record-table/);
assert.match(html, /S001/);
