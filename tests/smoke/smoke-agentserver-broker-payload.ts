import assert from 'node:assert/strict';

import { buildAgentServerCompactContext, buildAgentServerGenerationPrompt } from '../../src/runtime/gateway/agentserver-prompts.js';
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
    agentHarnessContextEnvelopeEnabled: true,
    allowedContextRefs: ['artifact:legacy-context-sentinel'],
    blockedContextRefs: ['artifact:artifact.report-1'],
    contextBudget: { maxReferenceDigests: 0 },
    currentReferences: [{
      ref: 'artifact:artifact.report-1',
      kind: 'artifact',
      artifactType: 'research-report',
      title: 'Prior report',
      summary: 'Current report ref.',
    }],
    currentReferenceDigests: [
      { ref: 'artifact:artifact.report-1', digestText: 'Current report digest.' },
      { ref: 'artifact:stale-report', digestText: 'Stale digest.' },
    ],
    agentHarnessHandoff: {
      schemaVersion: 'sciforge.agent-harness-handoff.v1',
      harnessContractRef: 'harness-contract:broker-payload-context',
      harnessTraceRef: 'harness-trace:broker-payload-context',
      contextRefs: {
        allowed: ['artifact:artifact.report-1', 'artifact:stale-report'],
        blocked: ['artifact:stale-report'],
        required: ['artifact:artifact.report-1'],
      },
      contextBudget: { maxReferenceDigests: 1 },
    },
    capabilityBrief: {
      selected: [{
        id: 'legacy.full.skill',
        summary: 'OLD_CAPABILITY_BRIEF_SELECTED_SENTINEL',
      }],
      excluded: [{
        id: 'legacy.full.tool',
        reason: 'OLD_CAPABILITY_BRIEF_EXCLUDED_SENTINEL',
      }],
      verificationPolicy: {
        mode: 'OLD_CAPABILITY_BRIEF_VERIFICATION_POLICY_SENTINEL',
      },
      verificationBrief: {
        summary: 'OLD_CAPABILITY_BRIEF_VERIFICATION_BRIEF_SENTINEL',
      },
    },
    capabilityEvolutionCompactSummary: {
      schemaVersion: 'sciforge.capability-evolution-compact-summary.v1',
      generatedAt: '2026-05-09T00:12:00.000Z',
      sourceRef: '.sciforge/capability-evolution-ledger/records.jsonl',
      totalRecords: 1,
      statusCounts: { succeeded: 1 },
      fallbackRecordCount: 0,
      repairRecordCount: 0,
      promotionCandidates: [],
      recentRecords: [{
        id: 'cel-agentserver-broker-smoke',
        recordedAt: '2026-05-09T00:12:00.000Z',
        goalSummary: 'Read artifact report through compact refs only.',
        selectedCapabilityIds: ['runtime.artifact-read'],
        providerIds: ['sciforge.core.runtime.artifact-read'],
        finalStatus: 'succeeded',
        recoverActions: [],
        repairAttemptCount: 0,
        artifactRefs: ['artifact:artifact.report-1'],
        executionUnitRefs: ['.sciforge/logs/cel-agentserver-broker-smoke.stdout.log'],
        recordRef: '.sciforge/capability-evolution-ledger/records.jsonl#L1',
        glueCodeRef: '.sciforge/tasks/LEDGER_GLUE_CODE_SENTINEL.py',
        fullLog: 'LEDGER_FULL_LOG_SENTINEL',
      }],
    },
  },
};

const contextEnvelope = buildContextEnvelope(request, {
  workspace: '/tmp/sciforge-broker-payload-smoke',
  workspaceTreeSummary: [],
  priorAttempts: [],
  mode: 'full',
});
const scenarioFacts = contextEnvelope.scenarioFacts as Record<string, unknown>;
const sessionFacts = contextEnvelope.sessionFacts as Record<string, unknown>;
const brokerBrief = scenarioFacts.capabilityBrokerBrief as Record<string, unknown>;
const capabilityBrief = scenarioFacts.capabilityBrief as Record<string, unknown>;
const governanceAudit = contextEnvelope.contextGovernanceAudit as Record<string, unknown>;
const brokerText = JSON.stringify(brokerBrief);
const contextEnvelopeText = JSON.stringify(contextEnvelope);

