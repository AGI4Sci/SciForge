import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { attachCommentIdentityBridge, isEditorOrigin, prepareCommentIdentityPreload, COMMENT_IDENTITY_CHANNEL }
  from './comment-identity-bridge.js'

describe('SiYuan comment identity boundary', () => {
  it('only accepts the configured HTTP origin', () => {
    expect(isEditorOrigin('https://notes.test/stage/build/desktop/', 'https://notes.test')).toBe(true)
    for (const url of ['https://notes.test.evil/', 'http://notes.test/', 'file:///etc',
      'javascript:void(0)', 'https://user:pass@notes.test/']) {
      expect(isEditorOrigin(url, 'https://notes.test/')).toBe(false)
    }
  })
  it('scopes reads to the live main frame and strips unexpected identity fields', () => {
    const handlers = new Map<string, (event: any) => unknown>()
    const frame = { url: 'https://notes.test/stage/build/desktop/' }
    const page = { isDestroyed: () => false, mainFrame: frame, ipc: {
      handle: (name: string, fn: (event: any) => unknown) => handlers.set(name, fn),
      removeHandler: vi.fn((name: string) => handlers.delete(name))
    } }
    let profile: any = { state: 'signed-in', userId: 'user-a', displayName: 'A' }
    const detach = attachCommentIdentityBridge(page as unknown as WebContents,
      () => 'https://notes.test/', () => profile)
    const read = handlers.get(COMMENT_IDENTITY_CHANNEL)!
    expect(read({ senderFrame: frame })).toEqual(profile)
    expect(read({ senderFrame: { ...frame } })).toEqual({ state: 'unavailable' })
    frame.url = 'https://evil.test/'
    expect(read({ senderFrame: frame })).toEqual({ state: 'unavailable' })
    frame.url = 'https://notes.test/'
    profile = { state: 'signed-in', userId: 'user-b', displayName: 'B' }
    expect(read({ senderFrame: frame })).toEqual(profile)
    profile = { state: 'signed-out' }
    expect(read({ senderFrame: frame })).toEqual(profile)
    profile = { state: 'signed-in', userId: 'user-a', displayName: 'A', token: 'secret' }
    expect(read({ senderFrame: frame })).toEqual({ state: 'unavailable' })
    detach()
    expect(handlers.size).toBe(0)
    expect(read({ senderFrame: frame })).toEqual({ state: 'unavailable' })
  })
  it('emits a standalone sandbox preload in source and packaged execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siyuan-identity-preload-'))
    try {
      const file = await prepareCommentIdentityPreload(root)
      expect(isAbsolute(file)).toBe(true)
      expect(await prepareCommentIdentityPreload(root)).toBe(file)
      const source = await readFile(file, 'utf8')
      expect(source).toContain("contextBridge.exposeInMainWorld('sciforgeCommentIdentity'")
      expect(source).toContain('process.isMainFrame')
      expect(source).not.toContain('accessToken')
      expect(source).not.toContain('node:')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
