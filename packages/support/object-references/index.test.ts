import assert from 'node:assert/strict';
import {
  artifactForObjectReference,
  artifactHasUserFacingDelivery,
  artifactPresentationRole,
  displayTitleForObjectReference,
  artifactReferenceKind,
  artifactTypeForPath,
  appendReferenceMarkerToInput,
  linkifyObjectReferences,
  mergeObjectReferences,
  normalizeResponseObjectReferences,
  normalizeWorkspacePath,
  objectReferenceChipModel,
  objectReferenceForArtifactSummary,
  objectReferenceForUploadedArtifact,
  objectReferencePresentationRole,
  objectReferencesFromInlineTokens,
  pathForObjectReference,
  referenceForArtifact,
  referenceForObjectReference,
  referenceForTextSelection,
  referenceForUploadedArtifact,
  referenceKindForWorkspaceFileLike,
  referenceKindForWorkspacePreviewKind,
  removeReferenceMarkerFromInput,
  referenceToPreviewTarget,
  resolveInlineObjectReferenceToken,
  syntheticArtifactForObjectReference,
  toWorkspaceRelativePath,
  withComposerMarker,
  workspaceActionIds,
  workspaceActionSuccessMessage,
  workspaceOnboardingErrorMessage,
  workspaceOnboardingReason,
  workspaceParentPath,
  workspacePathBasename,
  workspacePathNeedsOnboarding,
} from './index';
import type { RuntimeArtifact } from '@sciforge-ui/runtime-contract/artifacts';
import type { ObjectReference } from '@sciforge-ui/runtime-contract/references';
import type { ObjectReferenceSessionLike } from './index';

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

const artifactRef: ObjectReference = {
  id: 'obj-1',
  title: 'DE genes',
  kind: 'artifact',
  ref: 'artifact:artifact-1',
  artifactType: 'omics-table',
  status: 'available',
};

const session: ObjectReferenceSessionLike = { artifacts: [artifact] };
assert.equal(artifactForObjectReference(artifactRef, session)?.id, 'artifact-1');
assert.equal(pathForObjectReference(artifactRef, session), 'results/table.csv');
assert.equal(referenceToPreviewTarget(artifactRef, session).status, 'resolved');
assert.equal(artifactReferenceKind(artifact, 'data-table', 1), 'file');
assert.equal(normalizeWorkspacePath('/tmp/workspace///'), '/tmp/workspace');
assert.equal(workspacePathBasename('/tmp/workspace/'), 'workspace');
assert.equal(workspaceParentPath('/tmp/workspace/file.md'), '/tmp/workspace');
assert.equal(toWorkspaceRelativePath('/tmp/workspace', '/tmp/workspace/src/app.ts'), 'src/app.ts');
assert.equal(toWorkspaceRelativePath('/tmp/workspace', '/tmp/workspace'), '.');
assert.equal(workspacePathNeedsOnboarding('', '', ''), true);
assert.equal(workspacePathNeedsOnboarding('/tmp/project', 'ENOENT workspace-state.json', ''), true);
assert.match(workspaceOnboardingReason('/tmp/project/', '', ''), /\/tmp\/project\/\.sciforge/);
assert.match(workspaceOnboardingReason('/tmp/project', 'EACCES', ''), /权限不足/);
assert.match(workspaceOnboardingErrorMessage(new Error('Failed to fetch')), /Workspace Writer 未连接/);
assert.equal(workspaceActionIds.createFile, 'create-file');
assert.equal(workspaceActionIds.createFolder, 'create-folder');
assert.equal(workspaceActionSuccessMessage(workspaceActionIds.rename), '资源已重命名。');
assert.equal(referenceKindForWorkspacePreviewKind('pdf'), 'file-region');
assert.equal(referenceKindForWorkspacePreviewKind('image'), 'file-region');
assert.equal(referenceKindForWorkspacePreviewKind('markdown'), 'file');
assert.equal(referenceKindForWorkspaceFileLike({ path: 'figures/result.png', language: 'image' }), 'file');
assert.equal(referenceKindForWorkspaceFileLike({ path: 'papers/result.pdf', language: 'pdf' }), 'file-region');
assert.equal(referenceKindForWorkspaceFileLike({ path: 'notes/report.md', language: 'markdown' }), 'file');

