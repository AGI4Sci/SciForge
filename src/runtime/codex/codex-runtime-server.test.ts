import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('HTTP/SSE endpoint forwards sanitized Computer Use completion evidence policy as host intent metadata', async () => {
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
        commandText: '/computer-use write a visible report',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-policy',
        attemptId: 'codex-command-policy-attempt-1',
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
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: done/);
    assert.deepEqual(adapter.lastInput?.runtimeIntent?.completionEvidencePolicy, {
      schemaVersion: 'sciforge.completion-evidence-policy.v1',
      producers: [{
        id: 'computer-use.embedded-isolated-desktop-l3',
        enabled: true,
        trigger: 'on-completed-current-run',
      }],
    });
    assert.deepEqual(adapter.lastInput?.runtimeIntent?.computerUseNext, {
      taskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      requirements: ['refs-first-evidence-bundle'],
      safetyBoundary: {
        noDomAccessibility: true,
      },
    });
    assert.deepEqual(adapter.lastInput?.runtimeIntent?.computerUseLong, {
      taskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      safetyBoundary: {
        noDomAccessibility: true,
      },
    });
    assert.doesNotMatch(JSON.stringify(adapter.lastInput), /SECRET_POLICY_SHOULD_NOT_LEAK|SECRET_PRODUCER_SHOULD_NOT_LEAK|unknown-producer|SECRET_NEXT_SHOULD_NOT_LEAK|SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK|SECRET_LONG_SHOULD_NOT_LEAK|cuNextTaskId|requiredEvidence/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint scrubs approval provenance sidecars before adapter', async () => {
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
        commandText: '/computer-use approve guarded action',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-approval-provenance-sanitize',
        attemptId: 'codex-command-approval-provenance-sanitize-attempt-1',
        humanApproval: {
          approvalRef: 'approval:safe-ref',
          decision: 'approved',
          source: 'runtime-gui',
          approvalProvenance: {
            source: 'runtime-gui',
            actor: 'current-user',
            refs: ['approval:safe-ref', 'permission:turn/gui-action'],
            approvalRequestSidecar: {
              rawUrl: 'https://example.invalid/SECRET_APPROVAL_URL',
              apiKey: 'SECRET_APPROVAL_API_KEY',
              providerPayload: { request: 'SECRET_PROVIDER_PAYLOAD' },
            },
            guiAskUserSidecar: {
              screenshotBase64: 'data:image/png;base64,SECRET_APPROVAL_IMAGE',
            },
            riskAuditSidecar: {
              highRiskAction: {
                secret: 'SECRET_HIGH_RISK_ACTION',
              },
            },
            nested: {
              note: 'safe approval note',
              rawScenario: {
                url: 'https://example.invalid/SECRET_SCENARIO_URL',
              },
              publicFlag: true,
            },
          },
        },
        uiState: {
          schemaVersion: 'sciforge.runtime-codex.approval-ui.v1',
          approvalRef: 'approval:safe-ref',
          computerUseApprovalRef: 'approval:safe-ref',
          terminalEquivalentText: true,
          approvalProvenance: {
            source: 'runtime-gui',
            refs: ['approval:safe-ref'],
            approvalRequest: {
              url: 'https://example.invalid/SECRET_UI_APPROVAL_URL',
              providerPayload: 'SECRET_UI_PROVIDER_PAYLOAD',
            },
            safePrimitive: 'approved by user',
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: done/);
    assert.deepEqual(adapter.lastInput?.humanApproval, {
      approvalRef: 'approval:safe-ref',
      decision: 'approved',
      source: 'runtime-gui',
      approvalProvenance: {
        source: 'runtime-gui',
        actor: 'current-user',
        refs: ['approval:safe-ref', 'permission:turn/gui-action'],
        nested: {
          note: 'safe approval note',
          publicFlag: true,
        },
      },
    });
    assert.deepEqual(adapter.lastInput?.uiState, {
      schemaVersion: 'sciforge.runtime-codex.approval-ui.v1',
      approvalRef: 'approval:safe-ref',
      computerUseApprovalRef: 'approval:safe-ref',
      terminalEquivalentText: true,
      approvalProvenance: {
        source: 'runtime-gui',
        refs: ['approval:safe-ref'],
        safePrimitive: 'approved by user',
      },
    });
    assert.doesNotMatch(JSON.stringify(adapter.lastInput), /SECRET|Sidecar|sidecar|approvalRequest|highRiskAction|rawScenario|rawUrl|providerPayload|screenshotBase64|data:image|base64|apiKey|example\.invalid/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint derives host-owned Computer Use runtime intent from command text', async () => {
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
        commandText: '/computer-use click the guarded Submit button',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-derived-intent',
        attemptId: 'codex-command-derived-intent-attempt-1',
      }),
    });
    const text = await response.text();

    assert.match(text, /event: done/);
    assert.deepEqual(adapter.lastInput?.runtimeIntent, {
      schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
      kind: 'computer-use-native-route',
      source: 'host-owned',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint lets explicit Computer Use native route intent bypass Agent Host turn loop', async () => {
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
  const commandText = [
    '/computer-use Use SciForge Desktop for a repair workflow when a required source or app state is unavailable in the current product surface.',
    'Return repair-needed with blocked-manifest.json, repair-hint.json, continuation-request.json, run-task-chain refs, and current-run trace refs.',
  ].join(' ');

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-native-priority',
        attemptId: 'codex-command-native-priority-attempt-1',
        runtimeIntent: {
          schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
          kind: 'computer-use-native-route',
          source: 'host-owned',
          computerUseNext: { taskId: 'CU-NEXT-05' },
          computerUseLong: { taskId: 'CU-NEXT-05', scenarioId: 'CU-LONG-006' },
        },
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          authorizationProfileSource: 'composer-autonomy-default',
          policyOwner: 'codex-agent-host-runtime',
          readiness: {
            schemaVersion: 'sciforge.agent-host-runtime-readiness-projection.v1',
            source: 'ui-runtime-health-projection',
            items: [{
              id: 'workspace',
              status: 'online',
              capabilities: [
                'runtime-module-dispatcher',
                'browser-host-session',
                'browser-host-native-surface',
                'computer-use-adapter',
              ],
            }],
            refs: ['runtime-health:workspace'],
          },
        },
      }),
    });
    const text = await response.text();

    assert.match(text, /event: turn/);
    assert.doesNotMatch(text, /event: agent_host_turn_loop/);
    assert.deepEqual(adapter.lastInput?.runtimeIntent, {
      schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
      kind: 'computer-use-native-route',
      source: 'host-owned',
      computerUseNext: { taskId: 'CU-NEXT-05' },
      computerUseLong: { taskId: 'CU-NEXT-05', scenarioId: 'CU-LONG-006' },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
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
            scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
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

test('HTTP/SSE endpoint routes Computer Use capability questions to upstream adapter without local Agent Host finalization', async () => {
  const adapter = new FakeAdapter();
  const commandText = '你有 computer use 能力么？';
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
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-capability',
        attemptId: 'codex-command-agent-host-capability-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
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

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'Computer Use capability question',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /runtime-capability-answer|Computer Use product capability is supported/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes GUI operation intent to upstream adapter instead of local Computer Use Guard finalization', async () => {
  const adapter = new FakeAdapter();
  const commandText = 'Click the visible export button in the current window.';
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
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-guard',
        attemptId: 'codex-command-agent-host-guard-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
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
            scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'GUI operation intent',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /Computer Use Guard blocked|computer-use-preflight/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards Computer Use guard matrix blockers to upstream adapter grounding', async () => {
  const server = createServer();
  const adapter = new FakeAdapter();
  server.on('request', (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  if (typeof address !== 'object') throw new Error(`expected TCP address, got ${address}`);
  const port = (address as AddressInfo).port;

  const commandText = 'Click the visible export button in the current window.';
  const cases = [
    {
      name: 'native-host',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        readiness: {
          ...readyAgentHostInput(commandText).readiness,
          nativeBridge: 'blocked',
          nativeSurface: 'blocked',
        },
      },
      reason: /native-bridge-unavailable|native-surface-unavailable/,
      recovery: /Start or reconnect the Desktop native bridge|Desktop native Browser surface/i,
    },
    {
      name: 'target-binding',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        target: { bound: false, summary: 'No selected target', refs: [] },
      },
      reason: /target-unbound/,
      recovery: /Select or bind a Browser session, app window, screen region, file, terminal, or workspace object/i,
    },
    {
      name: 'fresh-evidence',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        observation: { fresh: false, refs: [] },
      },
      reason: /needs-observation/,
      recovery: /Capture a fresh observation ref/i,
    },
    {
      name: 'permission-refs',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: [],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: true,
        },
      },
      reason: /permission-missing/,
      recovery: /Collect a scoped permission ref/i,
    },
    {
      name: 'scoped-executor',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: [],
          stopCancelPath: true,
        },
      },
      reason: /scoped-executor-missing/,
      recovery: /Provide a scoped executor ref/i,
    },
    {
      name: 'stop-cancel',
      agentHostInput: {
        ...readyAgentHostInput(commandText),
        permissions: {
          refs: ['permission:turn/gui-action'],
          scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
          stopCancelPath: false,
        },
      },
      reason: /cancel-path-missing/,
      recovery: /Provide a stop, cancel, or take-over path/i,
    },
  ];

  try {
    for (const entry of cases) {
      const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandText,
          workspacePath: '/tmp/workspace',
          commandId: `codex-command-agent-host-${entry.name}-blocked`,
          attemptId: `codex-command-agent-host-${entry.name}-blocked-attempt-1`,
          agentHostInput: entry.agentHostInput,
        }),
      });
      const text = await response.text();

      assertRuntimeTurnRoutedToUpstreamAdapter({
        label: `Computer Use guard matrix ${entry.name}`,
        text,
        adapter,
        commandText,
      });
      assert.match(JSON.stringify(adapter.lastInput?.agentHostGrounding), entry.reason, entry.name);
      assert.doesNotMatch(text, /Computer Use Guard blocked|ready-for-act|taskOutcome":"satisfied"/, entry.name);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards submit intents to upstream adapter instead of local hard confirmation', async () => {
  const adapter = new FakeAdapter();
  const commandText = 'Submit the registration form in the current browser window.';
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
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-confirm',
        attemptId: 'codex-command-agent-host-confirm-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
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
            scopedExecutorRefs: ['computer-use:executor-scope:registration-form'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'submit intent',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /requires hard confirmation|needs-confirmation|"controls":\["Confirm","Cancel"\]/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards GUI confirmation candidates to upstream adapter before local Computer Use invocation', async () => {
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
        commandText: 'Send the support message in the current app window.',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-gui-confirmation-request',
        attemptId: 'codex-command-agent-host-gui-confirmation-request-attempt-1',
        agentHostInput: readyAgentHostInput('Send the support message in the current app window.'),
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'GUI confirmation candidate',
      text,
      adapter,
      commandText: 'Send the support message in the current app window.',
    });
    assert.doesNotMatch(text, /needs-confirmation|"askUser"|"approvalRef":"approval:computer-use:|\/computer-use approve --approval-ref/);
    assert.doesNotMatch(text, /computer-use:executor:event-send/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards approved high-risk Computer Use turns to upstream adapter', async () => {
  const adapter = new FakeAdapter();
  const approvalRef = 'approval:computer-use:support-message';
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
        commandText: `/computer-use approve --approval-ref "${approvalRef}"`,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-gui-approved',
        attemptId: 'codex-command-agent-host-gui-approved-attempt-1',
        agentHostInput: readyAgentHostInput('Send the support message in the current app window.'),
        humanApproval: {
          approvalRef,
          decision: 'approved',
          source: 'runtime-gui',
          approvalProvenance: {
            source: 'runtime-gui',
            sourceStatus: 'needs-confirmation',
            approvalRef,
            refs: ['permission:turn/gui-action', 'computer-use:evidence:before-send'],
          },
        },
        uiState: {
          schemaVersion: 'sciforge.runtime-codex.approval-ui.v1',
          approvalRef,
          computerUseApprovalRef: approvalRef,
          terminalEquivalentText: true,
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'approved high-risk Computer Use turn',
      text,
      adapter,
      commandText: `/computer-use approve --approval-ref "${approvalRef}"`,
    });
    assert.doesNotMatch(text, /computer_use\.perform_local_action|computer-use:executor:event-send/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes ready Computer Use preflight to upstream adapter when no executor is wired', async () => {
  const adapter = new FakeAdapter();
  const commandText = 'Scroll the current browser page to inspect visible results.';
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
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-default-cu-bounded-operation',
        attemptId: 'codex-command-agent-host-default-cu-bounded-operation-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
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
            scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
            stopCancelPath: true,
          },
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'ready Computer Use preflight without executor',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /module\.invoke|missing_executor_port|"taskOutcome":"needs-work"/);
    assert.doesNotMatch(text, /"status":"done","params":"\{\\?"authorizationProfile/);
    assert.doesNotMatch(text, /"taskOutcome":"satisfied"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards ready Computer Use action turns to upstream adapter instead of local bounded action', async () => {
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
        commandId: 'codex-command-agent-host-cu-bounded-operation',
        attemptId: 'codex-command-agent-host-cu-bounded-operation-attempt-1',
        agentHostInput: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'ready Computer Use action turn',
      text,
      adapter,
      commandText: 'Scroll the current browser page to inspect visible results.',
    });
    assert.doesNotMatch(text, /module\.invoke|computer-use:evidence:after-scroll|computer_use\.perform_local_action/);
    assert.doesNotMatch(text, /browser-host-session\.computer-use-action|taskOutcome":"satisfied".*workflow|gui\.present:|fixture:|replay:|history:/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards incomplete local action evidence cases to upstream adapter', async () => {
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
        commandId: 'codex-command-agent-host-cu-incomplete-evidence',
        attemptId: 'codex-command-agent-host-cu-incomplete-evidence-attempt-1',
        agentHostInput: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'incomplete local action evidence case',
      text,
      adapter,
      commandText: 'Scroll the current browser page to inspect visible results.',
    });
    assert.doesNotMatch(text, /module\.invoke|missing current target-bound action evidence|stale-invalidation-ref|computer-use:evidence:after-scroll/);
    assert.doesNotMatch(text, /"displayIntent":\{"protocolStatus":"protocol-success"|"taskOutcome":"satisfied"|taskOutcome":"satisfied".*workflow|gui\.present:|fixture:|replay:|history:/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards Act materializer candidates to upstream adapter', async () => {
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
        commandId: 'codex-command-agent-host-act-materializer',
        attemptId: 'codex-command-agent-host-act-materializer-attempt-1',
        agentHostInput: readyAgentHostInput('Scroll the current browser page to inspect visible results.'),
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'Act materializer candidate',
      text,
      adapter,
      commandText: 'Scroll the current browser page to inspect visible results.',
    });
    assert.doesNotMatch(text, /current target-bound action evidence refs|browser-host-session\.computer-use-action|ready-for-act/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards every hard-confirm category to upstream adapter', async () => {
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

      assertRuntimeTurnRoutedToUpstreamAdapter({
        label: `hard-confirm category ${index}`,
        text,
        adapter,
        commandText: action,
      });
      assert.doesNotMatch(text, /requires hard confirmation|needs-confirmation|"controls":\["Confirm","Cancel"\]/i);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards capability readiness contexts to upstream adapter', async () => {
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
    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'web capability readiness context',
      text: webText,
      adapter,
      commandText: '你有 computer use 能力么？',
    });
    assert.match(JSON.stringify(adapter.lastInput?.agentHostGrounding), /native-bridge-unavailable|native-surface-unavailable/);
    assert.doesNotMatch(webText, /runtime-capability-answer|current runtime readiness/i);

    const readyResponse = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: '你有 computer use 能力么？',
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-ready',
        attemptId: 'codex-command-agent-host-ready-attempt-1',
        agentHostInput: readyAgentHostInput('你有 computer use 能力么？'),
      }),
    });
    const readyText = await readyResponse.text();
    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'desktop-ready capability readiness context',
      text: readyText,
      adapter,
      commandText: '你有 computer use 能力么？',
    });
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.computerUse, 'ready');
    assert.doesNotMatch(readyText, /runtime-capability-answer|current runtime readiness|unavailable/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards runtime truth override to upstream adapter grounding', async () => {
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

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'runtime truth override capability turn',
      text,
      adapter,
      commandText: '你有 computer use 能力么？',
    });
    assert.equal(adapter.lastInput?.agentHostGrounding?.runtimeReadiness.browser, 'blocked');
    assert.ok(adapter.lastInput?.agentHostGrounding?.refs.includes('runtime-truth:test-blocked'));
    assert.match(JSON.stringify(adapter.lastInput?.agentHostGrounding), /browser-host-session-unavailable/);
    assert.doesNotMatch(text, /current runtime readiness is blocked|current runtime readiness is ready/i);
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
            scopedExecutorRefs: ['computer-use:executor-scope:ui-projected-target'],
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

