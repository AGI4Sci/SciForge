import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
import type { WindowActionSessionStore } from '../window-action-session-store.js';
import type { CodexAgentHostRuntimeTruth, NormalizedCodexAgentHostInput } from './agent-host-turn-loop.js';

const now = '2026-06-03T00:00:00.000Z';
const sessionRef = 'window-action-session:vscode-main';
const beforeRef = 'window-action-session:vscode-main/evidence/before-frame';
const beforeAccessibilityRef = 'accessibility-ui-automation:vscode-main/state-snapshot-before';
const beforeTextRef = 'accessibility-ui-automation:vscode-main/text-before';
const beforeElementRef = 'desktop-window:vscode-main';
const currentObservationRef = 'observation:window-action-session/vscode-main/2026-06-03t00-00-00.000z';
const permissionRef = 'permission:turn/codex-window-action/ordinary-navigation';
const verificationRef = 'window-action-session:vscode-main/actions/codex-window-action-attempt-1/verification/verifier.json';
const freshnessInvalidationRef = 'window-action-session:vscode-main/actions/codex-window-action-attempt-1/freshness-invalidation.json';
const releaseControlRef = 'action-ledger:window-action-session/vscode-main/control/remove/2026-06-03t00-00-00.000z';
const releaseLeaseRef = 'lease:window-action-session/vscode-main/control/remove';
const releasedInputAdapterRef = 'scoped-input-adapter:vscode-main/computer-use/app-native-command';
const releasedCursorRef = 'actor-cursor:computer-use/vscode-main';

test('WindowActionSession Computer Use Act materializer executes one low-risk action through Computer Use primitives', async () => {
  const calls: Array<{ adapter: string; action: unknown; delta: unknown }> = [];
  const store = readyStore();
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: store,
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
          inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event' }],
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
  assert.ok(result?.evidenceRefs.includes('app-native-command:vscode/scroll/executor-event'), 'includes executor ref');
  assert.ok(result?.evidenceRefs.includes('app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event'), 'includes input event ref');
  assert.ok(result?.evidenceRefs.includes('computer-use:primitive-trace/vscode-main/actions/codex-window-action-attempt-1'), 'includes primitive trace ref');
  assert.ok(result?.evidenceRefs.includes(releaseControlRef), 'includes release control ref');
  assert.ok(result?.evidenceRefs.includes(releaseLeaseRef), 'includes release lease ref');
  assert.ok(result?.evidenceRefs.includes(releasedInputAdapterRef), 'includes released input adapter ref');
  assert.ok(result?.evidenceRefs.includes(releasedCursorRef), 'includes released cursor ref');
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/evidence/after-frame'), 'includes after evidence');
  assert.ok(result?.evidenceRefs.includes(verificationRef), 'includes verifier evidence');
  assert.ok(result?.evidenceRefs.includes(freshnessInvalidationRef), 'includes freshness invalidation evidence');
  assert.ok(!result?.evidenceRefs.some((ref) => /placeholder|stale-invalidation/i.test(ref)), 'does not synthesize verifier/stale placeholder refs');
  assert.equal(result?.completionTruth, undefined);
  assert.ok(result?.evidenceRefs.includes(permissionRef), 'includes permission ref');
  assert.equal(result?.executionUnits?.[0]?.status, 'done');
  assert.equal(store.getActiveByRef(sessionRef), undefined, 'release removes the active WindowActionSession');
  assert.match(String(result?.reasoningTrace), /computer_use\.control/i);
  assert.match(JSON.stringify(result?.artifacts), /releasedRefs/);
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
          inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/click/input-event' }],
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
          inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/type/input-event' }],
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

test('WindowActionSession Computer Use Act materializer releases post-dispatch session lifecycle', async () => {
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
          inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event' }],
          afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-persisted-scroll' }],
        }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());
  const stored = store.getActiveByRef(sessionRef);

  assert.equal(result?.status, 'completed', result?.message);
  assert.equal(stored, undefined);
  assert.ok(result?.evidenceRefs.includes(releaseControlRef));
  assert.ok(result?.evidenceRefs.includes(releaseLeaseRef));
  assert.ok(result?.evidenceRefs.includes(releasedInputAdapterRef));
  assert.ok(result?.evidenceRefs.includes(releasedCursorRef));
});

