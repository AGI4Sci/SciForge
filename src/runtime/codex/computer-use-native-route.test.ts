import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computerUseGatewayRequest,
  createComputerUseNativeRouteStream,
} from './computer-use-native-route.js';

test('Computer Use native route projects sanitized completion evidence policy into gateway uiState', () => {
  const request = computerUseGatewayRequest({
    request: {
      commandText: '/computer-use write a visible report',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-policy',
      attemptId: 'attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        completionEvidencePolicy: {
          schemaVersion: 'sciforge.completion-evidence-policy.v1',
          secret: 'SECRET_POLICY_SHOULD_NOT_LEAK',
          producers: [{
            id: 'computer-use.embedded-isolated-desktop-l3',
            enabled: true,
            trigger: 'on-completed-current-run',
            token: 'SECRET_PRODUCER_SHOULD_NOT_LEAK',
          }, {
            id: 'computer-use.unknown-producer',
            enabled: true,
            trigger: 'on-completed-current-run',
          }],
        },
        computerUseNext: {
          taskId: 'CU-NEXT-01',
          scenarioId: 'CU-LONG-001',
          title: 'Briefing deck',
          requirements: ['refs-first-evidence-bundle', ''],
          safetyBoundary: {
            noDomAccessibility: true,
            secretFlag: 'SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK',
          },
          secret: 'SECRET_NEXT_SHOULD_NOT_LEAK',
        },
        computerUseLong: {
          taskId: 'CU-NEXT-01',
          cuNextTaskId: 'CU-NEXT-01',
          scenarioId: 'CU-LONG-001',
          title: 'Briefing deck',
          requiredEvidence: ['cu-user-acceptance-manifest.json'],
          safetyBoundary: {
            noDomAccessibility: true,
            secretFlag: 'SECRET_LONG_SHOULD_NOT_LEAK',
          },
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.deepEqual(request.uiState?.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.deepEqual(request.uiState?.computerUseNext, {
    taskId: 'CU-NEXT-01',
    scenarioId: 'CU-LONG-001',
    title: 'Briefing deck',
    requirements: ['refs-first-evidence-bundle'],
    safetyBoundary: {
      noDomAccessibility: true,
    },
  });
  assert.deepEqual(request.uiState?.computerUseLong, {
    taskId: 'CU-NEXT-01',
    scenarioId: 'CU-LONG-001',
    title: 'Briefing deck',
    safetyBoundary: {
      noDomAccessibility: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(request), /SECRET_POLICY_SHOULD_NOT_LEAK|SECRET_PRODUCER_SHOULD_NOT_LEAK|unknown-producer|SECRET_NEXT_SHOULD_NOT_LEAK|SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK|SECRET_LONG_SHOULD_NOT_LEAK|cuNextTaskId|requiredEvidence/);
});

test('Computer Use native route accepts ordinary chat text when host-owned runtime intent is explicit', () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: 'Use the visible desktop from ordinary SciForge Desktop chat to complete the Computer Use acceptance task.',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-ordinary-product-chat',
      attemptId: 'attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        computerUseNext: {
          taskId: 'CU-NEXT-01',
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  assert.equal(stream?.turnId, 'native-route-ordinary-product-chat');
  const request = computerUseGatewayRequest({
    request: {
      commandText: 'Use the visible desktop from ordinary SciForge Desktop chat to complete the Computer Use acceptance task.',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-ordinary-product-chat',
      attemptId: 'attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        computerUseNext: {
          taskId: 'CU-NEXT-01',
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });
  assert.equal(request.prompt, 'Use the visible desktop from ordinary SciForge Desktop chat to complete the Computer Use acceptance task.');
  assert.deepEqual(request.uiState?.computerUseNext, { taskId: 'CU-NEXT-01' });
});

test('Computer Use native route keeps only safe task and scenario bindings', () => {
  const request = computerUseGatewayRequest({
    request: {
      commandText: '/computer-use run the current task',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-sanitized-bindings',
      attemptId: 'attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        computerUseNext: {
          taskId: 'CU-NEXT-02',
          scenarioId: 'CU-SCENARIO-02',
          title: 'Runtime owned task',
          requirements: ['use-runtime-owned-refs'],
          safetyBoundary: {
            noRawScreenshotsInChat: true,
            noProviderPayloadsInPrompt: true,
            rawScreenshotPath: '/tmp/SECRET_SCREENSHOT.png',
          },
          rawScenario: {
            url: 'https://example.invalid/SECRET_URL',
            providerPayload: 'SECRET_PROVIDER_PAYLOAD',
            screenshotBase64: 'data:image/png;base64,SECRET_IMAGE',
          },
          secret: 'SECRET_NEXT_BINDING',
        },
        computerUseLong: {
          taskId: 'CU-LONG-02',
          cuNextTaskId: 'CU-NEXT-02',
          scenarioId: 'CU-SCENARIO-02',
          title: 'Runtime owned long task',
          requirements: ['write-current-run-acceptance'],
          requiredEvidence: ['cu-user-acceptance-manifest.json'],
          safetyBoundary: {
            noRawScreenshotsInChat: true,
            noProviderPayloadsInPrompt: true,
            apiKey: 'SECRET_API_KEY',
          },
          rawScenario: {
            url: 'https://example.invalid/SECRET_LONG_URL',
            providerPayload: 'SECRET_LONG_PROVIDER_PAYLOAD',
          },
          secret: 'SECRET_LONG_BINDING',
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.deepEqual(request.uiState?.computerUseNext, {
    taskId: 'CU-NEXT-02',
    scenarioId: 'CU-SCENARIO-02',
    title: 'Runtime owned task',
    requirements: ['use-runtime-owned-refs'],
    safetyBoundary: {
      noRawScreenshotsInChat: true,
      noProviderPayloadsInPrompt: true,
    },
  });
  assert.deepEqual(request.uiState?.computerUseLong, {
    taskId: 'CU-LONG-02',
    scenarioId: 'CU-SCENARIO-02',
    title: 'Runtime owned long task',
    requirements: ['write-current-run-acceptance'],
    safetyBoundary: {
      noRawScreenshotsInChat: true,
      noProviderPayloadsInPrompt: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(request), /SECRET|rawScenario|providerPayload|screenshotBase64|example\.invalid|data:image|base64|apiKey/);
});

test('Computer Use native route drops raw request uiState and approval sidecars', () => {
  const request = computerUseGatewayRequest({
    request: {
      commandText: '/computer-use approve --approval-ref approval:runtime-safe',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-raw-ui-state',
      attemptId: 'attempt-1',
      uiState: {
        schemaVersion: 'attacker-controlled-schema',
        approvalRef: 'approval:ui-safe',
        computerUseApprovalRef: 'approval:ui-computer-use-safe',
        terminalEquivalentText: false,
        approvalProvenance: {
          source: 'runtime-gui',
          refs: ['approval:sidecar-safe-ref'],
          guiAskUserSidecar: {
            rawUrl: 'https://example.invalid/SECRET_UI_URL',
            screenshotBase64: 'data:image/png;base64,SECRET_UI_IMAGE',
          },
        },
        computerUseNext: {
          rawScenario: {
            url: 'https://example.invalid/SECRET_NEXT_UI_URL',
            providerPayload: 'SECRET_NEXT_UI_PROVIDER_PAYLOAD',
          },
        },
        arbitrarySecret: 'SECRET_RAW_UI_STATE',
      },
      humanApproval: {
        approvalRef: 'approval:human-safe',
        approvalProvenance: {
          source: 'human',
          approvalRequestSidecar: {
            apiKey: 'SECRET_APPROVAL_API_KEY',
          },
        },
        secret: 'SECRET_RAW_HUMAN_APPROVAL',
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.deepEqual(request.uiState, {
    schemaVersion: 'sciforge.runtime-codex.computer-use-native-route.v1',
    selectedToolIds: ['local.vision-sense'],
    selectedSenseIds: ['local.vision-sense'],
    selectedActionIds: ['action.sciforge.computer-use'],
    allowOpenAiRuntime: false,
    entrypoint: 'runtime-codex-commandText',
    terminalEquivalentText: true,
    computerUseApprovalRef: 'approval:runtime-safe',
  });
  assert.deepEqual(request.humanApproval, {
    approvalRef: 'approval:runtime-safe',
    decision: 'approved',
    source: 'runtime-codex-commandText',
  });
  assert.doesNotMatch(JSON.stringify(request), /SECRET|rawScenario|providerPayload|Sidecar|sidecar|rawUrl|screenshotBase64|data:image|base64|apiKey|arbitrarySecret|attacker-controlled-schema/);
});

test('Computer Use native route drops unsafe approval ref candidates', () => {
  const request = computerUseGatewayRequest({
    request: {
      commandText: '/computer-use approve guarded action',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-unsafe-approval-ref',
      attemptId: 'attempt-1',
      humanApproval: {
        approvalRef: 'SECRET_HUMAN_APPROVAL_REF',
      },
      uiState: {
        approvalRef: 'https://example.invalid/SECRET_UI_APPROVAL_REF',
        computerUseApprovalRef: 'data:text/plain;base64,U0VDUkVUX1VJX0FQUFJPVkFMX1JFRg==',
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.equal(request.uiState?.computerUseApprovalRef, undefined);
  assert.equal(request.humanApproval, undefined);
  assert.doesNotMatch(JSON.stringify(request), /SECRET|example\.invalid|data:text|base64/);
});