test('HTTP/SSE endpoint forwards invalid explicit Autonomy profile to upstream adapter', async () => {
  const adapter = new FakeAdapter();
  const commandText = 'Click the visible button.';
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
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-invalid-profile',
        attemptId: 'codex-command-agent-host-invalid-profile-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'private-provider-max',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'invalid explicit Autonomy profile',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /Invalid Autonomy profile|declared-invalid-profile|did not silently fall back/i);
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
      scopedExecutorRefs: ['computer-use:executor-scope:current-window'],
      stopCancelPath: true,
    },
  };
}

function assertRuntimeTurnRoutedToUpstreamAdapter({
  label,
  text,
  adapter,
  commandText,
}: {
  label: string;
  text: string;
  adapter: FakeAdapter;
  commandText: string;
}) {
  const localAgentHostIndex = text.indexOf('event: agent_host_turn_loop');
  const adapterTurnIndex = text.indexOf('event: turn');
  const finalDoneIndex = text.lastIndexOf('event: done');

  assert.equal(
    localAgentHostIndex,
    -1,
    `${label}: local agent_host_turn_loop must not emit a final done before adapter.startTurn`,
  );
  assert.notEqual(adapter.lastInput, undefined, `${label}: expected adapter.startTurn to receive the runtime turn`);
  assert.equal(adapter.lastInput?.commandText, commandText);
  assert.notEqual(adapterTurnIndex, -1, `${label}: expected upstream adapter turn event`);
  assert.ok(adapterTurnIndex < finalDoneIndex, `${label}: adapter turn event should precede final done`);
}

