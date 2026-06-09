import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computerUseGatewayRequest,
  createComputerUseNativeRouteStream,
  isComputerUseNativeRouteCommand,
} from './computer-use-native-route.js';
import { createVSCodeCoWorkChatBridge } from './vscode-cowork-chat-bridge.js';

const VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF = 'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:1:file-ref:vscode:paper';
const VSCODE_COWORK_UNBOUND_PERMISSION_REF = 'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:other:file-ref:vscode:paper';

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
    const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
    assert.equal(appiumCalls.length, 1);
    assert.equal(appiumCalls[0]?.action, 'save');
    assert.equal(appiumCalls[0]?.targetArtifactPath, artifactPath);
    assert.match(String(done?.message), /Agent Host final answer is required/i);
    assert.ok((done?.evidenceRefs as string[]).includes('window-action-session:textedit-local-save'));
    assert.ok((done?.evidenceRefs as string[]).includes('adapter-registry:window-action-session/appium-mac2/computer-use'));
    assert.doesNotMatch(JSON.stringify(events), /workspace-file-writer|shell-writer|shared-system-input|SECRET|token/i);
  } finally {
    restoreEnv(previous);
  }
});

test('Computer Use native route selects VSCode co-work bridge and fails closed on ambiguous current windows', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork',
      attemptId: 'native-route-vscode-cowork-attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        computerUseNext: {
          taskId: 'CU-NEXT-09',
          recommendedTargetMode: 'active-window',
          recommendedTargetApp: 'Visual Studio Code',
          semanticMarkers: ['current-vscode-cowork', 'refs-first'],
        },
        vscodeCoWork: {
          requestRef: 'chat-request:vscode-cowork:ordinary',
          operation: 'focus-editor',
          windowCandidates: [
            vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
            vscodeNativeRouteWindow({ windowRef: 'window:vscode:notes', titleRef: 'text:title:notes' }),
          ],
          rawScreenshotBase64: 'data:image/png;base64,SECRET_SCREENSHOT_SHOULD_NOT_LEAK',
          providerPayload: 'SECRET_PROVIDER_PAYLOAD_SHOULD_NOT_LEAK',
        },
      } as any,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const selected = events.find((event) => String(event.message).includes('VSCode co-work'));
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const executionUnits = done?.executionUnits as Record<string, unknown>[] | undefined;
  const unit = executionUnits?.[0];

  assert.ok(selected);
  assert.equal(done?.status, 'needs-confirmation');
  assert.equal(unit?.status, 'needs-confirmation');
  assert.equal(unit?.maturity, 'live-diagnostic');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.blockedReason, 'vscode_cowork_target_window_needs_confirmation');
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:ordinary'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:notes'));
  assert.doesNotMatch(JSON.stringify(events), /SECRET|rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('VSCode co-work bridge requires host-owned refs-first runtime intent markers', () => {
  const baseIntent = {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
    computerUseNext: {
      taskId: 'CU-NEXT-09',
      recommendedTargetMode: 'active-window',
      recommendedTargetApp: 'Visual Studio Code',
      semanticMarkers: ['current-vscode-cowork', 'refs-first'],
    },
    vscodeCoWork: {
      requestRef: 'chat-request:vscode-cowork:bridge-marker-gate',
      operation: 'read-visible-text',
      selectedWindowRef: 'window:vscode:paper',
      windowCandidates: [
        vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
      ],
      latestObservation: vscodeNativeRouteObservation(),
    },
  };

  assert.equal(createVSCodeCoWorkChatBridge({
    runtimeIntent: {
      ...baseIntent,
      source: 'runtime-owned',
    },
    commandId: 'native-route-vscode-cowork-non-host-owned',
    attemptId: 'native-route-vscode-cowork-non-host-owned-attempt-1',
  }), undefined);

  assert.equal(createVSCodeCoWorkChatBridge({
    runtimeIntent: {
      ...baseIntent,
      computerUseNext: {
        ...baseIntent.computerUseNext,
        semanticMarkers: ['current-vscode-cowork'],
      },
    },
    commandId: 'native-route-vscode-cowork-missing-refs-first-marker',
    attemptId: 'native-route-vscode-cowork-missing-refs-first-marker-attempt-1',
  }), undefined);

  const accepted = createVSCodeCoWorkChatBridge({
    runtimeIntent: baseIntent,
    commandId: 'native-route-vscode-cowork-host-owned',
    attemptId: 'native-route-vscode-cowork-host-owned-attempt-1',
  });

  assert.equal(accepted?.decision.status, 'ready');
  assert.equal(accepted?.decision.primitive, 'observe');
  assert.ok(accepted?.payload.evidenceRefs.includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(accepted), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route derives P9b VSCode co-work intent from refs-first ordinary chat Host input', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-ordinary-chat-host-input',
      attemptId: 'native-route-vscode-cowork-ordinary-chat-host-input-attempt-1',
      agentHostInput: vscodeCoWorkAgentHostInput({
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:notes', titleRef: 'text:title:notes' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      }),
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const selected = events.find((event) => String(event.message).includes('VSCode co-work'));
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.ok(selected);
  assert.equal(done?.status, 'partial');
  assert.equal(unit?.status, 'ready');
  assert.equal(unit?.primitive, 'observe');
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.targetWindowRef, 'window:vscode:paper');
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:ordinary-host-input'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.ok((done?.evidenceRefs as string[]).includes('text:vscode:visible'));
  assert.doesNotMatch(JSON.stringify(events), /rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route can run current VSCode co-work live diagnostic from ordinary chat Host input', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-ordinary-live',
      attemptId: 'native-route-vscode-cowork-ordinary-live-attempt-1',
      agentHostInput: vscodeCoWorkAgentHostInput({
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      }),
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: true,
    },
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'Current VSCode co-work live diagnostic completed from ordinary chat Host input.',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
        evidenceRefs: [
          'chat-request:vscode-cowork:ordinary-host-input',
          'window:vscode:paper',
          'observation:vscode:current-live',
          'text:vscode:visible-live',
          'https://example.invalid/SECRET_LIVE_EVIDENCE',
          'raw-live-providerPayload:SECRET_SHOULD_NOT_LEAK',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:ordinary-live',
          'scoped-input-adapter:current-vscode-cowork:ordinary-live',
          'cursor-marker:current-vscode-cowork:ordinary-live',
          'front-app-restore:current-vscode-cowork:ordinary-live',
          'mouse-position-restore:current-vscode-cowork:ordinary-live',
          'raw-cleanup-ref:SECRET_SHOULD_NOT_LEAK',
        ],
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'vscode-cowork-live-diagnostic',
          intentText: 'SECRET_PROVIDER_PAYLOAD raw intent text should not leave the live runner.',
          authorizationProfileId: 'high-autonomy',
          singleTurnOverride: false,
          refs: [
            'intent:current-vscode-cowork',
            'chat-request:vscode-cowork:ordinary-host-input-live',
            'window:vscode:paper',
            'observation:vscode:current-live',
            'text:vscode:visible-live',
            'https://example.invalid/SECRET_AGENT_HOST_REF',
            'raw-agent-host-ref:SECRET_SHOULD_NOT_LEAK',
          ],
          readiness: {},
          target: {
            kind: 'current-vscode-cowork',
            refs: ['window:vscode:paper', 'file-ref:vscode:paper', '/Users/example/private-paper.md'],
            vscodeCoWork: {
              operation: 'read-visible-text',
              rawOperation: 'read SECRET_PROVIDER_PAYLOAD',
            },
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:current-live', 'text:vscode:visible-live', 'data:image/png;base64,SECRET_IMAGE'],
          },
          permissions: {
            refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF, 'api-key:SECRET_SHOULD_NOT_LEAK'],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
        },
        runtimeTruth: {
          schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
          source: 'vscode-cowork-live-diagnostic',
          target: {
            bound: true,
            summary: 'SECRET raw window summary should not leave the live runner.',
            refs: ['window:vscode:paper', 'file-ref:vscode:paper', '/Users/example/private-paper.md'],
          },
          observation: {
            fresh: true,
            refs: ['observation:vscode:current-live', 'text:vscode:visible-live', 'raw-observation:SECRET_SHOULD_NOT_LEAK'],
          },
          permissions: {
            refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
            permissionRefs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
            scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
            stopCancelPath: true,
          },
          sessions: {
            sessionReadyRefs: [
              'computer-use-session:vscode:ordinary-live',
              'window-action-session:vscode-cowork:1',
              'scoped-input-lease:current-vscode-cowork:ordinary-live',
            ],
            targetRefs: ['window:vscode:paper'],
            inputLeaseRefs: ['scoped-input-lease:current-vscode-cowork:ordinary-live'],
            observationRefs: ['observation:vscode:current-live'],
          },
          adapter: {
            providerId: 'sciforge.vscode-cowork.live-diagnostic',
            refs: ['scoped-input-adapter:current-vscode-cowork:ordinary-live'],
            capabilityRefs: ['runtime-truth:computer-use-capability/current-vscode-cowork'],
            inputIsolation: {
              mode: 'shared-system-input-live-diagnostic',
              refsOnly: true,
              sharedSystemInput: true,
              requiresFocusLease: true,
              refs: [
                'scoped-input-lease:current-vscode-cowork:ordinary-live',
                'cursor-marker:current-vscode-cowork:ordinary-live',
              ],
            },
          },
          refs: [
            'intent:current-vscode-cowork',
            'window:vscode:paper',
            'observation:vscode:current-live',
            'computer-use-session:vscode:ordinary-live',
            'raw-runtime-truth:SECRET_SHOULD_NOT_LEAK',
          ],
        },
        agentHostFinalAnswer: {
          schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
          source: 'codex-agent-host-vscode-cowork-live-diagnostic',
          status: 'completed',
          text: 'SECRET_PROVIDER_PAYLOAD raw-visible-text should not leave the live runner.',
          maturity: 'live-diagnostic',
          productReady: false,
          hostOwnsFinalAnswer: true,
          computerUseCorePlanning: false,
          primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
          evidenceRefs: ['window:vscode:paper', 'observation:vscode:current-live', 'data:image/png;base64,SECRET_IMAGE'],
          cleanupRefs: ['scoped-input-lease:current-vscode-cowork:ordinary-live', 'raw-cleanup-ref:SECRET_SHOULD_NOT_LEAK'],
        },
      };
    },
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const selected = events.find((event) => String(event.message).includes('VSCode co-work'));
  const liveSelected = events.find((event) => String(event.message).includes('current VSCode co-work live diagnostic'));
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];
  const hostProducerEvidence = done?.hostProducerEvidence as Record<string, unknown> | undefined;

  assert.ok(selected);
  assert.ok(liveSelected);
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0]?.commandText, '读取我当前打开的 VSCode 可见文本。');
  assert.equal(runnerCalls[0]?.commandId, 'native-route-vscode-cowork-ordinary-live');
  assert.equal(runnerCalls[0]?.attemptId, 'native-route-vscode-cowork-ordinary-live-attempt-1');
  assert.equal(runnerCalls[0]?.workspacePath, '/tmp/workspace');
  assert.equal(runnerCalls[0]?.activateCurrentVSCodeIfNeeded, true);
  assert.equal(done?.status, 'completed');
  assert.equal(done?.maturity, 'live-diagnostic');
  assert.equal(done?.productReady, false);
  assert.deepEqual(done?.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.hostOwnsFinalAnswer, true);
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.computerUseCorePlanning, false);
  assert.match(String((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.text), /omitted because it was not refs-first safe/);
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current-live'));
  assert.ok((done?.cleanupRefs as string[]).includes('scoped-input-lease:current-vscode-cowork:ordinary-live'));
  assert.equal(hostProducerEvidence?.schemaVersion, 'sciforge.codex-agent-host.current-vscode-cowork-live-producer-evidence.v1');
  assert.equal(hostProducerEvidence?.targetKind, 'current-vscode-cowork');
  assert.equal(hostProducerEvidence?.operation, 'read-visible-text');
  assert.ok((hostProducerEvidence?.agentHostInputRefs as string[]).includes('intent:current-vscode-cowork'));
  assert.ok((hostProducerEvidence?.agentHostInputRefs as string[]).includes('chat-request:vscode-cowork:ordinary-host-input-live'));
  assert.ok((hostProducerEvidence?.targetRefs as string[]).includes('window:vscode:paper'));
  assert.ok((hostProducerEvidence?.observationRefs as string[]).includes('observation:vscode:current-live'));
  assert.ok((hostProducerEvidence?.permissionRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF));
  assert.ok((hostProducerEvidence?.runtimeTruthRefs as string[]).includes('computer-use-session:vscode:ordinary-live'));
  assert.ok((hostProducerEvidence?.inputLeaseRefs as string[]).includes('scoped-input-lease:current-vscode-cowork:ordinary-live'));
  assert.ok((hostProducerEvidence?.adapterRefs as string[]).includes('scoped-input-adapter:current-vscode-cowork:ordinary-live'));
  assert.ok((hostProducerEvidence?.evidenceRefs as string[]).includes('text:vscode:visible-live'));
  assert.equal(unit?.tool, 'current-vscode-cowork-live-diagnostic');
  assert.equal(unit?.status, 'done');
  assert.doesNotMatch(JSON.stringify(events), /SECRET|example\.invalid|raw-live|raw-cleanup|rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route can run P10 current VSCode command palette live diagnostic without pre-bound window candidates', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const agentHostInput = {
    schemaVersion: 'sciforge.codex-agent-host-input.v1' as const,
    source: 'ordinary-chat-current-vscode-computer-use-bridge',
    intentText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
    singleTurnOverride: false,
    refs: [
      'intent:current-vscode-cowork',
      'intent:current-vscode-cowork-live-diagnostic',
      'chat-request:vscode-cowork:p10-command-palette:attempt-1',
    ],
    readiness: {},
    target: {
      kind: 'current-vscode-cowork' as const,
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:p10-command-palette:attempt-1',
        operation: 'open-command-palette' as const,
        diagnostic: 'p10-vscode-bind-observe-command-palette-open-close',
        targetMode: 'smart-detect-current-vscode-window',
      },
    },
    observation: {},
    permissions: {
      refs: ['permission:turn/current-vscode-cowork/full-access'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-p10-palette-live',
      attemptId: 'native-route-vscode-cowork-p10-palette-live-attempt-1',
      agentHostInput,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: true,
    },
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'current VSCode command palette live diagnostic completed open, query, observe items, close, observe, and release',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: [
          'bind',
          'observe',
          'host-decision',
          'act',
          'observe',
          'host-decision',
          'act',
          'observe',
          'host-decision',
          'act',
          'observe',
          'control(release)',
        ],
        evidenceRefs: [
          'chat-request:vscode-cowork:p10-command-palette:attempt-1',
          'window:vscode:p10',
          'observation:vscode:p10-before',
          'command-palette:vscode:p10:current',
          'command-palette-input:vscode:p10:current',
          'observation:vscode:p10-after-close',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:p10-palette',
          'scoped-input-adapter:current-vscode-cowork:p10-palette',
          'cursor-marker:current-vscode-cowork:p10-palette',
          'front-app-restore:current-vscode-cowork:p10-palette',
          'mouse-position-restore:current-vscode-cowork:p10-palette',
        ],
        agentHostInput,
        agentHostFinalAnswer: {
          schemaVersion: 'sciforge.codex-agent-host.current-vscode-cowork-final-answer.v1',
          source: 'codex-agent-host-vscode-cowork-live-diagnostic',
          status: 'completed',
          text: 'current VSCode command palette live diagnostic completed open, query, observe items, close, observe, and release',
          maturity: 'live-diagnostic',
          productReady: false,
          hostOwnsFinalAnswer: true,
          computerUseCorePlanning: false,
          primitiveChainObserved: [
            'bind',
            'observe',
            'host-decision',
            'act',
            'observe',
            'host-decision',
            'act',
            'observe',
            'host-decision',
            'act',
            'observe',
            'control(release)',
          ],
          evidenceRefs: [
            'chat-request:vscode-cowork:p10-command-palette:attempt-1',
            'window:vscode:p10',
            'observation:vscode:p10-after-close',
          ],
          cleanupRefs: [
            'scoped-input-lease:current-vscode-cowork:p10-palette',
            'front-app-restore:current-vscode-cowork:p10-palette',
            'mouse-position-restore:current-vscode-cowork:p10-palette',
          ],
        },
      };
    },
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const liveSelected = events.find((event) => String(event.message).includes('current VSCode co-work live diagnostic'));
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const hostProducerEvidence = done?.hostProducerEvidence as Record<string, unknown> | undefined;

  assert.ok(liveSelected);
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0]?.activateCurrentVSCodeIfNeeded, true);
  assert.equal(((runnerCalls[0]?.agentHostInput as Record<string, unknown>).target as Record<string, unknown>)?.kind, 'current-vscode-cowork');
  assert.equal(done?.status, 'completed');
  assert.equal(done?.maturity, 'live-diagnostic');
  assert.equal(done?.productReady, false);
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.hostOwnsFinalAnswer, true);
  assert.equal(hostProducerEvidence?.operation, 'open-command-palette');
  assert.ok((done?.evidenceRefs as string[]).includes('command-palette:vscode:p10:current'));
  assert.ok((done?.cleanupRefs as string[]).includes('front-app-restore:current-vscode-cowork:p10-palette'));
  assert.doesNotMatch(JSON.stringify(events), /rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route blocks P10 direct live diagnostic when Host target has ambiguous VSCode windows', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const agentHostInput = {
    schemaVersion: 'sciforge.codex-agent-host-input.v1' as const,
    source: 'ordinary-chat-current-vscode-computer-use-bridge',
    intentText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
    singleTurnOverride: false,
    refs: [
      'intent:current-vscode-cowork',
      'intent:current-vscode-cowork-live-diagnostic',
      'chat-request:vscode-cowork:p10-command-palette-ambiguous:attempt-1',
    ],
    readiness: {},
    target: {
      kind: 'current-vscode-cowork' as const,
      refs: [
        'macos-app:com.microsoft.VSCode',
        'process:vscode:paper',
        'window:vscode:paper',
        'window:vscode:notes',
        'text:title:paper',
        'text:title:notes',
        'frontmost:vscode:paper',
        'frontmost:vscode:notes',
      ],
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:p10-command-palette-ambiguous:attempt-1',
        operation: 'open-command-palette' as const,
        diagnostic: 'p10-vscode-bind-observe-command-palette-open-close',
        targetMode: 'smart-detect-current-vscode-window',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:notes', titleRef: 'text:title:notes' }),
        ],
      },
    },
    observation: {},
    permissions: {
      refs: ['permission:turn/current-vscode-cowork/full-access'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-p10-palette-ambiguous',
      attemptId: 'native-route-vscode-cowork-p10-palette-ambiguous-attempt-1',
      agentHostInput,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: true,
    },
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'ambiguous target must not reach live runner',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind'],
        evidenceRefs: ['window:vscode:paper'],
        cleanupRefs: [],
      };
    },
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.equal(runnerCalls.length, 0);
  assert.equal(done?.status, 'needs-confirmation');
  assert.equal(unit?.status, 'needs-confirmation');
  assert.equal(unit?.tool, 'current-vscode-cowork-live-diagnostic');
  assert.deepEqual(unit?.primitiveChainObserved, []);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:p10-command-palette-ambiguous:attempt-1'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:notes'));
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.status, 'needs-confirmation');
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.hostOwnsFinalAnswer, true);
  assert.doesNotMatch(JSON.stringify(events), /ambiguous target must not reach live runner|rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route blocks P10 direct live diagnostic when selected VSCode window conflicts with latest observation', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const agentHostInput = {
    schemaVersion: 'sciforge.codex-agent-host-input.v1' as const,
    source: 'ordinary-chat-current-vscode-computer-use-bridge',
    intentText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
    singleTurnOverride: false,
    refs: [
      'intent:current-vscode-cowork',
      'intent:current-vscode-cowork-live-diagnostic',
      'chat-request:vscode-cowork:p10-command-palette-conflict:attempt-1',
    ],
    readiness: {},
    target: {
      kind: 'current-vscode-cowork' as const,
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:p10-command-palette-conflict:attempt-1',
        operation: 'open-command-palette' as const,
        diagnostic: 'p10-vscode-bind-observe-command-palette-open-close',
        targetMode: 'smart-detect-current-vscode-window',
        selectedWindowRef: 'window:vscode:paper',
        latestObservation: {
          windowRef: 'window:vscode:notes',
          observationRef: 'observation:vscode:notes',
        },
      },
    },
    observation: {},
    permissions: {
      refs: ['permission:turn/current-vscode-cowork/full-access'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '请用 Computer Use 操纵当前 VSCode，打开并关闭命令面板。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-p10-palette-conflict',
      attemptId: 'native-route-vscode-cowork-p10-palette-conflict-attempt-1',
      agentHostInput,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'conflicting target must not reach live runner',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind'],
        evidenceRefs: ['window:vscode:paper'],
        cleanupRefs: [],
      };
    },
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.equal(runnerCalls.length, 0);
  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal((done?.agentHostFinalAnswer as Record<string, unknown> | undefined)?.status, 'blocked');
  assert.ok((done?.evidenceRefs as string[]).includes('blocked:vscode-app-module:target-window-evidence-conflict'));
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:p10-command-palette-conflict:attempt-1'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:notes'));
  assert.doesNotMatch(JSON.stringify(events), /conflicting target must not reach live runner|rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route does not project local live diagnostic completion as final done', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-local-completed-no-final',
      attemptId: 'native-route-vscode-cowork-local-completed-no-final-attempt-1',
      agentHostInput: vscodeCoWorkAgentHostInput({
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      }),
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticRunner: async () => ({
      status: 'completed',
      message: 'LOCAL COMPLETED ACK MUST NOT BECOME FINAL ANSWER',
      maturity: 'live-diagnostic',
      productReady: false,
      primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
      evidenceRefs: [
        'chat-request:vscode-cowork:local-completed-no-final',
        'window:vscode:paper',
        'observation:vscode:current-live',
      ],
      cleanupRefs: [
        'scoped-input-lease:current-vscode-cowork:local-completed-no-final',
        'scoped-input-adapter:current-vscode-cowork:local-completed-no-final',
        'cursor-marker:current-vscode-cowork:local-completed-no-final',
        'front-app-restore:current-vscode-cowork:local-completed-no-final',
        'mouse-position-restore:current-vscode-cowork:local-completed-no-final',
      ],
    }),
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const terminal = events.find((event) => event.type === 'partial' || event.type === 'blocked') as Record<string, unknown> | undefined;

  assert.equal(events.some((event) => event.type === 'done'), false);
  assert.ok(terminal);
  assert.notEqual(terminal?.status, 'completed');
  assert.equal(terminal?.agentHostFinalAnswer, undefined);
  assert.equal(terminal?.completionTruth, undefined);
  assert.ok((terminal?.evidenceRefs as string[]).includes('observation:vscode:current-live'));
  assert.doesNotMatch(JSON.stringify(events), /LOCAL COMPLETED ACK MUST NOT BECOME FINAL ANSWER|taskOutcome":"satisfied/i);
});

