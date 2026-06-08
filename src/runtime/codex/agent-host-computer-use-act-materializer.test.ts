import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';
import type { BrowserHostSessionManager } from '../browser-host-session.js';
import {
  createActorCursor,
  createWindowActionSession,
  enterWindowActionSession,
} from '../window-action-session.js';
import { createInMemoryWindowActionSessionStore } from '../window-action-session-store.js';
import {
  computerUseModelRouterCapabilityIds,
} from '../../../packages/actions/computer-use/provider-policy.js';
import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { CodexAgentHostRuntimeTruth, NormalizedCodexAgentHostInput } from './agent-host-turn-loop.js';

test('default Computer Use Act materializer routes BrowserHostSession through the TS product path', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager(acted),
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Scroll down to inspect visible results.',
        actions: [{ type: 'scroll', direction: 'down', amount: 320 }],
        evidenceRefs: ['action-ledger:planner/default-scroll-down'],
      }),
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-browser-act',
    attemptId: 'codex-command-default-browser-act-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(acted.length, 1);
  assert.equal(acted[0]?.workspacePath, '/tmp/workspace');
  assert.equal(acted[0]?.sessionId, 'verified');
  assert.equal(acted[0]?.input.action, 'scroll');
  assert.equal(acted[0]?.input.deltaY, 320);
  assert.ok(result?.evidenceRefs.includes('adapter-registry:browser-host-session/computer-use'));
  assert.ok(result?.evidenceRefs.includes('browser-host-session:verified/visible-actions/codex-command-default-browser-act-attempt-1.json'));
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|python|gui\.present|ui:|fixture:|replay:/i);
});

