import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  evaluateCodexAgentHostTurnLoop,
  resolveCodexAgentHostRuntimeTruth,
  type CodexAgentHostRuntimeTruth,
  type CodexAgentHostTurnLoopInput,
} from './agent-host-turn-loop.js';
import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';
import {
  createActorCursor,
  createWindowActionSession,
  enterWindowActionSession,
} from '../window-action-session.js';
import { createInMemoryWindowActionSessionStore } from '../window-action-session-store.js';
import { writeBundleLocalCuNext07Acceptance } from '../../../tests/smoke/helpers/cu-next-runner-fixtures.js';

test('Agent Host Turn Loop creates one-page PPT artifact with validator refs from ordinary chat', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-ppt-artifact-'));
  const commandText = '做一页 PPT，主题是 SciForge bounded modules';
  try {
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath,
      commandId: 'codex-command-one-page-ppt',
      attemptId: 'codex-command-one-page-ppt-attempt-1',
    });

    assert.equal((result?.event.raw as Record<string, unknown>).selectedRuntime, 'agent-host-artifact-generator');
    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    const evidenceRefs = result?.result.evidenceRefs as string[];
    assert.equal(evidenceRefs.length, 2);
    assert.match(evidenceRefs[0] ?? '', /^\.sciforge\/vision-runs\/codex-command-one-page-ppt-codex-command-one-page-ppt-attempt-1\/one-page-presentation\.pptx$/);
    assert.equal(evidenceRefs[1], `${evidenceRefs[0]}.validation.json`);
    const pptxBytes = await readFile(join(workspacePath, evidenceRefs[0] ?? 'missing'));
    assert.deepEqual([...pptxBytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const validation = JSON.parse(await readFile(join(workspacePath, evidenceRefs[1] ?? 'missing'), 'utf8')) as Record<string, unknown>;
    assert.equal(validation.status, 'passed');
    assert.equal(validation.productAcceptanceEvidence, true);
    assert.equal(validation.finalArtifactRef, evidenceRefs[0]);
    assert.equal(validation.artifactValidationRef, evidenceRefs[1]);
    assert.equal(validation.slideCount, 1);
    assert.deepEqual((result?.result.completionTruth as Record<string, unknown>).evidenceRefs, evidenceRefs);
    assert.match(String(result?.result.message), /one-page PPT artifact/);
    assert.match(JSON.stringify(result), /validator/);
    assert.doesNotMatch(JSON.stringify(result), /computer_use\.perform_local_action|browser-host-session\.computer-use-action|fixture:|replay:|history:/);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop calls injected Computer Use Act materializer after ready Guard', async () => {
  let materializerCalled = false;
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer',
    attemptId: 'codex-command-act-materializer-attempt-1',
    computerUseActMaterializer: async ({ preflight }) => {
      materializerCalled = true;
      assert.equal(preflight.status, 'ready');
      return {
        status: 'completed',
        message: 'Materializer claim should not be copied as the final Host answer.',
        evidenceRefs: [
          'browser-host-session:visible/evidence/before-scroll',
          'action-ledger:browser-host-session/visible/actions/scroll-1/grounding',
          'browser-host-session:visible/action-state/scroll-1',
          'browser-host-session:visible/evidence/after-scroll',
          'browser-host-session:visible/actions/scroll-1/freshness-invalidation.json',
        ],
        executionUnits: [{
          id: 'EU-browser-host-computer-use-scroll',
          tool: 'browser-host-session.computer-use-action',
          status: 'done',
          outputRef: 'browser-host-session:visible/action-state/scroll-1',
        }],
        artifacts: [{
          id: 'browser-host-computer-use-scroll',
          type: 'computer-use-action-result',
          metadata: { source: 'browser-host-session.computer-use-adapter' },
          data: { providerId: 'sciforge.browser-host-session.computer-use-adapter' },
        }],
      };
    },
  });

  assert.equal(materializerCalled, true);
  assert.equal((result?.event.raw as Record<string, unknown> | undefined)?.stage, 'Act / Answer');
  assert.match(String(result?.result.message), /current target-bound action evidence refs/i);
  assert.doesNotMatch(String(result?.result.message), /Materializer claim should not be copied/);
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.doesNotMatch(JSON.stringify(result), /ready-for-act/);
});

