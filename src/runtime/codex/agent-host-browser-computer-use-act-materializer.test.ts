import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultBrowserHostComputerUseActMaterializer,
} from './agent-host-browser-computer-use-act-materializer.js';
import type { BrowserHostSessionManager, BrowserHostSessionState } from '../browser-host-session.js';
import type { BrowserHostComputerUseAction } from '../browser-host-computer-use.js';
import type { BrowserHostSessionActionInput } from '../browser-host-session-types.js';
import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import {
  evaluateCodexAgentHostTurnLoop,
  type CodexAgentHostRuntimeTruth,
  type NormalizedCodexAgentHostInput,
} from './agent-host-turn-loop.js';

test('BrowserHost Computer Use Act materializer executes a planned low-risk action through BrowserHostSession', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  const manager = {
    async sessionState(_workspacePath: string, sessionId: string) {
      return browserSessionState(sessionId);
    },
    async act(workspacePath: string, sessionId: string, input: Record<string, unknown>) {
      acted.push({ workspacePath, sessionId, input });
      return {
        id: sessionId,
        status: 'ready',
        updatedAt: new Date().toISOString(),
        frameRef: `browser-host-session:${sessionId}/frame-after.png`,
        screenshotRef: `browser-host-session:${sessionId}/screenshot-after.png`,
        visibleAction: {
          actionId: input.actionId,
          action: input.action,
          riskType: 'scroll',
          visibleActionRef: `browser-host-session:${sessionId}/visible-actions/${input.actionId}.json`,
        },
        actorCursor: browserActorCursor(sessionId, String(input.actionId ?? 'action'), 'scroll'),
      };
    },
  } as unknown as BrowserHostSessionManager;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: manager,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll down to inspect visible results.',
      actions: [{ type: 'scroll', direction: 'down', amount: 300 }],
      evidenceRefs: ['action-ledger:planner/scroll-down'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act',
    attemptId: 'codex-command-browser-act-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'completed');
  assert.equal(acted.length, 1);
  assert.equal(acted[0]?.workspacePath, '/tmp/workspace');
  assert.equal(acted[0]?.sessionId, 'verified');
  assert.equal(acted[0]?.input.action, 'scroll');
  assert.equal(acted[0]?.input.deltaY, 300);
  assert.ok(result?.evidenceRefs.includes('browser-host-session:verified/visible-actions/codex-command-browser-act-attempt-1.json'));
  assert.ok(result?.evidenceRefs.includes('adapter-registry:browser-host-session/computer-use'));
  assert.ok(result?.evidenceRefs.includes('browser-host-session:verified/actions/codex-command-browser-act-attempt-1/verification/verifier.json'));
  assert.ok(result?.evidenceRefs.includes('browser-host-session:verified/actions/codex-command-browser-act-attempt-1/freshness-invalidation.json'));
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:/);
});

test('ordinary chat GUI intent routes Guard to a visible BrowserHostSession action through Act', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }> = [];
  const attemptId = 'codex-command-browser-act-ordinary-chat-attempt-1';
  const beforeEvidenceRef = `evidence:browser-host-session/verified/actions/${attemptId}/before-frame.png`;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({ acted }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll the visible browser page.',
      actions: [{ type: 'scroll', direction: 'down', amount: 180 }],
      evidenceRefs: ['action-ledger:planner/ordinary-chat-visible-scroll'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await evaluateCodexAgentHostTurnLoop({
    input: readyAgentHostInput({ intentText: 'Scroll the current browser page to inspect visible results.' }),
    commandText: 'Scroll the current browser page to inspect visible results.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-ordinary-chat',
    attemptId,
    runtimeTruth: runtimeTruth({
      observationRefs: [beforeEvidenceRef],
      permissionRefs: ['permission:turn/codex-command-browser-act-ordinary-chat/ordinary-navigation'],
    }),
    computerUseActMaterializer: materializer,
  });

  assert.equal(result?.result.status, 'done', String(result?.result.message ?? ''));
  assert.equal(acted.length, 1);
  assert.equal(acted[0]?.sessionId, 'verified');
  assert.equal(acted[0]?.input.action, 'scroll');
  assert.equal(acted[0]?.input.deltaY, 180);
  assert.match(String(result?.event.message ?? ''), /Computer Use Act materializer completed/);
  assert.doesNotMatch(JSON.stringify(result), /^\/computer-use|slash route only|gui\.present|ui:|fixture:|replay:/i);
});

