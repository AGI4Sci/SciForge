import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { getI18n, setI18n } from 'react-i18next'
import { sectionMessages } from '../section-messages.js'
import { workspaceTranslationResources } from '../workspace-i18n.js'
import { ProjectExecutionControls } from './ProjectExecutionControls.js'
import { FilesView } from '../files/FilesView.js'
import { RenameProjectDialog } from './RenameProjectDialog.js'
import type { WorkspaceViewModel } from '../workspace-view-model.js'

test('project controls follow the host language while preserving user project names', async () => {
  const previous = getI18n()
  const instance = i18next.createInstance()
  await instance.init({ lng: 'en', defaultNS: 'common', resources: { en: { common: workspaceTranslationResources(sectionMessages, 'en') }, zh: { common: workspaceTranslationResources(sectionMessages, 'zh') } } })
  setI18n(instance)
  const model = { currentUserId: 'owner', project: { project: { ownerUserId: 'owner', executionMode: 'ai_leader' } }, cards: [] } as unknown as WorkspaceViewModel
  const controls = () => renderToStaticMarkup(<ProjectExecutionControls model={model} busy={false} onMode={() => {}} onAuthorize={() => {}} onOpenResearch={() => {}} />)
  try {
    assert.match(controls(), /AI team leader/)
    assert.doesNotMatch(controls(), /人工推进|查看领队会话/)
    const name = '用户原始项目名'
    const rename = renderToStaticMarkup(<RenameProjectDialog name={name} busy={false} onCancel={() => {}} onSave={async () => {}} />)
    assert.match(rename, /Rename project/)
    assert.ok(rename.includes(name))
    const files = renderToStaticMarkup(<FilesView groups={[{ id: 'delivery', title: '任务交付', empty: '', files: [{ key: 'file', name: '用户原始文件.csv', mediaType: 'text/csv', byteCount: 4, revision: 3, submitter: null, submittedAt: null, descriptor: null }] }]} loading={false} onPreview={() => {}} />)
    assert.match(files, /Version 3/)
    assert.ok(files.includes('用户原始文件.csv'))
    assert.doesNotMatch(files, /第|版/)

    await instance.changeLanguage('zh')
    assert.match(controls(), /人工推进/)
    assert.doesNotMatch(controls(), /Human-led/)
  } finally { setI18n(previous) }
})
