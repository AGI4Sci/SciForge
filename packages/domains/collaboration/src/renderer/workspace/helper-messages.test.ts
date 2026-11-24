import assert from 'node:assert/strict'
import { test } from 'node:test'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { helperMessages } from './helper-messages.js'
import { workspaceTranslationResources, translateWorkspace } from './workspace-i18n.js'
import { offerAvailabilityPresentation } from './offer-availability.js'
import { collaborationFailure } from './collaboration-errors.js'
import { taskActivityItems } from './task-activity.js'
import { formatWorkspaceTime } from './format-time.js'

test('workspace helpers translate explicit UI copy and preserve task and error evidence', async () => {
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'zh', resources: {
    en: { common: workspaceTranslationResources(helperMessages, 'en') },
    zh: { common: workspaceTranslationResources(helperMessages, 'zh') }
  } })
  const availability = offerAvailabilityPresentation({ state: 'available' } as never)
  assert.equal(availability.label, '待你接受')
  assert.match(availability.detail, /After acceptance/u)
  assert.equal(formatWorkspaceTime(''), 'Time pending sync')
  assert.equal(collaborationFailure(new Error('invalid_state_transition: task changed')).message, 'The task status changed. Refresh and try again')
  const unknown = 'user supplied error: 保留原文'
  assert.deepEqual(collaborationFailure(new Error(unknown)), { message: unknown, detail: unknown })
  const summary = '用户任务内容不翻译'
  const item = taskActivityItems([{ actorDisplayName: '张三', event: { taskId: 'task1', kind: 'comment', payload: { summary }, occurredAt: '2026-11-09T00:00:00Z' } }] as never, 'task1')[0]
  assert.equal(item?.actor, '张三')
  assert.equal(item?.text, summary)
  assert.equal(translateWorkspace('协作任务 {{reference}} · 返回交付草稿', { reference: '#3' }), 'Collaboration task #3 · Return to delivery draft')
  await i18n.changeLanguage('zh')
  assert.equal(offerAvailabilityPresentation({ state: 'available' } as never).label, '待你接受')
  assert.equal(formatWorkspaceTime(''), '时间待同步')
})
