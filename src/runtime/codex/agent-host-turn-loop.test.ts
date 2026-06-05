import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { evaluateCodexAgentHostTurnLoop, resolveCodexAgentHostRuntimeTruth } from './agent-host-turn-loop.js';
import { writeBundleLocalCuNext07Acceptance } from '../../../tests/smoke/helpers/cu-next-runner-fixtures.js';

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
        message: 'Computer Use action executed through BrowserHostSession.',
        evidenceRefs: ['browser-host-session:visible/action-state/scroll-1'],
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
  assert.equal(result?.result.message, 'Computer Use action executed through BrowserHostSession.');
  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.doesNotMatch(JSON.stringify(result), /ready-for-act/);
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
        `${runDir}/tui-host-run-task-chain.json`,
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

test('Agent Host Turn Loop allows workflow completion claims with validated current-run bundle evidence', async () => {
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
          `${runDir}/tui-host-run-task-chain.json`,
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

  assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
  assert.equal(result?.result.claimType, 'product-workflow-completion');
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

test('Agent Host Turn Loop exposes validated explicit completionTruth for user-level completion', async () => {
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
          `${runDir}/tui-host-run-task-chain.json`,
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

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    assert.doesNotMatch(JSON.stringify(result), /gui\.present/);
    assert.deepEqual(result?.result.completionTruth, {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'workflow',
      status: 'satisfied',
      validator: 'current-run-live-acceptance-bundle',
      evidenceRefs: [
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      currentRun: {
        runDirRef: runDir,
        acceptanceManifestRef: `${runDir}/cu-user-acceptance-manifest.json`,
        completionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Agent Host Turn Loop maps package bridge workEvidence to validated workflow completionTruth', async () => {
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
          `${runDir}/tui-host-run-task-chain.json`,
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

    assert.equal((result?.result.displayIntent as Record<string, unknown>).status, 'completed');
    assert.deepEqual(result?.result.completionTruth, {
      schemaVersion: 'sciforge.computer-use.completion-truth.v1',
      scope: 'workflow',
      status: 'satisfied',
      validator: 'current-run-live-acceptance-bundle',
      evidenceRefs: [
        `${runDir}/vision-trace.json`,
        `${runDir}/tui-host-run-task-chain.json`,
        `${runDir}/cu-user-acceptance-manifest.json`,
        `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      ],
      currentRun: {
        runDirRef: runDir,
        acceptanceManifestRef: `${runDir}/cu-user-acceptance-manifest.json`,
        completionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
      },
    });
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
      stopCancelPath: true,
    },
  };
}
