import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  copyScenarioPackageForWorkspace,
  renameScenarioPackageForImport,
  scenarioBuilderChromeFallbackPane,
  scenarioBuilderChromeNavItems,
  scenarioBuilderChromePaneIds,
  scenarioBuilderDefaultPrompt,
  scenarioBuilderComponentDisplay,
  scenarioBuilderComponentSelectorCopy,
  scenarioBuilderComponentSelectorOptions,
  scenarioBuilderDraftPreviewModel,
  scenarioBuilderElementSelectorRegistryAriaLabel,
  scenarioBuilderElementSelectorSummary,
  scenarioBuilderPackageForWorkspaceSave,
  scenarioBuilderPrioritizeBySelectionAndDomain,
  scenarioDashboardPrimaryImportAction,
  scenarioDefaultElementSelectionForRuntimeOverride,
  scenarioPackageCopyId,
  scenarioPackageExportFileName,
  scenarioPackageIdentityLabel,
  scenarioPackageManifestPreview,
  scenarioPackagePreviewFields,
  scenarioPackageRefLabel,
  scenarioPackageToRuntimeOverride,
  scenarioPackageValidationSummary,
  scenarioReportViewerEmptyStatePolicy,
  scenarioBuilderQualityChecklistText,
  scenarioBuilderRecommendationReasons,
  scenarioSkillDomainFilterOptions,
} from './scenarioBuilderDisplayPolicy';
import { compileScenarioDraft } from './scenarioDraftCompiler';
import { elementRegistry } from './elementRegistry';
import { SCENARIO_SPECS } from './scenarioSpecs';
import { buildBuiltInScenarioPackage } from './scenarioPackage';

