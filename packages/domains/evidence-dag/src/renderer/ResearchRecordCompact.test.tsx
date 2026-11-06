import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { ResearchRecordNode, ResearchRecordView } from '../research-record-contract'
import { compactRecord } from './research-record-compact'
import { ResearchRecordCompact } from './ResearchRecordCompact'
import { createResearchRecordPresentation } from './research-record-presentation'
import { createResearchAuditCommand } from './evidence-dag-right-panel-contribution'
import { recordMediaReferences, ResearchRecordMedia } from './ResearchRecordMedia'
const node = (id = 'n'): ResearchRecordNode => ({ id, parentId: 'root', title: '匹配对照', summary: '仅在条件A下改善。', kind: 'round', origin: 'model', status: 'completed', createdAt: '2026-11-05', updatedAt: '2026-11-05' })
const ref = { artifactId: 'artifact:1', versionId: 'artifact-version:1', contentDigest: 'a'.repeat(64), byteLength: 64, mediaType: 'image/png', availability: 'available', retention: 'snapshot', accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }

test('compact projection keeps full source and negative/open/failure indicators despite a completed round', () => {
  const input = { ...node(), summary: 'LONG '.repeat(400), behaviorCounts: { total: 9, failed: 2, cancelled: 1 }, concernCounts: { negative: 3, open: 4 } }
  const before = JSON.stringify(input), display = compactRecord(input)
  assert.deepEqual(display.alerts, ['失败 2', '中断 1', '负例 3', '未决 4'])
  assert.equal(display.summary.length, input.summary.trim().length)
  assert.equal(JSON.stringify(input), before)
})

test('compact list mounts twenty rows, exposes only a page-position strip, and reading creates no review', () => {
  const presentation = createResearchRecordPresentation()
  const view = { revision: 1, totalChildren: 10000, children: Array.from({ length: 100 }, (_, i) => node('n'+i)) } as ResearchRecordView
  const before = presentation.getSnapshot()
  const html = renderToStaticMarkup(createElement(ResearchRecordCompact, { scope: { runtimeId: 'codex', threadId: 'fixture', workspaceRoot: '/science' }, componentId: 'fixture', active: false, view, presentation, onNavigate: () => assert.fail('read must not navigate') }))
  assert.equal((html.match(/class="record-compact-row"/g) ?? []).length, 20)
  assert.match(html, /10000 项/); assert.match(html, /非耗时/)
  assert.doesNotMatch(html, /当前认识与适用范围|data-record-understanding/)
  assert.equal(presentation.getSnapshot(), before)
})

test('one-click action uses the existing global overlay and exact session scope without a new owner', () => {
  const requests: unknown[] = []
  const host = { workbench: { toggleGlobalOverlay: (input: unknown) => requests.push(input) } } as unknown as DomainRendererHost
  const command = createResearchAuditCommand(host)
  const scope = { sessionId: 's', runtimeId: 'codex', workspaceRoot: '/science' }
  assert.equal(command.isAvailable?.(scope), true)
  assert.equal(command.isAvailable?.({ sessionId: 's' }), false)
  command.execute(scope)
  assert.equal(requests.length, 1)
  const request = requests[0] as { contributionId: string; open: boolean; activation: { payload: unknown } }
  assert.equal(request.contributionId, 'evidence-dag.research-record-overlay'); assert.equal(request.open, true)
  assert.deepEqual(request.activation.payload, { recordScope: { runtimeId: 'codex', threadId: 's', workspaceRoot: '/science' } })
})

test('image extraction accepts exact version references, deduplicates them, and never treats paths or remote URLs as images', () => {
  const input = { result: { ref }, detail: JSON.stringify({ ref }), url: 'https://untrusted.invalid/image.png', image: '/science/final.png', partial: { versionId: 'guess', mediaType: 'image/png' } }
  assert.deepEqual(recordMediaReferences(input), { refs: [ref], limited: false })
  assert.equal(recordMediaReferences({ image: 'data:image/svg+xml,unsafe' }).refs.length, 0)
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  assert.equal(recordMediaReferences(cyclic).refs.length, 0)
  const many = Array.from({ length: 12 }, (_, i) => ({ ...ref, versionId: 'artifact-version:'+i }))
  assert.equal(recordMediaReferences(many).refs.length, 8); assert.equal(recordMediaReferences(many).limited, true)
})

test('unbound image view is explicit and performs no external URL fetch or inferred binding', () => {
  const html = renderToStaticMarkup(createElement(ResearchRecordMedia, { raw: { url: 'https://untrusted.invalid/image.png' }, scope: { runtimeId: 'codex', threadId: 's', workspaceRoot: '/science' }, invoker: { invoke: async () => assert.fail('not during render') } as never }))
  assert.match(html, /未提供可核对/); assert.doesNotMatch(html, /<img|src="https/)
})


test('phase-level failure counts and stale synthesis remain visible in compact rows', () => {
  const phase = { ...node(), kind: 'phase' as const, counts: { rounds: 5, failedRounds: 2, events: 18 }, synthesisStatus: 'stale' as const }
  assert.deepEqual(compactRecord(phase).alerts, ['失败/中断轮次 2', '摘要待更新'])
  const html = renderToStaticMarkup(createElement(ResearchRecordCompact, { scope: { runtimeId: 'codex', threadId: 'fixture', workspaceRoot: '/science' }, componentId: 'fixture', active: false, view: { revision: 1, totalChildren: 1, children: [phase] } as ResearchRecordView, presentation: createResearchRecordPresentation(), onNavigate: () => undefined }))
  assert.match(html, /data-tone="check"/)
})
