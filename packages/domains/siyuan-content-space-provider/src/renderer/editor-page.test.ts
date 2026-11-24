import type { CloudSpace } from '@sciforge/cloud-spaces-contracts'
// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { SiYuanEditorPage } from './editor-page.js'
import { createSiYuanEditorConfigurationStore, type SiYuanEditorConfigurationStore } from './editor-configuration.js'
import type { SiYuanServiceControls } from './service-status.js'
import { useNativeSiYuanPresentation } from './native-siyuan-presentation.js'

let language = 'zh'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language } }) }))
vi.mock('./native-siyuan-presentation.js', () => ({ useNativeSiYuanPresentation: vi.fn() }))
let root: Root, container: HTMLElement
let settings: SiYuanEditorConfigurationStore
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  language = 'zh'
  vi.useFakeTimers()
  localStorage.clear()
  settings = createSiYuanEditorConfigurationStore()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
  vi.useRealTimers()
})
const context = { active: true, className: '' } as ComponentProps<typeof SiYuanEditorPage>['context']
const open = async () => ({ url: 'https://notes.example.test/' })
const present = async () => undefined
const status = (identity: CurrentUserProfile) => ({ mode: 'custom' as const, url: 'https://notes.example.test/',
  urlSource: 'configured' as const, token: 'none' as const, tokenStorage: 'available' as const, identity })
const key = () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].sessionKey

it('keeps account isolation without displaying account or connection bars in the editor', async () => {
  let identity: CurrentUserProfile = { state: 'signed-in', userId: 'a', displayName: '同名' }
  let fails = false
  const service: SiYuanServiceControls = { status: vi.fn(async () => {
    if (fails) throw new Error('offline')
    return status(identity)
  }), configure: vi.fn(), check: vi.fn() }
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open, present, service, settings })))
  expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('云服务')
  expect(container.querySelector('header, [data-siyuan-shared-identity], [role="dialog"]')).toBeNull()
  expect(container.textContent).not.toContain('当前 SciForge 账号')
  expect(container.textContent).not.toContain('https://notes.example.test/')
  expect(key()).toBe('user:a')
  identity = { state: 'signed-in', userId: 'a', displayName: '改名' }
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(container.textContent).not.toContain('改名')
  expect(key()).toBe('user:a')
  identity = { state: 'signed-in', userId: 'b', displayName: '同名' }
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(key()).toBe('user:b')
  identity = { state: 'signed-out' }
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(key()).toBe('signed-out')
  expect(container.textContent).not.toContain('请登录 SciForge 云端账号后发表评论')
  fails = true
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(key()).toBe('unavailable')
  expect(container.textContent).not.toContain('当前 SciForge 账号')
})

it('serializes slow status reads and ignores a result after the page becomes inactive', async () => {
  let complete!: (value: ReturnType<typeof status>) => void
  const read = vi.fn(() => new Promise<ReturnType<typeof status>>(resolve => { complete = resolve }))
  const service = { status: read, configure: vi.fn(), check: vi.fn() }
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open, present, service, settings })))
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(read).toHaveBeenCalledOnce()
  await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, active: false }, open, present, service, settings })))
  await act(async () => { complete(status({ state: 'signed-in', userId: 'old', displayName: '过期身份' })) })
  expect(container.textContent).not.toContain('过期身份')
  expect(vi.getTimerCount()).toBe(0)
})

it('uses saved settings when returning to a mounted editor and supports reload of the same address', async () => {
  const openEditor = vi.fn(async () => ({ url: 'https://notes.example.test/' }))
  const service = { status: vi.fn(async () => status({ state: 'signed-out' })), configure: vi.fn(), check: vi.fn() }
  const props = { context, open: openEditor, present, service, settings }
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  await act(async () => root.render(createElement(SiYuanEditorPage, { ...props, context: { ...context, active: false } })))
  await act(async () => settings.save({ url: 'https://other.example.test/' }))
  expect(openEditor).toHaveBeenCalledTimes(1)
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  expect(openEditor).toHaveBeenLastCalledWith()
  await act(async () => settings.reload())
  expect(openEditor).toHaveBeenCalledTimes(3)
})


