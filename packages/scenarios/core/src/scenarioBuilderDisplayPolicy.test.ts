import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scenarioBuilderComponentDisplay,
  scenarioBuilderQualityChecklistText,
  scenarioBuilderRecommendationReasons,
} from './scenarioBuilderDisplayPolicy';

describe('scenario builder display policy', () => {
  it('owns builder readiness copy in the scenario package boundary', () => {
    assert.match(scenarioBuilderQualityChecklistText, /producer\/consumer/);
    assert.match(scenarioBuilderQualityChecklistText, /fallback/);
    assert.match(scenarioBuilderQualityChecklistText, /package quality gate/);
  });

  it('describes recommendation slots using registry component policy', () => {
    const reasons = scenarioBuilderRecommendationReasons({
      selection: {
        skillDomain: 'literature',
        selectedSkillIds: ['agentserver.generate.literature'],
        selectedArtifactTypes: ['paper-list', 'research-report'],
      },
      scenario: {
        skillDomain: 'literature',
        fallbackComponent: 'unknown-artifact-inspector',
      },
      uiSlotCount: 2,
      skillStepCount: 1,
    });

    assert.ok(reasons.some((reason) => reason.includes('Artifact inspector')));
    assert.ok(reasons.some((reason) => reason.includes('unknown-artifact-inspector')));
  });

  it('derives known component display metadata from component manifests', () => {
    const display = scenarioBuilderComponentDisplay('report-viewer');

    assert.equal(display.label, 'Markdown report document');
    assert.match(display.detail, /report/i);
    assert.match(display.meta, /accepts/);
    assert.match(display.meta, /fields/);
    assert.match(display.meta, /fallback/);
  });

  it('derives unregistered component metadata from registry inspection policy', () => {
    const display = scenarioBuilderComponentDisplay('workspace-only-viewer');

    assert.equal(display.label, 'workspace-only-viewer');
    assert.match(display.detail, /Artifact inspector/);
    assert.match(display.meta, /unknown-artifact-inspector/);
  });
});
