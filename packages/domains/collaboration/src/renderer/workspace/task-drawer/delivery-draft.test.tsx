import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskDrawer } from './TaskDrawer.js'
import { DeliveryDraft } from './DeliveryDraft.js'
import type { DeliveryDraftData, DeliveryDraftFile } from './delivery-draft-types.js'
import type { TaskCardModel } from '../workspace-types.js'
import type { WorkerDeliveryView } from '../../../worker-delivery.js'

const card: TaskCardModel = { id: 'tsk_delivery000001', projectId: 'prj_delivery000001', executionId: 'exe_delivery000001', reference: '#1', moduleType: '任务', title: '公开单细胞数据集简介', assignee: '执行成员', assigneeUserId: 'usr_worker000001', date: '10-21', status: 'in-progress', stateLabel: '待提交交付', canReturnExecution: true }
const output: DeliveryDraftFile = { id: 'output', name: 'README.md', relativePath: 'README.md', mediaType: 'text/markdown', byteCount: 1738, source: 'ai' }
const addition: DeliveryDraftFile = { id: 'input', name: 'cells.csv', relativePath: 'data/cells.csv', mediaType: 'text/csv', byteCount: 4200, source: 'attachment' }
const data: DeliveryDraftData = { revision: 1, summary: 'README 已生成并检查。', state: 'ready', declaredFiles: [output], additionalFiles: [addition], source: { round: 3, finishedAt: '2026-10-21T02:20:00.000Z' } }
const delivery: WorkerDeliveryView = { projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, state: 'waiting_confirmation', draft: null, history: [], confirmationTarget: null, operationId: null, deliveryManifestId: null, error: null, residuals: [], candidate: { target: { projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, contractRevision: 1, resultRevision: 1, bundleDigest: 'a'.repeat(64), decision: 'approved' }, bundle: { schemaVersion: 2, projectId: card.projectId!, taskId: card.id, executionId: card.executionId!, contractRevision: 1, resultRevision: 1, summary: data.summary, outputs: [{ fileName: output.name, relativePath: output.name, role: 'declared', source: 'ai', mediaType: output.mediaType, byteCount: output.byteCount, sha256: 'b'.repeat(64) }] }, sourceTurnId: 'turn_delivery000001', frozenAt: '2026-10-21T02:00:00.000Z', dirty: false } }
const noOp = () => undefined
function render(next = data): string { return renderToStaticMarkup(<DeliveryDraft data={next} materialSelection={{ files: [output, addition] }} onContinue={noOp} onReexecute={noOp} onPreview={noOp} onSubmit={noOp} />) }
function drawer(user = 'usr_worker000001', detail: DeliveryDraftData | undefined = data): string { return renderToStaticMarkup(<TaskDrawer card={card} projectName="数据质控说明" currentUserId={user} members={[{ userId: 'usr_owner000001', name: '负责人', role: '所有者' }]} delivery={user === card.assigneeUserId ? delivery : null} deliveryDetail={detail} onSubmitDelivery={noOp} onAdopt={noOp} onRequestRevision={noOp} onContinueSession={noOp} onPreviewDraftFile={noOp} onReturnTask={async () => true} />) }

test('draft groups required AI output and additional materials and keeps AI revision available', () => {
 const html = render()
 assert.match(html, /交付草稿.*第 1 版草稿/su)
 assert.match(html, /来自 AI 第 3 轮/u)
 assert.match(html, /让 AI 修改/u)
 assert.match(html, /提交内容.*任务产出.*README.md.*必交.*AI 产出.*附加资料.*cells.csv.*会话附件/su)
 assert.doesNotMatch(html, /data\/cells.csv/u)
 assert.match(html, /共 2 项/u)
 assert.doesNotMatch(html, /提交前请检查结果说明和文件/u)
})