it('shows inline setup without opening an unconfigured service and connects after saving through the canonical settings', async () => {
  language = 'en'
  const openEditor = vi.fn(open)
  let configured: string | null = null
  const readStatus = () => ({ mode: 'custom' as const, url: configured, urlSource: configured ? 'configured' as const : 'none' as const,
    token: 'none' as const, tokenStorage: 'available' as const, identity: { state: 'signed-out' as const } })
  const service: SiYuanServiceControls = {
    status: vi.fn(async () => readStatus()),
    configure: vi.fn(async input => { configured = input.url ?? null; return readStatus() }), check: vi.fn()
  }
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, present, service, settings })))
  expect(openEditor).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Connect cloud services')
  expect(container.textContent).not.toContain('Handler')
  expect(container.textContent).not.toContain('云服务')
  const input = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Service address')!.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://notes.example.test/')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save settings')!.click())
  expect(service.configure).toHaveBeenCalledWith({ mode: 'custom' as const, url: 'https://notes.example.test/' })
  expect(openEditor).toHaveBeenCalledOnce()
  expect(container.querySelector('[data-siyuan-editor-slot]')).not.toBeNull()
})

it('offers connection settings in the selected language after a configured service fails', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => status({ state: 'signed-out' })), configure: vi.fn(), check: vi.fn() }
  await act(async () => root.render(createElement(SiYuanEditorPage, { context,
    open: async () => { throw new Error('Handler siyuan.editor.open failed provider_unavailable') }, present, service, settings })))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Cannot reach the service')
  expect(container.textContent).not.toContain('Handler')
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Connection settings')!.click())
  expect(container.querySelector('input[type="password"]')).not.toBeNull()
})


const fixtureCache = new WeakMap<() => Promise<readonly { projectId: string; name: string }[]>, { spaces: () => Promise<CloudSpace[]>; ensure: () => Promise<CloudSpace> }>()
function spaceFixture(projects: () => Promise<readonly { projectId: string; name: string }[]>) {
  let fixture = fixtureCache.get(projects)
  if (!fixture) {
    const spaces = async (): Promise<CloudSpace[]> => (await projects()).map((project, index) => ({
      spaceId: project.projectId, scope: index === 0 ? { kind: 'personal', ownerUserId: 'a' } : { kind: 'project', projectId: project.projectId },
      status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z'
    }))
    fixture = { spaces, ensure: async () => (await spaces())[0] }
    fixtureCache.set(projects, fixture)
  }
  return fixture
}

it('keeps a presented editor ready when the selected space does not change', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = vi.fn(async () => [{ projectId: 'project-a', name: 'Paper A' }])
  const openEditor = vi.fn(open)
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  await act(async () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].onReady())
  expect(container.querySelector('[role="status"]')).toBeNull()
  await act(async () => {
    container.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(openEditor).toHaveBeenCalledOnce()
})

it('selects a ready personal space and never opens the custom installation URL in managed mode', async () => {
  language = 'en'
  let identity: CurrentUserProfile = { state: 'signed-in', userId: 'a', displayName: 'A' }
  const service = { status: vi.fn(async () => ({ ...status(identity), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = vi.fn(async () => [{ projectId: 'project-a', name: 'Paper A' }, { projectId: 'project-b', name: 'Paper B' }])
  const openEditor = vi.fn(async (input?: { spaceId?: string }) => ({ url: `https://${input?.spaceId}.notes.example.test/` }))
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  expect(openEditor).toHaveBeenCalledWith({ spaceId: 'project-a' })
  expect(container.textContent).toContain('Personal space')
  expect(container.querySelector('input[type="password"]')).toBeNull()
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'project-a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(openEditor).toHaveBeenLastCalledWith({ spaceId: 'project-a' })
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBe('https://project-a.notes.example.test/')
  identity = { state: 'signed-out' }
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBeNull()
  expect(container.textContent).toContain('Sign in to SciForge')
})

it('discards a late managed project session after switching projects', async () => {
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }, { projectId: 'b', name: 'B' }]
  let completeA!: (session: { url: string }) => void
  const openEditor = vi.fn(async (input?: { spaceId?: string }) => input?.spaceId === 'a'
    ? new Promise<{ url: string }>(resolve => { completeA = resolve }) : { url: 'https://b.notes.example.test/' })
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => completeA({ url: 'https://a.notes.example.test/' }))
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBe('https://b.notes.example.test/')
})

it('shows an actionable managed directory failure and retries without falling back to a custom service', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = vi.fn(async () => { throw new Error('cloud_unavailable') })
  const openEditor = vi.fn(open)
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('cloud connection')
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!.click())
  expect(projects).toHaveBeenCalledTimes(4)
  expect(openEditor).not.toHaveBeenCalled()
})

