import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomainAgentThreadDetail, DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { ResearchRecordRuntime } from './research-record.js'
import { ResearchRecordStore } from './research-record-store.js'
import { recordHash } from './research-record-state.js'
import { EvidenceFileStorage } from './secure-storage.js'
import { ResearchSourceStore } from './research-source-store.js'
import type { ResearchRecordEdit, ResearchRecordNode } from '../research-record-contract.js'

test('retained exact source survives edits, compaction and restart; missing authority and corruption fail closed', async () => {
  const f = await fixture(undefined, undefined, 60000)
  let restarted: ResearchRecordRuntime | undefined
  try {
    const source = (await tree(f.runtime, f.scope)).find(node => node.source?.itemId === 'tool')!
    const original = (await f.runtime.view({ ...f.scope, nodeId: source.id })).raw
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'NEW_BYTES' })
    await f.runtime.scan()
    const changed = await f.runtime.view({ ...f.scope, nodeId: source.id })
    assert.equal(changed.sourceStatus, 'changed'); assert.equal(changed.rawOrigin, 'retained')
    assert.deepEqual(changed.raw, original)
    Object.assign(f.detail, { turns: [] }); await f.runtime.scan(); await f.runtime.close()
    restarted = new ResearchRecordRuntime(f.options); restarted.start(f.context, true)
    const restored = await restarted.view({ ...f.scope, nodeId: source.id })
    assert.equal(restored.sourceStatus, 'unavailable'); assert.equal(restored.retainedSource, 'retained')
    assert.deepEqual(restored.raw, original)
    const exported = await restarted.view({ ...f.scope, nodeId: source.id, includeSourceExport: true })
    assert.equal(exported.sourceExport?.complete, true)
    assert.deepEqual(exported.sourceExport?.raw, original)
    assert.equal(exported.sourceRetention?.policy, 'retain-referenced-no-auto-delete')
    assert.equal(exported.sourceRetention?.usageKnown, true)
    assert.equal(exported.sourceRetention?.reservedEntries, 0)
    await assert.rejects(restarted.view({ ...f.scope, workspaceRoot: join(f.scope.workspaceRoot, 'foreign'), nodeId: source.id }), /不匹配/)
    Object.assign(f.context.agentThreads, { readMetadata: async (input: { threadId: string }) => { if (input.threadId === 'new-session') return { ...f.scope, id: 'new-session' }; throw new Error('missing original thread') } })
    const denied = await restarted.view({ ...f.scope, threadId: 'new-session', nodeId: source.id })
    assert.equal(denied.retainedSource, 'denied'); assert.equal(denied.raw, undefined)
    const deniedExport = await restarted.view({ ...f.scope, threadId: 'new-session', nodeId: source.id, includeSourceExport: true })
    assert.equal(deniedExport.sourceExport?.complete, false)
    assert.equal(deniedExport.sourceExport?.raw, undefined)
    await assert.rejects(restarted.view({ ...f.scope, nodeId: source.id }), /missing original thread/)
    Object.assign(f.context.agentThreads, { readMetadata: async () => ({ ...f.scope, id: f.scope.threadId }) })
    const file = join(f.scope.workspaceRoot, 'evidence-dag', `research-source-${recordHash(source.source)}.json`)
    await writeFile(file, JSON.stringify({ id: 'tool', text: 'CORRUPTED' }))
    const corrupt = await restarted.view({ ...f.scope, nodeId: source.id })
    assert.equal(corrupt.retainedSource, 'corrupt'); assert.equal(corrupt.raw, undefined)
    const store = new ResearchSourceStore(join(f.scope.workspaceRoot, 'evidence-dag'))
    assert.throws(() => store.retain(source.source, original), /corrupt/)
  } finally { await f.runtime.close(); await restarted?.close() }
})

test('review receipts verify native model input/output and expose drift without issuing a new model call', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const before = await f.runtime.review(f.scope)
    assert.equal(before.items.length, 1)
    const input = { ...f.scope, sequence: before.items[0].sequence }
    const audit = await f.runtime.audit(input)
    assert.equal(audit.inputStatus, 'matched'); assert.equal(audit.outputStatus, 'matched')
    assert.equal(audit.sources.length, 2)
    assert.ok(audit.sources.every(source => source.status === 'current'))
    assert.match(audit.recipe!.inputDigest, /^[a-f0-9]{64}$/)
    assert.ok(audit.changes.some(change => change.field === 'title' && change.after === '检查基线差异'))
    assert.equal((await f.runtime.review({ ...f.scope, sinceSequence: before.latestSequence })).total, 0)
    assert.equal((await f.runtime.review(f.scope)).revision, before.revision)
    assert.equal(f.counts().modelCalls, 1)
    Object.assign(f.side.turns[0].messages[1], { text: 'changed native answer' })
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'changed canonical tool' })
    const changed = await f.runtime.audit(input)
    assert.equal(changed.outputStatus, 'changed'); assert.equal(changed.inputStatus, 'matched')
    assert.ok(changed.sources.some(source => source.status === 'changed'))
    Object.assign(f.side, { workspaceRoot: join(f.scope.workspaceRoot, 'different') })
    const missing = await f.runtime.audit(input)
    assert.equal(missing.outputStatus, 'unavailable'); assert.equal(missing.input, null)
    await assert.rejects(f.runtime.audit({ ...input, workspaceRoot: join(f.scope.workspaceRoot, 'different') }), /不匹配/)
    assert.equal(f.counts().modelCalls, 1)
  } finally { await f.runtime.close() }
})

test('human changes keep exact predecessors, idempotency and departed phase scope; pagination freezes its upper sequence', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const round = (await tree(f.runtime, f.scope)).find(node => node.kind === 'round')!
    const original = await f.runtime.review(f.scope)
    const request: ResearchRecordEdit = { ...f.scope, requestId: 'rename-receipt', expectedRevision: original.revision,
      change: { kind: 'fields', nodeId: round.id, title: '人工修改标题' } }
    await f.runtime.edit(request); await f.runtime.edit(request)
    const renamed = await f.runtime.review({ ...f.scope, sinceSequence: original.latestSequence })
    assert.equal(renamed.total, 1)
    const receipt = await f.runtime.audit({ ...f.scope, sequence: renamed.items[0].sequence })
    assert.deepEqual(receipt.changes.find(change => change.field === 'title'), { field: 'title', before: round.title, after: '人工修改标题' })
    assert.equal(receipt.inputStatus, 'not-applicable')
    await f.runtime.edit({ ...f.scope, requestId: 'move-receipt', expectedRevision: renamed.revision, change: { kind: 'move', nodeId: round.id, parentId: 'root' } })
    const departed = await f.runtime.review({ ...f.scope, nodeId: round.parentId, sinceSequence: renamed.latestSequence })
    assert.equal(departed.total, 1); assert.equal(departed.items[0].historical, true)
    for (let i = 0; i < 24; i++) await f.runtime.edit({ ...f.scope, requestId: `page-${i}`, expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'fields', nodeId: round.id, title: `标题 ${i}` } })
    const first = await f.runtime.review({ ...f.scope, mode: 'history' })
    await f.runtime.edit({ ...f.scope, requestId: 'after-page', expectedRevision: first.revision, change: { kind: 'fields', nodeId: round.id, title: '新到记录' } })
    const second = await f.runtime.review({ ...f.scope, mode: 'history', offset: first.nextOffset!, throughSequence: first.throughSequence })
    assert.equal(second.items[0].sequence, first.items.at(-1)!.sequence - 1)
    assert.equal(first.total, second.total)
    assert.equal(second.latestSequence, first.latestSequence + 1)
  } finally { await f.runtime.close() }
})

test('foreground turns defer and coalesce organizer work; startup running snapshots also prevent dispatch', async t => {
  const f = await fixture(undefined, detail => Object.assign(detail.turns[0], { status: 'running' }))
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    offset = 2000; await f.runtime.scan()
    assert.equal(f.counts().modelCalls, 0)
    assert.equal((await f.runtime.review(f.scope)).worker, 'foreground')
    f.emit({ kind: 'before-turn', deliveryAttemptId: 'foreground-1' })
    Object.assign(f.detail.turns[0], { status: 'completed' })
    Object.assign(f.detail, { watermark: 'finished' })
    await f.runtime.scan()
    assert.equal(f.counts().modelCalls, 0)
    f.emit({ kind: 'after-turn', deliveryAttemptId: 'foreground-1' })
    for (let i = 0; i < 4; i++) {
      ;(f.detail.turns[0].artifacts as unknown[]).push({ id: `burst-${i}`, kind: 'tool', status: 'completed', detail: `burst ${i}` })
      Object.assign(f.detail, { watermark: `burst-${i}` })
      await f.runtime.scan()
    }
    assert.equal((await f.runtime.review(f.scope)).worker, 'cooldown')
    assert.equal(f.counts().modelCalls, 0)
    offset += 16000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    assert.equal(f.counts().modelCalls, 1)
    assert.equal((f.requests[0].data.evidence as unknown[]).length, 6)
  } finally { await f.runtime.close() }
})

