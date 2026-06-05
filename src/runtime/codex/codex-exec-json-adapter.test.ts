import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { access, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  ensureRuntimeHome,
  RUNTIME_KEY_ENV,
  RUNTIME_PROFILE,
  RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
} from '../../../packages/backend/src/runtime-home.js';
import { CodexExecJsonAdapter, type SpawnCodexProcess } from './codex-exec-json-adapter.js';
import { defaultGuiExtensionStatePath, GUI_EXTENSION_STATE_ENV, GUI_MCP_SERVER_NAME } from './gui-extension-manifest.js';
import { saveGuiExtensionSnapshot } from './gui-extension-state.js';
import { SUBAGENT_MCP_ENV, SUBAGENT_MCP_SERVER_NAME } from './subagent-extension-manifest.js';

test('adapter spawns codex exec --json with isolated CODEX_HOME and plain text command', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'OK' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const guiStatePath = join(workspace, 'gui-state.json');
  const turn = await adapter.startTurn({
    commandText: 'Summarize the workspace',
    workspacePath: workspace,
    guiExtension: { statePath: guiStatePath },
  });
  const events = await collect(turn.events);

  assert.equal(spawnCall?.[0], 'codex');
  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes('exec'));
  assert.ok(argv.includes('--json'));
  assert.ok(argv.includes('--skip-git-repo-check'));
  assert.ok(argv.includes('--ignore-rules'));
  assert.ok(argv.includes('--sandbox'));
  assert.equal(argv[(argv.indexOf('--sandbox') ?? -2) + 1], 'workspace-write');
  assertConfigPair(argv, RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS);
  assert.ok(argv.includes('--ask-for-approval'));
  assert.equal(argv[(argv.indexOf('--ask-for-approval') ?? -2) + 1], 'never');
  await assert.rejects(access(join(workspace, '.git')));
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.command="node"`));
  assertMcpEntrypointArg(argv, GUI_MCP_SERVER_NAME, 'gui-mcp-server');
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.env.${GUI_EXTENSION_STATE_ENV}="${guiStatePath}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command="node"`));
  assertMcpEntrypointArg(argv, SUBAGENT_MCP_SERVER_NAME, 'subagent-mcp-server');
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.workspace}="${workspace}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.profile}="${RUNTIME_PROFILE}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.sandbox}="workspace-write"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.codexCommand}="codex"`));
  assert.equal(argv[argv.indexOf('--profile') + 1], RUNTIME_PROFILE);
  assert.equal(argv[argv.indexOf('--cd') + 1], workspace);
  assert.deepEqual(argv.slice(-5), ['exec', '--json', '--skip-git-repo-check', '--ignore-rules', 'Summarize the workspace']);
  assert.equal(argv.filter((arg) => arg === 'Summarize the workspace').length, 1);
  assert.match(spawnCall?.[2].env.CODEX_HOME ?? '', /packages\/backend\/\.codex-runtime\/codex-home$/);
  assert.match(spawnCall?.[2].env.PATH ?? '', /packages\/backend\/\.codex-runtime\/gui-extension\/bin/);
  assert.equal(spawnCall?.[2].env.SCIFORGE_GUI_EXTENSION_STATE, guiStatePath);
  await access(join(spawnCall?.[2].env.PATH?.split(':')[0] ?? '', 'gui.present'));
  await access(join(spawnCall?.[2].env.PATH?.split(':')[0] ?? '', 'gui'));
  assert.equal(events.find((event) => event.type === 'message')?.text, 'OK');
  assert.equal(events.at(-1)?.type, 'done');
});

test('adapter accepts inherited approval policy for child Runtime Codex turns', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => child.close(0), 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'Run guarded child task',
    workspacePath: workspace,
    guiExtension: { enabled: false },
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
  });
  await collect(turn.events);

  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes('--sandbox'));
  assert.equal(argv[(argv.indexOf('--sandbox') ?? -2) + 1], 'read-only');
  assert.ok(argv.includes('--ask-for-approval'));
  assert.equal(argv[(argv.indexOf('--ask-for-approval') ?? -2) + 1], 'on-request');
});

test('adapter injects local sub-agent MCP server by default when GUI extension is disabled', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => child.close(0), 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'Delegate safely',
    workspacePath: workspace,
    guiExtension: { enabled: false },
  });
  await collect(turn.events);

  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command="node"`));
  assertMcpEntrypointArg(argv, SUBAGENT_MCP_SERVER_NAME, 'subagent-mcp-server');
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.workspace}="${workspace}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.profile}="${RUNTIME_PROFILE}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.codexHome}="${spawnCall?.[2].env.CODEX_HOME}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentCommandId}="${turn.turnId}"`));
  assert.ok(argv.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.parentAttemptId}="${turn.attemptId}"`));
  assert.equal(argv.some((arg) => arg.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.`)), false);
  assert.deepEqual(argv.slice(-5), ['exec', '--json', '--skip-git-repo-check', '--ignore-rules', 'Delegate safely']);
});

