import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createModuleDescription, moduleResult, type ModuleInvokeRequest } from '../../../packages/contracts/runtime/modules.js';
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
import { BROWSER_PRIMITIVE_INPUT_SCHEMAS } from '../../../packages/actions/browser-runtime/index.js';
import { isComputerUseNativeRouteCommand } from './computer-use-native-route.js';
import { SUBAGENT_MCP_ENV, SUBAGENT_MCP_SERVER_NAME } from './subagent-extension-manifest.js';

test('Codex app-server client registers runtime tools and serves sub-agent dynamic calls', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] sub-agent live parity\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer();
  let spawnCall: Parameters<SpawnCodexAppServerProcess> | undefined;
  const client = createCodexAppServerClient({
    env,
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
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
  assert.equal(argv[0], 'app-server');
  assert.ok(argv.includes('-c'));
  assertDisablePair(argv, 'plugins');
  assertDisablePair(argv, 'remote_plugin');
  assert.ok(argv.includes('--listen'));
  assert.equal(argv[argv.indexOf('--listen') + 1], 'stdio://');
  assert.equal(argv.includes('exec'), false);
  assert.equal(argv.includes('--json'), false);
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command="node"`));
  assertMcpEntrypointArg(argv, SUBAGENT_MCP_SERVER_NAME, 'subagent-mcp-server');
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.workspace}="${workspace}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.profile}="${RUNTIME_PROFILE}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.sandbox}="read-only"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.SCIFORGE_SUBAGENT_APPROVAL_POLICY="on-request"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentCommandId}="app-server-client-command"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentAttemptId}="attempt-1"`));
  assert.equal(appServer.threadStartParams.approvalPolicy, 'on-request');
  assert.equal(appServer.threadStartParams.sandbox, 'read-only');

  const dynamicTools = appServer.threadStartParams.dynamicTools as Array<Record<string, unknown>>;
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'module' && tool.name === 'invoke'));
  assert.ok(dynamicTools.some((tool) => tool.name === 'module_invoke'), 'provider-safe module.invoke alias should be registered');
  assert.ok(dynamicTools.some((tool) => tool.name === 'gui_present'), 'provider-safe gui.present alias should be registered');
  assert.ok(dynamicTools.some((tool) => tool.name === 'gui_ask_user'), 'provider-safe gui.ask_user alias should be registered');
  const guiPresentTool = dynamicTools.find((tool) => tool.name === 'gui_present');
  assert.deepEqual((guiPresentTool?.inputSchema as { required?: string[] } | undefined)?.required, ['content']);
  assert.ok(dynamicTools.some((tool) => tool.namespace === 'multi_agent_v1' && tool.name === 'spawn_agent'));
  const spawnTool = dynamicTools.find((tool) => tool.namespace === 'multi_agent_v1' && tool.name === 'spawn_agent');
  const spawnAliasTool = dynamicTools.find((tool) => tool.name === 'multi_agent_v1_spawn_agent');
  const spawnSchema = spawnTool?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  assert.ok(spawnSchema?.properties?.run_in_background);
  assert.ok(spawnSchema.properties.resume_ref);
  assert.ok(spawnSchema.properties.resume_agent_id);
  assert.ok(spawnAliasTool, 'provider-safe sub-agent alias should be registered as a dynamic tool');
  assert.equal(spawnAliasTool?.namespace, undefined);
  assert.doesNotMatch(JSON.stringify(spawnTool), /providerUrl|apiKey|codexHome|rawModel|modelConfig|stdout|stderr/i);
  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /artifact:subagent-result-[a-f0-9]{12}/);
  assert.match(text, /artifact:subagent-transcript-[a-f0-9]{12}/);
});

test('Codex app-server client serves provider-safe module dynamic tool aliases', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let invoked: ModuleInvokeRequest | undefined;
  const appServer = fakeAppServer({
    toolCall: {
      tool: 'module_invoke',
      arguments: {
        moduleId: 'memory',
        intent: 'lookup',
        input: {
          ref: 'memory:project/agentic-rl',
        },
      },
    },
  });
  const client = createCodexAppServerClient({
    env,
    dispatcher: {
      describe: async () => moduleResult({
        moduleId: 'memory',
        ok: true,
        value: createModuleDescription({
          moduleId: 'memory',
          title: 'Memory',
          summary: 'Read-only memory module.',
          intents: [{ name: 'lookup', sideEffect: 'none', returnsOperation: false }],
          facets: { refs: true },
        }),
      }),
      query: async () => moduleResult({ moduleId: 'memory', ok: true, value: {} }),
      read: async () => moduleResult({ moduleId: 'memory', ok: true, value: {} }),
      invoke: async (request) => {
        invoked = request;
        return moduleResult({ moduleId: request.moduleId, ok: true, value: { routed: true } });
      },
      trace: () => [],
      clearTrace: () => undefined,
    },
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Call provider-safe module alias once.',
    workspacePath: workspace,
    commandId: 'provider-safe-module-alias-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(invoked?.moduleId, 'memory');
  assert.equal(invoked?.intent, 'lookup');
  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /"routed":true/);
});

test('Codex app-server client exposes browser primitives as direct dynamic tools backed by module dispatcher', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let invoked: ModuleInvokeRequest | undefined;
  const appServer = fakeAppServer({
    toolCall: {
      tool: 'browser_search',
      arguments: {
        query: '伊朗局势',
        limit: 2,
      },
    },
  });
  const client = createCodexAppServerClient({
    env,
    dispatcher: {
      describe: async ({ moduleId } = {}) => moduleResult({
        moduleId: moduleId ?? 'browser',
        ok: true,
        value: createModuleDescription({
          moduleId: 'browser',
          title: 'Browser Runtime',
          summary: 'Browser primitive module.',
          intents: [
            { name: 'browser.search', sideEffect: 'external' },
            { name: 'browser.navigate', sideEffect: 'external' },
            { name: 'browser.observe', sideEffect: 'none' },
            { name: 'browser.read', sideEffect: 'external' },
            { name: 'browser.extract', sideEffect: 'none' },
            { name: 'browser.download', sideEffect: 'workspace' },
          ],
          facets: { refs: true },
        }),
      }),
      query: async () => moduleResult({ moduleId: 'browser', ok: true, value: {} }),
      read: async () => moduleResult({ moduleId: 'browser', ok: true, value: {} }),
      invoke: async (request) => {
        invoked = request;
        return moduleResult({
          moduleId: request.moduleId,
          ok: true,
          value: {
            routed: true,
            input: request.input,
          },
        });
      },
      trace: () => [],
      clearTrace: () => undefined,
    },
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Use browser_search once.',
    workspacePath: workspace,
    commandId: 'direct-browser-search-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  const dynamicTools = appServer.threadStartParams.dynamicTools as Array<Record<string, unknown>>;
  for (const name of ['browser_search', 'browser_navigate', 'browser_observe', 'browser_read', 'browser_extract', 'browser_download']) {
    assert.ok(dynamicTools.some((tool) => tool.name === name), `${name} should be registered`);
  }
  assert.equal(invoked?.moduleId, 'browser');
  assert.equal(invoked?.intent, 'browser.search');
  assert.deepEqual(invoked?.input, {
    schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
    query: '伊朗局势',
    limit: 2,
  });
  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /"routed":true/);
});

