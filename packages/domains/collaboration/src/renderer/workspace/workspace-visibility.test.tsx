import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROJECT_TABS, ProjectHeader } from './project-header/ProjectHeader.js'
import { ProjectBoard } from './project-board/ProjectBoard.js'
import { PersonalList } from './personal/PersonalList.js'
import { ProjectInfoView } from './project-info/ProjectInfoView.js'
import { MembersView } from './members/MembersView.js'
import { RequirementsView } from './requirements/RequirementsView.js'

test('every member sees the project pages, while owner-only member controls stay hidden', () => {
  const header = renderToStaticMarkup(<ProjectHeader initials="PF" name="项目" memberCount={2} status="active" activeTab="board" canManage={false} />)
  assert.deepEqual(PROJECT_TABS.map((tab) => tab.label), ['研究对话', '看板', '成员', '需求', '共享文件', '项目信息'])
  for (const label of ['研究对话', '看板', '成员', '需求', '共享文件', '项目信息']) assert.match(header, new RegExp(label, 'u'))
  assert.doesNotMatch(header, /项目设置/u)
  const model = { currentProject: { initials: 'PF', name: '项目', memberCount: 2, status: 'active', description: '', requirementsRevision: 1, ownerName: 'Owner', ownerUserId: 'usr_owner0000001' }, projectId: 'prj_worker0000001', members: [], currentUserId: 'usr_worker0000001', project: { project: { ownerUserId: 'usr_owner0000001' } } } as never
  const members = renderToStaticMarkup(<MembersView model={model} busy={false} onAddMember={() => undefined} />)
  assert.match(members, /项目成员/u)
  assert.doesNotMatch(members, /添加成员/u)
  const info = renderToStaticMarkup(<ProjectInfoView model={model} />)
  assert.match(info, /项目信息/u)
  assert.match(info, /项目名称/u)
  assert.doesNotMatch(info, /添加成员|移除/u)
})

test('empty board and inbox render explicit empty states', () => {
  const board = renderToStaticMarkup(<ProjectBoard cards={[]} selectedCardId="empty" />)
  const inbox = renderToStaticMarkup(<PersonalList title="收件箱" subtitle="" items={[]} onOpen={() => undefined} />)
  assert.match(board, /暂无任务/u)
  assert.match(inbox, /暂时没有需要你处理的事/u)
})

test('partial requirements failure remains visible with a retry action', () => {
  const model = { projectId: 'prj_partial000001', currentUserId: 'usr_owner0000001', project: { project: { ownerUserId: 'usr_owner0000001', status: 'draft' } }, requirements: { revision: 2, documentRevision: 2, state: 'draft', goalsDeliverables: '目标', inputsBoundaries: '边界', workModules: [], acceptanceCriteria: [], confirmed: false, completion: { state: 'failed', reason: 'runtime_execution_failed', failedAt: '2026-10-20T05:00:00.000Z' } }, currentProject: { initials: 'P', name: '部分失败项目', memberCount: 1, status: 'draft', description: '', requirementsRevision: 2, ownerName: '' } } as never
  const html = renderToStaticMarkup(<RequirementsView model={model} busy={false} onSave={() => undefined} onComplete={() => undefined} onConfirm={() => undefined} />)
  assert.match(html, /补全失败：本地 Agent Runtime 执行失败，请重试/u)
  assert.match(html, /AI 补全/u)
})

test('only the owner sees the draft requirements action in the project header', () => {
  const owner = renderToStaticMarkup(<ProjectHeader initials="PF" name="项目" memberCount={1} status="draft" canManage primaryActionLabel="编辑需求" />)
  const worker = renderToStaticMarkup(<ProjectHeader initials="PF" name="项目" memberCount={1} status="draft" canManage={false} primaryActionLabel="编辑需求" />)
  assert.match(owner, /编辑需求/u)
  assert.doesNotMatch(worker, /编辑需求/u)
})