test('Agent Host Turn Loop routes ordinary chat through default Computer Use primitives for one low-risk WindowAction action', async () => {
  const now = '2026-06-03T00:00:00.000Z';
  const actionCalls: Array<{ action: unknown; delta: unknown; adapterRef: unknown }> = [];
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(now),
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Scroll the active desktop window.',
        nextAction: { type: 'scroll', direction: 'down', amount: 160 },
        evidenceRefs: ['action-ledger:planner/turn-loop-window-scroll'],
      }),
      adapterHandlers: {
        'app-native-command': async ({ input, scopedInputAdapter }) => {
          actionCalls.push({
            action: input.action,
            delta: input.delta,
            adapterRef: scopedInputAdapter.ref,
          });
          const actionId = String(input.actionId ?? 'missing-action-id');
          return {
            status: 'completed',
            evidenceRefs: [
              { kind: 'executor-event', ref: `app-native-command:vscode/actions/${actionId}/executor-event` },
              { kind: 'verification', ref: `window-action-session:vscode-main/actions/${actionId}/verification/verifier.json` },
              { kind: 'freshness-invalidation', ref: `window-action-session:vscode-main/actions/${actionId}/freshness-invalidation.json` },
            ],
            inputEventRefs: [{ kind: 'input-event', ref: `app-native-command:vscode/actions/${actionId}/scroll/input-event` }],
            afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-scroll' }],
          };
        },
      },
      now: () => new Date(now),
    },
  });

  const commandText = 'Scroll the active desktop window.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyWindowActionAgentHostInput(commandText, now),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-turn-loop-window-action',
    attemptId: 'codex-command-turn-loop-window-action-attempt-1',
    runtimeTruth: readyWindowActionRuntimeTruth(now),
    computerUseActMaterializer: materializer,
  });

  assert.deepEqual(actionCalls, [{
    action: 'scroll',
    delta: { y: 160 },
    adapterRef: 'scoped-input-adapter:vscode-main/computer-use/app-native-command',
  }]);
  assert.equal((result?.event.raw as Record<string, unknown> | undefined)?.stage, 'Act / Answer');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.match(String(result?.result.message), /current target-bound action evidence refs/i);
  assert.doesNotMatch(String(result?.result.message), /Scroll the active desktop window\./);
  assert.ok((result?.result.evidenceRefs as string[]).includes('computer-use:primitive-trace/vscode-main/actions/codex-command-turn-loop-window-action-attempt-1'));
  assert.ok((result?.result.evidenceRefs as string[]).includes('app-native-command:vscode/actions/codex-command-turn-loop-window-action-attempt-1/scroll/input-event'));
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|base64|raw-|\/raw|secret|token|password/i);
});

test('Agent Host Turn Loop blocks completed Act materializer results without full action evidence refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer-incomplete-evidence',
    attemptId: 'codex-command-act-materializer-incomplete-evidence-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Computer Use action executed through BrowserHostSession.',
      evidenceRefs: ['browser-host-session:visible/action-state/scroll-1'],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown> | undefined)?.stage, 'Act / Answer');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /missing current target-bound action evidence/i);
  assert.match(String(result?.result.message), /before-evidence-ref|grounding-ref|after-evidence-ref|stale-invalidation-ref/i);
  assert.doesNotMatch(String(result?.result.message), /Computer Use action executed through BrowserHostSession/);
});

