import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  COMPUTER_USE_ACTION_PROVIDER_ID,
  COMPUTER_USE_HOST_PORTS_SCHEMA,
  COMPUTER_USE_REQUEST_SCHEMA,
  COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA,
  computerUseHostPortsContract,
  computerUseResultToTuiHostActions,
  gatewayRequestToComputerUseRequest,
} from './host-adapter.js';
import type { ComputerUseConfig } from './types.js';

const baseConfig: ComputerUseConfig = {
  desktopBridgeEnabled: true,
  dryRun: false,
  captureDisplays: [1],
  desktopPlatform: 'darwin',
  windowTarget: {
    enabled: true,
    required: true,
    mode: 'app-window',
    appName: 'Safari',
    coordinateSpace: 'window-local',
    inputIsolation: 'require-focused-target',
  },
  maxSteps: 5,
  allowHighRiskActions: false,
  allowSharedSystemInput: true,
  planner: { allowOpenAiRuntime: false, timeoutMs: 120000, maxTokens: 512 },
  grounder: {
    baseUrl: 'http://127.0.0.1:18081',
    timeoutMs: 30000,
    allowServiceLocalPaths: false,
    upload: { strategy: 'inline' },
  },
  testActionFixtureMode: false,
  testOnlyPlannedActions: [],
};

test('gateway adapter builds stable Computer Use action provider request', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use run click visible search box',
    handoffSource: 'ui-chat',
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
    selectedActionIds: ['action.sciforge.computer-use'],
    artifacts: [],
    humanApproval: { decisionRef: 'approval:cu-ok' },
  }, baseConfig, '/tmp/workspace');

  assert.equal(request.schemaVersion, COMPUTER_USE_REQUEST_SCHEMA);
  assert.equal(request.providers.action, COMPUTER_USE_ACTION_PROVIDER_ID);
  assert.equal(request.providers.sense, 'local.vision-sense');
  assert.equal(request.providers.grounder, 'kv-ground');
  assert.equal(request.riskPolicy, 'allow-confirmed');
  assert.equal(request.approvalRef, 'approval:cu-ok');
  assert.equal(request.windowTarget.mode, 'app-window');
  const bridge = request.metadata.bridge as { allowSharedSystemInput?: boolean };
  assert.equal(bridge.allowSharedSystemInput, true);
  assert.deepEqual(request.metadata.chatOrigin, {
    schemaVersion: 'sciforge.computer-use.chat-origin.v1',
    handoffSource: 'ui-chat',
    entrypoint: 'sciforge-chat',
    terminalEquivalentText: true,
    selectedActionProvider: 'action.sciforge.computer-use',
    selectedToolIds: ['local.vision-sense'],
  });
});

test('gateway adapter expands confirmed approval retry into prior approved action context', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use approve --approval-ref "approval:computer-use:cu-risk"',
    handoffSource: 'ui-chat',
    workspacePath: '/tmp/workspace',
    selectedActionIds: ['action.sciforge.computer-use'],
    artifacts: [],
    humanApproval: {
      approvalRef: 'approval:computer-use:cu-risk',
      approvalProvenance: {
        schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
        source: 'prior-gui-ask-user',
        approvalRef: 'approval:computer-use:cu-risk',
        approvalRequest: {
          approvalRef: 'approval:computer-use:cu-risk',
          confirmation_text: 'Allow Computer Use to click Export?',
          action_kind: 'click',
        },
        highRiskAction: {
          actionKind: 'click',
          targetDescription: 'Export button',
        },
      },
    },
  }, baseConfig, '/tmp/workspace');

  assert.match(request.task, /^\/computer-use approve --approval-ref/);
  assert.match(request.task, /Continue the prior approved action/);
  assert.match(request.task, /do not look for a visible Approve button/);
  assert.match(request.task, /Approved action kind: click/);
  assert.match(request.task, /Approved target: Export button/);
  assert.equal(request.riskPolicy, 'allow-confirmed');
  assert.equal(request.approvalRef, 'approval:computer-use:cu-risk');
  assert.ok((request.metadata.approvalProvenance as Record<string, unknown>).highRiskAction);
});