test('eligible rounds drain before their shared phase is synthesized once without losing source evidence', async t => {
  const f = await fixture(undefined, detail => {
    for (const index of [2, 3]) (detail.turns as unknown[]).push({
      id: `turn-${index}`, status: 'completed', messages: [], artifacts: [
        { id: `observation-${index}`, kind: 'user_message', text: `Independent observation ${index}.` }
      ]
    })
  })
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  f.setResponse(data => {
    const ids = (data.evidence as { id: string }[]).map(item => item.id)
    return JSON.stringify({ phasePath: ['共享研究阶段'], title: '独立来源整理',
      steps: [{ title: '保留本轮来源', summary: '', sourceIds: ids }],
      statePatch: [{ op: 'add', kind: 'negative', text: '保留原始观察与失败边界，不补造科学结论。', sourceIds: ids }] })
  })
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 2)
    assert.equal(f.requests[0].purpose, 'organize')
    // The first round's parent phase is now due, alongside two eligible rounds.
    // A phase-first scheduler would summarize a partial batch here and again later.
    for (const pending of [1, 0]) {
      offset += pending === 1 ? 70000 : 20000
      await f.runtime.scan()
      const expectedCalls = pending === 1 ? 2 : 3
      await until(async () => f.requests.length >= expectedCalls)
      assert.equal(f.requests[expectedCalls - 1].purpose, 'organize', 'a due phase must not preempt an eligible round')
      await until(async () => (await f.runtime.view(f.scope)).pending === pending)
    }
    assert.equal(f.requests.filter(request => request.purpose === 'phase-synthesis').length, 0)
    offset += 20000; await f.runtime.scan()
    await until(async () => (await tree(f.runtime, f.scope)).some(node => node.kind === 'phase' && node.synthesisStatus === 'ready'))
    assert.deepEqual(f.requests.map(request => request.purpose), ['organize', 'organize', 'organize', 'phase-synthesis'])
    const changed = f.requests[3].data.changedRounds as { id: string; entries: { sourceIds: string[] }[] }[]
    assert.equal(new Set(changed.map(round => round.id)).size, 3)
    assert.equal(new Set(changed.flatMap(round => round.entries.flatMap(entry => entry.sourceIds))).size, 4)
    const nodes = await tree(f.runtime, f.scope)
    assert.equal(nodes.filter(node => node.source).length, 4)
    assert.equal(nodes.find(node => node.source?.itemId === 'tool')!.status, 'failed')
    offset += 70000; await f.runtime.scan()
    assert.equal(f.requests.length, 4, 'an unchanged batch must not recompute the shared phase')
    assert.equal((await f.runtime.view(f.scope)).organizationCoverage.assigned, 4)
  } finally { await f.runtime.close() }
})

test('attention contains current leaf concerns once and excludes a resolved concern', async t => {
  const f = await fixture()
  f.setResponse(data => JSON.stringify({ phasePath: ['机制验证', '对照实验'], title: '检查基线差异', statePatch: [
    { op: 'add', kind: 'negative', text: '基线命令失败，尚未验证优势。', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) },
    { op: 'add', kind: 'open', text: '需复查运行条件。', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) }
  ], steps: [{ title: '基线检查', summary: '', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) }] }))
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    for (let i = 0; i < 2; i++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => (await tree(f.runtime, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length === i + 1)
    }
    const attention = await f.runtime.review({ ...f.scope, mode: 'attention' })
    assert.equal(attention.total, 2)
    assert.ok(attention.items[0].sequence > 0)
    const entry = attention.items.find(item => item.kind === 'open')!
    f.setResponse(data => JSON.stringify({ phasePath: ['机制验证', '对照实验'], title: '独立复查', statePatch: [
      { op: 'resolve', entryId: entry.id, note: '复查已回应这一问题；不抹除先前负例。', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) }
    ], steps: [] }))
    ;(f.detail.turns[0].artifacts as unknown[]).push({ id: 'resolution', kind: 'user_message', text: '复查完成，原始负例仍保留。' })
    Object.assign(f.detail, { watermark: 'resolution' })
    await f.runtime.scan(); offset += 20000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const after = await f.runtime.review({ ...f.scope, mode: 'attention' })
    assert.equal(after.total, 1); assert.equal(after.items[0].kind, 'negative')
    assert.ok((await f.runtime.review({ ...f.scope, mode: 'history' })).items.some(item => item.text.includes('基线命令失败')))
  } finally { await f.runtime.close() }
})

async function fixture(principalContext?: Record<string, unknown>, prepare?: (detail: DomainAgentThreadDetail) => void, pollMs = 50) {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'research-record-')))
  const scope = { runtimeId: 'codex', threadId: 'main-thread', workspaceRoot: userDataDir }
  const detail: DomainAgentThreadDetail = { id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: userDataDir, watermark: '1', artifacts: [], turns: [{ id: 'turn-1', status: 'failed', messages: [], artifacts: [
    { id: 'question', kind: 'user_message', text: '比较两组基线，保留反例。' },
    { id: 'tool', kind: 'tool', toolKind: 'command_execution', status: 'failed', summary: 'bash · baseline comparison', detail: 'RAW_OUTPUT_CANONICAL_ONLY', meta: { skillName: 'baseline-review' } }
  ] }] }
  if (principalContext) for (const item of detail.turns[0].artifacts) Object.assign(item as object, { principalContext })
  prepare?.(detail)
  let modelCalls = 0, readCalls = 0
  const side: DomainAgentThreadDetail = { id: 'side-thread', runtimeId: 'codex', workspaceRoot: userDataDir, watermark: '1', artifacts: [], turns: [] }
  let onTurn: (event: any) => void = () => undefined
  const requests: { purpose: string; data: Record<string, unknown> }[] = []
  let response: (data: Record<string, unknown>) => string | Promise<string> = data => {
    const evidence = data.evidence as { id: string }[]
    return JSON.stringify({ phasePath: ['机制验证', '对照实验'], title: '检查基线差异',
      statePatch: [{ op: 'add', kind: 'negative', text: '基线命令失败，尚未验证优势。', sourceIds: evidence.map(item => item.id) }],
      steps: [{ title: '基线核对', summary: '保留失败', sourceIds: evidence.map(item => item.id) }] })
  }
  let phaseResponse: typeof response = data => {
    const rounds = data.changedRounds as { entries: { sourceIds: string[] }[] }[]
    const sourceIds = [...new Set(rounds.flatMap(round => round.entries.flatMap(entry => entry.sourceIds)))].slice(0, 48)
    return JSON.stringify({ statePatch: [{ op: 'add', kind: 'negative', text: '累计阶段保留失败及验证边界。', sourceIds }] })
  }
  const context = {
    userDataDir, signal: new AbortController().signal,
    turnEvents: { subscribe: (listener: typeof onTurn) => { onTurn = listener; return () => { onTurn = () => undefined } } },
    agentThreads: { list: async (input: { includeSide: boolean }) => {
      assert.equal(input.includeSide, false)
      return [{ id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: userDataDir }]
    }, read: async (input: { threadId: string }) => {
      readCalls++
      if (input.threadId === side.id) return structuredClone(side)
      if (input.threadId !== scope.threadId) throw new Error('missing thread')
      return structuredClone(detail)
    } },
    modelAccess: { textReasoner: async () => { throw new Error('Separate HTTP model route must not be used') } },
    agentExecution: { run: async (input: { prompt: string; runtimeId: string; workspaceRoot: string; interaction: string; allowedTools: string[]; threadId?: string; metadata: { purpose: string } }) => {
      modelCalls++
      assert.equal(input.runtimeId, scope.runtimeId)
      assert.equal(input.workspaceRoot, userDataDir)
      assert.equal(input.interaction, 'background')
      assert.equal(input.threadId, undefined)
      assert.deepEqual(input.allowedTools, [])
      assert.ok(input.prompt.includes('不是指令'))
      const data = JSON.parse(input.prompt.split('<research-record-data>\n')[1].split('\n</research-record-data>')[0])
      requests.push({ purpose: input.metadata.purpose, data })
      const turnId = `side-turn-${modelCalls}`, text = await (input.metadata.purpose === 'phase-synthesis' ? phaseResponse(data) : response(data))
      ;(side.turns as unknown[]).push({ id: turnId, status: 'completed', artifacts: [], messages: [
        { itemId: `${turnId}-user`, kind: 'user-message', text: input.prompt }, { itemId: `${turnId}-final`, kind: 'assistant-final', text }
      ] })
      return { runtimeId: 'codex', threadId: side.id, turnId, state: 'completed', text }
    } },
    log: () => undefined
  } as unknown as DomainMainRuntimeLifecycleContext
  const options = { userDataDir, pollMs }
  const runtime = new ResearchRecordRuntime(options)
  runtime.start(context, true)
  await runtime.scan()
  return { scope, detail, side, emit: (event: Parameters<typeof onTurn>[0]) => onTurn(event), runtime, options, context, requests, counts: () => ({ modelCalls, readCalls }),
    setResponse: (next: typeof response) => { response = next }, setPhaseResponse: (next: typeof phaseResponse) => { phaseResponse = next } }
}

