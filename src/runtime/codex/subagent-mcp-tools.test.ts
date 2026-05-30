import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callSubagentMcpTool } from './subagent-mcp-tools.js';
import { SUBAGENT_SPAWN_AGENT_TOOL_NAME } from './subagent-extension-manifest.js';

test('spawn_agent inspects safe workspace refs without exposing private diagnostics', async () => {
  const workspace = await tempWorkspace();
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'sciforge-subagent-transcripts-'));
  await writeFile(join(workspace, 'PROJECT.md'), [
    '# Project',
    '- [ ] Remaining live parity TODO: expose Runtime Codex sub-agent/delegated-worker MCP tool surface and retest transcript/ref.',
    '',
  ].join('\n'), 'utf8');

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    message: 'Inspect PROJECT.md and report the single remaining sub-agent TODO. token=secret-token-123456.',
    agentType: 'reviewer',
    refs: [
      'artifact:input-ok',
      'trace:unsafe-input',
      '/Applications/workspace/ailab/research/app/SciForge/.sciforge/raw/input.json',
      'PROJECT.md',
    ],
  }, {
    workspace,
    transcriptRoot,
    parentCommandId: 'parent-command-1',
    parentAttemptId: 'parent-attempt-1',
    now: () => new Date('2026-05-30T00:00:00.000Z'),
  });

  const structured = result.structuredContent;
  const publicText = JSON.stringify(result);

  assert.match(structured.agentId, /^reviewer-[a-f0-9]{12}$/);
  assert.equal(structured.status, 'completed');
  assert.match(structured.transcriptRef, /^artifact:subagent-transcript-[a-f0-9]{12}$/);
  assert.match(structured.resultRef, /^artifact:subagent-result-[a-f0-9]{12}$/);
  assert.deepEqual(structured.refs.sort(), [structured.resultRef, structured.transcriptRef, 'file:PROJECT.md'].sort());
  assert.match(structured.resultSummary, /sub-agent\/delegated-worker MCP tool surface/);
  assert.doesNotMatch(publicText, /\/Applications|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret-token|trace:unsafe/i);
  assert.equal(result.content[0].text, JSON.stringify(structured, null, 2));

  const transcript = await readFile(join(transcriptRoot, `${structured.agentId}.json`), 'utf8');
  assert.match(transcript, /file:PROJECT\.md/);
  assert.doesNotMatch(transcript, /\/Applications|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret-token|trace:unsafe/i);
});

test('spawn_agent accepts missing refs and still returns safe lifecycle refs', async () => {
  const workspace = await tempWorkspace();

  const result = await callSubagentMcpTool(SUBAGENT_SPAWN_AGENT_TOOL_NAME, {
    task: 'Summarize the unavailable worker context.',
    agentId: '/tmp/unsafe-agent',
  }, {
    workspace,
    now: () => new Date('2026-05-30T00:00:00.000Z'),
  });

  const structured = result.structuredContent;

  assert.equal(structured.status, 'completed');
  assert.match(structured.agentId, /^worker-[a-f0-9]{12}$/);
  assert.match(structured.resultSummary, /Read-only delegated worker completed/);
  assert.deepEqual(structured.refs, [structured.resultRef, structured.transcriptRef]);
  assert.doesNotMatch(JSON.stringify(result), /\/tmp|\.sciforge|stdout|stderr|\braw\b|\blogs?\b|secret/i);
});

async function tempWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-subagent-tool-'));
  await mkdir(dir, { recursive: true });
  return dir;
}
