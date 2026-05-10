import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessProfile } from './contracts';
import { createHarnessRuntime, evaluateHarness } from './runtime';

test('evaluateHarness produces stable contract and trace for the same input', async () => {
  const input = {
    requestId: 'req-stable',
    prompt: 'summarize current paper refs',
    contextRefs: ['ref:b', 'ref:a'],
  };

  const first = await evaluateHarness(input);
  const second = await evaluateHarness(input);

  assert.deepEqual(first.contract, second.contract);
  assert.deepEqual(first.trace, second.trace);
  assert.equal(first.contract.schemaVersion, 'sciforge.agent-harness-contract.v1');
  assert.equal(first.trace.schemaVersion, 'sciforge.agent-harness-trace.v1');
  assert.equal(first.contract.allowedContextRefs.join(','), 'ref:a,ref:b');
});

test('profile registry exposes distinct budget and verification behavior', async () => {
  const fast = await evaluateHarness({ requestId: 'req-profile', profileId: 'fast-answer' });
  const research = await evaluateHarness({ requestId: 'req-profile', profileId: 'research-grade' });
  const privacy = await evaluateHarness({ requestId: 'req-profile', profileId: 'privacy-strict' });

  assert.equal(fast.contract.explorationMode, 'minimal');
  assert.equal(research.contract.explorationMode, 'deep');
  assert.equal(research.contract.verificationPolicy.requireCitations, true);
  assert.equal(privacy.contract.capabilityPolicy.sideEffects.network, 'block');
  assert.ok(fast.contract.toolBudget.maxWallMs < research.contract.toolBudget.maxWallMs);
});

test('merge rules union blocks, tighten budgets, escalate verification, and fail closed side effects', async () => {
  const profile: HarnessProfile = {
    id: 'test-merge',
    version: '0.1.0',
    defaults: {
      intentMode: 'fresh',
      explorationMode: 'normal',
      allowedContextRefs: ['ref:allowed'],
      blockedContextRefs: ['ref:block-a'],
      requiredContextRefs: [],
      contextBudget: { maxPromptTokens: 8000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 1 },
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: [],
        blockedCapabilities: ['cap:block-a'],
        sideEffects: { network: 'requires-approval', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
      },
      toolBudget: {
        maxWallMs: 120000,
        maxContextTokens: 8000,
        maxToolCalls: 8,
        maxObserveCalls: 2,
        maxActionSteps: 0,
        maxNetworkCalls: 4,
        maxDownloadBytes: 1000,
        maxResultItems: 20,
        maxProviders: 2,
        maxRetries: 1,
        perProviderTimeoutMs: 30000,
        costUnits: 10,
        exhaustedPolicy: 'partial-payload',
      },
      verificationPolicy: { intensity: 'standard', requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: false },
      repairContextPolicy: { kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false },
      progressPlan: { initialStatus: 'Planning', visibleMilestones: [], silenceTimeoutMs: 30000, backgroundContinuation: false },
      promptDirectives: [],
    },
    mergePolicy: {},
    callbacks: [
      {
        id: 'test.tighten',
        version: '0.1.0',
        stages: ['onBudgetAllocate'],
        decide: () => ({
          blockedRefs: ['ref:block-b'],
          blockedCapabilities: ['cap:block-b'],
          budgets: {
            toolBudget: { maxToolCalls: 12, maxNetworkCalls: 1, exhaustedPolicy: 'fail-with-reason' },
            contextBudget: { maxPromptTokens: 12000, maxReferenceDigests: 4 },
          },
          verification: { intensity: 'light', requireCitations: true },
          capabilityHints: { sideEffects: { network: 'allow' } },
        }),
      },
    ],
  };

  const runtime = createHarnessRuntime({ profiles: { 'test-merge': profile } });
  const result = await runtime.evaluate({ profileId: 'test-merge' });

  assert.deepEqual(result.contract.blockedContextRefs, ['ref:block-a', 'ref:block-b']);
  assert.deepEqual(result.contract.capabilityPolicy.blockedCapabilities, ['cap:block-a', 'cap:block-b']);
  assert.equal(result.contract.toolBudget.maxToolCalls, 8);
  assert.equal(result.contract.toolBudget.maxNetworkCalls, 1);
  assert.equal(result.contract.toolBudget.exhaustedPolicy, 'fail-with-reason');
  assert.equal(result.contract.contextBudget.maxPromptTokens, 8000);
  assert.equal(result.contract.contextBudget.maxReferenceDigests, 4);
  assert.equal(result.contract.verificationPolicy.intensity, 'standard');
  assert.equal(result.contract.verificationPolicy.requireCitations, true);
  assert.equal(result.contract.capabilityPolicy.sideEffects.network, 'requires-approval');
  assert.ok(result.trace.conflicts.some((conflict) => conflict.field === 'capabilityPolicy.sideEffects.network'));
  assert.ok(result.trace.conflicts.some((conflict) => conflict.field === 'verificationPolicy.intensity'));
});
