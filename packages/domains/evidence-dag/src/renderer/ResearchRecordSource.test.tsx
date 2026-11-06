import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchRecordSource, researchRecordSourceContent, researchRecordSourceNavigation } from './ResearchRecordSource'
import type { ResearchRecordView } from '../research-record-contract'
import { researchRecordSourceFacts, readableRecordOutput, sourceTextPage, SOURCE_TEXT_PAGE } from './research-record-source-content'
import { createResearchRecordPresentation, createResearchRecordPresentationRegistry } from './research-record-presentation'

const scope = { runtimeId: 'codex', threadId: 'original-record', workspaceRoot: '/science' }
const source = { ...scope, runtimeId: 'claude', threadId: 'source-session', turnId: 'turn-7', itemId: 'item-8', digest: 'a'.repeat(64) }
const view = { node: { id: 'event-1', source }, sourceStatus: 'current', raw: { kind: 'user_message', text: 'Readable original message', id: 'item-8' } } as ResearchRecordView

test('retained historical bytes remain readable with unavailable live source and separate judgment axes', () => {
  const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, sourceStatus: 'unavailable', retainedSource: 'retained', rawOrigin: 'retained' }, busy: false, onOpen: () => undefined }))
  assert.match(html, /Readable original message/)
  assert.match(html, /来源不可用/); assert.match(html, /当时保全原文/)
  assert.match(html, /不代表科研结论已验证/)
})

test('default detail shows readable content and keeps coordinates/raw JSON in closed details', () => {
  const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view, busy: false, onOpen: () => undefined }))
  assert.ok(html.indexOf('Readable original message') < html.indexOf('<details>'))
  assert.match(html, /查看原始过程/)
  assert.match(html, /<details><summary[^>]*>技术字段与原始 JSON/)
  assert.doesNotMatch(html, /<details open/)
  assert.ok(!html.includes(source.digest), 'closed JSON is not mounted')
})

test('command and failed result remain readable; changed/unavailable states are explicit', () => {
  assert.deepEqual(researchRecordSourceContent({ arguments: { command: 'python compare.py' }, detail: 'exit 7: missing input' }), [
    { label: '命令', text: 'python compare.py' }, { label: '结果', text: 'exit 7: missing input' }
  ])
  for (const status of ['changed', 'unavailable'] as const) {
    const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, sourceStatus: status }, busy: false, onOpen: () => undefined }))
    assert.match(html, status === 'changed' ? /来源已变化/ : /来源不可用/)
  }
})

test('side and global origins return to the original presentation while opening the exact foreign source', () => {
  const registry = createResearchRecordPresentationRegistry()
  const presentation = registry(scope)
  presentation.navigate('phase')
  presentation.toggle('step')
  presentation.rememberScroll('phase', 412)
  const before = presentation.getSnapshot()
  for (const surface of ['right-panel', 'global-overlay'] as const) {
    const request = researchRecordSourceNavigation(scope, view, surface)!
    assert.equal(request.threadId, source.threadId)
    assert.equal(request.runtimeId, source.runtimeId)
    assert.equal(request.turnId, source.turnId)
    assert.equal(request.itemId, source.itemId)
    assert.equal(request.readOnly, true)
    assert.equal(request.focusComposer, false)
    assert.equal(request.returnTo?.presentation, surface)
    assert.deepEqual(request.returnTo?.session, { runtimeId: scope.runtimeId, threadId: scope.threadId })
    assert.deepEqual(request.returnTo?.activation?.payload, { recordScope: scope })
    assert.equal(registry(scope).getSnapshot(), before)
  }
  assert.equal(researchRecordSourceNavigation(scope, { ...view, node: null }, 'right-panel'), null)
})


