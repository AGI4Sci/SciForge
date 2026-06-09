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
import type { ComputerUseAppModule } from './computer-use-app-module-registry.js';
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

test('default Computer Use Act materializer selects a VSCode app module primitive candidate from Host operation refs', async () => {
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
    agentHostInput: vscodeAppModuleAgentHostInput('read-visible-text'),
    preflight: vscodeAppModulePreflight(),
    commandText: 'This text must not be parsed to decide the VSCode operation.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-app-module',
    attemptId: 'codex-command-default-vscode-app-module-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.equal(result?.completionTruth, undefined);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:computer-use-app-module/vscode/read-visible-text'));
  assert.ok(result?.evidenceRefs.includes('window:vscode:paper'));
  assert.ok(result?.evidenceRefs.includes('observation:vscode:current'));
  assert.ok(result?.evidenceRefs.includes('element:vscode:editor:monaco:1'));
  assert.ok(result?.executionUnits?.some((unit) =>
    unit.tool === 'computer-use.app-module-registry'
      && unit.moduleId === 'vscode'
      && unit.operation === 'read-visible-text'
      && unit.primitive === 'computer_use.observe'
      && unit.status === 'candidate'
  ));
  assert.ok(result?.artifacts?.some((artifact) =>
    artifact.type === 'computer-use-app-module-readiness'
      && (artifact.data as Record<string, unknown> | undefined)?.moduleId === 'vscode'
  ));
  assert.match(result?.reasoningTrace ?? '', /Host.*operation.*refs.*primitive candidate/i);
  assert.doesNotMatch(JSON.stringify(result), /raw-|\/raw|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile|Generic WindowAction planner|taskOutcome":"satisfied/i);
});

test('default Computer Use Act materializer selects command palette primitives only from structured Host operation refs', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Generic WindowAction planner must not infer command palette operations.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-palette-fallback'],
        };
      },
    },
  });
  const paletteRefs = [
    'command-palette:vscode:paper:current',
    'command-palette-items:vscode:paper:obs-current',
    'command-palette-item:vscode:paper:obs-current:rank-1',
    'command-palette-item-rank:vscode:paper:obs-current:rank-1',
    'command-palette-item-hash:vscode:paper:obs-current:sha256:abc123',
    'terminal-output:vscode:paper:current',
    'action:vscode:previous:completed',
  ];

  const structured = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('select-command-palette-item', paletteRefs),
    preflight: vscodeAppModulePreflight(paletteRefs),
    commandText: 'Palette output says Save File is selected; this text must not decide the command.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-palette-candidate',
    attemptId: 'codex-command-default-vscode-palette-candidate-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(paletteRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(structured?.status, 'completed', structured?.message);
  assert.equal(structured?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.equal(structured?.completionTruth, undefined);
  assert.ok(structured?.executionUnits?.some((unit) =>
    unit.tool === 'computer-use.app-module-registry'
      && unit.moduleId === 'vscode'
      && unit.operation === 'select-command-palette-item'
      && unit.primitive === 'computer_use.act'
      && unit.status === 'candidate'
  ));
  const structuredSerialized = JSON.stringify(structured);
  assert.match(structuredSerialized, /verifier:vscode-app-module:palette-current-observation:paper-obs-current/);
  assert.match(structuredSerialized, /verifier:vscode-app-module:palette-same-item:paper-obs-current-rank-1/);
  assert.doesNotMatch(structuredSerialized, /Save File|workbench|command-id|completionTruth|taskOutcome":"satisfied|Generic WindowAction planner/i);

  const inferred = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput(undefined, paletteRefs),
    preflight: vscodeAppModulePreflight(paletteRefs),
    commandText: 'Use the command palette item to save the file.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-palette-no-operation',
    attemptId: 'codex-command-default-vscode-palette-no-operation-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(paletteRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(inferred?.status, 'blocked');
  assert.equal(inferred?.claimType, 'computer-use-app-module-blocked');
  assert.ok(inferred?.evidenceRefs.includes('blocked:computer-use-app-module:operation-ref-required'));
  assert.equal(inferred?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(inferred), /select-command-palette-item.*candidate|taskOutcome":"satisfied|Generic WindowAction planner/i);
});

