import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { getI18n, setI18n } from 'react-i18next'
import { workspaceTranslationResources } from '../workspace-i18n.js'
import { deliveryMessages } from './messages.js'
import { DeliveryTotal } from './DeliveryContent.js'
import { DeliveryMaterialPicker } from './DeliveryMaterialPicker.js'
import { DeliveryDraft } from './DeliveryDraft.js'
import { TaskContentEditor } from './TaskContentEditor.js'

test('delivery and task edit UI follow the host language while preserving user content', async () => {
  const previous = getI18n()
  const instance = createInstance()
  await instance.init({ lng: 'en', fallbackLng: 'zh', ns: ['common'], defaultNS: 'common', interpolation: { escapeValue: false }, resources: {
    en: { common: workspaceTranslationResources(deliveryMessages, 'en') },
    zh: { common: workspaceTranslationResources(deliveryMessages, 'zh') }
  } })
  setI18n(instance)
  try {
    const element = <><TaskContentEditor content={{ title: '用户原文标题', objective: '用户原文要求', completionCriteria: ['用户验收标准'] }} pending={{ title: '用户原文标题', objective: '用户原文要求', completionCriteria: ['用户验收标准'] }} canDecide busy={false} onSave={async () => true} onDecide={() => {}} /><DeliveryDraft data={{ revision: 2, state: 'ready', summary: '用户结果不翻译', declaredFiles: [{ id: 'output', name: 'result.txt', relativePath: 'result.txt', mediaType: 'text/plain', byteCount: 42, maxBytes: 999, source: 'member' }] }} onSubmit={() => {}} /></>
    const english = renderToStaticMarkup(element)
    const limits = renderToStaticMarkup(<><DeliveryTotal files={[]} /><DeliveryMaterialPicker requiredOutput={{ id: 'required', name: 'data.csv', relativePath: 'data.csv', mediaType: 'text/csv', byteCount: 0, maxBytes: 999, source: 'member' }} declaredFiles={[]} additionalFiles={[]} selection={{ files: [] }} onConfirm={() => undefined} onClose={() => undefined} /></>)
    assert.match(limits, /Up to 200 MiB per file and 20 files/)
    assert.match(limits, /Larger server delivery capacity has not been confirmed enabled/)
    assert.match(limits, /effective task limit: 999 bytes; local import limit: 999 bytes/)
    assert.doesNotMatch(limits, /单文件最多|任务有效上限|本机导入上限|必交文件不能为空/)
    assert.match(english, /Delivery draft/)
    assert.match(english, /Version 2 draft/)
    assert.doesNotMatch(english, /Version 2 version|第 2/)
    assert.match(english, /Approve changes/)
    assert.match(english, /Result summary/)
    assert.match(english, /Effective local limit: 999 B/)
    assert.doesNotMatch(english, /本地有效上限/)
    assert.match(english, /用户结果不翻译/)
    assert.match(english, /用户原文要求/)
    assert.doesNotMatch(english, /交付草稿|批准变更|结果说明/)
    await instance.changeLanguage('zh')
    const chinese = renderToStaticMarkup(element)
    assert.match(chinese, /交付草稿/)
    assert.match(chinese, /本地有效上限 999 B/)
    assert.match(chinese, /批准变更/)
    assert.match(chinese, /用户结果不翻译/)
  } finally { setI18n(previous) }
})
