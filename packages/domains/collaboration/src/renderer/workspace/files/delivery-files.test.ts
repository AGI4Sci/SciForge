import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DeliveryManifest } from '@sciforge/collaboration-contracts'
import {
  deliveryFileGroups,
  deliveryManifestEntries
} from './delivery-files.js'

const projectId = 'prj_TestPreview0001'
const sealedAt = '2026-10-19T12:30:00.000Z'
const adoptedAt = '2026-10-19T13:30:00.000Z'

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
    manifestDigest: 'b'.repeat(64),
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

function adoptedView(sealed = manifest()) {
  return {
    task: { projectId, taskId: sealed.taskId, status: 'completed', currentExecutionId: sealed.executionId, currentExecutionState: 'completed' },
    executions: [{ projectId, taskId: sealed.taskId, executionId: sealed.executionId, assigneeUserId: 'usr_TestWorker0001', state: 'completed' }],
    delivery: {
      taskId: sealed.taskId, manifest: sealed, candidate: null, revisionRequest: null, result: null,
      receipt: { integrationReceiptId: `irc_${sealed.deliveryManifestId}`, projectId, taskId: sealed.taskId,
        deliveryManifestId: sealed.deliveryManifestId, disposition: 'adopted', createdAt: adoptedAt }
    }
  }
}

function resultFiles(sealed: readonly DeliveryManifest[], views = sealed.map((entry) => adoptedView(entry)), projectResults: readonly unknown[] = []) {
  return deliveryFileGroups({
    drive: { projectId, sharedMaterials: [], taskDeliveries: sealed, projectResults } as never,
    project: { project: { projectId, status: 'completed' }, memberUsers: members, tasks: views } as never,
    dashboards: []
  }).find((group) => group.id === 'result')!.files
}

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
      project: { projectId },
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

test('completed projects show every formally adopted delivery before any project version is published', () => {
  const sealed = [1, 2, 3, 4].map((index) => manifest({
    deliveryManifestId: `dmf_Adopted000${index}`, taskId: `tsk_Adopted000${index}`, executionId: `exe_Adopted000${index}`
  }))
  const results = resultFiles(sealed)
  assert.equal(results.length, 4)
  assert.deepEqual(results.map((file) => file.descriptor?.deliveryManifestId), sealed.map((entry) => entry.deliveryManifestId))
  assert.ok(results.every((file) => file.name === 'README.md' && file.submitter === '林默'))
  assert.ok(results.every((file) => file.projectVersion === undefined && file.adoptedAt === adoptedAt))
  assert.ok(results.every((file) => file.descriptor?.sha256 === 'a'.repeat(64)))
})

test('published versions enrich the exact adopted receipt without duplicating files or inventing versions', () => {
  const adopted = manifest()
  const superseded = manifest({ deliveryManifestId: 'dmf_Previous0001' })
  const view = adoptedView(adopted)
  const published = { projectId, projectResultId: 'res_Adopted0001', deliveryManifestId: adopted.deliveryManifestId,
    integrationReceiptId: view.delivery.receipt.integrationReceiptId, projectVersion: 4, adoptedAt, disposition: 'adopted' }
  const pending = resultFiles([adopted], [view])[0]!
  const results = resultFiles([adopted, superseded, adopted], [view, view], [published, published,
    { ...published, projectResultId: 'res_Previous001', deliveryManifestId: superseded.deliveryManifestId, projectVersion: 3, disposition: 'superseded' },
    { ...published, projectResultId: 'res_Missing0001', deliveryManifestId: 'dmf_NotReadable01', projectVersion: 5 }
  ])
  assert.equal(results.length, 1)
  assert.equal(results[0]!.projectVersion, 4)
  assert.equal(results[0]!.key, pending.key, 'publishing a version preserves the identity of the adopted file')
  assert.equal(results[0]!.descriptor!.deliveryManifestId, adopted.deliveryManifestId)
  assert.equal(results[0]!.adoptedAt, adoptedAt)
  const canonicalPublication = { ...view, delivery: { ...view.delivery, result: published } } as never
  assert.equal(resultFiles([adopted], [canonicalPublication])[0]!.projectVersion, 4, 'canonical published facts also carry the real version')
})