test('Computer Use native route does not start current VSCode live diagnostic from bare ordinary chat text', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '操作我已经打开的 VSCode，读取当前可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-narrow-ordinary-live',
      attemptId: 'native-route-vscode-cowork-narrow-ordinary-live-attempt-1',
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: true,
    },
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'Current VSCode co-work live diagnostic completed from narrow ordinary chat.',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
        evidenceRefs: [
          'window:vscode:paper',
          'observation:vscode:ordinary-live',
          'text:vscode:ordinary-visible',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:narrow-ordinary-live',
          'scoped-input-adapter:current-vscode-cowork:narrow-ordinary-live',
          'cursor-marker:current-vscode-cowork:narrow-ordinary-live',
          'front-app-restore:current-vscode-cowork:narrow-ordinary-live',
          'mouse-position-restore:current-vscode-cowork:narrow-ordinary-live',
        ],
      };
    },
  });

  assert.equal(stream, undefined);
  assert.equal(runnerCalls.length, 0);
});

test('Computer Use native route does not infer VSCode co-work operation from generic Host text', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-generic-host-refs',
      attemptId: 'native-route-vscode-cowork-generic-host-refs-attempt-1',
      agentHostInput: {
        schemaVersion: 'sciforge.codex-agent-host-input.v1',
        source: 'ordinary-chat',
        intentText: '读取我当前打开的 VSCode 可见文本。',
        singleTurnOverride: false,
        refs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:generic-host-refs'],
        readiness: {
          nativeBridge: 'ready',
          nativeSurface: 'ready',
          windowActionSession: 'ready',
          computerUseAdapter: 'ready',
        },
        target: {
          kind: 'current-vscode-cowork',
          refs: [
            'macos-app:com.microsoft.VSCode',
            'process:vscode:paper',
            'window:vscode:paper',
            'text:title:paper',
            'frontmost:vscode:paper',
            'file-ref:vscode:paper',
            '/Users/example/private-paper.md',
            'Paper Draft - raw window title',
          ],
        },
        observation: {
          fresh: true,
          vscodeCoWork: vscodeNativeRouteObservation(),
        },
        permissions: {
          refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
          scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
          stopCancelPath: true,
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_operation_required');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.targetWindowRef, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:generic-host-refs'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(events), /private-paper|Paper Draft - raw|\/Users\/example|rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route structures generic observation refs before current VSCode live diagnostic', async () => {
  const runnerCalls: Array<Record<string, unknown>> = [];
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-generic-observation-live',
      attemptId: 'native-route-vscode-cowork-generic-observation-live-attempt-1',
      agentHostInput: {
        schemaVersion: 'sciforge.codex-agent-host-input.v1',
        source: 'ordinary-chat',
        intentText: '读取我当前打开的 VSCode 可见文本。',
        singleTurnOverride: false,
        refs: [
          'intent:current-vscode-cowork',
          'chat-request:vscode-cowork:generic-observation-live',
          'window-action-session:vscode-cowork:1',
        ],
        readiness: {
          nativeBridge: 'ready',
          nativeSurface: 'ready',
          windowActionSession: 'ready',
          computerUseAdapter: 'ready',
        },
        target: {
          kind: 'current-vscode-cowork',
          refs: [
            'macos-app:com.microsoft.VSCode',
            'process:vscode:paper',
            'window:vscode:paper',
            'text:title:paper',
            'frontmost:vscode:paper',
            'file-ref:vscode:paper',
          ],
          vscodeCoWork: {
            requestRef: 'chat-request:vscode-cowork:generic-observation-live',
            operation: 'read-visible-text',
          },
        },
        observation: {
          fresh: true,
          refs: [
            'window:vscode:paper',
            'file-ref:vscode:paper',
            'observation:vscode:current',
            'image:vscode:current',
            'accessibility:vscode:current',
            'text:vscode:visible',
            'element:vscode:editor',
            'freshness:vscode:current',
          ],
          vscodeCoWork: {
            windowRef: 'window:vscode:paper',
            selectedFileRef: 'file-ref:vscode:paper',
            refs: [
              'observation:vscode:current',
              'text:vscode:visible',
              'element:vscode:editor',
            ],
          },
        },
        permissions: {
          refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
          scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
          stopCancelPath: true,
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
    currentVSCodeCoWorkLiveDiagnosticRunner: async (input) => {
      runnerCalls.push(input);
      return {
        status: 'completed',
        message: 'Current VSCode co-work live diagnostic completed from structured generic observation refs.',
        maturity: 'live-diagnostic',
        productReady: false,
        primitiveChainObserved: ['bind', 'observe', 'host-decision', 'observe', 'control(release)'],
        evidenceRefs: [
          'chat-request:vscode-cowork:generic-observation-live',
          'window:vscode:paper',
          'observation:vscode:current-live',
          'text:vscode:visible-live',
        ],
        cleanupRefs: [
          'scoped-input-lease:current-vscode-cowork:generic-observation-live',
          'input-adapter:current-vscode-cowork:generic-observation-live',
          'cursor-marker:current-vscode-cowork:generic-observation-live',
          'front-app-restore:current-vscode-cowork:generic-observation-live',
          'mouse-position-restore:current-vscode-cowork:generic-observation-live',
        ],
      };
    },
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const runtimeIntent = runnerCalls[0]?.runtimeIntent as Record<string, unknown> | undefined;
  const vscodeCoWork = runtimeIntent?.vscodeCoWork as Record<string, unknown> | undefined;
  const latestObservation = vscodeCoWork?.latestObservation as Record<string, unknown> | undefined;

  assert.equal(runnerCalls.length, 1);
  assert.equal(done?.status, 'partial');
  assert.equal(latestObservation?.windowRef, 'window:vscode:paper');
  assert.equal(latestObservation?.sessionRef, 'window-action-session:vscode-cowork:1');
  assert.equal(latestObservation?.observationRef, 'observation:vscode:current');
  assert.equal(latestObservation?.screenshotRef, 'image:vscode:current');
  assert.equal(latestObservation?.accessibilityRef, 'accessibility:vscode:current');
  assert.deepEqual(latestObservation?.textRefs, ['text:vscode:visible']);
  assert.deepEqual(latestObservation?.elementRefs, ['element:vscode:editor']);
  assert.equal(latestObservation?.freshnessRef, 'freshness:vscode:current');
  assert.deepEqual(latestObservation?.visibleFileRefs, ['file-ref:vscode:paper']);
  assert.doesNotMatch(JSON.stringify(events), /rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route merges Host-selected operation with generic VSCode target refs', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-generic-host-operation',
      attemptId: 'native-route-vscode-cowork-generic-host-operation-attempt-1',
      agentHostInput: {
        schemaVersion: 'sciforge.codex-agent-host-input.v1',
        source: 'ordinary-chat',
        intentText: '读取我当前打开的 VSCode 可见文本。',
        singleTurnOverride: false,
        refs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:generic-host-operation'],
        target: {
          kind: 'current-vscode-cowork',
          refs: [
            'macos-app:com.microsoft.VSCode',
            'process:vscode:paper',
            'window:vscode:paper',
            'text:title:paper',
            'frontmost:vscode:paper',
            'file-ref:vscode:paper',
          ],
          vscodeCoWork: {
            requestRef: 'chat-request:vscode-cowork:generic-host-operation',
            operation: 'focus-editor',
          },
        },
        observation: {
          fresh: true,
          vscodeCoWork: vscodeNativeRouteObservation(),
        },
        permissions: {
          refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
          scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
          stopCancelPath: true,
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.equal(done?.status, 'partial');
  assert.equal(unit?.primitive, 'act');
  assert.equal(unit?.targetWindowRef, 'window:vscode:paper');
  assert.deepEqual(unit?.action, {
    type: 'key',
    key: 'Command+1',
    elementRef: 'element:vscode:editor',
  });
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:generic-host-operation'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(events), /rawScreenshot|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route fails closed on ambiguous generic Host window refs', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '读取我当前打开的 VSCode 可见文本。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-ambiguous-generic-host-refs',
      attemptId: 'native-route-vscode-cowork-ambiguous-generic-host-refs-attempt-1',
      agentHostInput: {
        schemaVersion: 'sciforge.codex-agent-host-input.v1',
        source: 'ordinary-chat',
        intentText: '读取我当前打开的 VSCode 可见文本。',
        singleTurnOverride: false,
        refs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:ambiguous-generic-host-refs'],
        target: {
          kind: 'current-vscode-cowork',
          refs: [
            'macos-app:com.microsoft.VSCode',
            'process:vscode:paper',
            'window:vscode:paper',
            'window:vscode:notes',
            'text:title:paper',
            'frontmost:vscode:paper',
            'file-ref:vscode:paper',
          ],
        },
        observation: {
          fresh: true,
          vscodeCoWork: vscodeNativeRouteObservation(),
        },
        permissions: {
          refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
          scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
          stopCancelPath: true,
        },
      },
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = ((done?.executionUnits as Record<string, unknown>[] | undefined) ?? [])[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.targetWindowRef, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:ambiguous-generic-host-refs'));
  assert.doesNotMatch(JSON.stringify(events), /product-ready|kill-vscode|clear-profile/i);
});

test('Computer Use native route drops raw VSCode window and observation refs before public events', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      commandId: 'native-route-vscode-cowork-raw-window-refs',
      attemptId: 'native-route-vscode-cowork-raw-window-refs-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-window-refs',
        operation: 'focus-editor',
        selectedWindowRef: 'Paper.md - Visual Studio Code',
        windowCandidates: [{
          appRef: 'Visual Studio Code',
          processRef: '/Applications/Visual Studio Code.app',
          windowRef: 'Paper.md - Visual Studio Code',
          titleRef: 'Paper.md - Visual Studio Code',
          frontmostRef: 'frontmost VSCode window',
        }],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          windowRef: 'Paper.md - Visual Studio Code',
          observationRef: 'visible editor with paper.md',
          screenshotRef: '/tmp/paper-window.png',
          accessibilityRef: 'raw AX tree for paper.md',
          textRefs: ['paper.md visible text'],
          elementRefs: ['editor element'],
          freshnessRef: 'fresh observation',
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_no_window_candidates');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.doesNotMatch(JSON.stringify(events), /Paper\.md|Visual Studio Code|Applications|paper-window|raw AX|visible editor|fresh observation|product-ready/i);
});

test('Computer Use native route blocks mixed raw and refs-first VSCode window candidates', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      commandId: 'native-route-vscode-cowork-mixed-window-candidates',
      attemptId: 'native-route-vscode-cowork-mixed-window-candidates-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:mixed-window-candidates',
        operation: 'focus-editor',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          {
            appRef: 'Visual Studio Code',
            processRef: '/Applications/Visual Studio Code.app',
            windowRef: 'Notes.md - Visual Studio Code',
            titleRef: 'Notes.md - Visual Studio Code',
            frontmostRef: 'frontmost VSCode window',
          },
        ],
        latestObservation: vscodeNativeRouteObservation(),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_window_candidate_refs_invalid');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:mixed-window-candidates'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(events), /Notes\.md|Visual Studio Code|Applications|frontmost VSCode|product-ready/i);
});

test('Computer Use native route blocks VSCode window candidates without bind identity refs', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      commandId: 'native-route-vscode-cowork-missing-window-identity-refs',
      attemptId: 'native-route-vscode-cowork-missing-window-identity-refs-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:missing-window-identity-refs',
        operation: 'focus-editor',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [{
          appRef: 'macos-app:com.microsoft.VSCode',
          windowRef: 'window:vscode:paper',
        }],
        latestObservation: vscodeNativeRouteObservation(),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_window_candidate_identity_refs_required');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:missing-window-identity-refs'));
  assert.ok((done?.evidenceRefs as string[]).includes('macos-app:com.microsoft.VSCode'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(events), /product-ready/i);
});

test('Computer Use native route blocks raw selected VSCode target refs instead of ignoring them', async () => {
  const rawSelectedWindowEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      commandId: 'native-route-vscode-cowork-raw-selected-window',
      attemptId: 'native-route-vscode-cowork-raw-selected-window-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-selected-window',
        operation: 'focus-editor',
        selectedWindowRef: 'Paper.md - Visual Studio Code',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawSelectedWindowDone = routeOutcomeEvent(rawSelectedWindowEvents) as Record<string, unknown> | undefined;
  const rawSelectedWindowUnit = (rawSelectedWindowDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawSelectedWindowDone?.status, 'blocked');
  assert.equal(rawSelectedWindowUnit?.status, 'blocked');
  assert.equal(rawSelectedWindowUnit?.blockedReason, 'vscode_cowork_selected_window_ref_invalid');
  assert.equal(rawSelectedWindowUnit?.primitive, undefined);
  assert.equal(rawSelectedWindowUnit?.action, undefined);
  assert.ok((rawSelectedWindowDone?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(rawSelectedWindowEvents), /Paper\.md|Visual Studio Code|product-ready/i);

  const rawSelectedFileEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-raw-selected-file',
      attemptId: 'native-route-vscode-cowork-raw-selected-file-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-selected-file',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: '/Users/example/paper.md',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['file-ref:vscode:paper'],
        }),
        draftTextRef: 'text-ref:vscode:draft',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawSelectedFileDone = routeOutcomeEvent(rawSelectedFileEvents) as Record<string, unknown> | undefined;
  const rawSelectedFileUnit = (rawSelectedFileDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawSelectedFileDone?.status, 'blocked');
  assert.equal(rawSelectedFileUnit?.status, 'blocked');
  assert.equal(rawSelectedFileUnit?.blockedReason, 'vscode_cowork_selected_file_ref_invalid');
  assert.equal(rawSelectedFileUnit?.primitive, undefined);
  assert.equal(rawSelectedFileUnit?.action, undefined);
  assert.ok((rawSelectedFileDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(rawSelectedFileEvents), /\/Users\/example\/paper\.md|paper\.md|product-ready/i);
});

test('Computer Use native route blocks task-shaped VSCode operations before public events', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '把我已经打开的 VSCode 里所有 TODO 都替换掉。',
      commandId: 'native-route-vscode-cowork-unsupported-operation',
      attemptId: 'native-route-vscode-cowork-unsupported-operation-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:unsupported-operation',
        operation: 'replace every TODO across this repo',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_operation_required');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:unsupported-operation'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(events), /replace every TODO|across this repo|planner|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route requires confirmation when VSCode target file is ambiguous', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: {
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      workspacePath: '/tmp/workspace',
      commandId: 'native-route-vscode-cowork-file-confirmation',
      attemptId: 'native-route-vscode-cowork-file-confirmation-attempt-1',
      runtimeIntent: {
        schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
        kind: 'computer-use-native-route',
        source: 'host-owned',
        computerUseNext: {
          taskId: 'CU-NEXT-09',
          recommendedTargetMode: 'active-window',
          recommendedTargetApp: 'Visual Studio Code',
          semanticMarkers: ['current-vscode-cowork', 'refs-first'],
        },
        vscodeCoWork: {
          requestRef: 'chat-request:vscode-cowork:ambiguous-file',
          operation: 'insert-draft',
          selectedWindowRef: 'window:vscode:paper',
          windowCandidates: [
            vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          ],
          latestObservation: vscodeNativeRouteObservation({
            visibleFileRefs: ['file-ref:vscode:paper', 'file-ref:vscode:notes'],
          }),
          draftTextRef: 'text-ref:vscode:draft',
        },
      } as any,
    },
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const executionUnits = done?.executionUnits as Record<string, unknown>[] | undefined;
  const unit = executionUnits?.[0];

  assert.equal(done?.status, 'needs-confirmation');
  assert.equal(unit?.status, 'needs-confirmation');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.blockedReason, 'vscode_cowork_target_file_needs_confirmation');
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:notes'));
  assert.doesNotMatch(JSON.stringify(events), /draft text|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route blocks mixed raw and refs-first VSCode observe refs', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '操作我已经打开的 VSCode，聚焦编辑器。',
      commandId: 'native-route-vscode-cowork-mixed-observe-refs',
      attemptId: 'native-route-vscode-cowork-mixed-observe-refs-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:mixed-observe-refs',
        operation: 'focus-editor',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          textRefs: ['text:vscode:visible', 'paper.md raw visible text'],
          elementRefs: ['element:vscode:editor', 'raw editor element'],
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_observe_refs_invalid');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.ok((done?.evidenceRefs as string[]).includes('text:vscode:visible'));
  assert.doesNotMatch(JSON.stringify(events), /paper\.md raw visible text|raw editor element|product-ready/i);
});