test('default Computer Use Act materializer gives planners only the Host-normalized local GUI objective', async () => {
  const plannerCommandTexts: string[] = [];
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager([]),
      actionPlanner: async (input) => {
        plannerCommandTexts.push(input.commandText);
        return {
          status: 'blocked',
          message: 'Planner stopped after inspecting the local objective.',
          actions: [],
          evidenceRefs: ['action-ledger:planner/normalized-intent-probe'],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput({ intentText: 'Scroll the current browser page.' }),
    preflight: readyPreflight(),
    commandText: 'User request: research the whole topic, summarize it, then if the browser is open scroll the current page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-normalized-intent',
    attemptId: 'codex-command-default-normalized-intent-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.deepEqual(plannerCommandTexts, ['Scroll the current browser page.']);
  assert.doesNotMatch(JSON.stringify(result), /research the whole topic|summarize it/i);
});

test('default Computer Use Act materializer requires Act loop when normalized GUI objective has workflow completion semantics', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  const plannerCommandTexts: string[] = [];
  const refreshSteps: number[] = [];
  const workflowObjective = 'Click the writer window, type the final report, save the artifact, open preview, and mark the workflow complete.';
  const materializer = createDefaultComputerUseActMaterializer({
    maxActLoopSteps: 2,
    browser: {
      browserHostSessionManager: browserHostManager(acted),
      actionPlanner: async (input) => {
        plannerCommandTexts.push(input.commandText);
        return {
          status: 'planned',
          message: 'Scroll one grounded local GUI step.',
          actions: [{ type: 'scroll', direction: 'down', amount: 120 }],
          evidenceRefs: [`action-ledger:planner/normalized-workflow-step-${plannerCommandTexts.length}`],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput({ intentText: workflowObjective }),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-normalized-workflow-loop',
    attemptId: 'codex-command-default-normalized-workflow-loop-attempt-1',
    runtimeTruth: runtimeTruth(),
    refreshRuntimeTruth: async ({ step }) => {
      refreshSteps.push(step);
      return runtimeTruth({
        observationRefs: [`browser-host-session:verified/frame-normalized-workflow-step-${step}.png`],
        permissionRefs: [`permission:turn/normalized-workflow-step-${step}`],
      });
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /maxSteps|completion evidence/i);
  assert.equal(acted.length, 2);
  assert.deepEqual(refreshSteps, [1, 2]);
  assert.deepEqual(plannerCommandTexts, [workflowObjective, workflowObjective]);
  assert.ok(result?.evidenceRefs.some((ref) => ref.startsWith('runtime-truth:computer-use-act-loop/')));
});

test('default Computer Use Act materializer projects hard-confirm preflight as needs-confirmation', async () => {
  let plannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager([]),
      actionPlanner: async () => {
        plannerCalls += 1;
        throw new Error('planner must not run before Agent Host approval');
      },
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput({ intentText: 'Submit the visible external form.' }),
    preflight: needsConfirmationPreflight(),
    commandText: 'Please handle this web workflow and submit the external form when ready.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-needs-confirmation',
    attemptId: 'codex-command-default-needs-confirmation-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(plannerCalls, 0);
  assert.equal(result?.status, 'needs-confirmation');
  assert.equal(result?.claimType, 'agent-host-approval-request');
  assert.ok(result?.evidenceRefs.includes('permission:turn/codex-command-default-browser-act/hard-confirm/external-system-submission'));
  assert.ok(result?.artifacts?.some((artifact) => artifact.type === 'agent-host-approval-request'));
  assert.ok(result?.artifacts?.some((artifact) => artifact.type === 'gui-hard-confirm-projection'));
  assert.ok(result?.uiManifest?.some((entry) => entry.type === 'gui-hard-confirm-projection'));
  assert.doesNotMatch(JSON.stringify(result), /handle this web workflow|base64|raw-|\/raw|secret|token|password/i);
});

test('default Computer Use Act materializer emits sanitized structured recovery diagnostics when blocked', async () => {
  let plannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager([]),
      actionPlanner: async () => {
        plannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Planner blocked on generic sanitized recovery path.',
          evidenceRefs: ['action-ledger:planner/recovery-diagnostics-blocked'],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'test',
      intentText: 'Click the projected thing.',
      authorizationProfileId: 'high-autonomy',
      singleTurnOverride: false,
      refs: ['browser-host-session:verified', 'gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'browser-host-session:raw-screenshot'],
      readiness: {},
      target: {},
      observation: {},
      permissions: {},
    },
    preflight: {
      ...readyPreflight(),
      target: { summary: 'Unsafe projected target', refs: ['browser-host-session:verified', 'gui.present:screen-pane', 'fixture:screen'] },
      evidenceRefs: [
        'browser-host-session:verified/frame.png',
        'replay:frame',
        'history:run',
        'permission:turn/codex-command-default-browser-act/ordinary-navigation',
      ],
    },
    commandText: 'Click the projected thing with raw/base64 diagnostic payloads.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-recovery-diagnostics',
    attemptId: 'codex-command-default-recovery-diagnostics-attempt-1',
    runtimeTruth: {
      ...runtimeTruth(),
      target: { bound: true, summary: 'Unsafe projected target', refs: ['browser-host-session:verified', 'gui.present:screen-pane', 'fixture:screen'] },
      observation: { fresh: true, refs: ['browser-host-session:verified/frame.png', 'replay:frame', 'browser-host-session:raw-screenshot'] },
      refs: ['browser-host-session:verified', 'gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'history:run', 'browser-host-session:raw-screenshot'],
    },
  });

  const diagnosticArtifact = result?.artifacts?.find((artifact) => artifact.type === 'computer-use-recovery-diagnostics');
  assert.equal(plannerCalls, 1);
  assert.equal(result?.status, 'blocked');
  assert.ok(diagnosticArtifact, 'structured recovery diagnostics artifact is present');
  assert.equal((diagnosticArtifact?.data as Record<string, unknown> | undefined)?.schemaVersion, 'sciforge.computer-use.recovery-diagnostics.v1');
  assert.ok(result?.claims?.some((claim) => claim.type === 'recovery-diagnostic'));
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|history:|base64|raw-|\/raw|secret|token|password/i);
});

test('default Computer Use Act materializer host-port contract binds model-required ports to Model Router capabilities', async () => {
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager([]),
      actionPlanner: async () => ({
        status: 'blocked',
        message: 'Planner blocked to expose boundary artifacts.',
        actions: [],
        evidenceRefs: ['action-ledger:planner/host-port-truthfulness'],
      }),
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-host-port-contract',
    attemptId: 'codex-command-default-host-port-contract-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  const contractArtifact = result?.artifacts?.find((artifact) => artifact.type === 'computer-use-host-port-contract');
  const contract = ((contractArtifact?.data as Record<string, unknown> | undefined)?.contract ?? {}) as Record<string, {
    owner?: string;
    route?: string;
    directProvider?: boolean;
  }>;

  assert.equal(result?.status, 'blocked');
  assert.ok(contractArtifact, 'host-port contract artifact is present');
  assert.equal(contract.plan?.owner, 'model-router');
  assert.equal(contract.plan?.route, computerUseModelRouterCapabilityIds.computerUsePlanner);
  assert.equal(contract.locate?.owner, 'model-router');
  assert.equal(contract.locate?.route, computerUseModelRouterCapabilityIds.groundingTranslator);
  assert.equal(contract.verify?.owner, 'model-router');
  assert.equal(contract.verify?.route, computerUseModelRouterCapabilityIds.verifierTranslator);
  assert.equal(contract.plan?.directProvider, false);
  assert.equal(contract.locate?.directProvider, false);
  assert.equal(contract.verify?.directProvider, false);
});

test('default Computer Use Act materializer routes WindowActionSession through the TS product path', async () => {
  const calls: Array<{ adapter: string; action: unknown; delta: unknown }> = [];
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Scroll the active desktop window.',
        nextAction: { type: 'scroll', direction: 'down', amount: 180 },
        evidenceRefs: ['action-ledger:planner/default-window-scroll'],
      }),
      adapterHandlers: {
        'app-native-command': async ({ route, input }) => {
          calls.push({ adapter: route.adapter, action: input.action, delta: input.delta });
          const actionId = String(input.actionId ?? 'missing-action-id');
          return {
            status: 'completed',
            evidenceRefs: [
              { kind: 'executor-event', ref: `app-native-command:vscode/scroll/${actionId}/executor-event` },
              { kind: 'verification', ref: `window-action-session:vscode-main/actions/${actionId}/verification/verifier.json` },
              { kind: 'freshness-invalidation', ref: `window-action-session:vscode-main/actions/${actionId}/freshness-invalidation.json` },
            ],
            inputEventRefs: [{ kind: 'input-event', ref: `app-native-command:vscode/actions/${actionId}/scroll/input-event` }],
            afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-frame' }],
          };
        },
      },
      now: () => new Date('2026-06-03T00:00:00.000Z'),
    },
  });

  const result = await materializer({
    agentHostInput: windowActionAgentHostInput(),
    preflight: windowActionPreflight(),
    commandText: 'Scroll the active desktop window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-window-action',
    attemptId: 'codex-command-default-window-action-attempt-1',
    runtimeTruth: windowActionRuntimeTruth(),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.deepEqual(calls, [{ adapter: 'app-native-command', action: 'scroll', delta: { y: 180 } }]);
  assert.ok(result?.evidenceRefs.includes('adapter-registry:window-action-session/app-native-command/computer-use'));
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/action-state/codex-command-default-window-action-attempt-1'));
  assert.ok(result?.evidenceRefs.includes('computer-use:primitive-trace/vscode-main/actions/codex-command-default-window-action-attempt-1'));
  assert.ok(result?.evidenceRefs.includes('app-native-command:vscode/actions/codex-command-default-window-action-attempt-1/scroll/input-event'));
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/evidence/after-frame'));
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/actions/codex-command-default-window-action-attempt-1/verification/verifier.json'));
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/actions/codex-command-default-window-action-attempt-1/freshness-invalidation.json'));
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|python|gui\.present|ui:|fixture:|replay:/i);
});

test('default Computer Use Act materializer produces a current VSCode co-work observe decision from Host refs', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Generic WindowAction planner must not handle current VSCode co-work decisions.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-cowork-fallback'],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: vscodeCoWorkAgentHostInput(),
    preflight: vscodeCoWorkPreflight(),
    commandText: '读取我当前打开的 VSCode 可见文本。',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-cowork',
    attemptId: 'codex-command-default-vscode-cowork-attempt-1',
    runtimeTruth: vscodeCoWorkRuntimeTruth(),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'computer-use-vscode-cowork-observe-decision');
  assert.equal(result?.completionTruth?.scope, 'action');
  assert.equal(result?.completionTruth?.status, 'satisfied');
  assert.ok(result?.evidenceRefs.includes('chat-request:vscode-cowork:agent-host-producer'));
  assert.ok(result?.evidenceRefs.includes('window:vscode:paper'));
  assert.ok(result?.evidenceRefs.includes('observation:vscode:current'));
  assert.ok(result?.evidenceRefs.includes('text:vscode:visible'));
  assert.ok(result?.evidenceRefs.includes('element:vscode:editor'));
  assert.ok(result?.executionUnits?.some((unit) =>
    unit.tool === 'vscode-cowork.agent-host-producer' && unit.primitive === 'observe'
  ));
  assert.match(result?.reasoningTrace ?? '', /Host.*observe refs.*primitive/i);
  assert.doesNotMatch(JSON.stringify(result), /raw-|\/raw|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile|Generic WindowAction planner/i);
});

