import type { DomainMainHost, DomainMainCapabilityInvocationContext } from '@sciforge/domain-sdk/host'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { SIYUAN_DOCUMENT_RESOURCE_KIND } from '../editor-contract.js'
import { siyuanDocumentShareLookupContract, siyuanDocumentShareCreateContract, siyuanDocumentShareRevokeContract } from '../document-sharing-contract.js'
import type { createDocumentResources, DocumentCapabilityContext } from './document-resources.js'

type Context = DocumentCapabilityContext & DomainMainCapabilityInvocationContext

export function createDocumentSharingCapabilities(options: {
  defineCapability: DomainMainHost['defineCapability']
  resources: Pick<ReturnType<typeof createDocumentResources>, 'authorizeManagedDocument'>
  transport: () => AuthenticatedCloudTransport
}) {
  const source = async (context: Context) => {
    if (context.caller.audience !== 'ui') throw new Error('Document sharing is managed by the User.')
    context.assertPrincipalCurrent()
    const { spaceId, documentId } = await options.resources.authorizeManagedDocument(context)
    context.assertPrincipalCurrent()
    return { spaceId, documentId }
  }
  return [
    options.defineCapability({
      id: siyuanDocumentShareLookupContract.actionId, version: '1.0.0', title: 'Inspect this document sharing link',
      description: 'Reads the owner-managed sharing link for this exact authorized cloud document. Does not grant access to its space.',
      audiences: ['ui'], scope: 'resource', resourceKinds: [SIYUAN_DOCUMENT_RESOURCE_KIND],
      effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' }, tags: ['siyuan', 'document', 'sharing'],
      inputSchema: siyuanDocumentShareLookupContract.inputSchema, outputSchema: siyuanDocumentShareLookupContract.outputSchema,
      handler: async (input: unknown, context: Context) => {
        siyuanDocumentShareLookupContract.inputSchema.parse(input)
        const output = await options.transport().lookupDocumentShare({ source: await source(context) }, { signal: context.signal })
        context.assertPrincipalCurrent()
        return { output }
      }
    }),
    ...(['create', 'revoke'] as const).map(mode => {
      const contract = mode === 'create' ? siyuanDocumentShareCreateContract : siyuanDocumentShareRevokeContract
      return options.defineCapability({
        id: contract.actionId, version: '1.0.0', title: mode === 'create' ? 'Share this cloud document' : 'Revoke this document sharing link',
        description: 'Manages access to this exact cloud document only. Personal or Project ownership is verified by Cloud; other documents and space access remain excluded.',
        audiences: ['ui'], scope: 'resource', resourceKinds: [SIYUAN_DOCUMENT_RESOURCE_KIND],
        effect: 'external-write', approval: 'confirmation', concurrency: { revision: 'none', idempotency: 'required' }, tags: ['siyuan', 'document', 'sharing'],
        inputSchema: contract.inputSchema, outputSchema: contract.outputSchema,
        handler: async (input: unknown, context: Context) => {
          if (!context.invocationId) throw new Error('Document sharing requires an invocation identity.')
          const binding = await source(context)
          const transport = options.transport()
          const output = mode === 'create'
            ? await transport.createDocumentShare({ ...siyuanDocumentShareCreateContract.inputSchema.parse(input), source: binding, idempotencyKey: context.invocationId }, { signal: context.signal })
            : await transport.revokeDocumentShare({ ...siyuanDocumentShareRevokeContract.inputSchema.parse(input), source: binding, idempotencyKey: context.invocationId }, { signal: context.signal })
          context.assertPrincipalCurrent()
          // The external share record has its own Cloud revision. This bound
          // document still observes the same body/comment metadata; creating
          // or revoking a link must not pretend that document content changed.
          return { output, changed: false }
        }
      })
    })
  ]
}
