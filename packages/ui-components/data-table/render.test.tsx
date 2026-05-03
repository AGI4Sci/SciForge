import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { manifest } from './manifest';
import { basicDataTableFixture, emptyDataTableFixture } from './fixtures/basic';
import { renderDataTable } from './render';

test('data-table package exposes manifest and renders basic rows', () => {
  assert.equal(manifest.componentId, 'data-table');
  const html = renderToStaticMarkup(<>{renderDataTable(basicDataTableFixture)}</>);
  assert.match(html, /TP53/);
  assert.match(html, /EGFR/);
  assert.doesNotMatch(html, /BRCA1/);
});

test('data-table package renders empty state through shell helper', () => {
  const html = renderToStaticMarkup(<>{renderDataTable({
    ...emptyDataTableFixture,
    helpers: {
      ComponentEmptyState: ({ componentId }) => <p>empty {componentId}</p>,
    },
  })}</>);
  assert.match(html, /empty data-table/);
});
