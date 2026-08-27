import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  openContentBindInputSchema,
  openContentConnectionResultSchema,
  openContentConnectionTargetInputSchema,
  openContentUnbindOutputSchema,
  type OpenContentConnectionResult,
  type OpenContentUnbindResult
} from '../contract.js'

export type { OpenContentUnbindResult } from '../contract.js'

export type OpenContentConnectionRequestOptions = Readonly<{
  signal?: AbortSignal
}>

export type OpenContentConnectionRendererClient = Readonly<{
  status(
    providerInstanceRef: string,
    options?: OpenContentConnectionRequestOptions
  ): Promise<OpenContentConnectionResult>
  bind(
    providerInstanceRef: string,
    credentials: {
      account: string
      password: string
    },
    options?: OpenContentConnectionRequestOptions
  ): Promise<OpenContentConnectionResult>
  unbind(
    providerInstanceRef: string,
    options?: OpenContentConnectionRequestOptions
  ): Promise<OpenContentUnbindResult>
}>

export function createOpenContentConnectionRendererClient(
  invoker: DomainRendererCapabilityInvoker
): OpenContentConnectionRendererClient {
  return Object.freeze({
    status: (providerInstanceRef, options) => {
      const contract = {
        actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
        effect: 'read' as const,
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentConnectionResultSchema
      }
      const input = { providerInstanceRef }
      return options?.signal
        ? invoker.invoke(contract, input, { signal: options.signal })
        : invoker.invoke(contract, input)
    },
    bind: async (providerInstanceRef, credentials, options) => {
      const contract = {
        actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
        effect: 'external-write' as const,
        inputSchema: openContentBindInputSchema,
        outputSchema: openContentConnectionResultSchema
      }
      const input = {
        providerInstanceRef,
        account: credentials.account,
        password: credentials.password
      }
      const invocation = (() => {
        try {
          return options?.signal
            ? invoker.invoke(contract, input, { signal: options.signal })
            : invoker.invoke(contract, input)
        } finally {
          credentials.account = ''
          credentials.password = ''
          input.account = ''
          input.password = ''
        }
      })()
      return await invocation
    },
    unbind: (providerInstanceRef, options) => {
      const contract = {
        actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
        effect: 'external-write' as const,
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentUnbindOutputSchema
      }
      const input = { providerInstanceRef }
      return options?.signal
        ? invoker.invoke(contract, input, { signal: options.signal })
        : invoker.invoke(contract, input)
    }
  })
}
