import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { groupLineReviews, lineReviewList, proseTranslationView, resolveCodeAnchor } from '../src/ui/line-review.js'
import { researchThread } from './fixtures.js'
import type { ProseTranslation } from '../src/core/contract.js'

function thread(id: string, filePath = 'src/a.ts', line = 2, side: 'old' | 'new' = 'new') {
  const value = researchThread(id)
  value.anchor.codeAnchor = { filePath, line, side, code: 'value()', baseRevision: 'abc', hunkHeader: '', contentDigest: 'a'.repeat(64) }
  return value
}
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)) }

test('grouping filters workspace/status/search and keeps sides separate without mutating source', () => {
  const a = thread('a'), b = thread('b', 'src/a.ts', 2, 'old'), c = thread('c', 'src/z.ts', 1)
  b.status = 'resolved'; c.workspaceKey = 'other'
  const source = [c, b, a], before = JSON.stringify(source)
  assert.deepEqual(groupLineReviews(source).map(file => [file.filePath, file.lines.map(line => line.side)]), [['src/a.ts', ['new', 'old']], ['src/z.ts', ['new']]])
  assert.deepEqual(groupLineReviews(source, { workspaceKey: a.workspaceKey, status: 'open', search: ' VALUE() ' })[0].lines[0].threads.map(value => value.id), ['a'])
  assert.equal(groupLineReviews(source, { search: 'missing' }).length, 0)
  assert.equal(JSON.stringify(source), before)
})

test('anchor resolution refuses missing/changed/ambiguous evidence and finds unique moved lines', () => {
  const saved = thread('a').anchor.codeAnchor!
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved }), { state: 'exact', line: 2 })
  assert.deepEqual(resolveCodeAnchor(saved), { state: 'unavailable' })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, baseRevision: 'other' }), { state: 'stale' })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, side: 'old' }), { state: 'stale' })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, filePath: 'other.ts' }), { state: 'stale' })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, line: 4, code: 'before\r\nvalue()\r\nafter' }), { state: 'moved', line: 5 })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, code: 'value()\nvalue()' }), { state: 'ambiguous' })
  assert.deepEqual(resolveCodeAnchor(saved, { ...saved, code: 'value(1)' }), { state: 'stale' })
})

test('list callbacks use exact thread identity and input filters update visible groups', async () => {
  const window = new Window(); Object.assign(globalThis, { document: window.document })
  const opened: string[] = [], a = thread('a'), b = thread('b', 'src/b.ts'); b.status = 'resolved'
  const view = lineReviewList([a, b], id => opened.push(id))
  view.root.querySelector('button')!.click(); assert.deepEqual(opened, ['a'])
  const status = view.root.querySelector('select')!; status.value = 'resolved'; status.dispatchEvent(new window.Event('change') as unknown as Event)
  assert.equal(view.root.querySelectorAll('button').length, 1)
  view.root.querySelector('button')!.click(); assert.deepEqual(opened, ['a', 'b'])
  view.update([]); assert.match(view.root.textContent!, /没有匹配/)
  await window.happyDOM.close()
})

test('translation component preserves original, labels machine text and fences disposal', async () => {
  const window = new Window(); Object.assign(globalThis, { document: window.document })
  let finish!: (result: ProseTranslation) => void, signal!: AbortSignal
  const view = proseTranslationView('Original `x`', async (_input, current) => { signal = current; return await new Promise(resolve => { finish = resolve }) })
  view.root.querySelector('button')!.click()
  finish({ original: 'Original `x`', translation: '译文 `x`', targetLanguage: 'zh-CN', machineTranslated: true, runtimeId: 'r' }); await flush()
  assert.equal(view.root.querySelector('p')!.textContent, 'Original `x`')
  assert.match(view.root.textContent!, /机器翻译 · 译文 `x`/)
  view.root.querySelector('button')!.click(); view.dispose(); assert.equal(signal.aborted, true)
  finish({ original: 'Original `x`', translation: 'late', targetLanguage: 'zh-CN', machineTranslated: true, runtimeId: 'r' }); await flush()
  assert.doesNotMatch(view.root.textContent!, /late/)
  await window.happyDOM.close()
})

test('translation view rejects a response belonging to another source', async () => {
  const window = new Window(); Object.assign(globalThis, { document: window.document })
  const view = proseTranslationView('original', async () => ({ original: 'other', translation: 'wrong', targetLanguage: 'zh-CN', machineTranslated: true, runtimeId: 'r' }))
  view.root.querySelector('button')!.click(); await flush()
  assert.match(view.root.querySelector('[role="status"]')!.textContent!, /不匹配/)
  assert.equal(view.root.querySelector('p')!.textContent, 'original')
  view.dispose(); await window.happyDOM.close()
})