test('default Computer Use Act materializer selects editor scope only from structured Host operation refs', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Generic WindowAction planner must not infer editor scope operations.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-editor-scope-fallback'],
        };
      },
    },
  });
  const scopeRefs = [
    'editor-group:vscode:paper:1',
    'active-editor:vscode:paper:1',
    'selection-ref:vscode:paper:1',
    'cursor-ref:vscode:paper:1',
    'range-ref:vscode:paper:1',
    'terminal-output:vscode:paper:current',
    'action:vscode:previous:completed',
    'history:vscode:previous-run',
  ];

  const structured = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('editor-scope', scopeRefs),
    preflight: vscodeAppModulePreflight(scopeRefs),
    commandText: 'Polish the current selected text in /Users/example/private-paper.md; this text must not decide scope.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-editor-scope-candidate',
    attemptId: 'codex-command-default-vscode-editor-scope-candidate-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(scopeRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(structured?.status, 'completed', structured?.message);
  assert.equal(structured?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.equal(structured?.completionTruth, undefined);
  assert.ok(structured?.executionUnits?.some((unit) =>
    unit.tool === 'computer-use.app-module-registry'
      && unit.moduleId === 'vscode'
      && unit.operation === 'editor-scope'
      && unit.primitive === 'computer_use.observe'
      && unit.status === 'candidate'
  ));
  const structuredSerialized = JSON.stringify(structured);
  assert.match(structuredSerialized, /selection-ref:vscode:paper:1/);
  assert.match(structuredSerialized, /cursor-ref:vscode:paper:1/);
  assert.match(structuredSerialized, /range-ref:vscode:paper:1/);
  assert.ok(structured?.evidenceRefs.includes('selection-ref:vscode:paper:1'));
  assert.ok(structured?.evidenceRefs.includes('cursor-ref:vscode:paper:1'));
  assert.ok(structured?.evidenceRefs.includes('range-ref:vscode:paper:1'));
  assert.doesNotMatch(structuredSerialized, /Polish the current selected text|private-paper|\/Users\/|rawSelectedText|providerPayload|data:image|base64|completionTruth|taskOutcome":"satisfied|Generic WindowAction planner/i);

  const inferred = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput(undefined, scopeRefs),
    preflight: vscodeAppModulePreflight(scopeRefs),
    commandText: 'Polish the current selection in VSCode.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-editor-scope-no-operation',
    attemptId: 'codex-command-default-vscode-editor-scope-no-operation-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(scopeRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(inferred?.status, 'blocked');
  assert.equal(inferred?.claimType, 'computer-use-app-module-blocked');
  assert.ok(inferred?.evidenceRefs.includes('blocked:computer-use-app-module:operation-ref-required'));
  assert.equal(inferred?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(inferred), /computer-use-app-module-primitive-candidate|"operation":"editor-scope"|taskOutcome":"satisfied|Generic WindowAction planner/i);
});

