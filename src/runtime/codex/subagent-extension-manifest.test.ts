import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import {
  defaultSubagentTranscriptRoot,
  prepareRuntimeSubagentInjection,
  runtimeSubagentManifest,
  SUBAGENT_MCP_ENV,
  SUBAGENT_MCP_SERVER_NAME,
  SUBAGENT_SPAWN_AGENT_TOOL_NAME,
} from './subagent-extension-manifest.js';
import { callSubagentMcpTool } from './subagent-mcp-tools.js';
import { createReadOnlySubagentRunner } from './subagent-runner.js';

test('Runtime sub-agent extension manifest exposes a local delegated-worker MCP tool', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = join(workspace, 'subagent-transcripts');
  const injection = await prepareRuntimeSubagentInjection({
    workspace,
    profile: 'sciforge-runtime-deepseek',
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    codexHome: join(workspace, 'codex-home'),
    codexCommand: 'codex',
    parentCommandId: 'codex-command-test',
    parentAttemptId: 'attempt-1',
    transcriptRoot,
  });
  const manifest = runtimeSubagentManifest(injection);

  assert.deepEqual(injection.toolNames, [SUBAGENT_SPAWN_AGENT_TOOL_NAME]);
  assert.ok(injection.configArgs.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.command="node"`));
  assert.ok(injection.configArgs.some((arg) => arg.startsWith(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.args=`) && arg.includes('subagent-mcp-server.ts')));
  assert.ok(injection.configArgs.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.workspace}="${workspace}"`));
  assert.ok(injection.configArgs.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.${SUBAGENT_MCP_ENV.transcriptRoot}="${transcriptRoot}"`));
  assert.ok(injection.configArgs.includes(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.env.SCIFORGE_SUBAGENT_APPROVAL_POLICY="on-request"`));
  assert.equal(JSON.stringify(manifest).includes('provider route'), false);
  assert.equal(JSON.stringify(manifest).includes('raw transcript'), false);
  assert.equal(JSON.stringify(manifest).includes(workspace), false);
});

test('Runtime sub-agent extension prefers compiled JS entrypoint without tsx loader', async () => {
  const workspace = await tempWorkspace();
  const runtimeDir = join(workspace, 'dist-desktop', 'src', 'runtime', 'codex');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(join(runtimeDir, 'subagent-mcp-server.js'), 'export {};\n', 'utf8');
  await writeFile(join(runtimeDir, 'subagent-mcp-server.ts'), 'export {};\n', 'utf8');

  const injection = await prepareRuntimeSubagentInjection({
    workspace,
    profile: 'sciforge-runtime-deepseek',
    sandbox: 'workspace-write',
    codexHome: join(workspace, 'codex-home'),
    runtimeDir,
  });

  const argsConfig = injection.configArgs.find((arg) => arg.startsWith(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.args=`));
  assert.ok(argsConfig);
  assert.match(argsConfig, /subagent-mcp-server\.js/);
  assert.doesNotMatch(argsConfig, /--import|tsx|subagent-mcp-server\.ts/);
});

test('Runtime sub-agent extension resolves bundled codex entrypoint from a parent runtime directory', async () => {
  const workspace = await tempWorkspace();
  const runtimeDir = join(workspace, 'dist-desktop', 'src', 'runtime');
  const codexDir = join(runtimeDir, 'codex');
  await mkdir(codexDir, { recursive: true });
  await writeFile(join(codexDir, 'subagent-mcp-server.js'), 'export {};\n', 'utf8');

  const injection = await prepareRuntimeSubagentInjection({
    workspace,
    profile: 'sciforge-runtime-deepseek',
    sandbox: 'workspace-write',
    codexHome: join(workspace, 'codex-home'),
    runtimeDir,
  });

  const argsConfig = injection.configArgs.find((arg) => arg.startsWith(`mcp_servers.${SUBAGENT_MCP_SERVER_NAME}.args=`));
  assert.ok(argsConfig);
  assert.match(argsConfig, /codex.*subagent-mcp-server\.js/);
  assert.doesNotMatch(argsConfig, /subagent-mcp-server\.ts|tsx/);
});

test('Runtime sub-agent tool returns safe refs and bounded PROJECT TODO summary', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = join(workspace, 'subagent-transcripts');
  await writeFile(join(workspace, 'PROJECT.md'), [
    '# Project',
    '- [ ] Live parity TODO: expose Runtime Codex sub-agent/delegated-worker MCP tool surface and retest transcript/ref.',
    '- [x] Completed diff-detail retest.',
    '',
  ].join('\n'), 'utf8');

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    message: 'Spawn exactly one read-only sub-agent to inspect PROJECT.md and report the remaining TODO. token=super-secret',
    agent_type: 'explorer',
    items: [{ type: 'text', path: 'PROJECT.md' }],
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'codex-command-parent',
    parentAttemptId: 'attempt-1',
    now: () => new Date('2026-05-30T00:00:00.000Z'),
    runner: createReadOnlySubagentRunner(),
  });

  const content = result.structuredContent;
  assert.equal(content.ok, true);
  assert.match(content.agentId, /^explorer-[a-f0-9]{12}$/);
  assert.match(content.resultSummary, /sub-agent\/delegated-worker MCP tool surface/);
  const transcriptRef = requirePublicSubagentRef(content.transcriptRef, /^artifact:subagent-transcript-[a-f0-9]{12}$/);
  const resultRef = requirePublicSubagentRef(content.resultRef, /^artifact:subagent-result-[a-f0-9]{12}$/);
  assert.deepEqual([...content.refs].sort(), [resultRef, transcriptRef, `subagent:${content.agentId}`, 'file:PROJECT.md'].sort());
  assert.doesNotMatch(JSON.stringify(result), /super-secret|Users|Applications|\.sciforge|raw-jsonl|stderr/i);

  const transcriptPath = join(transcriptRoot, `${content.agentId}.json`);
  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8')) as { inspectedRefs: string[] };
  assert.deepEqual(transcript.inspectedRefs, ['file:PROJECT.md']);
  assert.doesNotMatch(JSON.stringify(transcript), /super-secret|Users|Applications|\.sciforge|raw-jsonl|stderr/i);
});

test('Runtime sub-agent default transcript root stays outside the user workspace', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = defaultSubagentTranscriptRoot();

  assert.ok(relative(workspace, transcriptRoot).startsWith('..'));
  assert.ok(transcriptRoot.endsWith(join('subagents', 'transcripts')));
});

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-subagent-extension-'));
  await mkdir(dir, { recursive: true });
  return dir;
}

function requirePublicSubagentRef(value: string | undefined, pattern: RegExp): string {
  if (typeof value !== 'string') assert.fail('Expected public sub-agent ref');
  assert.match(value, pattern);
  return value;
}