const fileRef: ObjectReference = {
  id: 'file-1',
  title: 'Report',
  kind: 'file',
  ref: 'file:reports/final.md',
  status: 'available',
  provenance: { producer: 'workspace-writer' },
};
assert.equal(pathForObjectReference(fileRef, session), 'reports/final.md');
assert.equal(pathForObjectReference({ ...fileRef, ref: 'file::.sciforge/artifacts/pdfs/2604.28185v1.pdf' }, session), '.sciforge/artifacts/pdfs/2604.28185v1.pdf');
assert.equal(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')?.type, 'research-report');
assert.equal(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')?.delivery?.readableRef, 'reports/final.md');
assert.equal(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')?.delivery?.previewPolicy, 'inline');
assert.equal(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')?.delivery?.role, 'audit');
assert.equal(artifactHasUserFacingDelivery(syntheticArtifactForObjectReference(fileRef, 'literature-evidence-review')), false);
assert.equal(
  artifactHasUserFacingDelivery(syntheticArtifactForObjectReference({ ...fileRef, presentationRole: 'supporting-evidence' }, 'literature-evidence-review')),
  true,
);
assert.equal(syntheticArtifactForObjectReference({ ...fileRef, ref: 'file::reports/final.md' }, 'literature-evidence-review')?.delivery?.readableRef, 'reports/final.md');
assert.equal(artifactTypeForPath('assets/model.pdb', 'file'), 'structure-summary');

const uploaded = {
  ...artifact,
  id: 'upload-1',
  type: 'uploaded-pdf',
  path: '.sciforge/uploads/session/upload-1-paper.pdf',
  dataRef: '.sciforge/uploads/session/upload-1-paper.pdf',
  metadata: { title: 'paper.pdf', size: 1234 },
};
assert.equal(referenceForUploadedArtifact(uploaded).ref, uploaded.dataRef);
assert.equal(objectReferenceForUploadedArtifact(uploaded).preferredView, 'preview');

const reportArtifact: RuntimeArtifact = {
  id: 'research-report',
  type: 'research-report',
  producerScenario: 'literature-evidence-review',
  schemaVersion: '1',
  dataRef: '.sciforge/task-results/run-output.json',
  metadata: {
    title: 'Research report',
    markdownRef: '.sciforge/artifacts/run/research-report.md',
    outputRef: '.sciforge/task-results/run-output.json',
  },
};
const reportObject = objectReferenceForArtifactSummary(reportArtifact, 'run-2');
assert.equal(reportObject.preferredView, 'report-viewer');
assert.equal(reportObject.presentationRole, 'primary-deliverable');
assert.equal(reportObject.provenance?.path, '.sciforge/artifacts/run/research-report.md');
assert.equal(pathForObjectReference(reportObject, { artifacts: [reportArtifact] }), '.sciforge/artifacts/run/research-report.md');
assert.equal(referenceForArtifact(reportArtifact, 'file').ref, 'file:.sciforge/artifacts/run/research-report.md');
assert.equal(artifactReferenceKind(reportArtifact, 'report-viewer'), 'file');

const newerReportArtifact: RuntimeArtifact = {
  ...reportArtifact,
  id: 'research-report-newer',
  dataRef: '.sciforge/task-results/newer-output.json',
  metadata: {
    ...reportArtifact.metadata,
    markdownRef: '.sciforge/artifacts/newer/research-report.md',
    outputRef: '.sciforge/task-results/newer-output.json',
  },
};
assert.equal(
  artifactForObjectReference(reportObject, { artifacts: [newerReportArtifact, reportArtifact] })?.id,
  'research-report',
);
assert.equal(
  pathForObjectReference(reportObject, { artifacts: [newerReportArtifact, reportArtifact] }),
  '.sciforge/artifacts/run/research-report.md',
);

const normalizedResponseRefs = normalizeResponseObjectReferences({
  objectReferences: [{
    ref: 'artifact:research-report',
    kind: 'artifact',
    title: 'Backend report',
    actions: ['focus-right-pane'],
  }],
  artifacts: [reportArtifact],
  runId: 'run-response',
  relatedRefs: ['execution-unit:EU-report', 'artifact:missing-report'],
});
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'artifact:research-report')?.title, 'Backend report');
assert.deepEqual(normalizedResponseRefs.find((reference) => reference.ref === 'artifact:research-report')?.actions, ['focus-right-pane', 'inspect', 'pin', 'compare']);
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'artifact:research-report')?.provenance?.dataRef, '.sciforge/task-results/run-output.json');
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'artifact:research-report')?.presentationRole, 'primary-deliverable');
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'execution-unit:EU-report')?.kind, 'execution-unit');
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'execution-unit:EU-report')?.presentationRole, 'audit');
assert.equal(normalizedResponseRefs.find((reference) => reference.ref === 'artifact:missing-report')?.status, 'missing');

const converted = referenceForObjectReference({ ...artifactRef, artifactType: 'volcano-plot' });
assert.equal(converted.kind, 'chart');

const source = referenceForObjectReference(fileRef);
const selection = referenceForTextSelection({ sourceReference: source, selectedText: 'TP53 is significant' });
assert.equal(selection?.kind, 'ui');
assert.ok(selection?.ref.startsWith('ui-text:file:reports/final.md#'));
assert.equal(referenceForTextSelection({ sourceReference: source, selectedText: '  ' }), undefined);