test('default Computer Use Act materializer editor-scope public projection keeps only scope refs', async () => {
  const materializer = createDefaultComputerUseActMaterializer();
  const scopeRefs = [
    'editor-group:vscode:paper:1',
    'active-editor:vscode:paper:1',
    'focused-editor:vscode:paper:1',
    'selected-file:vscode:paper',
    'selection-ref:vscode:paper:1',
    'cursor-ref:vscode:paper:1',
    'range-ref:vscode:paper:1',
    'text:vscode:visible:paper',
    'image:vscode:current',
    'accessibility:vscode:current',
    'terminal-output:vscode:paper:current',
    'action:vscode:previous:completed',
    'history:vscode:previous-run',
  ];

  const result = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('editor-scope', scopeRefs),
    preflight: vscodeAppModulePreflight(scopeRefs),
    commandText: 'Read current scope without publishing raw editor context.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-editor-scope-public-projection',
    attemptId: 'codex-command-default-vscode-editor-scope-public-projection-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(scopeRefs),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.match(JSON.stringify(result), /selection-ref:vscode:paper:1/);
  assert.match(JSON.stringify(result), /cursor-ref:vscode:paper:1/);
  assert.match(JSON.stringify(result), /range-ref:vscode:paper:1/);
  assert.match(JSON.stringify(result), /(?:element:vscode:editor:monaco:1|focused-editor:vscode:paper:1)/);
  assert.match(JSON.stringify(result), /selected-file:vscode:paper/);
  assert.doesNotMatch(JSON.stringify(result), /window-action-session:vscode|macos-app:vscode|process:vscode|window:vscode|frontmost:vscode|observation:vscode|operation-ref:|module:vscode-app|capability:vscode|text:vscode:visible|image:vscode|accessibility:vscode|terminal-output:vscode|action:vscode|history:vscode|permission:|computer-use:executor-scope|runtime-truth:computer-use-act-materializer/i);
  assert.doesNotMatch(JSON.stringify(result), /rawSelectedText|selectedText|rawVisibleText|visibleText|providerPayload|data:image|base64|https?:\/\/|\/Users\//i);
});

test('default Computer Use Act materializer returns VSCode preview artifact refs only from structured Host operation refs', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Generic WindowAction planner must not infer VSCode preview operations.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-preview-fallback'],
        };
      },
    },
  });
  const scopeRefs = [
    'focused-editor:vscode:paper:1',
    'selected-file:vscode:paper',
    'selection-ref:vscode:paper:1',
    'cursor-ref:vscode:paper:1',
    'range-ref:vscode:paper:1',
    'text:vscode:visible:private-selected-text',
    'observation:vscode:paper:1',
    'window:vscode:paper',
    'terminal-output:vscode:paper:current',
    'action:vscode:previous:completed',
    'history:vscode:previous-run',
  ];

  const structured = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('preview-current-selection', scopeRefs, {
      draftArtifactRef: 'artifact:vscode-editor-draft:unit-preview-current-selection',
    }),
    preflight: vscodeAppModulePreflight(scopeRefs),
    commandText: 'Polish the current selected text and show a diff; this text must not decide preview.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-preview-current-selection',
    attemptId: 'unit-preview-current-selection',
    runtimeTruth: vscodeAppModuleRuntimeTruth(scopeRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(structured?.status, 'completed', structured?.message);
  assert.equal(structured?.claimType, 'vscode-editor-preview-artifact-refs');
  assert.equal(structured?.completionTruth, undefined);
  assert.ok(structured?.evidenceRefs.includes('artifact:vscode-editor-draft:unit-preview-current-selection'));
  assert.ok(structured?.evidenceRefs.includes('artifact:vscode-editor-preview:unit-preview-current-selection'));
  assert.ok(structured?.evidenceRefs.includes('artifact:vscode-editor-preview-diff:unit-preview-current-selection'));
  assert.ok(structured?.executionUnits?.some((unit) =>
    unit.tool === 'vscode-editor-preview-provider'
      && unit.operation === 'preview-current-selection'
      && unit.primitive === undefined
      && unit.status === 'artifact-preview'
  ));
  assert.ok(structured?.artifacts?.some((artifact) =>
    artifact.type === 'vscode-editor-preview'
      && (artifact.data as Record<string, unknown> | undefined)?.writesUserFile === false
      && (artifact.data as Record<string, unknown> | undefined)?.computerUsePrimitive === false
  ));
  const structuredSerialized = JSON.stringify(structured);
  assert.match(structuredSerialized, /selection-ref:vscode:paper:1/);
  assert.match(structuredSerialized, /artifact:vscode-editor-preview-diff:unit-preview-current-selection/);
  assert.doesNotMatch(structuredSerialized, /private-selected-text|text:vscode:visible|operation-ref:|observation:vscode|window:vscode|terminal-output:vscode|history:vscode|action:vscode|Polish the current selected text|rawSelectedText|selectedText|rawDiff|@@|providerPayload|data:image|base64|https?:\/\/|\/Users\/|replace-selection|insert-draft|Generic WindowAction planner/i);

  const inferred = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput(undefined, [
      ...scopeRefs,
      'artifact:vscode-editor-draft:unit-preview-current-selection',
    ]),
    preflight: vscodeAppModulePreflight(scopeRefs),
    commandText: '润色当前选区并给我 diff preview',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-preview-no-operation',
    attemptId: 'unit-preview-no-operation',
    runtimeTruth: vscodeAppModuleRuntimeTruth(scopeRefs),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(inferred?.status, 'blocked');
  assert.equal(inferred?.claimType, 'computer-use-app-module-blocked');
  assert.ok(inferred?.evidenceRefs.includes('blocked:computer-use-app-module:operation-ref-required'));
  assert.doesNotMatch(JSON.stringify(inferred), /vscode-editor-preview-provider|artifact-preview|preview-current-selection.*completed|Generic WindowAction planner/i);
});