test('BrowserHost Computer Use Act materializer returns complete action evidence refs for scroll, type, and click', async (t) => {
  const cases: Array<{
    name: string;
    commandText: string;
    action: BrowserHostComputerUseAction;
    expectedHostAction: BrowserHostSessionActionInput['action'];
  }> = [
    {
      name: 'scroll',
      commandText: 'Scroll the current browser page.',
      action: { type: 'scroll', direction: 'down', amount: 240 },
      expectedHostAction: 'scroll',
    },
    {
      name: 'type',
      commandText: 'Type a short query in the focused browser field.',
      action: { type: 'type_text', text: 'matrix methods' },
      expectedHostAction: 'type',
    },
    {
      name: 'click',
      commandText: 'Click the grounded browser result.',
      action: { type: 'click', x: 120, y: 80, targetDescription: 'grounded result' },
      expectedHostAction: 'click',
    },
    {
      name: 'press',
      commandText: 'Press Enter in the focused browser field.',
      action: { type: 'press_key', key: 'Return' },
      expectedHostAction: 'press',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const attemptId = `codex-command-browser-act-${testCase.name}-attempt-1`;
      const beforeEvidenceRef = `evidence:browser-host-session/verified/actions/${attemptId}/before-frame.png`;
      const materializer = createDefaultBrowserHostComputerUseActMaterializer({
        browserHostSessionManager: browserEvidenceManager(),
        actionPlanner: async () => ({
          status: 'planned',
          message: `Plan ${testCase.name}.`,
          actions: [testCase.action],
          evidenceRefs: [`action-ledger:planner/${testCase.name}`],
        }),
      });

      const result = await materializer({
        agentHostInput: readyAgentHostInput(),
        preflight: readyPreflight({ evidenceRefs: [beforeEvidenceRef] }),
        commandText: testCase.commandText,
        workspacePath: '/tmp/workspace',
        commandId: `codex-command-browser-act-${testCase.name}`,
        attemptId,
        runtimeTruth: runtimeTruth({ observationRefs: [beforeEvidenceRef] }),
      });

      assert.equal(result?.status, 'completed', result?.message);
      assert.equal(result?.claimType, 'runtime-action');
      assert.ok(result?.evidenceRefs.includes(beforeEvidenceRef), `${testCase.name} includes before evidence`);
      assert.ok(result?.evidenceRefs.includes(`browser-host-session:verified/actions/${attemptId}/after-frame.png`), `${testCase.name} includes after frame evidence`);
      assert.ok(result?.evidenceRefs.includes(`browser-host-session:verified/actions/${attemptId}/after-screenshot.png`), `${testCase.name} includes after screenshot evidence`);
      assert.ok(result?.evidenceRefs.includes(`browser-host-session:verified/actions/${attemptId}/verification/verifier.json`), `${testCase.name} includes verifier evidence`);
      assert.ok(result?.evidenceRefs.includes(`browser-host-session:verified/actions/${attemptId}/freshness-invalidation.json`), `${testCase.name} includes freshness invalidation evidence`);
      assert.ok(result?.evidenceRefs.includes(`browser-host-session:verified/action-state/${attemptId}`), `${testCase.name} includes executor action-state`);
      assert.ok(!result?.evidenceRefs.some((ref) => /placeholder|stale-invalidation/i.test(ref)), `${testCase.name} does not synthesize verifier/stale placeholder refs`);
      const artifactData = result?.artifacts?.[0]?.data as Record<string, unknown> | undefined;
      const artifactEvidence = artifactData?.evidence as Record<string, unknown> | undefined;
      assert.equal(artifactData?.actionType, testCase.action.type);
      assert.deepEqual(artifactEvidence?.verificationRefs, [`browser-host-session:verified/actions/${attemptId}/verification/verifier.json`]);
      assert.deepEqual(artifactEvidence?.staleInvalidationRefs, [`browser-host-session:verified/actions/${attemptId}/freshness-invalidation.json`]);
      assert.equal(result?.executionUnits?.[0]?.status, 'done');
      assert.equal(((result?.executionUnits?.[0]?.params ? JSON.parse(String(result.executionUnits[0].params)) : {}) as Record<string, unknown>).actionType, testCase.action.type);
      assert.ok(JSON.stringify(result).includes(`"action":"${testCase.expectedHostAction}"`) || result?.evidenceRefs.includes(`browser-host-session:verified/visible-actions/${attemptId}.json`));
    });
  }
});

