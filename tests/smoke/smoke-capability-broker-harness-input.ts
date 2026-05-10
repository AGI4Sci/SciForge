import assert from 'node:assert/strict';

import { summarizeToolsForAgentServer } from '../../src/runtime/gateway/agentserver-prompts.js';
import { buildCapabilityBrokerBriefForAgentServer } from '../../src/runtime/gateway/context-envelope.js';
import type { GatewayRequest } from '../../src/runtime/runtime-types.js';

const request: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Read the current workspace artifact, validate schema, and render a report view.',
  artifacts: [{
    id: 'artifact.report-1',
    type: 'research-report',
    ref: 'artifact:artifact.report-1',
    title: 'Current report',
    summary: 'Workspace report artifact that needs validation and rendering.',
    tags: ['report', 'workspace'],
  }],
  references: [{
    ref: 'artifact:artifact.report-1',
    kind: 'artifact',
    artifactType: 'research-report',
    title: 'Current report',
  }],
  selectedVerifierIds: ['verifier.schema'],
  verificationPolicy: {
    required: true,
    mode: 'automatic',
    riskLevel: 'medium',
    reason: 'Harness contract requires schema validation before completion.',
    selectedVerifierIds: ['verifier.schema'],
  },
  uiState: {
    capabilityPolicy: {
      skillHints: [{
        id: 'view.report',
        source: 'agent-harness-shadow',
        reason: 'contract selected compact report view candidate',
        tags: ['report'],
      }, {
        providerIds: ['sciforge.core.verifier.schema'],
        source: 'agent-harness-shadow',
        reason: 'contract selected verifier candidate',
      }],
      blockedCapabilities: ['runtime.workspace-write'],
      toolBudget: {
        maxToolCalls: 2,
        maxNetworkCalls: 0,
        maxProviders: 3,
        exhaustedPolicy: 'fail-with-reason',
      },
      providerAvailability: [
        'sciforge.core.runtime.artifact-read',
        'sciforge.core.view.report',
        'sciforge.core.verifier.schema',
        { id: 'sciforge.core.runtime.workspace-write', available: true },
      ],
    },
  },
};

const brokerBrief = buildCapabilityBrokerBriefForAgentServer(request);
const toolBriefs = summarizeToolsForAgentServer(request);
const brokerText = JSON.stringify(brokerBrief);
const inputSummary = brokerBrief.inputSummary as Record<string, unknown>;
const briefs = brokerBrief.briefs as Array<Record<string, unknown>>;
const audit = brokerBrief.audit as Array<Record<string, unknown>>;

assert.equal(brokerBrief.schemaVersion, 'sciforge.agentserver.capability-broker-brief.v1');
assert.equal(inputSummary.harnessSkillHints, 2);
assert.equal(inputSummary.blockedCapabilities, 1);
assert.deepEqual(inputSummary.toolBudgetKeys, ['exhaustedPolicy', 'maxNetworkCalls', 'maxProviders', 'maxToolCalls']);
assert.equal(inputSummary.verificationPolicyMode, 'automatic');

const reportBrief = briefs.find((brief) => brief.id === 'view.report');
assert.ok(reportBrief, 'view.report should remain selected from normal prompt/ref signals');
assert.ok(
  JSON.stringify(reportBrief).includes('skill hint from agent-harness-shadow'),
  'compact selected brief should carry matching harness skill hint signals',
);
assert.ok(
  JSON.stringify(reportBrief).includes('tool budget hint'),
  'compact selected brief should carry budget hints without expanding schemas',
);
assert.ok(reportBrief.budget, 'compact selected brief should carry structured budget status');
assert.equal((reportBrief.budget as Record<string, unknown>).providerIdsAfterBudget, 1);

const reportToolBrief = toolBriefs.find((brief) => brief.id === 'view.report');
assert.ok(reportToolBrief, 'AgentServer tool summary should be sourced from selected broker briefs');
assert.equal(reportToolBrief.toolType, 'view');
assert.equal(reportToolBrief.selected, true);
assert.deepEqual(reportToolBrief.providerIds, ['sciforge.core.view.report']);
assert.equal((reportToolBrief.budget as Record<string, unknown> | undefined)?.providerIdsAfterBudget, 1);
assert.equal(JSON.stringify(toolBriefs).includes('inputSchema'), false, 'tool summaries must keep schemas lazy');
assert.equal(JSON.stringify(toolBriefs).includes('repairHints'), false, 'tool summaries must keep repair hints lazy');