test('default Computer Use Act materializer blocks VSCode app module stale runtime observations', async () => {
  const runtimeTruth = vscodeAppModuleRuntimeTruth();
  runtimeTruth.observation = {
    ...runtimeTruth.observation,
    fresh: false,
    freshnessCheck: {
      ...runtimeTruth.observation?.freshnessCheck,
      status: 'stale',
    },
  };

  const materializer = createDefaultComputerUseActMaterializer();
  const result = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('read-visible-text'),
    preflight: vscodeAppModulePreflight(),
    commandText: 'This stale observation must not produce a primitive candidate.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-app-module-stale',
    attemptId: 'codex-command-default-vscode-app-module-stale-attempt-1',
    runtimeTruth,
  });

  assert.equal(result?.status, 'blocked', result?.message);
  assert.match(JSON.stringify(result), /blocked:vscode-app-module:stale-observation/);
  assert.doesNotMatch(JSON.stringify(result), /computer-use-app-module-primitive-candidate|taskOutcome":"satisfied/i);
});

test('default Computer Use Act materializer blocks app module readiness without structured Host operation', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'Generic planner must not infer a VSCode operation from command text.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-operation-inference'],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput(undefined),
    preflight: vscodeAppModulePreflight(),
    commandText: 'read visible text from VSCode',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-app-module-no-operation',
    attemptId: 'codex-command-default-vscode-app-module-no-operation-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(result?.claimType, 'computer-use-app-module-blocked');
  assert.ok(result?.evidenceRefs.includes('blocked:computer-use-app-module:operation-ref-required'));
  assert.equal(result?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /computer-use-app-module\/vscode\/read-visible-text|taskOutcome":"satisfied/i);
});

