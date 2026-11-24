// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SiYuanServiceStatus } from '../editor-contract.js'
import { createSiYuanEditorConfigurationStore, type SiYuanEditorConfigurationStore } from './editor-configuration.js'
import { SiYuanSettingsSection } from './settings-section.js'
import type { SiYuanServiceControls } from './service-status.js'

let root: Root, container: HTMLElement, settings: SiYuanEditorConfigurationStore
let currentStatus: SiYuanServiceStatus
let service: SiYuanServiceControls
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  localStorage.clear()
  settings = createSiYuanEditorConfigurationStore()
  currentStatus = { mode: 'custom' as const, url: 'https://notes.example.test/', urlSource: 'configured', token: 'stored',
    tokenStorage: 'available', identity: { state: 'signed-in', userId: 'a', displayName: '测试账号' } }
  service = { status: vi.fn(async () => currentStatus), configure: vi.fn(async () => currentStatus), check: vi.fn(async () => ({ url: currentStatus.url!, version: '3.8.6', notebookCount: 2, verifiedRead: true as const })) }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})
const render = async () => { await act(async () => root.render(createElement(SiYuanSettingsSection, { service, settings }))) }
const input = (label: string) => Array.from(container.querySelectorAll('label'))
  .find(element => element.textContent?.trim() === label)!.querySelector('input')!
const fill = async (label: string, value: string) => {
  await act(async () => {
    const element = input(label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = async (label: string) => {
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)!.click())
}

it('shows shared service and live account details only in settings and never returns a saved token', async () => {
  await render()
  expect(container.textContent).toContain('共享空间')
  expect(container.textContent).toContain('https://notes.example.test/')
  expect(container.textContent).toContain('当前 SciForge 账号：测试账号')
  expect(input('API 令牌').type).toBe('password')
  expect(input('API 令牌').value).toBe('')
  currentStatus = { ...currentStatus, identity: { state: 'signed-out' } }
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(container.textContent).toContain('请登录 SciForge 云端账号后发表评论')
  expect(container.textContent).not.toContain('测试账号')
})

it('saves the address without touching a blank token and notifies the mounted editor store', async () => {
  const changed = vi.fn()
  settings.subscribe(changed)
  await render()
  await fill('服务地址', '  https://other.example.test/  ')
  await click('保存设置')
  expect(settings.getSnapshot().url).toBe('https://other.example.test/')
  expect(localStorage.getItem('sciforge.siyuan.editor')).toBeNull()
  expect(service.configure).toHaveBeenCalledWith({ mode: 'custom', url: '  https://other.example.test/  ' })
  expect(changed).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('设置已保存')
})

it('validates the address before saving a token and keeps preferences unchanged on token rejection', async () => {
  settings.save({ url: 'https://previous.example.test/' })
  await render()
  await fill('服务地址', 'file:///unsafe')
  await fill('API 令牌', 'example-test-token')
  await click('保存设置')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('HTTP 或 HTTPS')
  expect(service.configure).not.toHaveBeenCalled()
  await fill('服务地址', 'https://new.example.test/')
  vi.mocked(service.configure).mockRejectedValueOnce(new Error('存储失败'))
  await click('保存设置')
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('存储失败')
  expect(settings.getSnapshot().url).toBe('https://previous.example.test/')
  expect(localStorage.getItem('sciforge.siyuan.editor')).toBeNull()
})

it('clears the token input after a successful save and removes a stored token explicitly', async () => {
  await render()
  await fill('API 令牌', 'example-test-token')
  await click('保存设置')
  expect(service.configure).toHaveBeenLastCalledWith({ mode: 'custom', url: currentStatus.url, token: 'example-test-token' })
  expect(input('API 令牌').value).toBe('')
  expect(localStorage.getItem('sciforge.siyuan.editor')).toBeNull()
  const revision = settings.getSnapshot().revision
  vi.mocked(service.configure).mockResolvedValueOnce({ ...currentStatus, token: 'none' })
  await click('清除已保存令牌')
  expect(service.configure).toHaveBeenLastCalledWith({ token: null })
  expect(settings.getSnapshot().revision).toBe(revision + 1)
  expect(container.textContent).not.toContain('清除已保存令牌')
})

it('reloads saved configuration rather than accidentally applying an unsaved address', async () => {
  settings.save({ url: 'https://previous.example.test/' })
  await render()
  await fill('服务地址', 'https://unsaved.example.test/')
  const revision = settings.getSnapshot().revision
  await click('重新加载云服务')
  expect(settings.getSnapshot()).toEqual({ url: 'https://previous.example.test/', revision: revision + 1 })
  await click('重置输入')
  expect(input('服务地址').value).toBe(currentStatus.url)
  await fill('服务地址', '')
  await click('保存设置')
  expect(settings.getSnapshot().url).toBe('')
})

it('checks the saved service without applying unsaved input and reports actual connection errors', async () => {
  await render()
  await fill('服务地址', 'https://unsaved.test')
  await click('测试已保存的连接')
  expect(service.configure).not.toHaveBeenCalled()
  expect(service.check).toHaveBeenCalledOnce()
  expect(container.textContent).toContain('连接正常（可读取）')
  expect(container.textContent).toContain('2 个笔记本')
  vi.mocked(service.check).mockRejectedValueOnce(new Error('服务拒绝访问'))
  await click('测试已保存的连接')
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('服务拒绝访问')
  expect(container.textContent).not.toContain('连接正常（可读取）')
})

it('defaults to managed personal and project spaces and requires opting into custom credentials', async () => {
  currentStatus = { ...currentStatus, mode: 'managed' }
  await render()
  expect(container.querySelector('input[type="password"]')).toBeNull()
  expect(container.textContent).toContain('项目空间需要明确创建，仅项目当前成员可访问')
  await click('保存设置')
  expect(service.configure).toHaveBeenLastCalledWith({ mode: 'managed' })
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'custom'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(container.querySelector('input[type="password"]')).not.toBeNull()
})