const verifierBrief = briefs.find((brief) => brief.id === 'verifier.schema');
assert.ok(verifierBrief, 'schema verifier should remain selected from explicit verification policy signals');
assert.ok(JSON.stringify(verifierBrief).includes('verification policy hint'));

const blockedExclusion = brokerBrief.excluded.find((entry) => entry.id === 'runtime.workspace-write');
assert.equal(blockedExclusion?.reason, 'blocked by harness capability policy');
assert.ok(JSON.stringify(blockedExclusion).includes('blocked by harness capability policy'));

assert.equal(brokerText.includes('inputSchema'), false, 'broker brief must keep schemas lazy');
assert.equal(brokerText.includes('outputSchema'), false, 'broker brief must keep schemas lazy');
assert.equal(brokerText.includes('"examples"'), false, 'broker brief must keep examples lazy');
assert.equal(brokerText.includes('repairHints'), false, 'broker brief must keep repair hints lazy');

const budgetedRetrievalBrief = buildCapabilityBrokerBriefForAgentServer({
  skillDomain: 'literature',
  prompt: 'Find recent CRISPR literature and return provider attempts.',
  artifacts: [],
  uiState: {
    capabilityPolicy: {
      toolBudget: {
        maxProviders: 2,
        maxNetworkCalls: 1,
        exhaustedPolicy: 'partial-payload',
      },
      providerAvailability: [
        'literature.retrieval.pubmed',
        'literature.retrieval.crossref',
        'literature.retrieval.semantic-scholar',
        'literature.retrieval.openalex',
      ],
    },
  },
});
const retrievalBriefs = budgetedRetrievalBrief.briefs as Array<Record<string, unknown>>;
const retrievalAudit = budgetedRetrievalBrief.audit as Array<Record<string, unknown>>;
const literatureBrief = retrievalBriefs.find((brief) => brief.id === 'literature.retrieval');
const literatureAudit = retrievalAudit.find((entry) => entry.id === 'literature.retrieval');
const literatureBudget = literatureAudit?.budget as Record<string, unknown> | undefined;

assert.ok(literatureBrief, 'literature.retrieval should be selected for literature retrieval prompt');
assert.deepEqual(literatureBrief.providerIds, ['literature.retrieval.pubmed', 'literature.retrieval.crossref']);
assert.equal((literatureBrief.budget as Record<string, unknown> | undefined)?.providerIdsBeforeBudget, 7);
assert.equal((literatureBrief.budget as Record<string, unknown> | undefined)?.providerIdsAfterBudget, 2);
assert.equal(literatureBudget?.status, 'limited');
assert.equal(literatureBudget?.providerIdsBeforeBudget, 7);
assert.equal(literatureBudget?.providerIdsAfterBudget, 2);
assert.deepEqual(
  literatureBudget?.clippedProviderIds,
  [
    'literature.retrieval.semantic-scholar',
    'literature.retrieval.openalex',
    'literature.retrieval.arxiv',
    'literature.retrieval.web-search',
    'literature.retrieval.scp-biomedical-search',
  ],
);
assert.ok(JSON.stringify(literatureAudit).includes('maxProviders=2 clipped provider briefs 7->2'));
assert.equal(JSON.stringify(budgetedRetrievalBrief).includes('inputSchema'), false, 'budgeted broker brief must keep schemas lazy');
assert.equal(JSON.stringify(budgetedRetrievalBrief).includes('"examples"'), false, 'budgeted broker brief must keep examples lazy');
assert.equal(JSON.stringify(budgetedRetrievalBrief).includes('repairHints'), false, 'budgeted broker brief must keep repair hints lazy');

const harnessContractRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Validate the current report schema and render a report view.',
  artifacts: request.artifacts,
  references: request.references,
  selectedVerifierIds: ['verifier.schema'],
  uiState: {
    agentHarness: {
      profileId: 'privacy-fast',
      contractRef: 'harness-contract:broker-opt-in',
      traceRef: 'harness-trace:broker-opt-in',
      contract: {
        schemaVersion: 'sciforge.agent-harness-contract.v1',
        profileId: 'privacy-fast',
        capabilityPolicy: {
          preferredCapabilityIds: ['view.report'],
          blockedCapabilities: ['runtime.workspace-write'],
          candidates: [{
            kind: 'view',
            id: 'view.report',
            manifestRef: 'capability:view.report',
            score: 90,
            reasons: ['contract selected compact report view candidate'],
            providerAvailability: [{ providerId: 'sciforge.core.view.report', available: true }],
          }, {
            kind: 'verifier',
            id: 'verifier.schema',
            manifestRef: 'capability:verifier.schema',
            score: 80,
            reasons: ['contract selected schema verifier candidate'],
            providerAvailability: [{ providerId: 'sciforge.core.verifier.schema', available: true }],
          }],
        },
        verificationPolicy: {
          intensity: 'strict',
          requireCurrentRefs: true,
          selectedVerifierIds: ['verifier.schema'],
        },
        toolBudget: {
          maxToolCalls: 1,
          maxNetworkCalls: 0,
          maxProviders: 2,
          exhaustedPolicy: 'fail-with-reason',
        },
      },
    },
  },
};

const harnessDefaultBrief = buildCapabilityBrokerBriefForAgentServer(harnessContractRequest);
const harnessDefaultSummary = harnessDefaultBrief.inputSummary as Record<string, unknown>;
assert.equal(Object.hasOwn(harnessDefaultBrief, 'harnessInputAudit'), false, 'harness broker input must stay opt-in');
assert.equal(harnessDefaultSummary.harnessSkillHints, 0, 'agentHarness contract candidates should not be consumed by default');
assert.equal(harnessDefaultSummary.blockedCapabilities, 0, 'agentHarness blocked capabilities should not be consumed by default');
assert.deepEqual(harnessDefaultSummary.toolBudgetKeys, [], 'agentHarness toolBudget should not be consumed by default');
assert.equal(harnessDefaultSummary.availableProviders, 0, 'agentHarness provider availability should not be consumed by default');
assert.equal(harnessDefaultSummary.verificationPolicyMode, undefined, 'agentHarness verification policy should not be consumed by default');

const harnessOptInBrief = buildCapabilityBrokerBriefForAgentServer({
  ...harnessContractRequest,
  uiState: {
    ...harnessContractRequest.uiState,
    harnessInput: { enabled: true },
    blockedCapabilities: ['view.report'],
    providerAvailability: [{
      id: 'sciforge.core.view.report',
      available: false,
      reason: 'LEGACY_DIRECT_UI_SENTINEL',
    }],
    toolBudget: {
      maxProviders: 0,
      exhaustedPolicy: 'LEGACY_DIRECT_UI_SENTINEL',
    },
    harnessSkillHints: [{
      id: 'runtime.workspace-write',
      source: 'legacy-direct-ui',
      reason: 'LEGACY_HINT_SENTINEL',
    }],
    capabilityPolicy: {
      blockedCapabilities: ['view.report'],
      providerAvailability: [{
        id: 'sciforge.core.view.report',
        available: false,
        reason: 'LEGACY_DIRECT_UI_SENTINEL',
      }],
      toolBudget: {
        maxProviders: 0,
        exhaustedPolicy: 'LEGACY_DIRECT_UI_SENTINEL',
      },
      skillHints: [{
        id: 'runtime.workspace-write',
        source: 'legacy-direct-ui',
        reason: 'LEGACY_HINT_SENTINEL',
      }],
    },
  },
});
const harnessOptInSummary = harnessOptInBrief.inputSummary as Record<string, unknown>;
const harnessOptInAudit = harnessOptInBrief.harnessInputAudit as Record<string, unknown>;
const harnessOptInAuditConsumed = harnessOptInAudit.consumed as Record<string, unknown>;
const harnessOptInSources = harnessOptInAudit.sources as Array<Record<string, unknown>>;
const harnessOptInIgnoredLegacySources = harnessOptInAudit.ignoredLegacySources as Array<Record<string, unknown>>;
const harnessOptInBrokerAudit = harnessOptInBrief.audit as Array<Record<string, unknown>>;
const harnessOptInText = JSON.stringify(harnessOptInBrief);

