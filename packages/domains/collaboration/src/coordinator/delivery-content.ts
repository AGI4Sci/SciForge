import { randomUUID } from 'node:crypto'
import type { ObjectReference } from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorCapabilityInvocationContext, ProjectCoordinatorCapabilityOptions } from './main.js'

import { DELIVERY_OBJECT_RESOURCE_KIND, DELIVERY_CONTENT_ACTIONS, deliveryObjectOpenInputSchema, deliveryObjectOpenOutputSchema, deliveryObjectDescribeInputSchema, deliveryObjectDescribeOutputSchema, deliveryObjectReadRangeInputSchema, deliveryObjectReadRangeOutputSchema, type DeliveryObjectInput } from './delivery-content-contract.js'

type ResourceContext = ProjectCoordinatorCapabilityInvocationContext
export type DeliveryContentCapabilityOptions = ProjectCoordinatorCapabilityOptions

function requireIssueResource(
  context: ResourceContext
): NonNullable<ResourceContext['issueResource']> {
  if (!context.issueResource) {
    throw new Error('Delivery content requires the Host resource broker.')
  }
  return context.issueResource
}

/** A process-local Broker resource; every observation and byte read reauthorizes Cloud membership. */
export function createDeliveryContentCapabilities<Definition>(options: Readonly<{
  defineCapability(input: DeliveryContentCapabilityOptions): Definition
  read(input: DeliveryObjectInput): Promise<{ object: ObjectReference; body: Uint8Array }>
}>): readonly Definition[] {
  const bindings = new Map<string, DeliveryObjectInput>()
  const read = async (context: ResourceContext) => {
    if (context.resource?.resourceKind !== DELIVERY_OBJECT_RESOURCE_KIND) throw new Error('Delivery content requires its exact Broker resource.')
    const binding = bindings.get(context.resource.resourceId)
    if (!binding) throw new Error('Delivery content handle is no longer available.')
    context.assertPrincipalCurrent()
    const result = await options.read(binding)
    context.assertPrincipalCurrent()
    return result
  }
  const base = { version: '1.0.0' as const, audiences: ['ui'] as const,
    effect: 'read' as const, approval: 'none' as const,
    concurrency: { revision: 'none' as const, idempotency: 'none' as const }, tags: ['delivery', 'preview', 'object'] }
  return [
    options.defineCapability({ ...base, id: DELIVERY_CONTENT_ACTIONS.open, title: 'Open sealed Delivery object',
      description: 'Authorizes the exact immutable object and issues a private, principal-bound preview resource.',
      scope: 'global', producedResourceKinds: [DELIVERY_OBJECT_RESOURCE_KIND],
      inputSchema: deliveryObjectOpenInputSchema, outputSchema: deliveryObjectOpenOutputSchema,
      handler: async (raw, context) => {
        const input = deliveryObjectOpenInputSchema.parse(raw)
        context.assertPrincipalCurrent()
        const initial = await options.read(input)
        context.assertPrincipalCurrent()
        const resourceId = `delivery-object:${randomUUID()}`
        const semanticRevision = `${initial.object.objectId}:${initial.object.revision}:${initial.object.sha256}`
        bindings.set(resourceId, input)
        try {
          const resource = requireIssueResource(context)({ resourceId, resourceKind: DELIVERY_OBJECT_RESOURCE_KIND,
            audiences: ['ui'], semanticRevision,
            contentTransport: { describeActionId: DELIVERY_CONTENT_ACTIONS.describe, readRangeActionId: DELIVERY_CONTENT_ACTIONS.readRange },
            observe: async () => {
              const current = await options.read(input)
              if (current.object.sha256 !== initial.object.sha256 || current.object.revision !== initial.object.revision) {
                throw new Error('The sealed Delivery object identity changed.')
              }
              return { state: current.object, semanticRevision }
            },
            dispose: () => { bindings.delete(resourceId) }, retireAfterLastHandleExpires: true })
          return { output: { resource, object: initial.object } }
        } catch (error) {
          bindings.delete(resourceId)
          throw error
        }
      }
    }),
    options.defineCapability({ ...base, id: DELIVERY_CONTENT_ACTIONS.describe, title: 'Describe sealed Delivery bytes',
      description: 'Reauthorizes the current member and describes one exact sealed object.',
      scope: 'resource', resourceKinds: [DELIVERY_OBJECT_RESOURCE_KIND], inputSchema: deliveryObjectDescribeInputSchema,
      outputSchema: deliveryObjectDescribeOutputSchema,
      handler: async (_raw, context) => {
        const { object } = await read(context)
        return { output: { ok: true, descriptor: { file: { name: object.objectId, mimeType: object.mediaType },
          range: { available: true, size: object.byteCount, maxChunkBytes: 1_048_576, recommendedChunkBytes: 262_144 } } } }
      }
    }),
    options.defineCapability({ ...base, id: DELIVERY_CONTENT_ACTIONS.readRange, title: 'Read sealed Delivery byte range',
      description: 'Reauthorizes current Cloud membership and reads an integrity-checked immutable object range.',
      scope: 'resource', resourceKinds: [DELIVERY_OBJECT_RESOURCE_KIND],
      inputSchema: deliveryObjectReadRangeInputSchema, outputSchema: deliveryObjectReadRangeOutputSchema,
      handler: async (raw, context) => {
        const { range } = deliveryObjectReadRangeInputSchema.parse(raw)
        const { object, body } = await read(context)
        if (range.offset >= body.byteLength) throw new Error('Requested range is outside the immutable object.')
        const bytes = body.subarray(range.offset, Math.min(range.offset + range.length, body.byteLength))
        return { output: { ok: true, offset: range.offset, length: bytes.byteLength, size: object.byteCount,
          dataBase64: Buffer.from(bytes).toString('base64') } }
      }
    })
  ]
}