test('default Computer Use Act materializer blocks unknown and ambiguous app module targets', async () => {
  const ambiguousA = testAppModule('ambiguous-a');
  const ambiguousB = testAppModule('ambiguous-b');
  const materializer = createDefaultComputerUseActMaterializer({
    appModules: [ambiguousA, ambiguousB],
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        throw new Error('generic planner must not handle structured app module operations');
      },
    },
  });

  const unknown = await materializer({
    agentHostInput: appModuleAgentHostInput('read-visible-text', ['macos-app:unknown', 'window:unknown:main']),
    preflight: appModulePreflight(['macos-app:unknown', 'window:unknown:main']),
    commandText: 'do not fallback',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-app-module-unknown',
    attemptId: 'codex-command-default-app-module-unknown-attempt-1',
    runtimeTruth: appModuleRuntimeTruth(['macos-app:unknown', 'window:unknown:main']),
  });

  assert.equal(unknown?.status, 'blocked');
  assert.equal(unknown?.claimType, 'computer-use-app-module-blocked');
  assert.ok(unknown?.evidenceRefs.includes('blocked:computer-use-app-module:unsupported-app'));
  assert.equal(unknown?.completionTruth, undefined);

  const ambiguous = await materializer({
    agentHostInput: appModuleAgentHostInput('read-visible-text', ['macos-app:ambiguous', 'window:ambiguous:main']),
    preflight: appModulePreflight(['macos-app:ambiguous', 'window:ambiguous:main']),
    commandText: 'do not fallback',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-app-module-ambiguous',
    attemptId: 'codex-command-default-app-module-ambiguous-attempt-1',
    runtimeTruth: appModuleRuntimeTruth(['macos-app:ambiguous', 'window:ambiguous:main']),
  });

  assert.equal(ambiguous?.status, 'blocked');
  assert.equal(ambiguous?.claimType, 'computer-use-app-module-blocked');
  assert.ok(ambiguous?.evidenceRefs.includes('blocked:computer-use-app-module:ambiguous-app'));
  assert.equal(ambiguous?.completionTruth, undefined);
});

test('default Computer Use Act materializer rejects app module readiness that carries final answer payloads', async () => {
  const unsafeModule: ComputerUseAppModule = {
    moduleId: 'unsafe',
    canHandle: ({ refs }) => refs.includes('macos-app:unsafe'),
    normalizeObservation: ({ refs }) => ({ refs }),
    getCapabilities: () => ['read-visible-text'],
    checkReadiness: () => ({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: ['window:unsafe:main'],
        action: {
          kind: 'app_command',
          message: 'I handled the task',
        },
      },
      evidenceRefs: ['module:unsafe'],
    }),
  };
  const materializer = createDefaultComputerUseActMaterializer({
    appModules: [unsafeModule],
  });

  const result = await materializer({
    agentHostInput: appModuleAgentHostInput('read-visible-text', ['macos-app:unsafe', 'window:unsafe:main']),
    preflight: appModulePreflight(['macos-app:unsafe', 'window:unsafe:main']),
    commandText: 'do not expose module final answer',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-app-module-unsafe',
    attemptId: 'codex-command-default-app-module-unsafe-attempt-1',
    runtimeTruth: appModuleRuntimeTruth(['macos-app:unsafe', 'window:unsafe:main']),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'computer-use-app-module-blocked');
  assert.ok(result?.evidenceRefs.includes('blocked:computer-use-app-module:final-answer-not-allowed'));
  assert.equal(result?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /I handled the task|taskOutcome":"satisfied/i);
});