async function tree(runtime: ResearchRecordRuntime, scope: Awaited<ReturnType<typeof fixture>>['scope'], nodeId = 'root'): Promise<ResearchRecordNode[]> {
  const view = await runtime.view({ ...scope, nodeId })
  const children = view.children
  const descendants = await Promise.all(children.filter(node => node.kind !== 'event').map(node => tree(runtime, scope, node.id)))
  return [...children, ...descendants.flat()]
}
async function until(predicate: () => Promise<boolean>, timeout = 6000) {
  const start = Date.now()
  while (!await predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for native background worker')
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

test('canonical source stays outside derived storage; replays are idempotent; source drift is explicit', async () => {
  const f = await fixture()
  try {
    const first = await f.runtime.view(f.scope)
    await f.runtime.scan()
    assert.equal((await f.runtime.view(f.scope)).revision, first.revision)
    const nodes = await tree(f.runtime, f.scope)
    const source = nodes.find(node => node.source?.itemId === 'tool')!
    assert.equal(source.status, 'failed')
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: source.id })).sourceStatus, 'current')
    const file = (await readdir(join(f.scope.workspaceRoot, 'evidence-dag'))).find(file => file.startsWith('research-record-'))!
    assert.equal((await readFile(join(f.scope.workspaceRoot, 'evidence-dag', file), 'utf8')).includes('RAW_OUTPUT_CANONICAL_ONLY'), false)
    ;(f.detail.turns[0].artifacts[1] as Record<string, unknown>).detail = 'changed after observation'
    Object.assign(f.detail, { watermark: '2' })
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: source.id })).sourceStatus, 'changed')
    await f.runtime.scan()
    assert.equal((await tree(f.runtime, f.scope)).filter(node => node.source?.itemId === 'tool').length, 2)
    await assert.rejects(f.runtime.view({ ...f.scope, workspaceRoot: join(f.scope.workspaceRoot, 'other') }), /不匹配/)
  } finally { await f.runtime.close() }
})

test('native background organizes without UI and restart preserves cursor, hierarchy and failure facts', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    assert.equal(f.counts().modelCalls, 1)
    const nodes = await tree(f.runtime, f.scope)
    assert.equal(nodes.filter(node => node.kind === 'phase').length, 2)
    assert.ok(nodes.some(node => node.kind === 'step'))
    assert.equal(nodes.find(node => node.kind === 'round')!.status, 'failed')
    assert.ok(nodes.some(node => node.kind === 'capability' && node.title === 'Skill · baseline-review'))
    await f.runtime.close()
    const restored = new ResearchRecordRuntime(f.options)
    restored.start(f.context, true)
    try {
      await restored.scan()
      assert.deepEqual((await tree(restored, f.scope)).map(node => node.id), nodes.map(node => node.id))
      assert.equal((await restored.view(f.scope)).pending, 0)
      assert.equal(f.counts().modelCalls, 1)
    } finally { await restored.close() }
  } finally { await f.runtime.close() }
})

test('restart omitting the exact empty identity does not reorganize; real text and tool changes still do', async () => {
  const emptyIdentity = { identityVersion: 0, principal: null }
  const f = await fixture(emptyIdentity)
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const before = await tree(f.runtime, f.scope)
    const events = before.filter(node => node.source)
    assert.equal(events.length, 2)
    assert.equal(f.counts().modelCalls, 1)
    for (const event of events) {
      const raw = (await f.runtime.view({ ...f.scope, nodeId: event.id })).raw as Record<string, unknown>
      assert.deepEqual(raw.principalContext, emptyIdentity)
    }
    await f.runtime.close()
    for (const item of f.detail.turns[0].artifacts) delete (item as Record<string, unknown>).principalContext
    Object.assign(f.detail, { watermark: 'restored-without-empty-identity' })
    const restored = new ResearchRecordRuntime(f.options)
    restored.start(f.context, true)
    try {
      await restored.scan()
      assert.deepEqual((await tree(restored, f.scope)).map(node => node.id), before.map(node => node.id))
      assert.equal((await restored.view(f.scope)).pending, 0)
      assert.equal(f.counts().modelCalls, 1)
      for (const event of events) assert.equal((await restored.view({ ...f.scope, nodeId: event.id })).sourceStatus, 'current')
      Object.assign(f.detail.turns[0].artifacts[0] as object, { text: '改用新的独立对照。' })
      Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'NEW_CANONICAL_FAILURE exit=7', status: 'failed' })
      Object.assign(f.detail, { watermark: 'actual-text-and-tool-changes' })
      await restored.scan()
      assert.equal((await restored.view(f.scope)).pending, 1)
      await until(async () => (await restored.view(f.scope)).pending === 0)
      assert.equal(f.counts().modelCalls, 2)
      const after = await tree(restored, f.scope)
      assert.equal(after.filter(node => node.source).length, 4)
      for (const event of events) assert.equal((await restored.view({ ...f.scope, nodeId: event.id })).sourceStatus, 'changed')
      assert.ok(after.some(node => node.source?.itemId === 'tool' && node.status === 'failed'))
    } finally { await restored.close() }
  } finally { await f.runtime.close() }
})

test('nonempty identity, identity versions and additional provenance fields remain source-significant', async () => {
  for (const principalContext of [
    { identityVersion: 1, principal: null },
    { identityVersion: 0, principal: { id: 'researcher-a' } },
    { identityVersion: 0, principal: null, provenance: 'retain-this' }
  ]) {
    const f = await fixture(principalContext)
    try {
      const view = await f.runtime.view(f.scope)
      await f.runtime.edit({ ...f.scope, requestId: 'pause-identity-probe', expectedRevision: view.revision, change: { kind: 'settings', paused: true, model: '' } })
      const events = (await tree(f.runtime, f.scope)).filter(node => node.source)
      for (const item of f.detail.turns[0].artifacts) delete (item as Record<string, unknown>).principalContext
      Object.assign(f.detail, { watermark: 'identity-removed' })
      await f.runtime.scan()
      assert.equal((await tree(f.runtime, f.scope)).filter(node => node.source).length, 4)
      for (const event of events) assert.equal((await f.runtime.view({ ...f.scope, nodeId: event.id })).sourceStatus, 'changed')
    } finally { await f.runtime.close() }
  }
})

test('long phases derive recorded date spans from original observations, not phase edit time', async () => {
  const f = await fixture()
  try {
    Object.assign(f.detail.turns[0].artifacts[0] as object, { createdAt: '2026-09-01T10:00:00.000Z' })
    Object.assign(f.detail.turns[0].artifacts[1] as object, { createdAt: '2026-10-15T10:00:00.000Z' })
    Object.assign(f.detail, { watermark: 'dated' })
    await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const phase = (await f.runtime.view(f.scope)).children.find(node => node.kind === 'phase')!
    assert.equal(phase.recordedRange?.start, '2026-09-01T10:00:00.000Z')
    // Original undated observations were ingested before this dated update and remain preserved.
    assert.ok(phase.recordedRange?.end)
    const before = phase.recordedRange
    await f.runtime.edit({ ...f.scope, requestId: 'rename-dated-phase', expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'phase', nodeId: phase.id, parentId: 'root', title: 'Long phase renamed', summary: '' } })
    assert.deepEqual((await f.runtime.view({ ...f.scope, nodeId: phase.id })).node?.recordedRange, before)
  } finally { await f.runtime.close() }
})

test('phase recaps retain exact round provenance and one global latest recorded path across historical views', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const original = await f.runtime.view(f.scope)
    const past = original.children.find(node => node.kind === 'phase')!
    const round = (await tree(f.runtime, f.scope)).find(node => node.kind === 'round')!
    assert.deepEqual(past.recentRound, { id: round.id, title: round.title, summary: round.summary, status: 'failed' })
    assert.equal(past.counts?.rounds, 1)
    assert.equal(past.counts?.failedRounds, 1)
    assert.ok(original.latestRecordPath.includes(past.id))
    assert.ok(original.latestRecordPath.includes(round.id))
    await f.runtime.edit({ ...f.scope, requestId: 'future-phase', expectedRevision: original.revision,
      change: { kind: 'phase', parentId: 'root', title: '待开展的长程阶段', summary: '' } })
    const planned = await f.runtime.view(f.scope)
    const empty = planned.children.find(node => node.title === '待开展的长程阶段')!
    assert.deepEqual(planned.latestRecordPath, original.latestRecordPath)
    assert.equal(empty.recentRound, undefined)
    assert.equal(empty.recordedRange, undefined)
    assert.equal(empty.counts?.rounds, 0)
    await f.runtime.close()
    Object.assign(f.detail, { watermark: 'later-recorded-phase', turns: [...f.detail.turns, {
      id: 'turn-later', status: 'unknown', completedAt: '2099-02-01T12:00:00.000Z', messages: [],
      artifacts: [{ id: 'question-later', kind: 'user_message', text: '继续检查，不把未知状态当成功。', createdAt: '2099-02-01T12:00:00.000Z' }]
    }] })
    f.setResponse(data => JSON.stringify({ phasePath: ['下一轮验证'], title: '检查待确认条件', statePatch: [{ op: 'add', kind: 'open', text: '等待检查结果，尚无完成证据。', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) }],
      steps: [{ title: '提出检查要求', summary: '结果未知', sourceIds: (data.evidence as { id: string }[]).map(item => item.id) }] }))
    const restored = new ResearchRecordRuntime(f.options)
    restored.start(f.context, true)
    try {
      await restored.scan()
      await until(async () => (await restored.view(f.scope)).pending === 0)
      const current = await restored.view(f.scope)
      const latestPhase = current.children.find(node => node.title === '下一轮验证')!
      assert.ok(current.latestRecordPath.includes(latestPhase.id))
      assert.equal(current.latestRecordPath.includes(past.id), false)
      assert.equal(current.latestRecordPath.includes(empty.id), false)
      assert.equal(latestPhase.recentRound?.status, 'unknown')
      assert.equal(latestPhase.recentRound?.summary, '未决：等待检查结果，尚无完成证据。')
      const history = await restored.view({ ...f.scope, nodeId: past.id })
      assert.deepEqual(history.latestRecordPath, current.latestRecordPath)
      assert.deepEqual(history.node?.recentRound, past.recentRound)
      assert.equal(history.node?.counts?.failedRounds, 1)
      assert.equal(f.counts().modelCalls, 2, 'projection reads do not start additional organizer requests')
    } finally { await restored.close() }
  } finally { await f.runtime.close() }
})