test('Agent Host Turn Loop does not route ready Computer Use Guard through legacy bounded operations', async () => {
  let legacyInvokerCalled = false;
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-no-bounded-operation',
    attemptId: 'codex-command-cu-no-bounded-operation-attempt-1',
    computerUseBoundedOperationInvoker: async () => {
      legacyInvokerCalled = true;
      throw new Error('legacy bounded operation invoker must not be called');
    },
  } as CodexAgentHostTurnLoopInput & { computerUseBoundedOperationInvoker: () => never });

  assert.equal(legacyInvokerCalled, false);
  assert.equal((result?.event.raw as Record<string, unknown>).stage, 'Guard');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'ready-for-act');
  assert.match(String(result?.result.message), /Act is waiting for a refs-first action runner\/materializer/i);
  assert.doesNotMatch(JSON.stringify(result), /executeBoundedOperation|computer_use\.perform_local_action|computer_use\.fill_fields|bounded operation/i);
});

test('Agent Host Turn Loop blocks ordinary chat Computer Use when any user-level guard evidence is missing and explains recovery', async () => {
  const commandText = 'Click the visible export button in the current window.';
  const cases = [
    {
      name: 'native host',
      input: {
        ...readyAgentHostInput(commandText),
        readiness: {
          ...readyAgentHostInput(commandText).readiness,
          nativeBridge: 'blocked',
          nativeSurface: 'blocked',
        },
      },
      reason: 'native-bridge-unavailable',
      recovery: /Start or reconnect the Desktop native bridge|Desktop native Browser surface/i,
    },
    {
      name: 'target binding',
      input: {
        ...readyAgentHostInput(commandText),
        target: {
          bound: false,
          summary: 'No selected target',
          refs: [],
        },
      },
      reason: 'target-unbound',
      recovery: /Select or bind a Browser session, app window, screen region, file, terminal, or workspace object/i,
    },
    {
      name: 'fresh evidence',
      input: {
        ...readyAgentHostInput(commandText),
        observation: {
          fresh: false,
          refs: [],
        },
      },
      reason: 'needs-observation',
      recovery: /Capture a fresh observation ref/i,
    },
    {
      name: 'permission refs',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: [],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: true,
        },
      },
      reason: 'permission-missing',
      recovery: /Collect a scoped permission ref/i,
    },
    {
      name: 'scoped executor',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: [],
          stopCancelPath: true,
        },
      },
      reason: 'scoped-executor-missing',
      recovery: /Provide a scoped executor ref/i,
    },
    {
      name: 'stop cancel path',
      input: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: false,
        },
      },
      reason: 'cancel-path-missing',
      recovery: /Provide a stop, cancel, or take-over path/i,
    },
  ];

  for (const entry of cases) {
    let executorCalled = false;
    const result = await evaluateCodexAgentHostTurnLoop({
      input: entry.input,
      commandText,
      workspacePath: '/tmp/workspace',
      commandId: `codex-command-cu-blocker-${entry.name.replace(/\s+/g, '-')}`,
      attemptId: `codex-command-cu-blocker-${entry.name.replace(/\s+/g, '-')}-attempt-1`,
    });

    assert.equal(executorCalled, false, entry.name);
    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked', entry.name);
    assert.match(String(result?.result.message), new RegExp(entry.reason), entry.name);
    assert.match(String(result?.result.message), entry.recovery, entry.name);
    assert.match(JSON.stringify(result), new RegExp(entry.reason), entry.name);
    assert.doesNotMatch(JSON.stringify(result), /ready-for-act|taskOutcome":"satisfied"/, entry.name);
  }
});

test('Agent Host Turn Loop blocks Computer Use completion without full local action evidence refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-incomplete-action-evidence',
    attemptId: 'codex-command-cu-incomplete-action-evidence-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Computer Use action executed through legacy-shaped evidence.',
      evidenceRefs: [
        'computer-use:evidence:before-scroll',
        'computer-use:grounding:scroll-region',
        'computer-use:executor:event-scroll',
        'computer-use:evidence:after-scroll',
      ],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown>).stage, 'Act / Answer');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /missing current target-bound action evidence/i);
  assert.match(String(result?.result.message), /stale-invalidation-ref/);
  assert.deepEqual(result?.result.evidenceRefs, [
    'computer-use:evidence:before-scroll',
    'computer-use:grounding:scroll-region',
    'computer-use:executor:event-scroll',
    'computer-use:evidence:after-scroll',
  ]);
});

