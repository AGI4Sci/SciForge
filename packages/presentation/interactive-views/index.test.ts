import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  interactiveViewCompatibilityAliases,
  interactiveViewManifests,
  uiComponentCompatibilityAliases,
  uiComponentManifests,
} from './index';

test('interactive views alias preserves ui-components registry compatibility', () => {
  assert.equal(interactiveViewManifests, uiComponentManifests);
  assert.equal(interactiveViewCompatibilityAliases, uiComponentCompatibilityAliases);
  assert.ok(interactiveViewManifests.some((manifest) => manifest.componentId === 'record-table'));
  assert.ok(uiComponentCompatibilityAliases.some((alias) => alias.legacyComponentId === 'data-table'));
});
