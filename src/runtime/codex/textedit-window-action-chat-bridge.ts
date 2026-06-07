import { isAbsolute } from 'node:path';

import {
  createActorCursor,
  createWindowActionSession,
  enterWindowActionSession,
} from '../window-action-session.js';
import {
  createInMemoryWindowActionSessionStore,
} from '../window-action-session-store.js';
import type {
  CodexAgentHostComputerUseActMaterializer,
  CodexAgentHostRuntimeTruth,
} from './agent-host-turn-loop.js';
import {
  createDefaultComputerUseActMaterializer,
} from './agent-host-computer-use-act-materializer.js';
import type {
  AppiumMac2WindowActionClient,
} from './appium-mac2-window-action-adapter.js';

export interface TextEditWindowActionChatBridgeInput {
  commandText: string;
  workspacePath: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  appiumMac2Client?: AppiumMac2WindowActionClient;
}

export interface TextEditWindowActionChatBridge {
  sessionRef: string;
  runtimeTruth: CodexAgentHostRuntimeTruth;
  computerUseActMaterializer: CodexAgentHostComputerUseActMaterializer;
}

const SESSION_ID = 'textedit-local-save';
const SESSION_REF = `window-action-session:${SESSION_ID}`;
const WINDOW_REF = 'window:textedit:local-save';
const SCREEN_ID = 'macos-main-screen';