test('adapter converts stderr to audit events and nonzero exit to failed', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stderr.write('diagnostic only');
        child.close(7);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'fail please', workspacePath: workspace, guiExtension: { enabled: false } });
  const events = await collect(turn.events);

  assert.equal(events.find((event) => event.status === 'stderr')?.type, 'audit');
  assert.equal(events.at(-1)?.type, 'failed');
  assert.equal(events.at(-1)?.exitCode, 7);
});

test('adapter writes a bounded scrubbed audit bundle for nonzero exits', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const commandId = 'codex-audit-failed';
  const attemptId = 'attempt-1';
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'turn.failed',
          error: {
            message: 'unexpected status 401 Unauthorized, url: https://provider.example/v1/responses?token=stdout-secret-123456',
          },
          authorization: 'Bearer stdout-secret-token-123456789',
        })}\n`);
        child.stderr.write('Authorization: Bearer stderr-secret-token-123456789 url: http://127.0.0.1:3891/v1/responses?api_key=stderr-secret-123456');
        child.close(7);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'fail with sensitive provider diagnostics',
    workspacePath: workspace,
    commandId,
    attemptId,
    guiExtension: { enabled: false },
  });
  const events = await collect(turn.events);
  const bundle = await readAuditBundle(workspace, commandId, attemptId);
  const streamedEvents = JSON.stringify(events);
  const bundleText = `${JSON.stringify(bundle.manifest)}\n${bundle.rawJsonl}\n${bundle.stderr}\n${bundle.normalizedEvents}`;

  assert.equal(bundle.manifest.status, 'failed');
  assert.equal(bundle.manifest.exitCode, 7);
  assert.equal(bundle.manifest.commandId, commandId);
  assert.equal(bundle.manifest.attemptId, attemptId);
  await assertAuditBundleManifestFiles(workspace, bundle);
  assert.deepEqual(bundle.manifest.evidenceRefs, [
    `audit:codex-runtime:${commandId}:${attemptId}:raw-jsonl`,
    `audit:codex-runtime:${commandId}:${attemptId}:stderr`,
    `audit:codex-runtime:${commandId}:${attemptId}:normalized-events`,
  ]);
  assert.match(bundle.rawJsonl, /\[redacted-url:sha256:/);
  assert.match(bundle.stderr, /\[redacted-secret:sha256:/);
  assert.match(bundle.normalizedEvents, /Runtime Codex exited with code 7/);
  assert.doesNotMatch(bundleText, /stdout-secret|stderr-secret|provider\.example|127\.0\.0\.1:3891/);
  assert.doesNotMatch(streamedEvents, /stdout-secret|stderr-secret|provider\.example|127\.0\.0\.1:3891/);
  assert.ok(events.at(-1)?.evidenceRefs?.includes(`audit:codex-runtime:${commandId}:${attemptId}:stderr`));
});

test('adapter writes a scrubbed audit bundle for successful turns', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const commandId = 'codex-audit-success';
  const attemptId = 'attempt-1';
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'session_meta',
          payload: { id: '019e3e82-164d-79b2-a5d4-b16241620b10' },
          endpoint: 'https://provider.example/v1/responses?api_key=success-secret-123456',
        })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'OK' })}\n`);
        child.stderr.write('warning token=success-secret-token-123456');
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'succeed with sensitive provider diagnostics',
    workspacePath: workspace,
    commandId,
    attemptId,
    guiExtension: { enabled: false },
  });
  const events = await collect(turn.events);
  const bundle = await readAuditBundle(workspace, commandId, attemptId);
  const bundleText = `${JSON.stringify(bundle.manifest)}\n${bundle.rawJsonl}\n${bundle.stderr}\n${bundle.normalizedEvents}`;

  assert.equal(bundle.manifest.status, 'done');
  assert.equal(bundle.manifest.exitCode, 0);
  assert.equal(bundle.manifest.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  await assertAuditBundleManifestFiles(workspace, bundle);
  assert.match(bundle.normalizedEvents, /Runtime Codex completed successfully/);
  assert.match(bundle.rawJsonl, /\[redacted-url:sha256:/);
  assert.match(bundle.stderr, /\[redacted-secret:sha256:/);
  assert.doesNotMatch(bundleText, /success-secret|provider\.example/);
  assert.equal(events.find((event) => event.type === 'message')?.text, 'OK');
  assert.equal(events.at(-1)?.type, 'done');
});

test('adapter bounds and scrubs oversized HTML challenge audit diagnostics', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const commandId = 'codex-audit-html-challenge';
  const attemptId = 'attempt-1';
  const tokenUrl = 'https://provider.example/v1/responses?token=html-token-secret-123456&api_key=html-api-secret-123456';
  const rawHtmlChallenge = [
    '<html><head><title>provider challenge</title></head><body>',
    '<script>window.challengeTokenUrl = "https://provider.example/challenge?token=challenge-token-secret-123456";</script>',
    '<form action="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page" method="POST">',
    '<input name="secret" value="html-form-secret-123456">',
    '</form></body></html>',
  ].join('');
  const oversizedBody = `${rawHtmlChallenge}\n${tokenUrl}\nBearer html-bearer-secret-123456789\n${'diagnostic-padding '.repeat(20000)}`;
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'turn.failed',
          error: {
            message: `${rawHtmlChallenge} ${tokenUrl}`,
          },
          authorization: 'Bearer stdout-html-secret-token-123456789',
          challengeBody: oversizedBody,
        })}\n`);
        child.stderr.write(`HTTP 403 challenge body:\n${oversizedBody}\ntoken_url=${tokenUrl}\nsecret=stderr-html-secret-123456789`);
        child.close(1);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'fail with oversized provider challenge diagnostics',
    workspacePath: workspace,
    commandId,
    attemptId,
    guiExtension: { enabled: false },
  });
  const events = await collect(turn.events);
  const bundle = await readAuditBundle(workspace, commandId, attemptId);
  await assertAuditBundleManifestFiles(workspace, bundle);
  const rawJsonlFile = auditFileMetadata(bundle.manifest, 'rawJsonl');
  const stderrFile = auditFileMetadata(bundle.manifest, 'stderr');
  const primaryText = JSON.stringify(events);
  const manifestText = JSON.stringify(bundle.manifest);
  const bundleText = `${manifestText}\n${bundle.rawJsonl}\n${bundle.stderr}\n${bundle.normalizedEvents}`;
  const forbidden = /<html|cdn-cgi\/challenge-platform|challenge-token-secret|html-token-secret|html-api-secret|html-form-secret|html-bearer-secret|stdout-html-secret|stderr-html-secret|provider\.example/i;

  assert.equal(bundle.manifest.status, 'failed');
  assert.equal(events.at(-1)?.type, 'failed');
  assert.equal(rawJsonlFile.truncated, true);
  assert.equal(stderrFile.truncated, true);
  assert.ok(rawJsonlFile.bytes <= rawJsonlFile.maxBytes);
  assert.ok(stderrFile.bytes <= stderrFile.maxBytes);
  assert.match(bundle.rawJsonl, /\[redacted-url:sha256:/);
  assert.match(bundle.stderr, /\[redacted-url:sha256:/);
  assert.match(bundle.stderr, /\[redacted-secret:sha256:/);
  assert.doesNotMatch(primaryText, forbidden);
  assert.doesNotMatch(manifestText, forbidden);
  assert.doesNotMatch(bundleText, forbidden);
});

test('adapter prioritizes actionable provider errors in stderr summaries', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stderr.write(`${'warning '.repeat(80)} unexpected status 401 Unauthorized: Invalid token (request id: req-test), url: http://127.0.0.1:3891/v1/responses`);
        child.close(1);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'fail please', workspacePath: workspace, guiExtension: { enabled: false } });
  const events = await collect(turn.events);
  const failed = events.at(-1);
  const raw = failed?.raw as { stderrSummary?: string } | undefined;

  assert.equal(failed?.type, 'failed');
  assert.match(raw?.stderrSummary ?? '', /401 Unauthorized/);
  assert.doesNotMatch(raw?.stderrSummary ?? '', /^warning warning/);
});