test('Agent Host Turn Loop does not treat Computer Use PPT local action evidence as final artifact completion', async () => {
  const commandText = 'Open PowerPoint and create one-page PPT about primitive action contracts.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-cu-ppt-local-action-only',
    attemptId: 'codex-command-cu-ppt-local-action-only-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Computer Use clicked PowerPoint controls but did not provide artifact validation.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'computer-use:evidence:before-ppt',
        'computer-use:grounding:ppt-window',
        'computer-use:executor:event-ppt-click',
        'computer-use:evidence:after-ppt',
        'computer-use:evidence:before-ppt/freshness-invalidation.json',
      ],
      claims: [{
        id: 'claim-ppt-local-action-only',
        type: 'product-completion',
        text: 'The PowerPoint deck workflow is complete.',
        supportingRefs: ['computer-use:executor:event-ppt-click'],
      }],
    }),
  });

  assert.equal((result?.event.raw as Record<string, unknown>).stage, 'Act / Answer');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).taskOutcome, 'needs-work');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.deepEqual(result?.result.evidenceRefs, [
    'computer-use:evidence:before-ppt',
    'computer-use:grounding:ppt-window',
    'computer-use:executor:event-ppt-click',
    'computer-use:evidence:after-ppt',
    'computer-use:evidence:before-ppt/freshness-invalidation.json',
  ]);
  assert.equal(result?.result.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied|workflow complete|artifact complete|finalArtifactRef|artifactValidationRef|gui\.present:|fixture:|replay:|history:/);
});

test('Agent Host Turn Loop rejects Computer Use Act materializer results backed only by GUI projection refs', async () => {
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-act-materializer-gui-projection',
    attemptId: 'codex-command-act-materializer-gui-projection-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Forged GUI projection completion.',
      evidenceRefs: ['gui.present:fake-computer-use-action'],
      executionUnits: [{
        id: 'EU-forged-gui-projection',
        tool: 'gui.present',
        status: 'done',
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /runtime-owned action evidence/i);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-computer-use-action/);
});

test('Agent Host Turn Loop blocks multi-step product completion claims without current-run completion evidence', async () => {
  const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-workflow-completion-gate',
    attemptId: 'codex-command-workflow-completion-gate-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Workflow completed successfully.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'browser-host-session:visible/action-state/click-1',
        'action-ledger:browser-host-session/visible/type-1',
        'runtime-truth:act-source/browser-host-session/visible',
      ],
      claims: [{
        id: 'claim-forged-workflow-completion',
        type: 'product-completion',
        text: 'The source to writer to preview workflow is complete.',
        supportingRefs: ['action-ledger:browser-host-session/visible/type-1'],
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.claimType), /runtime-diagnostic/);
  assert.doesNotMatch(JSON.stringify(result), /product workflow passed|taskOutcome":"satisfied/);
});

test('Agent Host Turn Loop does not let generic artifact workEvidence satisfy product completion', async () => {
  const commandText = 'Click the writer window, type the final report, save the artifact, open preview, and mark the artifact workflow complete.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-generic-artifact-work-evidence',
    attemptId: 'codex-command-generic-artifact-work-evidence-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Final artifact workflow completed successfully.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'action-ledger:browser-host-session/visible/type-1',
        'runtime-truth:act-source/browser-host-session/visible',
      ],
      workEvidence: [{
        id: 'workEvidence:generated-task/final-report',
        kind: 'generated-task-artifact',
        provider: 'generated-task-runner',
        status: 'success',
        outputSummary: 'Generated artifact completion candidate',
        evidenceRefs: [
          'workEvidence:generated-task/final-report',
          'artifact:final-report',
        ],
        artifactRefs: ['artifact:final-report'],
      }],
      claims: [{
        id: 'claim-generic-artifact-workflow-completion',
        type: 'product-completion',
        text: 'The final report artifact workflow is complete.',
        supportingRefs: ['artifact:final-report'],
      }],
    }),
  });

  assert.ok(result);
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.claimType), /runtime-diagnostic/);
  assert.notEqual((result?.result.completionTruth as Record<string, unknown> | undefined)?.status, 'satisfied');
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied/);
});