test('Codex app-server client returns a browser.read repair hint for search-only loops', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const invoked: ModuleInvokeRequest[] = [];
  const appServer = fakeAppServer({
    turnToolCalls: [
      { tool: 'browser_search', arguments: { query: '伊朗局势 最新', limit: 2 } },
      { tool: 'browser_search', arguments: { query: '伊朗局势 2026 最新', limit: 2 } },
      { tool: 'browser_search', arguments: { query: 'Iran situation latest', limit: 2 } },
      { tool: 'browser_search', arguments: { query: '伊朗局势 最新消息', limit: 2 } },
    ],
  });
  const client = createCodexAppServerClient({
    env,
    dispatcher: {
      describe: async ({ moduleId } = {}) => moduleResult({
        moduleId: moduleId ?? 'browser',
        ok: true,
        value: createModuleDescription({
          moduleId: 'browser',
          title: 'Browser Runtime',
          summary: 'Browser primitive module.',
          intents: [
            { name: 'browser.search', sideEffect: 'external' },
            { name: 'browser.read', sideEffect: 'external' },
          ],
          facets: { refs: true },
        }),
      }),
      query: async () => moduleResult({ moduleId: 'browser', ok: true, value: {} }),
      read: async () => moduleResult({ moduleId: 'browser', ok: true, value: {} }),
      invoke: async (request) => {
        invoked.push(request);
        return moduleResult({
          moduleId: request.moduleId,
          ok: true,
          value: {
            schemaVersion: 'sciforge.browser-runtime.primitive-result.v1',
            moduleId: 'browser',
            primitive: 'search',
            status: 'completed',
            output: {
              query: (request.input as { query?: string }).query,
              results: [{
                rank: 1,
                title: 'Source',
                url: 'https://example.com/source',
                snippet: 'Candidate source.',
              }],
              searchResultRef: 'browser-host-session:search/search-results.json',
            },
            refs: ['browser-host-session:search/search-results.json'],
            diagnostics: [],
            budget: {},
          },
          refs: ['browser-host-session:search/search-results.json'],
        });
      },
      trace: () => [],
      clearTrace: () => undefined,
    },
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: '搜索一下伊朗局势，用中文总结当前最新情况，并列出你实际读取过的来源链接',
    workspacePath: workspace,
    commandId: 'browser-search-loop-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(invoked.filter((request) => request.intent === 'browser.search').length, 3);
  const text = (appServer.toolCallResponses.at(-1)?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /browser_search_only_budget_exhausted/);
  assert.match(text, /candidateReadInputs/);
  assert.match(text, /browser\.read/);
});

test('Codex app-server client projects provider-safe GUI dynamic tool aliases as completion events', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({
    toolCall: {
      tool: 'gui_present',
      arguments: {
        intent: 'show-result',
        content: { kind: 'markdown', value: 'Visible answer from gui_present.' },
        displayedRefs: ['source:search-result-1'],
      },
    },
  });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Present the final answer through GUI.',
    workspacePath: workspace,
    commandId: 'provider-safe-gui-present-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  const syntheticGuiCompletion = events.find((event) => event.method === 'item/tool/completed') as Record<string, unknown> | undefined;
  const completionParams = syntheticGuiCompletion?.params as Record<string, unknown> | undefined;
  assert.equal(appServer.toolCallResponse?.success, true);
  assert.equal(completionParams?.tool, 'gui_present');
  assert.equal((completionParams?.arguments as Record<string, unknown> | undefined)?.content && ((completionParams.arguments as Record<string, unknown>).content as Record<string, unknown>).value, 'Visible answer from gui_present.');
});

test('Codex app-server client gives missing gui.present turns one bounded protocol repair attempt', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Answer through the unified GUI path.',
    workspacePath: workspace,
    commandId: 'missing-gui-protocol-repair-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.equal(appServer.turnStartParamsHistory.length, 2);
  assert.equal(((appServer.turnStartParamsHistory[0]?.input as Array<Record<string, unknown>>)[0]?.text), 'Answer through the unified GUI path.');
  assert.match(String(((appServer.turnStartParamsHistory[1]?.input as Array<Record<string, unknown>>)[0]?.text) ?? ''), /runtime protocol repair/i);
  assert.equal(events.filter((event) => event.method === 'sciforge/gui_protocol_repair').length, 1);
  assert.equal(events.filter((event) => event.method === 'turn/completed').length, 2);
});

test('Codex app-server client repairs multimodal turns when gui.present is only a title', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({
    toolCalls: [{
      tool: 'gui_present',
      arguments: {
        intent: 'show-result',
        title: '酒店凭证解析',
        content: { kind: 'markdown', value: '酒店凭证解析' },
      },
    }, {
      tool: 'gui_present',
      arguments: {
        intent: 'show-result',
        title: '酒店凭证解析',
        content: {
          kind: 'markdown',
          value: '这张酒店凭证包含酒店名称、入住人、联系方式、入住时间、离店时间、房型、支付金额、支付方式、订单号和服务商等字段。',
        },
      },
    }],
  });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: '解释这张图',
    workspacePath: workspace,
    commandId: 'title-only-multimodal-gui-repair-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    inputObjects: [{
      schemaVersion: 'sciforge.runtime.input-object.v1',
      ref: '.sciforge/uploads/session-test/upload-hotel-voucher.jpg',
      source: 'recent-artifact',
      mimeType: 'image/jpeg',
      title: '酒店凭证.jpg',
    }],
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.equal(appServer.turnStartParamsHistory.length, 2);
  assert.match(String(((appServer.turnStartParamsHistory[1]?.input as Array<Record<string, unknown>>)[0]?.text) ?? ''), /gui\.present.*(?:title-only|too short)|(?:title-only|too short).*gui\.present/i);
  assert.equal(events.filter((event) => event.method === 'sciforge/gui_protocol_repair').length, 1);
  assert.equal(events.filter((event) => event.method === 'item/tool/completed').length, 2);
});