test('BrowserHost Computer Use Act materializer blocks stale runtime truth before live action', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }> = [];
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({ acted }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with stale runtime truth.',
      actions: [{ type: 'scroll', direction: 'down', amount: 120 }],
      evidenceRefs: ['action-ledger:planner/stale-runtime-truth-scroll'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-stale-runtime-truth',
    attemptId: 'codex-command-browser-act-stale-runtime-truth-attempt-1',
    runtimeTruth: runtimeTruth({ observationFresh: false }),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted.length, 0);
  assert.match(result?.message ?? '', /stale|fresh observation/i);
});

test('BrowserHost Computer Use Act materializer blocks missing live BrowserHostSession before input', async () => {
  let sessionStateCalls = 0;
  let acted = false;
  const manager = {
    async sessionState() {
      sessionStateCalls += 1;
      return undefined;
    },
    async act() {
      acted = true;
      throw new Error('should not execute without a live BrowserHostSession');
    },
  } as unknown as BrowserHostSessionManager;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: manager,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll but no active session exists.',
      actions: [{ type: 'scroll', direction: 'down', amount: 120 }],
      evidenceRefs: ['action-ledger:planner/missing-live-session-scroll'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-missing-live-session',
    attemptId: 'codex-command-browser-act-missing-live-session-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(sessionStateCalls, 1);
  assert.equal(acted, false);
  assert.match(result?.message ?? '', /BrowserHostSession.*missing|not active|live session/i);
});

test('BrowserHost Computer Use Act materializer blocks stale live BrowserHostSession evidence before input', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }> = [];
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({
      acted,
      beforeSession: browserSessionState('verified', {
        updatedAt: '2026-06-05T23:58:00.000Z',
      }),
    }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with stale live session evidence.',
      actions: [{ type: 'scroll', direction: 'down', amount: 120 }],
      evidenceRefs: ['action-ledger:planner/stale-live-session-scroll'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-stale-live-session',
    attemptId: 'codex-command-browser-act-stale-live-session-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted.length, 0);
  assert.match(result?.message ?? '', /stale|fresh/i);
});

test('BrowserHost Computer Use Act materializer blocks hidden live BrowserHostSession before input', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }> = [];
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({
      acted,
      beforeSession: browserSessionState('verified', { visible: false } as Partial<BrowserHostSessionState> & { visible: false }),
    }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click on a hidden browser surface.',
      actions: [{ type: 'click', x: 32, y: 48, targetDescription: 'hidden surface target' }],
      evidenceRefs: ['action-ledger:planner/hidden-session-click'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Click the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-hidden-session',
    attemptId: 'codex-command-browser-act-hidden-session-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted.length, 0);
  assert.match(result?.message ?? '', /hidden|visible/i);
});

test('BrowserHost Computer Use Act materializer blocks diagnostic-only live BrowserHostSession before input', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }> = [];
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({
      acted,
      beforeSession: browserSessionState('verified', {
        status: 'failed',
        liveSurfaceTransport: undefined,
        liveSurfaceRef: undefined,
        singleInteractiveTruth: undefined,
        secondTruthSource: undefined,
        loadingProgress: {
          schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
          state: 'blocked',
          reason: 'host-diagnostic',
          source: 'host-state',
          status: 'failed',
          updatedAt: '2026-06-06T00:00:00.000Z',
          refs: {},
          blocked: true,
          canRetry: true,
        },
        diagnostics: ['native-surface-unavailable'],
      }),
    }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Type into a diagnostic-only browser surface.',
      actions: [{ type: 'type_text', text: 'blocked' }],
      evidenceRefs: ['action-ledger:planner/diagnostic-only-type'],
    }),
    now: () => new Date('2026-06-06T00:00:00.000Z'),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Type into the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-diagnostic-only-session',
    attemptId: 'codex-command-browser-act-diagnostic-only-session-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted.length, 0);
  assert.match(result?.message ?? '', /diagnostic|blocked|native surface/i);
});