test('Agent Host Turn Loop blocks workflow completion refs when current-run bundle files are absent', async () => {
  const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
  const runDir = '.sciforge/vision-runs/workflow-completion-missing-files';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-workflow-completion-pass',
    attemptId: 'codex-command-workflow-completion-pass-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Workflow completed with current-run bundle evidence.',
      claimType: 'product-workflow-completion',
      evidenceRefs: [
        'action-ledger:browser-host-session/visible/type-1',
        `${runDir}/vision-trace.json`,
        `${runDir}/primitive-trace.json`,
        `${runDir}/current-run.json`,
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      claims: [{
        id: 'claim-workflow-completion-pass',
        type: 'product-completion',
        text: 'The workflow is complete.',
        supportingRefs: [`${runDir}/cu-user-acceptance-manifest.json`],
      }],
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence/i);
  assert.match(String(result?.result.reasoningTrace), /validated current-run workflow completion evidence/i);
});

test('Agent Host Turn Loop blocks historical isolated-L3 workflow completion bundles', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-completion-bundle-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Click the first window, type notes into the writer window, press save, open the preview window, and mark the workflow complete.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-workflow-completion-validated-pass',
      attemptId: 'codex-command-workflow-completion-validated-pass-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Workflow completed with validated current-run bundle evidence.',
        claimType: 'product-workflow-completion',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/primitive-trace.json`,
          `${runDir}/cu-user-acceptance-manifest.json`,
          `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
        ],
        claims: [{
          id: 'claim-workflow-completion-validated-pass',
          type: 'product-completion',
          text: 'The workflow is complete.',
          supportingRefs: [`${runDir}/cu-user-acceptance-manifest.json`],
        }],
      }),
    });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.equal(result?.result.claimType, 'runtime-diagnostic');
  assert.match(String(result?.result.message), /isolated-L3 evidence is retained for historical diagnostics only|current-run completion evidence/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop blocks explicit completionTruth when refs are GUI projection only', async () => {
  const commandText = 'Type notes into the visible editor.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-explicit-completion-truth-gui',
    attemptId: 'codex-command-explicit-completion-truth-gui-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Runtime action executed.',
      claimType: 'runtime-action',
      evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
      completionTruth: {
        schemaVersion: 'sciforge.computer-use.completion-truth.v1',
        scope: 'workflow',
        status: 'satisfied',
        validator: 'current-run-live-acceptance-bundle',
        evidenceRefs: ['gui.present:fake-completion'],
      },
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
  assert.match(String(result?.result.message), /current-run completion evidence|completion truth/i);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-completion/);
});

