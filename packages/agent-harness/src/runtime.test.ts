import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessProfile, HarnessStage } from './contracts';
import {
  createHarnessRuntime,
  evaluateHarness,
  getHarnessStagePathKind,
  HARNESS_ALL_STAGES,
  HARNESS_AUDIT_PATH_STAGES,
  HARNESS_CRITICAL_PATH_STAGES,
  HARNESS_EVALUATION_STAGES,
  HARNESS_EXTERNAL_HOOK_STAGES,
} from './runtime';
import { getHarnessModule, harnessModules, moduleStackForTier } from './modules';
import { createParallelWorkPlan, materializeParallelWorkResult } from './parallel-work';

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
  assert.equal(first.contract.latencyTier, 'instant');
  assert.equal(first.trace.latencyTier, first.contract.latencyTier);
  assert.equal(first.contract.allowedContextRefs.join(','), 'ref:a,ref:b');
  assert.ok(first.trace.auditNotes.some((note) => note.sourceCallbackId === 'harness-runtime.stage-coverage'));
  assert.ok(Array.isArray(first.trace.auditHooks));
});

test('runtime declares critical, audit, and external hook stages without overlap', () => {
  const expectedStages: HarnessStage[] = [
    'onRequestReceived',
    'onRequestNormalized',
    'classifyIntent',
    'selectProfile',
    'selectContext',
    'setExplorationBudget',
    'onRegistryBuild',
    'selectCapabilities',
    'onBeforeCapabilityBroker',
    'onAfterCapabilityBroker',
    'onToolPolicy',
    'onBudgetAllocate',
    'beforePromptRender',
    'beforeAgentDispatch',
    'onAgentDispatched',
    'onAgentStreamEvent',
    'onStreamGuardTrip',
    'beforeToolCall',
    'afterToolCall',
    'onObserveStart',
    'onActionStepEnd',
    'beforeResultValidation',
    'afterResultValidation',
    'beforeResultPresentation',
    'onRepairRequired',
    'beforeRepairDispatch',
    'afterRepairAttempt',
    'beforeUserProgressEvent',
    'onInteractionRequested',
    'onBackgroundContinuation',
    'onCancelRequested',
    'onPolicyDecision',
    'onBudgetDebit',
    'onVerifierVerdict',
    'onAuditRecord',
    'onRunCompleted',
    'onRunFailed',
    'onRunCancelled',
  ];
  assert.deepEqual([...new Set(HARNESS_ALL_STAGES)].sort(), expectedStages.sort());
  assert.deepEqual(new Set(HARNESS_EVALUATION_STAGES), new Set([...HARNESS_CRITICAL_PATH_STAGES, ...HARNESS_AUDIT_PATH_STAGES]));
  assert.equal(new Set(HARNESS_EVALUATION_STAGES).size, HARNESS_EVALUATION_STAGES.length);
  assert.equal(new Set(HARNESS_CRITICAL_PATH_STAGES).size, HARNESS_CRITICAL_PATH_STAGES.length);
  assert.equal(new Set(HARNESS_AUDIT_PATH_STAGES).size, HARNESS_AUDIT_PATH_STAGES.length);
  assert.equal(new Set(HARNESS_EXTERNAL_HOOK_STAGES).size, HARNESS_EXTERNAL_HOOK_STAGES.length);
  for (const stage of HARNESS_EVALUATION_STAGES) {
    assert.equal(HARNESS_EXTERNAL_HOOK_STAGES.includes(stage), false, `${stage} must not be in both stage groups`);
  }
  for (const stage of HARNESS_AUDIT_PATH_STAGES) {
    assert.equal(HARNESS_CRITICAL_PATH_STAGES.includes(stage), false, `${stage} must not be in both path groups`);
    assert.equal(getHarnessStagePathKind(stage), 'audit');
  }
  for (const stage of HARNESS_CRITICAL_PATH_STAGES) assert.equal(getHarnessStagePathKind(stage), 'critical');
  for (const stage of HARNESS_EXTERNAL_HOOK_STAGES) assert.equal(getHarnessStagePathKind(stage), 'external');
});

