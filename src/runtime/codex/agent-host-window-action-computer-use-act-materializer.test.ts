import assert from 'node:assert/strict';
import test from 'node:test';

import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { GenericVisionAction } from '../computer-use/types.js';
import {
  createActorCursor,
  createWindowActionSession,
  enterWindowActionSession,
  type WindowActionAdapterHandlers,
} from '../window-action-session.js';
import { createInMemoryWindowActionSessionStore } from '../window-action-session-store.js';
import {
  createDefaultWindowActionSessionComputerUseActMaterializer,
} from './agent-host-window-action-computer-use-act-materializer.js';
import type { CodexAgentHostRuntimeTruth, NormalizedCodexAgentHostInput } from './agent-host-turn-loop.js';

const now = '2026-06-03T00:00:00.000Z';
const sessionRef = 'window-action-session:vscode-main';
const beforeRef = 'window-action-session:vscode-main/evidence/before-frame';
const permissionRef = 'permission:turn/codex-window-action/ordinary-navigation';
const verificationRef = 'window-action-session:vscode-main/actions/codex-window-action-attempt-1/verification/verifier.json';
const freshnessInvalidationRef = 'window-action-session:vscode-main/actions/codex-window-action-attempt-1/freshness-invalidation.json';

test('WindowActionSession Computer Use Act materializer executes one low-risk action through dispatchWindowAction', async () => {
  const calls: Array<{ adapter: string; action: unknown; delta: unknown }> = [];
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll the editor.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/window-scroll'],
    }),
    adapterHandlers: {
      'app-native-command': async ({ route, input }) => {
        calls.push({ adapter: route.adapter, action: input.action, delta: input.delta });
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'app-native-command:vscode/scroll/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-frame' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(result?.claimType, 'runtime-action');
  assert.deepEqual(calls, [{ adapter: 'app-native-command', action: 'scroll', delta: { y: 240 } }]);
  assert.ok(result?.evidenceRefs.includes(beforeRef), 'includes before evidence');
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/action-state/codex-window-action-attempt-1'), 'includes action-state ref');
  assert.ok(result?.evidenceRefs.includes('adapter-registry:window-action-session/app-native-command/computer-use'), 'includes adapter ref');
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/vscode-main/actions/codex-window-action-attempt-1/executor-event'), 'includes executor ref');
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/evidence/after-frame'), 'includes after evidence');
  assert.ok(result?.evidenceRefs.includes(verificationRef), 'includes verifier evidence');
  assert.ok(result?.evidenceRefs.includes(freshnessInvalidationRef), 'includes freshness invalidation evidence');
  assert.ok(!result?.evidenceRefs.some((ref) => /placeholder|stale-invalidation/i.test(ref)), 'does not synthesize verifier/stale placeholder refs');
  assert.equal(result?.completionTruth, undefined);
  assert.ok(result?.evidenceRefs.includes(permissionRef), 'includes permission ref');
  assert.equal(result?.executionUnits?.[0]?.status, 'done');
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|base64|raw-|\/raw|secret|token|password/i);
});

test('WindowActionSession Computer Use Act materializer dispatches planner targetDescription clicks without coordinates', async () => {
  const calls: Array<{ action: unknown; point: unknown; targetDescription: unknown }> = [];
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click the search field.',
      nextAction: { type: 'click', targetDescription: 'search field' },
      evidenceRefs: ['action-ledger:planner/window-click'],
    }),
    adapterHandlers: {
      'app-native-command': async ({ input }) => {
        calls.push({
          action: input.action,
          point: input.point,
          targetDescription: input.targetDescription,
        });
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'app-native-command:vscode/click-search/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-click' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'completed', result?.message);
  assert.deepEqual(calls, [{
    action: 'click',
    point: undefined,
    targetDescription: 'search field',
  }]);
});

test('WindowActionSession Computer Use Act materializer dispatches type_text text to adapter without long-term raw text evidence', async () => {
  const calls: Array<{ action: unknown; text: unknown; textLength: unknown }> = [];
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Type low-risk report text.',
      nextAction: { type: 'type_text', text: 'Draft report' },
      evidenceRefs: ['action-ledger:planner/window-type'],
    }),
    adapterHandlers: {
      'app-native-command': async ({ input }) => {
        calls.push({
          action: input.action,
          text: input.text,
          textLength: input.textLength,
        });
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'app-native-command:vscode/type-report/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-type' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'completed', result?.message);
  assert.deepEqual(calls, [{
    action: 'type',
    text: 'Draft report',
    textLength: 12,
  }]);
  assert.doesNotMatch(JSON.stringify(result), /Draft report/);
});

