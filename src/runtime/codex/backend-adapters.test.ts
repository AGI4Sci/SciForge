import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { SpawnClaudeProcess } from './claude-stream-json-adapter.js';
import { ClaudeStreamJsonAdapter } from './claude-stream-json-adapter.js';
import { CodexAppServerAdapter, type CodexAppServerClient } from './codex-app-server-adapter.js';
import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

test('CodexAppServerAdapter maps app-server lifecycle, tool, approval, and done events', async () => {
  const client: CodexAppServerClient = {
    async startTurn() {
      return {
        threadId: 'thread-app-1',
        turnId: 'turn-app-1',
        events: asyncGenerator([
          { type: 'thread.started', thread_id: 'thread-app-1' },
          { type: 'turn.started', thread_id: 'thread-app-1', turn_id: 'turn-app-1' },
          { type: 'response.output_text.delta', thread_id: 'thread-app-1', turn_id: 'turn-app-1', delta: 'Working' },
          {
            type: 'tool.started',
            thread_id: 'thread-app-1',
            turn_id: 'turn-app-1',
            item: {
              id: 'tool-1',
              name: 'module.invoke',
              input: { moduleId: 'browser', intent: 'open', input: { url: 'https://example.test/?token=secret-123456' } },
            },
          },
          {
            type: 'approval.requested',
            thread_id: 'thread-app-1',
            turn_id: 'turn-app-1',
            approval: { id: 'approval-1', moduleId: 'browser', intent: 'open', reason: 'external navigation' },
          },
          {
            type: 'tool.completed',
            thread_id: 'thread-app-1',
            turn_id: 'turn-app-1',
            item: {
              id: 'tool-1',
              name: 'module.invoke',
              input: { moduleId: 'browser', intent: 'open' },
              result: { ok: true, refs: ['browser:tab-1'], operationRef: 'operation:browser:1' },
            },
            durationMs: 5,
          },
          { type: 'turn.done', thread_id: 'thread-app-1', turn_id: 'turn-app-1' },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: 'Open the docs',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'app-command-1',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);

  assert.equal(turn.codexSessionId, 'thread-app-1');
  assert.deepEqual(events.map((event) => event.type), [
    'run_started',
    'thread_started',
    'turn_started',
    'message_delta',
    'tool_started',
    'gui_ask_user',
    'tool_completed',
    'done',
  ]);
  assert.equal(events.find((event) => event.type === 'message_delta')?.text, 'Working');
  const approval = events.find((event) => event.type === 'gui_ask_user');
  assert.match(approval?.text ?? '', /approval-1/);
  const toolCompleted = events.find((event) => event.type === 'tool_completed');
  assert.equal(toolCompleted?.toolName, 'module.invoke');
  const trace = ((toolCompleted?.raw as { pipelineTrace?: Array<{ refs?: string[]; operationRef?: string }> })?.pipelineTrace ?? [])[0];
  assert.deepEqual(trace?.refs, ['browser:tab-1']);
  assert.equal(trace?.operationRef, 'operation:browser:1');
  assert.doesNotMatch(JSON.stringify(events), /secret-123456|example\.test/);
});

test('CodexAppServerAdapter preserves native shell command lifecycle details', async () => {
  const client: CodexAppServerClient = {
    async startTurn() {
      return {
        threadId: 'thread-app-1',
        turnId: 'turn-app-1',
        events: asyncGenerator([
          {
            type: 'item.started',
            thread_id: 'thread-app-1',
            turn_id: 'turn-app-1',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: "/bin/zsh -lc 'git diff --check'",
              status: 'in_progress',
            },
          },
          {
            type: 'item.completed',
            thread_id: 'thread-app-1',
            turn_id: 'turn-app-1',
            item: {
              id: 'cmd-1',
              type: 'command_execution',
              command: "/bin/zsh -lc 'git diff --check'",
              aggregated_output: 'clean',
              exit_code: 0,
              status: 'completed',
            },
          },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: 'Check diff',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'app-command-1',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);

  const toolStarted = events.find((event) => event.type === 'tool_started');
  const toolCompleted = events.find((event) => event.type === 'tool_completed');
  assert.equal(toolStarted?.toolName, 'shell');
  assert.equal(toolStarted?.command, "/bin/zsh -lc 'git diff --check'");
  assert.equal(toolStarted?.status, 'in_progress');
  assert.equal(toolCompleted?.toolName, 'shell');
  assert.equal(toolCompleted?.exitCode, 0);
  assert.equal(toolCompleted?.outputSummary, 'clean');
});

test('CodexAppServerAdapter preserves Computer Use native-route workspace events', async () => {
  const client: CodexAppServerClient = {
    async startTurn(input) {
      return {
        threadId: 'thread-cu-1',
        turnId: 'turn-cu-1',
        events: asyncGenerator([
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'computer-use.tui-host-actions',
            timestamp: new Date().toISOString(),
            commandId: input.commandId,
            attemptId: input.attemptId,
            detail: JSON.stringify({
              actions: [{
                schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                port: 'gui.present',
                target: 'computer-use.trace-summary',
                payload: {
                  title: 'Computer Use result',
                  status: 'needs-confirmation',
                  traceRefs: ['.sciforge/vision-runs/native-route/vision-trace.json'],
                  runTaskChainRefs: ['.sciforge/vision-runs/native-route/tui-host-run-task-chain.json'],
                },
              }],
            }),
          },
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            timestamp: new Date().toISOString(),
            commandId: input.commandId,
            attemptId: input.attemptId,
            status: 'needs-confirmation',
            message: 'Computer Use stopped before a guarded action.',
          },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: '/computer-use click the guarded Submit button',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'cu-command-1',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);

  assert.deepEqual(events.map((event) => event.type), [
    'run_started',
    'computer-use.tui-host-actions',
    'done',
  ]);
  assert.equal(events[1]?.commandId, 'cu-command-1');
  assert.match(String((events[1] as unknown as Record<string, unknown>).detail), /vision-trace\.json/);
  assert.equal(events[2]?.status, 'needs-confirmation');
});

test('CodexAppServerAdapter promotes sub-agent refs into normalized events', async () => {
  const client: CodexAppServerClient = {
    async startTurn() {
      return {
        threadId: 'thread-app-subagent',
        turnId: 'turn-app-subagent',
        events: asyncGenerator([
          {
            type: 'tool.completed',
            thread_id: 'thread-app-subagent',
            turn_id: 'turn-app-subagent',
            item: {
              id: 'subagent-tool-1',
              name: 'multi_agent_v1.spawn_agent',
              result: {
                agentId: '019e7649-worker',
                parentAgentId: 'root-agent',
                ref: 'artifact:subagent-result',
                transcriptRef: 'transcript:worker-1',
                resultSummary: 'Sub-agent audit completed.',
                refs: ['artifact:subagent-result'],
              },
            },
          },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: 'Delegate an audit',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'app-command-subagent',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);
  const toolCompleted = events.find((event) => event.type === 'tool_completed');

  assert.equal(toolCompleted?.toolName, 'multi_agent_v1.spawn_agent');
  assert.equal(toolCompleted?.agentId, '019e7649-worker');
  assert.equal(toolCompleted?.parentAgentId, 'root-agent');
  assert.equal(toolCompleted?.ref, 'artifact:subagent-result');
  assert.equal(toolCompleted?.transcriptRef, 'transcript:worker-1');
  assert.deepEqual(toolCompleted?.refs, ['artifact:subagent-result', 'transcript:worker-1']);
  assert.match(toolCompleted?.resultSummary ?? '', /Sub-agent audit/);
});

test('CodexAppServerAdapter preserves trusted read-file preview refs', async () => {
  const client: CodexAppServerClient = {
    async startTurn() {
      return {
        threadId: 'thread-app-read',
        turnId: 'turn-app-read',
        events: asyncGenerator([
          {
            method: 'item/completed',
            params: {
              threadId: 'thread-app-read',
              turnId: 'turn-app-read',
              item: {
                id: 'dyn-read-1',
                type: 'dynamicToolCall',
                tool: 'read_file',
                arguments: { path: 'PROJECT.md' },
                status: 'completed',
              },
            },
          },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: 'Read project docs',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'app-command-read',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);
  const toolCompleted = events.find((event) => event.type === 'tool_completed');

  assert.equal(toolCompleted?.toolName, 'read_file');
  assert.equal(toolCompleted?.filePath, 'PROJECT.md');
  assert.equal(toolCompleted?.fileRef, 'file:PROJECT.md');
});

test('CodexAppServerAdapter streams slash-form app-server lifecycle and dynamic sub-agent events', async () => {
  const client: CodexAppServerClient = {
    async startTurn() {
      return {
        threadId: 'thread-app-slash',
        turnId: 'turn-app-slash',
        events: asyncGenerator([
          { method: 'thread/started', params: { thread: { id: 'thread-app-slash' } } },
          { method: 'turn/started', params: { threadId: 'thread-app-slash', turn: { id: 'turn-app-slash' } } },
          { method: 'item/started', params: { threadId: 'thread-app-slash', turnId: 'turn-app-slash', item: { id: 'user-message-1', type: 'userMessage' } } },
          { method: 'item/completed', params: { threadId: 'thread-app-slash', turnId: 'turn-app-slash', item: { id: 'user-message-1', type: 'userMessage' } } },
          { method: 'item/agentMessage/delta', params: { threadId: 'thread-app-slash', turnId: 'turn-app-slash', itemId: 'msg-1', delta: 'Working' } },
          {
            method: 'item/completed',
            params: {
              threadId: 'thread-app-slash',
              turnId: 'turn-app-slash',
              item: {
                id: 'dyn-subagent-1',
                type: 'dynamicToolCall',
                namespace: 'multi_agent_v1',
                tool: 'spawn_agent',
                status: 'completed',
                success: true,
                contentItems: [{
                  type: 'inputText',
                  text: JSON.stringify({
                    structuredContent: {
                      agentId: '019e7649-worker',
                      ref: 'artifact:subagent-result',
                      transcriptRef: 'transcript:worker-1',
                      resultSummary: 'Sub-agent audit completed.',
                      refs: ['artifact:subagent-result', 'transcript:worker-1'],
                    },
                  }),
                }],
              },
            },
          },
          { method: 'turn/completed', params: { threadId: 'thread-app-slash', turn: { id: 'turn-app-slash', status: 'completed' } } },
        ]),
      };
    },
  };
  const adapter = new CodexAppServerAdapter({ client });

  const turn = await adapter.startTurn({
    commandText: 'Delegate an audit',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'app-command-slash',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);

  assert.deepEqual(events.map((event) => event.type), [
    'run_started',
    'thread_started',
    'turn_started',
    'item_started',
    'item_completed',
    'message_delta',
    'tool_completed',
    'done',
  ]);
  const subagent = events.find((event) => event.type === 'tool_completed');
  assert.equal(subagent?.toolName, 'multi_agent_v1.spawn_agent');
  assert.equal(subagent?.agentId, '019e7649-worker');
  assert.equal(subagent?.ref, 'artifact:subagent-result');
  assert.equal(subagent?.transcriptRef, 'transcript:worker-1');
});

test('ClaudeStreamJsonAdapter spawns Claude stream-json and maps partial plus control request', async () => {
  const child = fakeClaudeChild();
  let spawnCall: Parameters<SpawnClaudeProcess> | undefined;
  const adapter = new ClaudeStreamJsonAdapter({
    command: 'claude',
    env: {},
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'assistant',
          partial: true,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Partial answer' }] },
        })}\n`);
        child.stdout.write(`${JSON.stringify({
          type: 'control_request',
          id: 'control-1',
          request: {
            name: 'module.invoke',
            input: { moduleId: 'actions', intent: 'execute' },
          },
        })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success' })}\n`);
        child.close(0);
      }, 0);
      return child.process as ReturnType<SpawnClaudeProcess>;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'Summarize',
    workspacePath: '/tmp/sciforge-workspace',
    commandId: 'claude-command-1',
    attemptId: 'attempt-1',
  });
  const events = await collect(turn.events);

  assert.equal(spawnCall?.[0], 'claude');
  assert.deepEqual(spawnCall?.[1], [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]);
  assert.match(child.stdinText, /"type":"user"/);
  assert.deepEqual(events.map((event) => event.type), ['run_started', 'message_delta', 'gui_ask_user', 'done']);
  assert.equal(events[1]?.text, 'Partial answer');
  assert.match(events[2]?.text ?? '', /control-1/);
  const trace = ((events[2]?.raw as { pipelineTrace?: Array<{ moduleId?: string; intent?: string }> })?.pipelineTrace ?? [])[0];
  assert.equal(trace?.moduleId, 'actions');
  assert.equal(trace?.intent, 'execute');
});

async function* asyncGenerator(values: unknown[]) {
  for (const value of values) yield value;
}

async function collect(events: AsyncIterable<NormalizedAgentEvent>) {
  const out: NormalizedAgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function fakeClaudeChild() {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let killed = false;
  let stdinText = '';
  const process = {
    stdin: {
      end(text = '') {
        stdinText += text;
      },
    },
    stdout,
    stderr,
    get killed() {
      return killed;
    },
    kill() {
      killed = true;
      return true;
    },
    on(event: 'error' | 'close', listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
      return process;
    },
  };
  return {
    process,
    stdout,
    stderr,
    get stdinText() {
      return stdinText;
    },
    close(code: number | null, signal: NodeJS.Signals | null = null) {
      emitter.emit('close', code, signal);
    },
  };
}