test('Codex app-server client binds default Browser module dispatcher to the turn workspace', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const previousNativeAdapterUrl = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
  const appServer = fakeAppServer({
    toolCall: {
      tool: 'module_invoke',
      arguments: {
        moduleId: 'browser',
        intent: 'browser.read',
        input: {
          schemaVersion: 'sciforge.browser-runtime.read-input.v1',
          url: 'https://example.org/current-source',
          navigationMode: 'ephemeral',
          includeText: true,
        },
      },
    },
  });
  try {
    const client = createCodexAppServerClient({
      env,
      spawnProcess() {
        return appServer.process;
      },
    });

    const stream = await client.startTurn({
      commandText: 'Read a current source through the Browser module.',
      workspacePath: workspace,
      commandId: 'default-browser-module-workspace-command',
      attemptId: 'attempt-1',
      guiExtension: { enabled: false },
    });
    await collect(stream.events);
  } finally {
    if (previousNativeAdapterUrl === undefined) delete process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL;
    else process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL = previousNativeAdapterUrl;
  }

  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.doesNotMatch(text, /unsupported_browser_primitive_intent|unsupported_operation_kind|browser\.open_read|browser\.search_read/);
});

test('Codex app-server client serves provider-safe sub-agent dynamic tool aliases', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] sub-agent live parity\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ toolCall: { tool: 'multi_agent_v1_spawn_agent' } });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Call the provider-safe sub-agent alias once.',
    workspacePath: workspace,
    commandId: 'provider-safe-subagent-alias-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /artifact:subagent-result-[a-f0-9]{12}/);
  assert.match(text, /artifact:subagent-transcript-[a-f0-9]{12}/);
});

test('Codex app-server client blocks generic actions.execute dynamic tool calls before dispatcher invoke', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({
    toolCall: {
      namespace: 'module',
      tool: 'invoke',
      arguments: {
        moduleId: 'actions',
        intent: 'execute',
        approvalToken: 'approved-action-token',
      },
    },
  });
  let invokeCalled = false;
  const client = createCodexAppServerClient({
    env,
    dispatcher: {
      describe: async () => moduleResult({
        moduleId: 'actions',
        ok: true,
        value: createModuleDescription({
          moduleId: 'actions',
          title: 'Actions',
          summary: 'Action execution.',
          intents: [{ name: 'execute', sideEffect: 'workspace', requiresApproval: true }],
          facets: { approval: true, refs: true },
        }),
      }),
      query: async () => moduleResult({ moduleId: 'actions', ok: true, value: {} }),
      read: async () => moduleResult({ moduleId: 'actions', ok: true, value: {} }),
      invoke: async () => {
        invokeCalled = true;
        return moduleResult({ moduleId: 'actions', ok: true, value: { executed: true } });
      },
      trace: () => [],
      clearTrace: () => undefined,
    },
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Try a generic actions.execute dynamic call.',
    workspacePath: workspace,
    commandId: 'app-server-client-actions-execute-policy',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(invokeCalled, false);
  assert.equal(appServer.toolCallResponse?.success, true);
  const text = (appServer.toolCallResponse?.contentItems as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';
  assert.match(text, /agent_host_blocked:execute/);
  assert.match(text, /Computer Use Guard/);
  assert.doesNotMatch(text, /approved-action-token|approvalToken/);
});

test('Codex app-server client treats GUI spawn_agent text as ordinary app-server input', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] sub-agent live parity\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Please call multi_agent_v1.spawn_agent exactly once to inspect PROJECT.md.',
    workspacePath: workspace,
    commandId: 'gui-spawn-agent-text-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.equal(appServer.mcpToolCallParams, undefined);
  assert.equal(stream.turnId, 'turn-1');
  assert.deepEqual(appServer.turnStartParamsHistory[0]?.input, [{
    type: 'text',
    text: 'Please call multi_agent_v1.spawn_agent exactly once to inspect PROJECT.md.',
    text_elements: [],
  }]);
  assert.deepEqual(events.map((event) => event.method), ['turn/completed', 'sciforge/gui_protocol_repair', 'turn/completed']);
});

test('Codex app-server client keeps streaming after retryable provider error notifications', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({
    autoToolCall: false,
    turnEvents: [
      {
        method: 'error',
        params: {
          message: 'Reconnecting... 1/5 (unexpected status 502 Bad Gateway: Unknown error)',
        },
      },
      {
        method: 'response_item',
        params: {
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '{"done":false,"actions":[{"type":"wait"}]}' }],
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          status: 'completed',
          turn: { id: 'turn-1', status: 'completed' },
        },
      },
    ],
  });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Plan one generic Computer Use action.',
    workspacePath: workspace,
    commandId: 'retryable-provider-error-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.deepEqual(events.map((event) => event.method), ['error', 'response_item', 'turn/completed']);
});

test('Codex app-server client keeps streaming after retryable turn failed notifications', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({
    autoToolCall: false,
    turnEvents: [
      {
        method: 'turn/failed',
        params: {
          status: 'failed',
          message: 'Reconnecting... 1/5',
          turn: { id: 'turn-1', status: 'failed' },
        },
      },
      {
        method: 'response_item',
        params: {
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '{"done":false,"actions":[{"type":"wait"}]}' }],
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          status: 'completed',
          turn: { id: 'turn-1', status: 'completed' },
        },
      },
    ],
  });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Plan one generic Computer Use action.',
    workspacePath: workspace,
    commandId: 'retryable-turn-failed-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.deepEqual(events.map((event) => event.method), ['turn/failed', 'response_item', 'turn/completed']);
});