test('later-created long groups sort by their recorded beginnings before pagination without rewriting sources', async () => {
  const dates = ['2025-09-01T12:00:00Z', '2025-10-01T12:00:00Z', '2025-11-01T12:00:00Z', '2026-01-01T12:00:00Z']
  const f = await fixture(undefined, detail => Object.assign(detail, { turns: dates.map((createdAt, index) => ({
    id: `dated-${index}`, status: index === 0 ? 'failed' : 'completed', completedAt: createdAt, messages: [],
    artifacts: [{ id: `record-${index}`, kind: 'user_message', text: `研究阶段 ${index + 1}`, createdAt }]
  })) }))
  try {
    let request = 0
    const edit = async (change: ResearchRecordEdit['change']) => f.runtime.edit({ ...f.scope,
      requestId: `phase-order-${request++}`, expectedRevision: (await f.runtime.view(f.scope)).revision, change })
    await edit({ kind: 'settings', paused: true, model: '' })
    const initial = await f.runtime.view(f.scope)
    const sourceBefore = JSON.stringify(f.detail)
    const observations = (await tree(f.runtime, f.scope)).filter(node => node.source).map(node => ({ id: node.id, source: node.source, createdAt: node.createdAt }))
    for (let index = 0; index < dates.length; index++) {
      await edit({ kind: 'phase', nodeId: `phase-${index}`, parentId: 'root', title: `阶段 ${index + 1}`, summary: '' })
      const round = initial.children.find(node => node.turnId === `dated-${index}`)!
      await edit({ kind: 'move', nodeId: round.id, parentId: `phase-${index}` })
    }
    await edit({ kind: 'phase', nodeId: 'long-group', parentId: 'root', title: '早期研究长期分组', summary: '' })
    for (let index = 0; index < 3; index++) await edit({ kind: 'move', nodeId: `phase-${index}`, parentId: 'long-group' })
    for (const nodeId of ['empty-first', 'empty-second']) await edit({ kind: 'phase', nodeId, parentId: 'root', title: nodeId, summary: '' })
    const ordered = await f.runtime.view(f.scope)
    assert.deepEqual(ordered.children.map(node => node.id), ['long-group', 'phase-3', 'empty-first', 'empty-second'])
    assert.equal(ordered.children[0].recordedRange?.start, dates[0])
    assert.equal(ordered.children[0].counts?.failedRounds, 1)
    assert.equal(ordered.children[2].recordedRange, undefined)
    assert.equal(ordered.children[3].recordedRange, undefined)
    assert.deepEqual((await f.runtime.view({ ...f.scope, offset: 1 })).children.map(node => node.id), ['phase-3', 'empty-first', 'empty-second'])
    assert.deepEqual((await f.runtime.view({ ...f.scope, nodeId: 'long-group' })).children.map(node => node.id), ['phase-0', 'phase-1', 'phase-2'])
    assert.equal(JSON.stringify(f.detail), sourceBefore)
    const after = new Map((await tree(f.runtime, f.scope)).filter(node => node.source).map(node => [node.id, node]))
    for (const before of observations) {
      assert.deepEqual(after.get(before.id)?.source, before.source)
      assert.equal(after.get(before.id)?.createdAt, before.createdAt)
    }
    assert.equal(f.counts().modelCalls, 0)
  } finally { await f.runtime.close() }
})

test('phase discussion reads bounded descendant evidence only on demand without a model call', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const normal = await f.runtime.view(f.scope)
    assert.equal(normal.discussionContext, undefined)
    await f.runtime.edit({ ...f.scope, requestId: 'pause-for-context', expectedRevision: normal.revision,
      change: { kind: 'settings', paused: true, model: '' } })
    const modelCalls = f.counts().modelCalls
    const phase = normal.children.find(node => node.kind === 'phase')!
    const selected = await f.runtime.view({ ...f.scope, nodeId: phase.id, includeDiscussionContext: true })
    assert.ok(selected.discussionContext?.evidence.some(item => item.ref.itemId === 'tool' && item.excerpt.includes('RAW_OUTPUT_CANONICAL_ONLY')))
    assert.equal(selected.discussionContext?.totalEvents, 2)
    assert.equal(f.counts().modelCalls, modelCalls)
    for (let i = 0; i < 60; i++) (f.detail.turns[0].artifacts as Record<string, unknown>[]).push({ id: `extra-${i}`, kind: 'tool', detail: 'bounded context' })
    Object.assign(f.detail, { watermark: 'many' })
    await f.runtime.scan()
    const whole = await f.runtime.view({ ...f.scope, includeDiscussionContext: true })
    assert.ok(whole.discussionContext!.evidence.length <= 48)
    assert.equal(whole.discussionContext!.limited, true)
    assert.equal(whole.discussionContext!.totalEvents, 62)
    assert.equal(f.counts().modelCalls, modelCalls)
  } finally { await f.runtime.close() }
})

test('recursive manual phases reject cycles and stale writes; model preserves human placement', async () => {
  const f = await fixture()
  try {
    let view = await f.runtime.view(f.scope)
    const phase = { ...f.scope, requestId: 'phase-1', expectedRevision: view.revision, change: { kind: 'phase' as const, parentId: 'root', title: '长期验证', summary: '' } }
    const receipt = await f.runtime.edit(phase)
    assert.deepEqual(await f.runtime.edit(phase), receipt)
    view = await f.runtime.view(f.scope)
    const parent = view.children.find(node => node.kind === 'phase')!
    await f.runtime.edit({ ...f.scope, requestId: 'sub-phase', expectedRevision: view.revision, change: { kind: 'phase', parentId: parent.id, title: '第二阶段', summary: '' } })
    const child = (await f.runtime.view({ ...f.scope, nodeId: parent.id })).children[0]
    view = await f.runtime.view(f.scope)
    await assert.rejects(f.runtime.edit({ ...f.scope, requestId: 'cycle', expectedRevision: view.revision, change: { kind: 'move', nodeId: parent.id, parentId: child.id } }), /后代/)
    const round = view.children.find(node => node.kind === 'round')!
    await f.runtime.edit({ ...f.scope, requestId: 'move-round', expectedRevision: view.revision, change: { kind: 'move', nodeId: round.id, parentId: child.id } })
    await assert.rejects(f.runtime.edit({ ...phase, requestId: 'stale' }), /已更新/)
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: round.id })).node?.parentId, child.id)
  } finally { await f.runtime.close() }
})

test('invalid model source IDs do not fabricate steps or rewrite facts; failures remain visible', async () => {
  const f = await fixture()
  f.setResponse(() => JSON.stringify({ phasePath: ['invented'], title: 'wrong', statePatch: [], steps: [{ title: 'fake', summary: '', sourceIds: ['invented-event'] }] }))
  try {
    await until(async () => (await f.runtime.view(f.scope)).failures.length > 0)
    const nodes = await tree(f.runtime, f.scope)
    assert.equal(nodes.filter(node => node.kind === 'step' && node.origin === 'model').length, 0)
    assert.ok(nodes.filter(node => node.kind === 'capability').every(node => nodes.find(parent => parent.id === node.parentId)?.kind === 'step'))
    assert.equal((await f.runtime.view(f.scope)).pending, 1)
    const rejected = (await f.runtime.review({ ...f.scope, mode: 'history' })).items.find(item => item.kind === 'model-rejected')!
    assert.ok(rejected)
    assert.match(rejected.text, /未采纳/)
    const receipt = await f.runtime.audit({ ...f.scope, sequence: rejected.sequence })
    assert.equal(receipt.origin, 'model'); assert.equal(receipt.outputStatus, 'matched')
    assert.deepEqual(receipt.changes, [])
  } finally { await f.runtime.close() }
})

