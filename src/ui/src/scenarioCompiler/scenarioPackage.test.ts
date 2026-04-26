import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { compileScenarioDraft } from './scenarioDraftCompiler';
import { compileScenarioIRFromSelection, recommendScenarioElements } from './scenarioElementCompiler';
import { buildBuiltInScenarioPackage } from './scenarioPackage';
import { compileSkillPlan } from './skillPlanCompiler';
import { validateScenarioPackage } from './validationGate';

describe('scenario compiler package model', () => {
  it('exports each built-in scenario as a published scenario package', () => {
    for (const scenario of scenarios) {
      const scenarioId = scenario.id as ScenarioId;
      const pkg = buildBuiltInScenarioPackage(scenarioId, '2026-04-25T00:00:00.000Z');
      const spec = SCENARIO_SPECS[scenarioId];

      assert.equal(pkg.schemaVersion, '1');
      assert.equal(pkg.status, 'published');
      assert.equal(pkg.scenario.id, scenarioId);
      assert.equal(pkg.scenario.skillDomain, spec.skillDomain);
      assert.deepEqual(pkg.scenario.outputArtifacts.map((artifact) => artifact.type), spec.outputArtifacts.map((artifact) => artifact.type));
      assert.deepEqual(pkg.uiPlan.slots.map((slot) => slot.componentId), spec.defaultSlots.map((slot) => slot.componentId));
      assert.ok(pkg.skillPlan.skillIRs.length);
      assert.equal(validateScenarioPackage(pkg, undefined, '2026-04-25T00:00:00.000Z').ok, true);
      assert.ok(pkg.versions[0].scenarioHash);
    }
  });

  it('compiles user descriptions into scenario drafts without touching runtime', () => {
    const draft = compileScenarioDraft('分析单细胞RNA表达矩阵，展示UMAP、热图和差异基因火山图');

    assert.equal(draft.skillDomain, 'omics');
    assert.equal(draft.baseScenarioId, 'omics-differential-exploration');
    assert.ok(draft.defaultComponents.includes('umap-viewer'));
    assert.match(draft.scenarioMarkdown, /输出 artifact/);
  });

  it('compiles skill plans with route options for seed and generated skill paths', () => {
    const plan = compileSkillPlan(['literature.pubmed_search', 'scp.biomarker_discovery']);

    assert.ok(plan.skillIRs.some((skill) => skill.skillId === 'literature.pubmed_search'));
    assert.ok(plan.skillIRs.some((skill) => skill.skillId === 'scp.biomarker_discovery'));
    assert.ok(plan.routeOptions.some((route) => route.skillId === 'literature.pubmed_search' && route.runtimeProfileId === 'seed-skill'));
    assert.ok(plan.routeOptions.some((route) => route.skillId === 'scp.biomarker_discovery' && route.runtimeProfileId === 'scp-hub'));
  });

  it('reports blocking validation errors for packages without selected producers', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const broken = {
      ...pkg,
      scenario: {
        ...pkg.scenario,
        selectedSkillIds: [],
      },
    };
    const report = validateScenarioPackage(broken, undefined, '2026-04-25T00:00:00.000Z');

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'missing-selected-producer'));
  });

  it('compiles manual element selections into a workspace scenario package', () => {
    const result = compileScenarioIRFromSelection({
      id: 'custom-literature-review',
      title: 'Custom literature review',
      description: 'Review PubMed evidence and show papers with evidence claims.',
      selectedSkillIds: ['literature.pubmed_search'],
      selectedArtifactTypes: ['paper-list'],
      selectedComponentIds: ['paper-card-list', 'evidence-matrix', 'unknown-artifact-inspector'],
      selectedToolIds: ['tool.pubmed'],
    });

    assert.equal(result.scenario.id, 'custom-literature-review');
    assert.equal(result.scenario.skillDomain, 'literature');
    assert.deepEqual(result.scenario.selectedSkillIds, ['literature.pubmed_search']);
    assert.equal(result.uiPlan.scenarioId, 'custom-literature-review');
    assert.equal(result.package.validationReport?.ok, true);
    assert.equal(result.validationReport.ok, true);
  });

  it('returns compiler diagnostics for selections that cannot produce requested artifacts', () => {
    const result = compileScenarioIRFromSelection({
      id: 'broken-structure-review',
      title: 'Broken sequence review',
      description: 'Show a sequence alignment artifact without selecting a sequence-producing skill.',
      selectedSkillIds: ['literature.pubmed_search'],
      selectedArtifactTypes: ['sequence-alignment'],
      selectedComponentIds: ['data-table', 'unknown-artifact-inspector'],
    });

    assert.equal(result.validationReport.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'missing-producer' || issue.code === 'ambiguous-skill'));
    assert.ok(result.validationReport.issues.some((issue) => issue.code === 'missing-selected-producer' || issue.code === 'missing-producer' || issue.code === 'ambiguous-skill'));
  });

  it('keeps AgentServer recommendation as an optional placeholder with offline heuristic fallback', () => {
    const recommendation = recommendScenarioElements('分析单细胞RNA表达矩阵并展示UMAP和火山图', undefined, {
      allowAgentServer: true,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
    });

    assert.equal(recommendation.source, 'agentserver-placeholder');
    assert.ok(recommendation.selectedSkillIds.some((skillId) => skillId.includes('omics')));
    assert.ok(recommendation.selectedArtifactTypes.includes('omics-differential-expression'));
    assert.ok(recommendation.selectedComponentIds.includes('volcano-plot'));
  });

  it('compiles open-ended arXiv report scenarios through generated backend capability and report UI', () => {
    const description = '帮我生成一个场景，可以按照要求搜索arxiv上最新的文章，并且下载、阅读、系统性总结成报告';
    const recommendation = recommendScenarioElements(description);
    const result = compileScenarioIRFromSelection({
      id: 'arxiv-report-review',
      title: 'arXiv latest paper report',
      description,
      skillDomain: 'literature',
      scenarioMarkdown: description,
      ...recommendation,
    });

    assert.ok(recommendation.selectedSkillIds.includes('agentserver.generate.literature'));
    assert.ok(recommendation.selectedArtifactTypes.includes('paper-list'));
    assert.ok(recommendation.selectedArtifactTypes.includes('research-report'));
    assert.ok(recommendation.selectedComponentIds.includes('report-viewer'));
    assert.equal(result.validationReport.ok, true);
  });

  it('uses the same generated capability path for complex non-literature scenario compilation', () => {
    const description = '生成一个蛋白结构场景，下载AlphaFold结构，分析结合口袋，并输出系统性报告';
    const recommendation = recommendScenarioElements(description);
    const result = compileScenarioIRFromSelection({
      id: 'structure-pocket-report',
      title: 'Structure pocket report',
      description,
      skillDomain: 'structure',
      scenarioMarkdown: description,
      ...recommendation,
    });

    assert.ok(recommendation.selectedSkillIds.includes('agentserver.generate.structure'));
    assert.ok(recommendation.selectedArtifactTypes.includes('structure-summary'));
    assert.ok(recommendation.selectedArtifactTypes.includes('research-report'));
    assert.ok(recommendation.selectedComponentIds.includes('report-viewer'));
    assert.equal(result.validationReport.ok, true);
  });

  it('does not infer paper-list just because a structure scenario asks for evidence matrix', () => {
    const description = '全新场景：根据 PDB 1A3N 获取蛋白结构，展示分子结构查看器、链/残基摘要、证据矩阵和可复现 ExecutionUnit。';
    const recommendation = recommendScenarioElements(description);

    assert.ok(recommendation.selectedArtifactTypes.includes('structure-summary'));
    assert.ok(recommendation.selectedComponentIds.includes('molecule-viewer'));
    assert.ok(recommendation.selectedComponentIds.includes('evidence-matrix'));
    assert.equal(recommendation.selectedArtifactTypes.includes('paper-list'), false);
    assert.equal(recommendation.selectedComponentIds.includes('paper-card-list'), false);
  });
});