test('Codex app-server client projects Multitask declared intent into app-server instructions without changing turn text', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Compare the runtime and UI paths, then summarize the blockers.',
    workspacePath: workspace,
    commandId: 'multitask-declared-intent-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    declaredIntents: {
      authorization: {
        profileId: 'high-autonomy',
        publicLabel: 'High Autonomy',
        source: 'composer-autonomy-default',
        singleTurnOverride: false,
        hardConfirmCategories: ['payments-transfers-purchases', 'external-communications'],
      },
      mode: {
        modeIntentId: 'multitask',
        publicLabel: 'Multitask',
        summaryGuidance: 'Coordinate parallel tasks.',
      },
    },
  });
  await collect(stream.events);

  assert.deepEqual(appServer.turnStartParamsHistory[0]?.input, [{
    type: 'text',
    text: 'Compare the runtime and UI paths, then summarize the blockers.',
    text_elements: [],
  }]);
  const developerInstructions = String(appServer.threadStartParams.developerInstructions ?? '');
  assert.match(developerInstructions, /Multitask/);
  assert.match(developerInstructions, /High Autonomy/);
  assert.match(developerInstructions, /hard confirmation/i);
  assert.match(developerInstructions, /multi_agent_v1\.spawn_agent/);
  assert.match(developerInstructions, /multi_agent_v1_spawn_agent/);
  assert.doesNotMatch((appServer.turnStartParamsHistory[0]?.input as Array<{ text?: string }> | undefined)?.[0]?.text ?? '', /\/multitask|multi_agent_v1\.spawn_agent/i);
  assert.doesNotMatch(developerInstructions, /providerUrl|apiKey|codexHome|rawModel|modelConfig|stdout|stderr|Applications\/workspace/i);
});

test('Codex app-server client injects bounded Agent Host grounding facts into developer instructions', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace, 'PROJECT.md'), '- [ ] grounded facts\n', 'utf8');
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Summarize the local plan from provided refs only.',
    workspacePath: workspace,
    commandId: 'agent-host-grounding-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    agentHostGrounding: {
      schemaVersion: 'sciforge.agent-host.grounding-snapshot.v1',
      source: 'codex-agent-host-turn-loop',
      productCapabilities: {
        browser: 'supported',
        computerUse: 'supported',
      },
      runtimeReadiness: {
        browser: 'ready',
        computerUse: 'blocked',
      },
      readiness: {
        browserHostSession: 'ready',
        nativeBridge: 'ready',
        nativeSurface: 'ready',
        windowActionSession: 'blocked',
        computerUseAdapter: 'blocked',
      },
      blockers: ['window-action-session-unavailable', 'computer-use-adapter-unavailable'],
      authorizationProfile: {
        id: 'high-autonomy',
        publicLabel: 'High Autonomy',
        scope: {
          user: 'current-user',
          workspace: 'current-workspace',
        },
      },
      actionContext: {
        targetBound: false,
        freshObservation: false,
        permissionRefsPresent: false,
        stopCancelPath: false,
      },
      refs: ['runtime-health:workspace', 'https://private.example.invalid/token?secret=sk-private'],
    },
  });
  await collect(stream.events);

  assert.deepEqual(appServer.turnStartParamsHistory[0]?.input, [{
    type: 'text',
    text: 'Summarize the local plan from provided refs only.',
    text_elements: [],
  }]);
  const developerInstructions = String(appServer.threadStartParams.developerInstructions ?? '');
  assert.match(developerInstructions, /Agent Host grounded capability facts/);
  assert.match(developerInstructions, /Browser=supported/);
  assert.match(developerInstructions, /Computer Use=supported/);
  assert.match(developerInstructions, /Browser=ready/);
  assert.match(developerInstructions, /Computer Use=blocked/);
  assert.match(developerInstructions, /window-action-session-unavailable/);
  assert.match(developerInstructions, /current-user\/current-workspace/);
  assert.match(developerInstructions, /runtime-health:workspace/);
  assert.doesNotMatch(developerInstructions, /private\.example|sk-private|Applications\/workspace|raw JSONL/i);
});

test('Codex app-server client instructs models to route current external evidence through bounded modules', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Search today for relevant research and cite the sources.',
    workspacePath: workspace,
    commandId: 'agent-host-module-routing-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    agentHostGrounding: {
      schemaVersion: 'sciforge.agent-host.grounding-snapshot.v1',
      source: 'runtime-codex-grounding',
      productCapabilities: {
        browser: 'supported',
        computerUse: 'supported',
      },
      runtimeReadiness: {
        browser: 'ready',
        computerUse: 'blocked',
      },
      readiness: {
        browserHostSession: 'ready',
        nativeBridge: 'ready',
        nativeSurface: 'ready',
        windowActionSession: 'blocked',
        computerUseAdapter: 'blocked',
      },
      blockers: ['computer-use-adapter-unavailable'],
      actionContext: {
        targetBound: false,
        freshObservation: false,
        permissionRefsPresent: false,
        stopCancelPath: false,
      },
      refs: ['runtime-health:workspace'],
    },
  });
  await collect(stream.events);

  const developerInstructions = String(appServer.threadStartParams.developerInstructions ?? '');
  assert.match(developerInstructions, /module\.describe/);
  assert.match(developerInstructions, /module\.invoke/);
  assert.match(developerInstructions, /module_describe/);
  assert.match(developerInstructions, /module_invoke/);
  assert.match(developerInstructions, /Browser primitive path/);
  assert.match(developerInstructions, /browser\.search/);
  assert.match(developerInstructions, /browser\.navigate/);
  assert.match(developerInstructions, /browser\.observe/);
  assert.match(developerInstructions, /browser\.read/);
  assert.match(developerInstructions, /browser\.extract/);
  assert.match(developerInstructions, /browser\.download/);
  assert.match(developerInstructions, /Computer Use primitive path/);
  assert.match(developerInstructions, /computer_use\.bind/);
  assert.match(developerInstructions, /computer_use\.observe/);
  assert.match(developerInstructions, /computer_use\.act/);
  assert.match(developerInstructions, /computer_use\.run_procedure/);
  assert.match(developerInstructions, /computer_use\.control/);
  assert.doesNotMatch(developerInstructions, /executeBoundedOperation/);
  assert.doesNotMatch(developerInstructions, /perform_local_action|fill_fields/);
  assert.doesNotMatch(developerInstructions, /compatibility fallback/);
  assert.doesNotMatch(developerInstructions, /browser\.search_read/);
  assert.doesNotMatch(developerInstructions, /browser\.open_read/);
  assert.match(developerInstructions, /Never print or simulate tool-call protocol/);
  assert.match(developerInstructions, /do not output the call payload as text/i);
  assert.doesNotMatch(developerInstructions, /<module_invoke>|<tool_call>|<\{"function"/i);
  assert.match(developerInstructions, /current|latest|today|external|citations/i);
  assert.match(developerInstructions, /nonzero budgets/);
  assert.doesNotMatch(developerInstructions, /providerUrl|apiKey|codexHome|rawModel|modelConfig|stdout|stderr|Applications\/workspace/i);
});