test('default Computer Use Act materializer preserves first-step WindowAction evidence when workflow loop needs runtime truth refresh', async () => {
  const materializer = createDefaultComputerUseActMaterializer({
    maxActLoopSteps: 2,
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Scroll the active desktop window as the first workflow step.',
        nextAction: { type: 'scroll', direction: 'down', amount: 180 },
        evidenceRefs: ['action-ledger:planner/default-window-workflow-scroll'],
      }),
      adapterHandlers: {
        'app-native-command': async ({ input }) => {
          const actionId = String(input.actionId ?? 'missing-action-id');
          return {
            status: 'completed',
            evidenceRefs: [
              { kind: 'executor-event', ref: `app-native-command:vscode/scroll/${actionId}/executor-event` },
              { kind: 'verification', ref: `window-action-session:vscode-main/actions/${actionId}/verification/verifier.json` },
              { kind: 'freshness-invalidation', ref: `window-action-session:vscode-main/actions/${actionId}/freshness-invalidation.json` },
            ],
            inputEventRefs: [{ kind: 'input-event', ref: `app-native-command:vscode/actions/${actionId}/scroll/input-event` }],
            afterEvidenceRefs: [{ kind: 'screenshot', ref: `window-action-session:vscode-main/evidence/${actionId}/after-frame` }],
          };
        },
      },
      now: () => new Date('2026-06-03T00:00:00.000Z'),
    },
  });

  const result = await materializer({
    agentHostInput: {
      ...windowActionAgentHostInput(),
      intentText: 'Scroll the active desktop window, then finish the multi-step desktop workflow and mark the workflow complete.',
    },
    preflight: windowActionPreflight(),
    commandText: 'Scroll the active desktop window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-window-workflow-loop',
    attemptId: 'codex-command-default-window-workflow-loop-attempt-1',
    runtimeTruth: windowActionRuntimeTruth(),
  });

  const actionId = 'codex-command-default-window-workflow-loop-attempt-1-act-loop-step-1';
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /refreshRuntimeTruth/i);
  assert.ok(result?.evidenceRefs.includes(`window-action-session:vscode-main/action-state/${actionId}`), 'includes action-state ref');
  assert.ok(result?.evidenceRefs.includes(`app-native-command:vscode/actions/${actionId}/scroll/input-event`), 'includes input event ref');
  assert.ok(result?.evidenceRefs.includes(`window-action-session:vscode-main/evidence/${actionId}/after-frame`), 'includes after evidence ref');
  assert.ok(result?.evidenceRefs.includes(`window-action-session:vscode-main/actions/${actionId}/verification/verifier.json`), 'includes verifier ref');
  assert.ok(result?.evidenceRefs.includes(`window-action-session:vscode-main/actions/${actionId}/freshness-invalidation.json`), 'includes freshness invalidation ref');
  assert.ok(result?.evidenceRefs.includes('input-lease:window-action-session/vscode-main'), 'includes released input lease ref');
  assert.ok(result?.evidenceRefs.includes('scoped-input-adapter:vscode-main/computer-use/app-native-command'), 'includes released input adapter ref');
  assert.ok(result?.evidenceRefs.includes('actor-cursor:computer-use/vscode-main'), 'includes released cursor ref');
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|python|gui\.present|ui:|fixture:|replay:|base64|raw-|\/raw|secret|token|password/i);
});