it('recovers provisioning polling and project names after temporary read failures', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'personal', scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const project: CloudSpace = { ...personal, spaceId: 'project', scope: { kind: 'project', projectId: 'heart' }, status: 'provisioning' }
  const spaces = vi.fn().mockResolvedValueOnce([personal, project]).mockRejectedValueOnce(new Error('provider_unavailable')).mockResolvedValue([personal, { ...project, status: 'ready' }])
  const projects = vi.fn().mockRejectedValueOnce(new Error('authority_unverified')).mockResolvedValue([{ projectId: 'heart', name: 'Heart Disease', canCreate: true }])
  const ensure = vi.fn()
  const openEditor = vi.fn(open)
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, spaces, projects, ensure, present, service, settings })))
  await act(async () => { const select = container.querySelector('select')!; select.value = 'project'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  expect(container.textContent).toContain('Heart Disease')
  expect(openEditor).toHaveBeenLastCalledWith({ spaceId: 'project' })
  expect(ensure).not.toHaveBeenCalled()
})

it('bounds failed read retries and cancels them when the panel closes', async () => {
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const spaces = vi.fn(async () => { throw new Error('provider_unavailable') })
  const projects = vi.fn(async () => { throw new Error('provider_unavailable') })
  const ensure = vi.fn()
  const props = { context, open, spaces, projects, ensure, present, service, settings }
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(spaces).toHaveBeenCalledTimes(4)
  expect(projects).toHaveBeenCalledTimes(4)
  expect(ensure).not.toHaveBeenCalled()
  await act(async () => root.render(createElement(SiYuanEditorPage, { ...props, context: { ...context, active: false } })))
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  expect(spaces).toHaveBeenCalledTimes(5)
  await act(async () => root.render(createElement(SiYuanEditorPage, { ...props, context: { ...context, active: false } })))
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(spaces).toHaveBeenCalledTimes(5)
  expect(projects).toHaveBeenCalledTimes(5)
})

it('never automatically replays a personal space creation after its outcome is unknown', async () => {
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const spaces = vi.fn(async () => [])
  const ensure = vi.fn(async () => { throw new Error('provider_unavailable') })
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open, spaces, ensure, present, service, settings })))
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(spaces).toHaveBeenCalledOnce()
  expect(ensure).toHaveBeenCalledOnce()
})

it('ignores an old account project read when its retry completes after an account switch', async () => {
  language = 'en'
  let userId = 'a'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId, displayName: userId }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'personal', scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const spaces = vi.fn(async () => [personal])
  let complete!: (items: { projectId: string; name: string; canCreate: boolean }[]) => void
  const projects = vi.fn().mockRejectedValueOnce(new Error('provider_unavailable')).mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue([])
  const ensure = vi.fn()
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open, spaces, projects, ensure, present, service, settings })))
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
  userId = 'b'
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  await act(async () => complete([{ projectId: 'secret', name: 'Old account private project', canCreate: true }]))
  expect(container.textContent).not.toContain('Old account private project')
  expect(container.textContent).not.toContain('Set up project space')
})

it('renews managed cookies once before expiry without detaching the live editor', async () => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const openEditor = vi.fn(async () => ({ url: 'https://a.notes.example.test/', spaceId: 'a', expiresAt: new Date(Date.now() + 600_000).toISOString() }))
  const props = { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings }
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].onReady())
  const callsBefore = vi.mocked(useNativeSiYuanPresentation).mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(569_999) })
  expect(openEditor).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(openEditor).toHaveBeenCalledTimes(2)
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.slice(callsBefore).every(([options]) => options.url === 'https://a.notes.example.test/')).toBe(true)
  expect(container.querySelector('[data-siyuan-scaffold]')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(openEditor).toHaveBeenCalledTimes(2)
  await act(async () => root.render(createElement(SiYuanEditorPage, { ...props, context: { ...context, active: false } })))
  await act(async () => { await vi.advanceTimersByTimeAsync(650_000) })
  expect(openEditor).toHaveBeenCalledTimes(2)
  await act(async () => root.render(createElement(SiYuanEditorPage, props)))
  expect(openEditor).toHaveBeenCalledTimes(3)
})