test('WindowActionSession Computer Use Act materializer blocks host completion when release does not actually clear control', async () => {
  const store = releaseClaimsCompletedButStillActiveStore();
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: store,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll with a locally completed procedure step.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/procedure-local-completed'],
    }),
    adapterHandlers: {
      'app-native-command': async () => ({
        status: 'completed',
        evidenceRefs: [
          { kind: 'executor-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/executor-event' },
          { kind: 'verification', ref: verificationRef },
          { kind: 'freshness-invalidation', ref: freshnessInvalidationRef },
        ],
        inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event' }],
        afterEvidenceRefs: [{ kind: 'screenshot', ref: 'window-action-session:vscode-main/evidence/after-procedure-local-completed' }],
      }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'blocked');
  assert.equal(result?.claimType, 'runtime-diagnostic');
  assert.match(result?.message ?? '', /release|control|active WindowActionSession/i);
  assert.ok(result?.evidenceRefs.includes('runtime-truth:window-action-session/release-not-confirmed'));
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/release-claimed-but-active'));
  assert.equal(result?.completionTruth, undefined);
  assert.doesNotMatch(JSON.stringify(result), /status["']?:\s*["']completed|status["']?:\s*["']done|user task complete|workflow complete/i);
});

test('WindowActionSession Computer Use Act materializer releases session when primitive act is blocked', async () => {
  const store = readyStore();
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: store,
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Scroll and release after blocked act.',
      nextAction: { type: 'scroll', direction: 'down', amount: 240 },
      evidenceRefs: ['action-ledger:planner/blocked-window-scroll'],
    }),
    adapterHandlers: {
      'app-native-command': async () => ({
        status: 'blocked',
        blockedReason: 'adapter_fixture_blocked',
        evidenceRefs: [{ kind: 'executor-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/blocked/executor-event' }],
      }),
    },
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput());

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /adapter_fixture_blocked/);
  assert.equal(store.getActiveByRef(sessionRef), undefined);
  assert.ok(result?.evidenceRefs.includes(releaseControlRef));
  assert.ok(result?.evidenceRefs.includes(releaseLeaseRef));
  assert.ok(result?.evidenceRefs.includes(releasedInputAdapterRef));
  assert.ok(result?.evidenceRefs.includes(releasedCursorRef));
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
        inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event' }],
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
        inputEventRefs: [{ kind: 'input-event', ref: 'app-native-command:vscode/actions/codex-window-action-attempt-1/scroll/input-event' }],
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
          inputEventRefs: [{ kind: 'input-event', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/input-event' }],
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
          inputEventRefs: [{ kind: 'input-event', ref: 'terminal-pty:vscode-main/actions/codex-window-action-attempt-1/input-event' }],
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

test('WindowActionSession Computer Use Act materializer can select Appium Mac2 for TextEdit save and fail closed on missing readiness', async () => {
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore({
      app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
    }),
    env: { SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1' },
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Save the visible TextEdit document.',
      nextAction: { type: 'save', targetPath: 'sciforge-computer-use-proof.txt' },
      evidenceRefs: ['action-ledger:planner/textedit-save'],
    }),
    adapterHandlers: {},
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    commandText: 'Save the TextEdit document.',
  }));

  assert.equal(result?.status, 'blocked');
  assert.match(result?.message ?? '', /Appium Mac2.*server URL/i);
  assert.ok(result?.evidenceRefs.includes('action-ledger:window-action-session/execution-blocked'));
  assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/readiness/missing-server-url'));
  assert.equal(result?.evidenceRefs.includes('action-ledger:window-action-session/adapter-handler-missing'), false);
});

