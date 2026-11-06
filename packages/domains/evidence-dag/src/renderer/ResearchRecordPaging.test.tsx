import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchRecordPaging } from './ResearchRecordPaging'
import { createResearchRecordPresentation, recordPageKey } from './research-record-presentation'

test('server position uses the owner cursor, returns to known pages and preserves drafts across scopes', () => {
  const p = createResearchRecordPresentation()
  const key = recordPageKey('phase', { text: 'negative' }, 48, 20)
  p.nextPage(key, 'opaque-owner-cursor-A', 100)
  p.nextPage(key, 'opaque-owner-cursor-A', 100)
  assert.equal(p.getSnapshot().pages[key].previous.length, 1, 'repeated clicks before a read completes do not duplicate return positions')
  p.nextPage(key, 'opaque-owner-cursor-B', 200)
  p.draftField('phase', 'summary', 'unsaved')
  p.navigate('phase'); p.navigate('source'); p.back()
  assert.equal(p.getSnapshot().pages[key].cursor, 'opaque-owner-cursor-B')
  p.previousPage(key)
  assert.equal(p.getSnapshot().pages[key].cursor, 'opaque-owner-cursor-A')
  p.previousPage(key)
  assert.equal(p.getSnapshot().pages[key].cursor, undefined)
  assert.notEqual(key, recordPageKey('other', { text: 'negative' }, 48, 20))
  assert.notEqual(key, recordPageKey('phase', { text: 'other' }, 48, 20))
  p.resetPage(key)
  assert.equal(p.getSnapshot().fieldDrafts.phase.summary, 'unsaved')
})

test('server paging labels partial reads and disables both transitions during an active selection', () => {
  let transitions = 0
  const html = renderToStaticMarkup(createElement(ResearchRecordPaging, { label: '讨论', offset: 20, count: 20, total: 65,
    hasPrevious: true, hasNext: true, disabled: true, onPrevious: () => transitions++, onNext: () => transitions++ }))
  assert.match(html, /21–40 \/ 65/)
  assert.match(html, /其余未在本页加载/)
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2)
  assert.equal(transitions, 0)
})