test('adapter preserves actionable 502 gateway errors in stderr summaries', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stderr.write(`${'warning '.repeat(80)} unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:3891/v1/responses`);
        child.close(1);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'fail please', workspacePath: workspace, guiExtension: { enabled: false } });
  const events = await collect(turn.events);
  const failed = events.at(-1);
  const raw = failed?.raw as { stderrSummary?: string } | undefined;

  assert.equal(failed?.type, 'failed');
  assert.match(raw?.stderrSummary ?? '', /502 Bad Gateway/);
  assert.doesNotMatch(raw?.stderrSummary ?? '', /^warning warning/);
});


test('adapter emits gui_present from file-backed GUI intent state before done', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const guiStatePath = join(workspace, 'gui-state.json');
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        void saveGuiExtensionSnapshot(guiStatePath, {
          revision: 2,
          focusedPanel: 'chat',
          layoutMode: 'desktop',
          hotRegion: {
            panel: 'chat',
            primaryRef: 'artifact:runtime-answer',
            selectedRefs: ['artifact:runtime-answer'],
            interactionMode: 'reading',
            lastChangeOrigin: 'agent',
            lastChangeAt: '2026-05-19T00:00:00.000Z',
            availableActions: [],
          },
          regions: [{
            regionId: 'chat',
            viewId: 'artifact:runtime-answer',
            visibleRefs: ['artifact:runtime-answer'],
            affordances: [],
            title: 'Runtime answer',
            summary: 'VISIBLE_FROM_GUI_STATE',
          }],
          intentLog: [{
            id: 'gui.present:1',
            tool: 'gui.present',
            createdAt: '2026-05-19T00:00:00.000Z',
            revision: 2,
            summary: 'show-result artifact:runtime-answer Runtime answer',
            applied: true,
            deferred: false,
            reason: null,
            placement: { panel: 'chat', viewId: 'artifact:runtime-answer' },
          }],
        }).then(() => child.close(0));
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'present with GUI',
    workspacePath: workspace,
    guiExtension: { statePath: guiStatePath },
  });
  const events = await collect(turn.events);
  const guiPresentIndex = events.findIndex((event) => event.type === 'gui_present');
  const doneIndex = events.findIndex((event) => event.type === 'done');

  assert.ok(guiPresentIndex >= 0);
  assert.ok(doneIndex > guiPresentIndex);
  assert.equal(events[guiPresentIndex]?.text, 'VISIBLE_FROM_GUI_STATE');
  assert.equal(((events[guiPresentIndex]?.raw as { presentation?: { source?: string } }).presentation)?.source, `gui.present:${turn.turnId}`);
});