test('WindowActionSession Computer Use Act materializer blocks when the selected adapter has no handler', async () => {
  let plannerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => {
      plannerCalls += 1;
      return {
        status: 'planned',
        message: 'Click a low-risk visible control.',
        nextAction: { type: 'click', x: 42, y: 24, targetDescription: 'search field' },
        evidenceRefs: ['action-ledger:planner/window-click'],
      };
    },
    adapterHandlers: {},
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(plannerCalls, 1);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /handler|adapter/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/adapter-handler-missing'));
});

test('WindowActionSession Computer Use Act materializer blocks when before evidence is missing', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll without an observation.',
      nextAction: { type: 'scroll', direction: 'down', amount: 120 },
      evidenceRefs: ['action-ledger:planner/no-before'],
    }),
    adapterHandlers: {
      'app-native-command': async () => {
        handlerCalls += 1;
        return { status: 'completed' };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    preflightEvidenceRefs: [permissionRef],
    observationRefs: [],
  }));

  assert.equal(handlerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /before evidence/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/missing-before-evidence'));
});

test('WindowActionSession Computer Use Act materializer blocks stale observations before adapter execution', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click from stale evidence.',
      nextAction: { type: 'click', x: 42, y: 24, targetDescription: 'search field' },
      evidenceRefs: ['action-ledger:planner/stale-click'],
    }),
    adapterHandlers: {
      'app-native-command': async () => {
        handlerCalls += 1;
        return { status: 'completed' };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    observationFresh: false,
  }));

  assert.equal(handlerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /stale|fresh/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/stale-observation'));
});

test('WindowActionSession Computer Use Act materializer uses actual observation timestamps instead of dispatch time', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click from stale runtime observation metadata.',
      nextAction: { type: 'click', x: 42, y: 24, targetDescription: 'search field' },
      evidenceRefs: ['action-ledger:planner/stale-actual-observed-at'],
    }),
    adapterHandlers: {
      'app-native-command': async () => {
        handlerCalls += 1;
        return {
          status: 'completed',
          evidenceRefs: [{ kind: 'verification', ref: verificationRef }],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-click' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    observationFresh: true,
    observationObservedAt: '2026-06-02T23:00:00.000Z',
    observationFreshnessCheckedAt: '2026-06-02T23:00:00.000Z',
    observationMaxAgeMs: 1_000,
  }));

  assert.equal(handlerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /stale|fresh/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/stale-observation'));
});

test('WindowActionSession Computer Use Act materializer persists post-dispatch session lifecycle', async () => {
  const store = readyStore();
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: store,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll and persist updated lifecycle.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/persist-window-scroll'],
    }),
    adapterHandlers: {
      'app-native-command': async () => ({
        status: 'completed',
        evidenceRefs: [
          { kind: 'executor-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/executor-event' },
          { kind: 'verification', ref: verificationRef },
          { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
        ],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-persisted-scroll' }],
      }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());
  const stored = store.getActiveByRef(sessionRef);

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(stored?.session.events.at(-1)?.type, 'scroll');
  assert.equal(stored?.session.events.at(-1)?.status, 'completed');
  assert.equal(stored?.session.observation.status, 'stale');
  assert.deepEqual(stored?.session.observation.stale.reasons, ['scroll']);
  assert.ok(stored?.refs.includes('action-ledger:window-action-session/vscode-main/actions/codex-window-action-attempt-1/store-persisted'));
});

test('WindowActionSession Computer Use Act materializer fails closed when mutating action lacks verifier or freshness invalidation evidence', async () => {
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll without verifier and freshness invalidation.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/missing-completion-evidence'],
    }),
    adapterHandlers: {
      'app-native-command': async () => ({
        status: 'completed',
        evidenceRefs: [{ kind: 'executor-event', ref: 'app-native-command:vscode/scroll/executor-event' }],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-frame' }],
      }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'runtime-diagnostic');
  assert.match(result?.message ?? '', /verifier|verification|freshness|completion evidence/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/missing-completion-evidence'));
  assert.equal(result?.completionTruth, undefined);
});

test('WindowActionSession Computer Use Act materializer ignores verifier and freshness refs from a previous action', async () => {
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with stale completion evidence.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/stale-completion-evidence'],
    }),
    adapterHandlers: {
      'app-native-command': async () => ({
        status: 'completed',
        evidenceRefs: [
          { kind: 'executor-event', ref: 'app-native-command:vscode/scroll/executor-event' },
          { kind: 'verification', ref: 'window-action-session:vscode-main/actions/previous-action-attempt/verification/verifier.json' },
          { kind: 'freshness-invalidation', ref: 'window-action-session:vscode-main/actions/previous-action-attempt/freshness-invalidation.json' },
        ],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-frame' }],
      }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /current action|completion evidence|verifier|freshness/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/missing-completion-evidence'));
  assert.doesNotMatch(JSON.stringify(result), /previous-action-attempt/);
});