test('Codex app-server client treats slash terminal turn events as stream completion', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ terminalEvent: 'turn/done', terminalStatus: 'done' });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Finish with slash terminal event.',
    workspacePath: workspace,
    commandId: 'slash-terminal-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  assert.equal(events.at(-1)?.method, 'turn/done');
  assert.equal((events.at(-1)?.params as Record<string, unknown> | undefined)?.['status'], 'done');
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

test('Codex app-server client encodes image inputObjects as app-server compatible local images', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: '请读取这张图片',
    workspacePath: workspace,
    commandId: 'input-object-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
    inputObjects: [{
      schemaVersion: 'sciforge.runtime.input-object.v1',
      ref: '.sciforge/uploads/session-test/upload-image-hotel.jpg',
      source: 'recent-artifact',
      mimeType: 'image/jpeg',
      title: '酒店凭证.jpg',
    }],
  });
  await collect(stream.events);

  assert.deepEqual(appServer.turnStartParams.input, [{
    type: 'text',
    text: '请读取这张图片',
    text_elements: [],
  }, {
    type: 'text',
    text: [
      'SciForge input_object attachments:',
      '1. title=酒店凭证.jpg',
      '   ref=.sciforge/uploads/session-test/upload-image-hotel.jpg',
      '   mimeType=image/jpeg',
      '   source=recent-artifact',
    ].join('\n'),
    text_elements: [],
  }, {
    type: 'localImage',
    path: join(workspace, '.sciforge/uploads/session-test/upload-image-hotel.jpg'),
  }]);
});

test('Codex app-server client uses ready vision descriptors instead of resending local images', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const appServer = fakeAppServer({ autoToolCall: false });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: '请基于缓存描述介绍这张图片',
    workspacePath: workspace,
    commandId: 'descriptor-input-object-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
    inputObjects: [{
      schemaVersion: 'sciforge.runtime.input-object.v1',
      ref: '.sciforge/uploads/session-test/upload-image-hotel.jpg',
      source: 'recent-artifact',
      mimeType: 'image/jpeg',
      title: '酒店凭证.jpg',
      visionDescriptor: {
        schemaVersion: 'sciforge.runtime.input-object.vision-descriptor.v1',
        status: 'ready',
        source: 'agent-host-cache',
        summary: '这是一张高德地图酒店预订凭证，包含酒店、入住人、时间、金额、订单号和服务商。',
      },
    } as never],
  });
  await collect(stream.events);

  const input = appServer.turnStartParams.input as Array<Record<string, unknown>>;
  assert.equal(input.some((item) => item.type === 'localImage'), false);
  assert.match(String(input[1]?.text ?? ''), /visionDescriptor\.status=ready/);
  assert.match(String(input[1]?.text ?? ''), /高德地图酒店预订凭证/);
});

test('Codex app-server client caches sufficient gui.present content as a follow-up vision descriptor', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const firstServer = fakeAppServer({
    toolCall: {
      tool: 'gui_present',
      arguments: {
        intent: 'show-result',
        content: {
          kind: 'markdown',
          value: '这是一张高德地图酒店预订凭证，包含丽柏酒店、入住人高张阳、入住/离店时间、金额 ¥421.15、订单号和服务商飞猪。',
        },
      },
    },
  });
  const secondServer = fakeAppServer({ autoToolCall: false });
  const servers = [firstServer.process, secondServer.process];
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      const process = servers.shift();
      if (!process) throw new Error('unexpected extra app-server process');
      return process;
    },
  });
  const inputObject = {
    schemaVersion: 'sciforge.runtime.input-object.v1',
    ref: '.sciforge/uploads/session-test/upload-image-hotel.jpg',
    source: 'recent-artifact',
    mimeType: 'image/jpeg',
    title: '酒店凭证.jpg',
  } as const;

  const first = await client.startTurn({
    commandText: '介绍这张图',
    workspacePath: workspace,
    commandId: 'cache-descriptor-first-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    inputObjects: [inputObject],
  });
  await collect(first.events);

  const second = await client.startTurn({
    commandText: '继续说明这张图中的订单信息',
    workspacePath: workspace,
    commandId: 'cache-descriptor-second-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
    inputObjects: [inputObject],
  });
  await collect(second.events);

  const secondInput = secondServer.turnStartParams.input as Array<Record<string, unknown>>;
  assert.equal(secondInput.some((item) => item.type === 'localImage'), false);
  assert.match(String(secondInput[1]?.text ?? ''), /visionDescriptor\.source=agent-host-cache/);
  assert.match(String(secondInput[1]?.text ?? ''), /丽柏酒店/);
});

test('Codex app-server client treats GUI /computer-use text as ordinary app-server input', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  let runnerCalled = false;
  const appServer = fakeAppServer({ autoToolCall: false });
  const commandText = '/computer-use click the guarded Submit button';
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      return appServer.process;
    },
    computerUseNativeRouteRunner(input) {
      runnerCalled = true;
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'computer-use.tui-host-actions',
            timestamp: new Date().toISOString(),
            commandId: input.request.commandId,
            attemptId: input.request.attemptId,
            detail: JSON.stringify({ actions: [] }),
          },
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            timestamp: new Date().toISOString(),
            commandId: input.request.commandId,
            attemptId: input.request.attemptId,
            status: 'done',
          },
        ]),
      };
    },
  });

  const stream = await client.startTurn({
    commandText,
    workspacePath: workspace,
    commandId: 'gui-native-cu-text-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
  });
  const events = await collect(stream.events);

  assert.equal(runnerCalled, false);
  assert.equal(spawnCalled, true);
  assert.equal(stream.turnId, 'turn-1');
  assert.deepEqual(appServer.turnStartParamsHistory[0]?.input, [{ type: 'text', text: commandText, text_elements: [] }]);
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).method), ['turn/completed', 'sciforge/gui_protocol_repair', 'turn/completed']);
});

