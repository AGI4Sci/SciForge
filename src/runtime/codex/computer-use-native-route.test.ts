import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computerUseGatewayRequest,
  createComputerUseNativeRouteStream,
  isComputerUseNativeRouteCommand,
} from './computer-use-native-route.js';

test('Computer Use slash route is diagnostic-only unless Host supplies explicit runtime intent', () => {
  assert.equal(isComputerUseNativeRouteCommand('/computer-use write a visible report'), false);
  assert.equal(isComputerUseNativeRouteCommand('/computer use click Submit'), false);
  assert.equal(isComputerUseNativeRouteCommand('/computer-use diagnostic --dry-run'), true);
  assert.equal(isComputerUseNativeRouteCommand('Plan a GUI action: /computer-use click Submit'), false);

  const plainSlashStream = createComputerUseNativeRouteStream({
    request: {
      commandText: '/computer-use write a visible report',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-plain-slash',
      attemptId: 'attempt-1',
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });
  assert.equal(plainSlashStream, undefined);
});

test('Computer Use native route ignores retired completion evidence policy and projects task bindings', () => {
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
      } as any,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.equal('completionEvidencePolicy' in (request.uiState ?? {}), false);
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
  assert.deepEqual(request.expectedEvidenceKinds, [
    'computer-use-tui-host-actions',
    'vision-trace',
    'computer-use-primitive-session',
    'primitive-trace',
  ]);
});

test('Computer Use native route can select opt-in TextEdit WindowActionSession bridge', async () => {
  const previous = snapshotEnv([
    'SCIFORGE_WINDOW_ACTION_APPIUM_MAC2',
    'SCIFORGE_APPIUM_MAC2_EXECUTOR',
    'SCIFORGE_APPIUM_MAC2_SERVER_URL',
    'SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH',
  ]);
  const workspace = '/tmp/sciforge-native-route-textedit';
  const artifactPath = `${workspace}/proof.txt`;
  process.env.SCIFORGE_WINDOW_ACTION_APPIUM_MAC2 = '1';
  process.env.SCIFORGE_APPIUM_MAC2_EXECUTOR = '1';
  process.env.SCIFORGE_APPIUM_MAC2_SERVER_URL = 'http://127.0.0.1:4723';
  process.env.SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH = artifactPath;
  const appiumCalls: Array<{ action: string; targetArtifactPath?: string }> = [];
  try {
    const stream = createComputerUseNativeRouteStream({
      request: {
        commandText: `Use the visible TextEdit document window and save the local document to ${artifactPath}.`,
        workspacePath: workspace,
        commandId: 'native-route-textedit-save',
        attemptId: 'native-route-textedit-save-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ordinary-chat',
          intentText: `Use the visible TextEdit document window and save the local document to ${artifactPath}.`,
          singleTurnOverride: false,
          refs: [],
          readiness: {},
          target: {},
          observation: {},
          permissions: {},
        },
        runtimeIntent: {
          schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
          kind: 'computer-use-native-route',
          source: 'host-owned',
          computerUseNext: {
            taskId: 'CU-NEXT-08',
            recommendedTargetMode: 'app-window',
            recommendedTargetApp: 'TextEdit',
            semanticMarkers: ['desktop-file-save'],
          },
        },
      },
      workspace,
      provider: 'sciforge-provider',
      model: 'sciforge-model',
      profile: 'host-owned',
      textEditAppiumMac2Client: async (request) => {
        appiumCalls.push({ action: request.action, targetArtifactPath: request.targetArtifactPath });
        return {
          executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/executor-event`,
          inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/save-input`,
          verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
          artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator/content-match`,
          freshnessInvalidationRef: `window-action-session:textedit-local-save/actions/${request.actionId}/freshness-invalidation.json`,
          afterEvidenceRef: `window-action-session:textedit-local-save/evidence/${request.actionId}/after-ax.json`,
        };
      },
    });
    assert.notEqual(stream, undefined);
    const events = await collectStreamEvents(stream!);
    const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
    assert.equal(appiumCalls.length, 1);
    assert.equal(appiumCalls[0]?.action, 'save');
    assert.equal(appiumCalls[0]?.targetArtifactPath, artifactPath);
    assert.match(String(done?.message), /Computer Use Act materializer is completed|product workflow completion is blocked/i);
    assert.ok((done?.evidenceRefs as string[]).includes('window-action-session:textedit-local-save'));
    assert.ok((done?.evidenceRefs as string[]).includes('adapter-registry:window-action-session/appium-mac2/computer-use'));
    assert.doesNotMatch(JSON.stringify(events), /workspace-file-writer|shell-writer|shared-system-input|SECRET|token/i);
  } finally {
    restoreEnv(previous);
  }
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

async function collectStreamEvents(stream: NonNullable<ReturnType<typeof createComputerUseNativeRouteStream>>) {
  const events: Record<string, unknown>[] = [];
  for await (const event of stream.events) events.push(event as Record<string, unknown>);
  return events;
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
