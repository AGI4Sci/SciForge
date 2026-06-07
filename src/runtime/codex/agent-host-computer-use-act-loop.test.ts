import assert from 'node:assert/strict';
import test from 'node:test';

import { createComputerUseActLoopMaterializer } from './agent-host-computer-use-act-loop.js';
import type {
  CodexAgentHostComputerUseActMaterializerResult,
  CodexAgentHostComputerUseCompletionTruth,
  CodexAgentHostRuntimeTruth,
  NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';
import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';

test('Computer Use Act loop refreshes and reruns preflight before each base step', async () => {
  const truths = [readyRuntimeTruth('one'), readyRuntimeTruth('two'), readyRuntimeTruth('three')];
  const refreshSteps: number[] = [];
  const preflightSteps: number[] = [];
  const baseObservationRefs: string[] = [];
  const workEvidence = [{
    schemaVersion: 'sciforge.work-evidence.test.v1',
    providerId: 'computer-use-package-bridge',
    status: 'verified',
    evidenceRefs: ['workEvidence:package-bridge/final'],
  }];
  const completionTruth: CodexAgentHostComputerUseCompletionTruth = {
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope: 'action',
    status: 'satisfied',
    evidenceRefs: ['action-ledger:base/three'],
    validator: 'test',
  };

  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 3,
    baseMaterializer: async (input) => {
      baseObservationRefs.push(input.runtimeTruth?.observation?.refs?.[0] ?? '');
      const step = baseObservationRefs.length;
      if (step === 3) {
        return completedStep('three', {
          completionTruth,
          workEvidence,
        });
      }
      return completedStep(step === 1 ? 'one' : 'two', {
        evidenceRefs: ['ui:unsafe-projection-ref'],
      });
    },
    refreshRuntimeTruth: async ({ step }) => {
      refreshSteps.push(step);
      return truths[step - 1];
    },
    evaluatePreflight: ({ runtimeTruth, step }) => {
      preflightSteps.push(step);
      return readyPreflight(runtimeTruth, step);
    },
  });

  const result = await materializer(baseInput({ runtimeTruth: truths[0] }));

  assert.equal(result?.status, 'completed');
  assert.deepEqual(refreshSteps, [1, 2, 3]);
  assert.deepEqual(preflightSteps, [1, 2, 3]);
  assert.deepEqual(baseObservationRefs, [
    'computer-use:observation/one',
    'computer-use:observation/two',
    'computer-use:observation/three',
  ]);
  assert.deepEqual(result?.workEvidence, workEvidence);
  assert.deepEqual(result?.completionTruth, completionTruth);
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/one'));
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/two'));
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/three'));
  assert.ok(result?.evidenceRefs.includes('permission:turn/three'));
  assert.doesNotMatch(JSON.stringify(result), /ui:unsafe-projection-ref/);
  assert.doesNotMatch(result?.message ?? '', /workflow\s+complete/i);
});

test('Computer Use Act loop blocks stale observations before calling the base materializer', async () => {
  let baseCalls = 0;
  const staleTruth: CodexAgentHostRuntimeTruth = {
    ...readyRuntimeTruth('stale'),
    observation: {
      fresh: false,
      refs: ['computer-use:observation/stale'],
    },
  };
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep('unexpected');
    },
    refreshRuntimeTruth: async () => staleTruth,
  });

  const result = await materializer(baseInput({ runtimeTruth: staleTruth }));

  assert.equal(baseCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /observation|needs-observation/i);
  assert.ok(result?.evidenceRefs.includes('computer-use:observation/stale'));
});

test('Computer Use Act loop blocks missing permissions even when a custom preflight claims ready', async (t) => {
  const cases: Array<{
    name: string;
    runtimeTruth: CodexAgentHostRuntimeTruth;
    expected: RegExp;
  }> = [
    {
      name: 'permission refs missing',
      runtimeTruth: {
        ...readyRuntimeTruth('missing-permission'),
        permissions: { refs: [], stopCancelPath: true },
      },
      expected: /permission/i,
    },
    {
      name: 'stop cancel path missing',
      runtimeTruth: {
        ...readyRuntimeTruth('missing-stop'),
        permissions: { refs: ['permission:turn/missing-stop'], stopCancelPath: false },
      },
      expected: /stop|cancel/i,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let baseCalls = 0;
      const materializer = createComputerUseActLoopMaterializer({
        maxSteps: 1,
        baseMaterializer: async () => {
          baseCalls += 1;
          return completedStep('unexpected');
        },
        refreshRuntimeTruth: async () => testCase.runtimeTruth,
        evaluatePreflight: ({ runtimeTruth, step }) => readyPreflight(runtimeTruth, step),
      });

      const result = await materializer(baseInput({ runtimeTruth: testCase.runtimeTruth }));

      assert.equal(baseCalls, 0);
      assert.equal(result?.status, 'blocked');
      assert.match(result?.message ?? '', testCase.expected);
    });
  }
});