it('ignores renewal responses after switching to another project', async () => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }, { projectId: 'b', name: 'B' }]
  let finishRenewal!: (session: { url: string; expiresAt: string }) => void
  let aCalls = 0
  const openEditor = vi.fn(async (input?: { spaceId?: string }) => {
    if (input?.spaceId === 'a' && ++aCalls === 2) return new Promise<{ url: string; expiresAt: string }>(resolve => { finishRenewal = resolve })
    return { url: `https://${input?.spaceId}.notes.example.test/`, expiresAt: new Date(Date.now() + 600_000).toISOString() }
  })
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => { await vi.advanceTimersByTimeAsync(570_000) })
  await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => finishRenewal({ url: 'https://a.notes.example.test/', expiresAt: new Date(Date.now() + 600_000).toISOString() }))
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBe('https://b.notes.example.test/')
})

it('shows a renewal error in chrome and retries without reloading the editor', async () => {
  language = 'en'
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const openEditor = vi.fn(async () => ({ url: 'https://a.notes.example.test/', expiresAt: new Date(Date.now() + 600_000).toISOString() }))
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].onReady())
  openEditor.mockRejectedValueOnce(new Error('provider_unavailable'))
  await act(async () => { await vi.advanceTimersByTimeAsync(570_000) })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be renewed')
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBe('https://a.notes.example.test/')
  expect(settings.getSnapshot().revision).toBe(0)
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!.click())
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(openEditor).toHaveBeenCalledTimes(3)
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('restores per-chat project selection across panel remounts without sharing another account state', async () => {
  const { createEditorSessionStateStore } = await import('./editor-session-state.js')
  const sessionStates = createEditorSessionStateStore()
  let identity: CurrentUserProfile = { state: 'signed-in', userId: 'a', displayName: 'A' }
  const service = { status: vi.fn(async () => ({ ...status(identity), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }, { projectId: 'b', name: 'B' }]
  const props = { open, projects, ...spaceFixture(projects), present, service, settings, sessionStates }
  const renderChat = async (id: string) => { await act(async () => root.render(createElement(SiYuanEditorPage, { ...props, context: { ...context, session: { id, runtimeId: 'codex' } } }))) }
  await renderChat('one')
  let select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await renderChat('two')
  expect(container.querySelector('select')!.value).toBe('a')
  select = container.querySelector('select')!
  await act(async () => { select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => root.unmount())
  root = createRoot(container)
  await renderChat('one')
  expect(container.querySelector('select')!.value).toBe('a')
  await renderChat('two')
  expect(container.querySelector('select')!.value).toBe('b')
  identity = { state: 'signed-in', userId: 'other', displayName: 'Other' }
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(container.querySelector('select')!.value).toBe('a')
})

it('explains browser limitations instead of attempting to open an unavailable native editor', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const, editorAvailable: false })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const openEditor = vi.fn(open)
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, open: openEditor, projects, ...spaceFixture(projects), present, service, settings })))
  const select = container.querySelector('select')!
  await act(async () => { select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(container.textContent).toContain('SciForge desktop app')
  expect(openEditor).not.toHaveBeenCalled()
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].url).toBeNull()
})

it('refreshes only the current conversation native view', async () => {
  language = 'en'
  const { createEditorSessionStateStore } = await import('./editor-session-state.js')
  const sessionStates = createEditorSessionStateStore()
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const openEditor = vi.fn(async (_input?: { spaceId?: string; refresh?: boolean }) => open())
  const renderChat = async (id: string) => { await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, session: { id } }, open: openEditor, projects, ...spaceFixture(projects), present, service, settings, sessionStates }))) }
  const selectProject = async () => { await act(async () => { const select = container.querySelector('select')!; select.value = 'a'; select.dispatchEvent(new Event('change', { bubbles: true })) }) }
  await renderChat('b')
  await selectProject()
  const bRevision = vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].reloadRevision
  await renderChat('a')
  await selectProject()
  expect(openEditor.mock.calls.every(args => !(args[0] as { refresh?: boolean } | undefined)?.refresh)).toBe(true)
  const refreshButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Refresh')!
  expect(refreshButton.nextElementSibling?.textContent).toBe('Settings')
  expect(container.textContent).not.toContain('Manage cloud document spaces')
  await act(async () => refreshButton.click())
  expect(openEditor).toHaveBeenLastCalledWith({ spaceId: 'a', refresh: true })
  expect(settings.getSnapshot().revision).toBe(0)
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].reloadRevision).toBe(1)
  await renderChat('b')
  expect(openEditor).toHaveBeenLastCalledWith({ spaceId: 'a' })
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)?.[0].reloadRevision).toBe(bRevision)
})


