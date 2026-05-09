import assert from 'node:assert/strict';

import { buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope.js';
import type { GatewayRequest } from '../../src/runtime/runtime-types.js';

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Read the prior workspace artifact report, validate its schema, and render the report view.',
  artifacts: [{
    id: 'artifact.report-1',
    type: 'research-report',
    ref: 'artifact:artifact.report-1',
    title: 'Prior report',
    summary: 'Markdown report artifact that needs schema validation and rendering.',
    tags: ['report', 'markdown', 'workspace'],
  }],
  references: [{
    ref: 'artifact:artifact.report-1',
    kind: 'artifact',
    artifactType: 'research-report',
    title: 'Prior report',
  }],
  selectedComponentIds: ['report-viewer'],
  selectedVerifierIds: ['verifier.schema-artifact'],
  expectedArtifactTypes: ['research-report'],
  uiState: {
    selectedComponentIds: ['report-viewer'],
    selectedVerifierIds: ['verifier.schema-artifact'],
    currentReferences: [{
      ref: 'artifact:artifact.report-1',
      kind: 'artifact',
      artifactType: 'research-report',
      title: 'Prior report',
      summary: 'Current report ref.',
    }],
  },
};

const contextEnvelope = buildContextEnvelope(request, {
  workspace: '/tmp/sciforge-broker-payload-smoke',
  workspaceTreeSummary: [],
  priorAttempts: [],
  mode: 'full',
});
const scenarioFacts = contextEnvelope.scenarioFacts as Record<string, unknown>;
const brokerBrief = scenarioFacts.capabilityBrokerBrief as Record<string, unknown>;
const brokerText = JSON.stringify(brokerBrief);

assert.equal(brokerBrief.schemaVersion, 'sciforge.agentserver.capability-broker-brief.v1');
assert.equal(brokerBrief.contract, 'sciforge.capability-broker-output.v1');
assert.match(brokerText, /view\.report/);
assert.match(brokerText, /verifier\.schema/);
assert.equal(brokerText.includes('inputSchema'), false, 'broker brief must not expand full input schema');
assert.equal(brokerText.includes('outputSchema'), false, 'broker brief must not expand full output schema');
assert.equal(brokerText.includes('contract:example-input'), false, 'broker brief must not expand examples');
assert.equal(brokerText.includes('Regenerate payload according to this capability manifest contract'), false, 'broker brief must not expand repair hints');

const prompt = buildAgentServerGenerationPrompt({
  prompt: request.prompt,
  skillDomain: request.skillDomain,
  contextEnvelope,
  workspaceTreeSummary: [],
  availableSkills: [{
    id: 'legacy.full.skill',
    kind: 'installed',
    available: true,
    reason: 'OLD_FULL_SKILL_SENTINEL',
    description: 'OLD_FULL_SKILL_DESCRIPTION_SENTINEL',
    entrypointType: 'python',
    manifestPath: '/legacy/full/skill.json',
  }],
  availableTools: [{
    id: 'legacy.full.tool',
    label: 'Legacy Full Tool',
    toolType: 'tool',
    description: 'OLD_FULL_TOOL_DESCRIPTION_SENTINEL',
    producesArtifactTypes: ['legacy-artifact'],
    selected: true,
    docs: {
      readmePath: '/legacy/full/README.md',
      agentSummary: 'OLD_FULL_TOOL_DOC_SENTINEL',
    },
    packageRoot: '/legacy/full',
    requiredConfig: ['OLD_FULL_TOOL_CONFIG_SENTINEL'],
    tags: ['legacy'],
  }],
  availableRuntimeCapabilities: {
    schemaVersion: 'sciforge.runtime-capability-catalog.v1',
    skills: [{ id: 'legacy.full.skill', inputSchema: 'OLD_FULL_SCHEMA_SENTINEL' }],
    tools: [{ id: 'legacy.full.tool', examples: ['OLD_FULL_EXAMPLE_SENTINEL'] }],
    uiComponents: [{ componentId: 'legacy.full.view', requiredFields: ['OLD_FULL_VIEW_SENTINEL'] }],
  },
  artifactSchema: {},
  uiManifestContract: {},
  uiStateSummary: {},
  priorAttempts: [],
  expectedArtifactTypes: request.expectedArtifactTypes,
  selectedComponentIds: request.selectedComponentIds,
  freshCurrentTurn: true,
});

assert.match(prompt, /"schemaVersion": "sciforge\.agentserver\.capability-broker-brief\.v1"/);
assert.match(prompt, /"contract": "sciforge\.capability-broker-output\.v1"/);
assert.match(prompt, /"briefs"/);
assert.match(prompt, /view\.report/);
assert.equal(prompt.includes('sciforge.runtime-capability-catalog.v1'), false, 'legacy runtime capability catalog must be absent from default handoff');
assert.equal(prompt.includes('OLD_FULL_SKILL_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_SKILL_DESCRIPTION_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_TOOL_DESCRIPTION_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_TOOL_DOC_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_SCHEMA_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_EXAMPLE_SENTINEL'), false);
assert.equal(prompt.includes('OLD_FULL_VIEW_SENTINEL'), false);
assert.equal(prompt.includes('"availableSkills"'), false, 'default handoff must omit scattered skill list');
assert.equal(prompt.includes('"availableTools"'), false, 'default handoff must omit scattered tool list');
assert.equal(prompt.includes('"uiComponents"'), false, 'default handoff must omit full UI component list');

console.log('[ok] AgentServer handoff uses compact TypeScript broker briefs without legacy full capability dumps');
