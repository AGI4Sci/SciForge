import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createModuleDescription, moduleResult } from '../../../packages/contracts/runtime/modules.js';
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
import { isComputerUseNativeRouteCommand } from './computer-use-native-route.js';
import { SUBAGENT_MCP_ENV, SUBAGENT_MCP_SERVER_NAME } from './subagent-extension-manifest.js';
import type { VirtualAppScreenRuntimeCommand } from '../computer-use/virtual-app-screen-command.js';
import {
  registerVirtualAppScreenSessionExecutor,
  VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
  type VirtualAppScreenSessionManagerAttachResult,
} from '../computer-use/virtual-app-screen-session-manager.js';
import { resetVirtualAppScreenRuntimeExecutorsForTests } from '../computer-use/virtual-app-screen-runtime-executors.js';

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
  assert.deepEqual(argv.slice(0, 2), ['app-server', '-c']);
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
  assert.deepEqual(appServer.turnStartParams.input, [{
    type: 'text',
    text: 'Please call multi_agent_v1.spawn_agent exactly once to inspect PROJECT.md.',
    text_elements: [],
  }]);
  assert.deepEqual(events.map((event) => event.method), ['turn/completed']);
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

  assert.deepEqual(appServer.turnStartParams.input, [{
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
  assert.doesNotMatch(appServer.turnStartParams.input[0]?.text as string, /\/multitask|multi_agent_v1\.spawn_agent/i);
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

  assert.deepEqual(appServer.turnStartParams.input, [{
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
  assert.deepEqual(appServer.turnStartParams.input, [{ type: 'text', text: commandText, text_elements: [] }]);
  assert.deepEqual(events.map((event) => (event as Record<string, unknown>).method), ['turn/completed']);
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

test('Computer Use native route accepts UI-generated right pane screen attach commands before resume context', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:codex-native-route-test',
    providerId: 'provider:codex-native-route-test',
    supportedProfiles: ['vscode-editor'],
    attach: (command) => codexNativeRouteVirtualAppScreenAttachResult(command),
  });
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for native Computer Use screen attach route');
    },
  });
  try {
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
    const done = events.at(-1) as Record<string, unknown> | undefined;
    const screenArtifact = (done?.artifacts as Array<Record<string, unknown>> | undefined)
      ?.find((artifact) => artifact.type === 'computer-use-virtual-screen');
    const screenData = screenArtifact?.data as Record<string, unknown> | undefined;

    assert.equal(spawnCalled, false);
    assert.equal(done?.type, 'done');
    assert.equal(done?.status, 'done', String(done?.message ?? 'missing Computer Use native route done message'));
    assert.doesNotMatch(String(done?.message ?? ''), /Unexpected VirtualAppScreen runtime command token|without gui\.present|missing-gui-present/);
    assert.equal(screenArtifact?.schemaVersion, 'sciforge.computer-use.virtual-screen.v1');
    assert.equal(screenData?.attachState, 'attached');
    assert.equal(screenData?.surfaceMode, 'live');
    assert.equal(screenData?.sessionRef, 'computer-use:native-host/sessions/codex-native-route-test/session.json');
    assert.equal(screenData?.currentFrameRef, 'computer-use:native-host/frames/codex-native-route-test/current.png');
    assert.deepEqual(screenData?.guiPresentRefs, ['gui.present:codex-native-route/screen-pane-activation']);
  } finally {
    unregister();
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
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

test('Computer Use native route only claims top-level slash commands', () => {
  assert.equal(isComputerUseNativeRouteCommand('  /computer-use click the guarded Submit button'), true);
  assert.equal(isComputerUseNativeRouteCommand('/computer-use approve --approval-ref approval:computer-use:test'), true);
  assert.equal(isComputerUseNativeRouteCommand('/computer-use diagnostic --dry-run'), false);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertMcpEntrypointArg(argv: string[], serverName: string, entrypointName: string): void {
  const argsConfig = argv.find((arg) => arg.startsWith(`mcp_servers.${serverName}.args=`));
  assert.ok(argsConfig);
  assert.match(argsConfig, new RegExp(`${entrypointName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(ts|js)`));
}

function codexNativeRouteVirtualAppScreenAttachResult(
  command: VirtualAppScreenRuntimeCommand,
): VirtualAppScreenSessionManagerAttachResult {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: 'native-session-manager:codex-native-route-test',
    providerId: 'provider:codex-native-route-test',
    refs: {
      currentRunRef: '.sciforge/vision-runs/codex-native-route-test/current-run.json',
      sessionRef: 'computer-use:native-host/sessions/codex-native-route-test/session.json',
      liveSurfaceRef: 'computer-use:native-host/surfaces/codex-native-route-test/live-surface.json',
      surfaceTransportRef: 'computer-use:native-host/surfaces/codex-native-route-test/surface-transport.json',
      frameStreamRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-stream.json',
      currentFrameRef: 'computer-use:native-host/frames/codex-native-route-test/current.png',
      currentRunPointerRef: 'computer-use:native-host/runs/codex-native-route-test/current-run-pointer.json',
      minimalEvidenceReplayRefs: codexNativeRouteMinimalEvidenceReplayRefs(),
      frameTransportContractRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-transport-contract.json',
      frameTelemetryRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-telemetry.json',
      mediaChannelRef: 'computer-use:native-host/surfaces/codex-native-route-test/native-frame-stream/live',
      dataChannelRef: 'computer-use:native-host/surfaces/codex-native-route-test/native-frame-control-channel/control',
      liveBindingAttachGrantRef: 'computer-use:native-host/grants/codex-native-route-test/live-binding-attach-grant.json',
      grantValidationRef: 'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0004-grant.validated.json',
      surfaceOwnerRef: 'computer-use:native-host/surfaces/codex-native-route-test/surface-owner.json',
      displayOwnerRef: 'computer-use:native-host/surfaces/codex-native-route-test/display-owner.json',
      screenRef: command.refs.screenRef,
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: 'window:codex-native-route-test/main',
      inputLeaseRef: 'computer-use:native-host/input/codex-native-route-test/input-lease.json',
      actionAdapterRef: 'computer-use:native-host/input/codex-native-route-test/action-adapter.json',
      adapterReadinessRef: command.refs.readinessRef,
      platformDriverRef: 'computer-use:native-host/platform-drivers/codex-native-route-test/platform-driver.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json',
      hostEvidenceLedgerRef: 'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json',
      guiPresentRef: command.refs.guiPresentRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      platformDriverReady: true,
      permissionRequired: false,
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: {
        schemaVersion: 'sciforge.virtual-display.surface-transport.v1',
        owner: 'VirtualDisplayProvider',
        providerId: 'provider:codex-native-route-test',
        transport: 'native-frame-stream',
        surfaceTransportRef: 'computer-use:native-host/surfaces/codex-native-route-test/surface-transport.json',
        liveSurfaceRef: 'computer-use:native-host/surfaces/codex-native-route-test/live-surface.json',
        frameStreamRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-stream.json',
        currentFrameRef: 'computer-use:native-host/frames/codex-native-route-test/current.png',
        frameTransportContractRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-transport-contract.json',
        frameTelemetryRef: 'computer-use:native-host/surfaces/codex-native-route-test/frame-telemetry.json',
        mediaChannelRef: 'computer-use:native-host/surfaces/codex-native-route-test/native-frame-stream/live',
        dataChannelRef: 'computer-use:native-host/surfaces/codex-native-route-test/native-frame-control-channel/control',
        currentFrameSequence: 1,
        diagnosticOnly: false,
        productFallback: false,
        singleInteractiveTruth: true,
      },
      evidenceRefs: [
        'computer-use:native-host/surfaces/codex-native-route-test/surface-transport.json',
        'computer-use:native-host/platform-drivers/codex-native-route-test/platform-driver.json',
        'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json',
        'computer-use:native-host/grants/codex-native-route-test/live-binding-attach-grant.json',
        'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0004-grant.validated.json',
        'computer-use:native-host/surfaces/codex-native-route-test/surface-owner.json',
        'computer-use:native-host/surfaces/codex-native-route-test/display-owner.json',
        'computer-use:native-host/frames/codex-native-route-test/current.png',
        'computer-use:native-host/runs/codex-native-route-test/current-run-pointer.json',
        ...codexNativeRouteMinimalEvidenceReplayRefs(),
      ],
    },
  };
}

function codexNativeRouteMinimalEvidenceReplayRefs() {
  return [
    'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0001-session.created.json',
    'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0003-surface.attached.json',
    'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0004-grant.validated.json',
    'computer-use:native-host/ledgers/codex-native-route-test/evidence-ledger.json/events/0005-frame.read.json',
  ];
}

function fakeAppServer(options: {
  terminalEvent?: string;
  terminalStatus?: string;
  autoToolCall?: boolean;
  toolCall?: { namespace?: string; tool: string; arguments?: Record<string, unknown> };
} = {}) {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const state: {
    threadStartParams: Record<string, unknown>;
    threadResumeParams: Record<string, unknown>;
    turnStartParams: Record<string, unknown>;
    toolCallResponse?: Record<string, unknown>;
    mcpToolCallParams?: Record<string, unknown>;
  } = {
    threadStartParams: {},
    threadResumeParams: {},
    turnStartParams: {},
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
      state.turnStartParams = params;
      const threadId = typeof params.threadId === 'string' ? params.threadId : 'thread-1';
      write({ id: message.id, result: { turn: { id: 'turn-1' } } });
      if (options.autoToolCall !== false) {
        const toolCall = options.toolCall ?? { namespace: 'multi_agent_v1', tool: 'spawn_agent' };
        setTimeout(() => write({
          id: 'server-tool-call-1',
          method: 'item/tool/call',
          params: {
            threadId,
            turnId: 'turn-1',
            callId: 'subagent-call-1',
            ...(toolCall.namespace ? { namespace: toolCall.namespace } : {}),
            tool: toolCall.tool,
            arguments: toolCall.arguments ?? {
              message: 'Inspect PROJECT.md for open sub-agent tasks.',
              items: [{ path: 'PROJECT.md' }],
            },
          },
        }), 0);
      } else {
        setTimeout(() => write({
          method: options.terminalEvent ?? 'turn/completed',
          params: {
            threadId,
            turnId: 'turn-1',
            status: options.terminalStatus,
            turn: { id: 'turn-1', status: options.terminalStatus ?? 'completed' },
          },
        }), 0);
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
    get toolCallResponse() {
      return state.toolCallResponse;
    },
    get mcpToolCallParams() {
      return state.mcpToolCallParams;
    },
  };
}
