import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import {
  CODEX_RUNTIME_WEBSOCKET_PATH,
  codexRuntimeBridgeRequested,
  handleCodexRuntimeRoutes,
  handleCodexRuntimeUpgrade,
} from './codex-runtime-server.js';
import type { AgentCliAdapter, AgentCliStartTurnInput } from './agent-cli-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

test('HTTP/SSE endpoint streams normalized runtime events without raw JSONL as main text', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'say hello',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-ui',
        attemptId: 'codex-command-ui-attempt-1',
        codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
      }),
    });
    assert.equal(response.headers.get('content-type')?.startsWith('text/event-stream'), true);
    const text = await response.text();

    assert.match(text, /event: realtime_session/);
    assert.match(text, /event: process-progress/);
    assert.match(text, /event: turn/);
    assert.match(text, /event: run_started/);
    assert.match(text, /event: message/);
    assert.match(text, /event: done/);
    assert.ok(text.indexOf('event: realtime_session') < text.indexOf('event: process-progress'));
    assert.ok(text.indexOf('event: process-progress') < text.indexOf('event: turn'));
    assert.match(text, /structured-events-plus-terminal-equivalent-text/);
    assert.match(text, /"rawTerminal":false/);
    assert.match(text, /codex-thread:019e3e82-164d-79b2-a5d4-b16241620b10/);
    assert.match(text, /正在启动 Codex app-server/);
    assert.equal(adapter.lastInput?.commandText, 'say hello');
    assert.equal(adapter.lastInput?.workspacePath, '/tmp/workspace');
    assert.equal(adapter.lastInput?.commandId, 'codex-command-ui');
    assert.equal(adapter.lastInput?.attemptId, 'codex-command-ui-attempt-1');
    assert.equal(adapter.lastInput?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
    assert.equal(adapter.lastInput?.abortSignal?.aborted, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('runtime bridge request detection does not treat legacy exec JSON as a product backend', () => {
  assert.equal(codexRuntimeBridgeRequested({ runtimeBridge: 'codex-app-server' }), true);
  assert.equal(codexRuntimeBridgeRequested({ runtimeBridge: 'codex-exec-json' }), false);
  assert.equal(codexRuntimeBridgeRequested({ uiState: { runtimeBridge: 'codex-exec-json' } }), false);
  assert.equal(codexRuntimeBridgeRequested({ useCodexRuntimeBridge: true }), true);
});

test('HTTP/SSE endpoint forwards safe composer Multitask intent as adapter metadata', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Compare the runtime and UI paths, then summarize the blockers.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-multitask-intent',
        attemptId: 'codex-command-multitask-intent-attempt-1',
        auditMetadata: {
          schemaVersion: 'sciforge.codex-runtime-stream-audit.v1',
          guiLocalProjection: {
            composerDeclaredIntents: {
              authorization: {
                profileId: 'high-autonomy',
                publicLabel: 'High Autonomy',
                source: 'composer-autonomy-menu',
                scope: {
                  user: 'current-user',
                  workspace: 'current-workspace',
                },
                singleTurnOverride: true,
                hardConfirmCategories: ['payments-transfers-purchases'],
                provider: 'private-provider-should-drop',
              },
              mode: {
                modeIntentId: 'multitask',
                publicLabel: 'Multitask',
                summaryGuidance: 'Coordinate parallel tasks.',
                actionId: 'action-mode-multitask',
                declaredAt: '2026-06-04T00:00:00.000Z',
                provider: 'private-provider-should-drop',
              },
            },
          },
        },
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Compare the runtime and UI paths, then summarize the blockers.',
          authorizationProfileId: 'high-autonomy',
          authorizationProfileSource: 'composer-autonomy-menu',
          authorizationScope: {
            user: 'current-user',
            workspace: 'current-workspace',
          },
          singleTurnOverride: true,
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          target: {
            bound: true,
            summary: 'Current app window',
            refs: ['window-action-session:current'],
          },
          observation: {
            fresh: true,
            refs: ['computer-use:observation/current-frame.png'],
          },
          permissions: {
            refs: ['permission:turn/gui-action'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: done/);
    assert.equal(adapter.lastInput?.commandText, 'Compare the runtime and UI paths, then summarize the blockers.');
    assert.deepEqual(adapter.lastInput?.declaredIntents, {
      authorization: {
        profileId: 'high-autonomy',
        publicLabel: 'High Autonomy',
        source: 'composer-autonomy-menu',
        scope: {
          user: 'current-user',
          workspace: 'current-workspace',
        },
        singleTurnOverride: true,
        hardConfirmCategories: ['payments-transfers-purchases'],
      },
      mode: {
        modeIntentId: 'multitask',
        publicLabel: 'Multitask',
        summaryGuidance: 'Coordinate parallel tasks.',
        actionId: 'action-mode-multitask',
        declaredAt: '2026-06-04T00:00:00.000Z',
      },
    });
    assert.deepEqual(adapter.lastInput?.agentHostGrounding?.authorizationProfile, {
      id: 'high-autonomy',
      publicLabel: 'High Autonomy',
      scope: {
        user: 'current-user',
        workspace: 'current-workspace',
      },
    });
    assert.equal(adapter.lastInput?.agentHostGrounding?.singleTurnOverride, true);
    assert.doesNotMatch(JSON.stringify(adapter.lastInput?.declaredIntents), /private-provider/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards bounded Agent Host grounding to downstream Runtime Codex turns', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Summarize the local plan from provided refs only.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-grounding',
        attemptId: 'codex-command-agent-host-grounding-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Summarize the local plan from provided refs only.',
          authorizationProfileId: 'high-autonomy',
          refs: ['runtime-health:workspace'],
          readiness: {
            items: [{
              id: 'workspace',
              status: 'online',
              capabilities: ['browser-host-session', 'browser-host-native-surface'],
            }],
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: turn/);
    assert.equal(adapter.lastInput?.commandText, 'Summarize the local plan from provided refs only.');
    assert.equal(adapter.lastInput?.agentHostGrounding?.schemaVersion, 'sciforge.agent-host.grounding-snapshot.v1');
    assert.equal(adapter.lastInput?.agentHostGrounding?.productCapabilities.computerUse, 'supported');
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.browser, 'ready');
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.computerUse, 'blocked');
    assert.ok(adapter.lastInput?.agentHostGrounding?.blockers.includes('window-action-session-unavailable'));
    assert.deepEqual(adapter.lastInput?.agentHostGrounding?.authorizationProfile?.scope, {
      user: 'current-user',
      workspace: 'current-workspace',
    });
    assert.deepEqual(adapter.lastInput?.agentHostGrounding?.refs, ['runtime-health:workspace']);
    assert.doesNotMatch(JSON.stringify(adapter.lastInput?.agentHostGrounding), /base64|raw|sk-private|provider\.local/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes Computer Use capability questions through Agent Host Turn Loop before adapter', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: '你有 computer use 能力么？',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-capability',
        attemptId: 'codex-command-agent-host-capability-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: '你有 computer use 能力么？',
          authorizationProfileId: 'high-autonomy',
          authorizationProfileSource: 'composer-autonomy-default',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            schemaVersion: 'sciforge.agent-host-runtime-readiness-projection.v1',
            source: 'ui-runtime-health-projection',
            items: [{
              id: 'workspace',
              status: 'online',
              capabilities: ['runtime-module-dispatcher', 'browser-host-session', 'browser-host-native-surface'],
            }],
            refs: ['runtime-health:workspace'],
          },
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /event: agent_host_turn_loop/);
    assert.match(text, /event: done/);
    assert.match(text, /Computer Use product capability is supported/i);
    assert.match(text, /runtime-capability-answer/);
    assert.doesNotMatch(text, /browser-host-session-unavailable|native-bridge-unavailable|native-surface-unavailable/);
    assert.match(text, /window-action-session-unavailable|computer-use-adapter-unavailable/);
    assert.doesNotMatch(text, /没有直接|no direct computer use/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes GUI operation intent through Computer Use Guard before adapter', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Click the visible export button in the current window.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-guard',
        attemptId: 'codex-command-agent-host-guard-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Click the visible export button in the current window.',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'blocked',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          target: {
            bound: true,
            summary: 'Current app window',
            refs: ['window-action-session:current'],
          },
          observation: {
            fresh: true,
            refs: ['computer-use:observation/current-frame.png'],
          },
          permissions: {
            refs: ['permission:turn/gui-action'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /event: agent_host_turn_loop/);
    assert.match(text, /Computer Use Guard blocked/i);
    assert.match(text, /native-surface-unavailable/);
    assert.match(text, /computer-use-preflight/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint keeps High Autonomy behind hard confirmation for submit intents', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Submit the registration form in the current browser window.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-confirm',
        attemptId: 'codex-command-agent-host-confirm-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Submit the registration form in the current browser window.',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          target: {
            bound: true,
            summary: 'Registration form',
            refs: ['browser-host-session:form'],
          },
          observation: {
            fresh: true,
            refs: ['browser-host-session:form/frame.png'],
          },
          permissions: {
            refs: ['permission:turn/form-draft'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /requires hard confirmation/i);
    assert.match(text, /needs-confirmation/);
    assert.match(text, /"controls":\["Confirm","Cancel"\]/);
    assert.match(text, /"authorizationProfile":\{"schemaVersion":"sciforge\.authorization-profile\.v1","id":"high-autonomy"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint treats ready Computer Use preflight as Act-waiting, not executed work', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Scroll the current browser page to inspect visible results.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-ready-for-act',
        attemptId: 'codex-command-agent-host-ready-for-act-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Scroll the current browser page to inspect visible results.',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          target: {
            bound: true,
            summary: 'Current browser page',
            refs: ['browser-host-session:visible'],
          },
          observation: {
            fresh: true,
            refs: ['browser-host-session:visible/frame.png'],
          },
          permissions: {
            refs: ['permission:turn/low-risk-navigation'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /ready-for-act/);
    assert.match(text, /Act is waiting for a refs-first action runner\/materializer/);
    assert.match(text, /"protocolStatus":"protocol-paused"/);
    assert.match(text, /"taskOutcome":"needs-work"/);
    assert.doesNotMatch(text, /"status":"done","params":"\{\\?"authorizationProfile/);
    assert.doesNotMatch(text, /"taskOutcome":"satisfied"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint can route ready Computer Use Guard into injected Act materializer', async () => {
  const adapter = new FakeAdapter();
  let materializerCalled = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter, {
      computerUseActMaterializer: async ({ preflight, abortSignal }) => {
        materializerCalled = true;
        assert.equal(preflight.status, 'ready');
        assert.ok(abortSignal instanceof AbortSignal);
        assert.equal(abortSignal.aborted, false);
        return {
          status: 'completed',
          message: 'Computer Use action executed by injected runtime materializer.',
          evidenceRefs: ['browser-host-session:visible/action-state/scroll-1'],
          executionUnits: [{
            id: 'EU-injected-computer-use-act',
            tool: 'browser-host-session.computer-use-action',
            status: 'done',
            outputRef: 'browser-host-session:visible/action-state/scroll-1',
          }],
        };
      },
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Scroll the current browser page to inspect visible results.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-act-materializer',
        attemptId: 'codex-command-agent-host-act-materializer-attempt-1',
        agentHostInput: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
      }),
    });
    const text = await response.text();

    assert.equal(materializerCalled, true);
    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /Computer Use action executed by injected runtime materializer/);
    assert.match(text, /browser-host-session\.computer-use-action/);
    assert.doesNotMatch(text, /ready-for-act/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint keeps High Autonomy behind every hard-confirm category', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  const actions = [
    'Pay the invoice in the current browser window.',
    'Send this email to the external collaborator.',
    'Submit the registration form in the current browser window.',
    'Delete the remote project file.',
    'Upload this report to the external portal.',
    'Change the account security token.',
    'Sign the legal contract.',
    'Deploy this release to production.',
  ];

  try {
    for (const [index, action] of actions.entries()) {
      const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandText: action,
          workspacePath: '/tmp/workspace',
          commandId: `codex-command-agent-host-hard-confirm-${index}`,
          attemptId: `codex-command-agent-host-hard-confirm-${index}-attempt-1`,
          agentHostInput: readyAgentHostInput(action),
        }),
      });
      const text = await response.text();

      assert.match(text, /requires hard confirmation/i);
      assert.match(text, /needs-confirmation/);
      assert.match(text, /"controls":\["Confirm","Cancel"\]/);
    }
    assert.equal(adapter.lastInput, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint reports Web dev blockers and desktop-ready capability readiness from Agent Host truth', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const webResponse = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: '你有 computer use 能力么？',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-webdev-blocked',
        attemptId: 'codex-command-agent-host-webdev-blocked-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: '你有 computer use 能力么？',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            schemaVersion: 'sciforge.agent-host-runtime-readiness-projection.v1',
            source: 'ui-runtime-health-projection',
            items: [{ id: 'workspace', status: 'offline', capabilities: [] }],
            refs: ['runtime-health:workspace'],
          },
        },
      }),
    });
    const webText = await webResponse.text();
    assert.match(webText, /native-bridge-unavailable/);
    assert.match(webText, /native-surface-unavailable/);

    const readyResponse = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: '你有 computer use 能力么？',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-ready',
        attemptId: 'codex-command-agent-host-ready-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: '你有 computer use 能力么？',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
        },
      }),
    });
    const readyText = await readyResponse.text();
    assert.match(readyText, /current runtime readiness is ready/i);
    assert.doesNotMatch(readyText, /unavailable/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint lets runtime truth override UI readiness hints before capability answers', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter, {
      agentHostRuntimeTruthResolver: async () => ({
        schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
        source: 'test-runtime-truth-resolver',
        readiness: {
          browserHostSession: 'blocked',
          nativeBridge: 'blocked',
          nativeSurface: 'blocked',
          windowActionSession: 'blocked',
          computerUseAdapter: 'blocked',
        },
        refs: ['runtime-truth:test-blocked'],
      }),
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: '你有 computer use 能力么？',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-runtime-truth-blocked',
        attemptId: 'codex-command-agent-host-runtime-truth-blocked-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: '你有 computer use 能力么？',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /event: agent_host_turn_loop/);
    assert.match(text, /current runtime readiness is blocked/i);
    assert.match(text, /browser-host-session-unavailable/);
    assert.match(text, /runtime-truth:test-blocked/);
    assert.doesNotMatch(text, /current runtime readiness is ready/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint injects runtime truth into downstream grounding for non-intercepted turns', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter, {
      agentHostRuntimeTruthResolver: async () => ({
        schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
        source: 'test-runtime-truth-resolver',
        readiness: {
          browserHostSession: 'blocked',
          nativeBridge: 'blocked',
          nativeSurface: 'blocked',
          windowActionSession: 'blocked',
          computerUseAdapter: 'blocked',
        },
        target: {
          bound: false,
          summary: 'Runtime truth found no bound target',
          refs: ['runtime-truth:target-unbound'],
        },
        observation: {
          fresh: false,
          refs: ['runtime-truth:observation-missing'],
        },
        permissions: {
          refs: [],
          stopCancelPath: false,
        },
        refs: ['runtime-truth:test-grounding'],
      }),
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Summarize the local plan from provided refs only.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-runtime-grounding',
        attemptId: 'codex-command-agent-host-runtime-grounding-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Summarize the local plan from provided refs only.',
          authorizationProfileId: 'high-autonomy',
          readiness: {
            browserHostSession: 'ready',
            nativeBridge: 'ready',
            nativeSurface: 'ready',
            windowActionSession: 'ready',
            computerUseAdapter: 'ready',
          },
          target: {
            bound: true,
            summary: 'UI-projected target',
            refs: ['ui:target-ready'],
          },
          observation: {
            fresh: true,
            refs: ['ui:observation-ready'],
          },
          permissions: {
            refs: ['ui:permission-ready'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: turn/);
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.browser, 'blocked');
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.computerUse, 'blocked');
    assert.equal(adapter.lastInput?.agentHostGrounding?.actionContext.targetBound, false);
    assert.equal(adapter.lastInput?.agentHostGrounding?.actionContext.freshObservation, false);
    assert.equal(adapter.lastInput?.agentHostGrounding?.actionContext.permissionRefsPresent, false);
    assert.equal(adapter.lastInput?.agentHostGrounding?.actionContext.stopCancelPath, false);
    assert.ok(adapter.lastInput?.agentHostGrounding?.refs.includes('runtime-truth:test-grounding'));
    assert.doesNotMatch(JSON.stringify(adapter.lastInput?.agentHostGrounding), /ui:target-ready|ui:observation-ready|ui:permission-ready/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint blocks invalid explicit Autonomy profile before adapter', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Click the visible button.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-invalid-profile',
        attemptId: 'codex-command-agent-host-invalid-profile-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Click the visible button.',
          authorizationProfileId: 'private-provider-max',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /Invalid Autonomy profile/i);
    assert.match(text, /declared-invalid-profile/);
    assert.match(text, /did not silently fall back/i);
    assert.match(text, /"status":"blocked"/);
    assert.doesNotMatch(text, /event: turn/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function readyAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ui-normal-composer-transport',
    intentText,
    authorizationProfileId: 'high-autonomy',
    policyOwner: 'codex-agent-host-runtime',
    readiness: {
      browserHostSession: 'ready',
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      bound: true,
      summary: 'Current browser window',
      refs: ['browser-host-session:current'],
    },
    observation: {
      fresh: true,
      refs: ['browser-host-session:current/frame.png'],
    },
    permissions: {
      refs: ['permission:turn/gui-action'],
      stopCancelPath: true,
    },
  };
}

