import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listSessionArtifacts,
  readArtifact,
  renderArtifact,
  resumeRun,
  resolveObjectReference,
} from '../../src/runtime/backend-artifact-tools';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-backend-artifact-tools-'));
const sessionId = 'session-tool-smoke';
const runId = 'session-tool-smoke-run';
const outputRef = '.sciforge/task-results/session-tool-smoke.json';
const stdoutRef = '.sciforge/logs/session-tool-smoke.stdout.log';
const stderrRef = '.sciforge/logs/session-tool-smoke.stderr.log';
await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
await mkdir(join(workspace, '.sciforge', 'task-attempts'), { recursive: true });
await mkdir(join(workspace, '.sciforge', 'task-results'), { recursive: true });
await mkdir(join(workspace, '.sciforge', 'logs'), { recursive: true });
await mkdir(join(workspace, 'notes'), { recursive: true });
await writeFile(join(workspace, '.sciforge', 'artifacts', `${sessionId}-research-report.json`), JSON.stringify({
  id: 'research-report',
  type: 'research-report',
  producerScenario: 'literature',
  producerSessionId: sessionId,
  schemaVersion: '1',
  data: {
    markdown: '# Literature Report\n\n- Backend tools can read stable artifact refs.',
  },
  metadata: {
    title: 'Literature Report',
    outputRef,
  },
}, null, 2), 'utf8');
await writeFile(join(workspace, '.sciforge', 'artifacts', `${sessionId}-agentserver-report.json`), JSON.stringify({
  id: 'agentserver-report',
  type: 'research-report',
  producerScenario: 'literature',
  producerSessionId: sessionId,
  schemaVersion: '1',
  dataRef: `agentserver://${sessionId}/live-report.md`,
  data: {
    markdown: '# Materialized AgentServer Report\n\n- Temporary backend refs resolve through stable artifacts.',
  },
  metadata: {
    title: 'Materialized AgentServer Report',
  },
}, null, 2), 'utf8');
await writeFile(join(workspace, 'notes', 'summary.md'), '# File Ref\n\nWorkspace file refs are readable.', 'utf8');
await writeFile(join(workspace, '.sciforge', 'logs', 'session-tool-smoke.stdout.log'), 'stdout ok', 'utf8');
await writeFile(join(workspace, '.sciforge', 'logs', 'session-tool-smoke.stderr.log'), '', 'utf8');
await writeFile(join(workspace, '.sciforge', 'task-results', 'session-tool-smoke.json'), JSON.stringify({
  message: 'run completed',
  confidence: 0.9,
  claimType: 'evidence-summary',
  evidenceLevel: 'workspace-task',
  reasoningTrace: 'smoke run fixture',
  claims: [{ text: 'Execution unit fixture is present.' }],
  uiManifest: [{ componentId: 'execution-unit-table', artifactRef: 'execution-unit:eu-smoke' }],
  executionUnits: [{
    id: 'eu-smoke',
    tool: 'workspace-task.smoke',
    status: 'done',
    outputRef,
    stdoutRef,
    stderrRef,
  }],
  artifacts: [],
}, null, 2), 'utf8');
await writeFile(join(workspace, '.sciforge', 'task-attempts', `${runId}.json`), JSON.stringify({
  id: runId,
  prompt: 'Smoke backend artifact tools',
  skillDomain: 'literature',
  updatedAt: '2026-05-09T00:00:00.000Z',
  attempts: [{
    id: runId,
    prompt: 'Smoke backend artifact tools',
    skillDomain: 'literature',
    attempt: 1,
    status: 'done',
    codeRef: '.sciforge/tasks/session-tool-smoke.py',
    outputRef,
    stdoutRef,
    stderrRef,
    createdAt: '2026-05-09T00:00:00.000Z',
  }],
}, null, 2), 'utf8');

const list = await listSessionArtifacts({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
});

assert.equal(list.tool, 'list_session_artifacts');
assert.equal(list.artifacts.length, 2);
const listedReport = list.artifacts.find((artifact) => artifact.id === 'research-report');
assert.ok(listedReport);
assert.ok(list.objectReferences.some((reference) => reference.ref === 'artifact:research-report'));
assert.equal(list.objectReferences.find((reference) => reference.ref === 'artifact:research-report')?.preferredView, undefined);

const resolved = await resolveObjectReference({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'artifact:research-report',
});

assert.equal(resolved.tool, 'resolve_object_reference');
assert.equal(resolved.status, 'resolved');
assert.equal(resolved.refKind, 'artifact');
assert.equal(resolved.artifact?.type, 'research-report');

const read = await readArtifact({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'artifact:research-report',
});

