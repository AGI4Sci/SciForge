import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computerUseGatewayRequest,
  createComputerUseNativeRouteStream,
  isComputerUseNativeRouteCommand,
} from './computer-use-native-route.js';
import { createVSCodeCoWorkChatBridge } from './vscode-cowork-chat-bridge.js';

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
    assert.match(String(done?.message), /Computer Use Act materializer (?:is )?completed|product workflow completion is blocked/i);
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const rawSelectedWindowDone = rawSelectedWindowEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const rawSelectedFileDone = rawSelectedFileEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'blocked');
  assert.equal(unit?.status, 'blocked');
  assert.equal(unit?.blockedReason, 'vscode_cowork_operation_required');
  assert.equal(unit?.primitive, undefined);
  assert.equal(unit?.action, undefined);
  assert.ok((done?.evidenceRefs as string[]).includes('chat-request:vscode-cowork:unsupported-operation'));
  assert.ok((done?.evidenceRefs as string[]).includes('window:vscode:paper'));
  assert.ok(!(done?.evidenceRefs as string[]).includes('observation:vscode:current'));
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const rawDraftDone = rawDraftEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const hiddenDone = hiddenEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const missingEditorElementDone = missingEditorElementEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(done?.status, 'ready');
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
  const rawCursorMoveDone = rawCursorMoveEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
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
  const readyDone = readyEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const readyUnit = (readyDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(readyDone?.status, 'ready');
  assert.equal(readyUnit?.primitive, 'act');
  assert.deepEqual(readyUnit?.action, {
    type: 'key',
    key: 'ArrowRight',
    elementRef: 'element:vscode:editor',
  });
  assert.ok((readyDone?.evidenceRefs as string[]).includes('cursor-move:vscode:right'));
  assert.doesNotMatch(JSON.stringify(readyEvents), /move to next paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route gates VSCode replace-selection on refs-first selection and approval', async () => {
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
  const rawSelectionDone = rawSelectionEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const rawSelectionUnit = (rawSelectionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawSelectionDone?.status, 'blocked');
  assert.equal(rawSelectionUnit?.primitive, undefined);
  assert.equal(rawSelectionUnit?.action, undefined);
  assert.equal(rawSelectionUnit?.blockedReason, 'vscode_cowork_selection_ref_required');
  assert.doesNotMatch(JSON.stringify(rawSelectionEvents), /currently highlighted paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const unconfirmedEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '替换我已经打开的 VSCode 当前选区。',
      commandId: 'native-route-vscode-cowork-replace-selection-unconfirmed',
      attemptId: 'native-route-vscode-cowork-replace-selection-unconfirmed-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:replace-selection-unconfirmed',
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
  const unconfirmedDone = unconfirmedEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unconfirmedUnit = (unconfirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unconfirmedDone?.status, 'needs-confirmation');
  assert.equal(unconfirmedUnit?.primitive, undefined);
  assert.equal(unconfirmedUnit?.action, undefined);
  assert.equal(unconfirmedUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((unconfirmedDone?.evidenceRefs as string[]).includes('selection-ref:vscode:current'));
  assert.ok((unconfirmedDone?.evidenceRefs as string[]).includes('text-ref:vscode:replacement'));
  assert.ok((unconfirmedDone?.evidenceRefs as string[]).includes('risk:replace-selection:file-ref:vscode:paper'));

  const confirmedEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '替换我已经打开的 VSCode 当前选区。',
      commandId: 'native-route-vscode-cowork-replace-selection-confirmed',
      attemptId: 'native-route-vscode-cowork-replace-selection-confirmed-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:replace-selection-confirmed',
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
        confirmationRef: 'approval:risk:replace-selection:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const confirmedDone = confirmedEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const confirmedUnit = (confirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(confirmedDone?.status, 'ready');
  assert.equal(confirmedUnit?.primitive, 'act');
  assert.deepEqual(confirmedUnit?.action, {
    type: 'type',
    textRef: 'text-ref:vscode:replacement',
    elementRef: 'element:vscode:editor',
  });
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('selection-ref:vscode:current'));
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('text-ref:vscode:replacement'));
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('approval:risk:replace-selection:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed'));
  assert.doesNotMatch(JSON.stringify(confirmedEvents), /currently highlighted paragraph|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route keeps VSCode real-file save and undo blocked until matching approval refs are present', async () => {
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
  const unconfirmedDone = unconfirmedEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unconfirmedUnit = (unconfirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unconfirmedDone?.status, 'needs-confirmation');
  assert.equal(unconfirmedUnit?.primitive, undefined);
  assert.equal(unconfirmedUnit?.action, undefined);
  assert.equal(unconfirmedUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((unconfirmedDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));

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
  const bareNonUserFileDone = bareNonUserFileEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const bareNonUserFileUnit = (bareNonUserFileDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(bareNonUserFileDone?.status, 'blocked');
  assert.equal(bareNonUserFileUnit?.primitive, undefined);
  assert.equal(bareNonUserFileUnit?.action, undefined);
  assert.equal(bareNonUserFileUnit?.blockedReason, 'vscode_cowork_non_user_file_scope_ref_required');
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
  const unboundNonUserFileScopeDone = unboundNonUserFileScopeEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unboundNonUserFileScopeUnit = (unboundNonUserFileScopeDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unboundNonUserFileScopeDone?.status, 'blocked');
  assert.equal(unboundNonUserFileScopeUnit?.primitive, undefined);
  assert.equal(unboundNonUserFileScopeUnit?.action, undefined);
  assert.equal(unboundNonUserFileScopeUnit?.blockedReason, 'vscode_cowork_non_user_file_scope_target_ref_required');
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
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const scopedNonUserFileDone = scopedNonUserFileEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const scopedNonUserFileUnit = (scopedNonUserFileDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(scopedNonUserFileDone?.status, 'ready');
  assert.equal(scopedNonUserFileUnit?.primitive, 'act');
  assert.deepEqual(scopedNonUserFileUnit?.action, {
    type: 'app_command',
    command: 'save',
    elementRef: 'element:vscode:editor',
  });
  assert.equal(scopedNonUserFileUnit?.risk, undefined);
  assert.equal(scopedNonUserFileUnit?.approvalRef, undefined);
  assert.ok((scopedNonUserFileDone?.evidenceRefs as string[]).includes('non-user-file-scope:file-ref:vscode:paper:scratch'));
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
  const unconfirmedUndoDone = unconfirmedUndoEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unconfirmedUndoUnit = (unconfirmedUndoDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unconfirmedUndoDone?.status, 'needs-confirmation');
  assert.equal(unconfirmedUndoUnit?.primitive, undefined);
  assert.equal(unconfirmedUndoUnit?.action, undefined);
  assert.equal(unconfirmedUndoUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
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
  const approvalWithoutRiskDone = approvalWithoutRiskEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const approvalWithoutRiskUnit = (approvalWithoutRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(approvalWithoutRiskDone?.status, 'blocked');
  assert.equal(approvalWithoutRiskUnit?.primitive, undefined);
  assert.equal(approvalWithoutRiskUnit?.action, undefined);
  assert.equal(approvalWithoutRiskUnit?.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
  assert.ok((approvalWithoutRiskDone?.evidenceRefs as string[]).includes('approval:save-current-file:paper:confirmed'));

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
  const rawRiskDone = rawRiskEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const rawRiskUnit = (rawRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(rawRiskDone?.status, 'blocked');
  assert.equal(rawRiskUnit?.primitive, undefined);
  assert.equal(rawRiskUnit?.action, undefined);
  assert.equal(rawRiskUnit?.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
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
  const prefixedRawRiskDone = prefixedRawRiskEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const prefixedRawRiskUnit = (prefixedRawRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(prefixedRawRiskDone?.status, 'blocked');
  assert.equal(prefixedRawRiskUnit?.primitive, undefined);
  assert.equal(prefixedRawRiskUnit?.action, undefined);
  assert.equal(prefixedRawRiskUnit?.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
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
  const unboundTargetRiskDone = unboundTargetRiskEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unboundTargetRiskUnit = (unboundTargetRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unboundTargetRiskDone?.status, 'blocked');
  assert.equal(unboundTargetRiskUnit?.primitive, undefined);
  assert.equal(unboundTargetRiskUnit?.action, undefined);
  assert.equal(unboundTargetRiskUnit?.blockedReason, 'vscode_cowork_real_file_change_risk_hash_target_ref_required');
  assert.ok((unboundTargetRiskDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((unboundTargetRiskDone?.evidenceRefs as string[]).includes('risk:save-current-file:paper'));
  assert.ok((unboundTargetRiskDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:paper:file-ref:vscode:paper:confirmed'));
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
  const embeddedRiskDone = embeddedRiskEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const embeddedRiskUnit = (embeddedRiskDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(embeddedRiskDone?.status, 'needs-confirmation');
  assert.equal(embeddedRiskUnit?.primitive, undefined);
  assert.equal(embeddedRiskUnit?.action, undefined);
  assert.equal(embeddedRiskUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((embeddedRiskDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok((embeddedRiskDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper-old:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed'));

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
  const unsuffixedApprovalDone = unsuffixedApprovalEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const unsuffixedApprovalUnit = (unsuffixedApprovalDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(unsuffixedApprovalDone?.status, 'needs-confirmation');
  assert.equal(unsuffixedApprovalUnit?.primitive, undefined);
  assert.equal(unsuffixedApprovalUnit?.action, undefined);
  assert.equal(unsuffixedApprovalUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((unsuffixedApprovalDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok((unsuffixedApprovalDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper'));

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
  const riskOnlyApprovalDone = riskOnlyApprovalEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const riskOnlyApprovalUnit = (riskOnlyApprovalDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(riskOnlyApprovalDone?.status, 'needs-confirmation');
  assert.equal(riskOnlyApprovalUnit?.primitive, undefined);
  assert.equal(riskOnlyApprovalUnit?.action, undefined);
  assert.equal(riskOnlyApprovalUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((riskOnlyApprovalDone?.evidenceRefs as string[]).includes('file-ref:vscode:paper'));
  assert.ok((riskOnlyApprovalDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:confirmed'));
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
  const approvalWithoutSessionDone = approvalWithoutSessionEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const approvalWithoutSessionUnit = (approvalWithoutSessionDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(approvalWithoutSessionDone?.status, 'needs-confirmation');
  assert.equal(approvalWithoutSessionUnit?.primitive, undefined);
  assert.equal(approvalWithoutSessionUnit?.action, undefined);
  assert.equal(approvalWithoutSessionUnit?.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.ok((approvalWithoutSessionDone?.evidenceRefs as string[]).includes('window-action-session:vscode-cowork:1'));
  assert.ok((approvalWithoutSessionDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed'));
  assert.doesNotMatch(JSON.stringify(approvalWithoutSessionEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);

  const confirmedEvents = await collectStreamEvents(createComputerUseNativeRouteStream({
    request: vscodeCoWorkRouteRequest({
      commandText: '保存我当前打开的 VSCode 文件。',
      commandId: 'native-route-vscode-cowork-save-confirmed',
      attemptId: 'native-route-vscode-cowork-save-confirmed-attempt-1',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:save-confirmed',
        operation: 'save-current-file',
        selectedWindowRef: 'window:vscode:paper',
        selectedFileRef: 'file-ref:vscode:paper',
        windowCandidates: [
          vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
        ],
        latestObservation: vscodeNativeRouteObservation(),
        riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
        confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed',
      },
    }),
    workspace: '/tmp/workspace',
    provider: 'sciforge-provider',
    model: 'sciforge-model',
    profile: 'host-owned',
  })!);
  const confirmedDone = confirmedEvents.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
  const confirmedUnit = (confirmedDone?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

  assert.equal(confirmedDone?.status, 'ready');
  assert.equal(confirmedUnit?.primitive, 'act');
  assert.deepEqual(confirmedUnit?.action, {
    type: 'app_command',
    command: 'save',
    elementRef: 'element:vscode:editor',
  });
  assert.deepEqual(confirmedUnit?.risk, {
    level: 'high',
    categories: ['user-real-file-change'],
    actionHash: 'risk:save-current-file:file-ref:vscode:paper',
  });
  assert.equal(confirmedUnit?.approvalRef, 'approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed');
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok((confirmedDone?.evidenceRefs as string[]).includes('approval:risk:save-current-file:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed'));
  assert.doesNotMatch(JSON.stringify(confirmedEvents), /rawScreenshot|providerPayload|data:image|base64|product-ready/i);
});

test('Computer Use native route blocks confirmed VSCode bulk and cross-file requests until Host decomposes them', async () => {
  for (const operation of ['bulk-replace', 'cross-file-modify'] as const) {
    const events = await collectStreamEvents(createComputerUseNativeRouteStream({
      request: vscodeCoWorkRouteRequest({
        commandText: '对我当前打开的 VSCode 文件执行已确认的批量编辑。',
        commandId: `native-route-vscode-cowork-${operation}-confirmed`,
        attemptId: `native-route-vscode-cowork-${operation}-confirmed-attempt-1`,
        vscodeCoWork: {
          requestRef: `chat-request:vscode-cowork:${operation}-confirmed`,
          operation,
          selectedWindowRef: 'window:vscode:paper',
          selectedFileRef: 'file-ref:vscode:paper',
          windowCandidates: [
            vscodeNativeRouteWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
          ],
          latestObservation: vscodeNativeRouteObservation(),
          riskActionHash: `risk:${operation}:file-ref:vscode:paper`,
          confirmationRef: `approval:risk:${operation}:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed`,
        },
      }),
      workspace: '/tmp/workspace',
      provider: 'sciforge-provider',
      model: 'sciforge-model',
      profile: 'host-owned',
    })!);
    const done = events.find((event) => event.type === 'done') as Record<string, unknown> | undefined;
    const unit = (done?.executionUnits as Record<string, unknown>[] | undefined)?.[0];

    assert.equal(done?.status, 'blocked', operation);
    assert.equal(unit?.status, 'blocked', operation);
    assert.equal(unit?.blockedReason, 'vscode_cowork_non_atomic_operation_requires_host_decomposition', operation);
    assert.equal(unit?.primitive, undefined, operation);
    assert.equal(unit?.action, undefined, operation);
    assert.ok((done?.evidenceRefs as string[]).includes(`risk:${operation}:file-ref:vscode:paper`), operation);
    assert.ok((done?.evidenceRefs as string[]).includes(`approval:risk:${operation}:file-ref:vscode:paper:window-action-session:vscode-cowork:1:file-ref:vscode:paper:confirmed`), operation);
    assert.doesNotMatch(JSON.stringify(events), /replacement plan|rawScreenshot|providerPayload|data:image|base64|product-ready/i);
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
