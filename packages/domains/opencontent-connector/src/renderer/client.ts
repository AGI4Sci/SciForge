import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  openContentBindInputSchema,
  openContentConnectionStatusSchema,
  openContentEmptyInputSchema,
  openContentUnbindOutputSchema,
  type OpenContentConnectionStatus
} from '../contract.js'

export type OpenContentConnectionRendererClient = Readonly<{
  status(): Promise<OpenContentConnectionStatus>
  bind(username: string, password: string): Promise<OpenContentConnectionStatus>
  unbind(): Promise<Readonly<{ state: 'disconnected'; remoteRevocation: 'unsupported' }>>
}>

export function createOpenContentConnectionRendererClient(
  invoker: DomainRendererCapabilityInvoker
): OpenContentConnectionRendererClient {
  return Object.freeze({
    status: () => invoker.invoke({
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
      effect: 'read',
      inputSchema: openContentEmptyInputSchema,
      outputSchema: openContentConnectionStatusSchema
    }, {}),
    bind: (username, password) => invoker.invoke({
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
      effect: 'external-write',
      inputSchema: openContentBindInputSchema,
      outputSchema: openContentConnectionStatusSchema
    }, { username, password }),
    unbind: () => invoker.invoke({
      actionId: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
      effect: 'external-write',
      inputSchema: openContentEmptyInputSchema,
      outputSchema: openContentUnbindOutputSchema
    }, {})
  })
}