assert.equal(brokerBrief.schemaVersion, 'sciforge.agentserver.capability-broker-brief.v1');
assert.equal(brokerBrief.contract, 'sciforge.capability-broker-output.v1');
assert.match(brokerText, /view\.report/);
assert.match(brokerText, /verifier\.schema/);
assert.match(brokerText, /capabilityEvolutionRecords/);
assert.match(brokerText, /capability evolution ledger success/);
assert.equal(brokerText.includes('inputSchema'), false, 'broker brief must not expand full input schema');
assert.equal(brokerText.includes('outputSchema'), false, 'broker brief must not expand full output schema');
assert.equal(brokerText.includes('contract:example-input'), false, 'broker brief must not expand examples');
assert.equal(brokerText.includes('Regenerate payload according to this capability manifest contract'), false, 'broker brief must not expand repair hints');
assert.equal(brokerText.includes('LEDGER_GLUE_CODE_SENTINEL'), false, 'broker brief must not expand ledger glue code refs');
assert.equal(brokerText.includes('LEDGER_FULL_LOG_SENTINEL'), false, 'broker brief must not expand full ledger logs');
assert.equal(brokerText.includes('cel-agentserver-broker-smoke.stdout.log'), false, 'broker brief must not include log refs from compact ledger input');
assert.equal(capabilityBrief.schemaVersion, 'sciforge.capability-brief.registry-projection.v1');
assert.equal(capabilityBrief.source, 'unified-capability-registry');
assert.match(JSON.stringify(capabilityBrief), /capabilityBrief\.projected_from_broker/);
assert.match(JSON.stringify(capabilityBrief), /legacy_capabilityBrief\.ignored/);
assert.match(JSON.stringify(capabilityBrief), /view\.report/);
assert.equal(governanceAudit.source, 'request.uiState.agentHarnessHandoff');
assert.equal(governanceAudit.contractRef, 'harness-contract:broker-payload-context');
assert.match(JSON.stringify(governanceAudit), /contract-only-context-governance/);
assert.deepEqual((sessionFacts.currentReferences as Array<Record<string, unknown>>).map((entry) => entry.ref), ['artifact:artifact.report-1']);
assert.deepEqual((sessionFacts.currentReferenceDigests as Array<Record<string, unknown>>).map((entry) => entry.ref), ['artifact:artifact.report-1']);
assert.equal(contextEnvelopeText.includes('OLD_CAPABILITY_BRIEF_SELECTED_SENTINEL'), false);
assert.equal(contextEnvelopeText.includes('OLD_CAPABILITY_BRIEF_EXCLUDED_SENTINEL'), false);
assert.equal(contextEnvelopeText.includes('OLD_CAPABILITY_BRIEF_VERIFICATION_POLICY_SENTINEL'), false);
assert.equal(contextEnvelopeText.includes('OLD_CAPABILITY_BRIEF_VERIFICATION_BRIEF_SENTINEL'), false);
assert.equal(contextEnvelopeText.includes('artifact:legacy-context-sentinel'), false);

const compactContext = buildAgentServerCompactContext(request, {
  contextEnvelope,
  workspaceTree: [],
  priorAttempts: [],
  mode: 'full',
});
assert.equal(
  'availableSkills' in compactContext,
  false,
  'production compact context must not construct a scattered skill capability list',
);

const prompt = buildAgentServerGenerationPrompt({
  prompt: request.prompt,
  skillDomain: request.skillDomain,
  metadata: {
    agentHarnessHandoff: {
      promptRenderPlan: {
        schemaVersion: 'sciforge.agent-harness-prompt-render.v1',
        renderMode: 'metadata-scaffold',
        deterministic: true,
        sourceRefs: {
          contractRef: 'harness-contract:broker-payload',
          traceRef: 'harness-trace:broker-payload',
        },
        renderedEntries: [{
          kind: 'strategy',
          id: 'intent-mode',
          sourceCallbackId: 'harness.defaults.intentMode',
          text: 'intentMode=fresh',
        }],
        renderedText: 'PROMPT_RENDER_FULL_TEXT_SENTINEL',
        renderDigest: 'sha1:broker-payload-render-digest',
      },
    },
  },
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
assert.match(prompt, /"promptRenderPlanSummary"/);
assert.match(prompt, /"source": "request\.metadata\.agentHarnessHandoff"/);
assert.match(prompt, /"renderDigest": "sha1:broker-payload-render-digest"/);
assert.match(prompt, /"contractRef": "harness-contract:broker-payload"/);
assert.match(prompt, /"renderedEntries"/);
assert.match(prompt, /"sourceCallbackId": "harness\.defaults\.intentMode"/);
assert.equal(prompt.includes('PROMPT_RENDER_FULL_TEXT_SENTINEL'), false, 'prompt render summary must not copy full renderedText');

console.log('[ok] AgentServer handoff uses compact TypeScript broker briefs without legacy full capability dumps');
