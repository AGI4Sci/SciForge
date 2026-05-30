import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  ensureRuntimeHome,
  RUNTIME_KEY_ENV,
  RUNTIME_PROFILE,
} from '../../../packages/backend/src/runtime-home.js';
import {
  createCodexAppServerClient,
  type CodexAppServerProcess,
  type SpawnCodexAppServerProcess,
} from './codex-app-server-client.js';
import { SUBAGENT_MCP_ENV, SUBAGENT_MCP_SERVER_NAME } from './subagent-extension-manifest.js';

test('Codex app-server client registers runtime tools and serves sub-agent dynamic calls', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] sub-agent live parity\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer();
  let spawnCall: Parameters<SpawnCodexAppServerProcess> | undefined;
  const client = createCodexAppServerClient({
    env,
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Use a delegated worker to inspect PROJECT.md',
    workspacePath: workspace,
    commandId: 'app-server-client-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(spawnCall?.[0], 'codex');
  const argv = spawnCall?.[1] ?? [];
  assert.deepEqual(argv.slice(0, 2), ['app-server', '-c']);
  assert.ok(argv.includes('--listen'));
  assert.equal(argv[argv.indexOf('--listen') + 1], 'stdio://');
  assert.equal(argv.includes('exec'), false);
  assert.equal(argv.includes('--json'), false);
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command="node"`));
  assert.ok(argv.some((arg) => arg.startsWith(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.args=`) && arg.includes('subagent-mcp-server.ts')));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.workspace}="${workspace}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.profile}="${RUNTIME_PROFILE}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentCommandId}="app-server-client-command"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentAttemptId}="attempt-1"`));

  const dynamicTools = appServer.threadStartParams.dynamicTools as Array<Record<string, unknown>>;
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'module' && tool.name === 'invoke'));
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'multi_agent_v1' && tool.name === 'spawn_agent'));
  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /artifact:subagent-result-[a-f0-9]{12}/);
  assert.match(text, /artifact:subagent-transcript-[a-f0-9]{12}/);
});

test('Codex app-server client routes explicit sub-agent tool requests through app-server MCP', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] sub-agent live parity\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer();
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Please call multi_agent_v1.spawn_agent exactly once to inspect PROJECT.md.',
    workspacePath: workspace,
    commandId: 'explicit-subagent-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.equal(appServer.mcpToolCallParams?.server, SUBAGENT_MCP_SERVER_NAME);
  assert.equal(appServer.mcpToolCallParams?.tool, 'multi_agent_v1.spawn_agent');
  assert.match(JSON.stringify(appServer.mcpToolCallParams?.arguments), /PROJECT\.md/);
  assert.deepEqual(events.map((event) => event.method), [
    'turn/started',
    'item/started',
    'item/completed',
    'item/agentMessage/delta',
    'turn/completed',
  ]);
  const completed = events.find((event) => event.method === 'item/completed');
  assert.match(JSON.stringify(completed), /artifact:subagent-result-explicit/);
  const message = events.find((event) => event.method === 'item/agentMessage/delta');
  assert.match(JSON.stringify(message), /agentId: worker-explicit/);
  assert.match(JSON.stringify(message), /transcriptRef: artifact:subagent-transcript-explicit/);
  assert.match(JSON.stringify(message), /resultRef: artifact:subagent-result-explicit/);
});

test('Codex app-server client preserves runtime dynamic tools when resuming a thread', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer();
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Continue by calling multi_agent_v1.spawn_agent for PROJECT.md if needed.',
    workspacePath: workspace,
    threadId: 'thread-existing',
    commandId: 'resume-subagent-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(appServer.threadResumeParams.threadId, 'thread-existing');
  const dynamicTools = appServer.threadResumeParams.dynamicTools as Array<Record<string, unknown>>;
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'module' && tool.name === 'read'));
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'multi_agent_v1' && tool.name === 'spawn_agent'));
});

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-app-server-client-workspace-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function tempRuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'sciforge-app-server-client-runtime-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SCIFORGE_RUNTIME_ROOT: runtimeRoot,
    [RUNTIME_KEY_ENV]: 'test-key',
  };
  await ensureRuntimeHome({ paths: { env }, overwrite: true });
  return env;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of iterable) result.push(event);
  return result;
}

function fakeAppServer() {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const state: {
    threadStartParams: Record<string, unknown>;
    threadResumeParams: Record<string, unknown>;
    toolCallResponse?: Record<string, unknown>;
    mcpToolCallParams?: Record<string, unknown>;
  } = {
    threadStartParams: {},
    threadResumeParams: {},
  };
  let killed = false;
  let buffer = '';
  stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) handleClientMessage(JSON.parse(line) as Record<string, unknown>);
      newline = buffer.indexOf('\n');
    }
  });

  const process = {
    stdin,
    stdout,
    stderr,
    get killed() {
      return killed;
    },
    kill() {
      killed = true;
      stdout.end();
      stderr.end();
      emitter.emit('close', 0, null);
      return true;
    },
    on(event: 'error' | 'close', listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
      return process;
    },
  } as unknown as CodexAppServerProcess;

  function handleClientMessage(message: Record<string, unknown>) {
    if (message.method === 'initialize') {
      write({ id: message.id, result: {} });
      return;
    }
    if (message.method === 'initialized') return;
    if (message.method === 'thread/start') {
      state.threadStartParams = message.params as Record<string, unknown>;
      write({ id: message.id, result: { thread: { id: 'thread-1' } } });
      return;
    }
    if (message.method === 'thread/resume') {
      state.threadResumeParams = message.params as Record<string, unknown>;
      write({ id: message.id, result: { thread: { id: 'thread-existing' } } });
      return;
    }
    if (message.method === 'turn/start') {
      const params = message.params as Record<string, unknown>;
      const threadId = typeof params.threadId === 'string' ? params.threadId : 'thread-1';
      write({ id: message.id, result: { turn: { id: 'turn-1' } } });
      setTimeout(() => write({
        id: 'server-tool-call-1',
        method: 'item/tool/call',
        params: {
          threadId,
          turnId: 'turn-1',
          callId: 'subagent-call-1',
          namespace: 'multi_agent_v1',
          tool: 'spawn_agent',
          arguments: {
            message: 'Inspect PROJECT.md for open sub-agent tasks.',
            items: [{ path: 'PROJECT.md' }],
          },
        },
      }), 0);
      return;
    }
    if (message.method === 'mcpServer/tool/call') {
      state.mcpToolCallParams = message.params as Record<string, unknown>;
      write({
        id: message.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              agentId: 'worker-explicit',
              parentAgentId: 'explicit-subagent-command',
              resultSummary: 'Explicit app-server MCP sub-agent completed.',
              ref: 'artifact:subagent-result-explicit',
              resultRef: 'artifact:subagent-result-explicit',
              transcriptRef: 'artifact:subagent-transcript-explicit',
              refs: ['artifact:subagent-result-explicit', 'artifact:subagent-transcript-explicit'],
              status: 'completed',
              exitCode: 0,
            }),
          }],
          structuredContent: {
            ok: true,
            agentId: 'worker-explicit',
            parentAgentId: 'explicit-subagent-command',
            resultSummary: 'Explicit app-server MCP sub-agent completed.',
            ref: 'artifact:subagent-result-explicit',
            resultRef: 'artifact:subagent-result-explicit',
            transcriptRef: 'artifact:subagent-transcript-explicit',
            refs: ['artifact:subagent-result-explicit', 'artifact:subagent-transcript-explicit'],
            status: 'completed',
            exitCode: 0,
          },
        },
      });
      return;
    }
    if (message.id === 'server-tool-call-1') {
      state.toolCallResponse = message.result as Record<string, unknown>;
      write({
        method: 'turn/completed',
        params: { threadId: state.threadResumeParams.threadId ?? 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
      });
    }
  }

  function write(message: Record<string, unknown>) {
    stdout.write(`${JSON.stringify(message)}\n`);
  }

  return {
    process,
    get threadStartParams() {
      return state.threadStartParams;
    },
    get threadResumeParams() {
      return state.threadResumeParams;
    },
    get toolCallResponse() {
      return state.toolCallResponse;
    },
    get mcpToolCallParams() {
      return state.mcpToolCallParams;
    },
  };
}
