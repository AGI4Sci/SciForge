import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { CODEX_RUNTIME_WEBSOCKET_PATH, handleCodexRuntimeRoutes, handleCodexRuntimeUpgrade } from './codex-runtime-server.js';
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
    assert.match(text, /正在启动 Codex CLI/);
    assert.equal(adapter.lastInput?.commandText, 'say hello');
    assert.equal(adapter.lastInput?.workspacePath, '/tmp/workspace');
    assert.equal(adapter.lastInput?.commandId, 'codex-command-ui');
    assert.equal(adapter.lastInput?.attemptId, 'codex-command-ui-attempt-1');
    assert.equal(adapter.lastInput?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
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