test('adapter defaults GUI intent state outside the user workspace', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => child.close(0), 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'use GUI state',
    workspacePath: workspace,
    guiExtension: {},
  });
  await collect(turn.events);

  const expectedStatePath = defaultGuiExtensionStatePath({ commandId: turn.turnId, attemptId: turn.attemptId });
  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.env.${GUI_EXTENSION_STATE_ENV}="${expectedStatePath}"`));
  assert.equal(spawnCall?.[2].env.SCIFORGE_GUI_EXTENSION_STATE, expectedStatePath);
  assert.ok(relative(workspace, expectedStatePath).startsWith('..'));
  await access(expectedStatePath);
});

test('adapter isolates default GUI intent state per command attempt', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  await saveGuiExtensionSnapshot(join(workspace, '.sciforge', 'runtime-gui-extension-state.json'), {
    revision: 2,
    focusedPanel: 'chat',
    layoutMode: 'desktop',
    hotRegion: {
      panel: 'chat',
      primaryRef: 'artifact:stale-report',
      selectedRefs: ['artifact:stale-report'],
      interactionMode: 'reading',
      lastChangeOrigin: 'agent',
      lastChangeAt: '2026-05-19T00:00:00.000Z',
      availableActions: [],
    },
    regions: [{
      regionId: 'chat',
      viewId: 'artifact:stale-report',
      visibleRefs: ['artifact:stale-report'],
      affordances: [],
      title: 'Stale report',
      summary: 'STALE_GUI_PRESENT_SHOULD_NOT_LEAK',
    }],
    intentLog: [{
      id: 'gui.present:old',
      tool: 'gui.present',
      createdAt: '2026-05-19T00:00:00.000Z',
      revision: 2,
      summary: 'show-result artifact:stale-report Stale report',
      applied: true,
      deferred: false,
      reason: null,
      placement: { panel: 'chat', viewId: 'artifact:stale-report' },
    }],
  });
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => child.close(0), 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'complete without GUI presentation',
    workspacePath: workspace,
    guiExtension: {},
  });
  const events = await collect(turn.events);
  const expectedStatePath = defaultGuiExtensionStatePath({ commandId: turn.turnId, attemptId: turn.attemptId });

  assert.equal(events.some((event) => event.type === 'gui_present'), false);
  assert.doesNotMatch(JSON.stringify(events), /STALE_GUI_PRESENT_SHOULD_NOT_LEAK|artifact:stale-report/);
  assert.ok(relative(workspace, expectedStatePath).startsWith('..'));
  await access(expectedStatePath);
});

test('adapter emits resume-failed audit before failed exit on native resume failure', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stderr.write('resume store missing');
        child.close(9);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'resume please',
    workspacePath: workspace,
    codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
    guiExtension: { enabled: false },
  });
  const events = await collect(turn.events);
  const resumeFailureIndex = events.findIndex((event) => event.status === 'resume-failed');
  const failedIndex = events.findIndex((event) => event.type === 'failed');

  assert.ok(resumeFailureIndex >= 0);
  assert.ok(failedIndex > resumeFailureIndex);
  assert.match(events[resumeFailureIndex]?.message ?? '', /019e3e82-164d-79b2-a5d4-b16241620b10/);
  assert.equal(((events[resumeFailureIndex]?.raw as { boundary?: string }).boundary), 'resume-fail-closed');
  assert.equal(((events[resumeFailureIndex]?.raw as { stderrSummary?: string }).stderrSummary), 'resume store missing');
});

test('adapter fails closed before spawn when runtime API key is missing', async () => {
  let spawnCalled = false;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: {},
    spawnProcess() {
      spawnCalled = true;
      return fakeChild().process;
    },
  });

  await assert.rejects(
    () => adapter.startTurn({ commandText: 'should not fall back', workspacePath: workspace, guiExtension: { enabled: false } }),
    new RegExp(`Missing ${RUNTIME_KEY_ENV}`),
  );
  assert.equal(spawnCalled, false);
});

test('adapter rejects Developer profile instead of falling back from runtime profile', async () => {
  let spawnCalled = false;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      spawnCalled = true;
      return fakeChild().process;
    },
  });

  await assert.rejects(
    () => adapter.startTurn({
      commandText: 'should not use developer profile',
      workspacePath: workspace,
      profile: 'default',
      guiExtension: { enabled: false },
    }),
    /Unsupported Runtime Codex profile: default/,
  );
  assert.equal(spawnCalled, false);
});

test('adapter applies sandbox env override while keeping workspace-write network config', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: {
      [RUNTIME_KEY_ENV]: 'test-key',
      SCIFORGE_RUNTIME_CODEX_SANDBOX: 'danger-full-access',
    },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => child.close(0), 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'use sandbox override',
    workspacePath: workspace,
    guiExtension: { enabled: false },
  });
  const events = await collect(turn.events);
  const argv = spawnCall?.[1] ?? [];
  const started = events.find((event) => event.type === 'run_started');

  assert.equal(argv[argv.indexOf('--sandbox') + 1], 'danger-full-access');
  assertConfigPair(argv, RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS);
  assert.equal(((started?.raw as { runtimeSandbox?: string })?.runtimeSandbox), 'danger-full-access');
});

test('adapter refuses forked Codex command overrides unless compatibility fork gate is documented', async () => {
  let spawnCalled = false;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: {
      [RUNTIME_KEY_ENV]: 'test-key',
      SCIFORGE_RUNTIME_CODEX_COMMAND: '/vendor/codex-fork/bin/codex',
    },
    spawnProcess() {
      spawnCalled = true;
      return fakeChild().process;
    },
  });

  await assert.rejects(
    () => adapter.startTurn({
      commandText: 'should use upstream codex',
      workspacePath: workspace,
      guiExtension: { enabled: false },
    }),
    /must use upstream "codex"/,
  );
  assert.equal(spawnCalled, false);
});

test('adapter resumes native Codex session when codexSessionId is provided', async () => {
  const child = fakeChild();
  let spawnCall: Parameters<SpawnCodexProcess> | undefined;
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess(command, args, options) {
      spawnCall = [command, args, options];
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'remembered' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({
    commandText: 'What did I ask you to remember?',
    workspacePath: workspace,
    codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
  });
  await collect(turn.events);

  assert.equal(turn.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(spawnCall?.[0], 'codex');
  const argv = spawnCall?.[1] ?? [];
  assert.ok(argv.includes(`mcp_servers.${GUI_MCP_SERVER_NAME}.command="node"`));
  assert.ok(argv.includes('--sandbox'));
  assert.equal(argv[(argv.indexOf('--sandbox') ?? -2) + 1], 'workspace-write');
  assertConfigPair(argv, RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS);
  assert.ok(argv.includes('--ask-for-approval'));
  assert.equal(argv[(argv.indexOf('--ask-for-approval') ?? -2) + 1], 'never');
  await assert.rejects(access(join(workspace, '.git')));
  assert.equal(argv[argv.indexOf('--profile') + 1], RUNTIME_PROFILE);
  assert.equal(argv[argv.indexOf('--cd') + 1], workspace);
  assert.deepEqual(argv.slice(-7), [
    'exec',
    'resume',
    '--json',
    '--skip-git-repo-check',
    '--ignore-rules',
    '019e3e82-164d-79b2-a5d4-b16241620b10',
    'What did I ask you to remember?',
  ]);
  assert.equal(argv.filter((arg) => arg === 'What did I ask you to remember?').length, 1);
  assert.equal(argv.at(-2), '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(argv.at(-1), 'What did I ask you to remember?');
});

test('adapter surfaces native Codex session id from session_meta events', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      setTimeout(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'session_meta',
          payload: { id: '019e3e82-164d-79b2-a5d4-b16241620b10' },
        })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'agent_message', message: 'OK' })}\n`);
        child.close(0);
      }, 0);
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'remember this', workspacePath: workspace });
  const events = await collect(turn.events);

  assert.equal(events.find((event) => event.type === 'message')?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
  assert.equal(events.at(-1)?.codexSessionId, '019e3e82-164d-79b2-a5d4-b16241620b10');
});

