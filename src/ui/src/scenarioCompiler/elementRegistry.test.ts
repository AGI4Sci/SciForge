import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { compileUIPlanForScenario } from './uiPlanCompiler';
import { buildElementRegistry, validateElementRegistry } from './elementRegistry';

describe('element registry', () => {
  it('builds unique manifests for skills, artifacts, components, and policies', () => {
    const registry = buildElementRegistry();
    const report = validateElementRegistry(registry);

    assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
    assert.ok(registry.skills.some((skill) => skill.id === 'literature.pubmed_search'));
    assert.ok(registry.skills.some((skill) => skill.id === 'literature.web_search'));
    assert.ok(registry.skills.some((skill) => skill.id === 'agentserver.generate.literature'));
    assert.ok(registry.skills.some((skill) => skill.id.startsWith('scp.')));
    assert.ok(registry.artifacts.some((artifact) => artifact.artifactType === 'paper-list'));
    assert.ok(registry.artifacts.some((artifact) => artifact.artifactType === 'research-report'));
    assert.ok(registry.components.some((component) => component.componentId === 'report-viewer'));
    assert.ok(registry.components.some((component) => component.componentId === 'unknown-artifact-inspector'));
    assert.ok(registry.failurePolicies.some((policy) => policy.failureMode === 'schema-mismatch'));
  });

  it('connects every built-in scenario artifact to at least one producer and inspector fallback', () => {
    const registry = buildElementRegistry();
    for (const spec of Object.values(SCENARIO_SPECS)) {
      for (const artifactSchema of spec.outputArtifacts) {
        const artifact = registry.artifacts.find((item) => item.artifactType === artifactSchema.type);
        assert.ok(artifact, `missing artifact element for ${artifactSchema.type}`);
        assert.ok(artifact.producerSkillIds.length, `missing producer for ${artifactSchema.type}`);
        assert.ok(artifact.consumerComponentIds.includes('unknown-artifact-inspector'), `missing inspector fallback for ${artifactSchema.type}`);
      }
    }
  });

  it('requires every UI component to define empty state copy and recovery actions', () => {
    const registry = buildElementRegistry();
    for (const component of registry.components) {
      assert.ok(component.emptyState.title.trim(), `missing emptyState.title for ${component.componentId}`);
      assert.ok(component.emptyState.detail.trim(), `missing emptyState.detail for ${component.componentId}`);
      assert.ok(component.recoverActions.length, `missing recoverActions for ${component.componentId}`);
    }
  });

  it('compiles default UI plans equivalent to built-in scenario default slots', () => {
    for (const scenario of scenarios) {
      const scenarioId = scenario.id as ScenarioId;
      const plan = compileUIPlanForScenario(scenarioId);
      const expectedSlots = SCENARIO_SPECS[scenarioId].defaultSlots;

      assert.deepEqual(
        plan.slots.map((slot) => slot.componentId),
        expectedSlots.map((slot) => slot.componentId),
      );
      assert.equal(plan.fallbacks.unknownArtifact, 'unknown-artifact-inspector');
    }
  });

  it('falls back when a preferred specialized component is unavailable', () => {
    const registry = buildElementRegistry();
    const plan = compileUIPlanForScenario('omics-differential-exploration', {
      ...registry,
      components: registry.components.filter((component) => component.componentId !== 'volcano-plot'),
    });

    const firstSlot = plan.slots[0];
    assert.equal(firstSlot.artifactRef, 'omics-differential-expression');
    assert.notEqual(firstSlot.componentId, 'volcano-plot');
    assert.ok(['heatmap-viewer', 'umap-viewer', 'data-table', 'unknown-artifact-inspector'].includes(firstSlot.componentId));
  });
});
