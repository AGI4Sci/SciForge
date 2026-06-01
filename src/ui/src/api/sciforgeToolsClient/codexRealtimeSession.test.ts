import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodexRealtimeSessionEnvelope } from '@sciforge-ui/runtime-contract/codex-realtime-session';
import { createCodexRealtimeSessionClient, type CodexRealtimeControlSender } from './codexRealtimeSession';

test('Codex realtime session client sends terminal-equivalent request over WebSocket and reads structured events', async () => {
  let socket: MockSocket | undefined;
  let controlSender: CodexRealtimeControlSender | undefined;
  const client = createCodexRealtimeSessionClient({
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    webSocketFactory(url) {
      socket = new MockSocket(url);
      return socket as unknown as WebSocket;
    },
    onControlReady(sender) {
      controlSender = sender;
    },
  });
  const events: unknown[] = [];
  const request = {
    realtimeSession: createCodexRealtimeSessionEnvelope({
      commandId: 'codex-command-ws',
      attemptId: 'codex-command-ws-attempt-1',
    }),
    commandText: 'say hello',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-ws',
    attemptId: 'codex-command-ws-attempt-1',
  };
  const pending = client.stream(JSON.stringify(request), (event) => events.push(event));

  assert.equal(socket?.url, 'ws://127.0.0.1:5174/api/sciforge/runtime/codex/realtime/ws');
  socket?.open();
  const sent = JSON.parse(socket?.sent[0] ?? '{}') as Record<string, unknown>;
  assert.equal((sent.realtimeSession as Record<string, unknown>).eventTransport, 'websocket');
  assert.equal(controlSender?.send({
    controlType: 'interrupt',
    mode: 'queue-next-turn',
    message: 'apply this next',
    requestId: 'guidance-1',
  }), true);
  const sentControl = JSON.parse(socket?.sent[1] ?? '{}') as Record<string, unknown>;
  assert.equal(sentControl.schemaVersion, 'sciforge.codex-realtime-control.v1');
  assert.equal(sentControl.controlType, 'interrupt');
  assert.equal(sentControl.rawTerminal, false);
  assert.equal(sentControl.commandId, 'codex-command-ws');
  assert.equal(sentControl.attemptId, 'codex-command-ws-attempt-1');
  socket?.message({ type: 'event', event: 'message', data: { type: 'message', text: 'hello' } });
  socket?.message({
    type: 'event',
    event: 'realtime_control',
    data: {
      schemaVersion: 'sciforge.codex-realtime-control.v1',
      type: 'realtime_control',
      controlType: 'interrupt',
      status: 'recorded',
      delivery: 'next-turn-required',
      detail: 'recorded',
      rawTerminal: false,
      createdAt: '2026-05-23T00:00:00.000Z',
    },
  });
  socket?.message({ type: 'event', event: 'done', data: { type: 'done', status: 'done' } });
  socket?.close();

  const stream = await pending;
  assert.equal(stream.error, undefined);
  assert.equal((stream.result as Record<string, unknown>).message, 'hello');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['message', 'realtime_control', 'done']);
});