test('HTTP/SSE endpoint routes current external fact requests to BrowserHostSession search runtime', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'What is the current Python release? cite source URLs.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser',
        attemptId: 'codex-command-agent-host-browser-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'What is the current Python release? cite source URLs.',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /event: agent_host_turn_loop/);
    assert.match(text, /browser-host-search-runtime/);
    assert.match(text, /BrowserHostSession browser_search failed|BrowserHostSession search returned/i);
    assert.doesNotMatch(text, /raw DOM|base64|data:image/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('product Runtime Codex factory stays on Codex app-server and does not import exec JSON fallback', async () => {
  const productSources = [
    ['runtime factory', './codex-runtime-adapter.ts'],
    ['runtime gateway', './codex-runtime-gateway.ts'],
    ['standalone server', './codex-runtime-standalone-server.ts'],
    ['workspace server', '../workspace-server.ts'],
    ['repair handoff runner', '../repair-handoff-runner.ts'],
    ['feedback guidance', '../workspace-server-feedback-guidance.ts'],
    ['computer-use planner', './computer-use-text-planner.ts'],
    ['ui runtime client', '../../ui/src/api/sciforgeToolsClient/client.ts'],
    ['ui realtime client', '../../ui/src/api/sciforgeToolsClient/codexRealtimeSession.ts'],
  ] as const;
  const appServerSources = new Set(['runtime factory', 'runtime gateway', 'standalone server']);

  for (const [label, file] of productSources) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    if (appServerSources.has(label)) {
      assert.match(source, /createCodexAppServerRuntimeAdapter|CodexAppServerAdapter/, label);
    }
    assert.doesNotMatch(source, /codex-exec-json-adapter|CodexExecJsonAdapter|codex exec --json/i, label);
  }
});

test('product Runtime Codex entries wire default composite Computer Use Act materializer', async () => {
  const productSources = [
    ['standalone server', './codex-runtime-standalone-server.ts'],
    ['workspace server', '../workspace-server.ts'],
  ] as const;

  for (const [label, file] of productSources) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /createDefaultComputerUseActMaterializer/, label);
    assert.match(source, /computerUseActMaterializer/, label);
  }

  const compositeSource = await readFile(new URL('./agent-host-computer-use-act-materializer.ts', import.meta.url), 'utf8');
  assert.match(compositeSource, /createDefaultBrowserHostComputerUseActMaterializer/);
  assert.match(compositeSource, /createDefaultVirtualAppScreenComputerUseActMaterializer/);
});

