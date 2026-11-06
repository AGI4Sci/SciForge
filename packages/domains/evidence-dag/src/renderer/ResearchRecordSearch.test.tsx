import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResearchRecordSearch } from './ResearchRecordSearch'

test('search states subtree scope, recorded source status and derived-fact boundary without automatic submission', () => {
  let calls = 0
  const html = renderToStaticMarkup(createElement(ResearchRecordSearch, { query: { text: 'early failure', concern: 'failed', sourceStatus: 'unavailable' }, disabled: true, onQuery: () => calls++ }))
  assert.match(html, /搜索本范围及其后代/)
  assert.match(html, /结果不是新增事实/)
  assert.match(html, /打开时重新核对/)
  assert.match(html, /value="failed" selected=""/)
  assert.match(html, /value="unavailable" selected=""/)
  assert.equal(calls, 0)
})