test('HTTP/SSE endpoint routes one-page PPT requests to upstream adapter instead of local artifact finalization', async () => {
  const adapter = new FakeAdapter();
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-runtime-server-ppt-artifact-'));
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
  const commandText = '做一页 PPT，主题是 bounded operation contract';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath,
        commandId: 'codex-command-sse-one-page-ppt',
        attemptId: 'codex-command-sse-one-page-ppt-attempt-1',
        agentHostInput: readyAgentHostInput(commandText),
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'one-page PPT request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /agent-host-artifact-generator|one-page-presentation\.pptx|one-page-presentation\.pptx\.validation\.json/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('HTTP/SSE endpoint routes current external fact requests to upstream adapter instead of local browser.search_read', async () => {
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
  const commandText = 'What is the current Python release? cite source URLs.';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser',
        attemptId: 'codex-command-agent-host-browser-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'current external fact request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /module\.invoke|Python current release evidence came from an opened and read source page/);
    assert.doesNotMatch(text, /browser-host-session:python-release\/source-pages\/source-1\.txt/);
    assert.doesNotMatch(text, /browser-host-search-runtime|browser_search|answerEvidenceState|browser-search-results|browser-host-projection/);
    assert.doesNotMatch(text, /raw DOM|base64|data:image/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes Chinese Browser search requests to upstream adapter instead of local bounded operation', async () => {
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
  const commandText = '通过内置浏览器搜索伊朗局势';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-cn',
        attemptId: 'codex-command-agent-host-browser-cn-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'Chinese Browser search request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /module\.invoke|browser-host-session:iran\/source-pages\/source-1\.txt/);
    assert.doesNotMatch(text, /browser-host-search-runtime|browser_search|answerEvidenceState|browser-search-results|browser-host-projection/);
    assert.doesNotMatch(text, /<Function:\s*browser_search>/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes explicit URL Browser requests to upstream adapter instead of local open_read', async () => {
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
  const commandText = 'Open and read https://example.test/source-page, then summarize it with refs.';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-open-read',
        attemptId: 'codex-command-agent-host-browser-open-read-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'explicit URL Browser request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /module\.invoke|browser\.open_read|The explicit source page was opened and read before the answer was synthesized/);
    assert.doesNotMatch(text, /browser-host-session:open\/source-pages\/source-1\.source\.json|browser-host-session:open\/source-pages\/source-1\.txt/);
    assert.doesNotMatch(text, /Bait: search results|browser-host-search-runtime|browser_search|answerEvidenceState|browser-search-results|browser-host-projection/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes Browser source-evidence cases to upstream adapter instead of local blocking', async () => {
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
  const commandText = 'What is the current Python release? Please cite source URLs.';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-blocked',
        attemptId: 'codex-command-agent-host-browser-blocked-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'Browser source evidence case',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /missing current-run source\/page text evidence|page-text-ref/);
    assert.doesNotMatch(text, /browser-host-session:blocked\/source-pages\/source-1\.source\.json/);
    assert.doesNotMatch(text, /Do not turn this preview into a final answer/);
    assert.doesNotMatch(text, /browser-host-search-runtime|answerEvidenceState|browser-search-results|browser-host-projection/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes local-only Browser requests to upstream adapter without invoking local Browser', async () => {
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
  const commandText = 'Do not use the internet. Summarize the current Python release from local notes only.';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-no-network',
        attemptId: 'codex-command-agent-host-browser-no-network-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: commandText,
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'local-only Browser request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /agent-host-browser-skip|local-only\/no-network/);
    assert.doesNotMatch(text, /module\.invoke|browser\.search_read|browser\.open_read|browser-host-search-runtime|browser_search/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes ambiguous BrowserHost search requests to upstream adapter for clarification', async () => {
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
  const commandText = 'ask --ref artifact:hf-papers-report "搜索今天 huggingface 上最火的工作"';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-clarification',
        attemptId: 'codex-command-agent-host-browser-clarification-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: '搜索今天 huggingface 上最火的工作',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'ambiguous BrowserHost search request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /request-clarification-runtime|Daily Papers|models|datasets|Spaces|jobs|职位/);
    assert.doesNotMatch(text, /browser-host-search-runtime|search-results|BrowserHostSession browser_search/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards malformed Agent Host input requests to upstream adapter', async () => {
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
  const commandText = 'ask --ref artifact:hf-papers-report "搜索今天 huggingface 上最火的工作"';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-clarification-malformed',
        attemptId: 'codex-command-agent-host-browser-clarification-malformed-attempt-1',
        agentHostInput: {
          source: 'malformed-without-schema',
          intentText: '',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'malformed Agent Host input request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /request-clarification-runtime|Daily Papers|models|datasets|Spaces|jobs|职位/);
    assert.doesNotMatch(text, /browser-host-search-runtime|search-results|BrowserHostSession browser_search/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint forwards quoted command drift to upstream adapter', async () => {
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
  const commandText = 'ask --ref "artifact:hf-papers-report" "搜索今天 huggingface 上最火的工作"';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-clarification-drift',
        attemptId: 'codex-command-agent-host-browser-clarification-drift-attempt-1',
        agentHostInput: {
          schemaVersion: 'sciforge.codex-agent-host-input.v1',
          source: 'ui-normal-composer-transport',
          intentText: 'Summarize current context.',
          authorizationProfileId: 'high-autonomy',
          policyOwner: 'codex-agent-host-runtime',
        },
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'quoted command drift request',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /request-clarification-runtime|Daily Papers|models|datasets|Spaces|jobs|职位/);
    assert.doesNotMatch(text, /browser-host-search-runtime|search-results|BrowserHostSession browser_search/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('HTTP/SSE endpoint routes browser search requests that omit Agent Host input to upstream adapter', async () => {
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
  const commandText = '通过内置浏览器搜索伊朗局势';

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        workspacePath: '/tmp/workspace',
        commandId: 'codex-command-agent-host-browser-cn-fallback',
        attemptId: 'codex-command-agent-host-browser-cn-fallback-attempt-1',
      }),
    });
    const text = await response.text();

    assertRuntimeTurnRoutedToUpstreamAdapter({
      label: 'Browser search request without Agent Host input',
      text,
      adapter,
      commandText,
    });
    assert.doesNotMatch(text, /module\.invoke|browser-host-session:iran-fallback\/source-pages\/source-1\.txt/);
    assert.doesNotMatch(text, /browser-host-search-runtime|browser_search|answerEvidenceState|browser-search-results|browser-host-projection/);
    assert.doesNotMatch(text, /<[^>]*DSML[^>]*tool_calls/i);
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

test('product Runtime Codex entries do not wire local Computer Use Act materializer as task owner', async () => {
  const productSources = [
    ['standalone server', './codex-runtime-standalone-server.ts'],
    ['workspace server', '../workspace-server.ts'],
  ] as const;

  for (const [label, file] of productSources) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /createDefaultComputerUseActMaterializer|computerUseActMaterializer/, label);
  }

  const compositeSource = await readFile(new URL('./agent-host-computer-use-act-materializer.ts', import.meta.url), 'utf8');
  assert.match(compositeSource, /createDefaultBrowserHostComputerUseActMaterializer/);
  assert.match(compositeSource, /createDefaultWindowActionSessionComputerUseActMaterializer/);
  assert.doesNotMatch(compositeSource, /createDefaultVirtualAppScreenComputerUseActMaterializer|VirtualAppScreen/i);
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
