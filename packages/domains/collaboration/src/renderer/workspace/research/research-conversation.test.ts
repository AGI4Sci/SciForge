import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adoptedResearchResults, sendResearchQuestion } from './research-conversation.js'
import type { ProjectCoordinatorRendererClient } from '../../../coordinator/renderer/project-coordinator-capability-client.js'
import type { ProjectCoordinatorProject } from '../../../coordinator/contract.js'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'

function fixture() {
  const projectId = 'prj_Research000001'
  const taskId = 'tsk_Research000001'
  const executionId = 'exe_Research000001'
  const manifestId = 'dmf_Research000001'
  const summary = '对照组未复现增益；仅在条件 A 下观察到差异，尚不能泛化。'
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, projectId, taskId, executionId, contractRevision: 1, resultRevision: 2, summary, outputs: [] }))
  const object = { objectId: 'obj_Research000001', projectId, revision: 2, mediaType: 'application/json', sha256: 'a'.repeat(64), byteCount: bytes.length }
  const manifest = { projectId, taskId, executionId, resultRevision: 2, deliveryManifestId: manifestId, bundleObjectId: object.objectId, objects: [object] }
  const receipt = { projectId, taskId, disposition: 'adopted', deliveryManifestId: manifestId, integrationReceiptId: 'irc_Research000001' }
  const project = { project: { projectId, ownerUserId: 'usr_Research000001', coordinatorAgentId: 'agt_Research000001', coordinatorAuthorityEpoch: 3, goal: '检验假设', revision: 9 }, confirmedRequirements: null,
    tasks: [{ task: { taskId, title: '独立对照' }, delivery: { manifest, receipt } }] }
  const binding = { ...project.project, role: 'coordinator', principalUserId: project.project.ownerUserId, runtimeId: 'codex', threadId: 'project-session', access: 'coordinator' }
  const workspace = { connection: { state: 'ready', userId: project.project.ownerUserId }, focusedProjectId: projectId, projects: [project] }
  const calls: { kind: string; input?: unknown }[] = []
  const client = {
    readWorkspace: async (input: unknown) => { calls.push({ kind: 'read', input }); return workspace },
    readSessionProjection: async () => ({ bindings: [binding] }),
    openDeliveryObject: async (input: unknown) => { calls.push({ kind: 'object', input }); return { resource: {}, object } },
    describeDeliveryObject: async () => ({ descriptor: { range: { size: bytes.length, maxChunkBytes: 37 } } }),
    readDeliveryObjectRange: async (_resource: unknown, { range }: { range: { offset: number; length: number } }) => ({ dataBase64: bytes.subarray(range.offset, range.offset + range.length).toString('base64') })
  } as unknown as ProjectCoordinatorRendererClient
  const host = { openSession: async (input: unknown) => { calls.push({ kind: 'open', input }); return true },
    sendMessage: async (input: unknown) => { calls.push({ kind: 'send', input }); return { ok: true } } } as DomainRendererWorkbenchHost
  return { projectId, manifestId, summary, project, receipt, manifest, binding, workspace, calls, client, host,
    input: { projectId, question: '如何解释这个反例？', deliveryManifestIds: [manifestId] } }
}

test('adoption -> exact sealed summary -> next research turn preserves negative evidence and same Session', async () => {
  const f = fixture()
  await sendResearchQuestion(f.client, f.host, f.input)
  assert.deepEqual(f.calls.map((entry) => entry.kind), ['read', 'object', 'open', 'send'])
  const message = f.calls.at(-1)!.input as { sessionId: string; text: string; displayText: string }
  assert.equal(message.sessionId, 'project-session')
  assert.equal(message.displayText, f.input.question)
  assert.ok(message.text.includes(f.summary))
  assert.ok(message.text.includes('"resultRevision":2'))
  assert.ok(message.text.includes(f.manifestId))
  assert.match(message.text, /不等于科学结论已获验证/u)
})

test('simple question needs no task, adopted result, or mandatory research template', async () => {
  const f = fixture()
  await sendResearchQuestion(f.client, f.host, { ...f.input, deliveryManifestIds: [] })
  assert.deepEqual(f.calls.map((entry) => entry.kind), ['read', 'open', 'send'])
  assert.ok(!(f.calls.at(-1)!.input as { text: string }).text.includes(f.summary))
})

test('unadopted, superseded, rejected and receipt/manifest mismatches never enter reusable research results', () => {
  for (const disposition of ['unadopted', 'superseded', 'rejected']) {
    const f = fixture(); f.receipt.disposition = disposition
    assert.deepEqual(adoptedResearchResults(f.project as unknown as ProjectCoordinatorProject), [])
  }
  const f = fixture(); f.receipt.deliveryManifestId = 'dmf_OldVersion0001'
  assert.deepEqual(adoptedResearchResults(f.project as unknown as ProjectCoordinatorProject), [])
})

test('fresh facts reject withdrawn adoption, changed principal, foreign project and read-only session before sending', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.receipt.disposition = 'unadopted' },
    (f: ReturnType<typeof fixture>) => { f.workspace.connection.userId = 'usr_Other0000001' },
    (f: ReturnType<typeof fixture>) => { f.workspace.focusedProjectId = 'prj_Other0000001' },
    (f: ReturnType<typeof fixture>) => { f.binding.access = 'read_only' },
    (f: ReturnType<typeof fixture>) => { f.binding.coordinatorAuthorityEpoch = 2 }
  ]
  for (const mutate of mutations) {
    const f = fixture(); mutate(f)
    await assert.rejects(sendResearchQuestion(f.client, f.host, f.input))
    assert.equal(f.calls.some((entry) => entry.kind === 'send' || entry.kind === 'open'), false)
  }
})

test('unavailable navigation and failed admission propagate errors; never retry automatically', async () => {
  const f = fixture()
  await assert.rejects(sendResearchQuestion(f.client, { ...f.host, openSession: async () => false }, f.input), /尚未发送/u)
  assert.equal(f.calls.some((entry) => entry.kind === 'send'), false)
  let attempts = 0
  await assert.rejects(sendResearchQuestion(f.client, { ...f.host, sendMessage: async () => { attempts++; return { ok: false, error: { code: 'busy', message: '正在运行，请稍后重试' } } } }, f.input), /正在运行/u)
  assert.equal(attempts, 1)
})

test('cancelled or oversized input cannot dispatch', async () => {
  const f = fixture()
  await assert.rejects(sendResearchQuestion(f.client, f.host, f.input, AbortSignal.abort()))
  await assert.rejects(sendResearchQuestion(f.client, f.host, { ...f.input, question: 'x'.repeat(8001) }))
  await assert.rejects(sendResearchQuestion(f.client, f.host, { ...f.input, deliveryManifestIds: Array(9).fill(f.manifestId) }))
  assert.equal(f.calls.length, 0)
})