test('Codex app-server client routes host-owned Computer Use runtime intents through native package bridge', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  let runnerCommandText = '';
  let runnerWorkspace = '';
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for host-owned native Computer Use route');
    },
    computerUseNativeRouteRunner(input) {
      runnerCommandText = input.request.commandText;
      runnerWorkspace = input.workspace;
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'computer-use.tui-host-actions',
            timestamp: new Date().toISOString(),
            commandId: input.request.commandId,
            attemptId: input.request.attemptId,
            detail: JSON.stringify({ actions: [] }),
          },
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            timestamp: new Date().toISOString(),
            commandId: input.request.commandId,
            attemptId: input.request.attemptId,
            status: 'done',
          },
        ]),
      };
    },
  });

  const stream = await client.startTurn({
    commandText: '/computer-use click the guarded Submit button',
    workspacePath: workspace,
    commandId: 'native-cu-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
  });
  const events = await collect(stream.events);

  assert.equal(spawnCalled, false);
  assert.equal(runnerCommandText, '/computer-use click the guarded Submit button');
  assert.equal(runnerWorkspace, workspace);
  assert.equal(stream.turnId, 'native-cu-command');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), [
    'computer-use.tui-host-actions',
    'done',
  ]);
});

test('Codex app-server client routes ordinary host-owned Computer Use text through native package bridge', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  let runnerCommandText = '';
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for host-owned ordinary Computer Use route');
    },
    computerUseNativeRouteRunner(input) {
      runnerCommandText = input.request.commandText;
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([{
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          timestamp: new Date().toISOString(),
          commandId: input.request.commandId,
          attemptId: input.request.attemptId,
          status: 'done',
        }]),
      };
    },
  });

  const commandText = '请用 SciForge 的 Computer Use 操作当前电脑上的真实软件，创建并验证本地文档。';
  const stream = await client.startTurn({
    commandText,
    workspacePath: workspace,
    commandId: 'ordinary-native-cu-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
  });
  const events = await collect(stream.events);

  assert.equal(spawnCalled, false);
  assert.equal(runnerCommandText, commandText);
  assert.equal(stream.turnId, 'ordinary-native-cu-command');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['done']);
});

test('Codex app-server client routes refs-first ordinary VSCode co-work Host input through native package bridge', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  let runnerCalled = false;
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for refs-first ordinary VSCode co-work Host input');
    },
    computerUseNativeRouteRunner(input) {
      runnerCalled = true;
      assert.equal(input.request.runtimeIntent, undefined);
      assert.equal((input.request.agentHostInput as Record<string, unknown> | undefined)?.schemaVersion, 'sciforge.codex-agent-host-input.v1');
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([{
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          timestamp: new Date().toISOString(),
          commandId: input.request.commandId,
          attemptId: input.request.attemptId,
          status: 'ready',
        }]),
      };
    },
  });

  const commandText = '读取我当前打开的 VSCode 可见文本。';
  const stream = await client.startTurn({
    commandText,
    workspacePath: workspace,
    commandId: 'ordinary-vscode-cowork-host-input',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    agentHostInput: p9bVSCodeCoWorkAgentHostInput(commandText),
  });
  const events = await collect(stream.events);

  assert.equal(spawnCalled, false);
  assert.equal(runnerCalled, true);
  assert.equal(stream.turnId, 'ordinary-vscode-cowork-host-input');
  assert.equal(stream.provider, 'host-owned-runtime');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['done']);
});

test('Codex app-server client passes current VSCode live diagnostic options into native package bridge', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const liveRunner = async () => ({
    status: 'completed' as const,
    message: 'not used by this test',
    maturity: 'live-diagnostic' as const,
    productReady: false as const,
    primitiveChainObserved: [],
    evidenceRefs: [],
    cleanupRefs: [],
  });
  let runnerMatches = false;
  let activateCurrentVSCodeIfNeeded: unknown;
  const client = createCodexAppServerClient({
    env,
    currentVSCodeCoWorkLiveDiagnosticRunner: liveRunner,
    currentVSCodeCoWorkLiveDiagnosticOptions: {
      activateCurrentVSCodeIfNeeded: true,
    },
    computerUseNativeRouteRunner(input) {
      runnerMatches = input.currentVSCodeCoWorkLiveDiagnosticRunner === liveRunner;
      activateCurrentVSCodeIfNeeded = input.currentVSCodeCoWorkLiveDiagnosticOptions?.activateCurrentVSCodeIfNeeded;
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([{
          schemaVersion: 'sciforge.codex.normalized-event.v1',
          type: 'done',
          timestamp: new Date().toISOString(),
          commandId: input.request.commandId,
          attemptId: input.request.attemptId,
          status: 'completed',
          message: 'native route completed',
        }]),
      };
    },
  });
  const commandText = '读取我当前打开的 VSCode 可见文本。';
  const stream = await client.startTurn({
    commandText,
    workspacePath: workspace,
    commandId: 'app-server-client-vscode-live-options',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    agentHostInput: p9bVSCodeCoWorkAgentHostInput(commandText),
  });
  await collect(stream.events);

  assert.equal(runnerMatches, true);
  assert.equal(activateCurrentVSCodeIfNeeded, true);
});

test('Computer Use native route strips private runtime fields from public events', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  const client = createCodexAppServerClient({
    env,
    computerUseNativeRouteRunner(input) {
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'operation_progress',
            timestamp: new Date().toISOString(),
            provider: 'private-provider',
            model: 'private-model',
            profile: 'private-profile',
            workspace,
            workspacePath: workspace,
            raw: {
              provider: 'private-provider',
              model: 'private-model',
              profile: 'private-profile',
              workspacePath: workspace,
            },
            message: `Computer Use native route selected provider https://provider.internal/v1 with token sk-native-secret-123 from ${workspace}/raw.json.`,
            detail: 'stdout raw JSON contained provider private-provider and model private-model.',
          },
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            timestamp: new Date().toISOString(),
            provider: 'private-provider',
            model: 'private-model',
            profile: 'private-profile',
            workspace,
            raw: { workspacePath: workspace },
            status: 'done',
            message: `Done from ${workspace}/trace.json using private-profile.`,
          },
        ]),
      };
    },
  });

  const stream = await client.startTurn({
    commandText: '/computer-use click the guarded Submit button',
    workspacePath: workspace,
    commandId: 'native-cu-public-stream-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: true },
    runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;

  for (const event of events) {
    assert.equal('provider' in event, false);
    assert.equal('model' in event, false);
    assert.equal('profile' in event, false);
    assert.equal('workspace' in event, false);
    assert.equal('workspacePath' in event, false);
    assert.equal('raw' in event, false);
  }
  assert.doesNotMatch(JSON.stringify(events), /private-provider|private-model|private-profile|provider\.internal|sk-native-secret|stdout|raw JSON/i);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(escapeRegExp(workspace)));
});

