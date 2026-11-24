import { afterEach, expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { createDomainMainEntry } from './index.js'
import { createSiYuanNativeView } from './native-view.js'
import { prepareCommentIdentityPreload } from './comment-identity-bridge.js'

vi.mock('./native-view.js', () => ({ siyuanCloudBrowserSession: vi.fn(), createSiYuanNativeView: vi.fn() }))
vi.mock('./comment-identity-bridge.js', () => ({ prepareCommentIdentityPreload: vi.fn() }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })
const input = { url: 'https://notes.example.test/',
  viewport: { x: 0, y: 0, width: 600, height: 400, visible: true } }
function handler() {
  const entry = createDomainMainEntry({
    defineCapability: (value: unknown) => value,
    nativeUi: { currentWebContentsId: () => 1 },
    packageSettings: { read: async () => ({ revision: 1, value: { mode: 'custom', url: input.url } }) },
    getUserDataDir: () => '/fixture'
  } as unknown as DomainMainHost)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as {
    createDefinitions: () => { id: string; handler: (input: unknown, context?: import('./document-resources.js').DocumentCapabilityContext) => Promise<{ output: unknown }> }[]
  }
  const definitions = factory.createDefinitions()
  return {
    open: definitions.find(item => item.id === 'siyuan.editor.open')!.handler,
    present: definitions.find(item => item.id === 'siyuan.editor.present')!.handler,
    document: definitions.find(item => item.id === 'siyuan.editor.document')!.handler
  }
}

it('creates one view when identity-triggered presentation overlaps preload initialization', async () => {
  let finish!: (path: string) => void
  vi.mocked(prepareCommentIdentityPreload).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const present = vi.fn(async () => undefined), dispose = vi.fn()
  vi.mocked(createSiYuanNativeView).mockReturnValue({ present, dispose, hide: vi.fn(), currentDocument: vi.fn(async () => null) })
  const actions = handler()
  await actions.open({})
  const first = actions.present(input)
  await vi.waitFor(() => expect(prepareCommentIdentityPreload).toHaveBeenCalledOnce())
  await actions.present({ ...input, url: null })
  const second = actions.present(input)
  finish('/fixture/preload.cjs')
  await Promise.all([first, second])
  expect(createSiYuanNativeView).toHaveBeenCalledOnce()
  expect(present).toHaveBeenCalledOnce()
  expect(present).toHaveBeenCalledWith({ ...input, hostId: 1 })
})

it('does not recreate a detached page after an obsolete preload finishes', async () => {
  let finish!: (path: string) => void
  vi.mocked(prepareCommentIdentityPreload).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const actions = handler()
  await actions.open({})
  const pending = actions.present(input)
  await vi.waitFor(() => expect(prepareCommentIdentityPreload).toHaveBeenCalledOnce())
  await actions.present({ ...input, url: null })
  finish('/fixture/preload.cjs')
  await pending
  expect(createSiYuanNativeView).not.toHaveBeenCalled()
})


it('retains an independent native editor per chat and hides it when its panel closes', async () => {
  vi.mocked(prepareCommentIdentityPreload).mockResolvedValue('/fixture/preload.cjs')
  const first = { present: vi.fn(async () => undefined), hide: vi.fn(), currentDocument: vi.fn(async () => null), dispose: vi.fn() }
  const second = { present: vi.fn(async () => undefined), hide: vi.fn(), currentDocument: vi.fn(async () => null), dispose: vi.fn() }
  vi.mocked(createSiYuanNativeView).mockReturnValueOnce(first).mockReturnValueOnce(second)
  const actions = handler()
  await actions.present({ ...input, sessionId: 'chat-a' })
  await actions.present({ ...input, sessionId: 'chat-b' })
  expect(first.hide).toHaveBeenCalled()
  await actions.present({ ...input, sessionId: 'chat-b', url: null })
  expect(second.hide).toHaveBeenCalled()
  await actions.present({ ...input, sessionId: 'chat-a' })
  expect(createSiYuanNativeView).toHaveBeenCalledTimes(2)
  expect(first.present).toHaveBeenCalledTimes(2)
  expect(first.dispose).not.toHaveBeenCalled()
  expect(second.dispose).not.toHaveBeenCalled()
})


it('issues the canonical document resource only for the active chat native view', async () => {
  vi.mocked(prepareCommentIdentityPreload).mockResolvedValue('/fixture/preload.cjs')
  const id = '20261108120000-current'
  const currentDocument = vi.fn(async () => id)
  vi.mocked(createSiYuanNativeView).mockReturnValue({ present: vi.fn(async () => undefined), hide: vi.fn(), dispose: vi.fn(), currentDocument })
  const fetch = vi.fn(async (url: unknown) => new Response(JSON.stringify({ code: 0,
    data: String(url).endsWith('getBlockKramdown') ? { id, kramdown: `Body\n{: id="${id}" updated="20261108120000"}\n` } :
      String(url).endsWith('getHPathByID') ? '/Current' : [{ id, box: '20261108120000-noteboo', hpath: '/Current', updated: '1' }] })))
  vi.stubGlobal('fetch', fetch)
  const actions = handler()
  await actions.present({ ...input, sessionId: 'chat-a' })
  const registrations: Parameters<import('./document-resources.js').DocumentCapabilityContext['issueResource']>[0][] = []
  const context = { issueResource: (value: typeof registrations[number]) => {
    registrations.push(value); return { token: 'test', semanticRevision: '1', expiresAt: '2099' }
  } }
  await expect(actions.document({ sessionId: 'chat-b' }, context)).resolves.toEqual({ output: { document: null } })
  expect(fetch).not.toHaveBeenCalled()
  await expect(actions.document({ sessionId: 'chat-a' }, context)).resolves.toMatchObject({ output: { document: { resource: { token: 'test' } } } })
  expect(registrations[0].resourceKind).toBe('siyuan-document')
  expect(currentDocument).toHaveBeenCalledWith('https://notes.example.test', undefined)
  await actions.present({ ...input, sessionId: 'chat-a', url: null })
  await expect(actions.document({ sessionId: 'chat-a' }, context)).resolves.toEqual({ output: { document: null } })
})
