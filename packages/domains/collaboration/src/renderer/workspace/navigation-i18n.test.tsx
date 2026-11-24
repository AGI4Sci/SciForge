import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { getI18n, setI18n } from 'react-i18next'
import { navigationMessages, navigationContextMessages } from './navigation-messages.js'
import { workspaceTranslationResources } from './workspace-i18n.js'
import { ProjectHeader } from './project-header/ProjectHeader.js'
import { ProjectBoard } from './project-board/ProjectBoard.js'
import { PersonalList } from './personal/PersonalList.js'
import { AssignmentAlert } from './assignment-alert/AssignmentAlert.js'
import { ProjectSidebar } from './project-sidebar/ProjectSidebar.js'
import type { TaskCardModel } from './workspace-types.js'

test('navigation follows host language, preserving user content and task status semantics', async () => {
  const previous = getI18n()
  const instance = i18next.createInstance()
  await instance.init({ lng: 'en', defaultNS: 'common', resources: { en: { common: { ...workspaceTranslationResources(navigationMessages, 'en'), ...navigationContextMessages.en } }, zh: { common: { ...workspaceTranslationResources(navigationMessages, 'zh'), ...navigationContextMessages.zh } } } })
  setI18n(instance)
  const card: TaskCardModel = { id: 'task-1', reference: '#1', moduleType: '需求模块', title: '研究用户文本', assignee: '成员本人', date: '待派出', status: 'in-progress', stateLabel: '等待决定' }
  const board = () => renderToStaticMarkup(<ProjectBoard cards={[card]} selectedCardId={null} canAssign />)
  try {
    const header = renderToStaticMarkup(<ProjectHeader initials="研" name="研究用户项目" memberCount={2} status="active" progress={{ adopted: 1, total: 3 }} />)
    assert.match(header, /Research chat/)
    assert.match(header, />Members</)
    assert.match(header, /2 members/)
    assert.match(renderToStaticMarkup(<ProjectHeader initials="R" name="Research" memberCount={1} status="draft" />), /1 member/)
    assert.match(header, /Adopted 1\/3/)
    assert.match(header, /研究用户项目/)
    const englishBoard = board()
    assert.match(englishBoard, /Awaiting decision/)
    assert.match(englishBoard, /Assign task/)
    assert.doesNotMatch(englishBoard, /分配任务/)
    assert.match(englishBoard, /tone-warning/)
    assert.match(englishBoard, /研究用户文本/)
    assert.match(englishBoard, /成员本人/)
    assert.doesNotMatch(englishBoard, /暂无任务|待派出|等待决定/)
    const inbox = renderToStaticMarkup(<PersonalList title="收件箱" subtitle="" items={[]} onOpen={() => {}} />)
    assert.match(inbox, /Inbox/)
    assert.match(inbox, /New invitations, questions, and deliveries/)
    const alert = renderToStaticMarkup(<AssignmentAlert count={1} titles={[card.title]} canAcceptAll />)
    assert.match(alert, /is awaiting your acceptance/)
    assert.match(alert, /Accept all/)
    assert.match(alert, /研究用户文本/)
    const sidebar = renderToStaticMarkup(<ProjectSidebar projects={[]} />)
    assert.match(sidebar, /My work/)
    assert.match(sidebar, /Connected to cloud/)
    await instance.changeLanguage('zh')
    assert.match(board(), /等待决定/)
    assert.doesNotMatch(board(), /Awaiting decision/)
  } finally { setI18n(previous) }
})