test('embedded research source returns to its owning surface while global return carries that owner', () => {
  const scope = { runtimeId: 'codex', threadId: 'main', workspaceRoot: '/lab' }
  const source = { ...scope, turnId: 'turn-1', itemId: 'item-1', digest: 'a'.repeat(64) }
  const view = { node: { source } } as Parameters<typeof researchRecordSourceNavigation>[1]
  const side = researchRecordSourceNavigation(scope, view, 'right-panel', 'fixture.research-owner')
  assert.equal(side?.returnTo?.contributionId, 'fixture.research-owner')
  assert.deepEqual(side?.returnTo?.activation?.payload, { recordScope: scope, returnContributionId: 'fixture.research-owner' })
  const global = researchRecordSourceNavigation(scope, view, 'global-overlay', 'fixture.research-owner')
  assert.equal(global?.returnTo?.presentation, 'global-overlay')
  assert.deepEqual(global?.returnTo?.activation?.payload, { recordScope: scope, returnContributionId: 'fixture.research-owner' })
})


test('source extraction preserves PowerShell/bash bytes and parses JSON arguments without inventing execution facts', () => {
  const command = 'Write-Output "你好"\r\nGet-Content .\\sample.txt\r\n'
  const raw = { kind: 'tool', status: 'failed', meta: { command, cwd: 'F:\\science', shell: 'pwsh', exitCode: 7 }, detail: '\u001b[31mmissing input\u001b[0m' }
  const before = JSON.stringify(raw)
  assert.equal(researchRecordSourceFacts(raw).command, command)
  assert.equal(researchRecordSourceFacts(raw).exitCode, 7)
  assert.equal(researchRecordSourceFacts(raw).workdir, 'F:\\science')
  assert.equal(researchRecordSourceContent(raw).find(entry => entry.label === '结果')?.text, raw.detail)
  assert.equal(readableRecordOutput(raw.detail), 'missing input')
  assert.equal(JSON.stringify(raw), before)
  assert.equal(researchRecordSourceFacts({ arguments: JSON.stringify({ cmd: 'printf "a\\nb"\nfalse', workdir: '/lab', shell: '/bin/bash' }) }).command, 'printf "a\\nb"\nfalse')
  assert.equal(researchRecordSourceFacts({ arguments: 'broken JSON', summary: 'echo invented' }).command, undefined)
  assert.equal(researchRecordSourceFacts({ summary: 'exit=0', detail: 'exit=7' }).exitCode, undefined)
  assert.equal(researchRecordSourceFacts({ status: 'cancelled' }).exitCode, undefined)
})

test('failed/cancelled, truncated and changed states remain visible with all output/JSON folded', () => {
  for (const status of ['failed', 'cancelled']) {
    const raw = { status, arguments: JSON.stringify({ cmd: 'false' }), exitCode: 7, detail: 'HIDDEN_OUTPUT'.repeat(3000), truncated: true }
    const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, sourceStatus: 'changed', raw }, busy: false, onOpen: () => undefined }))
    assert.match(html, /来源已变化/)
    assert.match(html, status === 'failed' ? /失败/ : /已取消/)
    assert.match(html, /退出码 7/)
    assert.match(html, /来源已截断/)
    assert.match(html, /复制命令/)
    assert.doesNotMatch(html, /HIDDEN_OUTPUT/)
    assert.ok(html.length < 6000)
  }
})

test('opened output remains bounded and every source character is reachable in pages', () => {
  const raw = 'HEAD' + 'x'.repeat(22000) + 'TAIL'
  const pages = Array.from({ length: sourceTextPage(raw, 0).pages }, (_, page) => sourceTextPage(raw, page).text)
  assert.equal(pages.join(''), raw)
  assert.ok(pages.every(page => page.length <= SOURCE_TEXT_PAGE))
  const presentation = createResearchRecordPresentation()
  presentation.toggle('source:event-1:results')
  const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, raw: { detail: raw } }, presentation, busy: false, onOpen: () => undefined }))
  assert.match(html, /HEAD/)
  assert.doesNotMatch(html, /TAIL/)
  assert.match(html, /分段阅读/)
})