test('gateway adapter recovers approval provenance from workspace sidecars for command approval refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-host-adapter-'));
  try {
    const approvalRef = 'approval:computer-use:workspace-recovered';
    const runDir = join(workspace, '.sciforge/vision-runs/run-workspace-source');
    await mkdir(runDir, { recursive: true });
    await writeJson(join(runDir, 'approval-request.json'), {
      schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
      runId: 'run-workspace-source',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:workspace-recovered',
      approvalRef,
      riskActionHash: 'risk-action:workspace-recovered',
      approvalRequest: {
        id: 'approval-request:workspace-recovered',
        approvalRef,
        riskActionHash: 'risk-action:workspace-recovered',
        confirmation_text: 'Allow Computer Use to type the guarded text?',
        action_kind: 'type_text',
      },
    });
    await writeJson(join(runDir, 'gui-ask-user.json'), {
      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
      port: 'gui.ask_user',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:workspace-recovered',
      approvalRef,
      riskActionHash: 'risk-action:workspace-recovered',
      payload: {
        approvalRequest: {
          id: 'approval-request:workspace-recovered',
          approvalRef,
          riskActionHash: 'risk-action:workspace-recovered',
        },
      },
    });
    await writeJson(join(runDir, 'risk-audit.json'), {
      schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
      runId: 'run-workspace-source',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:workspace-recovered',
      approvalRef,
      riskActionHash: 'risk-action:workspace-recovered',
      highRiskAction: {
        actionKind: 'type_text',
        targetDescription: 'Guarded editor field',
      },
    });

    const request = gatewayRequestToComputerUseRequest({
      skillDomain: 'knowledge',
      prompt: 'Continue the approved Computer Use action.',
      commandText: `/computer-use approve --approval-ref "${approvalRef}"`,
      workspacePath: workspace,
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
    } as Parameters<typeof gatewayRequestToComputerUseRequest>[0] & { commandText: string }, baseConfig, workspace);

    assert.equal(request.riskPolicy, 'allow-confirmed');
    assert.equal(request.approvalRef, approvalRef);
    assert.match(request.task, /Approved action kind: type_text/);
    assert.match(request.task, /Approved target: Guarded editor field/);
    const provenance = request.metadata.approvalProvenance as Record<string, unknown>;
    assert.equal(provenance.source, 'workspace-approval-sidecar');
    assert.equal(provenance.sourceApprovalRequestRef, '.sciforge/vision-runs/run-workspace-source/approval-request.json');
    assert.equal(provenance.sourceGuiAskUserRecordRef, '.sciforge/vision-runs/run-workspace-source/gui-ask-user.json');
    assert.equal(provenance.sourceRiskAuditRef, '.sciforge/vision-runs/run-workspace-source/risk-audit.json');
    assert.deepEqual(provenance.highRiskAction, {
      actionKind: 'type_text',
      targetDescription: 'Guarded editor field',
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('gateway adapter keeps prompt-only approval ref fail-closed when workspace sidecars are absent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-host-adapter-missing-'));
  try {
    const request = gatewayRequestToComputerUseRequest({
      skillDomain: 'knowledge',
      prompt: '/computer-use approve --approval-ref "approval:computer-use:missing-sidecar"',
      workspacePath: workspace,
      selectedActionIds: ['action.sciforge.computer-use'],
      artifacts: [],
    }, baseConfig, workspace);

    assert.equal(request.riskPolicy, 'fail-closed');
    assert.equal(request.approvalRef, undefined);
    assert.equal(request.metadata.approvalProvenance, undefined);
    assert.doesNotMatch(request.task, /Approved retry context/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('gateway adapter projects generic planner acceptance contract from UI state', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use run operate the target window',
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
    artifacts: [],
    uiState: {
      computerUseLong: {
        taskId: 'T084',
        scenarioId: 'CU-LONG-999',
        cuNextTaskId: 'CU-NEXT-99',
        round: 2,
        title: 'Generic acceptance projection',
        roundPrompt: 'Perform the next visible GUI step.',
        expectedTrace: ['before screenshot refs', 'generic action ledger'],
        acceptance: ['at least one non-wait generic action'],
        requiredEvidence: ['vision-trace.json'],
        failureRecord: ['failure diagnostics'],
        requiredPipeline: ['WindowTarget', 'RuntimeCodexPlanner'],
        safetyBoundary: { noDomAccessibility: true },
        acceptanceProgress: {
          schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
          minimumScenarioActionCount: 20,
          suggestedCurrentRoundActionTarget: 5,
        },
      },
      computerUseNext: {
        taskId: 'CU-NEXT-99',
        requirements: ['l3-workflow-refs', 'no-dom-playwright-accessibility'],
      },
    },
  }, baseConfig, '/tmp/workspace');

  const contract = request.metadata.plannerAcceptanceContract as Record<string, unknown>;
  assert.equal(contract.schemaVersion, 'sciforge.computer-use.planner-acceptance-contract.v1');
  assert.equal(contract.scenarioId, 'CU-LONG-999');
  assert.equal(contract.cuNextTaskId, 'CU-NEXT-99');
  assert.deepEqual(contract.expectedTrace, ['before screenshot refs', 'generic action ledger']);
  assert.deepEqual(contract.acceptanceProgress, {
    schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
    minimumScenarioActionCount: 20,
    suggestedCurrentRoundActionTarget: 5,
  });
  assert.deepEqual(contract.requirements, ['l3-workflow-refs', 'no-dom-playwright-accessibility']);
  assert.doesNotMatch(JSON.stringify(contract), /DOMSnapshot|accessibilityTree|data:image/);
});

test('gateway adapter projects sanitized completion evidence policy from UI state', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use run operate the target window',
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
    artifacts: [],
    uiState: {
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        secret: 'SECRET_SHOULD_NOT_LEAK',
        producers: [
          {
            id: 'computer-use.embedded-isolated-desktop-l3',
            enabled: true,
            trigger: 'on-completed-current-run',
            apiKey: 'SECRET_PRODUCER_KEY',
          },
          {
            id: 'computer-use.embedded-isolated-desktop-l3',
            enabled: true,
            secret: 'MISSING_TRIGGER_SHOULD_NOT_LEAK',
          },
          {
            id: 'computer-use.unknown-producer',
            enabled: true,
            trigger: 'on-completed-current-run',
            secret: 'UNKNOWN_PRODUCER_SHOULD_NOT_LEAK',
          },
        ],
      },
    },
  }, baseConfig, '/tmp/workspace');

  assert.deepEqual(request.metadata.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(request.metadata.completionEvidencePolicy),
    /SECRET_SHOULD_NOT_LEAK|SECRET_PRODUCER_KEY|MISSING_TRIGGER_SHOULD_NOT_LEAK|UNKNOWN_PRODUCER_SHOULD_NOT_LEAK|unknown-producer/,
  );
});