test('Computer Use Act loop fails closed when refresh is blocked', async () => {
  let baseCalls = 0;
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep('unexpected');
    },
    refreshRuntimeTruth: async () => undefined,
  });

  const result = await materializer(baseInput({ runtimeTruth: readyRuntimeTruth('initial') }));

  assert.equal(baseCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /refresh/i);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:computer-use-act-loop/refresh-blocked'));
});

test('Computer Use Act loop fails closed when step budget is exhausted without completion evidence', async () => {
  let baseCalls = 0;
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep(`budget-${baseCalls}`);
    },
    refreshRuntimeTruth: async ({ step }) => readyRuntimeTruth(`budget-${step}`),
    evaluatePreflight: ({ runtimeTruth, step }) => readyPreflight(runtimeTruth, step),
  });

  const result = await materializer(baseInput({ runtimeTruth: readyRuntimeTruth('budget-initial') }));

  assert.equal(baseCalls, 2);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /budget|maxSteps/i);
  assert.equal(result?.completionTruth, undefined);
  assert.equal(result?.workEvidence, undefined);
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/budget-1'));
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/budget-2'));
});

test('Computer Use Act loop can require user-level completion truth instead of accepting action-only truth', async () => {
  let baseCalls = 0;
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    requireUserLevelCompletionTruth: true,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep(`action-only-${baseCalls}`, {
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'action',
          status: 'satisfied',
          evidenceRefs: [`action-ledger:base/action-only-${baseCalls}`],
          validator: 'single-action-evidence',
        },
      });
    },
    refreshRuntimeTruth: async ({ step }) => readyRuntimeTruth(`action-only-${step}`),
    evaluatePreflight: ({ runtimeTruth, step }) => readyPreflight(runtimeTruth, step),
  });

  const result = await materializer(baseInput({ runtimeTruth: readyRuntimeTruth('action-only-initial') }));

  assert.equal(baseCalls, 2);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /budget|maxSteps|completion evidence/i);
  assert.equal(result?.completionTruth, undefined);
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/action-only-1'));
  assert.ok(result?.evidenceRefs.includes('action-ledger:base/action-only-2'));
});