it('ensures only a personal space automatically, polls provisioning, and opens only when ready', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'queued', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  let listed: CloudSpace[] = []
  const spaces = vi.fn(async () => listed)
  const ensure = vi.fn(async () => { listed = [personal]; return personal })
  const openEditor = vi.fn(async () => ({ url: 'https://personal.test/' }))
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, service, settings, present, spaces, ensure, open: openEditor })))
  expect(ensure).toHaveBeenCalledExactlyOnceWith({ scope: { kind: 'personal' } })
  expect(openEditor).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Preparing your space')
  listed = [{ ...personal, status: 'ready', revision: 2 }]
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(openEditor).toHaveBeenCalledExactlyOnceWith({ spaceId: personal.spaceId })
  expect(ensure).toHaveBeenCalledOnce()
})

it('creates project spaces only on explicit action and retries failed provisioning explicitly', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const project: CloudSpace = { ...personal, spaceId: 'spc_' + '2'.repeat(32), scope: { kind: 'project', projectId: 'prj_team' }, status: 'failed', failure: { code: 'provision_failed', retryable: true } }
  let listed = [personal]
  const spaces = vi.fn(async () => listed)
  const ensure = vi.fn(async () => { listed = [personal, project]; return project })
  const projects = async () => [{ projectId: 'prj_team', name: 'Team', canCreate: true }, { projectId: 'prj_member', name: 'Member only', canCreate: false }]
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, service, settings, present, spaces, ensure, projects, open })))
  expect(ensure).not.toHaveBeenCalled()
  expect(container.querySelector('select[aria-label="Project to set up"]')).toBeNull()
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Settings')!.click())
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Set up project space')!.click())
  expect(container.querySelector('select[aria-label="Project to set up"]')?.textContent).not.toContain('Member only')
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('select[aria-label="Project to set up"]')!; select.value = 'prj_team'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm')!.click())
  expect(ensure).toHaveBeenCalledExactlyOnceWith({ scope: { kind: 'project', projectId: 'prj_team' } })
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry provisioning')!.click())
  expect(ensure).toHaveBeenLastCalledWith({ scope: project.scope, retryFailed: true })
})


it('shows project setup failures in settings and lets the user retry', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const ensure = vi.fn(async () => { throw new Error('offline') })
  const spaces = async () => [personal]
  const projects = async () => [{ projectId: 'prj_team', name: 'Team', canCreate: true }]
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, service, settings, present, spaces, ensure, projects, open })))
  const click = async (label: string) => { await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)!.click()) }
  await click('Settings')
  await click('Set up project space')
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('select[aria-label="Project to set up"]')!; select.value = 'prj_team'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('Confirm')
  expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm')?.disabled).toBe(false)
  await click('Confirm')
  expect(ensure).toHaveBeenCalledTimes(2)
})

it('clears creating state on chat switch and ignores the old ensure response', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const spaces = async () => [personal]
  let complete!: (space: CloudSpace) => void
  const ensure = vi.fn(() => new Promise<CloudSpace>(resolve => { complete = resolve }))
  const projects = async () => [{ projectId: 'prj_team', name: 'Team', canCreate: true }, { projectId: 'prj_member', name: 'Member only', canCreate: false }]
  const render = async (id: string) => { await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, session: { id } }, service, settings, present, spaces, ensure, projects, open }))) }
  const chooseProject = async () => { await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Settings')!.click()); await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Set up project space')!.click()); await act(async () => { const select = container.querySelector<HTMLSelectElement>('select[aria-label="Project to set up"]')!; select.value = 'prj_team'; select.dispatchEvent(new Event('change', { bubbles: true })) }) }
  const createButton = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm')!
  await render('first')
  await chooseProject()
  await act(async () => createButton().click())
  expect(createButton().disabled).toBe(true)
  await render('second')
  await chooseProject()
  expect(createButton().disabled).toBe(false)
  await act(async () => complete({ ...personal, spaceId: 'spc_' + '2'.repeat(32), scope: { kind: 'project', projectId: 'prj_team' } }))
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Back to cloud services')!.click())
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Cloud space"]')!.value).toBe(personal.spaceId)
})


