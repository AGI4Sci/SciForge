import { randomUUID } from 'node:crypto'
import { DELIVERY_MAX_FILE_BYTES, type ObjectReference } from '@sciforge/collaboration-contracts'
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
  read(input: DeliveryObjectInput, options: Readonly<{ signal: AbortSignal }>): Promise<{ object: ObjectReference; body: Uint8Array }>
  authorize(input: DeliveryObjectInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<ObjectReference>
}>): readonly Definition[] {
  type Binding = { input: DeliveryObjectInput; object: ObjectReference; body: Uint8Array;
    assertPrincipalCurrent(): void; dispose(): void }
  const bindings = new Map<string, Binding>()
  const pending = new Set<Readonly<{ assertPrincipalCurrent(): void; abort(): void }>>()
  let retainedBytes = 0
  // A stale Principal cannot consume the new Principal's preview budget until
  // the Broker handle TTL. Retire only on the captured Host fence, never on a
  // transient Cloud authorization/network failure.
  const retireStaleBindings = () => {
    for (const binding of bindings.values()) {
      try { binding.assertPrincipalCurrent() } catch { binding.dispose() }
    }
    for (const operation of pending) {
      try { operation.assertPrincipalCurrent() } catch { operation.abort() }
    }
  }
  const assertCurrent = (binding: Binding, context?: ResourceContext) => {
    try { binding.assertPrincipalCurrent(); context?.assertPrincipalCurrent() } catch (error) {
      binding.dispose()
      throw error
    }
  }
  const assertSameObject = (expected: ObjectReference, current: ObjectReference) => {
    if (Object.keys(expected).some((key) => expected[key as keyof ObjectReference] !== current[key as keyof ObjectReference]) ||
      Object.keys(current).some((key) => current[key as keyof ObjectReference] !== expected[key as keyof ObjectReference])) {
      throw new Error('The sealed Delivery object identity changed.')
    }
  }
  const authorize = async (binding: Binding, context?: ResourceContext) => {
    assertCurrent(binding, context)
    let current: ObjectReference
    try { current = await options.authorize(binding.input, { signal: context?.signal }) } finally {
      assertCurrent(binding, context)
    }
    assertSameObject(binding.object, current)
    return current
  }
  const read = async (context: ResourceContext) => {
    if (context.resource?.resourceKind !== DELIVERY_OBJECT_RESOURCE_KIND) throw new Error('Delivery content requires its exact Broker resource.')
    const binding = bindings.get(context.resource.resourceId)
    if (!binding) throw new Error('Delivery content handle is no longer available.')
    context.signal?.throwIfAborted()
    await authorize(binding, context)
    context.signal?.throwIfAborted()
    if (bindings.get(context.resource.resourceId) !== binding) throw new Error('Delivery content handle is no longer available.')
    return binding
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
        context.signal?.throwIfAborted()
        context.assertPrincipalCurrent()
        retireStaleBindings()
        const controller = new AbortController()
        const abort = () => controller.abort(context.signal?.reason)
        context.signal?.addEventListener('abort', abort, { once: true })
        if (context.signal?.aborted) abort()
        // Same conservative transfer deadline as the Worker outbox. Abort the
        // actual transport and await settlement; a race must not free capacity
        // while an ignored/late read can still retain bytes.
        const deadline = setTimeout(() => controller.abort(new DOMException('Delivery preview read timed out.', 'TimeoutError')), 240_000)
        const operation = { assertPrincipalCurrent: context.assertPrincipalCurrent,
          abort: () => controller.abort(new Error('Delivery preview Principal changed.')) }
        pending.add(operation)
        let dispose = () => undefined as void
        try {
          controller.signal.throwIfAborted()
          const expected = { ...await options.authorize(input, { signal: controller.signal }) }
          const reservedBytes = expected.byteCount
          controller.signal.throwIfAborted()
          context.assertPrincipalCurrent()
          retireStaleBindings()
          if (!Number.isSafeInteger(expected.byteCount) || expected.byteCount < 0 ||
            expected.byteCount > DELIVERY_MAX_FILE_BYTES - retainedBytes) {
            throw new Error('Delivery preview buffer capacity is exhausted; release an existing resource before opening another.')
          }
          retainedBytes += reservedBytes
          const resourceId = `delivery-object:${randomUUID()}`
          let released = false
          dispose = () => {
            if (released) return
            released = true
            bindings.delete(resourceId)
            retainedBytes -= reservedBytes
          }
          const initial = await options.read(input, { signal: controller.signal })
          controller.signal.throwIfAborted()
          context.assertPrincipalCurrent()
          assertSameObject(expected, initial.object)
          if (initial.body.byteLength !== expected.byteCount) throw new Error('The sealed Delivery object byte count changed.')
          const semanticRevision = `${initial.object.objectId}:${initial.object.revision}:${initial.object.sha256}`
          bindings.set(resourceId, { input, object: { ...initial.object }, body: initial.body,
            assertPrincipalCurrent: context.assertPrincipalCurrent, dispose })
          const resource = requireIssueResource(context)({ resourceId, resourceKind: DELIVERY_OBJECT_RESOURCE_KIND,
            audiences: ['ui'], semanticRevision,
            contentTransport: { describeActionId: DELIVERY_CONTENT_ACTIONS.describe, readRangeActionId: DELIVERY_CONTENT_ACTIONS.readRange },
            observe: async () => {
              const binding = bindings.get(resourceId)
              if (!binding) throw new Error('Delivery content handle is no longer available.')
              const current = await authorize(binding)
              if (bindings.get(resourceId) !== binding) throw new Error('Delivery content handle is no longer available.')
              return { state: current, semanticRevision }
            },
            dispose, retireAfterLastHandleExpires: true })
          controller.signal.throwIfAborted()
          context.assertPrincipalCurrent()
          return { output: { resource, object: initial.object } }
        } catch (error) {
          dispose()
          throw error
        } finally {
          pending.delete(operation)
          clearTimeout(deadline)
          context.signal?.removeEventListener('abort', abort)
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