test('gateway adapter projects bounded Computer Use continuation sidecar context from references', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use continue --continuation-request-ref ".sciforge/vision-runs/run-repair/continuation-request.json"',
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
    artifacts: [],
    references: [
      {
        kind: 'file',
        ref: '.sciforge/vision-runs/run-repair/blocked-manifest.json',
        payload: {
          sidecar: {
            schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
            status: 'blocked',
            reason: 'Verifier could not confirm the visible artifact.',
            failedStage: 'visible-artifact-final-guard',
            continuationRequestRef: '.sciforge/vision-runs/run-repair/continuation-request.json',
          },
        },
      },
      {
        kind: 'file',
        ref: '.sciforge/vision-runs/run-repair/repair-hint.json',
        payload: {
          sidecar: {
            schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
            status: 'repair-needed',
            reason: 'Produce the report with a fresh visible observation.',
            nextAttempt: {
              reuseTraceRef: '.sciforge/vision-runs/run-repair/vision-trace.json',
              reuseRunTaskChainRef: '.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json',
              requireFreshObservation: true,
              preserveInputIsolation: true,
              privateHugeField: 'must not leak',
            },
          },
        },
      },
      {
        kind: 'file',
        ref: '.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json',
      },
    ],
  }, baseConfig, '/tmp/workspace');

  const contract = request.metadata.plannerAcceptanceContract as Record<string, unknown>;
  assert.equal(contract.schemaVersion, 'sciforge.computer-use.planner-acceptance-contract.v1');
  const continuation = contract.computerUseContinuation as Record<string, unknown>;
  assert.equal(continuation.schemaVersion, 'sciforge.computer-use.continuation-context.v1');
  assert.deepEqual(continuation.continuationRequestRefs, ['.sciforge/vision-runs/run-repair/continuation-request.json']);
  assert.deepEqual(continuation.repairHintRefs, ['.sciforge/vision-runs/run-repair/repair-hint.json']);
  assert.deepEqual(continuation.runTaskChainRefs, ['.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json']);
  assert.match(JSON.stringify(continuation), /Verifier could not confirm the visible artifact/);
  assert.match(JSON.stringify(continuation), /Produce the report with a fresh visible observation/);
  assert.doesNotMatch(JSON.stringify(continuation), /privateHugeField|must not leak|data:image|accessibilityTree|DOMSnapshot/);
});

