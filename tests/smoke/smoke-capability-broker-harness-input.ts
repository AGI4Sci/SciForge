import assert from 'node:assert/strict';

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

const verifierAudit = audit.find((entry) => entry.id === 'verifier.schema');
assert.ok(JSON.stringify(verifierAudit).includes('verification policy hint'));

const blockedAudit = audit.find((entry) => entry.id === 'runtime.workspace-write');
assert.equal(blockedAudit?.excluded, 'blocked by harness capability policy');
assert.ok(JSON.stringify(blockedAudit).includes('blocked by harness capability policy'));

assert.equal(brokerText.includes('inputSchema'), false, 'broker brief must keep schemas lazy');
assert.equal(brokerText.includes('outputSchema'), false, 'broker brief must keep schemas lazy');
assert.equal(brokerText.includes('"examples"'), false, 'broker brief must keep examples lazy');
assert.equal(brokerText.includes('repairHints'), false, 'broker brief must keep repair hints lazy');

console.log('[ok] capability broker carries harness input hints into compact audit without broad selection changes');
