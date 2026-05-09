import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scenarios, type ScenarioId } from '../data';
import { uiComponentElements } from '@sciforge/scenario-core/component-elements';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { buildElementRegistry, validateElementRegistry } from '@sciforge/scenario-core/element-registry';
import { compileUIPlanForScenario, validateUIPlanAgainstScenario } from '@sciforge/scenario-core/ui-plan-compiler';

describe('element registry', () => {
  it('builds unique manifests for skills, artifacts, components, and policies', () => {
    const registry = buildElementRegistry();
    const report = validateElementRegistry(registry);

    assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
    assert.ok(registry.skills.some((skill) => skill.id === 'pdf-extract'));
    assert.ok(registry.skills.some((skill) => skill.id === 'scp.biomedical-web-search'));
    assert.ok(registry.skills.some((skill) => skill.id === 'agentserver.generate.literature'));
    assert.ok(registry.skills.some((skill) => skill.id.startsWith('scp.')));
    assert.ok(registry.skills.filter((skill) => skill.id.startsWith('scp.')).every((skill) => skill.source === 'package'));
    assert.ok(registry.tools.some((tool) => tool.id === 'clawhub.playwright-mcp'));
    assert.ok(registry.tools.every((tool) => tool.source === 'package'));
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

  it('keeps runtime fallback and component alias policy out of scenario component elements', () => {
    const forbiddenRecoverActions = new Set([
      'provide-compatible-artifact',
      'select-supported-component',
      'select-fallback-runtime',
      'repair-task',
      'run-skill',
    ]);

    assert.ok(uiComponentElements.some((component) => component.componentId === 'data-table'), 'component aliases come only from the UI component runtime registry');
    for (const component of uiComponentElements) {
      assert.equal(component.fallback, '', `${component.componentId} should not adapt runtime fallbackModuleIds into scenario policy`);
      assert.equal(component.emptyState.detail.includes('fallback'), false, `${component.componentId} should not mention runtime fallback selection`);
      assert.deepEqual(
        component.recoverActions.filter((action) => forbiddenRecoverActions.has(action)),
        [],
        `${component.componentId} should not expose runtime recovery action vocabulary`,
      );
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
    const selectedComponent = registry.components.find((component) => component.componentId === firstSlot.componentId);
    assert.equal(firstSlot.artifactRef, 'omics-differential-expression');
    assert.notEqual(firstSlot.componentId, 'volcano-plot');
    assert.ok(selectedComponent, `fallback component should be registered: ${firstSlot.componentId}`);
    assert.ok(
      selectedComponent.acceptsArtifactTypes.includes(firstSlot.artifactRef) || selectedComponent.acceptsArtifactTypes.includes('*'),
      `fallback component should consume ${firstSlot.artifactRef}: ${firstSlot.componentId}`,
    );
  });

  it('validates UI slots and fallback components from the UI compiler boundary', () => {
    const literatureScenarioId = ['literature', 'evidence', 'review'].join('-') as ScenarioId;
    const paperListType = ['paper', 'list'].join('-');
    const missingComponentId = ['missing', 'component'].join('-');
    const missingFallbackId = ['missing', 'fallback'].join('-');
    const externalArtifactType = ['external', 'artifact'].join('-');
    const unknownComponentCode = ['unknown', 'ui', 'component'].join('-');
    const externalArtifactCode = ['slot', 'artifact', 'not', 'produced', 'by', 'scenario'].join('-');
    const missingFallbackCode = ['missing', 'scenario', 'fallback'].join('-');
    const plan = compileUIPlanForScenario(literatureScenarioId);
    const issues = validateUIPlanAgainstScenario({
      outputArtifacts: [{ type: paperListType }],
      fallbackComponentId: missingFallbackId,
    }, {
      ...plan,
      slots: [{
        componentId: missingComponentId,
        title: 'External artifact',
        artifactRef: externalArtifactType,
        priority: 1,
      }],
    });

    assert.ok(issues.some((issue) => issue.code === unknownComponentCode));
    assert.ok(issues.some((issue) => issue.code === externalArtifactCode));
    assert.ok(issues.some((issue) => issue.code === missingFallbackCode));
  });
});