export function createTextEditWindowActionChatBridge(
  input: TextEditWindowActionChatBridgeInput,
): TextEditWindowActionChatBridge | undefined {
  const env = input.env ?? process.env;
  const artifactPath = validTextEditArtifactPath(env.SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH);
  if (!appiumMac2GatesReady(env) || !artifactPath) return undefined;
  if (!isTextEditLocalSaveTask(input.commandText)) return undefined;

  const now = input.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const beforeRefs = [
    `${SESSION_REF}/evidence/before-frame`,
    `accessibility-ui-automation:${SESSION_ID}/state-snapshot-before`,
    `accessibility-ui-automation:${SESSION_ID}/text-before`,
    `desktop-window:${SESSION_ID}`,
  ];
  const observationExpiresAt = new Date(Date.parse(timestamp) + 30_000).toISOString();
  const permissionRef = 'permission:turn/textedit-window-action/local-save';
  const scopedExecutorRef = 'computer-use:executor-scope/textedit-window-action/appium-mac2';
  const cancelRef = 'cancel:runtime-turn/textedit-window-action/local-save';
  const adapterRef = 'adapter-registry:window-action-session/appium-mac2/computer-use';
  const appiumReadinessRef = 'runtime-truth:textedit-window-action-chat-bridge/appium-mac2-ready';

  const store = createInMemoryWindowActionSessionStore({ now });
  const session = enterWindowActionSession(createWindowActionSession({
    id: SESSION_ID,
    windowRef: WINDOW_REF,
    app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
    screenId: SCREEN_ID,
    timestamp,
    evidenceRefs: [
      { kind: 'window-action-session', ref: SESSION_REF },
      { kind: 'target-binding', ref: 'window-action-session:textedit-local-save/target-binding' },
      { kind: 'appium-mac2-readiness', ref: appiumReadinessRef },
    ],
  }), createActorCursor({
    agentId: 'ordinary-chat',
    cursorId: 'textedit-window-action',
    color: '#28a0f0',
    label: 'Ordinary chat',
  }), {
    timestamp,
    actorCursorRef: 'actor-cursor:ordinary-chat/textedit-window-action',
  });

  store.upsert(session, {
    refs: [
      'action-ledger:window-action-session/textedit-local-save/upsert',
      appiumReadinessRef,
      adapterRef,
    ],
    targetRefs: [
      SESSION_REF,
      'window-action-session:textedit-local-save/target-binding',
    ],
    observationRefs: beforeRefs,
    timestamp,
  });

  const runtimeTruth: CodexAgentHostRuntimeTruth = {
    schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
    source: 'textedit-window-action-chat-bridge',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'TextEdit local save WindowActionSession',
      refs: [
        SESSION_REF,
        'window-action-session:textedit-local-save/target-binding',
      ],
    },
    observation: {
      fresh: true,
      refs: beforeRefs,
      observedAt: timestamp,
      capturedAt: timestamp,
      freshnessCheckedAt: timestamp,
      freshnessCheck: {
        status: 'current',
        observedAt: timestamp,
        checkedAt: timestamp,
        expiresAt: observationExpiresAt,
        maxAgeMs: 30_000,
      },
    } as CodexAgentHostRuntimeTruth['observation'],
    permissions: {
      refs: [permissionRef],
      scopedExecutorRefs: [scopedExecutorRef],
      stopCancelPath: true,
      controlPath: {
        ready: true,
        takeoverRefs: ['lease:human-takeover/textedit-window-action'],
        pauseRefs: ['lease:human-takeover/textedit-window-action/pause'],
        resumeRefs: ['lease:human-takeover/textedit-window-action/resume'],
        stopRefs: ['stop:runtime-turn/textedit-window-action/local-save'],
        cancelRefs: [cancelRef],
      },
    },
    adapter: {
      providerId: 'appium-mac2',
      refs: [adapterRef],
      capabilityRefs: [appiumReadinessRef],
      inputIsolation: {
        mode: 'target-bound-window-action-session',
        refsOnly: true,
        sharedSystemInput: false,
        requiresFocusLease: true,
        singleInteractiveTruth: true,
        secondTruthSource: false,
        refs: [adapterRef],
      },
    },
    refs: [
      SESSION_REF,
      appiumReadinessRef,
      ...beforeRefs,
      permissionRef,
      scopedExecutorRef,
      cancelRef,
      adapterRef,
    ],
  };

  return {
    sessionRef: SESSION_REF,
    runtimeTruth,
    computerUseActMaterializer: createDefaultComputerUseActMaterializer({
      env,
      windowAction: {
        env,
        windowActionSessionStore: store,
        appiumMac2Client: input.appiumMac2Client,
        now,
        actionPlanner: async () => ({
          status: 'planned',
          message: 'Save the visible TextEdit document through the scoped WindowActionSession Appium Mac2 adapter.',
          nextAction: { type: 'save', targetPath: artifactPath },
          evidenceRefs: ['action-ledger:planner/textedit-window-action/local-save'],
        }),
      },
    }),
  };
}

function appiumMac2GatesReady(env: NodeJS.ProcessEnv): boolean {
  return truthyEnv(env.SCIFORGE_WINDOW_ACTION_APPIUM_MAC2)
    && truthyEnv(env.SCIFORGE_APPIUM_MAC2_EXECUTOR)
    && loopbackHttpUrl(env.SCIFORGE_APPIUM_MAC2_SERVER_URL);
}

function isTextEditLocalSaveTask(commandText: string): boolean {
  return /\bTextEdit\b/i.test(commandText)
    && /\b(?:save|press\s+save|write\s+.*\bto\b|保存)\b/i.test(commandText)
    && /\b(?:window|visible|document|local|本地|窗口|文档)\b/i.test(commandText)
    && !/https?:\/\//i.test(commandText);
}

function validTextEditArtifactPath(value: string | undefined): string | undefined {
  if (!value || value.length > 240 || !isAbsolute(value)) return undefined;
  if (/[\u0000-\u001f]|https?:\/\/|secret|token|password|api[-_]?key|bearer/i.test(value)) return undefined;
  return value;
}

function truthyEnv(value: string | undefined): boolean {
  return /^(?:1|true|yes|on|enabled)$/i.test(value?.trim() ?? '');
}

function loopbackHttpUrl(value: string | undefined): boolean {
  if (!value || value.length > 240) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