test('Codex realtime session client preserves adjacent tool lifecycle events before socket close', async () => {
  let socket: MockSocket | undefined;
  const client = createCodexRealtimeSessionClient({
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    webSocketFactory(url) {
      socket = new MockSocket(url);
      return socket as unknown as WebSocket;
    },
  });
  const events: unknown[] = [];
  const request = {
    realtimeSession: createCodexRealtimeSessionEnvelope({
      commandId: 'codex-command-ws-tools',
      attemptId: 'codex-command-ws-tools-attempt-1',
    }),
    commandText: 'run diff',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-ws-tools',
    attemptId: 'codex-command-ws-tools-attempt-1',
  };
  const pending = client.stream(JSON.stringify(request), (event) => events.push(event));

  socket?.open();
  socket?.message({
    type: 'event',
    event: 'tool_started',
    data: { type: 'tool_started', toolName: 'shell', itemId: 'item_0', command: 'diff -u old.ts new.ts' },
  });
  socket?.message({
    type: 'event',
    event: 'tool_completed',
    data: {
      type: 'tool_completed',
      toolName: 'shell',
      itemId: 'item_0',
      command: 'diff -u old.ts new.ts',
      status: 'failed',
      exitCode: 1,
      diff: ['--- old.ts', '+++ new.ts', '@@ -1 +1 @@', '-before', '+after'].join('\n'),
    },
  });
  socket?.message({ type: 'event', event: 'message', data: { type: 'message', text: 'done' } });
  socket?.message({ type: 'event', event: 'done', data: { type: 'done', status: 'done' } });
  socket?.close();

  const stream = await pending;
  assert.equal(stream.error, undefined);
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['tool_started', 'tool_completed', 'message', 'done']);
  assert.match(String((events[1] as Record<string, unknown>).diff), /@@ -1 \+1 @@/);
});

test('Codex realtime session client does not treat completed item lifecycle events as terminal', async () => {
  let socket: MockSocket | undefined;
  const client = createCodexRealtimeSessionClient({
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    webSocketFactory(url) {
      socket = new MockSocket(url);
      return socket as unknown as WebSocket;
    },
  });
  const request = {
    realtimeSession: createCodexRealtimeSessionEnvelope({
      commandId: 'codex-command-ws-item-completed',
      attemptId: 'codex-command-ws-item-completed-attempt-1',
    }),
    commandText: 'run item lifecycle',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-ws-item-completed',
    attemptId: 'codex-command-ws-item-completed-attempt-1',
  };
  const events: unknown[] = [];
  const pending = client.stream(JSON.stringify(request), (event) => events.push(event));

  socket?.open();
  socket?.message({ type: 'event', event: 'item_completed', data: { type: 'item_completed', status: 'completed', itemId: 'user-message' } });
  assert.equal(socket?.readyState, 1);
  socket?.message({ type: 'event', event: 'message_delta', data: { type: 'message_delta', text: 'still running' } });
  socket?.message({ type: 'event', event: 'done', data: { type: 'done', status: 'done' } });

  const stream = await pending;

  assert.equal(stream.error, undefined);
  assert.equal((stream.result as Record<string, unknown>).message, 'still running');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['item_completed', 'message_delta', 'done']);
});

test('Codex realtime session client resolves terminal done events without waiting for server socket close', async () => {
  let socket: MockSocket | undefined;
  const client = createCodexRealtimeSessionClient({
    workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
    webSocketFactory(url) {
      socket = new MockSocket(url);
      return socket as unknown as WebSocket;
    },
  });
  const request = {
    realtimeSession: createCodexRealtimeSessionEnvelope({
      commandId: 'codex-command-ws-done',
      attemptId: 'codex-command-ws-done-attempt-1',
    }),
    commandText: 'finish cleanly',
    workspacePath: '/tmp/workspace',
    commandId: 'codex-command-ws-done',
    attemptId: 'codex-command-ws-done-attempt-1',
  };
  const events: unknown[] = [];
  const pending = client.stream(JSON.stringify(request), (event) => events.push(event));

  socket?.open();
  socket?.message({ type: 'event', event: 'message', data: { type: 'message', text: 'complete' } });
  socket?.message({ type: 'event', event: 'done', data: { type: 'done', status: 'done' } });

  const stream = await pending;

  assert.equal(stream.error, undefined);
  assert.equal((stream.result as Record<string, unknown>).message, 'complete');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['message', 'done']);
  assert.equal(socket?.closeCount, 1);
  assert.equal(socket?.readyState, 3);
});

class MockSocket {
  readonly sent: string[] = [];
  readyState = 0;
  closeCount = 0;
  private readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  message(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) });
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = 3;
    this.emit('close', {});
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
