// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useSiYuanLocale } from './locale.js'

let language = 'zh'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language } }) }))

it.each([
  ['zh', 'space_not_ready', '请查看创建状态'],
  ['en', 'space_not_ready', 'Check its provisioning status'],
  ['zh', 'identity_required', '请先登录 SciForge'],
  ['en', 'identity_required', 'Sign in to SciForge'],
  ['zh', 'space_required', '请选择个人空间'],
  ['en', 'space_required', 'Choose your personal space'],
  ['zh', 'forbidden', '没有该空间的操作权限'],
  ['en', 'forbidden', 'permission for this space operation']
])('renders actionable %s guidance for %s', async (locale, code, expected) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  language = locale
  const container = document.createElement('div')
  const root = createRoot(container)
  function ErrorMessage() {
    const { errorText } = useSiYuanLocale()
    return createElement('p', null, errorText(new Error(`Handler failed: ${code}`)))
  }
  try {
    await act(async () => root.render(createElement(ErrorMessage)))
    expect(container.textContent).toContain(expected)
    expect(container.textContent).not.toContain('Handler')
  } finally { await act(async () => root.unmount()) }
})
