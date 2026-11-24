import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { COMMENT_IDENTITY_CHANNEL } from './comment-identity-bridge.js'

const runtime = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('node:module', () => ({ createRequire: () => () => runtime.value }))
import { createSiYuanNativeView, siyuanEditorPartition } from './native-view.js'

class Page extends EventEmitter {
  mainFrame = { url: '' }
  destroyed = false
  handlers = new Map<string, (event: { senderFrame: unknown }) => unknown>()
  ipc = { handle: (name: string, handler: (event: { senderFrame: unknown }) => unknown) => { this.handlers.set(name, handler) },
    removeHandler: (name: string) => { this.handlers.delete(name) } }
  executeJavaScript = vi.fn(async (_script: string): Promise<unknown> => '20261108120000-current')
  loadURL = vi.fn(async (url: string) => { this.mainFrame.url = url })
  close = vi.fn(() => { this.destroyed = true; this.emit('destroyed') })
  isDestroyed = () => this.destroyed
  setUserAgent = vi.fn()
  setWindowOpenHandler = vi.fn()
  read = () => this.handlers.get(COMMENT_IDENTITY_CHANNEL)?.({ senderFrame: this.mainFrame })
}
class View {
  webContents = new Page()
  visible = false
  constructor(readonly options: { webPreferences: { session: EventEmitter } }) { views.push(this) }
  setBounds = vi.fn()
  setVisible = (visible: boolean) => { this.visible = visible }
}
const views: View[] = []
const owners: ReturnType<typeof createSiYuanNativeView>[] = []
const sessions = new Map<string, EventEmitter>()
const user = (userId: string, displayName = '同名'): CurrentUserProfile => ({ state: 'signed-in', userId, displayName })
const url = 'https://notes.example.test/'
const input = { hostId: 1, url, viewport: { x: 0, y: 0, width: 600, height: 400, visible: true } }
beforeEach(() => {
  vi.useFakeTimers()
  views.length = 0
  sessions.clear()
  const host = Object.assign(new EventEmitter(), { getZoomFactor: () => 1 })
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false,
    getContentBounds: () => ({ width: 900, height: 600 }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } })
  runtime.value = { WebContentsView: View, webContents: { fromId: () => host },
    BrowserWindow: { fromWebContents: () => window }, session: { fromPartition: (key: string) => {
      if (!sessions.has(key)) sessions.set(key, new EventEmitter())
      return sessions.get(key)
    } } }
})
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); vi.useRealTimers() })
function owner(readIdentity: () => CurrentUserProfile) {
  const result = createSiYuanNativeView({ readIdentity })
  owners.push(result)
  return result
}

it('partitions by stable account and service origin, without readable account IDs', () => {
  const a = siyuanEditorPartition(url, user('private-user-a'))
  expect(a).toBe(siyuanEditorPartition(url + 'other', user('private-user-a', '改名')))
  expect(a).not.toContain('private-user-a')
  expect(a).not.toBe(siyuanEditorPartition(url, user('b')))
  expect(a).not.toBe(siyuanEditorPartition('https://other.example.test', user('private-user-a')))
  expect(a).not.toBe(siyuanEditorPartition(url, { state: 'signed-out' }))
})

it('two clients reach the same origin with independent sessions and account bridges', async () => {
  await owner(() => user('a')).present(input)
  await owner(() => user('b')).present({ ...input, hostId: 2 })
  expect(views[0].options.webPreferences.session).not.toBe(views[1].options.webPreferences.session)
  expect(views.map(view => view.webContents.mainFrame.url)).toEqual([url, url])
  expect(views.map(view => view.webContents.read())).toEqual([user('a'), user('b')])
})

it('fences the old bridge immediately and restores the account partition on return', async () => {
  let profile = user('a')
  const editor = owner(() => profile)
  await editor.present(input)
  const first = views[0]
  profile = user('a', '改名')
  await editor.present(input)
  expect(views).toHaveLength(1)
  expect(first.webContents.read()).toEqual(profile)
  profile = user('b')
  expect(first.webContents.read()).toEqual({ state: 'unavailable' })
  await editor.present(input)
  expect(first.webContents.close).toHaveBeenCalledOnce()
  expect(first.webContents.handlers.size).toBe(0)
  expect(views[1].options.webPreferences.session).not.toBe(first.options.webPreferences.session)
  profile = user('a')
  await editor.present(input)
  expect(views[2].options.webPreferences.session).toBe(first.options.webPreferences.session)
})

