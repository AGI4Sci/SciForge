import type { DomainMainHost, DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import { domainPackageDefinition, mainContribution } from '../definition.js'
import { SiYuanClient } from './client.js'
import { createSiYuanProvider } from './provider.js'
import {
  siyuanEditorContract, siyuanEditorRequestSchema, siyuanDocumentCreateContract,
  siyuanDocumentComposeContract, siyuanEditorPresentContract, siyuanEditorPresentRequestSchema
} from '../editor-contract.js'
import { createDocumentWriter } from './documents.js'
import { activateTaskSummaries } from './task-summaries.js'
import { createSiYuanNativeView } from './native-view.js'

/** Server mode only: the package connects to a SiYuan service the user runs or
 * subscribes to. It never starts, bundles or ships a kernel of its own. */
type ServiceEndpoint = Readonly<{ baseUrl: string; token?: string }>

const normalizeBaseUrl = (value: string): string => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 思源地址。')
  }
  return url.href.replace(/\/$/u, '')
}

export function createDomainMainEntry(host: DomainMainHost): TrustedDomainProcessEntryInput<unknown> {
  // Read but do not validate here: a malformed value must not abort Host startup.
  const configuredUrl = process.env.SIYUAN_BASE_URL?.trim() || undefined
  const configuredToken = process.env.SIYUAN_API_TOKEN?.trim() || undefined
  let endpoint: ServiceEndpoint | undefined
  let documents: ReturnType<typeof createDocumentWriter> | undefined
  let editorView: ReturnType<typeof createSiYuanNativeView> | undefined

  /** The page wins, then the last accepted address, then the configured default. */
  const resolveEndpoint = (requested?: string): ServiceEndpoint => {
    const candidate = requested?.trim() || endpoint?.baseUrl || configuredUrl || ''
    if (!candidate) {
      throw new Error('尚未配置思源服务地址：请在本页设置中填写，或设置 SIYUAN_BASE_URL。')
    }
    const baseUrl = normalizeBaseUrl(candidate)
    const token = endpoint?.token ?? configuredToken
    endpoint = { baseUrl, ...(token ? { token } : {}) }
    return endpoint
  }
  const clientFor = (value: ServiceEndpoint): SiYuanClient =>
    new SiYuanClient({ baseUrl: value.baseUrl, ...(value.token ? { token: value.token } : {}) })
  const getDocuments = () => documents ??= createDocumentWriter({
    userDataDir: host.getUserDataDir(),
    client: async () => {
      const value = resolveEndpoint()
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
        const value = resolveEndpoint(request.url)
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
        editorView ??= createSiYuanNativeView()
        await editorView.present({ hostId, url: request.url, viewport: request.viewport })
        return { output: { presented: true } }
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
    })]
  }
  const factory = defineContentSpaceProviderFactory({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerKind: 'siyuan',
    createProvider: ({ instance }) => createSiYuanProvider({
      providerInstanceRef: instance.providerInstanceRef,
      client: () => clientFor(resolveEndpoint())
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