test('historical discussions and pinned handoffs remain read-only across new organization writes', async () => {
  const f = await fixture()
  await f.runtime.close()
  const directory = join(f.scope.workspaceRoot, 'evidence-dag')
  const file = join(directory, `research-record-${recordHash(f.scope.workspaceRoot)}.json`)
  const stored = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
  stored.paused = true
  const message = { id: 'old-answer', role: 'assistant' as const, text: '旧讨论尚未完成', sourceIds: [], createdAt: '2026-10-01', status: 'pending' as const, requestId: 'old-ask', scopeDigest: 'old-scope', limited: true }
  const handoffs = { 'old-handoff': { digest: 'old-digest', document: '# 已固定的旧文档', route: { threadId: f.scope.threadId }, revision: 1 } }
  stored.messages.root = [message]
  stored.handoffs = handoffs
  await writeFile(file, JSON.stringify(stored))
  const restored = new ResearchRecordRuntime(f.options)
  restored.start(f.context, true)
  try {
    const view = await restored.view(f.scope)
    assert.deepEqual(view.messages, [message])
    await restored.edit({ ...f.scope, requestId: 'new-phase', expectedRevision: view.revision, change: { kind: 'phase', parentId: 'root', title: '后续阶段', summary: '' } })
    const saved = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
    assert.deepEqual(saved.messages.root, [message])
    assert.deepEqual(saved.handoffs, handoffs)
  } finally { await restored.close() }
})

test('incremental batches preserve earlier step IDs and failures', async t => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const oldStep = (await tree(f.runtime, f.scope)).find(node => node.kind === 'step')!
    const realNow = Date.now
    let offset = 0
    t.mock.method(Date, 'now', () => realNow() + offset)
    ;(f.detail.turns[0].artifacts as unknown[]).push({ id: 'new-attempt', kind: 'tool', status: 'completed', toolKind: 'command_execution', detail: 'new evidence' })
    Object.assign(f.detail, { watermark: '2' })
    offset = 20000
    await f.runtime.scan()
    offset = 40000
    await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const nodes = await tree(f.runtime, f.scope)
    assert.ok(nodes.some(node => node.id === oldStep.id))
    assert.equal(nodes.filter(node => node.kind === 'step').length, 2)
    assert.ok(nodes.some(node => node.source?.itemId === 'tool' && node.status === 'failed'))
    assert.equal(f.counts().modelCalls, 2)
  } finally { await f.runtime.close() }
})

test('new-source append during inference commits the covered batch and keeps later work pending', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  let release!: (value: string) => void
  f.setResponse(() => new Promise(resolve => { release = resolve }))
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => Boolean(release))
    const first = f.requests[0].data.evidence as { id: string }[]
    ;(f.detail.turns[0].artifacts as unknown[]).push({ id: 'later', kind: 'tool', status: 'completed', detail: 'new independent observation' })
    Object.assign(f.detail, { watermark: 'append-during-model' })
    await f.runtime.scan()
    release(JSON.stringify({ phasePath: ['稳定阶段'], title: '旧批仍有效', steps: [{ title: 'first', summary: '', sourceIds: first.map(e => e.id) }],
      statePatch: [{ op: 'add', kind: 'negative', text: '原有失败保留', sourceIds: first.map(e => e.id) }] }))
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    const view = await f.runtime.view(f.scope)
    assert.equal(view.organizationCoverage.observed, 3)
    assert.equal(view.organizationCoverage.pending, 1)
    assert.equal(view.organizationCoverage.unassigned, 1)
    assert.equal(f.counts().modelCalls, 1)
  } finally { await f.runtime.close() }
})

test('omitted sources remain unassigned and explicit retry processes only the missing assignment', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  f.setResponse(data => {
    const evidence = data.evidence as { id: string }[]
    return JSON.stringify({ phasePath: [], title: '保留遗漏', steps: [{ title: 'one', summary: '', sourceIds: [evidence[0].id] }],
      statePatch: [{ op: 'add', kind: 'open', text: '仍需审阅遗漏来源', sourceIds: [evidence[0].id] }] })
  })
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.processed === 2)
    const before = await tree(f.runtime, f.scope)
    const firstStep = before.find(node => node.kind === 'step' && node.origin === 'model')!
    const view = await f.runtime.view(f.scope)
    assert.deepEqual(view.organizationCoverage, { observed: 2, historical: 0, processed: 2, assigned: 1, fullExcerpt: 2, truncated: 0, unavailable: 0, changed: 0, unassigned: 1, pending: 0, blocked: 0 })
    offset = 40000; await f.runtime.scan()
    assert.equal(f.counts().modelCalls, 1, 'omission does not trigger an endless automatic retry')
    await f.runtime.edit({ ...f.scope, requestId: 'retry-missing-only', expectedRevision: view.revision, change: { kind: 'retry' } })
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    assert.equal((f.requests[1].data.evidence as unknown[]).length, 1)
    const after = await tree(f.runtime, f.scope)
    assert.ok(after.some(node => node.id === firstStep.id))
    assert.equal(after.filter(node => node.kind === 'step' && node.origin === 'model').length, 2)
  } finally { await f.runtime.close() }
})

test('truncated and unavailable sources stay distinct and do not spin automatic retries', async t => {
  const f = await fixture(undefined, detail => { (detail.turns[0].artifacts[0] as Record<string, unknown>).text = 'x'.repeat(12000) })
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    const originalRead = f.context.agentThreads.read
    let reads = 0
    const changedRead: typeof originalRead = async input => {
      const snapshot = await originalRead(input)
      if (++reads > 1) Object.assign(snapshot.turns[0], { artifacts: snapshot.turns[0].artifacts.slice(0, -1) })
      return snapshot
    }
    Object.assign(f.context.agentThreads, { read: changedRead })
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.processed === 1)
    const coverage = (await f.runtime.view(f.scope)).organizationCoverage
    assert.equal(coverage.observed, 2)
    assert.equal(coverage.processed, 1)
    assert.equal(coverage.assigned, 1)
    assert.equal(coverage.fullExcerpt, 0)
    assert.equal(coverage.truncated, 1)
    assert.equal(coverage.unavailable, 1)
    offset = 40000; await f.runtime.scan()
    assert.equal(f.counts().modelCalls, 1)
  } finally { await f.runtime.close() }
})

test('move fixes placement while cumulative negative and open facts survive later batches and independent field locks', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  f.setResponse(data => {
    const ids = (data.evidence as { id: string }[]).map(e => e.id)
    return JSON.stringify({ phasePath: ['original'], title: 'initial', steps: [{ title: 'initial', summary: '', sourceIds: ids }],
      statePatch: [{ op: 'add', kind: 'negative', text: 'old failure', sourceIds: ids }, { op: 'add', kind: 'open', text: 'why failed', sourceIds: ids }] })
  })
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    const round = (await tree(f.runtime, f.scope)).find(node => node.kind === 'round')!
    await f.runtime.edit({ ...f.scope, requestId: 'manual-placement', expectedRevision: (await f.runtime.view(f.scope)).revision, change: { kind: 'move', nodeId: round.id, parentId: 'root' } })
    await f.runtime.edit({ ...f.scope, requestId: 'manual-title', expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'fields', nodeId: round.id, title: 'human title' } })
    const open = round.synthesis!.entries.find(entry => entry.kind === 'open')!
    f.setResponse(data => {
      const existing = data.existingRound as { summary: string; synthesis: { entries: { id: string; text: string }[] } }
      assert.equal(existing.summary, '', 'structured state is sent once instead of repeating it in a prose summary')
      assert.ok(existing.synthesis.entries.some(entry => entry.text === 'old failure'))
      assert.ok(existing.synthesis.entries.some(entry => entry.id === open.id))
      const ids = (data.evidence as { id: string }[]).map(e => e.id)
      return JSON.stringify({ phasePath: ['wrong-place'], title: 'model title', steps: [{ title: 'new evidence', summary: '', sourceIds: ids }],
        statePatch: [{ op: 'add', kind: 'progress', text: 'new verified input', sourceIds: ids },
          { op: 'resolve', entryId: open.id, note: 'input corrected', sourceIds: ids }] })
    })
    ;(f.detail.turns[0].artifacts as unknown[]).push({ id: 'new', kind: 'tool', status: 'completed', detail: 'corrected input' })
    Object.assign(f.detail, { watermark: 'new-resolving-source' })
    offset = 20000; await f.runtime.scan(); offset = 22000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 3)
    const updated = (await f.runtime.view({ ...f.scope, nodeId: round.id })).node!
    assert.equal(updated.parentId, 'root')
    assert.equal(updated.title, 'human title')
    assert.deepEqual(updated.locks, { placement: true, title: true, summary: false })
    assert.match(updated.summary, /new verified input/)
    assert.match(updated.summary, /old failure/)
    assert.equal(updated.synthesis!.entries.find(entry => entry.id === open.id)?.status, 'resolved')
  } finally { await f.runtime.close() }
})

