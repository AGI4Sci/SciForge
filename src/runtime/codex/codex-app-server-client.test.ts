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

test('Codex app-server client routes /computer-use through native package bridge before spawning app-server', async () => {
  const workspace = await tempWorkspace();
  const env = await tempRuntimeEnv();
  let spawnCalled = false;
  let runnerCommandText = '';
  let runnerWorkspace = '';
  const client = createCodexAppServerClient({
    env,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('app-server should not spawn for native Computer Use route');
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
    guiExtension: { enabled: false },
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
    guiExtension: { enabled: false },
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
      guiExtension: { enabled: false },
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
      guiExtension: { enabled: false },
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

function fakeAppServer(options: { terminalEvent?: string; terminalStatus?: string } = {}) {
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
    get toolCallResponse() {
      return state.toolCallResponse;
    },
    get mcpToolCallParams() {
      return state.mcpToolCallParams;
    },
  };
}