const visionTrace: RuntimeArtifact = {
  id: 'vision-run-1',
  type: 'vision-trace',
  producerScenario: 'biomedical-knowledge-graph',
  schemaVersion: '1',
  path: '.sciforge/vision-runs/run-1/trace.json',
  dataRef: '.sciforge/vision-runs/run-1/trace.json',
  metadata: { source: 'local.vision-sense', finalScreenshotRef: '.sciforge/vision-runs/run-1/final.png' },
  data: { task: 'Click a search suggestion', finalScreenshotRef: '.sciforge/vision-runs/run-1/final.png' },
};
const visionObject = objectReferenceForArtifactSummary(visionTrace, 'run-1');
assert.equal(visionObject.title, 'Click a search suggestion');
assert.equal(visionObject.provenance?.screenshotRef, '.sciforge/vision-runs/run-1/final.png');
assert.match(visionObject.summary ?? '', /final screenshot/);

const marked = withComposerMarker(source, []);
assert.equal((marked.payload as { composerMarker: string }).composerMarker, '※1');
const markerRefs: ReturnType<typeof withComposerMarker>[] = [];
for (let index = 0; index < 9; index += 1) {
  markerRefs.push(withComposerMarker({ ...source, id: `ref-${index}`, ref: `file:${index}.md` }, markerRefs));
}
const tenMarked = withComposerMarker({ ...source, id: 'ref-ten', ref: 'file:ten.md' }, markerRefs);
assert.equal((tenMarked.payload as { composerMarker: string }).composerMarker, '※10');
assert.equal(appendReferenceMarkerToInput('比较 ※10', marked), '比较 ※10 ※1');
assert.equal(removeReferenceMarkerFromInput('比较 ※10 ※1', marked), '比较 ※10');

const model = objectReferenceChipModel([
  { id: 'pending', title: 'Agent tmp', kind: 'file', ref: 'agentserver://tmp' },
  artifactRef,
  { id: 'url', title: 'Link', kind: 'url', ref: 'url:https://example.org' },
], false, 2);
assert.deepEqual(model.visible.map((item) => item.id), ['obj-1', 'url']);
assert.equal(model.hiddenCount, 1);

const inlineRefs = objectReferencesFromInlineTokens(
  '查看 artifact:artifact-1、file::reports/final.md 和 https://example.org/paper?id=1。',
  'run-inline',
);
assert.deepEqual(inlineRefs.map((reference) => reference.kind), ['artifact', 'file', 'url']);
assert.equal(inlineRefs[0].runId, 'run-inline');
assert.deepEqual(inlineRefs[1].actions, ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin']);
assert.equal(inlineRefs[1].provenance?.path, 'reports/final.md');
assert.equal(inlineRefs[2].status, 'external');

assert.equal(resolveInlineObjectReferenceToken('artifact:artifact-1', [artifactRef])?.ref, 'artifact:artifact-1');
assert.equal(resolveInlineObjectReferenceToken('reports/final.md', [fileRef])?.ref, 'file:reports/final.md');
assert.equal(resolveInlineObjectReferenceToken('final.md', [fileRef])?.ref, 'file:reports/final.md');
assert.equal(resolveInlineObjectReferenceToken('duplicate.md', [
  { ...fileRef, id: 'file-a', ref: 'file:alpha/duplicate.md', provenance: { path: 'alpha/duplicate.md' } },
  { ...fileRef, id: 'file-b', ref: 'file:beta/duplicate.md', provenance: { path: 'beta/duplicate.md' } },
]), undefined);
assert.equal(resolveInlineObjectReferenceToken('not-a-real-output.md', [fileRef]), undefined);

const linked = linkifyObjectReferences(
  '打开 file:reports/final.md 或 artifact-1。',
  [fileRef, artifactRef],
);
assert.deepEqual(
  linked.filter((piece) => piece.reference).map((piece) => piece.reference?.ref),
  ['file:reports/final.md', 'artifact:artifact-1'],
);
assert.deepEqual(
  linked.filter((piece) => piece.reference).map((piece) => piece.text),
  ['Report', 'DE genes'],
);
const dedupedReferences = mergeObjectReferences(
  [{ ...fileRef, id: 'file-report', title: 'report.md', ref: 'file:reports/final.md', provenance: { path: 'reports/final.md' } }],
  [{ ...artifactRef, id: 'artifact-report', title: 'Report artifact', ref: 'artifact:report', provenance: { dataRef: 'reports/final.md' } }],
);
assert.equal(dedupedReferences.length, 1);
assert.equal(dedupedReferences[0].kind, 'artifact');
assert.equal(displayTitleForObjectReference({ ...artifactRef, title: 'artifact::.sciforge/task-results/generated.json' }), 'artifact-1');
assert.equal(objectReferencePresentationRole({ ...artifactRef, ref: 'artifact:runtime-context-summary', title: 'runtime-context-summary.json' }), 'audit');
assert.equal(artifactPresentationRole({
  ...reportArtifact,
  id: 'runtime-context-summary',
  type: 'runtime-context-summary',
  dataRef: '.sciforge/runtime-context-summary.json',
  metadata: { title: 'runtime-context-summary.json' },
}), 'audit');

console.log('[ok] object reference package normalizes artifacts, files, selections, uploads, chips, and inline text refs');
