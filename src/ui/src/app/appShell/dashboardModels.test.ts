import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scenarioDashboardPrimaryImportAction,
  scenarioSkillDomainFilterOptions,
} from '@sciforge/scenario-core/scenario-builder-display-policy';
import { buildDashboardLibraryItems } from './dashboardModels';

test('dashboard library consumes package-owned default import scenario display', () => {
  const items = buildDashboardLibraryItems([]);
  const primary = items.find((item) => item.builtInScenarioId === scenarioDashboardPrimaryImportAction.scenarioId);

  assert.ok(primary);
  assert.equal(primary.id, scenarioDashboardPrimaryImportAction.scenarioId);
  assert.equal(primary.source, 'built-in');
});

test('dashboard domain filter options come from scenario package policy', () => {
  assert.deepEqual(
    scenarioSkillDomainFilterOptions().map((option) => option.value),
    buildDashboardLibraryItems([]).map((item) => item.skillDomain),
  );
});