test('gateway adapter hydrates bounded Computer Use continuation sidecar context from workspace refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-continuation-sidecars-'));
  try {
    const runDir = join(workspace, '.sciforge/vision-runs/run-repair');
    await mkdir(runDir, { recursive: true });
    await writeJson(join(runDir, 'blocked-manifest.json'), {
      schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
      status: 'blocked',
      reason: 'Previous attempt stopped before a visible final artifact.',
      failedStage: 'visible-artifact-final-guard',
      privateHugeField: 'must not leak',
    });
    await writeJson(join(runDir, 'repair-hint.json'), {
      schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
      status: 'repair-needed',
      reason: 'Retry with one safe visible local artifact action.',
      nextAttempt: {
        reuseTraceRef: '.sciforge/vision-runs/run-repair/vision-trace.json',
        reuseRunTaskChainRef: '.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json',
        requireFreshObservation: true,
        privateHugeField: 'must not leak',
      },
    });
    await writeJson(join(runDir, 'continuation-request.json'), {
      schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
      status: 'repair-needed',
      continuationRequestRef: '.sciforge/vision-runs/run-repair/continuation-request.json',
      requestRef: '.sciforge/vision-runs/run-repair/computer-use-request.json',
    });

    const request = gatewayRequestToComputerUseRequest({
      skillDomain: 'knowledge',
      prompt: [
        '/computer-use continue --continuation-request-ref ".sciforge/vision-runs/run-repair/continuation-request.json"',
        'Approval/source refs:',
        '- .sciforge/vision-runs/run-repair/blocked-manifest.json',
        '- .sciforge/vision-runs/run-repair/repair-hint.json',
        '- .sciforge/vision-runs/run-repair/tui-host-run-task-chain.json',
      ].join('\n'),
      workspacePath: workspace,
      selectedToolIds: ['local.vision-sense'],
      artifacts: [],
    }, baseConfig, workspace);

    const contract = request.metadata.plannerAcceptanceContract as Record<string, unknown>;
    const continuation = contract.computerUseContinuation as Record<string, unknown>;
    assert.deepEqual(continuation.continuationRequestRefs, ['.sciforge/vision-runs/run-repair/continuation-request.json']);
    assert.deepEqual(continuation.repairHintRefs, ['.sciforge/vision-runs/run-repair/repair-hint.json']);
    assert.deepEqual(continuation.runTaskChainRefs, ['.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json']);
    assert.match(JSON.stringify(continuation), /Previous attempt stopped before a visible final artifact/);
    assert.match(JSON.stringify(continuation), /Retry with one safe visible local artifact action/);
    assert.doesNotMatch(JSON.stringify(continuation), /privateHugeField|must not leak/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('gateway adapter does not advertise visual grounder fallback when KV-Ground is absent', () => {
  const request = gatewayRequestToComputerUseRequest({
    skillDomain: 'knowledge',
    prompt: '/computer-use run click visible search box',
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
    artifacts: [],
  }, {
    ...baseConfig,
    grounder: {
      timeoutMs: 30000,
      allowServiceLocalPaths: false,
      upload: { strategy: 'inline' },
    },
  }, '/tmp/workspace');

  assert.equal(request.providers.grounder, undefined);
  assert.doesNotMatch(JSON.stringify(request), /openai-compatible-vision-grounder|SCIFORGE_VISION_GROUNDER_LLM|visualGrounder/i);
});

test('host ports contract exposes platform ports and forbids direct GUI calls', () => {
  const contract = computerUseHostPortsContract(baseConfig);

  assert.equal(contract.schemaVersion, COMPUTER_USE_HOST_PORTS_SCHEMA);
  assert.equal(contract.hostAdapterSchemaVersion, 'sciforge.computer-use.host-adapter.v1');
  assert.equal(contract.actionProvider, COMPUTER_USE_ACTION_PROVIDER_ID);
  assert.equal(contract.ports.capture.provider, 'target-window-capture');
  assert.equal(contract.ports.plan.provider, 'runtime-codex-tui-text-planner');
  assert.equal(contract.ports.crop.provider, 'host-focus-region-crop');
  assert.equal(contract.ports.query.optional, true);
  assert.equal(contract.ports.locate.provider, 'kv-ground');
  assert.equal(contract.ports.execute.inputAdapter, 'shared-system-input-acknowledged');
  assert.equal(contract.ports.verify.provider, 'layered-vision-verifier');
  assert.deepEqual(contract.requiredPorts, ['capture', 'plan', 'locate', 'execute', 'verify']);
  assert.deepEqual(contract.optionalPorts, ['crop', 'query', 'writeTrace', 'emitEvent']);
  assert.deepEqual(contract.forbiddenPorts, ['requestApproval', 'gui.present', 'gui.ask_user']);
  assert.equal(contract.approvalBoundary.policy, 'refs-first-approval-sidecars-only');
  assert.deepEqual(contract.approvalBoundary.packageMayReturn, [
    'needs-confirmation',
    'approvalRequestRef',
    'draftRef',
    'auditRef',
    'riskAuditRef',
    'approvalRequestSidecarRef',
  ]);
  assert.deepEqual(contract.adapterBoundary.reusableBy, ['codex-cli-plugin', 'sciforge-runtime']);
});

test('result adapter presents refs-first Computer Use trace summaries through TUI host action metadata', () => {
  const actions = computerUseResultToTuiHostActions({
    message: 'Computer Use action provider completed 1 action(s). Trace: .sciforge/vision-runs/run-1/vision-trace.json.',
    executionUnits: [{
      id: 'EU-computer-use-run-1',
      status: 'done',
      outputArtifacts: ['.sciforge/vision-runs/run-1/vision-trace.json'],
      screenshotRef: '.sciforge/vision-runs/run-1/after.png',
    }],
    workEvidence: [{
      id: 'workEvidence:computer-use-action-provider:run-1',
      evidenceRefs: ['.sciforge/vision-runs/run-1/vision-trace.json', '.sciforge/vision-runs/run-1/after.png'],
    }],
    artifacts: [{
      id: 'ref:vision-sense-trace',
      path: '.sciforge/vision-runs/run-1/vision-trace.json',
      metadata: {
        screenshotRefs: [{
          path: '.sciforge/vision-runs/run-1/before.png',
          type: 'screenshot',
        }],
      },
    }],
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.schemaVersion, COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA);
  assert.equal(actions[0]?.port, 'gui.present');
  assert.equal(actions[0]?.target, 'computer-use.trace-summary');
  assert.equal(actions[0]?.payload.status, 'done');
  assert.deepEqual(actions[0]?.payload.traceRefs, ['.sciforge/vision-runs/run-1/vision-trace.json']);
  assert.deepEqual(actions[0]?.payload.screenshotRefs, [
    '.sciforge/vision-runs/run-1/before.png',
    '.sciforge/vision-runs/run-1/after.png',
  ]);
  assert.deepEqual(actions[0]?.payload.executionUnitRefs, ['EU-computer-use-run-1']);
  assert.deepEqual(actions[0]?.payload.workEvidenceRefs, ['workEvidence:computer-use-action-provider:run-1']);
});

test('result adapter maps approvalRequest to gui.ask_user while preserving related refs', () => {
  const actions = computerUseResultToTuiHostActions({
    status: 'blocked',
    traceRef: '.sciforge/vision-runs/run-2/vision-trace.json',
    packageBridge: {
      guiAskUserRecordRef: '.sciforge/vision-runs/run-2/gui-ask-user.json',
      approvalRequestRef: '.sciforge/vision-runs/run-2/approval-request.json',
      riskAuditRef: '.sciforge/vision-runs/run-2/risk-audit.json',
    },
    approvalRequest: {
      id: 'approval:computer-use:run-2',
      prompt: 'Allow Computer Use to click the visible Submit button?',
      riskLevel: 'high',
      actionRef: 'ref:planned-action:submit',
    },
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.port, 'gui.present');
  assert.deepEqual(actions[0]?.payload.guiAskUserRefs, ['.sciforge/vision-runs/run-2/gui-ask-user.json']);
  assert.deepEqual(actions[0]?.payload.approvalRequestRefs, ['.sciforge/vision-runs/run-2/approval-request.json']);
  assert.deepEqual(actions[0]?.payload.riskAuditRefs, ['.sciforge/vision-runs/run-2/risk-audit.json']);
  assert.equal(actions[1]?.schemaVersion, COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA);
  assert.equal(actions[1]?.port, 'gui.ask_user');
  assert.equal(actions[1]?.target, 'computer-use.approval-request');
  assert.deepEqual(actions[1]?.payload.approvalRequest, {
    id: 'approval:computer-use:run-2',
    prompt: 'Allow Computer Use to click the visible Submit button?',
    riskLevel: 'high',
    actionRef: 'ref:planned-action:submit',
  });
  assert.deepEqual(actions[1]?.payload.relatedRefs, [
    '.sciforge/vision-runs/run-2/vision-trace.json',
    '.sciforge/vision-runs/run-2/gui-ask-user.json',
    '.sciforge/vision-runs/run-2/approval-request.json',
    '.sciforge/vision-runs/run-2/risk-audit.json',
  ]);
});

test('result adapter does not treat slash commands as sidecar refs', () => {
  const commandText = [
    '/computer-use approve --approval-ref approval:computer-use:test',
    '',
    'Approval/source refs:',
    '- .sciforge/vision-runs/source/approval-request.json',
    '- .sciforge/vision-runs/source/gui-ask-user.json',
    '- .sciforge/vision-runs/source/risk-audit.json',
  ].join('\n');
  const actions = computerUseResultToTuiHostActions({
    status: 'completed',
    message: commandText,
    riskAuditRef: '.sciforge/vision-runs/current/risk-audit.json',
    sourceRiskAuditRef: '.sciforge/vision-runs/current/approval-source-risk-audit.json',
  });

  assert.equal(actions.length, 1);
  const payload = actions[0]?.payload as Record<string, unknown>;
  assert.deepEqual(payload.riskAuditRefs, ['.sciforge/vision-runs/current/risk-audit.json']);
  assert.deepEqual(payload.sourceApprovalRefs, ['.sciforge/vision-runs/current/approval-source-risk-audit.json']);
});

test('result adapter preserves repair sidecar refs for blocked Computer Use runs', () => {
  const actions = computerUseResultToTuiHostActions({
    status: 'blocked',
    message: 'Verifier could not confirm completion.',
    traceRef: '.sciforge/vision-runs/run-repair/vision-trace.json',
    packageBridge: {
      blockedManifestRef: '.sciforge/vision-runs/run-repair/blocked-manifest.json',
      repairHintRef: '.sciforge/vision-runs/run-repair/repair-hint.json',
      continuationRequestRef: '.sciforge/vision-runs/run-repair/continuation-request.json',
      directoryListingRef: '.sciforge/vision-runs/run-repair/directory-listing.json',
      tuiHostRunTaskChainRef: '.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json',
    },
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.port, 'gui.present');
  assert.deepEqual(actions[0]?.payload.blockedManifestRefs, ['.sciforge/vision-runs/run-repair/blocked-manifest.json']);
  assert.deepEqual(actions[0]?.payload.repairHintRefs, ['.sciforge/vision-runs/run-repair/repair-hint.json']);
  assert.deepEqual(actions[0]?.payload.continuationRequestRefs, ['.sciforge/vision-runs/run-repair/continuation-request.json']);
  assert.deepEqual(actions[0]?.payload.directoryListingRefs, ['.sciforge/vision-runs/run-repair/directory-listing.json']);
  assert.deepEqual(actions[0]?.payload.runTaskChainRefs, ['.sciforge/vision-runs/run-repair/tui-host-run-task-chain.json']);
});

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
