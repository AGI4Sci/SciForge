import { createHash } from 'node:crypto'
import type { DomainCapabilityResourceHandle } from '@sciforge/domain-sdk/host'
import { SIYUAN_DOCUMENT_RESOURCE_KIND, siyuanDocumentOpenRequestSchema, siyuanDocumentReadRequestSchema } from '../editor-contract.js'
import { SiYuanClient, SiYuanError } from './client.js'
import { createDocumentReader } from './reader.js'
import type { createDocumentWriter } from './documents.js'
import type { createCommentService, CommentMutation } from './comments.js'

type DocumentState = Awaited<ReturnType<ReturnType<typeof createDocumentReader>['describe']>>
type Registration = Readonly<{
  resourceId: string; resourceKind: string; semanticRevision: string; audiences: readonly ('ui' | 'agent')[]
  observe: () => Promise<{ state: DocumentState; semanticRevision: string }>
}>
export type DocumentCapabilityContext = Readonly<{
  resource?: { resourceId: string }; signal?: AbortSignal
  invocationId?: string
  issueResource: (registration: Registration) => DomainCapabilityResourceHandle
}>
type Binding = { id: string; identity: string; spaceId?: string; endpoint: string; editVersion: number; registration: Registration }

/** The handle binds account, project, endpoint and document. Each operation
 * reauthorizes through the same project-session resolver; a later UI selection
 * can never retarget an already issued resource. */
export function createDocumentResources(options: {
  client: (spaceId?: string) => Promise<{ client: SiYuanClient; baseUrl: string }>
  writer: () => ReturnType<typeof createDocumentWriter>
  comments: () => ReturnType<typeof createCommentService>
  identity: () => string
}) {
  const bindings = new Map<string, Binding>()
  const assertCurrent = (identity: string) => {
    if (options.identity() !== identity) throw new SiYuanError('unauthorized')
  }
  const readerFor = (binding: Pick<Binding, 'identity' | 'spaceId' | 'endpoint'>) => createDocumentReader({
    client: async () => {
      assertCurrent(binding.identity)
      const value = await options.client(binding.spaceId)
      assertCurrent(binding.identity)
      if (value.baseUrl !== binding.endpoint) throw new SiYuanError('invalid_configuration')
      return value
    }
  })
  const bound = (context: DocumentCapabilityContext) => {
    const binding = context.resource && bindings.get(context.resource.resourceId)
    if (!binding) throw new SiYuanError('document_not_found')
    assertCurrent(binding.identity)
    return binding
  }
  const guard = (binding: Binding, context: DocumentCapabilityContext) => ({ identity: binding.identity,
    spaceId: binding.spaceId, endpoint: binding.endpoint,
    assertCurrent: () => assertCurrent(binding.identity), signal: context.signal, invocationId: context.invocationId })
  const revision = (updated: string, binding: Binding) => JSON.stringify([updated, binding.editVersion])
  return {
    async open(raw: unknown, context: DocumentCapabilityContext) {
      const request = siyuanDocumentOpenRequestSchema.parse(raw)
      const identity = options.identity()
      const destination = await options.client(request.spaceId)
      assertCurrent(identity)
      const document = await createDocumentReader({ client: async () => destination }).describe(request, context.signal)
      assertCurrent(identity)
      const resourceId = `siyuan-document:${createHash('sha256').update(JSON.stringify([identity, request.spaceId, destination.baseUrl, document.id])).digest('hex')}`
      let binding = bindings.get(resourceId)
      if (!binding) {
        const entry: Binding = { id: document.id, identity, spaceId: request.spaceId, endpoint: destination.baseUrl, editVersion: 0,
          registration: { resourceId, resourceKind: SIYUAN_DOCUMENT_RESOURCE_KIND, semanticRevision: JSON.stringify([document.updated, 0]), audiences: ['ui', 'agent'],
            observe: async () => {
              if (bindings.get(resourceId) !== entry) throw new SiYuanError('document_not_found')
              const state = await readerFor(entry).describe({ id: entry.id })
              assertCurrent(identity)
              return { state, semanticRevision: revision(state.updated, entry) }
            } }
        }
        bindings.set(resourceId, entry)
        binding = entry
      }
      return { resource: context.issueResource({ ...binding.registration, semanticRevision: revision(document.updated, binding) }) }
    },
    async read(raw: unknown, context: DocumentCapabilityContext) {
      const binding = bound(context)
      const request = siyuanDocumentReadRequestSchema.parse(raw)
      const output = await readerFor(binding).read({ ...request, id: binding.id }, context.signal)
      assertCurrent(binding.identity)
      return output
    },
    async authorizeManagedDocument(context: DocumentCapabilityContext) {
      const binding = bound(context)
      if (!binding.spaceId) throw new SiYuanError('space_required')
      const document = await readerFor(binding).describe({ id: binding.id }, context.signal)
      assertCurrent(binding.identity)
      return { spaceId: binding.spaceId, documentId: binding.id, title: document.title }
    },
    async edit(raw: unknown, mode: 'replace' | 'append' | 'patch', context: DocumentCapabilityContext) {
      const binding = bound(context)
      const output = await options.writer().edit(binding.id, raw, mode, guard(binding, context))
      if (output.changed) binding.editVersion++
      return { output, changed: output.changed, semanticRevision: revision(output.updated, binding) }
    },
    async comments(raw: unknown, mode: 'list' | CommentMutation, context: DocumentCapabilityContext) {
      const binding = bound(context)
      if (mode === 'list') return { output: await options.comments().list(binding.id, raw, guard(binding, context)) }
      const output = await options.comments().mutate(binding.id, mode, raw, guard(binding, context))
      binding.editVersion++
      return { output, changed: true, semanticRevision: revision(output.updated, binding) }
    },
    dispose() { bindings.clear() }
  }
}