test('WindowActionSession Computer Use Act materializer blocks unsafe refs without leaking them', async () => {
  let plannerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => {
      plannerCalls += 1;
      return {
        status: 'planned',
        message: 'Should not run with unsafe refs.',
        nextAction: { type: 'scroll', direction: 'down', amount: 120 },
        evidenceRefs: ['action-ledger:planner/safe', 'fixture:planner-case'],
      };
    },
    adapterHandlers: {
      'app-native-command': async () => {
        throw new Error('unsafe refs must block before adapter execution');
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    agentRefs: [sessionRef, 'gui.present:window', 'window-action-session:vscode-main/raw-screenshot', 'evidence:base64-frame', 'permission:secret-token'],
  }));

  assert.equal(plannerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /unsafe refs/i);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:window-action-session/unsafe-ref-blocked'));
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:|base64|raw-|\/raw|secret|token|password/i);
});

test('WindowActionSession Computer Use Act materializer treats planner done as a local candidate only', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'done',
      message: 'Planner says the workflow is complete.',
      evidenceRefs: ['action-ledger:planner/done'],
    }),
    adapterHandlers: {
      'app-native-command': async () => {
        handlerCalls += 1;
        return { status: 'completed' };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(handlerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'runtime-diagnostic');
  assert.match(result?.message ?? '', /local candidate|planner-done/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/planner-done-local-candidate'));
  assert.doesNotMatch(JSON.stringify(result?.claims ?? []), /workflow is complete|already satisfied|user task complete/i);
});

test('WindowActionSession Computer Use Act materializer fails closed for shared system input routes', async () => {
  let handlerCalls = 0;
  const store = readyStore({
    app: { id: 'com.example.shared-input-only', name: 'Shared Input Only', kind: 'unknown' },
  });
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: store,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Click through a shared input fallback.',
      nextAction: { type: 'click', x: 42, y: 24, targetDescription: 'visible control' },
      evidenceRefs: ['action-ledger:planner/system-input'],
    }),
    adapterHandlers: {
      'system-input': async () => {
        handlerCalls += 1;
        return {
          status: 'completed',
          evidenceRefs: [{ kind: 'executor-event', ref: 'shared-system-input:example/click/executor-event' }],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-frame' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(handlerCalls, 0);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /shared system input|handoff|diagnostic/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/shared-system-input-forbidden'));
  assert.doesNotMatch(JSON.stringify(result), /sharedSystemInputUsed["']?:\s*true|status["']?:\s*["']completed/i);
});