test('AI modifying keeps summary editable but disables submission', () => {
 const html = render({ ...data, state: 'modifying' })
 assert.match(html, /AI 正在修改/u)
 assert.doesNotMatch(html.match(/<textarea[^>]*>/u)?.[0] ?? '', /disabled/u)
 assert.match(html.match(/<button[^>]*data-testid="delivery-submit"[^>]*>/u)?.[0] ?? '', /disabled/u)
})

test('new AI summary offers replace or preserve without discarding the authored summary', () => {
 const html = render({ ...data, state: 'changed', summary: '成员修改的说明', aiSummary: '新的 AI 说明' })
 assert.match(html, /有新改动/u)
 assert.match(html, /AI 有新的说明/u)
 assert.match(html, /替换/u)
 assert.match(html, /保留我的修改/u)
 assert.match(html, /成员修改的说明/u)
})

test('slice A exposes no unavailable material selector', () => {
 const html = drawer('usr_worker000001', undefined)
 assert.doesNotMatch(html, /添加资料|从本机上传|还没有附加资料/u)
})

test('a draft without material selection shows only available content and adaptive bytes', () => {
 const html = renderToStaticMarkup(<DeliveryDraft data={{ ...data, declaredFiles: [{ ...output, byteCount: 152 }] }} onSubmit={noOp} />)
 assert.doesNotMatch(html, /附加资料|cells.csv|200 MB|0\.0 MB/u)
 assert.match(html, /data-testid="delivery-total">共 1 项 · 152 B<\/p>/u)
})

test('snapshots and history without material selection omit the unavailable group and limit', () => {
 const snapshot = { revision: 1, summary: '上一版不可变说明', declaredFiles: [{ ...output, byteCount: 152 }], additionalFiles: [addition], submitter: '执行成员', submittedAt: '2026-10-21T02:30:00.000Z' }
 for (const state of ['ready', 'submitted', 'adopted'] as const) {
  const html = renderToStaticMarkup(<DeliveryDraft data={{ ...data, state, revision: 2, declaredFiles: snapshot.declaredFiles, history: [snapshot] }} onSubmit={noOp} />)
  assert.doesNotMatch(html, /附加资料|cells.csv|200 MB|0\.0 MB/u, state)
  assert.equal((html.match(/data-testid="delivery-total">共 1 项 · 152 B<\/p>/gu) ?? []).length, 2, state)
 }
})

test('empty additional materials explain what the member can include', () => {
 assert.match(render({ ...data, additionalFiles: [] }), /还没有附加资料。你可以把数据、图表或其他文件作为本次交付的一部分。/u)
})

test('available material selection retains grouped snapshots, history and the size limit', () => {
 const html = render({ ...data, state: 'submitted', history: [{ revision: 1, summary: '上一版', declaredFiles: [output], additionalFiles: [addition], submitter: '执行成员', submittedAt: '2026-10-21T02:30:00.000Z' }] })
 assert.equal((html.match(/data-testid="delivery-additional-files"/gu) ?? []).length, 2)
 assert.equal((html.match(/共 2 项 · 5\.8 KB \/ 200 MB/gu) ?? []).length, 2)
 assert.match(html, /cells.csv/u)
})

test('oversized material is named and submission is blocked', () => {
 const html = render({ ...data, additionalFiles: [{ ...addition, byteCount: 210 * 1024 * 1024 }] })
 assert.match(html, /cells.csv/u)
 assert.match(html, /200 MB/u)
 assert.match(html.match(/<button[^>]*data-testid="delivery-submit"[^>]*>/u)?.[0] ?? '', /disabled/u)
})

test('revision includes attributed instructions and readonly prior history', () => {
 const html = render({ ...data, revision: 2, revisionRequest: { author: '李负责人', at: '2026-10-21T03:00:00.000Z', instruction: '补充每个数据集的限制与适用范围。' }, history: [{ revision: 1, summary: '上一版不可变说明', declaredFiles: [output], additionalFiles: [addition], submitter: '执行成员', submittedAt: '2026-10-21T02:30:00.000Z' }] })
 assert.match(html, /李负责人/u)
 assert.match(html, /补充每个数据集的限制与适用范围。/u)
 assert.match(html, /第 2 版草稿/u)
 assert.match(html, /历史版本/u)
 assert.match(html, /上一版不可变说明/u)
})