it('retires a hidden page on logout and cleans up its bridge and timer', async () => {
  let profile = user('a')
  const editor = owner(() => profile)
  await editor.present({ ...input, viewport: { ...input.viewport, visible: false } })
  const first = views[0]
  profile = { state: 'signed-out' }
  await vi.advanceTimersByTimeAsync(500)
  expect(first.webContents.close).toHaveBeenCalledOnce()
  expect(first.webContents.handlers.size).toBe(0)
  editor.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('recovers account changes that occur between renderer polls without another viewport event', async () => {
  let profile = user('a')
  await owner(() => profile).present(input)
  profile = { state: 'signed-out' }
  await vi.advanceTimersByTimeAsync(500)
  expect(views[0].webContents.isDestroyed()).toBe(true)
  expect(views[1].webContents.read()).toEqual({ state: 'signed-out' })
  profile = user('a')
  await vi.advanceTimersByTimeAsync(500)
  expect(views[2].visible).toBe(true)
  expect(views[2].webContents.read()).toEqual(user('a'))
})

it('does not close a newer document navigation when an older navigation finishes', async () => {
  const editor = owner(() => user('a'))
  await editor.present(input)
  let finish!: () => void
  views[0].webContents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = editor.present({ ...input, url: url + 'old' })
  await editor.present({ ...input, url: url + 'new' })
  finish()
  await pending
  expect(views[0].webContents.isDestroyed()).toBe(false)
  expect(views[0].webContents.mainFrame.url).toBe(url + 'new')
  expect(views[0].visible).toBe(true)
})

it('keeps the newest viewport when another presentation arrives during navigation', async () => {
  const editor = owner(() => user('a'))
  await editor.present(input)
  let finish!: () => void
  views[0].webContents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = editor.present({ ...input, url: url + 'doc' })
  const hidden = editor.present({ ...input, url: url + 'doc', viewport: { ...input.viewport, visible: false } })
  finish()
  await Promise.all([pending, hidden])
  expect(views[0].visible).toBe(false)
  expect(views[0].webContents.loadURL).toHaveBeenCalledTimes(2)
})

it('does not resurrect a retired account when its navigation completes late', async () => {
  let profile = user('a')
  const editor = owner(() => profile)
  await editor.present(input)
  let finish!: () => void
  views[0].webContents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = editor.present({ ...input, url: url + 'doc' })
  profile = user('b')
  await editor.present(input)
  finish()
  await pending
  expect(views[0].webContents.isDestroyed()).toBe(true)
  expect(views[1].visible).toBe(true)
})

it('moves the same native editor into an owned auxiliary window and returns before it closes', async () => {
  const editor = owner(() => user('a'))
  const primary = (runtime.value.BrowserWindow as { fromWebContents: () => any }).fromWebContents()
  const child = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { mainFrame: { name: 'sciforge-workbench:fixture.notes' }, getZoomFactor: () => 1 },
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentBounds: () => ({ width: 720, height: 540 })
  })
  primary.getChildWindows = () => [child]
  await editor.present(input)
  const original = views[0]
  await editor.present({ ...input, viewport: { ...input.viewport, windowName: 'sciforge-workbench:fixture.notes' } })
  expect(views).toHaveLength(1)
  expect(original.webContents.loadURL).toHaveBeenCalledOnce()
  expect(primary.contentView.removeChildView).toHaveBeenCalledWith(original)
  expect(child.contentView.addChildView).toHaveBeenCalledWith(original)
  child.emit('close')
  expect(child.contentView.removeChildView).toHaveBeenCalledWith(original)
  expect(primary.contentView.addChildView).toHaveBeenLastCalledWith(original)
  expect(original.visible).toBe(false)
  await editor.present(input)
  expect(original.visible).toBe(true)
  expect(original.webContents.close).not.toHaveBeenCalled()
  expect(original.webContents.read()).toEqual(user('a'))
})

