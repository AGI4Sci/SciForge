import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ windows: [] as any[] }))
vi.mock('electron', () => ({
  screen: { getDisplayMatching: () => ({ workArea: { x: -1000, y: 0, width: 1000, height: 800 } }) },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    setMenu = vi.fn()
    close = vi.fn()
    destroy = vi.fn()
    isDestroyed = () => false
    constructor(readonly options: unknown) { super(); state.windows.push(this) }
  }
}))
import { attachWorkbenchWindowHost } from './workbench-window-host'
import type { BrowserWindow, HandlerDetails } from 'electron'

const trusted = 'file:///app/renderer/index.html'
const details = (input: Partial<HandlerDetails> = {}): HandlerDetails => ({
  url: 'about:blank', frameName: 'sciforge-workbench:fixture.notes', features: '', disposition: 'new-window',
  referrer: { url: trusted, policy: 'default' }, ...input
})
let owner: any
beforeEach(() => {
  state.windows = []
  owner = Object.assign(new EventEmitter(), { webContents: Object.assign(new EventEmitter(), {
    getURL: () => trusted, session: {}, setWindowOpenHandler: vi.fn()
  }), getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) })
  attachWorkbenchWindowHost(owner as BrowserWindow, trusted)
})

it('only allows named blank auxiliary surfaces from the trusted renderer', () => {
  const handle = owner.webContents.setWindowOpenHandler.mock.calls[0][0]
  expect(handle(details()).action).toBe('allow')
  for (const request of [details({ url: 'https://evil.test' }), details({ frameName: 'unregistered' }),
    details({ referrer: { url: 'https://evil.test', policy: 'default' } })]) {
    expect(handle(request)).toEqual({ action: 'deny' })
  }
  owner.webContents.getURL = () => 'https://evil.test'
  expect(handle(details())).toEqual({ action: 'deny' })
})

it('creates a sandboxed, preload-free window, clamps offscreen bounds, and denies navigation', () => {
  const response = owner.webContents.setWindowOpenHandler.mock.calls[0][0](details())
  response.createWindow({ x: 50000, y: 50000, width: 4000, height: 4000, webPreferences: { preload: '/privileged.js', nodeIntegration: true } })
  const child = state.windows[0]
  expect(child.options).toMatchObject({ parent: owner, x: -1000, y: 0, width: 1000, height: 800 })
  expect(child.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, session: owner.webContents.session })
  expect(child.options.webPreferences).not.toHaveProperty('preload')
  const preventDefault = vi.fn()
  child.webContents.emit('will-navigate', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(child.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
  owner.emit('closed')
  expect(child.destroy).toHaveBeenCalledOnce()
})

it('closes auxiliary windows before a full renderer navigation', () => {
  const response = owner.webContents.setWindowOpenHandler.mock.calls[0][0](details())
  response.createWindow({})
  owner.webContents.emit('did-start-navigation', {}, trusted, false, false)
  expect(state.windows[0].close).not.toHaveBeenCalled()
  owner.webContents.emit('did-start-navigation', {}, trusted, false, true)
  expect(state.windows[0].close).toHaveBeenCalledOnce()
})
