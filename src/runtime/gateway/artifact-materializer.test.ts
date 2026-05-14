import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { materializeBackendPayloadOutput, persistArtifactRefsForPayload } from './artifact-materializer.js';
import { backendPayloadRefs } from './generated-task-runner-generation-lifecycle.js';
import type { GatewayRequest, ToolPayload } from '../runtime-types.js';

test('backend direct payload refs are scoped to the date-prefixed session bundle', () => {
  const refs = backendPayloadRefs(
    'agentserver-direct-literature-run',
    'agentserver://direct-payload',
    '.sciforge/sessions/2026-05-12_literature_session-1',
  );

  assert.deepEqual(refs, {
    taskRel: 'agentserver://direct-payload',
    outputRel: '.sciforge/sessions/2026-05-12_literature_session-1/task-results/agentserver-direct-literature-run.json',
    stdoutRel: '.sciforge/sessions/2026-05-12_literature_session-1/logs/agentserver-direct-literature-run.stdout.log',
    stderrRel: '.sciforge/sessions/2026-05-12_literature_session-1/logs/agentserver-direct-literature-run.stderr.log',
  });
});

test('persisted artifact refs do not create top-level legacy artifact copies', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-bundle-artifact-refs-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'write a report',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const records = await persistArtifactRefsForPayload(workspace, request, [
      { id: 'report', type: 'research-report', data: { markdown: '## Report' } },
    ], refs);

    const artifactRef = (records[0].metadata as Record<string, unknown>).artifactRef as string;
    assert.match(artifactRef, /^\.sciforge\/sessions\/2026-05-12_literature_session-1\/artifacts\//);
    assert.equal((records[0].metadata as Record<string, unknown>).legacyArtifactRef, undefined);
    await stat(join(workspace, artifactRef));
    await assert.rejects(stat(join(workspace, '.sciforge/artifacts')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('materialized markdown stays beside session-bundle task results', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-bundle-materializer-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'write a report',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    const payload: ToolPayload = {
      message: 'Report complete.',
      confidence: 0.9,
      claimType: 'result',
      evidenceLevel: 'runtime',
      reasoningTrace: 'materializer test',
      claims: [],
      uiManifest: [],
      executionUnits: [{ id: 'direct', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [{ id: 'report', type: 'research-report', data: { markdown: '## Report\nSession scoped.' } }],
    };
    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const materialized = await materializeBackendPayloadOutput(workspace, request, payload, refs);

    const markdownRef = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/direct-run-report.md';
    assert.equal(materialized.artifacts[0].dataRef, markdownRef);
    assert.equal((materialized.artifacts[0].metadata as Record<string, unknown>).outputRef, refs.outputRel);
    assert.match(await readFile(join(workspace, markdownRef), 'utf8'), /Session scoped/);
    assert.match(await readFile(join(workspace, refs.outputRel), 'utf8'), /materializedOutputRef/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact delivery unwraps readable markdown and keeps raw payload as audit ref', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-delivery-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'write a markdown report',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const payload: ToolPayload = {
      message: 'Report complete.',
      confidence: 0.9,
      claimType: 'result',
      evidenceLevel: 'runtime',
      reasoningTrace: 'delivery test',
      claims: [],
      uiManifest: [],
      executionUnits: [{ id: 'direct', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [{
        id: 'research-report',
        type: 'research-report',
        dataRef: refs.outputRel,
        data: { content: '# arXiv report\n\nReadable markdown body.' },
      }],
    };

    const materialized = await materializeBackendPayloadOutput(workspace, request, payload, refs);
    const artifact = materialized.artifacts[0];
    const markdownRef = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/direct-run-research-report.md';

    assert.equal(artifact.dataRef, markdownRef);
    assert.equal((artifact.delivery as Record<string, unknown>).readableRef, markdownRef);
    assert.equal((artifact.delivery as Record<string, unknown>).rawRef, refs.outputRel);
    assert.equal((artifact.delivery as Record<string, unknown>).previewPolicy, 'inline');
    assert.equal((artifact.delivery as Record<string, unknown>).contentShape, 'raw-file');
    assert.equal((artifact.metadata as Record<string, unknown>).rawRef, refs.outputRel);
    assert.equal(await readFile(join(workspace, markdownRef), 'utf8'), '# arXiv report\n\nReadable markdown body.');
    const rawPayload = await readFile(join(workspace, refs.outputRel), 'utf8');
    assert.match(rawPayload, /sciforge.artifact-delivery.v1/);
    assert.match(rawPayload, /rawRef/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