test('WindowActionSession Computer Use Act materializer blocks terminal artifacts unless terminal workflow is explicit', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore({
      app: { id: 'com.apple.Terminal', name: 'Terminal', kind: 'terminal' },
    }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Type a visible terminal command.',
      nextAction: { type: 'type_text', text: 'echo report > report.md' },
      evidenceRefs: ['action-ledger:planner/terminal-type'],
    }),
    adapterHandlers: {
      terminal: async () => {
        handlerCalls += 1;
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-terminal' }],
          commandIntentRefs: [{ kind: 'command-intent', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/intent' }],
          visibleTerminalSessionRefs: [{ kind: 'visible-terminal-session', ref: 'terminal-pty:vscode-main/visible' }],
          transcriptRefs: [{ kind: 'transcript', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/transcript' }],
          exitCode: 0,
          artifactRefs: [{ kind: 'artifact', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/artifacts/report.md' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    commandText: 'Write the report in the visible app.',
  }));

  assert.equal(handlerCalls, 1);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /terminal workflow|shell artifact|GUI artifact/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/execution-blocked'));
  assert.doesNotMatch(JSON.stringify(result), /status["']?:\s*["']completed|sharedSystemInputUsed["']?:\s*true/i);
});

test('WindowActionSession Computer Use Act materializer allows explicit terminal workflow with PTY refs', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore({
      app: { id: 'com.apple.Terminal', name: 'Terminal', kind: 'terminal' },
    }),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Type a visible terminal command.',
      nextAction: { type: 'type_text', text: 'echo report > report.md' },
      evidenceRefs: ['action-ledger:planner/terminal-type'],
    }),
    adapterHandlers: {
      terminal: async () => {
        handlerCalls += 1;
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-terminal' }],
          commandIntentRefs: [{ kind: 'command-intent', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/intent' }],
          visibleTerminalSessionRefs: [{ kind: 'visible-terminal-session', ref: 'terminal-pty:vscode-main/visible' }],
          transcriptRefs: [{ kind: 'transcript', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/transcript' }],
          exitCode: 0,
          artifactRefs: [{ kind: 'artifact', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/artifacts/report.md' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    commandText: 'Use the explicit terminal workflow to write the report.',
  }));

  assert.equal(handlerCalls, 1);
  assert.equal(result?.status, 'completed', result?.message);
  assert.ok(result?.evidenceRefs.includes('terminal-pty:vscode-main/actions/codex-window-action-attempt-1/intent'));
  assert.ok(result?.evidenceRefs.includes('terminal-pty:vscode-main/actions/codex-window-action-attempt-1/transcript'));
  assert.ok(result?.evidenceRefs.includes('terminal-pty:vscode-main/actions/codex-window-action-attempt-1/artifacts/report.md'));
});

test('WindowActionSession Computer Use Act materializer blocks editor save without input event and artifact validator refs', async () => {
  let handlerCalls = 0;
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore(),
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Save the visible editor document.',
      nextAction: { type: 'save', targetPath: 'report.md' },
      evidenceRefs: ['action-ledger:planner/editor-save'],
    }),
    adapterHandlers: {
      'app-native-command': async () => {
        handlerCalls += 1;
        return {
          status: 'completed',
          evidenceRefs: [
            { kind: 'executor-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/save/executor-event' },
            { kind: 'verification', ref: verificationRef },
            { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
          ],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-save' }],
        };
      },
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(handlerCalls, 1);
  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /input event|artifact validator|editor save/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/execution-blocked'));
});

function readyStore(options: {
  app?: Parameters<typeof createWindowActionSession>[0]['app'];
} = {}) {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  const session = enterWindowActionSession(createWindowActionSession({
    id: 'vscode-main',
    windowRef: 'window:vscode:main',
    app: options.app ?? { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', kind: 'editor' },
    bounds: { x: 20, y: 30, width: 1200, height: 800 },
    scale: 2,
    screenId: 'screen-built-in',
    evidenceRefs: [{ kind: 'session', ref: sessionRef }],
    timestamp: now,
  }), createActorCursor({
    agentId: 'agent-runtime-1',
    color: '#28a0f0',
    label: 'Runtime worker',
  }), { timestamp: now, actorCursorRef: 'actor-cursor:agent-runtime-1/cursor-runtime-1' });
  store.upsert(session, {
    refs: ['action-ledger:window-action-session/vscode-main/upsert'],
    targetRefs: [sessionRef],
    observationRefs: [beforeRef],
    timestamp: now,
  });
  return store;
}

function readyMaterializerInput(options: {
  agentRefs?: string[];
  preflightEvidenceRefs?: string[];
  observationRefs?: string[];
  observationFresh?: boolean;
  observationObservedAt?: string;
  observationFreshnessCheckedAt?: string;
  observationMaxAgeMs?: number;
  commandText?: string;
} = {}) {
  return {
    agentHostInput: readyAgentHostInput({ refs: options.agentRefs }),
    preflight: readyPreflight({ evidenceRefs: options.preflightEvidenceRefs }),
    commandText: options.commandText ?? 'Scroll the active window.',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-window-action',
    attemptId: 'codex-window-action-attempt-1',
    runtimeTruth: runtimeTruth({
      observationRefs: options.observationRefs,
      observationFresh: options.observationFresh,
      observationObservedAt: options.observationObservedAt,
      observationFreshnessCheckedAt: options.observationFreshnessCheckedAt,
      observationMaxAgeMs: options.observationMaxAgeMs,
      refs: options.agentRefs,
    }),
  };
}

function readyAgentHostInput(options: { refs?: string[] } = {}): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Scroll the active window.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: options.refs ?? [sessionRef],
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
      summary: 'Verified active window',
      refs: [sessionRef],
    },
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    evidenceRefs: options.evidenceRefs ?? [beforeRef, permissionRef],
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'ordinary low-risk action is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}

function runtimeTruth(options: {
  observationRefs?: string[];
  observationFresh?: boolean;
  observationObservedAt?: string;
  observationFreshnessCheckedAt?: string;
  observationMaxAgeMs?: number;
  refs?: string[];
} = {}): CodexAgentHostRuntimeTruth {
  const observedAt = options.observationObservedAt ?? now;
  const freshnessCheckedAt = options.observationFreshnessCheckedAt ?? observedAt;
  const observation = {
    fresh: options.observationFresh ?? true,
    refs: options.observationRefs ?? [beforeRef],
    observedAt,
    capturedAt: observedAt,
    freshnessCheckedAt,
    freshnessCheck: {
      status: options.observationFresh === false ? 'stale' : 'current',
      observedAt,
      checkedAt: freshnessCheckedAt,
      maxAgeMs: options.observationMaxAgeMs ?? 30_000,
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
      summary: 'Verified active window',
      refs: [sessionRef],
    },
    observation,
    permissions: {
      refs: [permissionRef],
      stopCancelPath: true,
    },
    refs: options.refs ?? [
      sessionRef,
      'adapter-registry:window-action-session/app-native-command/computer-use',
      'cancel:runtime-turn/codex-window-action',
    ],
  };
}

export type _WindowActionTestGenericVisionAction = GenericVisionAction;
export type _WindowActionTestAdapterHandlers = WindowActionAdapterHandlers;
