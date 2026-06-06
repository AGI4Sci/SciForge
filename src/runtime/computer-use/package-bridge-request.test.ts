import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import type { ComputerUseConfig } from './types.js';
import { visionSenseModelRouterCapabilities } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import {
  PACKAGE_BRIDGE_RUN_TASK_BOUNDARY,
  materializePackageBridgeActionProviderRequest,
  materializePackageBridgeRunTaskInvocation,
  materializePackageBridgeRuntimeSelectionDetail,
  materializePackageBridgeTraceRequest,
  packageBridgeCompletionProducerRequestOptIn,
} from './package-bridge-request.js';

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

function gatewayRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: '/computer-use run create the visible report',
    handoffSource: 'ui-chat',
    workspacePath: '/tmp/sciforge-workspace',
    selectedToolIds: ['local.vision-sense'],
    selectedActionIds: ['action.sciforge.computer-use'],
    artifacts: [],
    ...overrides,
  };
}

test('package bridge materializes normalized action provider request for package invocation', () => {
  const request = gatewayRequest({
    humanApproval: { approvalRef: 'approval:vision-sense-dry-run-smoke' },
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
            id: 'computer-use.unknown-producer',
            enabled: true,
            trigger: 'on-completed-current-run',
          },
        ],
      },
    },
  });

  const actionProviderRequest = materializePackageBridgeActionProviderRequest(
    request,
    baseConfig,
    '/tmp/sciforge-workspace',
  );

  assert.equal(actionProviderRequest.riskPolicy, 'fail-closed');
  assert.equal(actionProviderRequest.approvalRef, undefined);
  assert.equal(actionProviderRequest.providers.action, 'action.sciforge.computer-use');
  assert.equal(actionProviderRequest.providers.grounder, visionSenseModelRouterCapabilities.groundingTranslator);
  assert.equal(actionProviderRequest.metadata.ignoredApprovalRef, 'approval:vision-sense-dry-run-smoke');
  assert.equal((actionProviderRequest.metadata.chatOrigin as Record<string, unknown>).entrypoint, 'sciforge-chat');
  assert.deepEqual(actionProviderRequest.metadata.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(actionProviderRequest),
    /SECRET_SHOULD_NOT_LEAK|SECRET_PRODUCER_KEY|unknown-producer/,
  );
});

test('package bridge materializes runTask invocation request and host ports together', () => {
  const request = gatewayRequest({
    uiState: {
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        secret: 'SECRET_SHOULD_NOT_LEAK',
        producers: [{
          id: 'computer-use.embedded-isolated-desktop-l3',
          enabled: true,
          trigger: 'on-completed-current-run',
          apiKey: 'SECRET_PRODUCER_KEY',
        }],
      },
    },
  });

  const invocation = materializePackageBridgeRunTaskInvocation(
    request,
    baseConfig,
    '/tmp/sciforge-workspace',
  );
  const runtimeDetail = materializePackageBridgeRuntimeSelectionDetail(invocation, {
    runId: 'cu-package-bridge-request-helper',
    testActionFixtureMode: false,
    testOnlyPlannedActions: 0,
    planner: visionSenseModelRouterCapabilities.computerUsePlanner,
  });

  assert.equal(invocation.boundary, PACKAGE_BRIDGE_RUN_TASK_BOUNDARY);
  assert.equal(invocation.request.schemaVersion, 'sciforge.computer-use.request.v1');
  assert.equal(invocation.request.task, '/computer-use run create the visible report');
  assert.equal(invocation.request.providers.action, 'action.sciforge.computer-use');
  assert.equal(invocation.hostPorts.schemaVersion, 'sciforge.computer-use.host-ports.v1');
  assert.ok(invocation.hostPorts.ports.capture);
  assert.ok(invocation.hostPorts.ports.verify);
  assert.equal(invocation.completionProducerOptIn, true);
  assert.deepEqual(runtimeDetail.actionProviderRequest, invocation.request);
  assert.deepEqual(runtimeDetail.hostPorts, invocation.hostPorts);
  assert.equal(runtimeDetail.boundary, PACKAGE_BRIDGE_RUN_TASK_BOUNDARY);
  assert.equal(runtimeDetail.bridge, 'ts-package-host-port-loop');
  assert.equal(runtimeDetail.completionProducerOptIn, true);
  assert.doesNotMatch(
    JSON.stringify({ invocation, runtimeDetail }),
    /SECRET_SHOULD_NOT_LEAK|SECRET_PRODUCER_KEY|apiKey|secret/,
  );
});

test('package bridge trace request reuses the normalized package invocation request', () => {
  const request = gatewayRequest({
    prompt: '/computer-use run continue CU-NEXT work',
    humanApproval: { approvalRef: 'approval:vision-sense-dry-run-smoke' },
    uiState: {
      computerUseLong: {
        taskId: 'T084',
        cuNextTaskId: 'CU-NEXT-84',
        scenarioId: 'CU-LONG-084',
      },
      computerUseNext: {
        taskId: 'CU-NEXT-OTHER',
      },
    },
  });
  const actionProviderRequest = materializePackageBridgeActionProviderRequest(
    request,
    baseConfig,
    '/tmp/sciforge-workspace',
  );

  const traceRequest = materializePackageBridgeTraceRequest(request, actionProviderRequest);

  assert.equal(traceRequest.text, '/computer-use run continue CU-NEXT work');
  assert.equal(traceRequest.taskId, 'CU-NEXT-84');
  assert.equal(traceRequest.cuNextTaskId, 'CU-NEXT-84');
  assert.deepEqual(traceRequest.selectedToolIds, ['local.vision-sense']);
  assert.deepEqual(traceRequest.computerUseRequest, actionProviderRequest);
  assert.equal(traceRequest.computerUseRequest.riskPolicy, 'fail-closed');
  assert.equal(traceRequest.computerUseRequest.approvalRef, undefined);
  assert.equal(
    (traceRequest.computerUseRequest.metadata as Record<string, unknown>).ignoredApprovalRef,
    'approval:vision-sense-dry-run-smoke',
  );
});

test('package bridge completion producer opt-in is request scoped and sanitized', () => {
  assert.equal(packageBridgeCompletionProducerRequestOptIn(gatewayRequest()), false);
  assert.equal(packageBridgeCompletionProducerRequestOptIn(gatewayRequest({
    uiState: {
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        producers: [{
          id: 'computer-use.embedded-isolated-desktop-l3',
          enabled: true,
          trigger: 'on-completed-current-run',
        }],
      },
    },
  })), true);
  assert.equal(packageBridgeCompletionProducerRequestOptIn(gatewayRequest({
    uiState: {
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        producers: [{
          id: 'computer-use.embedded-isolated-desktop-l3',
          enabled: true,
          secret: 'MISSING_TRIGGER_SHOULD_NOT_ENABLE',
        }],
      },
    },
  })), false);
  assert.equal(packageBridgeCompletionProducerRequestOptIn(gatewayRequest({
    uiState: {
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        producers: [{
          id: 'computer-use.unknown-producer',
          enabled: true,
          trigger: 'on-completed-current-run',
        }],
      },
    },
  })), false);
});
