import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBrowserHostComputerUseActMaterializer } from './agent-host-browser-computer-use-act-materializer.js';
import type { BrowserHostSessionManager } from '../browser-host-session.js';
import type { ComputerUsePreflightResult } from '../../../packages/contracts/runtime/default-browser-computer-use-policy.js';
import type { CodexAgentHostRuntimeTruth, NormalizedCodexAgentHostInput } from './agent-host-turn-loop.js';

test('BrowserHost Computer Use Act materializer executes a planned low-risk action through BrowserHostSession', async () => {
  const acted: Array<{ workspacePath: string; sessionId: string; input: Record<string, unknown> }> = [];
  const manager = {
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
  assert.doesNotMatch(JSON.stringify(result), /gui\.present|ui:|fixture:|replay:/);
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

function readyAgentHostInput(): NormalizedCodexAgentHostInput {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'test',
    intentText: 'Scroll the current browser page.',
    authorizationProfileId: 'high-autonomy',
    singleTurnOverride: false,
    refs: ['browser-host-session:verified'],
    readiness: {},
    target: {},
    observation: {},
    permissions: {},
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
    evidenceRefs: ['browser-host-session:verified/frame.png', 'permission:turn/codex-command-browser-act/ordinary-navigation'],
    risk: {
      decision: 'auto',
      category: 'ordinary-navigation',
      hardConfirm: false,
      reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
    },
    blockers: [],
  };
}

function runtimeTruth(): CodexAgentHostRuntimeTruth {
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
    observation: {
      fresh: true,
      refs: ['browser-host-session:verified/frame.png'],
    },
    permissions: {
      refs: ['permission:turn/codex-command-browser-act/ordinary-navigation'],
      stopCancelPath: true,
    },
    refs: [
      'browser-host-session:verified',
      'window-action-session:browser-host-session/verified',
      'adapter-registry:browser-host-session/computer-use',
      'browser-host-session:verified/stop',
      'cancel:runtime-turn/codex-command-browser-act',
    ],
  };
}