test('harness module registry covers the latency-first module stack', () => {
  const expectedModules = [
    'intent',
    'latency',
    'context',
    'capability',
    'budget',
    'verification',
    'repair',
    'progress',
    'presentation',
    'audit',
    'startup-context',
    'workspace-memory',
    'parallel',
    'continuation',
    'exploration',
    'research',
  ];
  assert.deepEqual(Object.keys(harnessModules).sort(), expectedModules.sort());
  for (const moduleId of expectedModules) {
    const module = getHarnessModule(moduleId);
    assert.ok(module, `${moduleId} registered`);
    assert.ok(module.ownedStages.length > 0, `${moduleId} owns stages`);
    assert.ok(module.inputs.length > 0, `${moduleId} declares inputs`);
    assert.ok(module.outputs.length > 0, `${moduleId} declares outputs`);
  }

  assert.deepEqual(
    moduleStackForTier('quick').map((module) => module.id),
    [
      'intent',
      'latency',
      'context',
      'startup-context',
      'workspace-memory',
      'capability',
      'parallel',
      'exploration',
      'budget',
      'verification',
      'progress',
      'continuation',
      'presentation',
      'research',
    ],
  );
  assert.ok(moduleStackForTier('background').some((module) => module.id === 'audit'));
});

test('profile registry exposes distinct budget and verification behavior', async () => {
  const fast = await evaluateHarness({ requestId: 'req-profile', profileId: 'fast-answer' });
  const research = await evaluateHarness({ requestId: 'req-profile', profileId: 'research-grade' });
  const privacy = await evaluateHarness({ requestId: 'req-profile', profileId: 'privacy-strict' });

  assert.equal(fast.contract.explorationMode, 'minimal');
  assert.equal(fast.contract.latencyTier, 'quick');
  assert.equal(research.contract.explorationMode, 'deep');
  assert.equal(research.contract.latencyTier, 'deep');
  assert.equal(research.contract.verificationPolicy.requireCitations, true);
  assert.equal(privacy.contract.capabilityPolicy.sideEffects.network, 'block');
  assert.ok(fast.contract.toolBudget.maxWallMs < research.contract.toolBudget.maxWallMs);
});

test('latency defaults expose cheap-first capability tiers, verification layers, and repair budgets', async () => {
  const quick = await evaluateHarness({ requestId: 'req-cheap-first', latencyTier: 'quick' });
  const bounded = await evaluateHarness({ requestId: 'req-layered-verification', latencyTier: 'bounded' });
  const deep = await evaluateHarness({ requestId: 'req-deep-repair', latencyTier: 'deep' });

  assert.deepEqual(quick.contract.verificationPolicy.verificationLayers, ['shape', 'reference']);
  assert.deepEqual(bounded.contract.verificationPolicy.verificationLayers, ['shape', 'reference', 'claim']);
  assert.deepEqual(deep.contract.verificationPolicy.verificationLayers, ['shape', 'reference', 'claim', 'recompute']);
  assert.ok(quick.contract.capabilityPolicy.escalationPlan?.some((step) => step.tier === 'direct-context' && step.costClass === 'free'));
  assert.ok(quick.contract.capabilityPolicy.escalationPlan?.some((step) => step.tier === 'metadata-summary'));
  assert.deepEqual(quick.contract.capabilityPolicy.candidateTiers?.['metadata-summary'], ['runtime.artifact-list', 'runtime.artifact-resolve']);
  assert.equal(quick.contract.repairContextPolicy.partialFirst, true);
  assert.equal(quick.contract.repairContextPolicy.materializePartialOnFailure, true);
  assert.equal(quick.contract.repairContextPolicy.tierBudgets?.quick?.maxAttempts, 0);
  assert.equal(deep.contract.repairContextPolicy.checkpointArtifacts, true);
  assert.ok(deep.contract.repairContextPolicy.tierBudgets?.deep?.maxAttempts);
});

test('balanced profile owns context audit follow-up intent', async () => {
  const result = await evaluateHarness({
    requestId: 'req-context-audit',
    prompt: 'What tools and refs were used for the previous result?',
    request: {
      artifacts: [{ id: 'research-report', type: 'research-report' }],
      uiState: {
        recentExecutionRefs: [{ id: 'unit-report', outputRef: '.sciforge/task-results/report.json' }],
      },
    },
  });

  assert.equal(result.contract.intentMode, 'audit');
  assert.equal(result.contract.latencyTier, 'quick');
  assert.equal(result.contract.explorationMode, 'minimal');
  assert.ok(result.contract.capabilityPolicy.preferredCapabilityIds.includes('runtime.direct-context-answer'));
  assert.equal(result.contract.capabilityPolicy.sideEffects.network, 'block');
  assert.equal(result.contract.toolBudget.maxNetworkCalls, 0);
  assert.ok(result.trace.stages.some((stage) => stage.callbackId === 'balanced-default.context-audit-intent'));
});

