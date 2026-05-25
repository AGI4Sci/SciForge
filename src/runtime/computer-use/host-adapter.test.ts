import assert from 'node:assert/strict';
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
    workspacePath: '/tmp/workspace',
    selectedToolIds: ['local.vision-sense'],
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
  assert.equal(contract.actionProvider, COMPUTER_USE_ACTION_PROVIDER_ID);
  assert.equal(contract.ports.capture.provider, 'target-window-capture');
  assert.equal(contract.ports.execute.inputAdapter, 'shared-system-input-acknowledged');
  assert.deepEqual(contract.forbiddenPorts, ['requestApproval', 'gui.present', 'gui.ask_user']);
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
    approvalRequest: {
      id: 'approval:computer-use:run-2',
      prompt: 'Allow Computer Use to click the visible Submit button?',
      riskLevel: 'high',
      actionRef: 'ref:planned-action:submit',
    },
  });

  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.port, 'gui.present');
  assert.equal(actions[1]?.schemaVersion, COMPUTER_USE_TUI_HOST_ACTIONS_SCHEMA);
  assert.equal(actions[1]?.port, 'gui.ask_user');
  assert.equal(actions[1]?.target, 'computer-use.approval-request');
  assert.deepEqual(actions[1]?.payload.approvalRequest, {
    id: 'approval:computer-use:run-2',
    prompt: 'Allow Computer Use to click the visible Submit button?',
    riskLevel: 'high',
    actionRef: 'ref:planned-action:submit',
  });
  assert.deepEqual(actions[1]?.payload.relatedRefs, ['.sciforge/vision-runs/run-2/vision-trace.json']);
});
