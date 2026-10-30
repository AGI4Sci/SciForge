import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityInvoker,
  DomainRendererCapabilityObservation
} from '@sciforge/domain-sdk/host'
import {
  CHANGE_INSPECTOR_CAPABILITY_IDS,
  changeInspectorObservationContract,
  changeInspectorOpenInputSchema,
  changeInspectorOpenOutputSchema,
  type ChangeInspectorOpenInput,
  type ChangeInspectorSnapshot
} from '../contract.js'

const contracts = Object.freeze({
  openSession: {
    actionId: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession,
    effect: 'read' as const,
    inputSchema: changeInspectorOpenInputSchema,
    outputSchema: changeInspectorOpenOutputSchema
  },
  observation: changeInspectorObservationContract
})

export type ChangeInspectorCapabilityClient = Readonly<{
  openSession(
    input: ChangeInspectorOpenInput,
    workspaceId?: string
  ): Promise<DomainCapabilityResourceHandle>
  observe(
    resource: DomainCapabilityResourceHandle,
    workspaceId?: string
  ): Promise<DomainRendererCapabilityObservation<ChangeInspectorSnapshot>>
  subscribe?(
    resourceRef: string,
    listener: () => void,
    workspaceId?: string
  ): Promise<() => void>
}>

export function createChangeInspectorCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ChangeInspectorCapabilityClient {
  const subscribe = invoker.subscribe
    ? (
        resourceRef: string,
        listener: () => void,
        workspaceId?: string
      ): Promise<() => void> => invoker.subscribe!(
        resourceRef,
        listener,
        workspaceId ? { workspaceId } : {}
      )
    : undefined
  return Object.freeze({
    async openSession(input, workspaceId) {
      const output = await invoker.invoke(
        contracts.openSession,
        input,
        workspaceId ? { workspaceId } : {}
      )
      return output.resource
    },
    observe: (resource, workspaceId) => invoker.observe(
      contracts.observation,
      resource,
      workspaceId ? { workspaceId } : {}
    ),
    ...(subscribe ? { subscribe } : {})
  })
}