test('Agent Host Turn Loop blocks explicit completionTruth backed by historical isolated-L3 evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-explicit-completion-truth-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Type notes into the visible editor.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-explicit-completion-truth-valid',
      attemptId: 'codex-command-explicit-completion-truth-valid-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Runtime action executed.',
        claimType: 'runtime-action',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/primitive-trace.json`,
        ],
        completionTruth: {
          schemaVersion: 'sciforge.computer-use.completion-truth.v1',
          scope: 'workflow',
          status: 'satisfied',
          validator: 'current-run-live-acceptance-bundle',
          evidenceRefs: [
            `${runDir}/cu-user-acceptance-manifest.json`,
            `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
          ],
        },
      }),
    });

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
    assert.doesNotMatch(JSON.stringify(result), /gui\.present/);
    const completionTruth = result?.result.completionTruth as Record<string, unknown>;
    assert.equal(completionTruth.schemaVersion, 'sciforge.computer-use.completion-truth.v1');
    assert.equal(completionTruth.scope, 'workflow');
    assert.equal(completionTruth.status, 'blocked');
    assert.equal(completionTruth.validator, 'current-run-live-acceptance-bundle');
    assert.deepEqual(completionTruth.evidenceRefs, [
      `${runDir}/cu-user-acceptance-manifest.json`,
      `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
    ]);
    assert.match(String(completionTruth.reason), /isolated-L3 evidence is retained for historical diagnostics only|current-run completion evidence/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop blocks package bridge workEvidence backed by historical isolated-L3 evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agent-host-package-bridge-completion-truth-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const commandText = 'Type notes into the visible editor.';
    const runDir = '.sciforge/vision-runs/cu-next-07-wrapper';
    const result = await evaluateCodexAgentHostTurnLoop({
      input: readyAgentHostInput(commandText),
      commandText,
      workspacePath: workspace,
      commandId: 'codex-command-package-bridge-completion-truth-valid',
      attemptId: 'codex-command-package-bridge-completion-truth-valid-attempt-1',
      computerUseActMaterializer: async () => ({
        status: 'completed',
        message: 'Runtime action executed.',
        claimType: 'runtime-action',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          `${runDir}/vision-trace.json`,
          `${runDir}/primitive-trace.json`,
        ],
        workEvidence: [{
          kind: 'validate',
          provider: 'computer-use-package-bridge',
          status: 'verified',
          outputSummary: 'Computer Use completion-grade evidence',
          evidenceRefs: [
            `${runDir}/cu-user-acceptance-manifest.json`,
            `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
            'gui.present:fake-completion',
          ],
        }],
      }),
    });

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'blocked');
    assert.equal((result?.result.completionTruth as Record<string, unknown> | undefined)?.status, 'blocked');
    assert.match(String(result?.result.message), /isolated-L3 evidence is retained for historical diagnostics only|current-run completion evidence/i);
    assert.doesNotMatch(JSON.stringify(result), /gui\.present:fake-completion/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop sanitizes action-scoped completionTruth metadata', async () => {
  const commandText = 'Type notes into the visible editor.';
  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput(commandText),
    commandText,
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-action-completion-truth-sanitize',
    attemptId: 'codex-command-action-completion-truth-sanitize-attempt-1',
    computerUseActMaterializer: async () => ({
      status: 'completed',
      message: 'Runtime action executed.',
      claimType: 'runtime-action',
      evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
      completionTruth: {
        schemaVersion: 'sciforge.computer-use.completion-truth.v1',
        scope: 'action',
        status: 'satisfied',
        validator: 'unsafe-token-secret-12345678',
        reason: 'raw token secret should not leave materializer output',
        evidenceRefs: [
          'action-ledger:browser-host-session/visible/type-1',
          'https://example.test/leak',
          'gui.present:fake-action-truth',
        ],
      },
    }),
  });

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.deepEqual(result?.result.completionTruth, {
    schemaVersion: 'sciforge.computer-use.completion-truth.v1',
    scope: 'action',
    status: 'satisfied',
    evidenceRefs: ['action-ledger:browser-host-session/visible/type-1'],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token|https:\/\/example\.test|gui\.present/);
});

test('Agent Host runtime truth sanitizer preserves bounded human takeover controlPath refs', async () => {
  const truth = await resolveCodexAgentHostRuntimeTruth({
    input: readyAgentHostInput('Type notes into the visible editor.'),
    commandText: 'Type notes into the visible editor.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-runtime-truth-control-path',
    attemptId: 'codex-command-runtime-truth-control-path-attempt-1',
    runtimeTruthResolver: async () => ({
      schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
      permissions: {
        refs: ['permission:turn/runtime-control', 'gui.present:fake-permission'],
        stopCancelPath: true,
        controlPath: {
          ready: true,
          takeoverRefs: ['lease:human-takeover/lease-1', 'gui.present:fake-takeover'],
          pauseRefs: ['lease:human-takeover/lease-1/pause', 'ui:fake-pause'],
          resumeRefs: ['lease:human-takeover/lease-1/resume', 'https://example.invalid/resume'],
          stopRefs: ['lease:human-takeover/lease-1/stop', 'fixture:fake-stop'],
          cancelRefs: ['cancel:runtime-codex/codex-command-runtime-truth-control-path/attempt-1', 'token=secret'],
        },
      },
      refs: [
        'runtime-truth:act-source/runtime-control',
        'lease:human-takeover/lease-1/resume',
        'https://example.invalid/leak',
      ],
    }),
  });

  assert.deepEqual(truth?.permissions?.controlPath, {
    ready: true,
    takeoverRefs: ['lease:human-takeover/lease-1'],
    pauseRefs: ['lease:human-takeover/lease-1/pause'],
    resumeRefs: ['lease:human-takeover/lease-1/resume'],
    stopRefs: ['lease:human-takeover/lease-1/stop'],
    cancelRefs: ['cancel:runtime-codex/codex-command-runtime-truth-control-path/attempt-1'],
  });
  assert.doesNotMatch(JSON.stringify(truth), /gui(?:\.|:)|ui:|fixture:|https?:\/\/|token/);
});