test('v1 assigned steps are preserved while real-source semantic backfill lets migrated phases complete', async t => {
  const f = await fixture()
  await until(async () => (await f.runtime.view(f.scope)).pending === 0)
  await f.runtime.close()
  const directory = join(f.scope.workspaceRoot, 'evidence-dag')
  const file = join(directory, `research-record-${recordHash(f.scope.workspaceRoot)}.json`)
  const legacy: any = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
  legacy.version = 1; delete legacy.phaseJobs; delete legacy.ingestion
  const oldSteps = Object.values(legacy.nodes as Record<string, ResearchRecordNode>).filter(node => node.kind === 'step').map(node => node.id)
  for (const node of Object.values(legacy.nodes) as Record<string, unknown>[]) {
    delete node.synthesis; delete node.locks
    if (node.kind === 'round') node.locked = true
  }
  for (const [id, job] of Object.entries(legacy.jobs) as [string, { fingerprint: string; sourceIds: string[]; processedIds: string[] }][]) {
    legacy.jobs[id] = { fingerprint: job.fingerprint, sourceIds: job.sourceIds, classifiedIds: job.processedIds, done: true, attempts: 0, nextAt: 0 }
  }
  await writeFile(file, JSON.stringify(legacy))
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  const restored = new ResearchRecordRuntime(f.options)
  restored.start(f.context, true)
  try {
    await restored.scan(); offset = 2000; await restored.scan()
    await until(async () => (await restored.view(f.scope)).organizationCoverage.fullExcerpt === 2)
    const nodes = await tree(restored, f.scope)
    assert.deepEqual(nodes.filter(node => node.kind === 'step').map(node => node.id), oldSteps)
    const round = nodes.find(node => node.kind === 'round')!
    assert.deepEqual(round.locks, { placement: true, title: false, summary: false })
    assert.ok(round.synthesis!.entries.length > 0)
    assert.match(round.synthesis!.legacySummary!, /基线命令失败/)
    for (let index = 0; index < 2; index++) {
      offset += 70000; await restored.scan()
      await until(async () => f.requests.filter(request => request.purpose === 'phase-synthesis').length >= index + 1)
      await until(async () => (await tree(restored, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length >= index + 1)
    }
    const phases = (await tree(restored, f.scope)).filter(node => node.kind === 'phase')
    assert.ok(phases.every(phase => phase.synthesisStatus === 'ready'))
    assert.ok(phases.every(phase => phase.synthesis?.coveredChildRevisions?.[round.id] === round.synthesis!.revision))
    const saved = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
    assert.equal(saved.version, 2)
    assert.equal(saved.history.filter((entry: { kind: string }) => entry.kind === 'schema-migration-v1-v2').length, 1)
    assert.deepEqual(saved.jobs[round.id].semanticPendingIds, [])
  } finally { await restored.close() }
})

test('phase synthesis is delayed and only affected paths update after an entire phase moves', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    assert.equal(f.requests.filter(request => request.purpose === 'phase-synthesis').length, 0)
    for (let index = 0; index < 2; index++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => (await tree(f.runtime, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length >= index + 1)
    }
    const nodes = await tree(f.runtime, f.scope)
    const outer = nodes.find(node => node.kind === 'phase' && node.parentId === 'root')!
    const inner = nodes.find(node => node.kind === 'phase' && node.parentId === outer.id)!
    const round = nodes.find(node => node.kind === 'round')!
    await f.runtime.edit({ ...f.scope, requestId: 'create-new-parent', expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'phase', nodeId: 'new-parent', parentId: 'root', title: '新的长期分组', summary: '' } })
    await f.runtime.edit({ ...f.scope, requestId: 'create-unrelated', expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'phase', nodeId: 'unrelated', parentId: 'root', title: '不相关计划', summary: '人工保留' } })
    await f.runtime.edit({ ...f.scope, requestId: 'move-whole-phase', expectedRevision: (await f.runtime.view(f.scope)).revision,
      change: { kind: 'move', nodeId: inner.id, parentId: 'new-parent' } })
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: outer.id })).node?.synthesisStatus, 'stale')
    const initial = f.requests.length
    for (let index = 0; index < 3; index++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => f.requests.length >= initial + index + 1)
      await until(async () => (await f.runtime.view({ ...f.scope, nodeId: [outer.id, inner.id, 'new-parent'][index] })).node?.synthesisStatus === 'ready')
    }
    const calls = f.requests.slice(initial)
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.purpose === 'phase-synthesis'))
    assert.ok(calls.every(call => (call.data.existingPhase as { id: string }).id !== 'unrelated'))
    const removed = calls.find(call => (call.data.existingPhase as { id: string }).id === outer.id)!
    const changed = removed.data.changedRounds as { id: string; membership: string; path: string[] }[]
    assert.equal(changed[0].id, round.id)
    assert.equal(changed[0].membership, 'removed')
    assert.ok(changed[0].path.includes('new-parent'))
    const old = (await f.runtime.view({ ...f.scope, nodeId: outer.id })).node!
    assert.ok(old.synthesis!.entries.every(entry => entry.membership === 'historical'))
    assert.match(old.summary, /历史迁出/)
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: 'unrelated' })).node?.summary, '人工保留')
    for (const call of calls) assert.ok(JSON.stringify(call.data).length <= 60000)
  } finally { await f.runtime.close() }
})

test('commit-time source validation reads each thread once rather than once per item', async t => {
  const f = await fixture(undefined, detail => {
    for (let index = 0; index < 24; index++) (detail.turns[0].artifacts as unknown[]).push({ id: `extra-${index}`, kind: 'tool', status: 'completed', detail: 'small evidence' })
  }, 60000)
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  let release!: (value: string) => void
  f.setResponse(() => new Promise(resolve => { release = resolve }))
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => Boolean(release))
    const ids = (f.requests[0].data.evidence as { id: string }[]).map(item => item.id)
    assert.equal(ids.length, 26)
    const before = f.counts().readCalls
    release(JSON.stringify({ phasePath: [], title: 'bounded verification', steps: [{ title: 'all', summary: '', sourceIds: ids }],
      statePatch: [{ op: 'add', kind: 'progress', text: 'provided observations', sourceIds: ids }] }))
    const directory = join(f.scope.workspaceRoot, 'evidence-dag')
    const file = join(directory, `research-record-${recordHash(f.scope.workspaceRoot)}.json`)
    await until(async () => Object.values(new ResearchRecordStore(file, f.scope.workspaceRoot).load()!.jobs as Record<string, { assignedIds: string[] }>).some(job => job.assignedIds.length === 26))
    assert.ok(f.counts().readCalls - before <= 3, 'one validation snapshot, allowing one concurrently scheduled scan; never 26 reads')
  } finally { await f.runtime.close() }
})

test('coverage separates current sources from preserved historical versions and their successful steps', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    const old = (await tree(f.runtime, f.scope)).find(node => node.source?.itemId === 'tool')!
    const oldParent = old.parentId
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'NEW_SOURCE_REVISION' })
    Object.assign(f.detail, { watermark: 'changed-source-version' })
    offset = 20000; await f.runtime.scan()
    const pending = (await f.runtime.view(f.scope)).organizationCoverage
    assert.deepEqual({ observed: pending.observed, historical: pending.historical, assigned: pending.assigned, unassigned: pending.unassigned, changed: pending.changed },
      { observed: 2, historical: 1, assigned: 1, unassigned: 1, changed: 0 })
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: old.id })).sourceStatus, 'changed')
    offset = 22000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    const final = (await f.runtime.view(f.scope)).organizationCoverage
    assert.equal(final.historical, 1)
    assert.equal(final.unassigned, 0)
    const retained = (await tree(f.runtime, f.scope)).find(node => node.id === old.id)!
    assert.equal(retained.parentId, oldParent)
    assert.deepEqual(retained.source, old.source)
  } finally { await f.runtime.close() }
})

test('one appended source invokes one round update then each affected phase once, without stale pre-synthesis', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    for (let index = 0; index < 2; index++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => (await tree(f.runtime, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length >= index + 1)
    }
    const before = f.requests.length
    ;(f.detail.turns[0].artifacts as unknown[]).push({ id: 'one-appended', kind: 'tool', status: 'completed', detail: 'increment' })
    Object.assign(f.detail, { watermark: 'one-appended' })
    offset += 70000; await f.runtime.scan()
    assert.equal(f.requests.length, before, 'phase must wait for newly ingested source organization')
    offset += 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 3)
    assert.equal(f.requests[before].purpose, 'organize')
    for (let index = 0; index < 2; index++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => (await tree(f.runtime, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length >= index + 1)
    }
    assert.deepEqual(f.requests.slice(before).map(request => request.purpose), ['organize', 'phase-synthesis', 'phase-synthesis'])
    offset += 70000; await f.runtime.scan()
    assert.equal(f.requests.length, before + 3)
  } finally { await f.runtime.close() }
})

test('escaped large evidence is processed in bounded incremental batches without resending covered sources', async t => {
  const f = await fixture(undefined, detail => {
    for (let index = 0; index < 10; index++) (detail.turns[0].artifacts as unknown[]).push({
      id: `escaped-${index}`, kind: 'tool', status: 'failed', detail: '\\"\n'.repeat(1800)
    })
  }, 60000)
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  f.setResponse(data => {
    const ids = (data.evidence as { id: string }[]).map(item => item.id)
    return JSON.stringify({ phasePath: [], title: '有界增量', steps: [{ title: '保留失败', summary: '', sourceIds: ids }],
      statePatch: [{ op: 'add', kind: 'negative', text: '来源中的失败待核对。', sourceIds: ids }] })
  })
  try {
    for (let index = 0; index < 20 && (await f.runtime.view(f.scope)).organizationCoverage.assigned < 12; index++) {
      const before = (await f.runtime.view(f.scope)).organizationCoverage.assigned
      offset += 20000; await f.runtime.scan()
      await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned > before)
    }
    const batches = f.requests.filter(request => request.purpose === 'organize')
    assert.ok(batches.length > 1)
    const ids = batches.flatMap(request => {
      assert.ok(JSON.stringify(request.data).length <= 24000)
      return (request.data.evidence as { id: string }[]).map(item => item.id)
    })
    assert.equal(ids.length, 12)
    assert.equal(new Set(ids).size, 12)
    const view = await f.runtime.view(f.scope)
    assert.equal(view.organizationCoverage.assigned, 12)
    assert.equal(view.organizationCoverage.truncated, 10)
    const calls = f.counts().modelCalls
    offset += 70000; await f.runtime.scan()
    await f.runtime.review(f.scope)
    assert.equal(f.counts().modelCalls, calls, 'unchanged sources and browsing never request another summary')
  } finally { await f.runtime.close() }
})

