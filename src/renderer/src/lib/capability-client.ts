import type { z } from 'zod'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityEffectSchema,
  capabilityIdSchema,
  capabilityInvocationRequestSchema,
  capabilityInvocationResultSchema,
  capabilityJsonValueSchema,
  capabilityObservationSchema,
  capabilityObserveRequestSchema,
  capabilityReadinessRequestSchema,
  capabilityReadinessSchema,
  type CapabilityEffect,
  type CapabilityReadiness
} from '@shared/capability-broker'
import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityObservation,
  DomainRendererCapabilityObservationContract
} from '@sciforge/domain-sdk/host'
import type { SciForgeApi } from '@shared/sciforge-api'

export type RendererCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: CapabilityEffect
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

export type RendererCapabilityInvokeOptions = Readonly<{
  workspaceId?: string
  resource?: DomainCapabilityResourceHandle
  expectedRevision?: string
  approval?: { mode: 'confirmation' }
}>

export type RendererCapabilityObserveOptions = Readonly<{
  workspaceId?: string
}>

type CapabilityTransport = Pick<SciForgeApi['capabilities'], 'readiness' | 'observe' | 'invoke'>

export type RendererCapabilityClientOptions = Readonly<{
  getTransport?: () => CapabilityTransport
  createInvocationId?: () => string
}>

export class RendererCapabilityClient {
  private readonly getTransport: () => CapabilityTransport
  private readonly createInvocationId: () => string

  constructor(options: RendererCapabilityClientOptions = {}) {
    this.getTransport = options.getTransport ?? defaultTransport
    this.createInvocationId = options.createInvocationId ?? defaultInvocationId
  }

  async readiness(
    requiredCapabilityIds: readonly string[],
    workspaceId?: string
  ): Promise<CapabilityReadiness> {
    const request = capabilityReadinessRequestSchema.parse({
      ...(workspaceId ? { workspaceId } : {}),
      expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
      requiredCapabilityIds: [...new Set(requiredCapabilityIds.map((id) => capabilityIdSchema.parse(id)))].sort()
    })
    return capabilityReadinessSchema.parse(await this.getTransport().readiness(request))
  }

  async observe<TState>(
    contract: DomainRendererCapabilityObservationContract<TState>,
    resource: DomainCapabilityResourceHandle,
    options: RendererCapabilityObserveOptions = {}
  ): Promise<DomainRendererCapabilityObservation<TState>> {
    const request = capabilityObserveRequestSchema.parse({ resource })
    const observation = capabilityObservationSchema.parse(await this.getTransport().observe({
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      request
    }))
    if (observation.resourceKind !== contract.resourceKind) {
      throw new Error(
        `Capability observation resource kind mismatch: expected "${contract.resourceKind}", received "${observation.resourceKind}".`
      )
    }
    return {
      resource: observation.resource,
      resourceRef: observation.resourceRef,
      resourceKind: observation.resourceKind,
      semanticRevision: observation.semanticRevision,
      ...(observation.layoutRevision ? { layoutRevision: observation.layoutRevision } : {}),
      observedAt: observation.observedAt,
      state: contract.stateSchema.parse(observation.state)
    }
  }

  async invoke<TInput, TOutput>(
    contract: RendererCapabilityContract<TInput, TOutput>,
    input: TInput,
    options: RendererCapabilityInvokeOptions = {}
  ): Promise<TOutput> {
    const actionId = capabilityIdSchema.parse(contract.actionId)
    const effect = capabilityEffectSchema.parse(contract.effect)
    const parsedInput = contract.inputSchema.parse(input)
    const jsonInput = capabilityJsonValueSchema.parse(parsedInput)
    const readiness = await this.readiness([actionId], options.workspaceId)
    if (readiness.status !== 'ready') throw new Error(readiness.message)

    const request = capabilityInvocationRequestSchema.parse({
      actionId,
      input: jsonInput,
      ...(options.resource ? { resource: options.resource } : {}),
      ...(options.expectedRevision === undefined
        ? {}
        : { expectedRevision: options.expectedRevision }),
      ...(effect === 'read' ? {} : { invocationId: this.createInvocationId() })
    })
    const result = capabilityInvocationResultSchema.parse(await this.getTransport().invoke({
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      request,
      ...(options.approval ? { approval: options.approval } : {})
    }))
    if (result.actionId !== actionId) {
      throw new Error(`Capability result action mismatch: expected "${actionId}", received "${result.actionId}".`)
    }
    if (request.invocationId && result.invocationId !== request.invocationId) {
      throw new Error(`Capability result invocation mismatch for "${actionId}".`)
    }
    return contract.outputSchema.parse(result.output)
  }
}

export const rendererCapabilityClient = new RendererCapabilityClient()

function defaultTransport(): CapabilityTransport {
  const transport = window.sciforge?.capabilities
  if (!transport) throw new Error('Capability transport is unavailable.')
  return transport
}

function defaultInvocationId(): string {
  return `ui_${globalThis.crypto.randomUUID()}`
}