function readyWindowActionStore(now: string) {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  const session = enterWindowActionSession(createWindowActionSession({
    id: 'vscode-main',
    windowRef: 'window:vscode:main',
    app: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
    bounds: { x: 20, y: 30, width: 1200, height: 800 },
    scale: 2,
    screenId: 'screen-built-in',
    evidenceRefs: [{ kind: 'session', ref: 'window-action-session:vscode-main' }],
    timestamp: now,
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now, actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1' });
  store.upsert(session, {
    refs: ['action-ledger:window-action-session/vscode-main/upsert'],
    targetRefs: ['window-action-session:vscode-main'],
    observationRefs: windowActionObservationRefs(),
    timestamp: now,
  });
  return store;
}

function readyWindowActionAgentHostInput(intentText: string, now: string) {
  return {
    ...readyAgentHostInput(intentText),
    target: {
      bound: true,
      summary: 'Verified active desktop window',
      refs: ['window-action-session:vscode-main'],
    },
    observation: {
      fresh: true,
      refs: windowActionObservationRefs(),
      observedAt: now,
      capturedAt: now,
      freshnessCheckedAt: now,
      freshnessCheck: {
        status: 'current',
        observedAt: now,
        checkedAt: now,
        maxAgeMs: 30_000,
      },
    },
    permissions: {
      refs: ['permission:turn/turn-loop-window-action/ordinary-navigation'],
      scopedExecutorRefs: ['window-action-session:vscode-main/executor-scope'],
      stopCancelPath: true,
    },
    refs: ['window-action-session:vscode-main'],
  };
}

function readyWindowActionRuntimeTruth(now: string): CodexAgentHostRuntimeTruth {
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
      summary: 'Verified active desktop window',
      refs: ['window-action-session:vscode-main'],
    },
    observation: {
      fresh: true,
      refs: windowActionObservationRefs(),
      observedAt: now,
      capturedAt: now,
      freshnessCheckedAt: now,
      freshnessCheck: {
        status: 'current',
        observedAt: now,
        checkedAt: now,
        maxAgeMs: 30_000,
      },
    },
    permissions: {
      refs: ['permission:turn/turn-loop-window-action/ordinary-navigation'],
      scopedExecutorRefs: ['window-action-session:vscode-main/executor-scope'],
      stopCancelPath: true,
    },
    refs: [
      'window-action-session:vscode-main',
      'adapter-registry:window-action-session/app-native-command/computer-use',
      'cancel:runtime-turn/codex-command-turn-loop-window-action',
    ],
  };
}

function windowActionObservationRefs(): string[] {
  return [
    'window-action-session:vscode-main/evidence/before-frame',
    'accessibility-ui-automation:vscode-main/state-snapshot-before',
    'accessibility-ui-automation:vscode-main/text-before',
    'desktop-window:vscode-main',
  ];
}

function readyAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText,
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Current browser page',
      refs: ['browser-host-session:visible'],
    },
    observation: {
      fresh: true,
      refs: ['browser-host-session:visible/frame.png'],
    },
    permissions: {
      refs: ['permission:turn/low-risk-navigation'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
      stopCancelPath: true,
    },
  };
}