test('BrowserHost Computer Use Act materializer fails closed when mutating action lacks after evidence', async () => {
  const attemptId = 'codex-command-browser-act-missing-after-attempt-1';
  const beforeEvidenceRef = `evidence:browser-host-session/verified/actions/${attemptId}/before-frame.png`;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({ omitAfterEvidence: true }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll without after evidence.',
      actions: [{ type: 'scroll', direction: 'down', amount: 240 }],
      evidenceRefs: ['action-ledger:planner/missing-after-scroll'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight({ evidenceRefs: [beforeEvidenceRef] }),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-missing-after',
    attemptId,
    runtimeTruth: runtimeTruth({ observationRefs: [beforeEvidenceRef] }),
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /after evidence/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:browser-host-session/missing-after-evidence'));
});

test('BrowserHost Computer Use Act materializer fails closed when mutating action lacks verifier or freshness invalidation evidence', async () => {
  const attemptId = 'codex-command-browser-act-missing-completion-evidence-attempt-1';
  const beforeEvidenceRef = `evidence:browser-host-session/verified/actions/${attemptId}/before-frame.png`;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({ omitCompletionEvidence: true }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll without verifier and freshness invalidation.',
      actions: [{ type: 'scroll', direction: 'down', amount: 240 }],
      evidenceRefs: ['action-ledger:planner/missing-completion-evidence-scroll'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight({ evidenceRefs: [beforeEvidenceRef] }),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-missing-completion-evidence',
    attemptId,
    runtimeTruth: runtimeTruth({ observationRefs: [beforeEvidenceRef] }),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'runtime-diagnostic');
  assert.match(result?.message ?? '', /verifier|verification|freshness|completion evidence/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:browser-host-session/missing-completion-evidence'));
  assert.equal(result?.completionTruth, undefined);
});

test('BrowserHost Computer Use Act materializer ignores verifier and freshness refs from a previous action', async () => {
  const attemptId = 'codex-command-browser-act-stale-completion-evidence-attempt-1';
  const beforeEvidenceRef = `evidence:browser-host-session/verified/actions/${attemptId}/before-frame.png`;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager({ completionEvidenceActionId: 'previous-action-attempt' }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with stale completion evidence.',
      actions: [{ type: 'scroll', direction: 'down', amount: 240 }],
      evidenceRefs: ['action-ledger:planner/stale-completion-evidence-scroll'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight({ evidenceRefs: [beforeEvidenceRef] }),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-stale-completion-evidence',
    attemptId,
    runtimeTruth: runtimeTruth({ observationRefs: [beforeEvidenceRef] }),
  });

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /current action|completion evidence|verifier|freshness/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:browser-host-session/missing-completion-evidence'));
  assert.doesNotMatch(JSON.stringify(result), /previous-action-attempt/);
});

test('BrowserHost Computer Use Act materializer treats planner-done as local candidate, not user workflow completion', async () => {
  let acted = false;
  const manager = {
    async act() {
      acted = true;
      throw new Error('should not execute planner-done');
    },
  } as unknown as BrowserHostSessionManager;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: manager,
    actionPlanner: async () => ({
      status: 'done',
      message: 'Planner thinks the workflow is complete.',
      actions: [],
      evidenceRefs: ['action-ledger:planner/done'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Finish the browser workflow.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-planner-done',
    attemptId: 'codex-command-browser-act-planner-done-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted, false);
  assert.equal(result?.claimType, 'runtime-diagnostic');
  assert.match(result?.message ?? '', /planner-done|local candidate/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:planner/done-local-candidate'));
  assert.doesNotMatch(JSON.stringify(result?.claims ?? []), /workflow is complete|already satisfied|user task complete/i);
});

test('BrowserHost Computer Use Act materializer sanitizer rejects UI, fixture, replay, raw, base64, and secret refs', async () => {
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: browserEvidenceManager(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with mixed safe and unsafe refs.',
      actions: [{ type: 'scroll', direction: 'down', amount: 240 }],
      evidenceRefs: [
        'action-ledger:planner/safe-scroll',
        'ui:projected-button',
        'fixture:browser-host-action',
        'replay:browser-frame',
        'browser-host-session:verified/raw-screenshot.png',
        'evidence:browser-host-session/verified/base64-frame',
        'permission:secret-token',
      ],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput({
      refs: [
        'browser-host-session:verified',
        'gui.present:browser-pane',
        'browser-host-session:verified/raw-frame.png',
      ],
    }),
    preflight: readyPreflight({
      evidenceRefs: [
        'browser-host-session:verified/frame.png',
        'ui:projection',
        'fixture:browser',
        'replay:frame',
        'browser-host-session:verified/raw-before.png',
      ],
    }),
    commandText: 'Scroll the current browser page.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-sanitize',
    attemptId: 'codex-command-browser-act-sanitize-attempt-1',
    runtimeTruth: runtimeTruth({
      refs: [
        'browser-host-session:verified',
        'cancel:runtime-turn/codex-command-browser-act-sanitize',
        'gui.present:browser-pane',
        'ui:runtime',
        'fixture:runtime',
        'replay:runtime',
        'browser-host-session:verified/raw-observation.png',
        'evidence:browser-host-session/verified/base64-runtime',
        'permission:secret-token',
      ],
    }),
  });

  assert.equal(result?.status, 'completed', result?.message);
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|raw-|\/raw|base64|secret|token|password/i);
});

test('BrowserHost Computer Use Act materializer blocks when no safe action plan is available', async () => {
  let acted = false;
  const manager = {
    async act() {
      acted = true;
      throw new Error('should not execute');
    },
  } as unknown as BrowserHostSessionManager;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: manager,
    actionPlanner: async () => ({
      status: 'blocked',
      message: 'No visible safe action was available.',
      actions: [],
      evidenceRefs: ['action-ledger:planner/blocked'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Click the ambiguous toolbar cluster.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-blocked',
    attemptId: 'codex-command-browser-act-blocked-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted, false);
  assert.match(result?.message ?? '', /No visible safe action/);
  assert.ok(result?.evidenceRefs.includes('action-ledger:planner/blocked'));
});

test('BrowserHost Computer Use Act materializer blocks ungrounded pointer actions before host execution', async () => {
  let acted = false;
  const manager = {
    async act() {
      acted = true;
      throw new Error('should not execute');
    },
  } as unknown as BrowserHostSessionManager;
  const materializer = createDefaultBrowserHostComputerUseActMaterializer({
    browserHostSessionManager: manager,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click the visible result.',
      actions: [{ type: 'click', targetDescription: 'visible result' }],
      evidenceRefs: ['action-ledger:planner/click-needs-grounding'],
    }),
  });

  const result = await materializer({
    agentHostInput: readyAgentHostInput(),
    preflight: readyPreflight(),
    commandText: 'Click the visible result.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-browser-act-grounding',
    attemptId: 'codex-command-browser-act-grounding-attempt-1',
    runtimeTruth: runtimeTruth(),
  });

  assert.equal(result?.status, 'blocked');
  assert.equal(acted, false);
  assert.match(result?.message ?? '', /grounding|coordinate|missing x/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:planner/click-needs-grounding'));
});

function browserEvidenceManager(options: {
  acted?: Array<{ workspacePath: string; sessionId: string; input: BrowserHostSessionActionInput }>;
  beforeSession?: BrowserHostSessionState & { visible?: boolean };
  omitAfterEvidence?: boolean;
  omitCompletionEvidence?: boolean;
  completionEvidenceActionId?: string;
} = {}): BrowserHostSessionManager {
  return {
    async sessionState(_workspacePath: string, sessionId: string) {
      return options.beforeSession ?? browserSessionState(sessionId);
    },
    async act(_workspacePath: string, sessionId: string, input: BrowserHostSessionActionInput) {
      options.acted?.push({ workspacePath: _workspacePath, sessionId, input });
      const actionId = String(input.actionId ?? 'action');
      return {
        id: sessionId,
        status: 'ready',
        updatedAt: new Date().toISOString(),
        ...(options.omitAfterEvidence ? {} : {
          frameRef: `browser-host-session:${sessionId}/actions/${actionId}/after-frame.png`,
          screenshotRef: `browser-host-session:${sessionId}/actions/${actionId}/after-screenshot.png`,
        }),
        visibleAction: {
          actionId,
          action: input.action,
          riskType: input.action === 'scroll' ? 'scroll' : input.action === 'type' ? 'low-risk-input' : 'click',
          visibleActionRef: `browser-host-session:${sessionId}/visible-actions/${actionId}.json`,
        },
        ...(options.omitCompletionEvidence ? {} : {
          actorCursor: browserActorCursor(sessionId, options.completionEvidenceActionId ?? actionId, input.action),
        }),
      };
    },
  } as unknown as BrowserHostSessionManager;
}

function browserSessionState(
  sessionId: string,
  overrides: Partial<BrowserHostSessionState> & { visible?: boolean } = {},
): BrowserHostSessionState & { visible?: boolean } {
  const now = new Date().toISOString();
  return {
    schemaVersion: 'sciforge.browser-host-session.state.v1',
    id: sessionId,
    owner: 'host',
    providerId: 'sciforge.browser-host-session',
    status: 'ready',
    workspacePath: '/tmp/workspace',
    requestedUrl: 'https://example.test/',
    url: 'https://example.test/',
    title: 'Verified browser page',
    startedAt: now,
    updatedAt: now,
    viewport: { width: 1200, height: 800 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    liveSurfaceTransport: 'native-embedded',
    nativeAdapterUrl: 'http://127.0.0.1:42700',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    screenshotRef: `browser-host-session:${sessionId}/screenshot-before.png`,
    diagnostics: [],
    ...overrides,
  };
}

function browserActorCursor(
  sessionId: string,
  actionId: string,
  action: BrowserHostSessionActionInput['action'],
) {
  const evidenceRefs = browserCompletionEvidenceRefs(sessionId, actionId);
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

function browserCompletionEvidenceRefs(sessionId: string, actionId: string): string[] {
  return [
    `browser-host-session:${sessionId}/actions/${actionId}/verification/verifier.json`,
    `browser-host-session:${sessionId}/actions/${actionId}/freshness-invalidation.json`,
  ];
}

function readyAgentHostInput(options: { refs?: string[]; intentText?: string } = {}): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: options.intentText ?? 'Scroll the current browser page.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: options.refs ?? ['browser-host-session:verified'],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
  };
}

function readyPreflight(options: { evidenceRefs?: string[] } = {}): ComputerUsePreflightResult {
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
    evidenceRefs: options.evidenceRefs ?? ['browser-host-session:verified/frame.png', 'permission:turn/codex-command-browser-act/ordinary-navigation'],
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
  refs?: string[];
  observationFresh?: boolean;
  targetBound?: boolean;
  permissionRefs?: string[];
  scopedExecutorRefs?: string[];
  stopCancelPath?: boolean;
} = {}): CodexAgentHostRuntimeTruth {
  const scopedExecutorRefs = options.scopedExecutorRefs ?? ['computer-use:executor-scope:browser-host-session/verified'];
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
      bound: options.targetBound ?? true,
      summary: 'Verified browser page',
      refs: ['browser-host-session:verified', 'window-action-session:browser-host-session/verified'],
    },
    observation: {
      fresh: options.observationFresh ?? true,
      refs: options.observationRefs ?? ['browser-host-session:verified/frame.png'],
    },
    permissions: {
      refs: options.permissionRefs ?? ['permission:turn/codex-command-browser-act/ordinary-navigation'],
      scopedExecutorRefs,
      stopCancelPath: options.stopCancelPath ?? true,
    },
    refs: options.refs ?? [
      'browser-host-session:verified',
      'window-action-session:browser-host-session/verified',
      'adapter-registry:browser-host-session/computer-use',
      ...scopedExecutorRefs,
      'browser-host-session:verified/stop',
      'cancel:runtime-turn/codex-command-browser-act',
    ],
  };
}