it('refuses a surface outside the owning window without discarding the editor', async () => {
  const primary = (runtime.value.BrowserWindow as { fromWebContents: () => any }).fromWebContents()
  primary.getChildWindows = () => []
  const editor = owner(() => user('a'))
  await editor.present(input)
  await expect(editor.present({ ...input, viewport: { ...input.viewport, windowName: 'sciforge-workbench:other' } })).rejects.toThrow('窗口已关闭')
  expect(views).toHaveLength(1)
  expect(views[0].webContents.close).not.toHaveBeenCalled()
  expect(views[0].visible).toBe(true)
})


it('hides and restores the same editor without reloading its document state', async () => {
  const view = owner(() => user('a'))
  await view.present(input)
  views[0].webContents.mainFrame.url = url + 'stage/build/desktop/?document=chosen'
  view.hide()
  expect(views[0].visible).toBe(false)
  expect(views[0].webContents.close).not.toHaveBeenCalled()
  await view.present(input)
  expect(views[0].visible).toBe(true)
  expect(views[0].webContents.loadURL).toHaveBeenCalledOnce()
  expect(views[0].webContents.mainFrame.url).toContain('document=chosen')
})

it('retries a failed native navigation instead of treating its URL as loaded', async () => {
  const view = owner(() => user('a'))
  const pending = view.present(input)
  await pending
  const page = views[0].webContents
  page.loadURL.mockRejectedValueOnce(new Error('offline'))
  // A different entry URL on the same origin must be a real load.
  await expect(view.present({ ...input, url: url + 'retry' })).rejects.toThrow('offline')
  await view.present({ ...input, url: url + 'retry' })
  expect(page.loadURL).toHaveBeenCalledTimes(3)
})


it('explicit refresh reloads the current document once without reloading on viewport updates', async () => {
  const view = owner(() => user('a'))
  await view.present({ ...input, reloadRevision: 0 })
  views[0].webContents.mainFrame.url = url + 'stage/build/desktop/?doc=selected'
  await view.present({ ...input, reloadRevision: 1 })
  await view.present({ ...input, reloadRevision: 1 })
  expect(views[0].webContents.loadURL).toHaveBeenCalledTimes(2)
  expect(views[0].webContents.loadURL).toHaveBeenLastCalledWith(url + 'stage/build/desktop/?doc=selected')
})


it('reads only the visible current document ID, fencing account, endpoint, hidden views and late results', async () => {
  let profile = user('a')
  const editor = owner(() => profile)
  await editor.present(input)
  await expect(editor.currentDocument(url)).resolves.toBe('20261108120000-current')
  await expect(editor.currentDocument('https://other.test/')).resolves.toBeNull()
  await expect(editor.currentDocument(url + 'another-service/')).resolves.toBeNull()
  const count = views[0].webContents.executeJavaScript.mock.calls.length
  editor.hide()
  await expect(editor.currentDocument(url)).resolves.toBeNull()
  expect(views[0].webContents.executeJavaScript).toHaveBeenCalledTimes(count)
  await editor.present(input)
  let finish!: (id: string) => void
  views[0].webContents.executeJavaScript.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const pending = editor.currentDocument(url)
  profile = user('b')
  finish('20261108120000-current')
  await expect(pending).resolves.toBeNull()
})

it('bounds a native document lookup that never responds and rejects invalid IDs', async () => {
  const editor = owner(() => user('a'))
  await editor.present(input)
  views[0].webContents.executeJavaScript.mockResolvedValue('untrusted text is not an ID')
  await expect(editor.currentDocument(url)).resolves.toBeNull()
  views[0].webContents.executeJavaScript.mockReturnValue(new Promise(() => undefined))
  const pending = editor.currentDocument(url)
  await vi.advanceTimersByTimeAsync(500)
  await expect(pending).resolves.toBeNull()
})


it('establishes the real viewport before a navigation finishes', async () => {
  let finish!: () => void
  const editor = owner(() => user('a'))
  const first = editor.present({ ...input, reloadRevision: 0 })
  await first
  views[0].webContents.loadURL.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = editor.present({ ...input, reloadRevision: 1, viewport: { ...input.viewport, width: 500 } })
  expect(views[0].setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 500, height: 400 })
  expect(views[0].visible).toBe(true)
  finish()
  await pending
})