test('context audit callback does not capture fresh work', async () => {
  const result = await evaluateHarness({
    requestId: 'req-fresh-work',
    prompt: 'Please rerun the search and download the latest papers',
    request: {
      artifacts: [{ id: 'research-report', type: 'research-report' }],
    },
  });

  assert.equal(result.contract.intentMode, 'fresh');
  assert.equal(result.contract.capabilityPolicy.preferredCapabilityIds.includes('runtime.direct-context-answer'), false);
});

test('same request can select different latency tiers with different budgets and stage plans', async () => {
  const request = { requestId: 'req-tier-smoke', prompt: 'Summarize this method and mention any uncertainty.' };
  const instant = await evaluateHarness({ ...request, latencyTier: 'instant' });
  const bounded = await evaluateHarness({ ...request, latencyTier: 'bounded' });
  const background = await evaluateHarness({ ...request, latencyTier: 'background' });

  assert.equal(instant.contract.latencyTier, 'instant');
  assert.equal(bounded.contract.latencyTier, 'bounded');
  assert.equal(background.contract.latencyTier, 'background');
  assert.equal(instant.trace.latencyTier, 'instant');
  assert.equal(bounded.trace.latencyTier, 'bounded');
  assert.equal(instant.contract.toolBudget.maxToolCalls, 0);
  assert.ok(bounded.contract.toolBudget.maxToolCalls > instant.contract.toolBudget.maxToolCalls);
  assert.ok(background.contract.toolBudget.maxWallMs > bounded.contract.toolBudget.maxWallMs);
  assert.equal(instant.contract.progressPlan.backgroundContinuation, false);
  assert.equal(background.contract.progressPlan.backgroundContinuation, true);
  assert.notDeepEqual(instant.contract.progressPlan.phaseNames, bounded.contract.progressPlan.phaseNames);
  assert.ok(background.contract.progressPlan.phaseNames?.includes('background'));
});

