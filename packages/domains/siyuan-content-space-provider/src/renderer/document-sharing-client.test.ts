import { expect, it, vi } from 'vitest'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { createDocumentSharingControls } from './index.js'
import { siyuanEditorDocumentContract } from '../editor-contract.js'
import { siyuanDocumentShareCreateContract, siyuanDocumentShareLookupContract, siyuanDocumentShareRevokeContract } from '../document-sharing-contract.js'

it('binds all share operations to the frozen current-document resource and exact shown revision', async () => {
  const resource = { opaque: 'current-document' }
  const result = { share: { shareId: 'share-one', permission: 'comment', status: 'active', revision: 3 }, shareUrl: 'https://cloud.test/share/one' }
  const invoke = vi.fn(async contract => contract === siyuanEditorDocumentContract ? { document: { resource } } : result)
  const observe = vi.fn(async () => ({ state: { title: 'Current title' } }))
  const host = { capabilityInvoker: { invoke, observe } } as unknown as DomainRendererHost
  const signal = new AbortController().signal
  const target = await createDocumentSharingControls(host).current({ sessionId: 'account-chat', spaceId: 'space-one' }, signal)
  expect(invoke).toHaveBeenCalledWith(siyuanEditorDocumentContract, { sessionId: 'account-chat', spaceId: 'space-one' }, { signal })
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'siyuan-document' }), resource, { signal })
  expect(target?.title).toBe('Current title')
  const links = await target!.list(signal)
  expect(invoke).toHaveBeenLastCalledWith(siyuanDocumentShareLookupContract, {}, { resource, signal })
  await target!.create('edit', signal)
  expect(invoke).toHaveBeenLastCalledWith(siyuanDocumentShareCreateContract, { permission: 'edit' }, { resource, signal, approval: { mode: 'confirmation' } })
  await target!.revoke(links[0], signal)
  expect(invoke).toHaveBeenLastCalledWith(siyuanDocumentShareRevokeContract, { shareId: 'share-one', expectedRevision: 3 }, { resource, signal, approval: { mode: 'confirmation' } })
  expect(invoke.mock.calls.filter(call => call[0] === siyuanEditorDocumentContract)).toHaveLength(1)
})

it('does not observe or expose share operations if no current document is available', async () => {
  const invoke = vi.fn(async () => ({ document: null }))
  const observe = vi.fn()
  const host = { capabilityInvoker: { invoke, observe } } as unknown as DomainRendererHost
  expect(await createDocumentSharingControls(host).current({ sessionId: 'chat', spaceId: 'space' }, new AbortController().signal)).toBeNull()
  expect(observe).not.toHaveBeenCalled()
})
