import { expect, it, vi } from 'vitest'
import { createDocumentResources, type DocumentCapabilityContext } from './document-resources.js'
import type { SiYuanClient } from './client.js'

it('binds identical document IDs separately by project and reauthorizes every read and observation', async () => {
  let identity = 'user-a'
  let endpointSuffix = ''
  const id = '20261108120000-current'
  const client = vi.fn(async (spaceId?: string) => ({ baseUrl: `https://${spaceId}${endpointSuffix}.test`, client: {
    documentMetadata: async () => ({ id, box: '20261108120000-noteboo', hpath: '/Note', updated: '1' }),
    exportDocumentMarkdown: async () => ({ markdown: `Body of ${spaceId}`, updated: '2' })
  } as unknown as SiYuanClient }))
  const resources = createDocumentResources({ client, identity: () => identity,
    writer: () => { throw new Error('no write') }, comments: () => { throw new Error('no comment') } })
  const registrations: Parameters<DocumentCapabilityContext['issueResource']>[0][] = []
  const context = { issueResource: (value: typeof registrations[number]) => {
    registrations.push(value); return { token: 'test', semanticRevision: '1', expiresAt: '2099' }
  } }
  await resources.open({ spaceId: 'spc_00000000000000000000000000000001', id }, context)
  await resources.open({ spaceId: 'spc_00000000000000000000000000000002', id }, context)
  expect(registrations[0].resourceId).not.toBe(registrations[1].resourceId)
  const bound = { ...context, resource: { resourceId: registrations[0].resourceId } }
  await expect(resources.authorizeManagedDocument(bound)).resolves.toEqual({
    spaceId: 'spc_00000000000000000000000000000001', documentId: id, title: 'Note'
  })
  await expect(resources.read({}, bound)).resolves.toMatchObject({ markdown: 'Body of spc_00000000000000000000000000000001' })
  expect(client).toHaveBeenLastCalledWith('spc_00000000000000000000000000000001')
  await expect(resources.read({ spaceId: 'spc_00000000000000000000000000000002' }, bound)).rejects.toThrow()
  endpointSuffix = '-changed'
  await expect(resources.authorizeManagedDocument(bound)).rejects.toMatchObject({ code: 'invalid_configuration' })
  await expect(resources.read({}, bound)).rejects.toMatchObject({ code: 'invalid_configuration' })
  endpointSuffix = ''
  identity = 'user-b'
  await expect(resources.authorizeManagedDocument(bound)).rejects.toMatchObject({ code: 'unauthorized' })
  await expect(resources.read({}, bound)).rejects.toMatchObject({ code: 'unauthorized' })
  await expect(registrations[0].observe()).rejects.toMatchObject({ code: 'unauthorized' })
  identity = 'user-a'
  resources.dispose()
  await expect(resources.read({}, bound)).rejects.toMatchObject({ code: 'document_not_found' })
  await expect(registrations[0].observe()).rejects.toMatchObject({ code: 'document_not_found' })
})