test('sealed, non-adopted and inactive Task deliveries never become project results', () => {
  for (const disposition of ['unadopted', 'superseded', 'rejected', 'unknown']) {
    const view = adoptedView()
    view.delivery.receipt.disposition = disposition
    assert.deepEqual(resultFiles([manifest()], [view]), [], disposition)
  }
  for (const status of ['planned', 'awaiting_review', 'in_progress', 'cancelled', 'failed']) {
    const view = adoptedView()
    view.task.status = status
    assert.deepEqual(resultFiles([manifest()], [view]), [], status)
  }
  assert.deepEqual(resultFiles([manifest()], []), [], 'a sealed delivery alone proves no adoption')
  assert.deepEqual(resultFiles([manifest()], [{ ...adoptedView(), delivery: null } as never]), [], 'a completed Task without a receipt proves no adoption')
  for (const state of ['result_submitted', 'running', 'cancelled', 'superseded']) {
    const view = adoptedView()
    view.executions[0]!.state = state
    assert.deepEqual(resultFiles([manifest()], [view]), [], state)
  }
})

test('adoption must bind the exact current manifest, project, Task and execution', () => {
  const changes: readonly Readonly<{ name: string; change: (view: ReturnType<typeof adoptedView>) => void }>[] = [
    { name: 'receipt manifest', change: (view) => { view.delivery.receipt.deliveryManifestId = 'dmf_Other0001' } },
    { name: 'receipt Task', change: (view) => { view.delivery.receipt.taskId = 'tsk_Other0001' } },
    { name: 'receipt project', change: (view) => { view.delivery.receipt.projectId = 'prj_Other0001' } },
    { name: 'delivery Task', change: (view) => { view.delivery.taskId = 'tsk_Other0001' } },
    { name: 'current execution', change: (view) => { view.task.currentExecutionId = 'exe_Other0001' } },
    { name: 'execution Task', change: (view) => { view.executions[0]!.taskId = 'tsk_Other0001' } },
    { name: 'execution project', change: (view) => { view.executions[0]!.projectId = 'prj_Other0001' } },
    { name: 'execution state', change: (view) => { view.task.currentExecutionState = 'result_submitted' } },
    { name: 'canonical manifest', change: (view) => { view.delivery.manifest = manifest({ deliveryManifestId: 'dmf_Other0001' }) } },
    { name: 'canonical manifest execution', change: (view) => { view.delivery.manifest = manifest({ executionId: 'exe_Other0001' }) } },
    { name: 'canonical manifest digest', change: (view) => { view.delivery.manifest = manifest({ manifestDigest: 'c'.repeat(64) }) } }
  ]
  for (const { name, change } of changes) {
    const sealed = manifest()
    const view = adoptedView(sealed)
    change(view)
    assert.deepEqual(resultFiles([sealed], [view]), [], name)
  }
})

test('publication metadata cannot grant adoption or decorate another receipt or manifest', () => {
  const sealed = manifest()
  const view = adoptedView(sealed)
  const published = { projectId, projectResultId: 'res_Adopted0001', deliveryManifestId: sealed.deliveryManifestId,
    integrationReceiptId: view.delivery.receipt.integrationReceiptId, projectVersion: 4, adoptedAt, disposition: 'adopted' }
  for (const overrides of [
    { integrationReceiptId: 'irc_Other0001' }, { deliveryManifestId: 'dmf_Other0001' },
    { projectId: 'prj_Other0001' }, { disposition: 'superseded' }, { disposition: 'unadopted' }
  ]) {
    const results = resultFiles([sealed], [view], [{ ...published, ...overrides }])
    assert.equal(results.length, 1)
    assert.equal(results[0]!.projectVersion, undefined)
  }
  view.delivery.receipt.disposition = 'superseded'
  assert.deepEqual(resultFiles([sealed], [view], [published]), [])
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