test('Computer Use native route is not blocked by unsupported assistant profile', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  env.SCIFORGE_RUNTIME_PROFILE = 'sciforge-runtime-deepseek';
  let runnerProfile = '';
  const client = createCodexAppServerClient({
    env,
    computerUseNativeRouteRunner(input) {
      runnerProfile = input.profile;
      return {
        turnId: input.request.commandId,
        provider: input.provider,
        model: input.model,
        profile: input.profile,
        workspacePath: input.workspace,
        events: asyncGenerator([
          {
            schemaVersion: 'sciforge.codex.normalized-event.v1',
            type: 'done',
            timestamp: new Date().toISOString(),
            commandId: input.request.commandId,
            attemptId: input.request.attemptId,
            status: 'done',
          },
        ]),
      };
    },
  });

  const stream = await client.startTurn({
    commandText: '/computer-use screen attach --source right-pane-screen --target-app-ref "app:profile/vscode-editor" --activation-ref "computer-use:screen-activation/test/attach-request.json"',
    workspacePath: workspace,
    commandId: 'native-cu-profile-command',
    attemptId: 'attempt-1',
    profile: 'assistant-fast',
    guiExtension: { enabled: true },
    runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
  });
  const events = await collect(stream.events);

  assert.equal(runnerProfile, 'assistant-fast');
  assert.equal(stream.turnId, 'native-cu-profile-command');
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).type), ['done']);
});

test('Computer Use native route rejects UI-generated right pane VirtualAppScreen attach commands', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for native Computer Use screen attach route');
    },
  });
  const commandText = [
    [
      '/computer-use screen attach',
      '--source right-pane-screen',
      '--profile "vscode-editor"',
      '--target-app-ref "app:profile/vscode-editor"',
      '--screen-ref "virtual-app-screen:codex-native-route/screen-request"',
      '--activation-ref "computer-use:screen-activation/codex-native-route/attach-request.json"',
      '--adapter-readiness-ref "computer-use:screen-activation/codex-native-route/provider-readiness.json"',
      '--evidence-ledger-ref "ledger:computer-use/codex-native-route/screen-activation.json"',
      '--gui-present-ref "gui.present:codex-native-route/screen-pane-activation"',
    ].join(' '),
    'Runtime resume context: continue the active Runtime Codex session only as transport/session context; the slash command above remains the terminal-equivalent task command.',
    '[redacted]]]]',
  ].join('\n\n');

  const stream = await client.startTurn({
    commandText,
    workspacePath: workspace,
    commandId: 'native-cu-ui-screen-attach-command',
    attemptId: 'attempt-1',
    profile: 'assistant-fast',
    guiExtension: { enabled: true },
    runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
  });
  const events = await collect(stream.events) as Array<Record<string, unknown>>;
  const failed = events.at(-1) as Record<string, unknown> | undefined;

  assert.equal(spawnCalled, false);
  assert.equal(failed?.type, 'failed');
  assert.equal(failed?.status, 'failed');
  assert.match(String(failed?.message ?? ''), /VirtualAppScreen.*retired|right pane screen attach.*retired/i);
  assert.doesNotMatch(JSON.stringify(failed), /computer-use-virtual-screen|virtual-screen-viewer|currentFrameRef|liveSurfaceRef/);
});

test('Computer Use native route still requires Runtime Codex local configuration', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  delete env[RUNTIME_KEY_ENV];
  let runnerCalled = false;
  const client = createCodexAppServerClient({
    env,
    computerUseNativeRouteRunner() {
      runnerCalled = true;
      return undefined;
    },
  });

  await assert.rejects(
    () => client.startTurn({
      commandText: '/computer-use screen attach --source right-pane-screen --target-app-ref "app:profile/vscode-editor" --activation-ref "computer-use:screen-activation/test/attach-request.json"',
      workspacePath: workspace,
      commandId: 'native-cu-config-guard-command',
      attemptId: 'attempt-1',
      profile: 'assistant-fast',
      guiExtension: { enabled: true },
      runtimeIntent: hostOwnedComputerUseRuntimeIntent(),
    }),
    /Missing SCIFORGE_RUNTIME_API_KEY/,
  );
  assert.equal(runnerCalled, false);
});

test('Codex app-server subprocess does not inherit VirtualAppScreen native driver env', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS = '1';
  env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND = 'npm';
  env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON = '["run","hook"]';
  const appServer = fakeAppServer();
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  const client = createCodexAppServerClient({
    env,
    spawnProcess(_command, _args, options) {
      spawnedEnv = options.env;
      return appServer.process;
    },
  });

  const stream = await client.startTurn({
    commandText: 'Explain the workspace.',
    workspacePath: workspace,
    commandId: 'normal-app-server-env-command',
    attemptId: 'attempt-1',
    guiExtension: { enabled: false },
  });
  await collect(stream.events);

  assert.equal(spawnedEnv?.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS, undefined);
  assert.equal(spawnedEnv?.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND, undefined);
  assert.equal(spawnedEnv?.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON, undefined);
});

