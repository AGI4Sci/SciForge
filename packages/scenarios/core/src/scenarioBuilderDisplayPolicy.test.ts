import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scenarioBuilderDefaultPrompt,
  scenarioBuilderComponentDisplay,
  scenarioBuilderDraftPreviewModel,
  scenarioDashboardPrimaryImportAction,
  scenarioPackageExportFileName,
  scenarioPackagePreviewFields,
  scenarioBuilderQualityChecklistText,
  scenarioBuilderRecommendationReasons,
  scenarioSkillDomainFilterOptions,
} from './scenarioBuilderDisplayPolicy';
import { compileScenarioDraft } from './scenarioDraftCompiler';
import { SCENARIO_SPECS } from './scenarioSpecs';

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

  it('owns dashboard default scenario and domain option display policy', () => {
    assert.equal(scenarioDashboardPrimaryImportAction.scenarioId, 'literature-evidence-review');
    assert.equal(scenarioDashboardPrimaryImportAction.label, '导入文献场景');

    const domainOptions = scenarioSkillDomainFilterOptions();
    assert.deepEqual(domainOptions.map((option) => option.value), ['literature', 'structure', 'omics', 'knowledge']);
    assert.equal(domainOptions[0].scenarioTitle, SCENARIO_SPECS['literature-evidence-review'].title);
  });

  it('formats dashboard package preview fields from package policy', () => {
    const fields = scenarioPackagePreviewFields({
      title: 'Workspace review',
      skillDomain: 'literature',
      qualityLabel: 'quality pass',
      exportFileName: scenarioPackageExportFileName({ id: 'workspace-review', version: '1.0.0' }),
    });

    assert.deepEqual(fields.map((field) => field.label), ['scenario', 'domain', 'quality', 'export file']);
    assert.deepEqual(fields.map((field) => field.value), ['Workspace review', 'literature', 'quality pass', 'workspace-review-1.0.0.scenario-package.json']);
  });

  it('turns scenario builder draft ids into display tokens for UI preview', () => {
    const draft = compileScenarioDraft(scenarioBuilderDefaultPrompt);
    const preview = scenarioBuilderDraftPreviewModel(draft);

    assert.equal(preview.title, draft.title);
    assert.match(preview.summary, /confidence/);
    assert.ok(preview.componentTokens.some((token) => token.id === 'paper-card-list' && token.label !== token.id));
    assert.ok(preview.artifactTokens.some((token) => token.id === 'paper-list' && token.label !== token.id));
    assert.ok(preview.skillTokens.length > 0);
  });
});