test('owner preparing projection excludes all draft contents and file names', () => {
 const html = drawer('usr_owner000001')
 assert.match(html, /成员正在准备交付（第 1 版）/u)
 assert.doesNotMatch(html, /README|cells.csv|结果说明|让 AI 修改|添加资料|<textarea/u)
})

test('submitted snapshot names the submitter and keeps owner review actions without duplicate pending labels', () => {
 const detail: DeliveryDraftData = { ...data, state: 'submitted', submitter: '执行成员', submittedAt: '2026-10-21T02:30:00.000Z' }
 const html = renderToStaticMarkup(<TaskDrawer card={{ ...card, status: 'review', stateLabel: '待你采纳' }} projectName="数据质控说明" currentUserId="usr_owner000001" members={[{ userId: 'usr_owner000001', name: '负责人', role: '所有者' }]} deliveryDetail={detail} onAdopt={noOp} onRequestRevision={noOp} onPreviewDraftFile={noOp} activity={[{ actor: '执行成员', text: '第 1 版已提交', time: '10:30', event: true }]} />)
 assert.match(html, /交付快照/u)
 assert.match(html, /任务产出/u)
 assert.doesNotMatch(html, /附加资料|200 MB/u)
 assert.match(html, /执行成员/u)
 assert.match(html, /采纳交付/u)
 assert.match(html, /要求返修/u)
 assert.equal((html.match(/待负责人采纳/gu) ?? []).length, 1)
 assert.doesNotMatch(html, />待确认<|<textarea|data-testid="delivery-submit"/u)
})

test('revision source identifies the prior version while AI follows the revision request', () => {
 const html = render({ ...data, revision: 2, state: 'modifying', source: { ...data.source!, revision: 1 }, revisionRequest: { author: '负责人', at: '2026-10-21T03:00:00.000Z', instruction: '补充限制。' } })
 const source = html.match(/data-testid="delivery-ai-source".*?<\/div>/su)?.[0] ?? ''
 assert.match(source, /基于第 1 版 · AI 正在按返修意见修改…/u)
 assert.doesNotMatch(source, /来自 AI 第 3 轮/u)
})

test('revision source uses only a completed AI round belonging to this draft revision', () => {
 const revisionRequest = { author: '负责人', at: '2026-10-21T03:00:00.000Z', instruction: '补充限制。' }
 const pending = render({ ...data, revision: 2, source: { ...data.source!, revision: 1 }, revisionRequest })
 const completed = render({ ...data, revision: 2, state: 'changed', source: { ...data.source!, round: 4, revision: 2 }, revisionRequest })
 assert.match(pending, /基于第 1 版/u)
 assert.doesNotMatch(pending, /来自 AI 第 3 轮/u)
 assert.match(completed, /来自 AI 第 4 轮（返修）/u)
 assert.doesNotMatch(completed.match(/data-testid="delivery-ai-source".*?<\/div>/su)?.[0] ?? '', /基于第 1 版/u)
})

test('stopped task offers reexecution and the standard continuation', () => {
  const html = renderToStaticMarkup(<TaskDrawer card={{ ...card, executionFailure: { code: 'runtime_cancelled', reexecutionInputId: 'stopped-input' } }} projectName="数据质控说明" currentUserId={card.assigneeUserId} deliveryDetail={{ ...data, state: 'failed', failureReason: '本轮执行已取消。' }} onReexecute={noOp} onContinueSession={noOp} />)
  assert.match(html, /在会话中继续/u)
  assert.match(html, /data-testid="delivery-reexecute"/u)
})