test('unavailable source keeps coordinates and cannot display stale raw as current evidence', () => {
  const presentation = createResearchRecordPresentation()
  presentation.toggle('source:event-1:json')
  const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, raw: undefined, sourceStatus: 'unavailable' }, presentation, busy: false, onOpen: () => undefined }))
  assert.match(html, /来源不可用/)
  assert.match(html, new RegExp(source.digest))
  assert.match(html, /查看原始过程/)
})

test('source group navigation leaves stage focus, folds and reading position intact', () => {
  const presentation = createResearchRecordPresentation()
  presentation.navigate('phase')
  presentation.toggle('round')
  presentation.rememberScroll('phase', 300)
  presentation.inspect('event-1', ['event-1', 'event-2'], '未决问题')
  presentation.update({ selectedId: 'event-2' })
  assert.equal(presentation.getSnapshot().focusId, 'phase')
  assert.deepEqual(presentation.getSnapshot().inspection, { ids: ['event-1', 'event-2'], title: '未决问题' })
  assert.ok(presentation.getSnapshot().expanded.has('round'))
  assert.equal(presentation.getSnapshot().scrollPositions.phase, 300)
})


test('changed current success never hides an earlier recorded failure', () => {
  const html = renderToStaticMarkup(createElement(ResearchRecordSource, { view: { ...view, node: { ...view.node!, status: 'failed' }, sourceStatus: 'changed', raw: { status: 'success', command: 'true', exitCode: 0 } }, busy: false, onOpen: () => undefined }))
  assert.match(html, /来源状态：成功/)
  assert.match(html, /此前记录状态：失败/)
})


test('inspection membership is normalized and every exit clears the obsolete group', () => {
  const presentation = createResearchRecordPresentation()
  presentation.inspect('event-2', ['event-1', 'event-1'], 'group')
  assert.deepEqual(presentation.getSnapshot().inspection?.ids, ['event-2', 'event-1'])
  presentation.closeInspection()
  assert.equal(presentation.getSnapshot().selectedId, null)
  assert.equal(presentation.getSnapshot().inspection, null)
  presentation.inspect('event-1', ['event-1', 'event-2'])
  presentation.navigate('phase')
  assert.equal(presentation.getSnapshot().inspection, null)
  presentation.inspect('event-2', [])
  presentation.focusSource('event-2')
  assert.equal(presentation.getSnapshot().inspection, null)
  assert.equal(presentation.getSnapshot().sourceReturnId, 'phase')
  presentation.inspect('event-2', ['event-2'])
  presentation.focusSource('event-2')
  assert.equal(presentation.getSnapshot().selectedId, null)
  assert.equal(presentation.getSnapshot().inspection, null)
  assert.equal(presentation.getSnapshot().sourceReturnId, 'phase')
})

test('review mode, disclosure and pagination share the existing scope registry independently', () => {
  const registry = createResearchRecordPresentationRegistry()
  const side = registry(scope)
  const key = JSON.stringify([scope.workspaceRoot, 'root'])
  side.reviewScope(key)
  side.setReview(key, { mode: 'attention', open: true, expanded: true, offset: 20, through: 43 })
  const global = registry({ ...scope })
  assert.deepEqual(global.reviewScope(key, 44), { baseline: 0, mode: 'attention', open: true, expanded: true, offset: 20, through: 43 })
  const otherKey = JSON.stringify([scope.workspaceRoot, 'phase'])
  assert.deepEqual(global.reviewScope(otherKey), { baseline: 0, mode: 'changes', open: false, expanded: false, offset: 0 })
  assert.equal(registry({ ...scope, threadId: 'other' }).reviewScope(key).open, false)
  assert.equal(registry({ ...scope, runtimeId: 'claude' }).reviewScope(key).open, false)
  assert.equal(registry({ ...scope, workspaceRoot: '/other' }).reviewScope(key).open, false)
  global.setReview(key, { open: false })
  assert.equal(side.getSnapshot().review[key].open, false)
  assert.equal(side.getSnapshot().review[key].expanded, true)
})
