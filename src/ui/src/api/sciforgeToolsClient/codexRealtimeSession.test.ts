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

class MockSocket {
  readonly sent: string[] = [];
  readyState = 0;
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
    this.readyState = 3;
    this.emit('close', {});
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
