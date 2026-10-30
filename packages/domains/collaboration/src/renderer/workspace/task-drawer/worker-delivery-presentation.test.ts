import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkerDeliveryDraft, WorkerDeliveryView } from '../../../worker-delivery.js'
import type { TaskCardModel } from '../workspace-types.js'
import { workerDeliveryPresentation } from './worker-delivery-presentation.js'

const at = '2026-10-21T02:00:00.000Z'
const card: TaskCardModel = {
  id: 'tsk_Presentation0001', projectId: 'prj_Presentation0001', executionId: 'exe_Presentation0001',
  reference: '#1', moduleType: '任务', title: '检查任务产出', assignee: '执行成员', date: '10-21', status: 'in-progress'
}

function draft(overrides: Partial<WorkerDeliveryDraft> = {}): WorkerDeliveryDraft {
  return {
    selectedMaterials: [], materialError: null, revision: 2, resultRevision: 2, basedOnResultRevision: 1,
    summary: '第二版成员正在编辑的说明', aiSummary: null, summaryEdited: false,
    sourceTurnId: null, sourceRound: 0, sourceUpdatedAt: null, updatedAt: at, changed: false,
    outputs: [{ fileName: 'revision-two.md', relativePath: 'revision-two.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 80, sha256: 'b'.repeat(64) }],
    ...overrides
  }
}

function delivery(overrides: Partial<WorkerDeliveryView> = {}): WorkerDeliveryView {
  return {
    projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, state: 'executing', draft: draft(),
    history: [], confirmationTarget: null, operationId: null, deliveryManifestId: null, error: null, residuals: [],
    candidate: {
      target: { projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, contractRevision: 1, resultRevision: 1, bundleDigest: 'a'.repeat(64), decision: 'approved' },
      bundle: { schemaVersion: 2, projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, contractRevision: 1, resultRevision: 1,
        summary: '第一版已封存说明', outputs: [{ fileName: 'revision-one.md', relativePath: 'revision-one.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) }] },
      sourceTurnId: 'turn_Presentation0001', frozenAt: at, dirty: true
    },
    ...overrides
  }
}

test('revision draft uses its own result revision and summary despite a retained prior frozen candidate', () => {
  const result = workerDeliveryPresentation(delivery(), card, [])
  assert.equal(result.revision, 2)
  assert.equal(result.summary, '第二版成员正在编辑的说明')
  assert.deepEqual(result.declaredFiles.map((file) => file.name), ['revision-two.md'])
})

test('sealed snapshot reads only frozen summary and files when a different local draft remains', () => {
  const result = workerDeliveryPresentation(delivery({ state: 'sealed', deliveryManifestId: 'mft_Presentation0001' }), card, [])
  assert.equal(result.revision, 1)
  assert.equal(result.state, 'submitted')
  assert.equal(result.summary, '第一版已封存说明')
  assert.deepEqual(result.declaredFiles.map((file) => file.name), ['revision-one.md'])
})

test('first generation and later AI modification project distinct editing permissions', () => {
  const first = draft({ resultRevision: 1, basedOnResultRevision: null, summary: '', outputs: [] })
  assert.equal(workerDeliveryPresentation(delivery({ draft: first, candidate: null }), card, []).state, 'generating')
  for (const changed of [
    { sourceTurnId: 'turn_Presentation0002', sourceRound: 2, sourceUpdatedAt: at },
    { summary: '成员开始填写结果', summaryEdited: true }
  ]) {
    assert.equal(workerDeliveryPresentation(delivery({ draft: { ...first, ...changed }, candidate: null }), card, []).state, 'modifying')
  }
})

test('revision preparation remains editable while AI modifies the prefilled preceding version', () => {
  const result = workerDeliveryPresentation(delivery(), card, [])
  assert.equal(result.state, 'modifying')
  assert.equal(result.summary, '第二版成员正在编辑的说明')
})

test('sealed multi-file snapshot groups exact descriptor roles and preserves distinct same-name material paths', () => {
  const current = delivery({ state: 'sealed' })
  current.candidate!.bundle = { ...current.candidate!.bundle, schemaVersion: 2, outputs: [
    { fileName: 'README.md', relativePath: 'README.md', role: 'declared', source: 'ai', mediaType: 'text/markdown', byteCount: 42, sha256: 'a'.repeat(64) },
    { fileName: 'results.csv', relativePath: 'analysis/results.csv', role: 'member', source: 'member', mediaType: 'text/csv', byteCount: 100, sha256: 'b'.repeat(64) },
    { fileName: 'results.csv', relativePath: '.sciforge/uploads/session/results.csv', role: 'member', source: 'attachment', mediaType: 'text/csv', byteCount: 100, sha256: 'b'.repeat(64) }
  ] }
  const snapshot = workerDeliveryPresentation(current, card, [])
  assert.deepEqual(snapshot.declaredFiles.map((file) => [file.name, file.source]), [['README.md', 'ai']])
  assert.deepEqual(snapshot.additionalFiles?.map((file) => [file.name, file.relativePath, file.source]), [
    ['results.csv', 'analysis/results.csv', 'member'], ['results.csv', '.sciforge/uploads/session/results.csv', 'attachment']
  ])
  assert.notEqual(snapshot.additionalFiles?.[0]?.id, snapshot.additionalFiles?.[1]?.id)
})

for (const [code, reason] of [
  ['runtime_interrupted', '本轮执行已中断，可重新执行或编辑草稿后提交。'],
  ['runtime_cancelled', '本轮执行已取消。'],
  ['model_capacity', '模型服务当前繁忙，请稍后重新执行。'],
  ['runtime_failed', '本轮执行失败，可重新执行或退回任务。']
]) {
  test(`${code} overrides executing delivery state and unlocks the retained draft`, () => {
    const result = workerDeliveryPresentation(delivery(), { ...card, executionFailure: { code, reexecutionInputId: 'ended-input' } }, [])
    assert.equal(result.state, 'failed')
    assert.equal(result.failureReason, reason)
    assert.equal(result.editLocked, false)
    assert.equal(result.summary, draft().summary)
    assert.deepEqual(result.declaredFiles.map((file) => file.name), ['revision-two.md'])
  })
}

test('normal completion is a ready draft without a failure reason', () => {
  const result = workerDeliveryPresentation(delivery({ state: 'waiting_confirmation' }), card, [])
  assert.equal(result.state, 'ready')
  assert.equal(result.failureReason, undefined)
  assert.equal(result.editLocked, false)
})