test('default Computer Use Act materializer fails closed instead of falling back to legacy non-TS targets', async () => {
  let plannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager([]),
      actionPlanner: async () => {
        plannerCalls += 1;
        throw new Error('browser planner should not run without a BrowserHostSession target');
      },
    },
  });

  const result = await materializer({
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'test',
      intentText: 'Click the projected thing.',
      authorizationProfileId: 'high-autonomy',
      singleTurnOverride: false,
      refs: ['gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'history:run'],
      readiness: {},
      target: {},
      observation: {},
      permissions: {},
    },
    preflight: {
      ...readyPreflight(),
      target: { summary: 'Unsafe projected target', refs: ['gui.present:screen-pane', 'fixture:screen'] },
      evidenceRefs: ['replay:frame', 'history:run'],
    },
    commandText: 'Click the projected thing.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-unsafe-target',
    attemptId: 'codex-command-default-unsafe-target-attempt-1',
    runtimeTruth: {
      ...runtimeTruth(),
      target: { bound: true, summary: 'Unsafe projected target', refs: ['gui.present:screen-pane', 'fixture:screen'] },
      observation: { fresh: true, refs: ['replay:frame'] },
      refs: ['gui.present:screen-pane', 'fixture:screen', 'replay:frame', 'history:run'],
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(plannerCalls, 0);
  assert.match(result?.message ?? '', /TS-only.*BrowserHostSession.*WindowActionSession/i);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:computer-use-act-materializer/ts-product-target-missing'));
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|python|gui\.present|ui:|fixture:|replay:|history:/i);
});