test('Computer Use native route blocks stale VSCode selected file refs', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-stale-selected-file',
      attemptId: 'native-route-vscode-cowork-stale-selected-file-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:stale-selected-file',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:notes',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['file-ref:vscode:paper'],
        }),
        draftTextRef: 'text-ref:vscode:draft',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.blockedReason, 'vscode_cowork_selected_file_not_found');
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:notes'));
  assert.doesNotMatch(JSON.stringify(events), /draft text|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route blocks mixed raw and refs-first VSCode visible file refs', async () => {
  const events = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-mixed-visible-file-refs',
      attemptId: 'native-route-vscode-cowork-mixed-visible-file-refs-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:mixed-visible-file-refs',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          {
            ...vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
            visibleFileRefs: ['file-ref:vscode:paper', '/Users/example/paper.md'],
          },
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['file-ref:vscode:paper', 'Paper.md'],
        }),
        draftTextRef: 'text-ref:vscode:draft',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_visible_file_refs_invalid');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(events), /\/Users\/example\/paper\.md|Paper\.md|paper\.md|product-ready/i);
});

test('Computer Use native route blocks VSCode file targets that are raw paths instead of refs', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-raw-file-path',
      attemptId: 'native-route-vscode-cowork-raw-file-path-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-file-path',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: '/Users/example/paper.md',
        windowCandidates: [
          {
            ...vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
            visibleFileRefs: ['/Users/example/paper.md'],
          },
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['/Users/example/paper.md'],
        }),
        draftTextRef: 'text-ref:vscode:draft',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.blockedReason, 'vscode_cowork_selected_file_ref_invalid');
  assert.doesNotMatch(JSON.stringify(events), /\/Users\/example\/paper\.md|paper\.md|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route requires draft text refs for VSCode draft insertion', async () => {
  const stream = createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-missing-draft-ref',
      attemptId: 'native-route-vscode-cowork-missing-draft-ref-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:missing-draft-ref',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['file-ref:vscode:paper'],
        }),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.equal(unit?.blockedReason, 'vscode_cowork_draft_text_ref_required');
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.ok((done?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(events), /draft body|rawDraftText|clipboard|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const rawDraftEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '在我已经打开的 VSCode 里插入这段草稿。',
      commandId: 'native-route-vscode-cowork-raw-draft-text',
      attemptId: 'native-route-vscode-cowork-raw-draft-text-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-draft-text',
        operation: 'insert-draft',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation({
          visibleFileRefs: ['file-ref:vscode:paper'],
        }),
        draftTextRef: 'Please insert this raw draft body into the editor.',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawDraftDone = routeOutcomeEvent(rawDraftEvents) as Record<string, unknown> | undefined;
  const rawDraftUnit = (rawDraftDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawDraftDone?.status, 'blocked');
  assert.equal(rawDraftUnit?.status, 'blocked');
  assert.equal(rawDraftUnit?.primitive, undefined);
  assert.equal(rawDraftUnit?.action, undefined);
  assert.equal(rawDraftUnit?.blockedReason, 'vscode_cowork_draft_text_ref_required');
  assert.doesNotMatch(JSON.stringify(rawDraftEvents), /Please insert this raw draft body|rawDraftText|clipboard|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route returns refs-only observe decision for VSCode visible text reads', async () => {
  const hiddenEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '读取我当前打开的 VSCode 可见文本。',
      commandId: 'native-route-vscode-cowork-read-visible-text-hidden-editor',
      attemptId: 'native-route-vscode-cowork-read-visible-text-hidden-editor-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:read-visible-text-hidden-editor',
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          editorVisible: false,
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const hiddenDone = routeOutcomeEvent(hiddenEvents) as Record<string, unknown> | undefined;
  const hiddenUnit = (hiddenDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(hiddenDone?.status, 'blocked');
  assert.equal(hiddenUnit?.primitive, undefined);
  assert.equal(hiddenUnit?.action, undefined);
  assert.equal(hiddenUnit?.blockedReason, 'vscode_cowork_editor_not_visible');
  assert.doesNotMatch(JSON.stringify(hiddenEvents), /visible text|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const missingEditorElementEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '读取我当前打开的 VSCode 可见文本。',
      commandId: 'native-route-vscode-cowork-read-visible-text-missing-editor-element',
      attemptId: 'native-route-vscode-cowork-read-visible-text-missing-editor-element-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:read-visible-text-missing-editor-element',
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          elementRefs: ['element:vscode:file-tabs'],
          editorVisible: true,
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const missingEditorElementDone = routeOutcomeEvent(missingEditorElementEvents) as Record<string, unknown> | undefined;
  const missingEditorElementUnit = (missingEditorElementDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(missingEditorElementDone?.status, 'blocked');
  assert.equal(missingEditorElementUnit?.primitive, undefined);
  assert.equal(missingEditorElementUnit?.action, undefined);
  assert.equal(missingEditorElementUnit?.blockedReason, 'vscode_cowork_editor_element_ref_required');
  assert.ok((missingEditorElementDone?.evidenceRefs as string[]).includes('element:vscode:file-tabs'));
  assert.doesNotMatch(JSON.stringify(missingEditorElementEvents), /visible text|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const stream = createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '读取我当前打开的 VSCode 可见文本。',
      commandId: 'native-route-vscode-cowork-read-visible-text',
      attemptId: 'native-route-vscode-cowork-read-visible-text-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:read-visible-text',
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  });

  assert.notEqual(stream, undefined);
  const events = await collectStreamEvents(stream!);
  const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'partial');
  assert.equal(unit?.primitive, 'observe');
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('observation:vscode:current'));
  assert.ok((done?.evidenceRefs as string[]).includes('window-action-session:vscode-cowork:1'));
  assert.ok((done?.evidenceRefs as string[]).includes('text:vscode:visible'));
  assert.doesNotMatch(JSON.stringify(events), /visible text|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route requires refs-first VSCode cursor movement refs', async () => {
  const rawCursorMoveEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '把我已经打开的 VSCode 光标移动到下一段。',
      commandId: 'native-route-vscode-cowork-raw-cursor-move',
      attemptId: 'native-route-vscode-cowork-raw-cursor-move-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:raw-cursor-move',
        operation: 'move-cursor',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        cursorMoveRef: 'move to next paragraph',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawCursorMoveDone = routeOutcomeEvent(rawCursorMoveEvents) as Record<string, unknown> | undefined;
  const rawCursorMoveUnit = (rawCursorMoveDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawCursorMoveDone?.status, 'blocked');
  assert.equal(rawCursorMoveUnit?.primitive, undefined);
  assert.equal(rawCursorMoveUnit?.action, undefined);
  assert.equal(rawCursorMoveUnit?.blockedReason, 'vscode_cowork_cursor_move_ref_required');
  assert.doesNotMatch(JSON.stringify(rawCursorMoveEvents), /move to next paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const readyEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '把我已经打开的 VSCode 光标向右移动一格。',
      commandId: 'native-route-vscode-cowork-move-cursor-right',
      attemptId: 'native-route-vscode-cowork-move-cursor-right-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:move-cursor-right',
        operation: 'move-cursor',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        cursorMoveRef: 'cursor-move:vscode:right',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const readyDone = routeOutcomeEvent(readyEvents) as Record<string, unknown> | undefined;
  const readyUnit = (readyDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(readyDone?.status, 'partial');
  assert.equal(readyUnit?.primitive, 'act');
  assert.deepEqual(readyUnit?.action, {
    type: 'key',
    key: 'ArrowRight',
    elementRef: 'element:vscode:editor',
  });
  assert.ok((readyDone?.evidenceRefs as string[]).includes('cursor-move:vscode:right'));
  assert.doesNotMatch(JSON.stringify(readyEvents), /move to next paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route gates VSCode replace-selection on refs-first selection and full-access permission', async () => {
  const rawSelectionEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '替换我已经打开的 VSCode 当前选区。',
      commandId: 'native-route-vscode-cowork-replace-selection-raw-selection',
      attemptId: 'native-route-vscode-cowork-replace-selection-raw-selection-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:replace-selection-raw-selection',
        operation: 'replace-selection',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        selectionRef: 'currently highlighted paragraph',
        replacementTextRef: 'text-ref:vscode:replacement',
        riskActionHash: 'risk:replace-selection:file-ref:vscode:paper',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawSelectionDone = routeOutcomeEvent(rawSelectionEvents) as Record<string, unknown> | undefined;
  const rawSelectionUnit = (rawSelectionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawSelectionDone?.status, 'blocked');
  assert.equal(rawSelectionUnit?.primitive, undefined);
  assert.equal(rawSelectionUnit?.action, undefined);
  assert.equal(rawSelectionUnit?.blockedReason, 'vscode_cowork_selection_ref_required');
  assert.doesNotMatch(JSON.stringify(rawSelectionEvents), /currently highlighted paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const missingPermissionEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '替换我已经打开的 VSCode 当前选区。',
      commandId: 'native-route-vscode-cowork-replace-selection-missing-permission',
      attemptId: 'native-route-vscode-cowork-replace-selection-missing-permission-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:replace-selection-missing-permission',
        operation: 'replace-selection',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        selectionRef: 'selection-ref:vscode:current',
        replacementTextRef: 'text-ref:vscode:replacement',
        riskActionHash: 'risk:replace-selection:file-ref:vscode:paper',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const missingPermissionDone = routeOutcomeEvent(missingPermissionEvents) as Record<string, unknown> | undefined;
  const missingPermissionUnit = (missingPermissionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(missingPermissionDone?.status, 'blocked');
  assert.equal(missingPermissionUnit?.primitive, undefined);
  assert.equal(missingPermissionUnit?.action, undefined);
  assert.equal(missingPermissionUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((missingPermissionDone?.evidenceRefs as string[]).includes('selection-ref:vscode:current'));
  assert.ok((missingPermissionDone?.evidenceRefs as string[]).includes('text-ref:vscode:replacement'));
  assert.ok((missingPermissionDone?.evidenceRefs as string[]).includes('risk:replace-selection:file-ref:vscode:paper'));

  const fullAccessEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '替换我已经打开的 VSCode 当前选区。',
      commandId: 'native-route-vscode-cowork-replace-selection-full-access',
      attemptId: 'native-route-vscode-cowork-replace-selection-full-access-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:replace-selection-full-access',
        operation: 'replace-selection',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        selectionRef: 'selection-ref:vscode:current',
        replacementTextRef: 'text-ref:vscode:replacement',
        riskActionHash: 'risk:replace-selection:file-ref:vscode:paper',
        permissionRef: VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF,
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const fullAccessDone = routeOutcomeEvent(fullAccessEvents) as Record<string, unknown> | undefined;
  const fullAccessUnit = (fullAccessDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(fullAccessDone?.status, 'partial');
  assert.equal(fullAccessUnit?.primitive, 'act');
  assert.deepEqual(fullAccessUnit?.action, {
    type: 'type',
    textRef: 'text-ref:vscode:replacement',
    elementRef: 'element:vscode:editor',
  });
  assert.equal((fullAccessUnit?.risk as Record<string, unknown> | undefined)?.level, 'low');
  assert.equal(fullAccessUnit?.approvalRef, undefined);
  assert.equal(fullAccessUnit?.permissionRef, VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF);
  assert.ok((fullAccessDone?.evidenceRefs as string[]).includes('selection-ref:vscode:current'));
  assert.ok((fullAccessDone?.evidenceRefs as string[]).includes('text-ref:vscode:replacement'));
  assert.ok((fullAccessDone?.evidenceRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF));
  assert.doesNotMatch(JSON.stringify(fullAccessEvents), /approval:|currently highlighted paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route keeps VSCode real-file save and undo blocked until matching full-access permission refs are present', async () => {
  const unconfirmedEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-unconfirmed',
      attemptId: 'native-route-vscode-cowork-save-unconfirmed-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-unconfirmed',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unconfirmedDone = routeOutcomeEvent(unconfirmedEvents) as Record<string, unknown> | undefined;
  const unconfirmedUnit = (unconfirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unconfirmedDone?.status, 'blocked');
  assert.equal(unconfirmedUnit?.primitive, undefined);
  assert.equal(unconfirmedUnit?.action, undefined);
  assert.equal(unconfirmedUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((unconfirmedDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));

  const unboundPermissionEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-unbound-permission',
      attemptId: 'native-route-vscode-cowork-save-unbound-permission-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-unbound-permission',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        permissionRef: VSCODE_COWORK_UNBOUND_PERMISSION_REF,
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unboundPermissionDone = routeOutcomeEvent(unboundPermissionEvents) as Record<string, unknown> | undefined;
  const unboundPermissionUnit = (unboundPermissionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unboundPermissionDone?.status, 'blocked');
  assert.equal(unboundPermissionUnit?.primitive, undefined);
  assert.equal(unboundPermissionUnit?.action, undefined);
  assert.equal(unboundPermissionUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_target_session_required');
  assert.ok((unboundPermissionDone?.evidenceRefs as string[]).includes(VSCODE_COWORK_UNBOUND_PERMISSION_REF));

  const bareNonUserFileEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 临时草稿文件。',
      commandId: 'native-route-vscode-cowork-save-non-user-without-scope-ref',
      attemptId: 'native-route-vscode-cowork-save-non-user-without-scope-ref-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-non-user-without-scope-ref',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          userFile: false,
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const bareNonUserFileDone = routeOutcomeEvent(bareNonUserFileEvents) as Record<string, unknown> | undefined;
  const bareNonUserFileUnit = (bareNonUserFileDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(bareNonUserFileDone?.status, 'blocked');
  assert.equal(bareNonUserFileUnit?.primitive, undefined);
  assert.equal(bareNonUserFileUnit?.action, undefined);
  assert.equal(bareNonUserFileUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((bareNonUserFileDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(bareNonUserFileEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const unboundNonUserFileScopeEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 临时草稿文件。',
      commandId: 'native-route-vscode-cowork-save-non-user-unbound-scope',
      attemptId: 'native-route-vscode-cowork-save-non-user-unbound-scope-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-non-user-unbound-scope',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          userFile: false,
          nonUserFileScopeRef: 'non-user-file-scope:vscode:scratch',
        },
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unboundNonUserFileScopeDone = routeOutcomeEvent(unboundNonUserFileScopeEvents) as Record<string, unknown> | undefined;
  const unboundNonUserFileScopeUnit = (unboundNonUserFileScopeDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unboundNonUserFileScopeDone?.status, 'blocked');
  assert.equal(unboundNonUserFileScopeUnit?.primitive, undefined);
  assert.equal(unboundNonUserFileScopeUnit?.action, undefined);
  assert.equal(unboundNonUserFileScopeUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((unboundNonUserFileScopeDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((unboundNonUserFileScopeDone?.evidenceRefs as string[]).includes('non-user-file-scope:vscode:scratch'));
  assert.doesNotMatch(JSON.stringify(unboundNonUserFileScopeEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const scopedNonUserFileEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 临时草稿文件。',
      commandId: 'native-route-vscode-cowork-save-non-user-scoped',
      attemptId: 'native-route-vscode-cowork-save-non-user-scoped-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-non-user-scoped',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: {
          ...vscodeNativeRouteObservation(),
          userFile: false,
          nonUserFileScopeRef: 'non-user-file-scope:file-ref:vscode:paper:scratch',
        },
        permissionRef: VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF,
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const scopedNonUserFileDone = routeOutcomeEvent(scopedNonUserFileEvents) as Record<string, unknown> | undefined;
  const scopedNonUserFileUnit = (scopedNonUserFileDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(scopedNonUserFileDone?.status, 'partial');
  assert.equal(scopedNonUserFileUnit?.primitive, 'act');
  assert.deepEqual(scopedNonUserFileUnit?.action, {
    type: 'app_command',
    command: 'save',
    elementRef: 'element:vscode:editor',
  });
  assert.equal((scopedNonUserFileUnit?.risk as Record<string, unknown> | undefined)?.level, 'low');
  assert.equal(scopedNonUserFileUnit?.approvalRef, undefined);
  assert.equal(scopedNonUserFileUnit?.permissionRef, VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF);
  assert.ok((scopedNonUserFileDone?.evidenceRefs as string[]).includes('non-user-file-scope:file-ref:vscode:paper:scratch'));
  assert.ok((scopedNonUserFileDone?.evidenceRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF));
  assert.doesNotMatch(JSON.stringify(scopedNonUserFileEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const unconfirmedUndoEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '撤销我当前打开的 VSCode 文件里的上一步编辑。',
      commandId: 'native-route-vscode-cowork-undo-unconfirmed',
      attemptId: 'native-route-vscode-cowork-undo-unconfirmed-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:undo-unconfirmed',
        operation: 'undo-last-action',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:undo-last-action:file-ref:vscode:paper',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unconfirmedUndoDone = routeOutcomeEvent(unconfirmedUndoEvents) as Record<string, unknown> | undefined;
  const unconfirmedUndoUnit = (unconfirmedUndoDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unconfirmedUndoDone?.status, 'blocked');
  assert.equal(unconfirmedUndoUnit?.primitive, undefined);
  assert.equal(unconfirmedUndoUnit?.action, undefined);
  assert.equal(unconfirmedUndoUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((unconfirmedUndoDone?.evidenceRefs as string[]).includes('risk:undo-last-action:file-ref:vscode:paper'));

  const approvalWithoutRiskEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-approval-without-risk',
      attemptId: 'native-route-vscode-cowork-save-approval-without-risk-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-approval-without-risk',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        confirmationRef: 'approval:save-current-file:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const approvalWithoutRiskDone = routeOutcomeEvent(approvalWithoutRiskEvents) as Record<string, unknown> | undefined;
  const approvalWithoutRiskUnit = (approvalWithoutRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(approvalWithoutRiskDone?.status, 'blocked');
  assert.equal(approvalWithoutRiskUnit?.primitive, undefined);
  assert.equal(approvalWithoutRiskUnit?.action, undefined);
  assert.equal(approvalWithoutRiskUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok(!(approvalWithoutRiskDone?.evidenceRefs as string[]).includes('approval:save-current-file:paper:confirmed'));

  const rawRiskEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-raw-risk',
      attemptId: 'native-route-vscode-cowork-save-raw-risk-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-raw-risk',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'save /Users/example/paper.md',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const rawRiskDone = routeOutcomeEvent(rawRiskEvents) as Record<string, unknown> | undefined;
  const rawRiskUnit = (rawRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawRiskDone?.status, 'blocked');
  assert.equal(rawRiskUnit?.primitive, undefined);
  assert.equal(rawRiskUnit?.action, undefined);
  assert.equal(rawRiskUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.doesNotMatch(JSON.stringify(rawRiskEvents), /\/Users\/example\/paper\.md|paper\.md|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const prefixedRawRiskEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-prefixed-raw-risk',
      attemptId: 'native-route-vscode-cowork-save-prefixed-raw-risk-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-prefixed-raw-risk',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:/Users/example/paper.md',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const prefixedRawRiskDone = routeOutcomeEvent(prefixedRawRiskEvents) as Record<string, unknown> | undefined;
  const prefixedRawRiskUnit = (prefixedRawRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(prefixedRawRiskDone?.status, 'blocked');
  assert.equal(prefixedRawRiskUnit?.primitive, undefined);
  assert.equal(prefixedRawRiskUnit?.action, undefined);
  assert.equal(prefixedRawRiskUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.doesNotMatch(JSON.stringify(prefixedRawRiskEvents), /\/Users\/example\/paper\.md|paper\.md|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const unboundTargetRiskEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-unbound-target-risk',
      attemptId: 'native-route-vscode-cowork-save-unbound-target-risk-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-unbound-target-risk',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:paper',
        confirmationRef: 'approval:risk:save-current-file:paper:file-ref:vscode:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unboundTargetRiskDone = routeOutcomeEvent(unboundTargetRiskEvents) as Record<string, unknown> | undefined;
  const unboundTargetRiskUnit = (unboundTargetRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unboundTargetRiskDone?.status, 'blocked');
  assert.equal(unboundTargetRiskUnit?.primitive, undefined);
  assert.equal(unboundTargetRiskUnit?.action, undefined);
  assert.equal(unboundTargetRiskUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((unboundTargetRiskDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((unboundTargetRiskDone?.evidenceRefs as string[]).includes('risk:save-current-file:paper'));
  assert.ok(!(unboundTargetRiskDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:paper:file-ref:vscode:paper:confirmed'));
  assert.doesNotMatch(JSON.stringify(unboundTargetRiskEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const embeddedRiskEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-approval-embedded-risk',
      attemptId: 'native-route-vscode-cowork-save-approval-embedded-risk-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-approval-embedded-risk',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper-old:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const embeddedRiskDone = routeOutcomeEvent(embeddedRiskEvents) as Record<string, unknown> | undefined;
  const embeddedRiskUnit = (embeddedRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(embeddedRiskDone?.status, 'blocked');
  assert.equal(embeddedRiskUnit?.primitive, undefined);
  assert.equal(embeddedRiskUnit?.action, undefined);
  assert.equal(embeddedRiskUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((embeddedRiskDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok(!(embeddedRiskDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper-old:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed'));

  const unsuffixedApprovalEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-approval-without-confirmation-suffix',
      attemptId: 'native-route-vscode-cowork-save-approval-without-confirmation-suffix-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-approval-without-confirmation-suffix',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const unsuffixedApprovalDone = routeOutcomeEvent(unsuffixedApprovalEvents) as Record<string, unknown> | undefined;
  const unsuffixedApprovalUnit = (unsuffixedApprovalDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unsuffixedApprovalDone?.status, 'blocked');
  assert.equal(unsuffixedApprovalUnit?.primitive, undefined);
  assert.equal(unsuffixedApprovalUnit?.action, undefined);
  assert.equal(unsuffixedApprovalUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((unsuffixedApprovalDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok(!(unsuffixedApprovalDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper'));

  const riskOnlyApprovalEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-approval-without-file-target',
      attemptId: 'native-route-vscode-cowork-save-approval-without-file-target-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-approval-without-file-target',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const riskOnlyApprovalDone = routeOutcomeEvent(riskOnlyApprovalEvents) as Record<string, unknown> | undefined;
  const riskOnlyApprovalUnit = (riskOnlyApprovalDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(riskOnlyApprovalDone?.status, 'blocked');
  assert.equal(riskOnlyApprovalUnit?.primitive, undefined);
  assert.equal(riskOnlyApprovalUnit?.action, undefined);
  assert.equal(riskOnlyApprovalUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((riskOnlyApprovalDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok(!(riskOnlyApprovalDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:confirmed'));
  assert.doesNotMatch(JSON.stringify(riskOnlyApprovalEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const approvalWithoutSessionEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-approval-without-active-session',
      attemptId: 'native-route-vscode-cowork-save-approval-without-active-session-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-approval-without-active-session',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const approvalWithoutSessionDone = routeOutcomeEvent(approvalWithoutSessionEvents) as Record<string, unknown> | undefined;
  const approvalWithoutSessionUnit = (approvalWithoutSessionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(approvalWithoutSessionDone?.status, 'blocked');
  assert.equal(approvalWithoutSessionUnit?.primitive, undefined);
  assert.equal(approvalWithoutSessionUnit?.action, undefined);
  assert.equal(approvalWithoutSessionUnit?.blockedReason, 'vscode_cowork_full_access_permission_ref_required');
  assert.ok((approvalWithoutSessionDone?.evidenceRefs as string[]).includes('window-action-session:vscode-cowork:1'));
  assert.ok(!(approvalWithoutSessionDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed'));
  assert.doesNotMatch(JSON.stringify(approvalWithoutSessionEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const confirmedEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-full-access',
      attemptId: 'native-route-vscode-cowork-save-full-access-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-full-access',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        permissionRef: VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF,
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const confirmedDone = routeOutcomeEvent(confirmedEvents) as Record<string, unknown> | undefined;
  const confirmedUnit = (confirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(confirmedDone?.status, 'partial');
  assert.equal(confirmedUnit?.primitive, 'act');
  assert.deepEqual(confirmedUnit?.action, {
    type: 'app_command',
    command: 'save',
    elementRef: 'element:vscode:editor',
  });
  assert.deepEqual(confirmedUnit?.risk, {
    level: 'low',
    categories: ['user-real-file-change'],
    actionHash: 'risk:save-current-file:file-ref:vscode:paper',
  });
  assert.equal(confirmedUnit?.approvalRef, undefined);
  assert.equal(confirmedUnit?.permissionRef, VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF);
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF));
  assert.doesNotMatch(JSON.stringify(confirmedEvents), /approval:|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const undoFullAccessEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '撤销我当前打开的 VSCode 文件里的上一步编辑。',
      commandId: 'native-route-vscode-cowork-undo-full-access',
      attemptId: 'native-route-vscode-cowork-undo-full-access-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:undo-full-access',
        operation: 'undo-last-action',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:undo-last-action:file-ref:vscode:paper',
        permissionRef: VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF,
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const undoFullAccessDone = routeOutcomeEvent(undoFullAccessEvents) as Record<string, unknown> | undefined;
  const undoFullAccessUnit = (undoFullAccessDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(undoFullAccessDone?.status, 'partial');
  assert.equal(undoFullAccessUnit?.primitive, 'act');
  assert.deepEqual(undoFullAccessUnit?.action, {
    type: 'key',
    key: 'Command+Z',
    elementRef: 'element:vscode:editor',
  });
  assert.equal((undoFullAccessUnit?.risk as Record<string, unknown> | undefined)?.level, 'low');
  assert.equal(undoFullAccessUnit?.approvalRef, undefined);
  assert.equal(undoFullAccessUnit?.permissionRef, VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF);
  assert.ok((undoFullAccessDone?.evidenceRefs as string[]).includes('risk:undo-last-action:file-ref:vscode:paper'));
  assert.ok((undoFullAccessDone?.evidenceRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF));
  assert.doesNotMatch(JSON.stringify(undoFullAccessEvents), /approval:|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route blocks VSCode bulk and cross-file requests until Host decomposes them even with full-access permission', async () => {
  for (const operation of ['bulk-replace', 'cross-file-modify'] as const) {
    const events = await collectStreamEvents(createComputerUseNativeRouteStream({
      request: vscodeCoWorkRouteRequest({
        commandText: '对我当前打开的 VSCode 文件执行已授权的批量编辑。',
        commandId: `native-route-vscode-cowork-${operation}-full-access`,
        attemptId: `native-route-vscode-cowork-${operation}-full-access-attempt-1`,
        vscodeCoWork: {
          requestRef: `chat-request:vscode-cowork:${operation}-full-access`,
          operation,
          selectedWindowRef: 'window:vscode:paper',
          selectedFileRef: 'file-ref:vscode:paper',
          windowCandidates: [
            vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          ],
          latestObservation: vscodeNativeRouteObservation(),
          riskActionHash: `risk:${operation}:file-ref:vscode:paper`,
          permissionRef: VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF,
        },
      }),
      workspace: '/tmp/workspace',
      provider: 'sciforge-provider',
      model: 'sciforge-model',
      profile: 'host-owned',
    })!);
    const done = routeOutcomeEvent(events) as Record<string, unknown> | undefined;
    const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

    assert.equal(done?.status, 'blocked', operation);
    assert.equal(unit?.status, 'blocked', operation);
    assert.equal(unit?.blockedReason, 'vscode_cowork_non_atomic_operation_requires_host_decomposition', operation);
    assert.equal(unit?.primitive, undefined, operation);
    assert.equal(unit?.action, undefined, operation);
    assert.ok((done?.evidenceRefs as string[]).includes(`risk:${operation}:file-ref:vscode:paper`), operation);
    assert.ok((done?.evidenceRefs as string[]).includes(VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF), operation);
    assert.doesNotMatch(JSON.stringify(events), /approval:|replacement plan|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
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

function routeOutcomeEvent(events: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return events.find((event) =>
    event.type === 'done'
    || event.type === 'partial'
    || event.type === 'blocked'
  );
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

function vscodeNativeRouteWindow(input: {
  windowRef: string;
  titleRef?: string;
}) {
  return {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: input.windowRef.replace('window:', 'process:'),
    windowRef: input.windowRef,
    titleRef: input.titleRef ?? `${input.windowRef}:title`,
    frontmostRef: `${input.windowRef}:frontmost`,
  };
}

function vscodeCoWorkRouteRequest(input: {
  commandText: string;
  commandId: string;
  attemptId: string;
  vscodeCoWork: Record<string, unknown>;
}) {
  return {
    commandText: input.commandText,
    workspacePath: '/tmp/workspace',
    commandId: input.commandId,
    attemptId: input.attemptId,
    runtimeIntent: {
      schemaVersion: 'sciforge.runtime-codex.host-intent.v1' as const,
      kind: 'computer-use-native-route' as const,
      source: 'host-owned' as const,
      computerUseNext: {
        taskId: 'CU-NEXT-09',
        recommendedTargetMode: 'active-window',
        recommendedTargetApp: 'Visual Studio Code',
        semanticMarkers: ['current-vscode-cowork', 'refs-first'],
      },
      vscodeCoWork: input.vscodeCoWork,
    },
  };
}

function vscodeCoWorkAgentHostInput(input: {
  operation: string;
  selectedWindowRef?: string;
  selectedFileRef?: string;
  windowCandidates: Array<Record<string, unknown>>;
  latestObservation: Record<string, unknown>;
}) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ordinary-chat',
    intentText: '读取我当前打开的 VSCode 可见文本。',
    singleTurnOverride: false,
    refs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:ordinary-host-input'],
    readiness: {
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      kind: 'current-vscode-cowork',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:ordinary-host-input',
        operation: input.operation,
        selectedWindowRef: input.selectedWindowRef,
        selectedFileRef: input.selectedFileRef,
        windowCandidates: input.windowCandidates,
      },
    },
    observation: {
      fresh: true,
      vscodeCoWork: input.latestObservation,
    },
    permissions: {
      refs: [VSCODE_COWORK_FULL_ACCESS_PERMISSION_REF],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function vscodeNativeRouteObservation(input: {
  visibleFileRefs?: string[];
} = {}) {
  return {
    windowRef: 'window:vscode:paper',
    sessionRef: 'window-action-session:vscode-cowork:1',
    observationRef: 'observation:vscode:current',
    screenshotRef: 'image:vscode:current',
    accessibilityRef: 'accessibility:vscode:current',
    textRefs: ['text:vscode:visible'],
    elementRefs: ['element:vscode:editor', 'element:vscode:file-tabs'],
    freshnessRef: 'freshness:vscode:current',
    editorVisible: true,
    visibleFileRefs: input.visibleFileRefs ?? ['file-ref:vscode:paper'],
    userFile: true,
  };
}