assert.equal(read.tool, 'read_artifact');
assert.equal(read.status, 'read');
assert.equal(read.mimeType, 'text/markdown');
assert.match(read.text ?? '', /# Literature Report/);

const rendered = await renderArtifact({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'artifact:research-report',
  format: 'markdown',
});

assert.equal(rendered.tool, 'render_artifact');
assert.equal(rendered.status, 'rendered');
assert.match(rendered.rendered ?? '', /Backend tools can read stable artifact refs/);

const fileResolved = await resolveObjectReference({
  workspacePath: workspace,
  ref: 'file:notes/summary.md',
});

assert.equal(fileResolved.status, 'resolved');
assert.equal(fileResolved.refKind, 'file');
assert.equal(fileResolved.reference.kind, 'file');

const fileRead = await readArtifact({
  workspacePath: workspace,
  ref: 'file:notes/summary.md',
});

assert.equal(fileRead.status, 'read');
assert.equal(fileRead.mimeType, 'text/markdown');
assert.match(fileRead.text ?? '', /Workspace file refs are readable/);

const workspaceResolved = await resolveObjectReference({
  workspacePath: workspace,
  ref: 'workspace:notes/summary.md',
});

assert.equal(workspaceResolved.status, 'resolved');
assert.equal(workspaceResolved.refKind, 'workspace');
assert.equal(workspaceResolved.reference.kind, 'file');
assert.equal(workspaceResolved.reference.ref, 'workspace:notes/summary.md');

const workspaceUriRead = await readArtifact({
  workspacePath: workspace,
  ref: 'workspace://notes/summary.md',
});

assert.equal(workspaceUriRead.status, 'read');
assert.equal(workspaceUriRead.mimeType, 'text/markdown');
assert.match(workspaceUriRead.text ?? '', /Workspace file refs are readable/);

const runResolved = await resolveObjectReference({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: `run:${runId}`,
});

assert.equal(runResolved.status, 'resolved');
assert.equal(runResolved.refKind, 'run');
assert.equal(runResolved.reference.kind, 'run');
assert.equal(runResolved.reference.runId, runId);

const runRead = await readArtifact({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: `run:${runId}`,
});

assert.equal(runRead.status, 'read');
assert.equal(runRead.mimeType, 'application/json');
assert.match(runRead.text ?? '', /session-tool-smoke-run/);

const executionUnitResolved = await resolveObjectReference({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: `run:${runId}#execution-unit:eu-smoke`,
});

assert.equal(executionUnitResolved.status, 'resolved');
assert.equal(executionUnitResolved.refKind, 'execution-unit');
assert.equal(executionUnitResolved.reference.kind, 'execution-unit');
assert.equal(executionUnitResolved.reference.runId, runId);
assert.equal(executionUnitResolved.reference.executionUnitId, 'eu-smoke');

const executionUnitRendered = await renderArtifact({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: 'executionUnit:eu-smoke',
  format: 'json',
});

assert.equal(executionUnitRendered.status, 'rendered');
assert.match(executionUnitRendered.rendered ?? '', /workspace-task.smoke/);

const resumed = await resumeRun({
  workspacePath: workspace,
  skillDomain: 'literature',
  ref: `run:${runId}`,
  reason: 'smoke resume',
});

assert.equal(resumed.tool, 'resume_run');
assert.equal(resumed.status, 'resume-requested');
assert.equal(resumed.runRef, `run:${runId}`);
assert.ok(resumed.objectReferences.some((reference) => reference.kind === 'run' && reference.runId === runId));
assert.ok(resumed.objectReferences.some((reference) => reference.kind === 'file' && reference.ref === `file:${outputRef}`));

const materializedAgentServerResolved = await resolveObjectReference({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: `agentserver://${sessionId}/live-report.md`,
});

assert.equal(materializedAgentServerResolved.status, 'resolved');
assert.equal(materializedAgentServerResolved.refKind, 'agentserver');
assert.equal(materializedAgentServerResolved.reference.kind, 'artifact');
assert.equal(materializedAgentServerResolved.artifact?.id, 'agentserver-report');

const materializedAgentServerRead = await readArtifact({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: `agentserver://${sessionId}/live-report.md`,
});

assert.equal(materializedAgentServerRead.status, 'read');
assert.match(materializedAgentServerRead.text ?? '', /Materialized AgentServer Report/);

const transientAgentServerResolved = await resolveObjectReference({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'agentserver://unmaterialized/live-output',
});

assert.equal(transientAgentServerResolved.status, 'blocked');
assert.equal(transientAgentServerResolved.refKind, 'agentserver');
assert.equal(transientAgentServerResolved.reference.kind, 'url');

const transientAgentServerRead = await readArtifact({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'agentserver://unmaterialized/live-output',
});

assert.equal(transientAgentServerRead.status, 'blocked');
assert.match(transientAgentServerRead.reason ?? '', /transient backend URIs/);

const transientAgentServerRendered = await renderArtifact({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
  ref: 'agentserver://unmaterialized/live-output',
  format: 'markdown',
});

assert.equal(transientAgentServerRendered.status, 'blocked');

console.log('[ok] backend artifact tools resolve/read/render artifact, workspace, file, run, execution-unit, agentserver refs and resume_run contract');