test('default Computer Use Act materializer blocks legacy VirtualAppScreen/native-host refs as non-product targets', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  const materializer = createDefaultComputerUseActMaterializer({
    browser: {
      browserHostSessionManager: browserHostManager(acted),
      actionPlanner: async () => {
        throw new Error('browser planner should not run for legacy native-host refs');
      },
    },
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        throw new Error('window-action planner should not run for legacy native-host refs');
      },
    },
  });

  const result = await materializer({
    agentHostInput: {
      schemaVersion: 'sciforge.codex-agent-host-input.v1',
      source: 'test',
      intentText: 'Click the legacy projected window.',
      authorizationProfileId: 'high-autonomy',
      singleTurnOverride: false,
      refs: [
        'computer-use:native-host/sessions/legacy-session/session.json',
        'computer-use:provider-session/legacy-session/owner.json',
      ],
      readiness: {},
      target: {},
      observation: {},
      permissions: {},
    },
    preflight: {
      ...readyPreflight(),
      target: {
        summary: 'Legacy native-host target',
        refs: ['computer-use:native-host/sessions/legacy-session/session.json'],
      },
      evidenceRefs: ['computer-use:provider-session/legacy-session/owner.json'],
    },
    commandText: 'Click the legacy projected window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-legacy-target',
    attemptId: 'codex-command-default-legacy-target-attempt-1',
    runtimeTruth: {
      ...runtimeTruth(),
      target: {
        bound: true,
        summary: 'Legacy native-host target',
        refs: ['computer-use:native-host/sessions/legacy-session/session.json'],
      },
      observation: {
        fresh: true,
        refs: ['computer-use:provider-session/legacy-session/owner.json'],
      },
      refs: [
        'computer-use:native-host/sessions/legacy-session/session.json',
        'computer-use:provider-session/legacy-session/owner.json',
        'permission:turn/legacy-native-host/ordinary-navigation',
      ],
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted.length, 0);
  assert.match(result?.message ?? '', /TS-only.*BrowserHostSession.*WindowActionSession/i);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:computer-use-act-materializer/ts-product-target-missing'));
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|native-host\/sessions|provider-session|python/i);
});

