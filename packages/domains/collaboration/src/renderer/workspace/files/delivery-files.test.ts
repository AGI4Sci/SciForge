import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DeliveryManifest } from '@sciforge/collaboration-contracts'
import {
  deliveryFileGroups,
  deliveryManifestEntries
} from './delivery-files.js'

const projectId = 'prj_TestPreview0001'
const sealedAt = '2026-10-19T12:30:00.000Z'

function objectReference(overrides: Record<string, unknown> = {}) {
  return {
    objectId: 'obj_TestReadme0001',
    objectKey: `objects/${projectId}/obj_TestReadme0001`,
    revision: 1,
    sha256: 'a'.repeat(64),
    byteCount: 42,
    mediaType: 'text/markdown',
    projectId,
    visibility: 'project_public',
    ownerUserId: 'usr_TestWorker0001',
    retentionUntil: null,
    ...overrides
  }
}

function manifest(overrides: Partial<Record<string, unknown>> = {}): DeliveryManifest {
  return {
    deliveryManifestId: 'dmf_TestSealed0001',
    projectId,
    taskId: 'tsk_TestTask0001',
    executionId: 'exe_TestExecution0001',
    sealedAt,
    bundleObjectId: 'obj_TestBundle0001',
    outputObjectIds: ['obj_TestReadme0001'],
    outputs: [{ objectId: 'obj_TestReadme0001', fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) }],
    objects: [
      objectReference({ objectId: 'obj_TestBundle0001', mediaType: 'application/json', byteCount: 128 }),
      objectReference()
    ],
    ...overrides
  } as DeliveryManifest
}

const members = [{ userId: 'usr_TestWorker0001', displayName: '林默' }]

test('lists only the delivered file with the task name and submitter, never object storage paths', () => {
  const entries = deliveryManifestEntries(manifest(), {
    members,
    executions: [{ executionId: 'exe_TestExecution0001', assigneeUserId: 'usr_TestWorker0001' }]
  })
  assert.equal(entries.length, 1)
  const [entry] = entries
  assert.deepEqual(entries.map(({ name, mediaType, byteCount, submitter, submittedAt }) => ({ name, mediaType, byteCount, submitter, submittedAt })), [
    { name: 'README.md', mediaType: 'text/markdown', byteCount: 42, submitter: '林默', submittedAt: sealedAt }
  ])
  assert.deepEqual(entry?.descriptor, {
    projectId, deliveryManifestId: 'dmf_TestSealed0001', objectId: 'obj_TestReadme0001', sha256: 'a'.repeat(64), objectRevision: 1,
    name: 'README.md', mediaType: 'text/markdown', byteCount: 42, submitter: '林默', submittedAt: sealedAt
  })
  const rendered = JSON.stringify(entries)
  assert.doesNotMatch(rendered, /objects\/|objectKey|obj_TestBundle0001/u)
})

test('falls back to a delivered file label when the task declared no output name', () => {
  const entries = deliveryManifestEntries(manifest({ outputs: undefined, outputObjectIds: undefined }), { members })
  assert.deepEqual(entries.map(({ name }) => name), ['历史交付文件'])
  assert.ok(entries.every((entry) => entry.submitter === null && entry.submittedAt === sealedAt))
})

test('groups shared materials and sealed deliveries without exposing storage keys', () => {
  const groups = deliveryFileGroups({
    drive: {
      projectId,
      sharedMaterials: [objectReference({ objectId: 'obj_TestShared0001', mediaType: 'application/pdf', byteCount: 2048, revision: 3, ownerUserId: 'usr_TestOwner0001' })],
      taskDeliveries: [manifest()],
      projectResults: []
    } as never,
    project: {
      memberUsers: [{ userId: 'usr_TestOwner0001', displayName: '周岚' }, ...members],
      tasks: [{
        task: { taskId: 'tsk_TestTask0001', fileIntent: { output: { fileName: 'README.md' } } },
        executions: [{ executionId: 'exe_TestExecution0001', assigneeUserId: 'usr_TestWorker0001' }]
      }]
    } as never,
    dashboards: [{ projectId, tasks: [{ taskId: 'tsk_TestTask0001', assigneeDisplayName: '林默' }] as never }]
  })
  assert.deepEqual(groups.map((group) => [group.id, group.files.length]), [['shared', 1], ['delivery', 1], ['result', 0]])
  const shared = groups[0]!.files[0]!
  assert.deepEqual({ name: shared.name, submitter: shared.submitter, descriptor: shared.descriptor, revision: shared.revision }, {
    name: '共享资料', submitter: '周岚', descriptor: null, revision: 3
  })
  const delivered = groups[1]!.files[0]!
  assert.equal(delivered.name, 'README.md')
  assert.equal(delivered.descriptor?.deliveryManifestId, 'dmf_TestSealed0001')
  const rendered = groups.flatMap((group) => group.files.map(({ name, mediaType, byteCount, submitter, revision }) => ({ name, mediaType, byteCount, submitter, revision })))
  assert.doesNotMatch(JSON.stringify(rendered), /objects\/|objectKey|obj_TestShared0001|obj_TestReadme0001/u)
})

test('multi-file manifest owns names paths sources and order independently of current task and object order', () => {
  const first = { objectId: 'obj_SameContent0001', fileName: 'results.csv', relativePath: 'analysis/results.csv', role: 'member', source: 'member', mediaType: 'text/csv', byteCount: 42, sha256: 'a'.repeat(64) }
  const second = { ...first, objectId: 'obj_SameContent0002', relativePath: '.sciforge/uploads/session/import-results.csv', source: 'attachment' }
  const entries = deliveryManifestEntries(manifest({ outputs: [first, second], outputObjectIds: [first.objectId, second.objectId], objects: [objectReference(second), objectReference(first)] }), {
    members
  })
  assert.deepEqual(entries.map((file) => [file.name, file.relativePath, file.source, file.descriptor?.objectId]), [
    [first.fileName, first.relativePath, first.source, first.objectId], [second.fileName, second.relativePath, second.source, second.objectId]
  ])
  assert.notEqual(entries[0]?.key, entries[1]?.key)
  assert.doesNotMatch(JSON.stringify(entries), /changed-after-submission/u)
})
