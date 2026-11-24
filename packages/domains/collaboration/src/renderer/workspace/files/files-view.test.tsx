import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilesView } from './FilesView.js'

for (const [source, label] of [['member', '成员添加'], ['attachment', '会话附件'], ['ai', 'AI 产出']] as const) {
  test(`sealed required ${source} file retains its authoritative source label`, () => {
    const html = renderToStaticMarkup(<FilesView loading={false} onPreview={() => undefined} groups={[{
      id: 'delivery', title: '任务交付', empty: '', files: [{ key: 'data', name: 'data.csv', mediaType: 'text/csv',
        byteCount: 8, revision: 1, submitter: null, submittedAt: null, descriptor: null, role: 'declared', source }]
    }]} />)
    assert.ok(html.includes(`必交 · ${label}`))
    if (source !== 'ai') assert.ok(!html.includes('AI 产出'))
  })
}
