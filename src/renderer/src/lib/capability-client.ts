import type { z } from 'zod'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityEffectSchema,
  capabilityIdSchema,
  capabilityInvocationRequestSchema,
  capabilityInvocationResultSchema,
  capabilityJsonValueSchema,
  capabilityReadinessRequestSchema,
  capabilityReadinessSchema,
  type CapabilityEffect,
  type CapabilityReadiness
} from '@shared/capability-broker'
import type { SciForgeApi } from '@shared/sciforge-api'

export type RendererCapabilityContract<TInput, TOutput> = Readonly<{
  actionId: string
  effect: CapabilityEffect
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
}>

export type RendererCapabilityInvokeOptions = Readonly<{
  workspaceId?: string
  approval?: { mode: 'confirmation' }
}>

type CapabilityTransport = Pick<SciForgeApi['capabilities'], 'readiness' | 'invoke'>

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