test('WindowActionSession Computer Use Act materializer can execute TextEdit save through injected Appium Mac2 executor', async () => {
  const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
    windowActionSessionStore: readyStore({
      app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
    }),
    env: {
      SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1',
      SCIFORGE_APPIUM_MAC2_SERVER_URL: 'http://127.0.0.1:4723',
      SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
    },
    actionPlanner: async () => ({
      status: 'planned',
      message: 'Save the visible TextEdit document.',
      nextAction: { type: 'save', targetPath: 'sciforge-computer-use-proof.txt' },
      evidenceRefs: ['action-ledger:planner/textedit-save'],
    }),
    appiumMac2Client: async (request) => ({
      executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/executor-event`,
      inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/input-event`,
      verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
      artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator`,
      freshnessInvalidationRef: `window-action-session:vscode-main/actions/${request.actionId}/freshness-invalidation.json`,
      afterEvidenceRef: `window-action-session:vscode-main/evidence/${request.actionId}/after-ax.json`,
    }),
    now: () => new Date(now),
  });

  const result = await materializer(readyMaterializerInput({
    commandText: 'Save the TextEdit document.',
  }));

  assert.equal(result?.status, 'completed', result?.message);
  assert.ok(result?.evidenceRefs.includes('adapter-registry:window-action-session/appium-mac2/computer-use'));
  assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/executor-event'));
  assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/input-event'));
  assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/verification/source-read'));
  assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/artifact-validator'));
  assert.ok(result?.evidenceRefs.includes('window-action-session:vscode-main/evidence/codex-window-action-attempt-1/after-ax.json'));
  assert.doesNotMatch(JSON.stringify(result), /shared-system-input|workspace-file-writer|osascript|CGEvent|base64|secret|token/i);
});

test('WindowActionSession Computer Use Act materializer can execute TextEdit type through default Appium Mac2 WebDriver client', async () => {
  const server = await startAppiumMac2WebDriverFixture();
  try {
    const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
      windowActionSessionStore: readyStore({
        app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
      }),
      env: {
        SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1',
        SCIFORGE_APPIUM_MAC2_SERVER_URL: server.url,
        SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
      },
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Type into the visible TextEdit document.',
        nextAction: { type: 'type_text', text: 'Draft report' },
        evidenceRefs: ['action-ledger:planner/textedit-type'],
      }),
      now: () => new Date(now),
    });

    const result = await materializer(readyMaterializerInput({
      commandText: 'Type into the TextEdit document.',
    }));

    assert.equal(result?.status, 'completed', result?.message);
    assert.equal(server.requests[0]?.path, '/session');
    assert.equal(server.requests[1]?.path, '/session/session-1/actions');
    assert.equal(server.requests[2]?.path, '/session/session-1/source');
    assert.equal(server.requests.at(-1)?.path, '/session/session-1');
    assert.ok(result?.evidenceRefs.includes('adapter-registry:window-action-session/appium-mac2/computer-use'));
    assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/type-input'));
    assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/after-source'));
    assert.doesNotMatch(JSON.stringify(result), /Draft report|shared-system-input|workspace-file-writer|osascript|CGEvent|base64|secret|token/i);
  } finally {
    await server.close();
  }
});

test('WindowActionSession Computer Use Act materializer validates TextEdit save through default Appium Mac2 WebDriver client', async () => {
  const server = await startAppiumMac2WebDriverFixture();
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-textedit-materializer-'));
  try {
    const artifactPath = join(dir, 'proof.txt');
    await writeFile(artifactPath, 'Draft report\n', 'utf8');
    const materializer = createDefaultWindowActionSessionComputerUseActMaterializer({
      windowActionSessionStore: readyStore({
        app: { id: 'com.apple.TextEdit', name: 'TextEdit', kind: 'editor' },
      }),
      env: {
        SCIFORGE_WINDOW_ACTION_APPIUM_MAC2: '1',
        SCIFORGE_APPIUM_MAC2_SERVER_URL: server.url,
        SCIFORGE_APPIUM_MAC2_EXECUTOR: '1',
        SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH: artifactPath,
      },
      actionPlanner: async () => ({
        status: 'planned',
        message: 'Save the visible TextEdit document.',
        nextAction: { type: 'save', targetPath: 'proof.txt' },
        evidenceRefs: ['action-ledger:planner/textedit-save-default-client'],
      }),
      now: () => new Date(now),
    });

    const result = await materializer(readyMaterializerInput({
      commandText: 'Save the TextEdit document.',
    }));

    assert.equal(result?.status, 'completed', result?.message);
    assert.equal(server.requests[1]?.path, '/session/session-1/actions');
    assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/save-input'));
    assert.ok(result?.evidenceRefs.includes('appium-mac2:textedit/actions/codex-window-action-attempt-1/artifact-validator/content-match'));
    assert.doesNotMatch(JSON.stringify(result), /Draft report|proof\.txt|\/tmp|shared-system-input|workspace-file-writer|osascript|CGEvent|base64|secret|token/i);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function readyStore(options: {
  app?: Parameters<typeof createWindowActionSession>[0]['app'];
  observationRefs?: string[];
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
    observationRefs: options.observationRefs ?? beforeObservationRefs(),
    timestamp: now,
  });
  return store;
}

function releaseClaimsCompletedButStillActiveStore(): WindowActionSessionStore {
  const store = readyStore({
    observationRefs: [currentObservationRef, ...beforeObservationRefs()],
  });
  return {
    upsert: (session, options = {}) => store.upsert(session, {
      ...options,
      observationRefs: [
        currentObservationRef,
        ...((options.observationRefs ?? []).filter((item): item is string => typeof item === 'string')),
      ],
    }),
    getActiveByRef: (ref) => {
      const entry = store.getActiveByRef(ref);
      return entry
        ? {
            ...entry,
            observationRefs: [currentObservationRef, ...entry.observationRefs],
          }
        : entry;
    },
    materializeForBrowserHostSession: (...args) => store.materializeForBrowserHostSession(...args),
    materializeForAnnotationMetadata: (...args) => store.materializeForAnnotationMetadata(...args),
    pause: (...args) => store.pause(...args),
    stop: (...args) => store.stop(...args),
    remove: (ref, options = {}) => ({
      status: 'completed',
      refs: [
        'action-ledger:window-action-session/release-claimed-but-active',
        ...((options.refs ?? []).filter((item): item is string => typeof item === 'string')),
      ],
      session: store.getActiveByRef(ref)?.session,
    }),
  };
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
    refs: options.observationRefs ?? beforeObservationRefs(),
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

function beforeObservationRefs(): string[] {
  return [beforeRef, beforeAccessibilityRef, beforeTextRef, beforeElementRef];
}

async function startAppiumMac2WebDriverFixture() {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readFixtureBody(req);
    const path = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', path, body });
    if (req.method === 'POST' && path === '/session') {
      return writeFixtureJson(res, 200, { value: { sessionId: 'session-1', capabilities: {} } });
    }
    if (req.method === 'POST' && path === '/session/session-1/actions') {
      return writeFixtureJson(res, 200, { value: null });
    }
    if (req.method === 'GET' && path === '/session/session-1/source') {
      return writeFixtureJson(res, 200, { value: '<AXApplication><AXTextArea value="Draft report"/></AXApplication>' });
    }
    if (req.method === 'DELETE' && path === '/session/session-1') {
      return writeFixtureJson(res, 200, { value: null });
    }
    return writeFixtureJson(res, 404, { value: { error: 'unknown command' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address');
  const tcpAddress: AddressInfo = address;
  return {
    url: `http://127.0.0.1:${tcpAddress.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function readFixtureBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

function writeFixtureJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export type _WindowActionTestGenericVisionAction = GenericVisionAction;
export type _WindowActionTestAdapterHandlers = WindowActionAdapterHandlers;
