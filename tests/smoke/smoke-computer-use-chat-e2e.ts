import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentStreamEvent, SendAgentMessageInput } from '../../src/ui/src/domain';
import { sendSciForgeToolMessage } from '../../src/ui/src/api/sciforgeToolsClient';
import { handleCodexRuntimeRoutes, type CodexRuntimeRouteOptions } from '../../src/runtime/codex/codex-runtime-server.js';
import type { AgentCliAdapter, AgentCliStartTurnInput, AgentCliTurn } from '../../src/runtime/codex/agent-cli-adapter.js';

const originalFetch = globalThis.fetch;

async function smokeNaturalLanguageGuiGuard() {
  const adapter = new FakeAdapter();
  const server = await startRuntimeServer(adapter);
  const baseUrl = serverBaseUrl(server);
  const bodies: Array<Record<string, unknown>> = [];
  const events: AgentStreamEvent[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes('/api/sciforge/runtime/codex/stream')) {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    }
    return await originalFetch(url, init);
  }) as typeof fetch;

  try {
    const response = await sendSciForgeToolMessage(input({
      workspaceWriterBaseUrl: baseUrl,
      prompt: 'Click the visible export button in the current window.',
    }), {
      onEvent: (event) => events.push(event),
    });

    assert.equal(bodies.length, 1);
    assert.match(String(bodies[0]?.commandText), /Click the visible export button/);
    assert.equal((bodies[0]?.agentHostInput as Record<string, unknown> | undefined)?.schemaVersion, 'sciforge.codex-agent-host-input.v1');
    assert.equal('selectedActionIds' in bodies[0]!, false);
    assert.equal(adapter.lastInput, undefined);
    assert.match(response.message.content, /Computer Use Guard blocked/i);
    assert.match(response.message.content, /browser-host-session-unavailable|native-bridge-unavailable|target-unbound/);
    const eventText = JSON.stringify(events);
    assert.match(eventText, /agent-host-turn-loop/);
    assert.match(eventText, /"stage":"Guard"/);
    assert.match(eventText, /browser-host-session-unavailable|native-bridge-unavailable|target-unbound/);
  } finally {
    globalThis.fetch = originalFetch;
    await closeServer(server);
  }
}

async function smokeNaturalLanguageGuiActionPath() {
  const adapter = new FakeAdapter();
  let materializerCalled = false;
  let truthResolverCalled = false;
  const server = await startRuntimeServer(adapter, {
    agentHostRuntimeTruthResolver: async ({ commandText, agentHostInput }) => {
      truthResolverCalled = true;
      assert.match(commandText, /Scroll the current browser page/);
      assert.equal(agentHostInput.schemaVersion, 'sciforge.codex-agent-host-input.v1');
      return {
        schemaVersion: 'sciforge.agent-host.runtime-truth.v1',
        source: 'smoke-runtime-truth-ready',
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
          refs: ['browser-host-session:current-page'],
        },
        observation: {
          fresh: true,
          refs: ['browser-host-session:current-page/frame'],
        },
        permissions: {
          refs: ['permission:turn/low-risk-navigation'],
          stopCancelPath: true,
        },
        refs: ['runtime-truth:ready-computer-use'],
      };
    },
    computerUseActMaterializer: async ({ commandText, preflight, runtimeTruth }) => {
      materializerCalled = true;
      assert.match(commandText, /Scroll the current browser page/);
      assert.equal(preflight.status, 'ready');
      assert.equal(preflight.target.summary, 'Current browser page');
      assert.deepEqual(runtimeTruth?.refs, ['runtime-truth:ready-computer-use']);
      return {
        status: 'completed',
        message: 'Computer Use action path executed by runtime-owned materializer.',
        evidenceRefs: ['browser-host-session:current-page/action-state/scroll-1'],
        executionUnits: [{
          id: 'EU-computer-use-chat-e2e-action-path',
          tool: 'browser-host-session.computer-use-action',
          status: 'done',
          outputRef: 'browser-host-session:current-page/action-state/scroll-1',
        }],
      };
    },
  });
  const baseUrl = serverBaseUrl(server);
  const bodies: Array<Record<string, unknown>> = [];
  const events: AgentStreamEvent[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes('/api/sciforge/runtime/codex/stream')) {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    }
    return await originalFetch(url, init);
  }) as typeof fetch;

  try {
    const response = await sendSciForgeToolMessage(input({
      workspaceWriterBaseUrl: baseUrl,
      prompt: 'Scroll the current browser page to inspect visible results.',
    }), {
      onEvent: (event) => events.push(event),
    });

    assert.equal(bodies.length, 1);
    assert.match(String(bodies[0]?.commandText), /Scroll the current browser page/);
    assert.equal('selectedActionIds' in bodies[0]!, false);
    assert.equal(truthResolverCalled, true);
    assert.equal(materializerCalled, true);
    assert.equal(adapter.lastInput, undefined);
    assert.doesNotMatch(response.message.content, /\/computer-use|selectedActionIds|没有直接|no direct computer use/i);
    const eventText = JSON.stringify(events);
    assert.match(eventText, /agent-host-turn-loop/);
    assert.match(eventText, /"stage":"Act \/ Answer"/);
    assert.match(eventText, /Computer Use action path executed by runtime-owned materializer/);
    assert.match(eventText, /browser-host-session:current-page\/action-state\/scroll-1/);
    assert.doesNotMatch(eventText, /ready-for-act|Act is waiting/i);
  } finally {
    globalThis.fetch = originalFetch;
    await closeServer(server);
  }
}