test('Computer Use native route only claims diagnostic slash commands', () => {
  assert.equal(isComputerUseNativeRouteCommand('  /computer-use click the guarded Submit button'), false);
  assert.equal(isComputerUseNativeRouteCommand('/computer-use approve --approval-ref approval:computer-use:test'), false);
  assert.equal(isComputerUseNativeRouteCommand('/computer-use diagnostic --dry-run'), true);
  assert.equal(isComputerUseNativeRouteCommand('Plan a GUI action for this task: /computer-use click Submit'), false);
  assert.equal(isComputerUseNativeRouteCommand('ask --ref "prior" "/computer-use approve --approval-ref approval:computer-use:test"'), false);
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

async function* asyncGenerator(values: unknown[]) {
  for (const value of values) yield value;
}

function hostOwnedComputerUseRuntimeIntent() {
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
  } as const;
}

function p9bVSCodeCoWorkAgentHostInput(intentText: string) {
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ordinary-chat',
    intentText,
    singleTurnOverride: false,
    refs: ['intent:current-vscode-cowork', 'chat-request:vscode-cowork:ordinary-host-input'],
    readiness: {
      nativeBridge: 'ready',
      nativeSurface: 'ready',
      windowActionSession: 'ready',
      computerUseAdapter: 'ready',
    },
    target: {
      kind: 'current-vscode-cowork',
      vscodeCoWork: {
        requestRef: 'chat-request:vscode-cowork:ordinary-host-input',
        operation: 'read-visible-text',
        selectedWindowRef: 'window:vscode:paper',
        windowCandidates: [{
          appRef: 'macos-app:com.microsoft.VSCode',
          processRef: 'process:vscode:paper',
          windowRef: 'window:vscode:paper',
          titleRef: 'text:title:paper',
          frontmostRef: 'frontmost:vscode:paper',
        }],
      },
    },
    observation: {
      fresh: true,
      vscodeCoWork: {
        windowRef: 'window:vscode:paper',
        sessionRef: 'window-action-session:vscode-cowork:1',
        observationRef: 'observation:vscode:current',
        screenshotRef: 'image:vscode:current',
        accessibilityRef: 'accessibility:vscode:current',
        textRefs: ['text:vscode:visible'],
        elementRefs: ['element:vscode:editor'],
        freshnessRef: 'freshness:vscode:current',
        editorVisible: true,
        visibleFileRefs: ['file-ref:vscode:paper'],
        userFile: true,
      },
    },
    permissions: {
      refs: ['permission:turn/current-vscode-cowork/full-access'],
      scopedExecutorRefs: ['computer-use:executor-scope:current-vscode'],
      stopCancelPath: true,
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertMcpEntrypointArg(argv: string[], serverName: string, entrypointName: string): void {
  const argsConfig = argv.find((arg) => arg.startsWith(`mcp_servers.${serverName}.args=`));
  assert.ok(argsConfig);
  assert.match(argsConfig, new RegExp(`${entrypointName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(ts|js)`));
}

function assertDisablePair(argv: string[], feature: string): void {
  assert.ok(argv.some((arg, index) => arg === '--disable' && argv[index + 1] === feature));
}

function fakeAppServer(options: {
  terminalEvent?: string;
  terminalStatus?: string;
  autoToolCall?: boolean;
  toolCall?: { namespace?: string; tool: string; arguments?: Record<string, unknown> };
  toolCalls?: Array<{ namespace?: string; tool: string; arguments?: Record<string, unknown> }>;
  turnToolCalls?: Array<{ namespace?: string; tool: string; arguments?: Record<string, unknown> }>;
  turnEvents?: Array<Record<string, unknown>>;
} = {}) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const state: {
    threadStartParams: Record<string, unknown>;
    threadResumeParams: Record<string, unknown>;
    turnStartParams: Record<string, unknown>;
    turnStartParamsHistory: Array<Record<string, unknown>>;
    toolCallResponse?: Record<string, unknown>;
    toolCallResponses: Array<Record<string, unknown>>;
    mcpToolCallParams?: Record<string, unknown>;
  } = {
    threadStartParams: {},
    threadResumeParams: {},
    turnStartParams: {},
    turnStartParamsHistory: [],
    toolCallResponses: [],
  };
  let turnToolCallIndex = 0;
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
      state.turnStartParams = params;
      state.turnStartParamsHistory.push(params);
      const threadId = typeof params.threadId === 'string' ? params.threadId : 'thread-1';
      write({ id: message.id, result: { turn: { id: 'turn-1' } } });
      if (options.autoToolCall !== false) {
        const toolCallIndex = state.turnStartParamsHistory.length - 1;
        turnToolCallIndex = 0;
        const toolCall = options.turnToolCalls?.[0]
          ?? options.toolCalls?.[toolCallIndex]
          ?? options.toolCall
          ?? { namespace: 'multi_agent_v1', tool: 'spawn_agent' };
        setTimeout(() => writeToolCall(toolCall, threadId, turnToolCallIndex), 0);
      } else {
        const turnEvents = options.turnEvents ?? [{
          method: options.terminalEvent ?? 'turn/completed',
          params: {
            status: options.terminalStatus,
            turn: { id: 'turn-1', status: options.terminalStatus ?? 'completed' },
          },
        }];
        turnEvents.forEach((event, index) => setTimeout(() => write(turnEvent(event, threadId)), index));
      }
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
      state.toolCallResponses.push(state.toolCallResponse);
      if (options.turnToolCalls && turnToolCallIndex + 1 < options.turnToolCalls.length) {
        turnToolCallIndex += 1;
        setTimeout(() => writeToolCall(options.turnToolCalls?.[turnToolCallIndex], String(state.threadResumeParams.threadId ?? 'thread-1'), turnToolCallIndex), 0);
        return;
      }
      write({
        method: options.terminalEvent ?? 'turn/completed',
        params: {
          threadId: state.threadResumeParams.threadId ?? 'thread-1',
          turnId: 'turn-1',
          status: options.terminalStatus,
          turn: { id: 'turn-1', status: options.terminalStatus ?? 'completed' },
        },
      });
    }
  }

  function write(message: Record<string, unknown>) {
    stdout.write(`${JSON.stringify(message)}\n`);
  }

  function writeToolCall(
    toolCall: { namespace?: string; tool: string; arguments?: Record<string, unknown> } | undefined,
    threadId: string,
    index: number,
  ) {
    if (!toolCall) return;
    write({
      id: 'server-tool-call-1',
      method: 'item/tool/call',
      params: {
        threadId,
        turnId: 'turn-1',
        callId: `tool-call-${index + 1}`,
        ...(toolCall.namespace ? { namespace: toolCall.namespace } : {}),
        tool: toolCall.tool,
        arguments: toolCall.arguments ?? {
          message: 'Inspect PROJECT.md for open sub-agent tasks.',
          items: [{ path: 'PROJECT.md' }],
        },
      },
    });
  }

  return {
    process,
    get threadStartParams() {
      return state.threadStartParams;
    },
    get threadResumeParams() {
      return state.threadResumeParams;
    },
    get turnStartParams() {
      return state.turnStartParams;
    },
    get turnStartParamsHistory() {
      return state.turnStartParamsHistory;
    },
    get toolCallResponse() {
      return state.toolCallResponse;
    },
    get toolCallResponses() {
      return state.toolCallResponses;
    },
    get mcpToolCallParams() {
      return state.mcpToolCallParams;
    },
  };
}

function turnEvent(event: Record<string, unknown>, threadId: string): Record<string, unknown> {
  const params = event.params && typeof event.params === 'object' && !Array.isArray(event.params)
    ? event.params as Record<string, unknown>
    : {};
  return {
    ...event,
    params: {
      ...params,
      threadId: params.threadId ?? threadId,
      turnId: params.turnId ?? 'turn-1',
    },
  };
}