test('Computer Use Act loop keeps verified package bridge workEvidence diagnostic-only before ending', async () => {
  let baseCalls = 0;
  const runDir = '.sciforge/vision-runs/act-loop-package-bridge-complete';
  const baseTruth = readyRuntimeTruth('package-bridge');
  const runtimeTruth: CodexAgentHostRuntimeTruth = {
    ...baseTruth,
    refs: [
      ...(baseTruth.refs ?? []),
      `${runDir}/vision-trace.json`,
      `${runDir}/primitive-trace.json`,
    ],
  };
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep('package-bridge', {
        workEvidence: [{
          id: `${runDir}/cu-user-acceptance-manifest.json`,
          kind: 'validate',
          provider: 'computer-use-package-bridge',
          status: 'verified',
          outputSummary: 'Computer Use completion-grade evidence',
          evidenceRefs: [
            `${runDir}/cu-user-acceptance-manifest.json`,
            `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
          ],
          recoverActions: [],
        }],
      });
    },
    refreshRuntimeTruth: async () => runtimeTruth,
    evaluatePreflight: ({ runtimeTruth: truth, step }) => readyPreflight(truth, step),
  });

  const result = await materializer(baseInput({ runtimeTruth }));

  assert.equal(baseCalls, 1);
  assert.equal(result?.status, 'completed');
  assert.equal(result?.completionTruth?.scope, 'workflow');
  assert.equal(result?.completionTruth?.status, 'blocked');
  assert.equal(result?.completionTruth?.validator, 'current-run-live-acceptance-bundle');
  assert.deepEqual(result?.completionTruth?.evidenceRefs, [
    `${runDir}/vision-trace.json`,
    `${runDir}/primitive-trace.json`,
  ]);
});

test('Computer Use Act loop does not treat generic artifact workEvidence as completion evidence', async () => {
  let baseCalls = 0;
  const materializer = createComputerUseActLoopMaterializer({
    maxSteps: 2,
    baseMaterializer: async () => {
      baseCalls += 1;
      return completedStep(`artifact-${baseCalls}`, {
        workEvidence: [{
          id: `workEvidence:generated-task/artifact-${baseCalls}`,
          kind: 'generated-task-artifact',
          status: 'success',
          evidenceRefs: [
            `workEvidence:generated-task/artifact-${baseCalls}`,
            `artifact:report-${baseCalls}`,
          ],
          artifactRefs: [`artifact:report-${baseCalls}`],
        }],
      });
    },
    refreshRuntimeTruth: async ({ step }) => readyRuntimeTruth(`artifact-${step}`),
    evaluatePreflight: ({ runtimeTruth, step }) => readyPreflight(runtimeTruth, step),
  });

  const result = await materializer(baseInput({ runtimeTruth: readyRuntimeTruth('artifact-initial') }));

  assert.equal(baseCalls, 2);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /budget|maxSteps/i);
  assert.equal(result?.completionTruth, undefined);
  assert.deepEqual(result?.workEvidence, undefined);
  assert.ok(result?.evidenceRefs.includes('workEvidence:generated-task/artifact-1'));
  assert.ok(result?.evidenceRefs.includes('workEvidence:generated-task/artifact-2'));
});

function completedStep(
  step: string,
  overrides: Partial<CodexAgentHostComputerUseActMaterializerResult> = {},
): CodexAgentHostComputerUseActMaterializerResult {
  const { evidenceRefs: extraEvidenceRefs = [], ...rest } = overrides;
  return {
    status: 'completed',
    message: `Computer Use action ${step} completed.`,
    confidence: 0.8,
    claimType: 'runtime-action',
    reasoningTrace: 'Single-step test action evidence only.',
    evidenceRefs: [`action-ledger:base/${step}`, ...extraEvidenceRefs],
    executionUnits: [{
      id: `EU-base-${step}`,
      tool: 'test-base-materializer',
      status: 'done',
      outputRef: `action-ledger:base/${step}`,
    }],
    claims: [{
      id: `claim-base-${step}`,
      type: 'runtime-action',
      text: `Executed ${step}.`,
      evidenceLevel: 'runtime',
      supportingRefs: [`action-ledger:base/${step}`],
      opposingRefs: [],
    }],
    ...rest,
  };
}

function baseInput(input: {
  runtimeTruth: CodexAgentHostRuntimeTruth;
}) {
  return {
    agentHostInput: agentHostInput(input.runtimeTruth),
    preflight: readyPreflight(input.runtimeTruth, 0),
    commandText: 'Click through the runtime-owned Computer Use workflow.',
    workspacePath: '/tmp/sciforge-test-workspace',
    commandId: 'codex-command-computer-use-act-loop',
    attemptId: 'codex-command-computer-use-act-loop-attempt',
    runtimeTruth: input.runtimeTruth,
  };
}

function agentHostInput(runtimeTruth: CodexAgentHostRuntimeTruth): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Click through the runtime-owned Computer Use workflow.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: runtimeTruth.refs ?? [],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function readyRuntimeTruth(step: string): CodexAgentHostRuntimeTruth {
  return {
    schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
    source: 'test',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: `Runtime-owned target ${step}`,
      refs: [`computer-use:target/${step}`, `window-action-session:${step}`],
    },
    observation: {
      fresh: true,
      refs: [`computer-use:observation/${step}`],
    },
    permissions: {
      refs: [`permission:turn/${step}`],
      stopCancelPath: true,
    },
    refs: [
      `runtime-truth:computer-use-act-loop/${step}`,
      `computer-use:session/${step}`,
      `cancel:runtime-turn/${step}`,
    ],
  };
}

function readyPreflight(
  runtimeTruth: CodexAgentHostRuntimeTruth | undefined,
  step: number,
): ComputerUsePreflightResult {
  return {
    schemaVersion: 'sciforge.computer-use.preflight.v1',
    status: 'ready',
    authorizationProfile: {
      schemaVersion: 'sciforge.authorization-profile.v1',
      id: 'high-autonomy',
      publicLabel: 'High Autonomy',
      scope: { user: 'current-user', workspace: 'current-workspace' },
      defaultAutoScope: ['observe', 'navigate'],
      hardConfirmCategories: [],
      blockedCategories: [],
    },
    target: {
      summary: runtimeTruth?.target?.summary ?? `Target ${step}`,
      refs: runtimeTruth?.target?.refs ?? [],
    },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    evidenceRefs: [
      ...(runtimeTruth?.observation?.refs ?? []),
      ...(runtimeTruth?.permissions?.refs ?? []),
    ],
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}