async function smokeNeedsConfirmationRuntimeTransport() {
  const adapter = new FakeAdapter();
  const server = await startRuntimeServer(adapter);
  const baseUrl = serverBaseUrl(server);
  try {
    const response = await fetch(`${baseUrl}/api/sciforge/runtime/codex/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Submit the registration form in the current browser window.',
        workspacePath: '/tmp/current',
        commandId: 'computer-use-chat-e2e-hard-confirm',
        attemptId: 'computer-use-chat-e2e-hard-confirm-attempt-1',
        agentHostInput: readyAgentHostInput('Submit the registration form in the current browser window.'),
      }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(adapter.lastInput, undefined);
    assert.match(text, /event: agent_host_turn_loop/);
    assert.match(text, /requires hard confirmation/i);
    assert.match(text, /needs-confirmation/);
    assert.match(text, /"controls":\["Confirm","Cancel"\]/);
  } finally {
    await closeServer(server);
  }
}

function input(options: {
  workspaceWriterBaseUrl: string;
  prompt: string;
}): SendAgentMessageInput {
  return {
    sessionId: 'computer-use-chat-e2e-session',
    scenarioId: 'literature-evidence-review',
    agentName: 'SciForge',
    agentDomain: 'literature',
    prompt: options.prompt,
    references: [],
    roleView: 'researcher',
    messages: [],
    artifacts: [],
    executionUnits: [],
    runs: [],
    config: {
      schemaVersion: 1,
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: options.workspaceWriterBaseUrl,
      workspacePath: '/tmp/current',
      agentBackend: 'codex',
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
      requestTimeoutMs: 60_000,
      maxContextWindowTokens: 200000,
      visionAllowSharedSystemInput: false,
      updatedAt: '2026-05-29T00:00:00.000Z',
    },
    availableComponentIds: [],
    scenarioOverride: {
      title: 'Computer Use chat E2E',
      description: 'Chat-triggered Computer Use E2E protocol smoke.',
      skillDomain: 'literature',
      scenarioMarkdown: '# Computer Use chat E2E',
      defaultComponents: [],
      allowedComponents: [],
      fallbackComponent: '',
      selectedActionIds: [],
    },
  };
}

function readyAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'smoke-runtime-transport',
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
  };
}

async function startRuntimeServer(adapter: AgentCliAdapter, options: CodexRuntimeRouteOptions = {}): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    void handleCodexRuntimeRoutes(req, res, url, adapter, options);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

function serverBaseUrl(server: Server) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

class FakeAdapter implements AgentCliAdapter {
  lastInput?: AgentCliStartTurnInput;

  async startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn> {
    this.lastInput = input;
    return {
      turnId: 'fake-turn',
      attemptId: input.attemptId ?? 'fake-attempt',
      events: (async function* () {})(),
    };
  }

  async cancel() {}
}

try {
  await smokeNaturalLanguageGuiGuard();
  await smokeNaturalLanguageGuiActionPath();
  await smokeNeedsConfirmationRuntimeTransport();
  console.log('[ok] Computer Use chat E2E protocol smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
