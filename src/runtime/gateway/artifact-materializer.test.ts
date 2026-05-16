import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { materializeBackendPayloadOutput, normalizeArtifactsForPayload, persistArtifactRefsForPayload } from './artifact-materializer.js';
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
    assert.equal(materialized.objectReferences?.some((reference) => reference.kind === 'file' && reference.ref === `file:${refs.outputRel}`), false);
    assert.equal(materialized.objectReferences?.some((reference) => reference.kind === 'artifact' && reference.ref === 'artifact:research-report'), true);
    assert.equal(await readFile(join(workspace, markdownRef), 'utf8'), '# arXiv report\n\nReadable markdown body.');
    const rawPayload = await readFile(join(workspace, refs.outputRel), 'utf8');
    assert.match(rawPayload, /sciforge.artifact-delivery.v1/);
    assert.match(rawPayload, /rawRef/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact delivery exposes file-backed csv and image artifacts as supporting evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-delivery-files-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'create a reproducible data analysis project with csv and charts',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const csvRel = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/experiment_data.csv';
    const plotRel = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/boxplot_treatment_timepoint.png';
    await mkdir(dirname(join(workspace, csvRel)), { recursive: true });
    await writeFile(join(workspace, csvRel), 'sample_id,batch,response\nS1,B1,1.2\n', 'utf8');
    await writeFile(join(workspace, plotRel), 'png-bytes-placeholder', 'utf8');

    const payload: ToolPayload = {
      message: 'Analysis complete.',
      confidence: 0.9,
      claimType: 'result',
      evidenceLevel: 'runtime',
      reasoningTrace: 'delivery file refs test',
      claims: [],
      uiManifest: [
        { componentId: 'paper-card-list', artifactRef: 'experiment_data' },
        { componentId: 'unknown-artifact-inspector', artifactRef: 'boxplot_treatment_timepoint' },
      ],
      executionUnits: [{ id: 'direct', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [
        { id: 'experiment_data', type: 'csv', path: csvRel },
        { id: 'boxplot_treatment_timepoint', type: 'image', path: plotRel },
        { id: 'execution-summary', type: 'json', data: { command: 'python analysis.py' } },
      ],
    };

    const materialized = await materializeBackendPayloadOutput(workspace, request, payload, refs);
    const csv = materialized.artifacts.find((artifact) => artifact.id === 'experiment_data')!;
    const plot = materialized.artifacts.find((artifact) => artifact.id === 'boxplot_treatment_timepoint')!;
    const summary = materialized.artifacts.find((artifact) => artifact.id === 'execution-summary')!;
    const csvDelivery = csv.delivery as Record<string, unknown>;
    const plotDelivery = plot.delivery as Record<string, unknown>;
    const summaryDelivery = summary.delivery as Record<string, unknown>;

    assert.equal(csvDelivery.role, 'supporting-evidence');
    assert.equal(csvDelivery.previewPolicy, 'inline');
    assert.equal(csvDelivery.readableRef, csvRel);
    assert.equal(plotDelivery.role, 'supporting-evidence');
    assert.equal(plotDelivery.previewPolicy, 'open-system');
    assert.equal(plotDelivery.readableRef, plotRel);
    assert.equal(plotDelivery.declaredExtension, 'png');
    assert.equal(plotDelivery.declaredMediaType, 'image/png');
    assert.equal(summaryDelivery.role, 'internal');
    assert.equal(summaryDelivery.previewPolicy, 'audit-only');
    assert.ok(materialized.objectReferences?.some((reference) => reference.ref === 'artifact:experiment_data' && reference.presentationRole === 'supporting-evidence'));
    assert.ok(materialized.objectReferences?.some((reference) => reference.ref === 'artifact:boxplot_treatment_timepoint' && reference.presentationRole === 'supporting-evidence'));
    assert.equal(materialized.objectReferences?.some((reference) => reference.ref === 'artifact:execution-summary'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact delivery prefers an existing markdown file over shorter inline summary text', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-delivery-existing-markdown-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'review a protocol and emit a markdown checklist artifact',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const protocolRel = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/p5_protocol_checklist.md';
    const derivedRel = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/direct-run-p5_protocol_checklist.md';
    await mkdir(dirname(join(workspace, protocolRel)), { recursive: true });
    await writeFile(join(workspace, protocolRel), '# Full Protocol\n\n## Primary Endpoint\n\nComplete protocol body.', 'utf8');

    const payload: ToolPayload = {
      message: 'Protocol generated. See artifact for full protocol/checklist.',
      confidence: 0.85,
      claimType: 'methodology-review',
      evidenceLevel: 'expert-review',
      reasoningTrace: 'delivery existing markdown test',
      claims: [],
      uiManifest: [{ componentId: 'report-viewer', artifactRef: 'p5_protocol_checklist' }],
      executionUnits: [{ id: 'direct', status: 'done', tool: 'agentserver.direct' }],
      artifacts: [{
        id: 'p5_protocol_checklist',
        type: 'research-report',
        path: protocolRel,
        data: { markdown: 'Protocol generated. See artifact for full protocol/checklist.' },
      }],
    };

    const materialized = await materializeBackendPayloadOutput(workspace, request, payload, refs);
    const artifact = materialized.artifacts[0];
    const delivery = artifact.delivery as Record<string, unknown>;

    assert.equal(artifact.dataRef, protocolRel);
    assert.equal(delivery.readableRef, protocolRel);
    assert.equal(delivery.previewPolicy, 'inline');
    assert.equal((artifact.metadata as Record<string, unknown>).readableRef, protocolRel);
    assert.equal((artifact.metadata as Record<string, unknown>).markdownRef, protocolRel);
    assert.equal(await readFile(join(workspace, protocolRel), 'utf8'), '# Full Protocol\n\n## Primary Endpoint\n\nComplete protocol body.');
    await assert.rejects(stat(join(workspace, derivedRel)));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('workspace-relative file artifacts are copied into session task-results before delivery', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-delivery-workspace-files-'));
  try {
    const request: GatewayRequest = {
      skillDomain: 'literature',
      prompt: 'create a reproducible data analysis project with csv and charts',
      workspacePath: workspace,
      artifacts: [],
      uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-12T00:00:00.000Z' },
    };
    await mkdir(join(workspace, 'output'), { recursive: true });
    await writeFile(join(workspace, 'output/experiment_data.csv'), 'sample_id,batch,response\nS1,B1,1.2\n', 'utf8');
    await writeFile(join(workspace, 'output/chart_treatment_timepoint.png'), 'png-bytes-placeholder', 'utf8');

    const refs = backendPayloadRefs('direct-run', 'agentserver://direct-payload', '.sciforge/sessions/2026-05-12_literature_session-1');
    const normalizedArtifacts = await normalizeArtifactsForPayload([
      { id: 'experiment_data', type: 'csv', path: 'output/experiment_data.csv' },
      { id: 'chart_treatment_timepoint', type: 'image', path: 'output/chart_treatment_timepoint.png' },
    ], workspace, refs);
    assert.equal(normalizedArtifacts[0]?.path, '.sciforge/sessions/2026-05-12_literature_session-1/task-results/output/experiment_data.csv');
    assert.equal(await readFile(join(workspace, '.sciforge/sessions/2026-05-12_literature_session-1/task-results/output/experiment_data.csv'), 'utf8'), 'sample_id,batch,response\nS1,B1,1.2\n');

    const payload: ToolPayload = {
      message: 'Analysis complete.',
      confidence: 0.9,
      claimType: 'result',
      evidenceLevel: 'runtime',
      reasoningTrace: 'workspace file refs test',
      claims: [],
      uiManifest: [],
      executionUnits: [{ id: 'direct', status: 'done', tool: 'agentserver.direct' }],
      artifacts: normalizedArtifacts,
    };
    const materialized = await materializeBackendPayloadOutput(workspace, request, payload, refs);
    const csv = materialized.artifacts.find((artifact) => artifact.id === 'experiment_data')!;
    const chart = materialized.artifacts.find((artifact) => artifact.id === 'chart_treatment_timepoint')!;
    const csvDelivery = csv.delivery as { role?: string; previewPolicy?: string } | undefined;
    const chartDelivery = chart.delivery as { role?: string; previewPolicy?: string } | undefined;
    assert.equal(csvDelivery?.role, 'supporting-evidence');
    assert.equal(csvDelivery?.previewPolicy, 'inline');
    assert.equal(chartDelivery?.role, 'supporting-evidence');
    assert.equal(chartDelivery?.previewPolicy, 'open-system');
    assert.ok(materialized.objectReferences?.some((reference) => reference.ref === 'artifact:experiment_data' && reference.presentationRole === 'supporting-evidence'));
    assert.ok(materialized.objectReferences?.some((reference) => reference.ref === 'artifact:chart_treatment_timepoint' && reference.presentationRole === 'supporting-evidence'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('artifact file refs are scoped beside task result output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-artifact-relative-ref-'));
  try {
    const refs = backendPayloadRefs('generated-run', 'agentserver://generated-task', '.sciforge/sessions/2026-05-12_literature_session-1');
    const reportRel = '.sciforge/sessions/2026-05-12_literature_session-1/task-results/research-report.md';
    await mkdir(dirname(join(workspace, reportRel)), { recursive: true });
    await writeFile(join(workspace, reportRel), '# Report\n\nScoped markdown.', 'utf8');

    const artifacts = await normalizeArtifactsForPayload([
      { id: 'research-report', type: 'research-report', path: 'research-report.md' },
    ], workspace, refs);

    assert.equal(artifacts[0]?.path, reportRel);
    assert.equal(artifacts[0]?.dataRef, reportRel);
    assert.equal((artifacts[0]?.data as Record<string, unknown>).markdown, '# Report\n\nScoped markdown.');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