describe('scenario builder display policy', () => {
  it('owns chrome pane ids and labels for the embedded builder shell', () => {
    const withoutAgentRuntime = scenarioBuilderChromeNavItems();
    const withAgentRuntime = scenarioBuilderChromeNavItems({ includeAgentRuntimeUi: true });

    assert.deepEqual(withoutAgentRuntime.map((item) => item.id), [
      scenarioBuilderChromePaneIds.sceneInfo,
      scenarioBuilderChromePaneIds.scenarioPackageUi,
      scenarioBuilderChromePaneIds.skills,
      scenarioBuilderChromePaneIds.tools,
      scenarioBuilderChromePaneIds.artifacts,
      scenarioBuilderChromePaneIds.failurePolicies,
      scenarioBuilderChromePaneIds.contract,
      scenarioBuilderChromePaneIds.quality,
      scenarioBuilderChromePaneIds.publish,
    ]);
    assert.deepEqual(withAgentRuntime.slice(0, 3).map((item) => item.id), [
      scenarioBuilderChromePaneIds.sceneInfo,
      scenarioBuilderChromePaneIds.agentRuntimeUi,
      scenarioBuilderChromePaneIds.scenarioPackageUi,
    ]);
    assert.ok(withAgentRuntime.some((item) => item.label === '场景 UI allowlist'));
  });

  it('keeps chrome fallback policy next to pane ids', () => {
    assert.equal(
      scenarioBuilderChromeFallbackPane({ pane: scenarioBuilderChromePaneIds.agentRuntimeUi }),
      scenarioBuilderChromePaneIds.scenarioPackageUi,
    );
    assert.equal(
      scenarioBuilderChromeFallbackPane({
        pane: scenarioBuilderChromePaneIds.agentRuntimeUi,
        includeAgentRuntimeUi: true,
      }),
      scenarioBuilderChromePaneIds.agentRuntimeUi,
    );
  });

  it('owns scenario package allowlist selector display policy', () => {
    const reportViewer = elementRegistry.components.find((component) => component.componentId === 'report-viewer');
    assert.ok(reportViewer);
    const options = scenarioBuilderComponentSelectorOptions([reportViewer]);

    assert.equal(scenarioBuilderComponentSelectorCopy.scenarioPackageUi.title, '场景 UI allowlist（Scenario package）');
    assert.match(scenarioBuilderComponentSelectorCopy.scenarioPackageUi.description, /defaultComponents/);
    assert.equal(options[0].id, 'report-viewer');
    assert.equal(options[0].label, 'Markdown report document');
    assert.match(options[0].meta ?? '', /fallback/);
    assert.equal(scenarioBuilderElementSelectorSummary({
      selectedCount: 2,
      visibleCount: 3,
      totalCount: 5,
      excludedCount: 1,
    }), '2 selected · 3/5 shown · 1 excluded');
    assert.equal(
      scenarioBuilderElementSelectorRegistryAriaLabel(scenarioBuilderComponentSelectorCopy.scenarioPackageUi.title),
      '场景 UI allowlist（Scenario package） registry',
    );
  });

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
    assert.equal(scenarioPackageIdentityLabel({ id: 'workspace-review', version: '1.0.0' }), 'workspace-review@1.0.0');
    assert.equal(scenarioPackageRefLabel({ id: 'workspace-review', version: '1.0.0', source: 'workspace' }, { includeSource: true }), 'workspace-review@1.0.0:workspace');
    assert.equal(scenarioPackageRefLabel(undefined), 'n/a');
  });

  it('owns report viewer empty state package ids and copy', () => {
    assert.deepEqual(scenarioReportViewerEmptyStatePolicy({ hasArtifact: false }), {
      componentId: 'report-viewer',
      artifactType: 'research-report',
      detail: undefined,
    });
    assert.match(scenarioReportViewerEmptyStatePolicy({ hasArtifact: true }).detail ?? '', /markdown\/report\/sections/);
  });

  it('owns package validation and workspace save display policy', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const validationReport = { ok: false, checkedAt: '2026-05-10T00:00:00.000Z', issues: [] };
    const saved = scenarioBuilderPackageForWorkspaceSave({
      package: pkg,
      status: 'published',
      validationReport,
      qualityReport: {
        ok: true,
        checkedAt: '2026-05-10T00:00:00.000Z',
        packageRef: { id: pkg.id, version: pkg.version, status: 'published' },
        items: [],
        validationReport,
      },
      recommendationReasons: ['reason'],
      builderStep: 'publish',
      selection: {
        skillDomain: 'literature',
        selectedSkillIds: ['agentserver.generate.literature'],
        selectedToolIds: ['tool.pubmed'],
        selectedComponentIds: ['paper-card-list'],
        selectedArtifactTypes: ['paper-list'],
      },
      fallbackSkillDomain: 'literature',
    });

    assert.equal(scenarioPackageValidationSummary({ package: pkg, validationReport }), 'literature-evidence-review@1.0.0 · needs fixes');
    assert.equal(saved.status, 'published');
    assert.deepEqual(saved.metadata?.recommendationReasons, ['reason']);
    assert.deepEqual((saved.metadata?.compiledFrom as { selectedArtifactTypes?: string[] }).selectedArtifactTypes, ['paper-list']);
  });

  it('owns dashboard package import and copy ids in package policy', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');

    assert.equal(scenarioPackageCopyId(pkg, 123456), 'literature-evidence-review-copy-2n9c');

    const copy = copyScenarioPackageForWorkspace(pkg, 'literature-copy');
    assert.equal(copy.id, 'literature-copy');
    assert.equal(copy.status, 'draft');
    assert.equal(copy.scenario.id, 'literature-copy');
    assert.equal(copy.scenario.source, 'workspace');
    assert.match(copy.scenario.title, / copy$/);

    const renamed = renameScenarioPackageForImport(
      { ...pkg, status: 'archived' },
      'literature-import',
      '2026-05-10T00:00:00.000Z',
    );
    assert.equal(renamed.status, 'draft');
    assert.equal(renamed.scenario.id, 'literature-import');
    assert.equal(renamed.versions[0].createdAt, '2026-05-10T00:00:00.000Z');
    assert.equal(renamed.versions[0].scenarioHash, 'import-literature-import');
  });

  it('builds dashboard package export preview from package policy', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const preview = scenarioPackageManifestPreview(pkg, '/Applications/workspace/demo');

    assert.equal(preview.qualityLabel, 'quality pass');
    assert.equal(preview.manifest.id, 'literature-evidence-review');
    assert.deepEqual(preview.manifest.uiPlan.components, pkg.uiPlan.compiledFrom.componentIds);
    assert.deepEqual(preview.manifest.tests[0].expectedArtifactTypes, pkg.tests[0].expectedArtifactTypes);
  });

  it('maps scenario packages into runtime override policy', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const override = scenarioPackageToRuntimeOverride(pkg);

    assert.deepEqual(override.defaultComponents, pkg.scenario.selectedComponentIds);
    assert.deepEqual(override.scenarioPackageRef, { id: pkg.id, version: pkg.version, source: 'workspace' });
    assert.equal(override.skillPlanRef, pkg.skillPlan.id);
  });

  it('owns builder default selection and selector ordering policy', () => {
    const spec = SCENARIO_SPECS['omics-differential-exploration'];
    const selection = scenarioDefaultElementSelectionForRuntimeOverride('omics-differential-exploration', {
      title: spec.title,
      description: spec.description,
      skillDomain: spec.skillDomain,
      scenarioMarkdown: spec.scenarioMarkdown,
      defaultComponents: spec.componentPolicy.defaultComponents,
      allowedComponents: spec.componentPolicy.allowedComponents,
      fallbackComponent: spec.componentPolicy.fallbackComponent,
    });
    const ordered = scenarioBuilderPrioritizeBySelectionAndDomain([
      { id: 'structure-secondary', skillDomains: ['structure'] },
      { id: 'omics-selected', skillDomains: ['structure'] },
      { id: 'omics-domain', skillDomains: ['omics'] },
    ], ['omics-selected'], 'omics');

    assert.equal(selection.skillDomain, 'omics');
    assert.ok(selection.selectedArtifactTypes.length > 0);
    assert.deepEqual(ordered.map((item) => item.id), ['omics-selected', 'omics-domain', 'structure-secondary']);
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