test('durable visible boundaries detect same-watermark drift, retain missing coverage and resume restored sources', async t => {
  const f = await fixture(undefined, undefined, 60000)
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  let restored: ResearchRecordRuntime | undefined
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    const old = (await tree(f.runtime, f.scope)).find(node => node.source?.itemId === 'tool')!
    const turns = structuredClone(f.detail.turns)
    Object.assign(f.detail, { turns: [] })
    await f.runtime.scan()
    const gap = await f.runtime.view(f.scope)
    assert.equal(gap.organizationCoverage.observed, 2)
    assert.equal(gap.organizationCoverage.assigned, 2)
    assert.equal(gap.organizationCoverage.unavailable, 2)
    assert.match(gap.failures.at(-1)!.message, /投影缺少/)
    await f.runtime.scan()
    assert.equal((await f.runtime.view(f.scope)).revision, gap.revision)
    await f.runtime.close()
    restored = new ResearchRecordRuntime(f.options); restored.start(f.context, true)
    await restored.scan()
    assert.equal((await restored.view(f.scope)).revision, gap.revision)
    assert.equal((await restored.view(f.scope)).failures.length, gap.failures.length)
    Object.assign(f.detail, { turns })
    await restored.scan()
    assert.equal((await restored.view(f.scope)).organizationCoverage.unavailable, 0)
    assert.equal(f.counts().modelCalls, 1)
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'same watermark revised source' })
    await restored.scan()
    const revised = await restored.view(f.scope)
    assert.equal(revised.organizationCoverage.historical, 1)
    assert.equal(revised.organizationCoverage.assigned, 1)
    offset += 20000; await restored.scan()
    await until(async () => (await restored!.view(f.scope)).organizationCoverage.assigned === 2)
    assert.equal(f.counts().modelCalls, 2)
    assert.ok((await tree(restored, f.scope)).some(node => node.id === old.id))
    const store = new ResearchRecordStore(join(f.scope.workspaceRoot, 'evidence-dag', `research-record-${recordHash(f.scope.workspaceRoot)}.json`), f.scope.workspaceRoot)
    assert.deepEqual(Object.values(store.load()!.ingestion!)[0].missingIds, [])
  } finally { await f.runtime.close(); await restored?.close() }
})

test('missing unprocessed item returns with the same watermark and is classified once', async t => {
  const f = await fixture(undefined, undefined, 60000)
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  const items = [...f.detail.turns[0].artifacts]
  try {
    Object.assign(f.detail.turns[0], { artifacts: items.slice(0, 1) })
    await f.runtime.scan(); offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.processed === 1)
    const gap = await f.runtime.view(f.scope)
    assert.equal(gap.organizationCoverage.observed, 2); assert.equal(gap.organizationCoverage.unavailable, 1)
    Object.assign(f.detail.turns[0], { artifacts: items })
    await f.runtime.scan(); offset += 20000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.processed === 2)
    assert.equal(f.counts().modelCalls, 2)
    assert.equal((await f.runtime.view(f.scope)).organizationCoverage.unavailable, 0)
  } finally { await f.runtime.close() }
})

test('failed runtime commit exposes neither a human edit nor its receipt after reload', async t => {
  const f = await fixture(undefined, undefined, 60000)
  try {
    const before = await f.runtime.view(f.scope)
    const original = EvidenceFileStorage.prototype.writeText
    const mocked = t.mock.method(EvidenceFileStorage.prototype, 'writeText', function (this: EvidenceFileStorage, text: string) {
      if (JSON.parse(text).format === 'research-record-store-v1') throw new Error('runtime commit failed')
      return original.call(this, text)
    })
    const request: ResearchRecordEdit = { ...f.scope, expectedRevision: before.revision, requestId: 'failed-edit', change: { kind: 'phase', parentId: 'root', title: 'uncommitted phase', summary: '' } }
    await assert.rejects(f.runtime.edit(request), /runtime commit failed/)
    mocked.mock.restore()
    const restored = await f.runtime.view(f.scope)
    assert.equal(restored.revision, before.revision)
    assert.equal(restored.children.some(node => node.title === 'uncommitted phase'), false)
    await f.runtime.edit(request)
    assert.equal((await f.runtime.view(f.scope)).children.filter(node => node.title === 'uncommitted phase').length, 1)
  } finally { await f.runtime.close() }
})


test('legacy source order and temporary projection gaps never dirty covered stages or repeat synthesis', async t => {
  const f = await fixture()
  const now = Date.now; let offset = 0
  t.mock.method(Date, 'now', () => now() + offset)
  let restored: ResearchRecordRuntime | undefined
  try {
    offset = 2000; await f.runtime.scan()
    await until(async () => (await f.runtime.view(f.scope)).organizationCoverage.assigned === 2)
    for (let index = 0; index < 2; index++) {
      offset += 70000; await f.runtime.scan()
      await until(async () => (await tree(f.runtime, f.scope)).filter(node => node.kind === 'phase' && node.synthesisStatus === 'ready').length >= index + 1)
    }
    const calls = f.counts().modelCalls
    await f.runtime.close()
    const file = join(f.scope.workspaceRoot, 'evidence-dag', `research-record-${recordHash(f.scope.workspaceRoot)}.json`)
    const legacy = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
    delete legacy.ingestion
    await writeFile(file, JSON.stringify(legacy))
    const originalTurns = structuredClone(f.detail.turns)
    Object.assign(f.detail.turns[0], { artifacts: [...f.detail.turns[0].artifacts].reverse() })
    restored = new ResearchRecordRuntime(f.options); restored.start(f.context, true)
    await restored.scan()
    const phases = async () => (await tree(restored!, f.scope)).filter(node => node.kind === 'phase').map(node => node.synthesisStatus)
    assert.deepEqual(await phases(), ['ready', 'ready'])
    offset += 70000; await restored.scan()
    assert.equal(f.counts().modelCalls, calls)
    Object.assign(f.detail, { turns: [] })
    await restored.scan()
    assert.deepEqual(await phases(), ['unavailable', 'unavailable'])
    const missing = await restored.view(f.scope)
    assert.equal(missing.organizationCoverage.observed, 2)
    assert.equal(missing.organizationCoverage.unavailable, 2)
    Object.assign(f.detail, { turns: originalTurns })
    await restored.scan()
    assert.deepEqual(await phases(), ['ready', 'ready'])
    offset += 70000; await restored.scan()
    assert.equal(f.counts().modelCalls, calls)
    assert.equal((await restored.view(f.scope)).failures.length, missing.failures.length)
  } finally { await f.runtime.close(); await restored?.close() }
})

test('public compact boundaries survive restart once, expose unknown coverage and omit internal payloads', async () => {
  const f = await fixture(undefined, detail => {
    ;(detail.turns[0].artifacts as unknown[]).push({ id: 'compact-1', kind: 'compaction', status: 'success', summary: 'HIDDEN_COMPACT_TEXT', encryptedContent: 'HIDDEN_CIPHERTEXT' })
  }, 60000)
  try {
    const first = await f.runtime.view(f.scope)
    assert.equal(first.auditCoverage?.contextBoundaries, 1)
    assert.equal(first.auditCoverage?.completeness, 'unknown')
    const review = await f.runtime.review({ ...f.scope, mode: 'history' })
    const boundary = review.items.find(item => item.kind === 'context-boundary')!
    assert.ok(boundary); assert.match(boundary.text, /覆盖未知/)
    const audit = await f.runtime.audit({ ...f.scope, sequence: boundary.sequence })
    assert.equal(audit.contextBoundary?.metadata.itemId, 'compact-1')
    assert.equal(audit.contextBoundary?.hiddenReasoning, 'not-recorded')
    await f.runtime.scan()
    assert.equal((await f.runtime.view(f.scope)).revision, first.revision)
    const file = join(f.scope.workspaceRoot, 'evidence-dag', `research-record-${recordHash(f.scope.workspaceRoot)}.json`)
    const state = new ResearchRecordStore(file, f.scope.workspaceRoot).load()!
    assert.equal(state.history.filter(item => item.kind === 'context-boundary').length, 1)
    assert.equal(JSON.stringify(state).includes('HIDDEN_'), false)
    assert.equal(f.counts().modelCalls, 0)
    await f.runtime.close()
    const restored = new ResearchRecordRuntime(f.options)
    restored.start(f.context, true)
    try {
      await restored.scan()
      assert.equal((await restored.review({ ...f.scope, mode: 'history' })).items.filter(item => item.kind === 'context-boundary').length, 1)
    } finally { await restored.close() }
  } finally { await f.runtime.close() }
})