test('default Computer Use Act materializer rejects app module readiness raw/final aliases before artifact write', async () => {
  const unsafeModule: ComputerUseAppModule = {
    moduleId: 'unsafe-alias',
    canHandle: ({ refs }) => refs.includes('macos-app:unsafe-alias'),
    normalizeObservation: ({ refs }) => ({ refs }),
    getCapabilities: () => ['read-visible-text'],
    checkReadiness: () => ({
      status: 'ready',
      primitive: {
        name: 'computer_use.act',
        inputRefs: ['window:unsafe-alias:main'],
        action: {
          kind: 'app_command',
          final_answer: 'I handled the task',
          raw_payload: { secret: 'raw-provider-object' },
          screenshot_base64: 'iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA12==',
        },
      },
      evidenceRefs: ['module:unsafe-alias'],
    }),
  };
  const materializer = createDefaultComputerUseActMaterializer({
    appModules: [unsafeModule],
  });

  const result = await materializer({
    agentHostInput: appModuleAgentHostInput('read-visible-text', ['macos-app:unsafe-alias', 'window:unsafe-alias:main']),
    preflight: appModulePreflight(['macos-app:unsafe-alias', 'window:unsafe-alias:main']),
    commandText: 'do not expose module alias payloads',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-app-module-unsafe-alias',
    attemptId: 'codex-command-default-app-module-unsafe-alias-attempt-1',
    runtimeTruth: appModuleRuntimeTruth(['macos-app:unsafe-alias', 'window:unsafe-alias:main']),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'computer-use-app-module-blocked');
  assert.ok(result?.evidenceRefs.includes('blocked:computer-use-app-module:final-answer-not-allowed'));
  assert.equal(result?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /I handled the task|raw-provider-object|iVBORw0KGgo/);
});

test('default Computer Use Act materializer sanitizes unsafe app module identifiers from public readiness results', async () => {
  const unsafeModuleId = 'https://example.invalid/SECRET_MODULE_ID';
  const unsafeModule: ComputerUseAppModule = {
    moduleId: unsafeModuleId,
    canHandle: ({ refs }) => refs.includes('macos-app:unsafe-module-id'),
    normalizeObservation: ({ refs }) => ({ refs }),
    getCapabilities: () => ['read-visible-text'],
    checkReadiness: () => ({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: ['window:unsafe-module-id:main'],
      },
      evidenceRefs: ['module:unsafe-module-id', 'observation:unsafe-module-id:current'],
    }),
  };
  const materializer = createDefaultComputerUseActMaterializer({
    appModules: [unsafeModule],
  });

  const result = await materializer({
    agentHostInput: appModuleAgentHostInput('read-visible-text', ['macos-app:unsafe-module-id', 'window:unsafe-module-id:main']),
    preflight: appModulePreflight(['macos-app:unsafe-module-id', 'window:unsafe-module-id:main']),
    commandText: 'do not expose module identifiers',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-app-module-unsafe-id',
    attemptId: 'codex-command-default-app-module-unsafe-id-attempt-1',
    runtimeTruth: appModuleRuntimeTruth(['macos-app:unsafe-module-id', 'window:unsafe-module-id:main']),
  });

  const serialized = JSON.stringify(result);
  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.ok(result?.evidenceRefs.includes('module:unsafe-module-id'));
  assert.ok(result?.evidenceRefs.includes('observation:unsafe-module-id:current'));
  assert.doesNotMatch(serialized, /SECRET_MODULE_ID|example\.invalid|https:\/\//i);
});

test('default Computer Use Act materializer does not treat terminal, palette, or action refs as completion truth', async () => {
  const materializer = createDefaultComputerUseActMaterializer();

  const result = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('observe-terminal', [
      'element:vscode:terminal:main',
      'terminal-output:vscode:main:current',
      'terminal-output-hash:vscode:main:sha256:abc123',
      'command-palette:vscode:main:current',
      'command-palette-items:vscode:main:obs-main-1',
      'command-palette-item:vscode:main:obs-main-1:rank-1',
      'action:vscode:previous:completed',
    ]),
    preflight: vscodeAppModulePreflight([
      'element:vscode:terminal:main',
      'terminal-output:vscode:main:current',
      'terminal-output-hash:vscode:main:sha256:abc123',
      'command-palette:vscode:main:current',
      'command-palette-items:vscode:main:obs-main-1',
      'command-palette-item:vscode:main:obs-main-1:rank-1',
      'action:vscode:previous:completed',
    ]),
    commandText: 'terminal output says done',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-terminal-candidate',
    attemptId: 'codex-command-default-vscode-terminal-candidate-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth([
      'element:vscode:terminal:main',
      'terminal-output:vscode:main:current',
      'terminal-output-hash:vscode:main:sha256:abc123',
      'command-palette:vscode:main:current',
      'command-palette-items:vscode:main:obs-main-1',
      'command-palette-item:vscode:main:obs-main-1:rank-1',
      'action:vscode:previous:completed',
    ]),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'computer-use-app-module-primitive-candidate');
  assert.equal(result?.completionTruth, undefined);
  assert.ok(result?.executionUnits?.some((unit) =>
    unit.tool === 'computer-use.app-module-registry'
      && unit.operation === 'observe-terminal'
      && unit.primitive === 'computer_use.observe'
  ));
  assert.doesNotMatch(JSON.stringify(result), /taskOutcome":"satisfied|completionTruth|user-task|workflow complete/i);
});

