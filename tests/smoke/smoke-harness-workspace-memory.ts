import assert from 'node:assert/strict';

import type { WorkspaceMemoryEntry } from '../../packages/agent-harness/src/contracts';
import {
  assessWorkspaceMemoryStaleness,
  buildWorkspaceMemoryIndex,
  selectWorkspaceMemoryReuse,
} from '../../packages/agent-harness/src/workspace-memory';

const now = '2026-05-11T00:00:00.000Z';
const entries: WorkspaceMemoryEntry[] = [
  memoryEntry({
    id: 'artifact-report',
    kind: 'artifact-ref',
    ref: 'artifact:report-1',
    sourceRunId: 'run-1',
    confidence: 0.94,
    contentHash: 'artifact-hash-v1',
  }),
  memoryEntry({
    id: 'downloaded-paper',
    kind: 'downloaded-ref',
    ref: 'download:paper-a.pdf',
    sourceRunId: 'run-1',
    confidence: 0.91,
    contentHash: 'pdf-hash-v1',
  }),
  memoryEntry({
    id: 'known-provider-failure',
    kind: 'known-failure',
    ref: 'failure:provider-timeout',
    sourceRunId: 'run-1',
    confidence: 0.86,
  }),
  memoryEntry({
    id: 'expired-claim',
    kind: 'verified-claim',
    ref: 'claim:screening-effect-size',
    sourceRunId: 'run-1',
    confidence: 0.82,
    expiresAt: '2026-05-10T00:00:00.000Z',
  }),
  memoryEntry({
    id: 'opened-methods',
    kind: 'opened-file',
    ref: 'file:methods.md',
    sourceRunId: 'run-2',
    confidence: 0.88,
    fileRef: 'file:methods.md',
    contentHash: 'methods-hash-v1',
  }),
  memoryEntry({
    id: 'capability-literature',
    kind: 'capability-outcome',
    ref: 'capability-outcome:literature.retrieval',
    sourceRunId: 'run-3',
    confidence: 0.9,
    capabilityId: 'literature.retrieval',
    capabilityVersion: '1.0.0',
  }),
  memoryEntry({
    id: 'recent-run-rerun',
    kind: 'recent-run',
    ref: 'run:run-4',
    sourceRunId: 'run-4',
    confidence: 0.77,
  }),
];

const index = buildWorkspaceMemoryIndex({
  workspaceId: 'workspace:smoke-h013',
  generatedAt: now,
  entries,
});

assert.equal(index.schemaVersion, 'sciforge.workspace-memory-index.v1');
assert.deepEqual(index.artifactRefs, ['artifact:report-1']);
assert.deepEqual(index.recentRuns, ['run:run-4']);
assert.deepEqual(index.knownFailures, ['failure:provider-timeout']);
assert.deepEqual(index.downloadedRefs, ['download:paper-a.pdf']);
assert.deepEqual(index.verifiedClaims, ['claim:screening-effect-size']);
assert.deepEqual(index.openedFiles, ['file:methods.md']);
assert.deepEqual(index.capabilityOutcomes, ['capability-outcome:literature.retrieval']);

const openedMethods = index.entries.find((entry) => entry.id === 'opened-methods');
assert.ok(openedMethods);
const fileAssessment = assessWorkspaceMemoryStaleness(openedMethods, [
  { fileRef: 'file:methods.md', contentHash: 'methods-hash-v2' },
], { now });
assert.equal(fileAssessment.refreshRequired, true);
assert.deepEqual(fileAssessment.staleReasons, ['file-changed']);

const decision = selectWorkspaceMemoryReuse({
  index,
  requestId: 'h013-smoke',
  requestedRefs: [
    'artifact:report-1',
    'download:paper-a.pdf',
    'failure:provider-timeout',
    'claim:screening-effect-size',
    'file:methods.md',
    'capability-outcome:literature.retrieval',
    'run:run-4',
  ],
  plannedSteps: [
    { stepId: 'read-report-again', ref: 'artifact:report-1', description: 'artifact read' },
    { stepId: 'download-paper-again', ref: 'download:paper-a.pdf', description: 'paper download' },
    { stepId: 'verify-claim-again', ref: 'claim:screening-effect-size', description: 'claim verification' },
    { stepId: 'open-methods-again', ref: 'file:methods.md', description: 'file read' },
  ],
  staleSignals: [
    { fileRef: 'file:methods.md', contentHash: 'methods-hash-v2' },
    { capabilityId: 'literature.retrieval', capabilityVersion: '1.1.0' },
    { ref: 'run:run-4', userRequestedRerun: true },
  ],
  now,
});

assert.equal(decision.schemaVersion, 'sciforge.workspace-memory-reuse-decision.v1');
assert.deepEqual(decision.reusedEntries.map((entry) => entry.id), [
  'artifact-report',
  'downloaded-paper',
  'known-provider-failure',
]);
assert.deepEqual(decision.skippedDuplicateSteps.map((step) => step.stepId), [
  'read-report-again',
  'download-paper-again',
]);
assert.deepEqual(
  decision.staleEntries.map((entry) => [entry.entryId, entry.validity, entry.staleReasons]),
  [
    ['capability-literature', 'stale', ['capability-version-changed']],
    ['expired-claim', 'expired', ['expired']],
    ['opened-methods', 'stale', ['file-changed']],
    ['recent-run-rerun', 'stale', ['user-requested-rerun']],
  ],
);
assert.equal(decision.actions.find((action) => action.entryId === 'recent-run-rerun')?.action, 'rerun');
assert.equal(decision.auditNote.severity, 'warning');
assert.match(decision.auditNote.message, /reused 3 refs, skipped 2 duplicate steps, flagged 4 stale entries/);

console.log('[ok] harness workspace memory reuse index detects reusable refs, duplicate skips, stale entries, and audit notes');

function memoryEntry(input: {
  id: string;
  kind: WorkspaceMemoryEntry['kind'];
  ref: string;
  sourceRunId: string;
  confidence: number;
  expiresAt?: string;
  fileRef?: string;
  contentHash?: string;
  capabilityId?: string;
  capabilityVersion?: string;
}): WorkspaceMemoryEntry {
  return {
    id: input.id,
    kind: input.kind,
    ref: input.ref,
    title: input.id,
    summary: `Indexed ${input.kind}`,
    sourceRunId: input.sourceRunId,
    provenance: {
      source: 'runtime',
      sourceRef: `runtime://${input.sourceRunId}/${input.id}`,
      sourceRunId: input.sourceRunId,
      producedAt: '2026-05-10T00:00:00.000Z',
      fileRef: input.fileRef,
      contentHash: input.contentHash,
      capabilityId: input.capabilityId,
      capabilityVersion: input.capabilityVersion,
    },
    validity: 'valid',
    confidence: input.confidence,
    expiresAt: input.expiresAt ?? '2026-06-11T00:00:00.000Z',
    evidenceRefs: [`evidence:${input.id}`],
  };
}