assert.equal(harnessOptInAudit.schemaVersion, 'sciforge.agentserver.capability-broker-harness-input-audit.v1');
assert.equal(harnessOptInAudit.status, 'consumed');
assert.equal(harnessOptInAudit.contractRef, 'harness-contract:broker-opt-in');
assert.equal(harnessOptInAudit.traceRef, 'harness-trace:broker-opt-in');
assert.equal(harnessOptInAudit.profileId, 'privacy-fast');
assert.equal(harnessOptInAuditConsumed.skillHints, 2);
assert.equal(harnessOptInAuditConsumed.blockedCapabilities, 1);
assert.equal(harnessOptInAuditConsumed.providerAvailability, 2);
assert.deepEqual(harnessOptInAuditConsumed.toolBudgetKeys, ['exhaustedPolicy', 'maxNetworkCalls', 'maxProviders', 'maxToolCalls']);
assert.deepEqual(harnessOptInAuditConsumed.verificationPolicyKeys, ['mode', 'required', 'riskLevel', 'selectedVerifierIds']);
assert.equal(harnessOptInAuditConsumed.verificationPolicyMode, 'hybrid');
assert.equal(harnessOptInSources[0]?.source, 'request.uiState.agentHarness.contract');
assert.deepEqual(
  harnessOptInIgnoredLegacySources.map((entry) => entry.source),
  [
    'request.uiState.capabilityPolicy',
    'request.uiState.toolBudget',
    'request.uiState.harnessSkillHints',
    'request.uiState.blockedCapabilities',
    'request.uiState.providerAvailability',
  ],
);
assert.equal(harnessOptInSummary.harnessSkillHints, 2);
assert.equal(harnessOptInSummary.blockedCapabilities, 1);
assert.equal(harnessOptInSummary.availableProviders, 2);
assert.deepEqual(harnessOptInSummary.toolBudgetKeys, ['exhaustedPolicy', 'maxNetworkCalls', 'maxProviders', 'maxToolCalls']);
assert.equal(harnessOptInSummary.verificationPolicyMode, 'hybrid');
assert.equal(
  harnessOptInBrief.excluded.find((entry) => entry.id === 'runtime.workspace-write')?.reason,
  'blocked by harness capability policy',
);
assert.ok(
  JSON.stringify(harnessOptInBrokerAudit.find((entry) => entry.id === 'verifier.schema')).includes('verification policy hint: mode=hybrid'),
  'opt-in harness verificationPolicy should reach compact broker audit',
);
assert.ok(
  JSON.stringify(harnessOptInBrokerAudit.find((entry) => entry.id === 'view.report')).includes('provider available: sciforge.core.view.report'),
  'opt-in harness provider availability should reach compact broker audit',
);
assert.equal(
  harnessOptInBrief.excluded.some((entry) => entry.id === 'view.report'),
  false,
  'legacy direct UI blockedCapabilities must not exclude contract-selected view.report',
);
assert.ok(
  JSON.stringify(harnessOptInBrief.briefs).includes('skill hint from agent-harness-contract'),
  'opt-in harness candidates should reach compact selected broker signals',
);
assert.ok(
  harnessOptInText.includes('maxProviders=2'),
  'opt-in harness toolBudget should reach compact broker budget signals',
);
assert.equal(
  harnessOptInText.includes('maxProviders=0'),
  false,
  'legacy direct UI toolBudget must not reach broker budget signals',
);
assert.equal(
  harnessOptInText.includes('LEGACY_DIRECT_UI_SENTINEL'),
  false,
  'legacy direct UI provider/budget sentinels must not reach broker output',
);
assert.equal(
  harnessOptInText.includes('LEGACY_HINT_SENTINEL'),
  false,
  'legacy direct UI hint sentinel must not reach broker output',
);

console.log('[ok] capability broker carries harness input hints and budgeted compact candidate briefs');