test('HTTP/SSE endpoint fails closed when the Codex app-server adapter is unavailable', async () => {
  const adapter: AgentCliAdapter = {
    async startTurn() {
      throw new Error('Codex app-server unavailable');
    },
    async cancel() {},
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'say hello',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-fail-closed',
        attemptId: 'codex-command-fail-closed-attempt-1',
      }),
    });
    const text = await response.text();

    assert.match(text, /event: realtime_session/);
    assert.match(text, /event: process-progress/);
    assert.match(text, /event: error/);
    assert.match(text, /Codex app-server unavailable/);
    assert.doesNotMatch(text, /codex-exec-json|CodexExecJsonAdapter|exec --json/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint accepts explicit realtime session envelope as the native thread source', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'continue selected report',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-ui',
        attemptId: 'codex-command-ui-attempt-1',
        codexSessionId: 'legacy-session-should-not-win',
        realtimeSession: {
          schemaVersion: 'sciforge.codex-realtime-session.v1',
          bridge: 'codex-native-realtime-session',
          streamKind: 'structured-events-plus-terminal-equivalent-text',
          eventTransport: 'sse',
          eventContract: 'structured-events',
          inputTextKind: 'terminal-equivalent-text',
          rawTerminal: false,
          commandId: 'codex-command-ui',
          attemptId: 'codex-command-ui-attempt-1',
          codexSessionId: '019e4332-4e6a-79a0-9a01-d35253a5614a',
          threadRef: 'codex-thread:019e4332-4e6a-79a0-9a01-d35253a5614a',
          resumeRequested: true,
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: realtime_session/);
    assert.match(text, /019e4332-4e6a-79a0-9a01-d35253a5614a/);
    assert.equal(adapter.lastInput?.codexSessionId, '019e4332-4e6a-79a0-9a01-d35253a5614a');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WebSocket endpoint receives realtime session requests and streams structured runtime events', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleCodexRuntimeUpgrade(req, socket, head, adapter)) socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;
  const received: Array<Record<string, unknown>> = [];

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CODEX_RUNTIME_WEBSOCKET_PATH}`);
    ws.on('message', (raw) => {
      received.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({
      commandText: 'say hello over ws',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-ws',
      attemptId: 'codex-command-ws-attempt-1',
      realtimeSession: {
        schemaVersion: 'sciforge.codex-realtime-session.v1',
        bridge: 'codex-native-realtime-session',
        streamKind: 'structured-events-plus-terminal-equivalent-text',
        eventTransport: 'websocket',
        eventContract: 'structured-events',
        inputTextKind: 'terminal-equivalent-text',
        rawTerminal: false,
        commandId: 'codex-command-ws',
        attemptId: 'codex-command-ws-attempt-1',
        codexSessionId: '019e4332-4e6a-79a0-9a01-d35253a5614a',
        threadRef: 'codex-thread:019e4332-4e6a-79a0-9a01-d35253a5614a',
        resumeRequested: true,
      },
    }));
    await once(ws, 'close');

    assert.deepEqual(received.map((message) => message.event), [
      'realtime_session',
      'process-progress',
      'turn',
      'run_started',
      'message',
      'done',
    ]);
    assert.equal((received[0]?.data as Record<string, unknown>).eventTransport, 'websocket');
    assert.equal(adapter.lastInput?.commandText, 'say hello over ws');
    assert.equal(adapter.lastInput?.codexSessionId, '019e4332-4e6a-79a0-9a01-d35253a5614a');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WebSocket endpoint accepts structured cancel controls without raw terminal input', async () => {
  const adapter = new BlockingAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleCodexRuntimeUpgrade(req, socket, head, adapter)) socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;
  const received: Array<Record<string, unknown>> = [];

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CODEX_RUNTIME_WEBSOCKET_PATH}`);
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(message);
      if (message.event === 'turn') {
        ws.send(JSON.stringify({
          schemaVersion: 'sciforge.codex-realtime-control.v1',
          controlType: 'cancel',
          commandId: 'codex-command-cancel',
          attemptId: 'codex-command-cancel-attempt-1',
          requestId: 'cancel-1',
          reason: 'test-cancel',
          rawTerminal: false,
        }));
      }
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({
      commandText: 'long running task',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-cancel',
      attemptId: 'codex-command-cancel-attempt-1',
      realtimeSession: {
        schemaVersion: 'sciforge.codex-realtime-session.v1',
        bridge: 'codex-native-realtime-session',
        streamKind: 'structured-events-plus-terminal-equivalent-text',
        eventTransport: 'websocket',
        eventContract: 'structured-events',
        inputTextKind: 'terminal-equivalent-text',
        rawTerminal: false,
        commandId: 'codex-command-cancel',
        attemptId: 'codex-command-cancel-attempt-1',
        resumeRequested: false,
      },
    }));
    await once(ws, 'close');

    const controlAck = received.find((message) => message.event === 'realtime_control')?.data as Record<string, unknown> | undefined;
    assert.equal(controlAck?.type, 'realtime_control');
    assert.equal(controlAck?.controlType, 'cancel');
    assert.equal(controlAck?.status, 'accepted');
    assert.equal(controlAck?.delivery, 'adapter-cancel');
    assert.equal(controlAck?.rawTerminal, false);
    assert.deepEqual(adapter.cancelledTurnIds, ['codex-command-cancel']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WebSocket cancel aborts the active turn even when adapter cancel hangs', async () => {
  const adapter = new HangingCancelAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleCodexRuntimeUpgrade(req, socket, head, adapter)) socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;
  const received: Array<Record<string, unknown>> = [];

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CODEX_RUNTIME_WEBSOCKET_PATH}`);
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(message);
      if (message.event === 'turn') {
        ws.send(JSON.stringify({
          schemaVersion: 'sciforge.codex-realtime-control.v1',
          controlType: 'cancel',
          commandId: 'codex-command-hanging-cancel',
          attemptId: 'codex-command-hanging-cancel-attempt-1',
          requestId: 'cancel-hanging',
          reason: 'test-hanging-cancel',
          rawTerminal: false,
        }));
      }
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({
      commandText: 'long running task with hanging cancel',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-hanging-cancel',
      attemptId: 'codex-command-hanging-cancel-attempt-1',
      realtimeSession: {
        schemaVersion: 'sciforge.codex-realtime-session.v1',
        bridge: 'codex-native-realtime-session',
        streamKind: 'structured-events-plus-terminal-equivalent-text',
        eventTransport: 'websocket',
        eventContract: 'structured-events',
        inputTextKind: 'terminal-equivalent-text',
        rawTerminal: false,
        commandId: 'codex-command-hanging-cancel',
        attemptId: 'codex-command-hanging-cancel-attempt-1',
        resumeRequested: false,
      },
    }));
    await Promise.race([
      once(ws, 'close'),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('cancel did not close websocket')), 1500)),
    ]);

    const controlAck = received.find((message) => message.event === 'realtime_control')?.data as Record<string, unknown> | undefined;
    assert.equal(controlAck?.status, 'accepted');
    assert.deepEqual(adapter.cancelledTurnIds, ['codex-command-hanging-cancel']);
    assert.equal(adapter.lastInput?.abortSignal?.aborted, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('WebSocket endpoint rejects raw terminal shaped controls', async () => {
  const adapter = new BlockingAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!handleCodexRuntimeUpgrade(req, socket, head, adapter)) socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;
  const received: Array<Record<string, unknown>> = [];

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${CODEX_RUNTIME_WEBSOCKET_PATH}`);
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(message);
      if (message.event === 'turn') {
        ws.send(JSON.stringify({
          schemaVersion: 'sciforge.codex-realtime-control.v1',
          controlType: 'interrupt',
          mode: 'cancel-current',
          message: 'raw terminal attempt',
          inputTextKind: 'raw-terminal',
          rawTerminal: true,
        }));
        ws.send(JSON.stringify({
          schemaVersion: 'sciforge.codex-realtime-control.v1',
          controlType: 'cancel',
          commandId: 'codex-command-raw-control',
          attemptId: 'codex-command-raw-control-attempt-1',
          rawTerminal: false,
        }));
      }
    });
    await once(ws, 'open');
    ws.send(JSON.stringify({
      commandText: 'long running task',
      workspacePath: '/tmp/workspace',
      commandId: 'codex-command-raw-control',
      attemptId: 'codex-command-raw-control-attempt-1',
      realtimeSession: {
        schemaVersion: 'sciforge.codex-realtime-session.v1',
        bridge: 'codex-native-realtime-session',
        streamKind: 'structured-events-plus-terminal-equivalent-text',
        eventTransport: 'websocket',
        eventContract: 'structured-events',
        inputTextKind: 'terminal-equivalent-text',
        rawTerminal: false,
        commandId: 'codex-command-raw-control',
        attemptId: 'codex-command-raw-control-attempt-1',
        resumeRequested: false,
      },
    }));
    await once(ws, 'close');

    const error = received.find((message) => message.event === 'error')?.data as Record<string, unknown> | undefined;
    assert.match(String(error?.error), /structured control frames/);
    assert.deepEqual(adapter.cancelledTurnIds, ['codex-command-raw-control']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint rejects raw terminal realtime session envelopes before adapter context', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'say hello',
        workspacePath: '/tmp/workspace',
        realtimeSession: {
          schemaVersion: 'sciforge.codex-realtime-session.v1',
          bridge: 'codex-native-realtime-session',
          streamKind: 'raw-terminal',
          eventTransport: 'pty',
          eventContract: 'raw-bytes',
          inputTextKind: 'raw-terminal',
          rawTerminal: true,
          resumeRequested: false,
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: error/);
    assert.match(text, /structured events plus terminal-equivalent text/);
    assert.equal(adapter.lastInput, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint rejects legacy GUI handoff fields before adapter context', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Summarize the selected report',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-ui',
        sessionMessages: [{ role: 'scenario', content: 'GUI_TRANSCRIPT_SHOULD_NOT_ENTER_CODEX' }],
        demoMessages: [{ content: 'SEED_DEMO_SHOULD_NOT_ENTER_CODEX' }],
        artifacts: [{ id: 'report-1', data: { markdown: 'ARTIFACT_BODY_SHOULD_NOT_ENTER_CODEX' } }],
        claims: [{ text: 'CLAIM_SHOULD_NOT_ENTER_CODEX' }],
        expectedResult: 'EXPECTED_RESULT_SHOULD_NOT_ENTER_CODEX',
        toolProviderRoutes: { web: { provider: 'legacy-route' } },
        providerRoute: { provider: 'openai' },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: error/);
    assert.match(text, /non-adapter fields/);
    assert.equal(adapter.lastInput, undefined);
    assert.doesNotMatch(text, /GUI_TRANSCRIPT_SHOULD_NOT_ENTER_CODEX|ARTIFACT_BODY_SHOULD_NOT_ENTER_CODEX|CLAIM_SHOULD_NOT_ENTER_CODEX/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint rejects GUI extension transcript payloads before adapter context', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Summarize the selected report',
        workspacePath: '/tmp/workspace',
        guiExtension: {
          enabled: true,
          transcript: 'GUI_TRANSCRIPT_SHOULD_NOT_ENTER_CODEX',
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: error/);
    assert.match(text, /guiExtension contains non-adapter fields/);
    assert.equal(adapter.lastInput, undefined);
    assert.doesNotMatch(text, /GUI_TRANSCRIPT_SHOULD_NOT_ENTER_CODEX/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint rejects legacy handoff fields nested in audit metadata', async () => {
  const adapter = new FakeAdapter();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Summarize the selected report',
        workspacePath: '/tmp/workspace',
        auditMetadata: {
          schemaVersion: 'test',
          nested: {
            artifactBody: 'ARTIFACT_BODY_SHOULD_NOT_ENTER_CODEX',
            expectedResult: 'EXPECTED_RESULT_SHOULD_NOT_ENTER_CODEX',
            guiLocalProjection: {
              messages: [{ content: 'SEED_MESSAGE_SHOULD_NOT_LEAK' }],
            },
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: error/);
    assert.match(text, /auditMetadata contains non-adapter fields/);
    assert.match(text, /nested\.artifactBody|nested\.expectedResult|nested\.guiLocalProjection\.messages/);
    assert.equal(adapter.lastInput, undefined);
    assert.doesNotMatch(text, /ARTIFACT_BODY_SHOULD_NOT_ENTER_CODEX|EXPECTED_RESULT_SHOULD_NOT_ENTER_CODEX|SEED_MESSAGE_SHOULD_NOT_LEAK/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

class FakeAdapter implements AgentCliAdapter {
  lastInput?: AgentCliStartTurnInput;
  readonly cancelledTurnIds: string[] = [];

  async startTurn(input: AgentCliStartTurnInput) {
    this.lastInput = input;
    return {
      turnId: 'codex-test-turn',
      attemptId: input.attemptId ?? 'codex-test-turn-attempt-1',
      codexSessionId: input.codexSessionId,
      events: this.events(),
    };
  }

  async cancel(turnId: string) {
    this.cancelledTurnIds.push(turnId);
  }

  private async *events(): AsyncIterable<NormalizedAgentEvent> {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date().toISOString(),
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/workspace',
      commandId: 'codex-test-turn',
      attemptId: 'codex-test-turn-attempt-1',
      evidenceRefs: ['audit:codex-runtime:codex-test-turn:codex-test-turn-attempt-1:normalized-events'],
    };
    yield { ...base, type: 'run_started', message: 'started' };
    yield { ...base, type: 'message', text: 'hello' };
    yield { ...base, type: 'done', status: 'done' };
  }
}

class BlockingAdapter extends FakeAdapter {
  override async startTurn(input: AgentCliStartTurnInput) {
    this.lastInput = input;
    const commandId = input.commandId ?? 'codex-command-blocking';
    const attemptId = input.attemptId ?? 'codex-command-blocking-attempt-1';
    return {
      turnId: commandId,
      attemptId,
      codexSessionId: input.codexSessionId,
      events: this.blockingEvents(input, commandId, attemptId),
    };
  }

  private async *blockingEvents(
    input: AgentCliStartTurnInput,
    commandId: string,
    attemptId: string,
  ): AsyncIterable<NormalizedAgentEvent> {
    const base = {
      schemaVersion: 'sciforge.codex.normalized-event.v1' as const,
      timestamp: new Date().toISOString(),
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      profile: 'sciforge-runtime-deepseek',
      workspace: '/tmp/workspace',
      commandId,
      attemptId,
      evidenceRefs: ['audit:codex-runtime:codex-test-turn:codex-test-turn-attempt-1:normalized-events'],
    };
    yield { ...base, type: 'run_started', message: 'started' };
    await new Promise<void>((resolve) => {
      if (input.abortSignal?.aborted) resolve();
      else input.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

class HangingCancelAdapter extends BlockingAdapter {
  override async cancel(turnId: string) {
    this.cancelledTurnIds.push(turnId);
    await new Promise<void>(() => undefined);
  }
}
