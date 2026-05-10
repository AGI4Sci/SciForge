import assert from 'node:assert/strict';

import {
  buildComputerUseActionPlanCandidateCallback,
  buildObserveProviderSelectionCandidateCallback,
  buildSkillPackagePolicyCandidateCallback,
  buildToolPackageManifestCandidateCallback,
  projectHarnessDefaultCandidateCallbacks,
} from '../../src/runtime/capability-default-callbacks.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import type { MatchableSkillManifest } from '../../packages/skills/matching-policy.js';

const skillProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildSkillPackagePolicyCandidateCallback({
      skillDomain: 'knowledge',
      prompt: 'Calculate protein physicochemical properties from this protein sequence.',
      explicitSkillIds: ['custom.unavailable_skill'],
      skills: [
        skill('scp.protein-properties-calculation', {
          description: 'Calculate protein physicochemical properties from a protein sequence.',
          skillDomains: ['knowledge'],
          examplePrompts: ['protein properties sequence calculation'],
        }),
        skill('custom.unavailable_skill', {
          description: 'Unavailable package-backed knowledge helper.',
          skillDomains: ['knowledge'],
          examplePrompts: ['knowledge helper'],
        }, false, 'web search package disabled'),
      ],
    }),
  ],
});

assert.equal(skillProjection.contract, 'sciforge.harness-default-candidates.v1');
assert.equal(skillProjection.candidates[0]?.id, 'scp.protein-properties-calculation');
assert.ok(skillProjection.candidates[0]?.reasons.some((reason) => reason.startsWith('scoreSkillByPackagePolicy=')));
assert.equal(
  skillProjection.audit.find((entry) => entry.id === 'custom.unavailable_skill')?.gate,
  'blocked',
  'explicit skill selection must not bypass unavailable provider gate',
);
assert.match(
  skillProjection.audit.find((entry) => entry.id === 'custom.unavailable_skill')?.blocked ?? '',
  /provider unavailable|skill unavailable/,
);

const configuredTool = packageToolManifest('tool.metadata-enrich', {
  providerId: 'pkg.metadata.remote',
  requiredConfig: ['SCIFORGE_METADATA_KEY'],
  risk: 'medium',
  sideEffects: ['network', 'external-api'],
});
const localTool = packageToolManifest('tool.local-normalize', {
  providerId: 'pkg.normalize.local',
  requiredConfig: [],
  risk: 'low',
  sideEffects: ['none'],
});

const toolProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildToolPackageManifestCandidateCallback({
      manifests: [configuredTool, localTool],
      explicitCapabilityIds: ['tool.metadata-enrich'],
      providerAvailability: ['pkg.normalize.local'],
    }),
  ],
  budgetByKind: {
    tool: {
      maxToolCalls: 3,
      maxNetworkCalls: 1,
      maxProviders: 2,
      exhaustedPolicy: 'partial-payload',
    },
  },
});

assert.equal(
  toolProjection.audit.find((entry) => entry.id === 'tool.metadata-enrich')?.gate,
  'blocked',
  'explicit tool selection must not bypass required config/provider gate',
);
assert.match(toolProjection.audit.find((entry) => entry.id === 'tool.metadata-enrich')?.blocked ?? '', /provider/);
assert.ok(toolProjection.candidates.some((candidate) => candidate.id === 'tool.local-normalize'));

const toolBudgetProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildToolPackageManifestCandidateCallback({
      manifests: [configuredTool],
      explicitCapabilityIds: ['tool.metadata-enrich'],
      providerAvailability: ['pkg.metadata.remote'],
    }),
  ],
  budgetByKind: {
    tool: {
      maxToolCalls: 0,
      maxNetworkCalls: 1,
      exhaustedPolicy: 'fail-with-reason',
    },
  },
});
assert.equal(
  toolBudgetProjection.audit.find((entry) => entry.id === 'tool.metadata-enrich')?.blocked,
  'budget exhausted: maxToolCalls=0 for tool',
  'explicit tool selection must not bypass tool budget gate',
);

const observeProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildObserveProviderSelectionCandidateCallback({
      selectedSenseIds: ['local.vision-sense'],
    }),
  ],
  budgetByKind: {
    observe: {
      maxObserveCalls: 0,
      exhaustedPolicy: 'fail-with-reason',
    },
  },
});
assert.equal(observeProjection.candidates.length, 0);
assert.equal(
  observeProjection.audit.find((entry) => entry.capabilityClasses.includes('observe-provider-selection'))?.blocked,
  'budget exhausted: maxObserveCalls=0',
  'explicit observe provider selection must not bypass observe budget gate',
);

const computerUseSafetyProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildComputerUseActionPlanCandidateCallback({
      actionPlan: {
        id: 'action.computer-use',
        actions: [{ type: 'click', riskLevel: 'high', requiresConfirmation: true }],
      },
    }),
  ],
  riskTolerance: 'low',
});
assert.equal(computerUseSafetyProjection.candidates.length, 0);
assert.equal(
  computerUseSafetyProjection.audit.find((entry) => entry.id === 'action.computer-use')?.blocked,
  'risk medium exceeds low tolerance',
  'explicit Computer Use action plan must not bypass safety risk gate',
);

const computerUseBudgetProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildComputerUseActionPlanCandidateCallback({
      actionPlan: {
        id: 'action.computer-use',
        actions: [
          { type: 'click', riskLevel: 'low' },
          { type: 'type_text', riskLevel: 'low' },
        ],
      },
    }),
  ],
  riskTolerance: 'medium',
  budgetByKind: {
    action: {
      maxActionSteps: 1,
      exhaustedPolicy: 'fail-with-reason',
    },
  },
});
assert.equal(
  computerUseBudgetProjection.audit.find((entry) => entry.id === 'action.computer-use')?.blocked,
  'budget exhausted: action plan requires 2 steps but maxActionSteps=1',
  'explicit Computer Use action plan must not bypass action-step budget gate',
);

const priorityProjection = projectHarnessDefaultCandidateCallbacks({
  callbacks: [
    buildObserveProviderSelectionCandidateCallback({
      selectedSenseIds: ['local.vision-sense'],
    }),
    buildToolPackageManifestCandidateCallback({
      manifests: [localTool],
      providerAvailability: ['pkg.normalize.local'],
    }),
  ],
  riskTolerance: 'medium',
  budgetByKind: {
    observe: { maxObserveCalls: 2, exhaustedPolicy: 'partial-payload' },
    tool: { maxToolCalls: 2, exhaustedPolicy: 'partial-payload' },
  },
});
assert.equal(priorityProjection.candidates[0]?.kind, 'observe');
assert.ok(
  priorityProjection.candidates[0]?.reasons.includes('explicit selection raises priority only'),
  'selected observe provider should receive priority evidence when gates pass',
);
assert.equal(priorityProjection.callbackAudit.length, 2);
assert.deepEqual(
  new Set(priorityProjection.audit.flatMap((entry) => entry.capabilityClasses)),
  new Set(['observe-provider-selection', 'tool-package-manifest']),
);

const lazyText = JSON.stringify(priorityProjection);
assert.equal(lazyText.includes('inputSchema'), false, 'default projection must keep schemas lazy');
assert.equal(lazyText.includes('outputSchema'), false, 'default projection must keep schemas lazy');
assert.equal(lazyText.includes('"examples"'), false, 'default projection must keep examples lazy');

console.log('[ok] capability default callbacks project skill/tool/observe/action defaults without bypassing safety/config/budget gates');

function skill(
  id: string,
  overrides: Partial<MatchableSkillManifest>,
  available = true,
  reason = 'available',
) {
  const manifest: MatchableSkillManifest = {
    id,
    kind: 'package',
    description: `${id} test skill`,
    skillDomains: ['knowledge'],
    entrypoint: { type: 'markdown-skill' },
    examplePrompts: [],
    ...overrides,
  };
  return { id, available, reason, manifest };
}

function packageToolManifest(
  id: string,
  options: {
    providerId: string;
    requiredConfig: string[];
    risk: CapabilityManifest['safety']['risk'];
    sideEffects: CapabilityManifest['sideEffects'];
  },
): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage: '@sciforge/test-tools',
    kind: 'skill',
    brief: `${id} package tool manifest`,
    routingTags: id.split(/[.-]/),
    domains: ['knowledge'],
    inputSchema: { type: 'object', required: ['inputRef'] },
    outputSchema: { type: 'object', required: ['outputRef'] },
    sideEffects: options.sideEffects,
    safety: { risk: options.risk, dataScopes: ['workspace'] },
    examples: [{ title: `${id} example` }],
    validators: [{ id: `${id}.schema`, kind: 'schema', expectedRefs: ['outputRef'] }],
    repairHints: [{
      failureCode: 'provider-unavailable',
      summary: 'Fallback to a local tool provider.',
      recoverActions: ['fallback-local-provider'],
    }],
    providers: [{
      id: options.providerId,
      label: options.providerId,
      kind: 'package',
      requiredConfig: options.requiredConfig,
    }],
    lifecycle: { status: 'validated', sourceRef: `packages/test/${id}` },
    metadata: {
      harnessKind: 'tool',
      budget: {
        maxToolCalls: 2,
        exhaustedPolicy: 'partial-payload',
      },
    },
  };
}