test('merge rules union blocks, tighten budgets, escalate verification, and fail closed side effects', async () => {
  const profile: HarnessProfile = {
    id: 'test-merge',
    version: '0.1.0',
    defaults: {
      latencyTier: 'bounded',
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
        escalationPlan: [],
        candidateTiers: {},
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
      verificationPolicy: { intensity: 'standard', verificationLayers: ['shape', 'reference', 'claim'], requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: false },
      repairContextPolicy: { kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false, maxWallMs: 0, cheapOnly: true, partialFirst: true, materializePartialOnFailure: true, checkpointArtifacts: false, stopOnRepeatedFailure: true, tierBudgets: {}, stopConditions: ['repeated-failure'] },
      progressPlan: { initialStatus: 'Planning', visibleMilestones: [], silenceTimeoutMs: 30000, backgroundContinuation: false },
      presentationPlan: {
        primaryMode: 'answer-first',
        defaultExpandedSections: ['answer', 'key-findings', 'evidence', 'artifacts', 'next-actions'],
        defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload'],
        citationPolicy: { requireCitationOrUncertainty: true, maxInlineCitationsPerFinding: 4, showVerificationState: true },
        artifactActionPolicy: { primaryActions: ['inspect'], secondaryActions: ['export'], preferRightPane: true },
        diagnosticsVisibility: 'collapsed',
        processVisibility: 'collapsed',
        roleMode: 'standard',
      },
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
          repair: {
            tierBudgets: { bounded: { maxAttempts: 1, maxWallMs: 10000, maxToolCalls: 1 } },
            stopConditions: ['no-code-change', 'no-new-evidence'],
            partialFirst: true,
          },
          capabilityHints: {
            sideEffects: { network: 'allow' },
            candidateTiers: { 'single-tool': ['cap:single'] },
            escalationPlan: [{
              tier: 'single-tool',
              candidateIds: ['cap:single'],
              benefit: 'resolve one precise missing fact',
              cost: 'low',
              costClass: 'low',
              latencyClass: 'bounded',
              sideEffectClass: 'read',
              stopCondition: 'stop after one result',
            }],
          },
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
  assert.deepEqual(result.contract.verificationPolicy.verificationLayers, ['shape', 'reference', 'claim']);
  assert.equal(result.contract.verificationPolicy.requireCitations, true);
  assert.equal(result.contract.capabilityPolicy.sideEffects.network, 'requires-approval');
  assert.deepEqual(result.contract.capabilityPolicy.candidateTiers?.['single-tool'], ['cap:single']);
  assert.ok(result.contract.capabilityPolicy.escalationPlan?.some((step) => step.tier === 'single-tool' && step.candidateIds.includes('cap:single')));
  assert.equal(result.contract.repairContextPolicy.tierBudgets?.bounded?.maxWallMs, 10000);
  assert.deepEqual(result.contract.repairContextPolicy.stopConditions, ['repeated-failure', 'no-code-change', 'no-new-evidence']);
  assert.ok(result.trace.conflicts.some((conflict) => conflict.field === 'capabilityPolicy.sideEffects.network'));
  assert.ok(result.trace.conflicts.some((conflict) => conflict.field === 'verificationPolicy.intensity'));
});

test('criticalPathOnly evaluation defers audit callbacks and keeps critical trace', async () => {
  const calls: string[] = [];
  const profile: HarnessProfile = {
    id: 'test-critical-path',
    version: '0.1.0',
    defaults: {
      latencyTier: 'bounded',
      intentMode: 'fresh',
      explorationMode: 'normal',
      allowedContextRefs: [],
      blockedContextRefs: [],
      requiredContextRefs: [],
      contextBudget: { maxPromptTokens: 8000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 1 },
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: [],
        blockedCapabilities: [],
        sideEffects: { network: 'requires-approval', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
        escalationPlan: [],
        candidateTiers: {},
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
      verificationPolicy: { intensity: 'standard', verificationLayers: ['shape', 'reference', 'claim'], requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: false },
      repairContextPolicy: { kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false, maxWallMs: 0, cheapOnly: true, partialFirst: true, materializePartialOnFailure: true, checkpointArtifacts: false, stopOnRepeatedFailure: true, tierBudgets: {}, stopConditions: ['repeated-failure'] },
      progressPlan: { initialStatus: 'Planning', visibleMilestones: [], silenceTimeoutMs: 30000, backgroundContinuation: false },
      presentationPlan: {
        primaryMode: 'answer-first',
        defaultExpandedSections: ['answer', 'key-findings', 'evidence', 'artifacts', 'next-actions'],
        defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload'],
        citationPolicy: { requireCitationOrUncertainty: true, maxInlineCitationsPerFinding: 4, showVerificationState: true },
        artifactActionPolicy: { primaryActions: ['inspect'], secondaryActions: ['export'], preferRightPane: true },
        diagnosticsVisibility: 'collapsed',
        processVisibility: 'collapsed',
        roleMode: 'standard',
      },
      promptDirectives: [],
    },
    mergePolicy: {},
    callbacks: [
      {
        id: 'test.critical',
        version: '0.1.0',
        stages: ['classifyIntent'],
        decide: () => {
          calls.push('critical');
          return { intentSignals: { intentMode: 'interactive' } };
        },
      },
      {
        id: 'test.audit',
        version: '0.1.0',
        stages: ['beforeResultValidation'],
        decide: () => {
          calls.push('audit');
          return { verification: { intensity: 'audit' } };
        },
      },
    ],
  };

  const runtime = createHarnessRuntime({ profiles: { 'test-critical-path': profile } });
  const result = await runtime.evaluate({ profileId: 'test-critical-path', evaluationMode: 'criticalPathOnly' });

  assert.deepEqual(calls, ['critical']);
  assert.equal(result.contract.intentMode, 'interactive');
  assert.equal(result.contract.verificationPolicy.intensity, 'standard');
  assert.ok(result.trace.stages.every((stage) => stage.pathKind === 'critical'));
  assert.ok(result.trace.stages.some((stage) => stage.callbackId === 'test.critical'));
  assert.equal(result.trace.stages.some((stage) => stage.callbackId === 'test.audit'), false);
  assert.deepEqual(result.trace.auditHooks, [
    {
      stage: 'beforeResultValidation',
      callbackId: 'test.audit',
      status: 'deferred',
      reason: 'criticalPathOnly mode defers audit hook until post-result materialization',
    },
    {
      stage: 'onRepairRequired',
      status: 'skipped',
      reason: 'criticalPathOnly mode omits audit stage with no registered callbacks',
    },
  ]);
});

test('full evaluation completes audit callbacks, while quick latency implies criticalPathOnly', async () => {
  const profile: HarnessProfile = {
    id: 'test-audit-status',
    version: '0.1.0',
    defaults: {
      latencyTier: 'bounded',
      intentMode: 'fresh',
      explorationMode: 'normal',
      allowedContextRefs: [],
      blockedContextRefs: [],
      requiredContextRefs: [],
      contextBudget: { maxPromptTokens: 8000, maxHistoryTurns: 2, maxReferenceDigests: 8, maxFullTextRefs: 1 },
      capabilityPolicy: {
        candidates: [],
        preferredCapabilityIds: [],
        blockedCapabilities: [],
        sideEffects: { network: 'requires-approval', workspaceWrite: 'block', externalMutation: 'block', codeExecution: 'block' },
        escalationPlan: [],
        candidateTiers: {},
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
      verificationPolicy: { intensity: 'standard', verificationLayers: ['shape', 'reference', 'claim'], requireCitations: false, requireCurrentRefs: true, requireArtifactRefs: false },
      repairContextPolicy: { kind: 'none', maxAttempts: 0, includeStdoutSummary: false, includeStderrSummary: false, maxWallMs: 0, cheapOnly: true, partialFirst: true, materializePartialOnFailure: true, checkpointArtifacts: false, stopOnRepeatedFailure: true, tierBudgets: {}, stopConditions: ['repeated-failure'] },
      progressPlan: { initialStatus: 'Planning', visibleMilestones: [], silenceTimeoutMs: 30000, backgroundContinuation: false },
      presentationPlan: {
        primaryMode: 'answer-first',
        defaultExpandedSections: ['answer', 'key-findings', 'evidence', 'artifacts', 'next-actions'],
        defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload'],
        citationPolicy: { requireCitationOrUncertainty: true, maxInlineCitationsPerFinding: 4, showVerificationState: true },
        artifactActionPolicy: { primaryActions: ['inspect'], secondaryActions: ['export'], preferRightPane: true },
        diagnosticsVisibility: 'collapsed',
        processVisibility: 'collapsed',
        roleMode: 'standard',
      },
      promptDirectives: [],
    },
    mergePolicy: {},
    callbacks: [
      {
        id: 'test.audit',
        version: '0.1.0',
        stages: ['onRepairRequired'],
        decide: () => ({ repair: { kind: 'supplement', maxAttempts: 1 } }),
      },
    ],
  };

  const runtime = createHarnessRuntime({ profiles: { 'test-audit-status': profile } });
  const full = await runtime.evaluate({ profileId: 'test-audit-status' });
  const quick = await runtime.evaluate({ profileId: 'test-audit-status', runtimeConfig: { latencyTier: 'quick' } });

  assert.equal(full.contract.repairContextPolicy.kind, 'supplement');
  assert.deepEqual(full.trace.auditHooks, [
    {
      stage: 'beforeResultValidation',
      status: 'skipped',
      reason: 'full evaluation had no registered audit callbacks for this stage',
    },
    {
      stage: 'onRepairRequired',
      callbackId: 'test.audit',
      status: 'completed',
      reason: 'audit hook completed during full evaluation',
    },
  ]);
  assert.equal(full.trace.stages.find((stage) => stage.callbackId === 'test.audit')?.auditStatus, 'completed');
  assert.equal(quick.contract.repairContextPolicy.kind, 'none');
  assert.equal(quick.trace.auditHooks.find((hook) => hook.callbackId === 'test.audit')?.status, 'deferred');
});

test('bounded parallel work planner builds guarded DAG and early-stop result trace', () => {
  const plan = createParallelWorkPlan({
    requestId: 'req-parallel',
    latencyTier: 'bounded',
    maxConcurrency: 3,
    firstResultDeadlineMs: 30000,
    tasks: [
      {
        id: 'intent',
        title: 'Classify user goal',
        readSet: ['prompt'],
        writeSet: [],
        sideEffectClass: 'none',
        costClass: 'free',
        deadlineMs: 3000,
        owner: { id: 'main', kind: 'main-agent', owns: [] },
        expectedOutput: 'intent signals',
        criticalPath: true,
      },
      {
        id: 'smoke-a',
        dependsOn: ['intent'],
        readSet: ['packages/agent-harness/src/runtime.ts'],
        writeSet: [],
        sideEffectClass: 'none',
        costClass: 'low',
        deadlineMs: 15000,
        owner: { id: 'script-smoke-a', kind: 'script', owns: [], readOnly: true },
        expectedOutput: 'smoke result',
        executionKind: 'parallel-script',
        valueScore: 0.8,
      },
      {
        id: 'write-contract',
        dependsOn: ['intent'],
        readSet: ['packages/agent-harness/src/contracts.ts'],
        writeSet: ['packages/agent-harness/src/contracts.ts'],
        sideEffectClass: 'write',
        costClass: 'low',
        deadlineMs: 20000,
        owner: { id: 'subagent-contract', kind: 'subagent', owns: ['packages/agent-harness/src'] },
        expectedOutput: 'contract patch',
        valueScore: 0.9,
      },
      {
        id: 'write-contract-2',
        dependsOn: ['intent'],
        readSet: ['packages/agent-harness/src/contracts.ts'],
        writeSet: ['packages/agent-harness/src/contracts.ts'],
        sideEffectClass: 'write',
        costClass: 'low',
        deadlineMs: 22000,
        owner: { id: 'subagent-contract-2', kind: 'subagent', owns: ['packages/agent-harness/src'] },
        expectedOutput: 'second contract patch',
        valueScore: 0.7,
      },
      {
        id: 'slow-audit',
        dependsOn: ['smoke-a'],
        readSet: ['trace'],
        writeSet: [],
        sideEffectClass: 'none',
        costClass: 'medium',
        deadlineMs: 90000,
        owner: { id: 'verifier-audit', kind: 'verifier', owns: [], readOnly: true },
        expectedOutput: 'audit summary',
        executionKind: 'verifier',
        valueScore: 0.2,
      },
      {
        id: 'bad-write',
        dependsOn: ['intent'],
        readSet: ['PROJECT.md'],
        writeSet: ['PROJECT.md'],
        sideEffectClass: 'write',
        costClass: 'low',
        deadlineMs: 10000,
        owner: { id: 'readonly-worker', kind: 'subagent', owns: ['docs'], readOnly: true },
        expectedOutput: 'invalid patch',
        valueScore: 0.4,
      },
    ],
  });

  assert.equal(plan.schemaVersion, 'sciforge.parallel-work-plan.v1');
  assert.equal(plan.maxConcurrency, 3);
  assert.ok(plan.batches.length >= 3);
  assert.deepEqual(plan.batches[0].taskIds, ['intent']);
  assert.ok(plan.conflicts.some((conflict) => conflict.kind === 'shared-write' && conflict.resolution === 'serialize'));
  assert.ok(plan.conflicts.some((conflict) => conflict.kind === 'owner-scope-missing' && conflict.taskIds.includes('bad-write')));
  const writeBatch = plan.batches.find((batch) => batch.taskIds.includes('write-contract'))?.index ?? -1;
  const serializedWriteBatch = plan.batches.find((batch) => batch.taskIds.includes('write-contract-2'))?.index ?? -1;
  assert.ok(serializedWriteBatch > writeBatch);

  const result = materializeParallelWorkResult({
    plan,
    completedTaskIds: ['intent', 'smoke-a', 'write-contract'],
    outputRefs: { 'write-contract': 'patch:contracts' },
  });

  assert.equal(result.schemaVersion, 'sciforge.parallel-work-result.v1');
  assert.equal(result.status, 'partial');
  assert.ok(result.skippedTaskIds.includes('bad-write'));
  assert.ok(result.cancelledTaskIds.includes('slow-audit'));
  assert.equal(result.taskResults.find((trace) => trace.taskId === 'write-contract')?.mergeDecision, 'merge');
  assert.equal(result.taskResults.find((trace) => trace.taskId === 'slow-audit')?.status, 'cancelled');
});
