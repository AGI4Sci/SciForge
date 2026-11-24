import { expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { createDocumentSharingCapabilities } from './document-sharing.js'

function fixture() {
  const source = { spaceId: 'spc_' + '1'.repeat(32), documentId: '20261109120000-documen' }
  const authorizeManagedDocument = vi.fn(async () => ({ ...source, title: 'Current document' }))
  const result = { share: null, shareUrl: null }
  const transport = { lookupDocumentShare: vi.fn(async () => result), createDocumentShare: vi.fn(async () => result), revokeDocumentShare: vi.fn(async () => result) }
  type Definition = { id: string; audiences: string[]; scope: string; handler: (input: unknown, context: unknown) => Promise<unknown> }
  const definitions = createDocumentSharingCapabilities({
    defineCapability: (value => value) as DomainMainHost['defineCapability'],
    resources: { authorizeManagedDocument }, transport: () => transport as never
  }) as Definition[]
  const context = { caller: { audience: 'ui' }, resource: { resourceId: 'bound-current-document' },
    invocationId: 'invocation-share-0001', assertPrincipalCurrent: vi.fn(), issueResource: vi.fn() }
  const invoke = (suffix: string, input: unknown, current: unknown = context) => definitions.find(value => value.id.endsWith(suffix))!.handler(input, current)
  return { source, authorizeManagedDocument, result, transport, definitions, context, invoke }
}

it('uses the same authorized document resource for share lookup, creation and revocation', async () => {
  const f = fixture()
  for (const definition of f.definitions) { expect(definition.scope).toBe('resource'); expect(definition.audiences).toEqual(['ui']) }
  await f.invoke('lookup', {})
  await expect(f.invoke('create', { permission: 'comment' })).resolves.toEqual({ output: f.result, changed: false })
  const shareId = 'dsh_' + 'a'.repeat(32)
  await expect(f.invoke('revoke', { shareId, expectedRevision: 3 })).resolves.toEqual({ output: f.result, changed: false })
  expect(f.authorizeManagedDocument).toHaveBeenCalledTimes(3)
  expect(f.transport.lookupDocumentShare).toHaveBeenCalledWith({ source: f.source }, { signal: undefined })
  expect(f.transport.createDocumentShare).toHaveBeenCalledWith({ source: f.source, permission: 'comment', idempotencyKey: f.context.invocationId }, { signal: undefined })
  expect(f.transport.revokeDocumentShare).toHaveBeenCalledWith({ source: f.source, shareId, expectedRevision: 3, idempotencyKey: f.context.invocationId }, { signal: undefined })
})

it('rejects caller document overrides, Agent sharing, stale authority and writes without invocation identity', async () => {
  const f = fixture()
  await expect(f.invoke('create', { permission: 'edit', source: { ...f.source, documentId: '20261109120000-another' } })).rejects.toThrow()
  await expect(f.invoke('lookup', {}, { ...f.context, caller: { audience: 'agent' } })).rejects.toThrow('User')
  await expect(f.invoke('create', { permission: 'comment' }, { ...f.context, invocationId: undefined })).rejects.toThrow('invocation identity')
  f.authorizeManagedDocument.mockRejectedValueOnce(new Error('Account changed'))
  await expect(f.invoke('revoke', { shareId: 'dsh_' + 'a'.repeat(32), expectedRevision: 1 })).rejects.toThrow('Account changed')
  expect(f.transport.createDocumentShare).not.toHaveBeenCalled()
  expect(f.transport.revokeDocumentShare).not.toHaveBeenCalled()
})
