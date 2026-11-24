// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DocumentSharing, type DocumentSharingControls, type ShareableDocument } from './document-sharing.js'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))
let root: Root, container: HTMLElement
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const link = { id: 'share-1', revision: 1, url: 'https://cloud.test/share/one', permission: 'comment' as const, revoked: false }
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(button => button.textContent === label)!
const mount = async (controls: DocumentSharingControls, key = 'account:chat:space') => { await act(async () => root.render(createElement(DocumentSharing, { key, controls, sessionId: key, spaceId: 'space' }))) }
it('freezes the current document, creates the chosen permission and revokes its link', async () => {
  const target: ShareableDocument = { title: 'Frozen note', list: vi.fn(async () => []), create: vi.fn(async permission => ({ ...link, permission })), revoke: vi.fn(async () => undefined) }
  const current = vi.fn(async () => target)
  await mount({ current })
  await act(async () => button('Share current document').click())
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Frozen note')
  expect(container.querySelector('[role="dialog"]')?.getAttribute('data-native-view-occluder')).toBe('true')
  expect(container.textContent).toContain('must sign in to SciForge')
  await act(async () => { const select = container.querySelector('select')!; select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => button('Create share link').click())
  expect(target.create).toHaveBeenCalledWith('edit', expect.any(AbortSignal))
  expect(current).toHaveBeenCalledOnce()
  expect(container.querySelector('input')?.value).toBe(link.url)
  await act(async () => button('Revoke link').click())
  expect(target.revoke).toHaveBeenCalledWith({ ...link, permission: 'edit' }, expect.any(AbortSignal))
  expect(container.textContent).toContain('Revoked')
  expect(container.querySelector('input')).toBeNull()
  await act(async () => button('Close').click())
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})
it('shows an explicit prompt without a dialog if no unambiguous note is open', async () => {
  await mount({ current: async () => null })
  await act(async () => button('Share current document').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Open a note')
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})
it('fences a pending current-document read after the account/chat/space key changes', async () => {
  let complete!: (document: ShareableDocument) => void
  const current = vi.fn((_input: { sessionId: string; spaceId: string }, _signal: AbortSignal) => new Promise<ShareableDocument>(resolve => { complete = resolve }))
  await mount({ current })
  await act(async () => button('Share current document').click())
  const signal = current.mock.calls[0]?.[1]
  await mount({ current: async () => null }, 'new-chat')
  const list = vi.fn(async () => [])
  await act(async () => complete({ title: 'Old note', list, create: async () => link, revoke: async () => undefined }))
  expect(signal?.aborted).toBe(true)
  expect(list).not.toHaveBeenCalled()
  expect(container.textContent).not.toContain('Old note')
})
it('closing during a link read aborts and prevents stale links from returning', async () => {
  let complete!: (links: typeof link[]) => void
  const list = vi.fn(() => new Promise<typeof link[]>(resolve => { complete = resolve }))
  await mount({ current: async () => ({ title: 'Note', list, create: async () => link, revoke: async () => undefined }) })
  await act(async () => button('Share current document').click())
  await act(async () => button('Close').click())
  await act(async () => complete([link]))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(container.querySelector('input')).toBeNull()
})

it('shows a safe localized service failure while retaining the frozen document', async () => {
  await mount({ current: async () => ({ title: 'Note', list: async () => [], create: async () => {
    throw { code: 'handler_failed', message: 'SECRET raw response', details: { reasonCode: 'cloud_unavailable', reasonMessage: 'Cloud rejection: kernel_response_invalid.' } }
  }, revoke: async () => undefined }) })
  await act(async () => button('Share current document').click())
  await act(async () => button('Create share link').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not process the document response')
  expect(container.textContent).not.toContain('SECRET')
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Note')
})
