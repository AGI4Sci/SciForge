import type { DomainMainHost, DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import { domainPackageDefinition, mainContribution } from '../definition.js'
import { SiYuanClient, SiYuanError } from './client.js'
import { createSiYuanProvider } from './provider.js'
import {
  siyuanEditorContract, siyuanEditorRequestSchema, siyuanDocumentCreateContract,
  siyuanDocumentComposeContract, siyuanEditorPresentContract, siyuanEditorPresentRequestSchema,
  siyuanDocumentReadContract, siyuanDocumentSearchContract,
  siyuanServiceConfigureContract, siyuanServiceConfigureRequestSchema, siyuanServiceStatusContract
} from '../editor-contract.js'
import { createDocumentWriter } from './documents.js'
import { createDocumentReader } from './reader.js'
import { createSiYuanTokenStore } from './secrets.js'
import { activateTaskSummaries } from './task-summaries.js'
import { createSiYuanNativeView } from './native-view.js'
import { prepareCommentIdentityPreload } from './comment-identity-bridge.js'
import { CURRENT_USER_SERVICE_ID, CURRENT_USER_CONTRACT_VERSION, type CurrentUserProfileService }
  from '@sciforge/domain-identity-access/current-user-profile'

/** Server mode only: the package connects to a SiYuan service the user runs or
 * subscribes to. It never starts, bundles or ships a kernel of its own. */
type ServiceEndpoint = Readonly<{ baseUrl: string; token?: string }>

const normalizeBaseUrl = (value: string): string => {
  let url: URL
  try { url = new URL(value) } catch { throw new SiYuanError('invalid_configuration') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new SiYuanError('invalid_configuration')
  }
  return url.href.replace(/\/$/u, '')
}

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  // Read but do not validate here: a malformed value must not abort Host startup.
  const configuredUrl = process.env.SIYUAN_BASE_URL?.trim() || undefined
  const configuredToken = process.env.SIYUAN_API_TOKEN?.trim() || undefined
  const tokenStore = createSiYuanTokenStore(host.packageSecrets)
  /** The address the page (or the subscription) last accepted. */
  let endpoint: Readonly<{ baseUrl: string }> | undefined
  let documents: ReturnType<typeof createDocumentWriter> | undefined
  let reader: ReturnType<typeof createDocumentReader> | undefined
  let editorView: ReturnType<typeof createSiYuanNativeView> | undefined

  /** The page wins, then the last accepted address, then the configured default.
   * The token is resolved on every call so that storing or clearing it takes
   * effect immediately: an explicit choice in the page outranks the environment. */
  const resolveEndpoint = async (requested?: string): Promise<ServiceEndpoint> => {
    const candidate = requested?.trim() || endpoint?.baseUrl || configuredUrl || ''
    if (!candidate) throw new SiYuanError('not_configured')
    const baseUrl = normalizeBaseUrl(candidate)
    const token = (await tokenStore.read()) ?? configuredToken
    endpoint = { baseUrl }
    return { baseUrl, ...(token ? { token } : {}) }
  }
  const status = async () => {
    const storedToken = await tokenStore.read()
    return {
      url: endpoint?.baseUrl ?? configuredUrl ?? null,
      urlSource: endpoint ? 'configured' as const : configuredUrl ? 'environment' as const : 'none' as const,
      token: storedToken ? 'stored' as const : configuredToken ? 'environment' as const : 'none' as const,
      tokenStorage: tokenStore.available() ? 'available' as const : 'unavailable' as const
    }
  }
  const clientFor = (value: ServiceEndpoint): SiYuanClient =>
    new SiYuanClient({ baseUrl: value.baseUrl, ...(value.token ? { token: value.token } : {}) })
  const getDocuments = () => documents ??= createDocumentWriter({
    userDataDir: host.getUserDataDir(),
    client: async () => {
      const value = await resolveEndpoint()
      return { client: clientFor(value), baseUrl: value.baseUrl }
    }
  })
  /** Reads never write, so they share the endpoint but not the writer's queue. */
  const getReader = () => reader ??= createDocumentReader({
    client: async () => {
      const value = await resolveEndpoint()
      return { client: clientFor(value), baseUrl: value.baseUrl }
    }
  })
  const editor = {
    moduleId: domainPackageDefinition.module.id,
    policy: { id: 'siyuan', title: 'SiYuan editor',
      directTransportPrefixes: [], allowedDirectTransports: [] },
    createDefinitions: () => [host.defineCapability({
      id: siyuanEditorContract.actionId, version: '1.0.0', title: 'Open SiYuan editor',
      description: 'Resolves the configured SiYuan service address for the embedded editor.',
      audiences: ['ui'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan'],
      inputSchema: siyuanEditorContract.inputSchema, outputSchema: siyuanEditorContract.outputSchema,
      handler: async (input: unknown) => {
        const request = siyuanEditorRequestSchema.parse(input)
        const value = await resolveEndpoint(request.url)
        return { output: { url: `${value.baseUrl}/` } }
      }
    }), host.defineCapability({
      // The embedded editor is a native child view, so the Host renderer only
      // reports its slot rectangle and this capability owns the real surface.
      id: siyuanEditorPresentContract.actionId, version: '1.0.0', title: 'Present SiYuan editor',
      description: 'Synchronizes the package-owned native editor view with its main-area slot.',
      audiences: ['ui'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan', 'native'],
      inputSchema: siyuanEditorPresentContract.inputSchema,
      outputSchema: siyuanEditorPresentContract.outputSchema,
      handler: async (input: unknown) => {
        const request = siyuanEditorPresentRequestSchema.parse(input)
        if (request.url === null) {
          editorView?.dispose()
          return { output: { presented: false } }
        }
        const hostId = host.nativeUi?.currentWebContentsId()
        if (hostId === undefined) {
          throw new Error('内嵌思源编辑界面需要 SciForge 桌面窗口，当前环境不可用。')
        }
        const allowed = await resolveEndpoint()
        if (new URL(request.url).href !== allowed.baseUrl + '/') {
          throw new Error('请先在思源设置中确认服务地址。')
        }
        if (!editorView) {
          const preloadPath = await prepareCommentIdentityPreload(host.getUserDataDir())
          editorView = createSiYuanNativeView({ preloadPath, readIdentity: () => {
            try {
              return host.internalServices?.acquire<CurrentUserProfileService>(
                CURRENT_USER_SERVICE_ID, CURRENT_USER_CONTRACT_VERSION).read() ?? { state: 'unavailable' }
            } catch { return { state: 'unavailable' } }
          } })
        }
        await editorView.present({ hostId, url: request.url, viewport: request.viewport })
        return { output: { presented: true } }
      }
    }), host.defineCapability({
      // Without this the page can only guess whether the service it reaches is
      // the one a person configured, and whether a token is in play at all.
      id: siyuanServiceStatusContract.actionId, version: '1.0.0', title: 'Inspect SiYuan service',
      description: 'Reports the effective SiYuan address, where that address came from and whether a token is stored.',
      audiences: ['ui'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, tags: ['siyuan', 'service'],
      inputSchema: siyuanServiceStatusContract.inputSchema,
      outputSchema: siyuanServiceStatusContract.outputSchema,
      handler: async () => ({ output: await status() })
    }), host.defineCapability({
      // The token never travels in the other direction: the page writes it once
      // and reads back a state word, so it cannot be scraped from the renderer.
      id: siyuanServiceConfigureContract.actionId, version: '1.0.0', title: 'Configure SiYuan token',
      description: 'Stores the SiYuan API token in the local encrypted secret store, or clears it when given null.',
      audiences: ['ui'], scope: 'global', effect: 'compute', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan', 'service', 'token'],
      inputSchema: siyuanServiceConfigureContract.inputSchema,
      outputSchema: siyuanServiceConfigureContract.outputSchema,
      handler: async (input: unknown) => {
        const request = siyuanServiceConfigureRequestSchema.parse(input)
        if (request.token === null) await tokenStore.clear()
        else await tokenStore.write(request.token)
        return { output: await status() }
      }
    }), host.defineCapability({
      id: siyuanDocumentCreateContract.actionId, version: '1.0.0', title: 'Create SiYuan document',
      description: 'Creates one Markdown document in the configured SiYuan service.',
      audiences: ['ui', 'system'], scope: 'global', effect: 'external-write', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan', 'document', 'write'],
      inputSchema: siyuanDocumentCreateContract.inputSchema,
      outputSchema: siyuanDocumentCreateContract.outputSchema,
      handler: async (input: unknown) => ({ output: await getDocuments().create(input) })
    }), host.defineCapability({
      id: siyuanDocumentComposeContract.actionId, version: '1.0.0', title: '写入思源笔记文档',
      description: '把一篇 Markdown 文档写入已配置的思源服务(默认笔记本「My Notebook」)。当用户要求把结果、分析或总结保存到思源笔记时使用;path 形如 /目录/标题,省略时直接写入笔记本根路径。',
      audiences: ['agent'], scope: 'global', effect: 'external-write', approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan', 'document', 'write'],
      inputSchema: siyuanDocumentComposeContract.inputSchema,
      outputSchema: siyuanDocumentComposeContract.outputSchema,
      handler: async (input: unknown) => ({ output: await getDocuments().create(input) })
    }), host.defineCapability({
      id: siyuanDocumentSearchContract.actionId, version: '1.0.0', title: '搜索思源笔记文档',
      description: '按标题路径搜索已配置的思源服务里的文档,返回 id、path、notebook 与更新时间。当用户提到某个主题但不确定对应哪篇文档时,先用它定位,再用 siyuan.document.read 读取正文。',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, tags: ['siyuan', 'document', 'search'],
      inputSchema: siyuanDocumentSearchContract.inputSchema,
      outputSchema: siyuanDocumentSearchContract.outputSchema,
      handler: async (input: unknown) => ({ output: await getReader().search(input) })
    }), host.defineCapability({
      id: siyuanDocumentReadContract.actionId, version: '1.0.0', title: '读取思源笔记文档',
      description: '读取一篇思源笔记文档的 Markdown 正文。当用户提到某篇思源笔记、或需要引用、汇总、核对思源里已有的内容时使用;用 id 或 path(形如 /目录/标题)指定文档,二者择一;正文超过 maxChars 个字符时截断并返回 truncated=true。',
      audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, tags: ['siyuan', 'document', 'read'],
      inputSchema: siyuanDocumentReadContract.inputSchema,
      outputSchema: siyuanDocumentReadContract.outputSchema,
      handler: async (input: unknown) => ({ output: await getReader().read(input) })
    })]
  }
  const factory = defineContentSpaceProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: 'siyuan',
    createProvider: ({ instance }) => createSiYuanProvider({
      providerInstanceRef: instance.providerInstanceRef,
      client: async () => clientFor(await resolveEndpoint())
    })
  })
  const instance = defineProviderInstanceDirectoryEntry({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef: 'sciforge-siyuan',
    providerKind: 'siyuan', displayName: 'SiYuan'
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      { ...mainContribution('siyuan-content-space.provider-factory'), value: factory },
      { ...mainContribution('siyuan-content-space.provider-instance'), value: instance },
      { ...mainContribution('siyuan-content-space.editor'), value: editor },
      { ...mainContribution('siyuan-content-space.runtime'),
        value: { activate: (context: DomainMainRuntimeLifecycleContext) => {
          const dispose = activateTaskSummaries(context)
          return async () => {
            await dispose()
            editorView?.dispose()
            await documents?.drain()
          }
        } } }
    ]
  }
}