it('lets members select an existing project space but reserves failed provisioning retry for its owner', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const project: CloudSpace = { ...personal, spaceId: 'spc_' + '2'.repeat(32), scope: { kind: 'project', projectId: 'prj_team' }, status: 'failed', failure: { code: 'provision_failed', retryable: true } }
  const ensure = vi.fn()
  const spaces = async () => [personal, project]
  const projects = async () => [{ projectId: 'prj_team', name: 'Team', canCreate: false }]
  await act(async () => root.render(createElement(SiYuanEditorPage, { context, service, settings, present, spaces, ensure, projects, open })))
  await act(async () => { const select = container.querySelector<HTMLSelectElement>('select[aria-label="Cloud space"]')!; select.value = project.spaceId; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Cloud space"]')!.value).toBe(project.spaceId)
  expect(container.textContent).toContain('Ask its owner to retry')
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Retry provisioning')).toBe(false)
  expect(ensure).not.toHaveBeenCalled()
})


it('does not force reauthorization when restoring a saved chat refresh revision', async () => {
  const { createEditorSessionStateStore } = await import('./editor-session-state.js')
  const sessionStates = createEditorSessionStateStore()
  sessionStates.update(JSON.stringify(['user:a', undefined, 'saved']), { spaceId: 'a', reloadRevision: 7 })
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const openEditor = vi.fn(open)
  await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, session: { id: 'saved' } }, open: openEditor, projects, ...spaceFixture(projects), present, service, settings, sessionStates })))
  expect(openEditor).toHaveBeenLastCalledWith({ spaceId: 'a' })
})

it('keeps setup in settings and excludes every existing project space regardless of status', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const personal: CloudSpace = { spaceId: 'spc_' + '1'.repeat(32), scope: { kind: 'personal', ownerUserId: 'a' }, status: 'ready', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const statuses = ['queued', 'provisioning', 'ready', 'failed'] as const
  const existing = statuses.map((status, index): CloudSpace => ({ ...personal, spaceId: 'spc_' + String(index + 2).repeat(32), scope: { kind: 'project', projectId: 'prj_' + status }, status }))
  const spaces = async () => [personal, ...existing]
  const ensure = vi.fn()
  let eligible = true
  const projects = async () => [...statuses.map(status => ({ projectId: 'prj_' + status, name: status, canCreate: true })), ...(eligible ? [{ projectId: 'prj_new', name: 'New project', canCreate: true }] : [])]
  const render = async (active = true) => { await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, active }, service, settings, present, spaces, ensure, projects, open }))) }
  await render()
  expect(container.querySelector('select[aria-label="Cloud space"]')).not.toBeNull()
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Set up project space')).toBe(false)
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Settings')!.click())
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Set up project space')!.click())
  const options = Array.from(container.querySelectorAll<HTMLSelectElement>('select[aria-label="Project to set up"] option')).map(option => option.value)
  expect(options).toEqual(['', 'prj_new'])
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!.click())
  expect(container.querySelector('select[aria-label="Project to set up"]')).toBeNull()
  expect(ensure).not.toHaveBeenCalled()
  eligible = false
  await render(false)
  await render()
  expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Set up project space')).toBe(false)
})

it('clears cancelled sign-in when returning to an already authorized conversation', async () => {
  language = 'en'
  const service = { status: vi.fn(async () => ({ ...status({ state: 'signed-in', userId: 'a', displayName: 'A' }), mode: 'managed' as const })), configure: vi.fn(), check: vi.fn() }
  const projects = async () => [{ projectId: 'a', name: 'A' }]
  const fixture = spaceFixture(projects)
  let finishPending!: (value: { url: string }) => void
  const openEditor = vi.fn(async () => ({ url: 'https://notes.example.test/' }))
  const renderChat = async (id: string) => { await act(async () => root.render(createElement(SiYuanEditorPage, { context: { ...context, session: { id } }, open: openEditor, projects, ...fixture, present, service, settings }))) }
  await renderChat('first')
  await act(async () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].onReady())
  expect(container.textContent).not.toContain('Signing in')
  openEditor.mockImplementationOnce(() => new Promise(resolve => { finishPending = resolve }))
  await renderChat('second')
  expect(container.textContent).toContain('Signing in')
  await renderChat('first')
  await act(async () => vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].onReady())
  expect(container.textContent).not.toContain('Signing in')
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].url).toBe('https://notes.example.test/')
  await act(async () => finishPending({ url: 'https://other.example.test/' }))
  expect(vi.mocked(useNativeSiYuanPresentation).mock.calls.at(-1)![0].url).toBe('https://notes.example.test/')
})