test('adapter cancel sends SIGTERM and emits cancelled on signal close', async () => {
  const child = fakeChild();
  const workspace = await tempWorkspace();
  const adapter = new CodexExecJsonAdapter({
    env: { [RUNTIME_KEY_ENV]: 'test-key' },
    spawnProcess() {
      return child.process;
    },
  });

  const turn = await adapter.startTurn({ commandText: 'long run', workspacePath: workspace, guiExtension: { enabled: false } });
  const eventsPromise = collect(turn.events);
  await adapter.cancel(turn.turnId);
  child.close(null, 'SIGTERM');
  const events = await eventsPromise;

  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(events.at(-1)?.type, 'cancelled');
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of iterable) result.push(event);
  return result;
}

async function tempWorkspace() {
  await ensureRuntimeHome({ overwrite: true });
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-codex-adapter-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readAuditBundle(workspace: string, commandId: string, attemptId: string) {
  const dir = join(workspace, '.sciforge', 'runtime-codex', commandId, attemptId);
  return {
    manifest: JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>,
    rawJsonl: await readFile(join(dir, 'raw-jsonl.scrubbed.jsonl'), 'utf8'),
    stderr: await readFile(join(dir, 'stderr.scrubbed.log'), 'utf8'),
    normalizedEvents: await readFile(join(dir, 'normalized-events.jsonl'), 'utf8'),
  };
}

type AuditBundle = Awaited<ReturnType<typeof readAuditBundle>>;

type AuditFileMetadata = {
  path: string;
  bytes: number;
  maxBytes: number;
  rawSha256: string;
  truncated: boolean;
};

async function assertAuditBundleManifestFiles(workspace: string, bundle: AuditBundle): Promise<void> {
  const files = recordField(bundle.manifest, 'files');
  const manifestPath = stringField(files, 'manifest');
  await assertManifestPathExists(workspace, manifestPath);

  await assertAuditFileManifest(workspace, files, 'rawJsonl');
  await assertAuditFileManifest(workspace, files, 'stderr');
  await assertAuditFileManifest(workspace, files, 'normalizedEvents');
}

async function assertAuditFileManifest(workspace: string, files: Record<string, unknown>, key: string): Promise<void> {
  const entry = auditFileMetadataFromFiles(files, key);
  const resolvedPath = await assertManifestPathExists(workspace, entry.path);
  const stats = await stat(resolvedPath);

  assert.equal(entry.bytes, stats.size);
  assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
  assert.ok(Number.isSafeInteger(entry.maxBytes) && entry.maxBytes > 0);
  assert.ok(entry.bytes <= entry.maxBytes);
  assert.match(entry.rawSha256, /^sha256:[a-f0-9]{64}$/);
}

function auditFileMetadata(manifest: Record<string, unknown>, key: string): AuditFileMetadata {
  return auditFileMetadataFromFiles(recordField(manifest, 'files'), key);
}

function auditFileMetadataFromFiles(files: Record<string, unknown>, key: string): AuditFileMetadata {
  const entry = recordField(files, key);
  return {
    path: stringField(entry, 'path'),
    bytes: numberField(entry, 'bytes'),
    maxBytes: numberField(entry, 'maxBytes'),
    rawSha256: stringField(entry, 'rawSha256'),
    truncated: booleanField(entry, 'truncated'),
  };
}

async function assertManifestPathExists(workspace: string, path: string): Promise<string> {
  assert.equal(isAbsolute(path), false);
  const resolvedPath = resolve(workspace, path);
  const workspaceRoot = resolve(workspace);
  const relativePath = relative(workspaceRoot, resolvedPath);
  assert.ok(relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath));
  await access(resolvedPath);
  return resolvedPath;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.equal(typeof value, 'string');
  const text = value as string;
  assert.ok(text.length > 0);
  return text;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  assert.equal(typeof value, 'number');
  return value as number;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  assert.equal(typeof value, 'boolean');
  return value as boolean;
}

function assertConfigPair(argv: string[], pair: readonly [string, string]): void {
  assert.ok(argv.some((arg, index) => arg === pair[0] && argv[index + 1] === pair[1]));
}

function assertMcpEntrypointArg(argv: string[], serverName: string, entrypointName: string): void {
  const argsConfig = argv.find((arg) => arg.startsWith(`mcp_servers.${serverName}.args=`));
  assert.ok(argsConfig);
  assert.match(argsConfig, new RegExp(`${entrypointName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(ts|js)`));
}

function fakeChild() {
  const emitter = new EventEmitter() as ChildProcessByStdio<null, Readable, Readable>;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const killSignals: string[] = [];
  Object.defineProperties(emitter, {
    stdout: { value: stdout },
    stderr: { value: stderr },
    stdin: { value: new PassThrough() },
    killed: { value: false, writable: true },
    kill: {
      value(signal?: NodeJS.Signals | number) {
        killSignals.push(String(signal ?? 'SIGTERM'));
        return true;
      },
    },
  });
  return {
    process: emitter,
    stdout,
    stderr,
    killSignals,
    close(code: number | null, signal: NodeJS.Signals | null = null) {
      stdout.end();
      stderr.end();
      emitter.emit('close', code, signal);
    },
  };
}
