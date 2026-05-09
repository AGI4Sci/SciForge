import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildScenarioLibraryState,
  promoteReusableTaskCandidate,
  promoteViewPresetCandidate,
  rejectViewPresetCandidate,
  type ScenarioLibraryState,
} from '@sciforge/scenario-core/scenario-library';
import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';

describe('scenario library promotion workflow', () => {
  it('builds library state and promotes view preset candidates', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const state = buildScenarioLibraryState([pkg], '2026-04-25T00:00:00.000Z');

    assert.equal(state.items[0].id, 'literature-evidence-review');
    assert.equal(state.viewPresetCandidates[0].promotionState, 'candidate');

    const promoted = promoteViewPresetCandidate(state, state.viewPresetCandidates[0].id);
    assert.equal(promoted.viewPresetCandidates[0].promotionState, 'promoted');

    const rejected = rejectViewPresetCandidate(promoted, state.viewPresetCandidates[0].id);
    assert.equal(rejected.viewPresetCandidates[0].promotionState, 'rejected');
  });

  it('promotes reusable task candidates without changing unrelated candidates', () => {
    const state: ScenarioLibraryState = {
      schemaVersion: 1,
      generatedAt: '2026-04-25T00:00:00.000Z',
      items: [],
      reusableTaskCandidates: [
        { id: 'task-a', successCount: 3, promotionState: 'candidate' },
        { id: 'task-b', successCount: 1, promotionState: 'candidate' },
      ],
      viewPresetCandidates: [],
    };

    const promoted = promoteReusableTaskCandidate(state, 'task-a');
    assert.equal(promoted.reusableTaskCandidates[0].promotionState, 'promoted');
    assert.equal(promoted.reusableTaskCandidates[1].promotionState, 'candidate');
  });
});