test('default Computer Use Act materializer propagates VSCode app module ambiguity without WindowAction fallback', async () => {
  let windowActionPlannerCalls = 0;
  const materializer = createDefaultComputerUseActMaterializer({
    windowAction: {
      windowActionSessionStore: readyWindowActionStore(),
      actionPlanner: async () => {
        windowActionPlannerCalls += 1;
        return {
          status: 'blocked',
          message: 'WindowAction must not handle ambiguous VSCode app module targets.',
          evidenceRefs: ['action-ledger:planner/unexpected-vscode-ambiguity-fallback'],
        };
      },
    },
  });

  const result = await materializer({
    agentHostInput: vscodeAppModuleAgentHostInput('focus-editor', [
      'editor-group:vscode:main:1',
      'editor-group:vscode:main:2',
      'element:vscode:editor:monaco:2',
    ]),
    preflight: vscodeAppModulePreflight([
      'editor-group:vscode:main:1',
      'editor-group:vscode:main:2',
      'element:vscode:editor:monaco:2',
    ]),
    commandText: 'This ambiguous VSCode target must not fall back.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-default-vscode-ambiguity',
    attemptId: 'codex-command-default-vscode-ambiguity-attempt-1',
    runtimeTruth: vscodeAppModuleRuntimeTruth([
      'editor-group:vscode:main:1',
      'editor-group:vscode:main:2',
      'element:vscode:editor:monaco:2',
    ]),
  });

  assert.equal(windowActionPlannerCalls, 0);
  assert.equal(result?.status, 'needs-confirmation', result?.message);
  assert.equal(result?.claimType, 'computer-use-app-module-needs-confirmation');
  assert.match(JSON.stringify(result), /needs-confirmation:vscode-app-module:target-editor-ambiguous/);
  assert.equal(result?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /WindowAction must not handle|taskOutcome":"satisfied|workflow complete/i);
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

function vscodeAppModuleAgentHostInput(
  operation: string | undefined,
  extraRefs: string[] = [],
  appModulePayload: Record<string, unknown> = {},
): NormalizedCodexAgentHostInput {
  const operationRef = operation ? `operation-ref:vscode:${operation}:test` : undefined;
  const targetRefs = vscodeAppModuleTargetRefs(extraRefs);
  const observationRefs = vscodeAppModuleObservationRefs(extraRefs);
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Host already selected a Computer Use app module operation.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: [
      'intent:computer-use-app-module-dry-run',
      ...targetRefs,
      ...observationRefs,
      operationRef,
      ...extraRefs,
    ].filter((ref): ref is string => typeof ref === 'string'),
    readiness: {},
    target: {
      kind: 'computer-use-app-module',
      refs: targetRefs,
      ...(operation ? {
        computerUseAppModule: {
          operation,
          operationRef,
          ...appModulePayload,
        },
      } : {}),
    },
    observation: {
      fresh: true,
      refs: observationRefs,
    },
    permissions: {
      refs: [
        'permission:current-vscode-cowork:full-access:window-action-session:vscode:1:file-ref:vscode:paper',
      ],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function vscodeAppModulePreflight(extraRefs: string[] = []): ComputerUsePreflightResult {
  return appModulePreflight([
    ...vscodeAppModuleTargetRefs(extraRefs),
    ...vscodeAppModuleObservationRefs(extraRefs),
    'permission:current-vscode-cowork:full-access:window-action-session:vscode:1:file-ref:vscode:paper',
  ]);
}

function vscodeAppModuleRuntimeTruth(extraRefs: string[] = []): CodexAgentHostRuntimeTruth {
  const observationRefs = vscodeAppModuleObservationRefs(extraRefs);
  return {
    ...runtimeTruth({
      observationRefs,
      permissionRefs: [
        'permission:current-vscode-cowork:full-access:window-action-session:vscode:1:file-ref:vscode:paper',
      ],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
    }),
    target: {
      bound: true,
      summary: 'Current VSCode app module target',
      refs: vscodeAppModuleTargetRefs(extraRefs),
    },
    observation: {
      fresh: true,
      refs: observationRefs,
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
      'intent:computer-use-app-module-dry-run',
      ...vscodeAppModuleTargetRefs(extraRefs),
      ...observationRefs,
      ...extraRefs,
      'permission:current-vscode-cowork:full-access:window-action-session:vscode:1:file-ref:vscode:paper',
      'computer-use:executor-scope:current-vscode',
      'cancel:runtime-turn/codex-command-default-vscode-app-module',
    ],
  };
}

function vscodeAppModuleTargetRefs(extraRefs: string[] = []): string[] {
  return [
    'macos-app:vscode',
    'process:vscode:paper',
    'window:vscode:paper',
    'text:title:vscode:paper',
    'frontmost:vscode:paper',
    'file-ref:vscode:paper',
    'window-action-session:vscode:1',
    ...extraRefs,
  ];
}

function vscodeAppModuleObservationRefs(extraRefs: string[] = []): string[] {
  return [
    'window-action-session:vscode:1',
    'macos-app:vscode',
    'process:vscode:paper',
    'frontmost:vscode:paper',
    'window:vscode:paper',
    'text:title:vscode:paper',
    'observation:vscode:current',
    'image:vscode:current',
    'accessibility:vscode:current',
    'text:vscode:visible:paper',
    'element:vscode:editor:monaco:1',
    'freshness:vscode:current',
    'file-ref:vscode:paper',
    ...extraRefs,
  ];
}

function appModuleAgentHostInput(operation: string, refs: string[]): NormalizedCodexAgentHostInput {
  const operationRef = `operation-ref:app-module:${operation}:test`;
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Host already selected a Computer Use app module operation.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: ['intent:computer-use-app-module-dry-run', operationRef, ...refs],
    readiness: {},
    target: {
      kind: 'computer-use-app-module',
      refs,
      computerUseAppModule: {
        operation,
        operationRef,
      },
    },
    observation: {
      fresh: true,
      refs,
    },
    permissions: {},
  };
}

function appModulePreflight(refs: string[]): ComputerUsePreflightResult {
  return {
    ...readyPreflight(),
    target: {
      summary: 'Computer Use app module target',
      refs,
    },
    evidenceRefs: refs,
  };
}

function appModuleRuntimeTruth(refs: string[]): CodexAgentHostRuntimeTruth {
  return {
    ...runtimeTruth({
      observationRefs: refs,
      permissionRefs: ['permission:turn/app-module/full-access'],
      scopedExecutorRefs: ['computer-use:executor-scope:app-module'],
    }),
    target: {
      bound: true,
      summary: 'Computer Use app module target',
      refs,
    },
    observation: {
      fresh: true,
      refs,
      observedAt: '2026-06-03T00:00:00.000Z',
      capturedAt: '2026-06-03T00:00:00.000Z',
      freshnessCheckedAt: '2026-06-03T00:00:00.000Z',
    },
    refs: ['intent:computer-use-app-module-dry-run', ...refs],
  };
}

function testAppModule(moduleId: string): ComputerUseAppModule {
  return {
    moduleId,
    canHandle: ({ refs }) => refs.includes('macos-app:ambiguous'),
    normalizeObservation: ({ refs }) => ({ refs }),
    getCapabilities: () => ['read-visible-text'],
    checkReadiness: () => ({
      status: 'ready',
      primitive: {
        name: 'computer_use.observe',
        inputRefs: ['window:ambiguous:main'],
      },
      evidenceRefs: [`module:${moduleId}`],
    }),
  };
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
