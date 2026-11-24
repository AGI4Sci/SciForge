import { afterEach, expect, it, vi } from 'vitest'
import type { DomainMainHost, DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { SiYuanNativeAiAccess } from './native-ai-session.js'

const native = vi.hoisted(() => ({ create: vi.fn(() => ({ present: vi.fn(), dispose: vi.fn() })) }))
vi.mock('./native-view.js', () => ({ siyuanCloudBrowserSession: vi.fn(), createSiYuanNativeView: native.create }))
vi.mock('./comment-identity-bridge.js', () => ({ prepareCommentIdentityPreload: async () => 'fixture-preload.cjs' }))
vi.mock('./task-summaries.js', () => ({ activateTaskSummaries: () => async () => undefined }))
import { createDomainMainEntry } from './index.js'

afterEach(() => { delete process.env.SIYUAN_BASE_URL; vi.clearAllMocks() })

it('wires native editing to the lifecycle modelAccess port and retires that access on disposal', async () => {
  process.env.SIYUAN_BASE_URL = 'https://notes.test'
  const entry = createDomainMainEntry({
    packageSettings: { read: async () => ({ revision: 1, value: { mode: 'custom', url: null } }) },
    defineCapability: (value: unknown) => value, getUserDataDir: () => 'fixture-user-data',
    nativeUi: { currentWebContentsId: () => 7 }
  } as unknown as DomainMainHost)
  const factory = entry.contributions.find(item => item.kind === 'main.capability-factory')!.value as {
    createDefinitions(): { id: string; handler(input: unknown): Promise<unknown> }[]
  }
  await factory.createDefinitions().find(item => item.id === 'siyuan.editor.present')!.handler({
    url: 'https://notes.test/', viewport: { x: 0, y: 0, width: 600, height: 400, visible: true }
  })
  const options = native.create.mock.calls[0] as unknown as [{ nativeAi: SiYuanNativeAiAccess }]
  const access = options[0].nativeAi
  expect(await access.textReasoner()).toBeNull()
  const reasoner = { baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'fixture-private-key', model: 'text-reasoner' }
  const textReasoner = vi.fn(async () => reasoner)
  const lifecycle = entry.contributions.find(item => item.kind === 'main.runtime-lifecycle')!.value as {
    activate(context: DomainMainRuntimeLifecycleContext): () => Promise<void>
  }
  const dispose = lifecycle.activate({ modelAccess: { textReasoner } } as unknown as DomainMainRuntimeLifecycleContext)
  expect(await access.textReasoner()).toBe(reasoner)
  expect(textReasoner).toHaveBeenCalledOnce()
  await expect(access.readBlock('20261030161847-n9jvf50', new AbortController().signal, 'https://other.test'))
    .rejects.toThrow('思源服务地址无效')
  await dispose()
  expect(await access.textReasoner()).toBeNull()
  expect(textReasoner).toHaveBeenCalledOnce()
})