test('default Computer Use Act materializer runs workflow Act loop only through BrowserHostSession TS evidence', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  let plannerCalls = 0;
  const refreshSteps: number[] = [];
  const materializer = createDefaultComputerUseActMaterializer({
    maxActLoopSteps: 2,
    browser: {
      browserHostSessionManager: browserHostManager(acted),
      actionPlanner: async () => {
        plannerCalls += 1;
        return {
          status: 'planned',
          message: 'Scroll one grounded workflow step.',
          actions: [{ type: 'scroll', direction: 'down', amount: 120 }],
          evidenceRefs: [`action-ledger:planner/browser-workflow-step-${plannerCalls}`],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Click the first browser panel, type notes into the editor, press save, open the preview, and mark the workflow complete.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-browser-workflow-loop',
    attemptId: 'codex-command-default-browser-workflow-loop-attempt-1',
    runtimeTruth: runtimeTruth(),
    refreshRuntimeTruth: async ({ step }) => {
      refreshSteps.push(step);
      return runtimeTruth({
        observationRefs: [`browser-host-session:verified/frame-step-${step}.png`],
        permissionRefs: [`permission:turn/browser-workflow-step-${step}`],
      });
    },
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /maxSteps|completion evidence/i);
  assert.equal(plannerCalls, 2);
  assert.equal(acted.length, 2);
  assert.deepEqual(refreshSteps, [1, 2]);
  assert.ok(result?.evidenceRefs.includes('permission:turn/browser-workflow-step-2'));
  assert.ok(result?.evidenceRefs.some((ref) => ref.startsWith('runtime-truth:computer-use-act-loop/')));
  assert.doesNotMatch(JSON.stringify(result), /VirtualAppScreen|virtual-app-screen|python|gui\.present|ui:|fixture:|replay:|history:/i);
});

function browserHostManager(
  acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }>,
): BrowserHostSessionManager {
  return {
    async sessionState(_workspacePath: string, sessionId: string) {
      return browserHostSessionState(sessionId);
    },
    async act(workspacePath: string, sessionId: string, input: Record<string, unknown>) {
      acted.push({ workspacePath, sessionId, input });
      return browserHostSessionState(sessionId, {
        actionId: String(input.actionId ?? 'action'),
        action: String(input.action ?? 'state'),
        frameRef: `browser-host-session:${sessionId}/frame-after.png`,
        screenshotRef: `browser-host-session:${sessionId}/screenshot-after.png`,
      });
    },
  } as unknown as BrowserHostSessionManager;
}

function browserHostSessionState(
  sessionId: string,
  action?: {
    actionId: string;
    action: string;
    frameRef: string;
    screenshotRef: string;
  },
) {
  return {
    id: sessionId,
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    workspacePath: '/tmp/workspace',
    requestedUrl: 'https://runtime-owned.example/current',
    url: 'https://runtime-owned.example/current',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: `browser-host-session:${sessionId}/live-surface.json`,
    frameRef: action?.frameRef ?? `browser-host-session:${sessionId}/frame-before.png`,
    screenshotRef: action?.screenshotRef ?? `browser-host-session:${sessionId}/screenshot-before.png`,
    diagnostics: [],
    ...(action ? {
      visibleAction: {
        actionId: action.actionId,
        action: action.action,
        riskType: 'scroll',
        visibleActionRef: `browser-host-session:${sessionId}/visible-actions/${action.actionId}.json`,
      },
      actorCursor: browserActorCursor(sessionId, action.actionId, action.action),
    } : {}),
  };
}

function browserActorCursor(sessionId: string, actionId: string, action: string) {
  const evidenceRefs = [
    `browser-host-session:${sessionId}/actions/${actionId}/verification/verifier.json`,
    `browser-host-session:${sessionId}/actions/${actionId}/freshness-invalidation.json`,
  ];
  return {
    agentId: 'agent-runtime-1',
    cursorId: `cursor-${actionId}`,
    color: '#28a0f0',
    label: 'Runtime worker',
    status: 'acting',
    target: {
      type: 'browser-pane',
      sessionId,
      windowRef: `window:browser:${sessionId}`,
    },
    lastAction: {
      action: action === 'type' ? 'type' : action === 'click' ? 'click' : action === 'scroll' ? 'scroll' : 'observe',
      status: 'completed',
      evidenceRefs,
    },
    evidenceRefs,
  };
}

function readyAgentHostInput(options: {
  intentText?: string;
} = {}): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: options.intentText ?? 'Scroll the current browser page.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: ['browser-host-session:verified', 'window-action-session:browser-host-session/verified'],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function needsConfirmationPreflight(): ComputerUsePreflightResult {
  return {
    ...readyPreflight(),
    status: 'needs-confirmation',
    risk: {
      decision: 'needs-confirmation',
      category: 'external-system-submission',
      hardConfirm: true,
      reason: 'submitting forms that affect external systems requires hard confirmation',
    },
    evidenceRefs: [
      'browser-host-session:verified/frame.png',
      'permission:turn/codex-command-default-browser-act/hard-confirm/external-system-submission',
    ],
    confirmation: {
      action: 'Submit the visible external form.',
      target: 'Verified browser page',
      impact: 'submitting forms that affect external systems requires hard confirmation',
      evidenceRefs: [
        'browser-host-session:verified/frame.png',
        'permission:turn/codex-command-default-browser-act/hard-confirm/external-system-submission',
      ],
      authorizationProfile: readyPreflight().authorizationProfile,
      controls: ['Confirm', 'Cancel'],
    },
  };
}

function readyWindowActionStore() {
  const now = '2026-06-03T00:00:00.000Z';
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

function windowActionAgentHostInput(): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Scroll the active desktop window.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: ['window-action-session:vscode-main'],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function windowActionPreflight(): ComputerUsePreflightResult {
  return {
    ...readyPreflight(),
    target: {
      summary: 'Verified active desktop window',
      refs: ['window-action-session:vscode-main'],
    },
    evidenceRefs: [
      'window-action-session:vscode-main/evidence/before-frame',
      'permission:turn/codex-command-default-window-action/ordinary-navigation',
    ],
  };
}

function windowActionRuntimeTruth(): CodexAgentHostRuntimeTruth {
  return {
    ...runtimeTruth({
      observationRefs: windowActionObservationRefs(),
      permissionRefs: ['permission:turn/codex-command-default-window-action/ordinary-navigation'],
      scopedExecutorRefs: ['window-action-session:vscode-main/executor-scope'],
    }),
    target: {
      bound: true,
      summary: 'Verified active desktop window',
      refs: ['window-action-session:vscode-main'],
    },
    refs: [
      'window-action-session:vscode-main',
      'adapter-registry:sciforge.window-action-session.computer-use-adapter',
      'runtime-truth:computer-use-adapter/window-action-session/vscode-main',
      'cancel:runtime-turn/codex-command-default-window-action',
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

function vscodeCoWorkAgentHostInput(): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: '读取我当前打开的 VSCode 可见文本。',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: [
      'intent:current-vscode-cowork',
      'chat-request:vscode-cowork:agent-host-producer',
    ],
    readiness: {},
    target: {
      kind: 'current-vscode-cowork',
      refs: vscodeCoWorkTargetRefs(),
    },
    observation: {
      fresh: true,
      refs: vscodeCoWorkObservationRefs(),
    },
    permissions: {
      refs: [
        'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:1:file-ref:vscode:paper',
      ],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function vscodeCoWorkPreflight(): ComputerUsePreflightResult {
  return {
    ...readyPreflight(),
    target: {
      summary: 'Current VSCode co-work window',
      refs: vscodeCoWorkTargetRefs(),
    },
    evidenceRefs: [
      ...vscodeCoWorkObservationRefs(),
      'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:1:file-ref:vscode:paper',
    ],
  };
}

function vscodeCoWorkRuntimeTruth(): CodexAgentHostRuntimeTruth {
  return {
    ...runtimeTruth({
      observationRefs: vscodeCoWorkObservationRefs(),
      permissionRefs: [
        'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:1:file-ref:vscode:paper',
      ],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
    }),
    target: {
      bound: true,
      summary: 'Current VSCode co-work window',
      refs: vscodeCoWorkTargetRefs(),
    },
    observation: {
      fresh: true,
      refs: vscodeCoWorkObservationRefs(),
      observedAt: '2026-06-03T00:00:00.000Z',
      capturedAt: '2026-06-03T00:00:00.000Z',
      freshnessCheckedAt: '2026-06-03T00:00:00.000Z',
      freshnessCheck: {
        status: 'current',
        observedAt: '2026-06-03T00:00:00.000Z',
        checkedAt: '2026-06-03T00:00:00.000Z',
        maxAgeMs: 30_000,
      },
    },
    refs: [
      'intent:current-vscode-cowork',
      'chat-request:vscode-cowork:agent-host-producer',
      ...vscodeCoWorkTargetRefs(),
      ...vscodeCoWorkObservationRefs(),
      'permission:current-vscode-cowork:full-access:window-action-session:vscode-cowork:1:file-ref:vscode:paper',
      'computer-use:executor-scope:current-vscode',
      'cancel:runtime-turn/codex-command-default-vscode-cowork',
    ],
  };
}

function vscodeCoWorkTargetRefs(): string[] {
  return [
    'macos-app:com.microsoft.VSCode',
    'process:vscode:paper',
    'window:vscode:paper',
    'text:title:paper',
    'frontmost:vscode:paper',
    'file-ref:vscode:paper',
    'window-action-session:vscode-cowork:1',
  ];
}

function vscodeCoWorkObservationRefs(): string[] {
  return [
    'window-action-session:vscode-cowork:1',
    'window:vscode:paper',
    'observation:vscode:current',
    'image:vscode:current',
    'accessibility:vscode:current',
    'text:vscode:visible',
    'element:vscode:editor',
    'freshness:vscode:current',
    'file-ref:vscode:paper',
  ];
}

function readyPreflight(): ComputerUsePreflightResult {
  return {
    schemaVersion: 'sciforge.computer-use.preflight.v1',
    status: 'ready',
    authorizationProfile: {
      schemaVersion: 'sciforge.authorization-profile.v1',
      id: 'high-autonomy',
      publicLabel: 'High Autonomy',
      scope: { user: 'current-user', workspace: 'current-workspace' },
      defaultAutoScope: ['observe'],
      hardConfirmCategories: [],
      blockedCategories: [],
    },
    target: {
      summary: 'Verified browser page',
      refs: ['browser-host-session:verified', 'window-action-session:browser-host-session/verified'],
    },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    evidenceRefs: ['browser-host-session:verified/frame.png', 'permission:turn/codex-command-default-browser-act/ordinary-navigation'],
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}

function runtimeTruth(options: {
  observationRefs?: string[];
  permissionRefs?: string[];
  scopedExecutorRefs?: string[];
} = {}): CodexAgentHostRuntimeTruth {
  const observationRefs = options.observationRefs ?? ['browser-host-session:verified/frame.png'];
  const permissionRefs = options.permissionRefs ?? ['permission:turn/codex-command-default-browser-act/ordinary-navigation'];
  const scopedExecutorRefs = options.scopedExecutorRefs ?? ['computer-use:executor-scope:browser-host-session/verified'];
  const observedAt = '2026-06-03T00:00:00.000Z';
  const observation = {
    fresh: true,
    refs: observationRefs,
    observedAt,
    capturedAt: observedAt,
    freshnessCheckedAt: observedAt,
    freshnessCheck: {
      status: 'current',
      observedAt,
      checkedAt: observedAt,
      maxAgeMs: 30_000,
    },
  } as CodexAgentHostRuntimeTruth['observation'];
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
      summary: 'Verified browser page',
      refs: ['browser-host-session:verified', 'window-action-session:browser-host-session/verified'],
    },
    observation,
    permissions: {
      refs: permissionRefs,
      scopedExecutorRefs,
      stopCancelPath: true,
    },
    refs: [
      'browser-host-session:verified',
      'window-action-session:browser-host-session/verified',
      'adapter-registry:browser-host-session/computer-use',
      'browser-host-session:verified/stop',
      'cancel:runtime-turn/codex-command-default-browser-act',
      ...observationRefs,
      ...permissionRefs,
      ...scopedExecutorRefs,
    ],
  };
}
