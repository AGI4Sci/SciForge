import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  listSessionArtifacts,
  readArtifact,
  renderArtifact,
  resolveObjectReference,
} from '../../src/runtime/backend-artifact-tools';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-backend-artifact-tools-'));
const sessionId = 'session-tool-smoke';
await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
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
    outputRef: '.sciforge/task-results/session-tool-smoke.json',
  },
}, null, 2), 'utf8');

const list = await listSessionArtifacts({
  workspacePath: workspace,
  sessionId,
  skillDomain: 'literature',
});

assert.equal(list.tool, 'list_session_artifacts');
assert.equal(list.artifacts.length, 1);
assert.equal(list.artifacts[0].id, 'research-report');
assert.equal(list.objectReferences[0].ref, 'artifact:research-report');
assert.equal(list.objectReferences[0].preferredView, undefined);

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

console.log('[ok] backend artifact tools list, resolve, read, and render a markdown report artifact ref');
