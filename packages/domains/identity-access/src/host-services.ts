import type { HostServiceClientFactory, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  AUTHENTICATED_CLOUD_CAPABILITY_IDS,
  AUTHENTICATED_CLOUD_HOST_SERVICE_ID,
  authenticatedCloudCommandEffect,
  cloudHostStatusInputSchema,
  cloudHostRequestSchema, cloudHostStatusSchema, cloudHostResponseSchema
} from './cloud-host-contract.js'

type Options = Readonly<{
  hostServiceClientModule?: string
  authorizeHostService?: (input: Readonly<{ packageName: string; version: string; serviceId: string }>) => boolean
  capabilities: {
    invoke(request: Readonly<{ actionId: string; input: unknown; invocationId?: string }>, context: Readonly<{
      caller: Readonly<Record<string, unknown>>
      ordinarySession?: Readonly<Record<string, unknown>>
      originalContext?: Readonly<Record<string, unknown>>
      delegation?: Readonly<{ actionId: string; invocationId: string; effect: string }>
      signal: AbortSignal
      assertCurrent(): void
    }>): Promise<unknown>
  }
}>

export function createDomainHostServiceResolver(rawOptions: Readonly<Record<string, unknown>>) {
  const options = rawOptions as Options
  const admitted = (packageName: string, version: string) => options.authorizeHostService?.({
    packageName, version, serviceId: AUTHENTICATED_CLOUD_HOST_SERVICE_ID
  }) === true
  return Object.freeze({
    serviceIds: Object.freeze([AUTHENTICATED_CLOUD_HOST_SERVICE_ID]),
    resolveClients(packageName: string, version: string, _generation: number): readonly HostServiceClientFactory[] {
      if (!admitted(packageName, version)) return Object.freeze([])
      const modulePath = options.hostServiceClientModule?.trim()
      if (!modulePath || !isAbsolute(modulePath)) return Object.freeze([])
      return Object.freeze([Object.freeze({ serviceId: AUTHENTICATED_CLOUD_HOST_SERVICE_ID,
        modulePath, exportName: 'createHostServiceClient',
        config: Object.freeze({ serviceId: AUTHENTICATED_CLOUD_HOST_SERVICE_ID }) })])
    },
    resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined {
      if (!admitted(packageName, version)) return undefined
      const authorize = (request: HostServiceRequest) => {
        if (!admitted(packageName, version) || request.owner.packageName !== packageName || request.owner.version !== version || request.owner.generation !== generation ||
          request.serviceId !== AUTHENTICATED_CLOUD_HOST_SERVICE_ID) throw new Error('Cloud Host service owner mismatch.')
        if (!request.assertCurrent || !request.signal) throw new Error('Cloud Host service requires a live Host principal lease and signal.')
        request.signal.throwIfAborted()
        request.assertCurrent()
        const authority = request.owner.authority
        const caller = authority.caller as Record<string, unknown> | undefined
        if (!caller || (caller.audience !== 'ui' && authority.ordinarySession === undefined)) {
          throw new Error('Cloud Host service requires an ordinary Session or authenticated UI caller.')
        }
        const input = request.operation === 'status'
          ? cloudHostStatusInputSchema.parse(request.input)
          : request.operation === 'execute' ? cloudHostRequestSchema.parse(request.input)
            : (() => { throw new Error('Cloud Host operation is not allowed.') })()
        const effect = 'payload' in input ? authenticatedCloudCommandEffect(input.payload.type) : 'read'
        if (!(authority.effect === effect || (effect === 'read' && authority.effect === 'external-write') ||
          (request.operation === 'status' && authority.effect === 'workspace-write'))) {
          throw new Error(`Cloud Host operation requires ${effect} authority.`)
        }
        return { input, caller, effect, actionId: request.operation === 'status' ? AUTHENTICATED_CLOUD_CAPABILITY_IDS.status
          : effect === 'read' ? AUTHENTICATED_CLOUD_CAPABILITY_IDS.read : AUTHENTICATED_CLOUD_CAPABILITY_IDS.write }
      }
      const invoke = async (request: HostServiceRequest) => {
        const { input, caller, effect, actionId } = authorize(request)
        const assertCurrent = () => { request.signal.throwIfAborted(); request.assertCurrent!(); authorize(request) }
        const idempotencyKey = 'payload' in input && 'idempotencyKey' in input.payload ? input.payload.idempotencyKey : undefined
        const result = await options.capabilities.invoke({ actionId, input,
          // Broker memoizes settled failures too; Cloud owns durable command deduplication.
          ...(typeof idempotencyKey === 'string' ? { invocationId: `identity-cloud:${randomUUID()}` } : {})
        }, {
          ...(effect === 'external-write' ? { delegation: {
            actionId: String(request.owner.authority.capabilityId ?? ''),
            invocationId: String(request.owner.authority.invocationId ?? ''), effect
          } } : {}),
          caller: {
            audience: caller.audience, callerId: caller.callerId,
            ...(caller.workspaceId === undefined ? {} : { workspaceId: caller.workspaceId }),
            ...(caller.workspaceLocator === undefined ? {} : { workspaceLocator: caller.workspaceLocator }),
            approvals: Array.isArray(caller.approvals) ? caller.approvals : []
          },
          ...(request.owner.authority.ordinarySession === undefined ? {} : { ordinarySession: request.owner.authority.ordinarySession as Record<string, unknown> }),
          ...(request.owner.authority.originalContext === undefined ? {} : { originalContext: request.owner.authority.originalContext as Record<string, unknown> }),
          signal: request.signal, assertCurrent
        })
        assertCurrent()
        return (request.operation === 'status' ? cloudHostStatusSchema : cloudHostResponseSchema).parse(result)
      }
      return Object.freeze({ [AUTHENTICATED_CLOUD_HOST_SERVICE_ID]: Object.freeze({
        authorize: (request: HostServiceRequest) => { authorize(request) },
        operations: Object.freeze({ status: invoke, execute: invoke })
      }) })
    }
  })
}