test('metadata authorizes list reads and paged sources keep exact bytes, workspace and drift checks', async () => {
  const f = await fixture(undefined, undefined, 60000)
  try {
    const source = (await tree(f.runtime, f.scope)).find(node => node.source?.itemId === 'tool')!
    let pages = 0
    Object.assign(f.context.agentThreads, {
      readMetadata: async () => ({ id: f.scope.threadId, runtimeId: f.scope.runtimeId, workspaceRoot: f.scope.workspaceRoot }),
      readPage: async (input: { cursor?: string; workspaceRoot: string; limit: number }) => {
        pages++; assert.equal(input.workspaceRoot, f.scope.workspaceRoot); assert.equal(input.limit, 100)
        return { ...structuredClone(f.detail), turns: input.cursor ? structuredClone(f.detail.turns) : [], nextCursor: input.cursor ? null : 'older-page' }
      }
    })
    const reads = f.counts().readCalls, models = f.counts().modelCalls
    await f.runtime.view(f.scope)
    const exact = await f.runtime.view({ ...f.scope, nodeId: source.id })
    assert.equal(exact.sourceStatus, 'current'); assert.match(JSON.stringify(exact.raw), /RAW_OUTPUT_CANONICAL_ONLY/)
    assert.equal(pages, 2); assert.equal(f.counts().readCalls, reads)
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'changed source bytes' })
    const changed = await f.runtime.view({ ...f.scope, nodeId: source.id })
    assert.equal(changed.sourceStatus, 'changed'); assert.equal(f.counts().readCalls, reads + 1)
    Object.assign(f.context.agentThreads, { readPage: async () => ({ ...f.detail, workspaceRoot: join(f.scope.workspaceRoot, 'foreign'), nextCursor: null }) })
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: source.id })).sourceStatus, 'unavailable')
    assert.equal(f.counts().modelCalls, models)
  } finally { await f.runtime.close() }
})

test('paged source cursor cycles stop without fabricating a current match', async () => {
  const f = await fixture(undefined, undefined, 60000)
  try {
    const source = (await tree(f.runtime, f.scope)).find(node => node.source?.itemId === 'tool')!
    let reads = 0
    Object.assign(f.context.agentThreads, { readPage: async () => { reads++; return { ...f.detail, turns: [], nextCursor: 'cycle' } } })
    assert.equal((await f.runtime.view({ ...f.scope, nodeId: source.id })).sourceStatus, 'unavailable')
    assert.equal(reads, 2)
  } finally { await f.runtime.close() }
})


test('summary links, historical discussion and audit read the same retained authorized observation', async () => {
  const f = await fixture()
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const round = (await tree(f.runtime, f.scope)).find(node => node.kind === 'round')!
    const before = await f.runtime.view({ ...f.scope, nodeId: round.id, includeScientificReview: true })
    assert.ok(before.synthesisImpact?.length)
    assert.ok(before.synthesisImpact.every(item => item.status === 'no-recorded-impact'))
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'NEW_MATERIAL' })
    const changed = await f.runtime.view({ ...f.scope, nodeId: round.id, includeScientificReview: true, includeDiscussionContext: true })
    assert.ok(changed.synthesisImpact?.some(item => item.status === 'requires-review'))
    const tool = changed.discussionContext?.evidence.find(item => item.liveStatus === 'changed')
    assert.equal(tool?.origin, 'retained'); assert.match(tool!.excerpt, /RAW_OUTPUT_CANONICAL_ONLY/)
    assert.ok(!tool!.excerpt.includes('NEW_MATERIAL'))
    const review = await f.runtime.review(f.scope)
    const audit = await f.runtime.audit({ ...f.scope, sequence: review.items[0].sequence })
    assert.ok(audit.sources.some(item => item.status === 'changed' && item.rawOrigin === 'retained' && item.excerpt?.includes('RAW_OUTPUT_CANONICAL_ONLY')))
    assert.equal(f.counts().modelCalls, 1)
  } finally { await f.runtime.close() }
})


test('resolution-only source drift affects its own synthesis while known unrelated and unmapped human summaries remain separate', async () => {
  const f = await fixture()
  let restored: ResearchRecordRuntime | undefined
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    const nodes = await tree(f.runtime, f.scope), round = nodes.find(node => node.kind === 'round')!
    const question = nodes.find(node => node.source?.itemId === 'question')!, tool = nodes.find(node => node.source?.itemId === 'tool')!
    await f.runtime.close()
    const store = new ResearchRecordStore(join(f.scope.workspaceRoot, 'evidence-dag', `research-record-${recordHash(f.scope.workspaceRoot)}.json`), f.scope.workspaceRoot)
    const state = store.load()!
    state.paused = true
    state.nodes[round.id].synthesis!.entries = [
      { id: 'resolution-only', kind: 'open', text: 'Resolved with tool evidence', sourceIds: [question.id], status: 'resolved', resolution: { note: 'Recorded response', sourceIds: [tool.id], at: '2026-11-05T00:00:00.000Z' } },
      { id: 'unrelated', kind: 'negative', text: 'Question-only negative retained', sourceIds: [question.id], status: 'active' }
    ]
    state.nodes[round.id].locks = { placement: false, title: false, summary: true }
    state.messages[round.id] = [{ id: 'discussion-mapped', role: 'user', text: 'Tool-specific human discussion', sourceIds: [tool.id], createdAt: '2026-11-05T00:00:00.000Z', status: 'complete', requestId: 'discussion-request', scopeDigest: 'original', limited: false }]
    state.revision++; store.commit(state)
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'CHANGED_TOOL' })
    restored = new ResearchRecordRuntime(f.options); restored.start(f.context, true)
    const view = await restored.view({ ...f.scope, nodeId: round.id, includeScientificReview: true })
    const status = (id: string) => view.synthesisImpact?.find(item => item.id === id)?.status
    assert.equal(status('resolution-only'), 'requires-review')
    assert.equal(status('discussion-mapped'), 'requires-review')
    assert.equal(status('unrelated'), 'no-recorded-impact')
    assert.equal(status(round.id), 'unknown')
    assert.ok(view.node?.synthesis?.entries.some(item => item.kind === 'negative'))
  } finally { await f.runtime.close(); await restored?.close() }
})


test('impact follows visible synthesis and discussion pages; unchanged ingestion avoids retention IO', async () => {
  const f = await fixture()
  let restored: ResearchRecordRuntime | undefined
  const originalRead = ResearchSourceStore.prototype.read
  try {
    await until(async () => (await f.runtime.view(f.scope)).pending === 0)
    let reads = 0
    ResearchSourceStore.prototype.read = function (ref) { reads++; return originalRead.call(this, ref) }
    await f.runtime.scan(); await f.runtime.scan()
    assert.equal(reads, 0, 'unchanged snapshots do not re-read retained source files')
    ResearchSourceStore.prototype.read = originalRead
    const nodes = await tree(f.runtime, f.scope), round = nodes.find(node => node.kind === 'round')!
    const question = nodes.find(node => node.source?.itemId === 'question')!, tool = nodes.find(node => node.source?.itemId === 'tool')!
    await f.runtime.close()
    const store = new ResearchRecordStore(join(f.scope.workspaceRoot, 'evidence-dag', `research-record-${recordHash(f.scope.workspaceRoot)}.json`), f.scope.workspaceRoot)
    const state = store.load()!
    state.paused = true
    state.nodes[round.id].synthesis!.entries = Array.from({ length: 70 }, (_, i) => ({ id: `paged-entry-${i}`, kind: 'progress' as const, text: `Entry ${i}`, sourceIds: [i === 69 ? tool.id : question.id], status: 'active' as const }))
    state.messages[round.id] = Array.from({ length: 30 }, (_, i) => ({ id: `paged-message-${i}`, role: 'user' as const, text: `Discussion ${i}`, sourceIds: [i === 0 ? tool.id : question.id], createdAt: '2026-11-05T00:00:00.000Z', status: 'complete' as const, requestId: `message-request-${i}`, scopeDigest: 'original', limited: false }))
    state.revision++; store.commit(state)
    Object.assign(f.detail.turns[0].artifacts[1] as object, { detail: 'CHANGED_TOOL' })
    restored = new ResearchRecordRuntime(f.options); restored.start(f.context, true)
    for (const offsets of [{ synthesisOffset: 0, messageOffset: 0 }, { synthesisOffset: 48, messageOffset: 20 }]) {
      const view = await restored.view({ ...f.scope, nodeId: round.id, includeScientificReview: true, ...offsets })
      for (const item of [...view.node!.synthesis!.entries, ...view.messages]) assert.ok(view.synthesisImpact?.some(impact => impact.id === item.id), `visible item ${item.id} has mapped impact`)
      const changed = offsets.synthesisOffset === 0 ? 'paged-entry-69' : 'paged-message-0'
      assert.equal(view.synthesisImpact?.find(item => item.id === changed)?.status, 'requires-review')
    }
  } finally { ResearchSourceStore.prototype.read = originalRead; await f.runtime.close(); await restored?.close() }
})
