import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityInvoker,
  DomainRendererCapabilityObservation
} from '@sciforge/domain-sdk/host'
import {
  BROWSER_PREVIEW_CAPABILITY_IDS,
  BROWSER_PREVIEW_RESOURCE_KIND,
  browserActionOutputSchema,
  browserCloseOutputSchema,
  browserEmptyInputSchema,
  browserNavigateInputSchema,
  browserOpenInputSchema,
  browserOpenOutputSchema,
  browserPageStateSchema,
  type BrowserActionOutput,
  browserPresentationInputSchema,
  type BrowserPresentationInput,
  type BrowserPageState
} from '../contract'

const contracts = Object.freeze({
  open: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.open,
    effect: 'external-write' as const,
    inputSchema: browserOpenInputSchema,
    outputSchema: browserOpenOutputSchema
  },
  observation: {
    resourceKind: BROWSER_PREVIEW_RESOURCE_KIND,
    stateSchema: browserPageStateSchema
  },
  navigate: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.navigate,
    effect: 'external-write' as const,
    inputSchema: browserNavigateInputSchema,
    outputSchema: browserActionOutputSchema
  },
  back: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.back,
    effect: 'external-write' as const,
    inputSchema: browserEmptyInputSchema,
    outputSchema: browserActionOutputSchema
  },
  forward: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.forward,
    effect: 'external-write' as const,
    inputSchema: browserEmptyInputSchema,
    outputSchema: browserActionOutputSchema
  },
  reload: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.reload,
    effect: 'external-write' as const,
    inputSchema: browserEmptyInputSchema,
    outputSchema: browserActionOutputSchema
  },
  present: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.present,
    effect: 'external-write' as const,
    inputSchema: browserPresentationInputSchema,
    outputSchema: browserActionOutputSchema
  },
  close: {
    actionId: BROWSER_PREVIEW_CAPABILITY_IDS.close,
    effect: 'external-write' as const,
    inputSchema: browserEmptyInputSchema,
    outputSchema: browserCloseOutputSchema
  }
})

type Observation = DomainRendererCapabilityObservation<BrowserPageState>
type MutationOptions = Readonly<{
  workspaceId?: string
  resource: DomainCapabilityResourceHandle
  expectedRevision: string
  approval: Readonly<{ mode: 'confirmation' }>
}>
type ResourceOptions = Readonly<{
  workspaceId?: string
  resource: DomainCapabilityResourceHandle
}>

export type BrowserPreviewCapabilityClient = Readonly<{
  open(input: {
    sessionId: string
    surfaceId: string
    url: string
    workspaceId?: string
  }): Promise<DomainCapabilityResourceHandle>
  observe(
    resource: DomainCapabilityResourceHandle,
    workspaceId?: string
  ): Promise<Observation>
  close(options: ResourceOptions): Promise<void>
  present(input: BrowserPresentationInput, options: ResourceOptions): Promise<BrowserActionOutput>
  navigate(url: string, options: MutationOptions): Promise<BrowserActionOutput>
  back(options: MutationOptions): Promise<BrowserActionOutput>
  forward(options: MutationOptions): Promise<BrowserActionOutput>
  reload(options: MutationOptions): Promise<BrowserActionOutput>
}>

export function createBrowserPreviewCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): BrowserPreviewCapabilityClient {
  return Object.freeze({
    async open(input) {
      const result = await invoker.invoke(
        contracts.open,
        { sessionId: input.sessionId, surfaceId: input.surfaceId, url: input.url },
        {
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          approval: { mode: 'confirmation' }
        }
      )
      return result.resource
    },
    observe: (resource, workspaceId) => invoker.observe(
      contracts.observation,
      resource,
      workspaceId ? { workspaceId } : {}
    ),
    present: (input, options) => invoker.invoke(contracts.present, input, options),
    close: async (options) => {
      await invoker.invoke(contracts.close, {}, options)
    },
    navigate: (url, options) => invoker.invoke(contracts.navigate, { url }, options),
    back: (options) => invoker.invoke(contracts.back, {}, options),
    forward: (options) => invoker.invoke(contracts.forward, {}, options),
    reload: (options) => invoker.invoke(contracts.reload, {}, options)
  })
}
