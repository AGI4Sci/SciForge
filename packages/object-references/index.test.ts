import assert from 'node:assert/strict';
import {
  artifactForObjectReference,
  artifactReferenceKind,
  artifactTypeForPath,
  objectReferenceChipModel,
  objectReferenceForUploadedArtifact,
  pathForObjectReference,
  referenceForObjectReference,
  referenceForTextSelection,
  referenceForUploadedArtifact,
  referenceToPreviewTarget,
  syntheticArtifactForObjectReference,
  withComposerMarker,
} from './index';
import type { BioAgentSession, ObjectReference, RuntimeArtifact } from '../../src/ui/src/domain';

const artifact: RuntimeArtifact = {
  id: 'artifact-1',
  type: 'omics-table',
  producerScenario: 'omics-differential-exploration',
  schemaVersion: '1',
  path: 'results/table.csv',
  dataRef: 'results/table.csv',
  metadata: { title: 'DE genes', size: 42, runId: 'run-1' },
  data: { rows: [{ gene: 'TP53' }] },
};

const session = { artifacts: [artifact] } as BioAgentSession;
const artifactRef: ObjectReference = {
  id: 'obj-1',
  title: 'DE genes',
  kind: 'artifact',
  ref: 'artifact:artifact-1',
  artifactType: 'omics-table',
  status: 'available',
};

assert.equal(artifactForObjectReference(artifactRef, session)?.id, 'artifact-1');
assert.equal(pathForObjectReference(artifactRef, session), 'results/table.csv');
assert.equal(referenceToPreviewTarget(artifactRef, session).status, 'resolved');
assert.equal(artifactReferenceKind(artifact, 'data-table', 1), 'file');

const fileRef: ObjectReference = {
  id: 'file-1',
  title: 'Report',
  kind: 'file',
  ref: 'file:reports/final.md',
  status: 'available',
  provenance: { producer: 'workspace-writer' },
};
assert.equal(pathForObjectReference(fileRef, session), 'reports/final.md');
assert.equal(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')?.type, 'research-report');
assert.equal(artifactTypeForPath('assets/model.pdb', 'file'), 'structure-summary');

const uploaded = {
  ...artifact,
  id: 'upload-1',
  type: 'uploaded-pdf',
  path: '.bioagent/uploads/session/upload-1-paper.pdf',
  dataRef: '.bioagent/uploads/session/upload-1-paper.pdf',
  metadata: { title: 'paper.pdf', size: 1234 },
};
assert.equal(referenceForUploadedArtifact(uploaded).ref, uploaded.dataRef);
assert.equal(objectReferenceForUploadedArtifact(uploaded).preferredView, 'preview');

const converted = referenceForObjectReference({ ...artifactRef, artifactType: 'volcano-plot' });
assert.equal(converted.kind, 'chart');

const source = referenceForObjectReference(fileRef);
const selection = referenceForTextSelection({ sourceReference: source, selectedText: 'TP53 is significant' });
assert.equal(selection?.kind, 'ui');
assert.ok(selection?.ref.startsWith('ui-text:file:reports/final.md#'));
assert.equal(referenceForTextSelection({ sourceReference: source, selectedText: '  ' }), undefined);

const marked = withComposerMarker(source, []);
assert.equal((marked.payload as { composerMarker: string }).composerMarker, '※1');

const model = objectReferenceChipModel([
  { id: 'pending', title: 'Agent tmp', kind: 'file', ref: 'agentserver://tmp' },
  artifactRef,
  { id: 'url', title: 'Link', kind: 'url', ref: 'url:https://example.org' },
], false, 2);
assert.deepEqual(model.visible.map((item) => item.id), ['obj-1', 'url']);
assert.equal(model.hiddenCount, 1);

console.log('[ok] object reference package normalizes artifacts, files, selections, uploads, and chip ordering');
