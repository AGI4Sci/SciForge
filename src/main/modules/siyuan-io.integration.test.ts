import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID, defineAuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { CURRENT_USER_SERVICE_ID } from '@sciforge/domain-identity-access/current-user-profile'
import type { CloudSpace } from '@sciforge/cloud-spaces-contracts'
import type { DocumentCommentStore, DocumentSource, DocumentCommentMutateRequest, DocumentShareManageResponse } from '@sciforge/document-sharing-contracts'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import { createDomainMainEntry } from '@sciforge/domain-siyuan-content-space-provider/main'
import { siyuanDocumentReadResultSchema } from '@sciforge/domain-siyuan-content-space-provider/contract'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { createCapabilityAgentToolSurface } from '../capabilities/agent-tools'
import { CapabilityBroker } from '../capabilities/broker'
import { capabilityResourceHandleSchema } from '../../shared/capability-broker'
import { defineCapability } from '../capabilities/registry'
import { withBoundedToolResults } from '../runtime/agent-runtime/model-visible-tool-result'
import { createApplicationCapabilityRegistry } from './application-composition'
import { DomainModuleCatalog } from './catalog'
import { listMainAgentRoutingContributions } from './runtime-contributions'

const electron = vi.hoisted(() => ({ sessions: new Map<string, { fetch: typeof fetch }>() }))
vi.mock('node:module', async importOriginal => {
  const actual = await importOriginal<typeof import('node:module')>()
  return { ...actual, createRequire: (url: string | URL) => {
    const require = actual.createRequire(url)
    return (id: string) => id === 'electron' ? { session: { fromPartition: (partition: string) => {
      let session = electron.sessions.get(partition)
      if (!session) {
        let cookie = ''
        session = { fetch: async (input, init) => {
          const headers = new Headers(init?.headers)
          if (cookie) headers.set('cookie', cookie)
          const response = await fetch(input, { ...init, headers })
          const issued = response.headers.get('set-cookie')
          if (issued) cookie = issued.split(';')[0]
          return response
        } }
        electron.sessions.set(partition, session)
      }
      return session
    } } } : require(id)
  } }
})

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.unstubAllEnvs(); electron.sessions.clear(); for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const notebook = '20261109120000-abcdefg', sourceId = '20261109120000-hijklmn', createdId = '20261109120000-opqrstu'

async function fixture(managed = false) {
  vi.stubEnv('SIYUAN_BASE_URL', '')
  vi.stubEnv('SIYUAN_API_TOKEN', '')
  const root = await mkdtemp(join(tmpdir(), 'sciforge-notes-broker-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const longBody = ('中文🧪内容，包含换行。\n').repeat(3000)
  const documents = new Map([[sourceId, { path: '/团队/实验记录', markdown: longBody }]])
  const otherDocuments = new Map([[sourceId, { path: '/团队/实验记录', markdown: 'Project-only document' }]])
  const nestedId = '20261109120000-xyzabcd'
  if (managed) documents.set(nestedId, { path: '/团队/实验记录/子文档', markdown: 'Nested document' })
  const personalId = `spc_${'a'.repeat(32)}`, projectId = `spc_${'b'.repeat(32)}`
  const attrs = new Map<string, Record<string, string>>()
  const commentStores = new Map<string, DocumentCommentStore>()
  const cloudCommentWrites: DocumentCommentMutateRequest[] = []
  const readComments = (source: DocumentSource) => {
    expect([personalId, projectId]).toContain(source.spaceId)
    expect(source.documentId).toBe(sourceId)
    const store: DocumentCommentStore = structuredClone(commentStores.get(`${source.spaceId}:${source.documentId}`) ?? { v: 1, comments: {} })
    return { store, revision: createHash('sha256').update(JSON.stringify(store)).digest('hex') }
  }
  let writes = 0, calls = 0, dropWriteReply = false, denied = false, invalidResponse = false
  let userId = 'usr_CloudUser000001'
  const startKernel = async (docs: typeof documents, label: string) => {
    const server = createServer(async (request, response) => {
      calls++
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString())
      if (managed && request.url === '/_sciforge/session') {
        if (input.code !== label.repeat(40)) { response.writeHead(403).end(); return }
        response.setHeader('set-cookie', `space_session=${label}; HttpOnly; SameSite=Strict`)
        response.writeHead(204).end(); return
      }
      if (denied || (managed ? request.headers.cookie !== `space_session=${label}` : request.headers.authorization !== 'Token fixture-private')) {
        response.writeHead(401).end(); return
      }
      if (managed) {
        expect(request.headers.authorization).toBeUndefined()
        expect(request.headers.origin).toBe(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
      }
      if (invalidResponse) { response.end('{"unexpected":true}'); return }
      const path = request.url!.replace('/notes', '')
      let data: unknown
      if (path === '/api/system/version') data = 'fixture'
      else if (path === '/api/notebook/lsNotebooks') data = { notebooks: [{ id: notebook, name: '团队', closed: false }] }
      else if (path === '/api/query/sql') {
        if (input.stmt.includes('FROM attributes')) data = []
        else if (input.stmt.includes('SELECT id, root_id')) data = [{ id: sourceId, root_id: sourceId }]
        else data = [...docs].filter(([id]) => !input.stmt.includes(' AND id = ') || input.stmt.includes(id))
          .map(([id, doc]) => ({ id, box: notebook, hpath: doc.path, updated: '20261109120000' }))
      } else if (path === '/api/filetree/listDocsByPath') {
        data = { box: notebook, path: input.path, files: input.path === '/' ? [
          { id: sourceId, name: '实验记录.sy', path: `/${sourceId}.sy`, subFileCount: label === 'a' ? 1 : 0 }
        ] : input.path === `/${sourceId}.sy` && label === 'a' ? [
          { id: nestedId, name: '子文档.sy', path: `/${sourceId}/${nestedId}.sy`, subFileCount: 0 }
        ] : [] }
      } else if (path === '/api/attr/getBlockAttrs') data = attrs.get(`${label}:${input.id}`) ?? {}
      else if (path === '/api/attr/setBlockAttrs') { expect(managed).toBe(false); writes++; attrs.set(`${label}:${input.id}`, input.attrs); data = null }
      else if (path === '/api/filetree/getIDsByHPath') data = [...docs].filter(([, doc]) => doc.path === input.path).map(([id]) => id)
      else if (path === '/api/filetree/createDocWithMd') {
        writes++
        docs.set(createdId, { path: input.path, markdown: input.markdown })
        if (dropWriteReply) { dropWriteReply = false; response.destroy(); return }
        data = createdId
      } else if (path === '/api/block/appendBlock' || path === '/api/block/updateBlock') {
        writes++
        const doc = docs.get(input.parentID ?? input.id)!
        doc.markdown = path.endsWith('appendBlock') ? doc.markdown.trimEnd() + '\n\n' + input.data : input.data
        data = [{ doOperations: [{ id: input.parentID ?? input.id }] }]
      } else if (path === '/api/filetree/getHPathByID') data = docs.get(input.id)!.path
      else if (path === '/api/block/getChildBlocks') data = docs.get(input.id)!.markdown.split('\n\n').map((text, index) => ({ id: `20261109120000-b${String(index).padStart(6, '0')}`, type: text.startsWith('#') ? 'h' : 'p' }))
      else if (path === '/api/block/getBlockKramdown') {
        const doc = docs.get(input.id)
        const blockIndex = /^20261109120000-b(\d{6})$/u.exec(input.id)?.[1]
        const markdown = doc?.markdown ?? docs.get(sourceId)!.markdown.split('\n\n')[Number(blockIndex)]
        data = { id: input.id, kramdown: `${markdown}\n{: id="${input.id}" updated="20261109120000"}\n`, conditionalWriteVersion: 1 }
      } else if (path === '/api/block/batchUpdateBlock') {
        writes++
        const doc = docs.get(sourceId)!, pieces = doc.markdown.split('\n\n')
        for (const block of input.blocks) pieces[Number(block.id.slice(-6))] = block.data.replace(/\n\{: .*\}$/u, '').trimEnd()
        doc.markdown = pieces.join('\n\n')
        data = [{ doOperations: input.blocks }]
      } else { response.writeHead(404).end(); return }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ code: 0, data }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>((resolve, reject) => { if (!server.listening) { resolve(); return }; server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }))
    return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` }
  }
  const firstKernel = await startKernel(documents, 'a')
  const secondKernel = managed ? await startKernel(otherDocuments, 'b') : null
  const server = firstKernel.server
  const baseUrl = firstKernel.origin + (managed ? '' : '/notes')
  const spaces: CloudSpace[] = [
    { spaceId: personalId, scope: { kind: 'personal', ownerUserId: 'usr_CloudUser000001' }, status: 'ready', revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { spaceId: projectId, scope: { kind: 'project', projectId: 'prj_one' }, status: 'ready', revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  ]
  let share: DocumentShareManageResponse = { share: null, shareUrl: null }
  const createShare = vi.fn(async (input: { source: DocumentSource; permission: 'comment' | 'edit' }) => {
    share = { share: { shareId: `dsh_${'c'.repeat(32)}`, source: input.source, permission: input.permission,
      status: 'active', revision: 1, createdAt: '2026-11-10T00:00:00.000Z', revokedAt: null },
      shareUrl: `https://cloud.example.test/share/dsh_${'c'.repeat(32)}#key=${'x'.repeat(43)}` }
    return structuredClone(share)
  })
  const revokeShare = vi.fn(async () => {
    if (!share.share) throw new Error('Missing fixture share')
    share = { ...share, share: { ...share.share, status: 'revoked', revision: 2, revokedAt: '2026-11-10T01:00:00.000Z' } }
    return structuredClone(share)
  })
  const transport = defineAuthenticatedCloudTransport({
    status: () => ({ state: 'ready', userId, deviceId: 'dev_CloudDevice0001', deviceRevision: 1, baseUrl: 'https://cloud.example.test' }),
    listCloudSpaces: async () => ({ spaces }),
    ensureCloudSpace: async input => ({ space: spaces.find(space => space.scope.kind === input.scope.kind)! }),
    createCloudSpaceSession: async ({ spaceId }) => {
      if (![personalId, projectId].includes(spaceId)) throw new Error('Unknown space')
      const origin = spaceId === personalId ? firstKernel.origin : secondKernel!.origin
      return { spaceId, editorUrl: `${origin}/`, bootstrapUrl: `${origin}/_sciforge/session`,
        bootstrapCode: (spaceId === personalId ? 'a' : 'b').repeat(40), expiresAt: new Date(Date.now() + 600_000).toISOString() }
    },
    lookupDocumentShare: async () => structuredClone(share),
    createDocumentShare: createShare,
    revokeDocumentShare: revokeShare,
    readDocumentComments: async ({ source }) => readComments(source),
    mutateDocumentComments: async input => {
      const { source, mutation } = input
      const snapshot = readComments(source)
      expect(input.expectedRevision).toBe(snapshot.revision)
      expect(input.idempotencyKey.length).toBeGreaterThanOrEqual(8)
      const store = snapshot.store
      const authored = { author: 'Researcher', authorId: `sciforge:${userId}`, createdAt: 1 }
      let commentId: string, replyId: string | null = null
      if (mutation.kind === 'create') {
        commentId = 'c-cloud'
        store.comments[commentId] = { ...authored, blockId: mutation.blockId, text: mutation.text, quote: mutation.quote, replies: {} }
      } else if (mutation.kind === 'reply.create') {
        commentId = mutation.commentId
        replyId = 'r-cloud'
        store.comments[commentId].replies[replyId] = { ...authored, parent: commentId, text: mutation.text }
      } else if (mutation.kind === 'reply.update') {
        commentId = mutation.commentId
        replyId = mutation.replyId
        const reply = store.comments[commentId].replies[replyId]
        expect(reply.authorId).toBe(authored.authorId)
        reply.text = mutation.text
        reply.updatedAt = 2
      } else throw new Error(`Unexpected fixture comment mutation ${mutation.kind}`)
      cloudCommentWrites.push(structuredClone(input))
      commentStores.set(`${source.spaceId}:${source.documentId}`, store)
      writes++
      return { ...readComments(source), result: { commentId, replyId } }
    },
    stageObject: async () => { throw new Error('Unused') }, readObject: async () => { throw new Error('Unused') },
    execute: async () => { throw new Error('Unused') }
  })
  let revision = 0
  let value: Awaited<ReturnType<DomainMainPackageSettingsHost['read']>>['value'] = null
  const secrets = new Map<string, string>()
  const host = {
    getUserDataDir: () => root,
    internalServices: { acquire: (id: string) => {
      if (id === AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID) return transport
      if (id === CURRENT_USER_SERVICE_ID) return { read: () => ({ state: 'signed-in', userId, displayName: 'Researcher' }) }
      throw new Error(`Unexpected service ${id}`)
    } },
    defineCapability: (options: unknown) => defineCapability(options as never),
    packageSettings: {
      read: async () => ({ revision, value }),
      write: async (next, expected) => {
        if (expected !== revision) throw new Error('CAS')
        return { revision: ++revision, value: value = next }
      },
      clear: async () => ({ revision: ++revision, value: value = null })
    } satisfies DomainMainPackageSettingsHost,
    packageSecrets: {
      has: async (key: string) => secrets.has(key), read: async (key: string) => secrets.get(key) ?? null,
      write: async (key: string, token: string) => { secrets.set(key, token) }, remove: async (key: string) => { secrets.delete(key) }
    }
  } as unknown as DomainMainHost
  let sequence = 0
  const approval = vi.fn(async (): Promise<'allowed' | 'denied'> => 'allowed')
  const start = () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerBatch([createDomainMainEntry(host)])
    const broker = new CapabilityBroker(createApplicationCapabilityRegistry(catalog, {} as AppCapabilityDependencies))
    const surface = createCapabilityAgentToolSurface({ broker, resolveCaller: () => ({ audience: 'agent', callerId: 'notes-test', approvals: [] }), requestApproval: approval })
    const artifacts = new Map<string, unknown>()
    const bounded = withBoundedToolResults(surface, async (_request, result) => {
      const ref = `artifact-${artifacts.size}`
      artifacts.set(ref, result.value)
      return ref
    })
    const context = () => ({ requestId: 'r', runtimeId: 'test', threadId: 'notes-test', turnId: 'turn', callId: `call-${++sequence}` })
    return { broker, catalog, async invoke(capabilityId: string, input: Record<string, unknown>, resourceRef?: string) {
      if (resourceRef) await bounded.call({ name: 'sciforge_observe', arguments: { resourceRef }, context: context() })
      const found = await bounded.call({ name: 'sciforge_discover', arguments: { capabilityId, includeSchema: true }, context: context() })
      const descriptors = found.value as { operationRef: string; inputShape: unknown }[]
      expect(descriptors).toHaveLength(1)
      expect(descriptors[0].operationRef).toMatch(/^op_/u)
      expect(descriptors[0].inputShape).toBeDefined()
      const result = await bounded.call({ name: 'sciforge_invoke', arguments: { operationRef: descriptors[0].operationRef, input, ...(resourceRef ? { resourceRef } : {}) }, context: context() })
      const visible = JSON.parse(result.modelContent!)
      // Production delivery stores large outputs and instructs history reading;
      // recover that same stored result without executing the action again.
      const canonical = visible._delivery ? artifacts.get(visible._delivery.nextRead.arguments.artifactRef) : visible
      expect(JSON.stringify([visible, canonical])).not.toContain('fixture-private')
      return canonical as { output: unknown }
    } }
  }
  const first = start()
  await first.broker.invoke({ audience: 'ui', callerId: 'settings' }, {
    actionId: 'siyuan.service.configure', invocationId: 'configure-1', input: managed ? { mode: 'managed' } : { mode: 'custom', url: baseUrl, token: 'fixture-private' }
  })
  return { start, first, approval, documents, otherDocuments, personalId, projectId, nestedId, attrs, cloudCommentWrites, createShare, revokeShare,
    changeAccount() { userId = 'usr_CloudUser000002' }, longBody, baseUrl, get writes() { return writes }, get calls() { return calls },
    dropNextWriteReply() { dropWriteReply = true }, deny() { denied = true }, invalid() { invalidResponse = true },
    stop: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }) }
}

it('uses persisted configuration, governed discovery, paged reads and confirmed verified writes after restart', async () => {
  const f = await fixture(), app = f.start()
  expect(listMainAgentRoutingContributions(app.catalog).some(item => item.intent === 'cloud-notes')).toBe(true)
  await expect(app.invoke('siyuan.service.check', {})).resolves.toMatchObject({ output: { verifiedRead: true, notebookCount: 1 } })
  const search = await app.invoke('siyuan.document.search', { query: '实验', notebookName: '团队' })
  expect(search).toMatchObject({ output: { documents: [{ id: sourceId }] } })
  const opened = await app.invoke('siyuan.document.open', { id: sourceId })
  const resourceRef = (opened.output as { resourceRef: string }).resourceRef
  expect(resourceRef).toMatch(/^res_/u)
  let collected = '', offset = 0, contentHash: string | undefined
  for (;;) {
    const result = await app.invoke('siyuan.document.read', { offset, ...(contentHash ? { contentHash } : {}) }, resourceRef)
    const page = siyuanDocumentReadResultSchema.parse(result.output)
    collected += page.markdown
    contentHash = page.contentHash
    if (page.nextOffset === null) break
    offset = page.nextOffset
  }
  expect(collected).toBe(`${f.longBody}\n`)
  expect(f.writes).toBe(0)
  const request = { title: '测试结果', notebookName: '团队', markdown: '# 已验证\n\n读写成功。' }
  await expect(app.invoke('siyuan.document.compose', request)).resolves.toMatchObject({ output: { id: createdId, verified: true } })
  expect(f.approval).toHaveBeenCalledOnce()
  await expect(f.start().invoke('siyuan.document.compose', request)).resolves.toMatchObject({ output: { verified: true } })
  expect(f.writes).toBe(1)
  const created = await app.invoke('siyuan.document.open', { id: createdId })
  const createdRef = (created.output as { resourceRef: string }).resourceRef
  await expect(app.invoke('siyuan.document.read', {}, createdRef)).resolves.toMatchObject({ output: { markdown: `${request.markdown}\n` } })
  await expect(app.invoke('siyuan.document.compose', { ...request, markdown: 'different content' })).rejects.toMatchObject({ code: 'handler_failed', details: { reasonCode: 'document_conflict' } })
  expect(f.writes).toBe(1)
}, 15_000)

it('reconciles a committed write with a lost HTTP reply through a fresh broker without duplicate creation', async () => {
  const f = await fixture()
  f.dropNextWriteReply()
  const request = { title: '回复丢失', markdown: '正文', notebookName: '团队' }
  await expect(f.first.invoke('siyuan.document.compose', request)).rejects.toMatchObject({ code: 'handler_failed', details: { reasonCode: 'outcome_unknown' } })
  await expect(f.start().invoke('siyuan.document.compose', request)).resolves.toMatchObject({ output: { verified: true } })
  expect(f.writes).toBe(1)
})

it.each(['denied', 'invalid', 'offline'])('returns actionable failure for %s without claiming successful I/O', async (mode) => {
  const f = await fixture()
  if (mode === 'denied') f.deny()
  else if (mode === 'invalid') f.invalid()
  else await f.stop()
  const expected = mode === 'denied' ? 'unauthorized' : mode === 'invalid' ? 'provider_contract_violation' : 'provider_unavailable'
  await expect(f.first.invoke('siyuan.document.search', { query: '实验' })).rejects.toMatchObject({ code: 'handler_failed', details: { reasonCode: expected } })
  expect(f.writes).toBe(0)
})


it('governs project-document body edits through the opened resource and rejects stale body hashes', async () => {
  const f = await fixture(), app = f.first
  const opened = await app.invoke('siyuan.document.open', { id: sourceId })
  const resourceRef = (opened.output as { resourceRef: string }).resourceRef
  const read = await app.invoke('siyuan.document.read', {}, resourceRef)
  const before = siyuanDocumentReadResultSchema.parse(read.output)
  await expect(app.invoke('siyuan.document.append', { markdown: 'Appended', expectedContentHash: before.contentHash }, resourceRef))
    .resolves.toMatchObject({ output: { mode: 'append', changed: true } })
  expect(f.approval).toHaveBeenCalledOnce()
  expect(f.writes).toBe(1)
  await expect(app.invoke('siyuan.document.replace', { markdown: 'Stale replacement', expectedContentHash: before.contentHash }, resourceRef))
    .rejects.toMatchObject({ code: 'handler_failed', details: { reasonCode: 'document_changed' } })
  expect(f.writes).toBe(1)
})

it('discovers and governs scoped revisions, protections and stable retry IDs through the Agent Broker', async () => {
  const f = await fixture(), app = f.first
  f.documents.set(sourceId, { path: '/综述', markdown: '## 方法演进\n\n原方法。\n\n## 局限\n\n<!-- locked -->\n人工定稿。\n<!-- /locked -->' })
  const opened = await app.invoke('siyuan.document.open', { id: sourceId })
  const resourceRef = (opened.output as { resourceRef: string }).resourceRef
  const before = siyuanDocumentReadResultSchema.parse((await app.invoke('siyuan.document.read', {}, resourceRef)).output)
  const input = { operationId: 'review-methods-1', expectedContentHash: before.contentHash, expectedUpdated: before.updated,
    changes: [{ type: 'text', section: '方法演进', find: '原方法。', replace: '修订方法。' }] }
  await expect(app.invoke('siyuan.document.patch', input, resourceRef)).resolves.toMatchObject({ output: { changed: true, mode: 'patch' } })
  expect(f.approval).toHaveBeenCalledOnce()
  const after = siyuanDocumentReadResultSchema.parse((await app.invoke('siyuan.document.read', {}, resourceRef)).output)
  expect(after.markdown).toBe(before.markdown.replace('原方法。', '修订方法。'))
  await expect(app.invoke('siyuan.document.patch', { ...input, expectedContentHash: after.contentHash }, resourceRef)).resolves.toMatchObject({ output: { changed: false } })
  await expect(app.invoke('siyuan.document.patch', { ...input, operationId: 'bad-locked-edit', expectedContentHash: after.contentHash,
    changes: [{ type: 'text', section: '局限', find: '人工定稿。', replace: '错误修改。' }] }, resourceRef)).rejects.toMatchObject({ code: 'handler_failed', details: { reasonCode: 'protected_content' } })
  expect(f.writes).toBe(1)
})

it('binds managed personal and project documents through authenticated space sessions and governs edits', async () => {
  const f = await fixture(true), app = f.first
  await expect(app.invoke('siyuan.space.list', {})).resolves.toMatchObject({ output: { spaces: [
    { spaceId: f.personalId, scope: { kind: 'personal' } }, { spaceId: f.projectId, scope: { kind: 'project', projectId: 'prj_one' } }
  ] } })
  const open = async (spaceId: string) => (await app.invoke('siyuan.document.open', { id: sourceId, spaceId })).output as { resourceRef: string }
  const personal = await open(f.personalId), project = await open(f.projectId)
  expect(personal.resourceRef).not.toBe(project.resourceRef)
  await expect(app.invoke('siyuan.document.read', {}, project.resourceRef)).resolves.toMatchObject({ output: { markdown: 'Project-only document\n' } })
  const before = siyuanDocumentReadResultSchema.parse((await app.invoke('siyuan.document.read', {}, personal.resourceRef)).output)
  await expect(app.invoke('siyuan.document.replace', { markdown: 'Personal replacement', expectedContentHash: before.contentHash }, personal.resourceRef))
    .resolves.toMatchObject({ output: { mode: 'replace', changed: true } })
  const replaced = siyuanDocumentReadResultSchema.parse((await app.invoke('siyuan.document.read', {}, personal.resourceRef)).output)
  expect(replaced.markdown).toBe('Personal replacement\n')
  await expect(app.invoke('siyuan.document.append', { markdown: 'Appended', expectedContentHash: replaced.contentHash }, personal.resourceRef))
    .resolves.toMatchObject({ output: { mode: 'append', changed: true } })
  expect(f.approval).toHaveBeenCalledTimes(2)
  expect(f.writes).toBe(2)
  expect(f.otherDocuments.get(sourceId)?.markdown).toBe('Project-only document')
  const appended = siyuanDocumentReadResultSchema.parse((await app.invoke('siyuan.document.read', {}, personal.resourceRef)).output)
  expect(appended.markdown).toContain('Appended')
  f.approval.mockResolvedValueOnce('denied')
  await expect(app.invoke('siyuan.document.replace', { markdown: 'Denied', expectedContentHash: appended.contentHash }, personal.resourceRef))
    .rejects.toMatchObject({ code: 'approval_denied' })
  expect(f.writes).toBe(2)
  // A bound resource cannot be retargeted by smuggling another space into its input.
  await expect(app.invoke('siyuan.document.read', { spaceId: f.projectId }, personal.resourceRef)).rejects.toBeDefined()
  f.changeAccount()
  await expect(app.invoke('siyuan.document.read', {}, personal.resourceRef)).rejects.toBeDefined()
  expect(f.writes).toBe(2)
})

it('enumerates nested managed directories and creates, replies to, and edits attributed comments', async () => {
  const f = await fixture(true), app = f.first
  await expect(app.invoke('siyuan.notebook.list', { spaceId: f.personalId })).resolves.toMatchObject({ output: { notebooks: [{ id: notebook }] } })
  await expect(app.invoke('siyuan.directory.list', { spaceId: f.personalId, notebook })).resolves.toMatchObject({ output: {
    scope: 'direct-children', documents: [{ id: sourceId, childCount: 1, path: `/${sourceId}.sy` }]
  } })
  await expect(app.invoke('siyuan.directory.list', { spaceId: f.personalId, notebook, path: `/${sourceId}.sy` })).resolves.toMatchObject({ output: {
    documents: [{ id: f.nestedId, childCount: 0, path: `/${sourceId}/${f.nestedId}.sy` }]
  } })
  const opened = (await app.invoke('siyuan.document.open', { id: sourceId, spaceId: f.personalId })).output as { resourceRef: string }
  const ref = opened.resourceRef
  const initial = (await app.invoke('siyuan.comment.list', {}, ref)).output as { commentsRevision: string }
  const created = (await app.invoke('siyuan.comment.create', {
    text: 'Check this result', quote: '实验', expectedCommentsRevision: initial.commentsRevision
  }, ref)).output as { commentId: string; commentsRevision: string }
  const replied = (await app.invoke('siyuan.comment.reply', {
    commentId: created.commentId, text: 'Confirmed', expectedCommentsRevision: created.commentsRevision
  }, ref)).output as { replyId: string; commentsRevision: string }
  await expect(app.invoke('siyuan.comment.update', { commentId: created.commentId, replyId: replied.replyId,
    text: 'Confirmed with evidence', expectedCommentsRevision: replied.commentsRevision
  }, ref)).resolves.toMatchObject({ output: { commentId: created.commentId, replyId: replied.replyId } })
  await expect(app.invoke('siyuan.comment.list', {}, ref)).resolves.toMatchObject({ output: { total: 2, entries: [
    { kind: 'comment', text: 'Check this result', authorId: 'sciforge:usr_CloudUser000001', canEdit: true },
    { kind: 'reply', text: 'Confirmed with evidence', authorId: 'sciforge:usr_CloudUser000001', canEdit: true }
  ] } })
  expect(f.approval).toHaveBeenCalledTimes(3)
  expect(f.writes).toBe(3)
  expect(f.documents.get(sourceId)?.markdown).toBe(f.longBody)
  expect(f.attrs.size).toBe(0)
  expect(f.cloudCommentWrites.map(request => request.source)).toEqual(Array.from({ length: 3 }, () => ({ spaceId: f.personalId, documentId: sourceId })))
  expect(f.cloudCommentWrites.map(request => request.mutation.kind)).toEqual(['create', 'reply.create', 'reply.update'])
  const project = (await app.invoke('siyuan.document.open', { id: sourceId, spaceId: f.projectId })).output as { resourceRef: string }
  await expect(app.invoke('siyuan.comment.list', {}, project.resourceRef)).resolves.toMatchObject({ output: { total: 0 } })
})


it('audits and replays sharing writes without inventing a document content revision', async () => {
  const f = await fixture(true), broker = f.first.broker
  const caller = { audience: 'ui' as const, callerId: 'sharing-fixture' }
  const opened = await broker.invoke(caller, { actionId: 'siyuan.document.open', invocationId: 'open-sharing-fixture',
    input: { id: sourceId, spaceId: f.personalId } })
  const resource = capabilityResourceHandleSchema.parse((opened.output as { resource: unknown }).resource)
  const create = { actionId: 'siyuan.document.share.create', invocationId: 'create-sharing-fixture', resource, input: { permission: 'comment' } }
  const approved = { ...caller, approvals: [{ actionId: create.actionId, invocationId: create.invocationId, mode: 'confirmation' as const }] }
  await expect(broker.invoke(caller, create)).rejects.toThrow()
  expect(f.createShare).not.toHaveBeenCalled()
  const result = await broker.invoke(approved, create)
  expect(result).toMatchObject({ changed: false, beforeRevision: resource.semanticRevision, afterRevision: resource.semanticRevision,
    output: { share: { status: 'active', source: { spaceId: f.personalId, documentId: sourceId } } } })
  await expect(broker.invoke(approved, create)).resolves.toMatchObject({ replayed: true })
  expect(f.createShare).toHaveBeenCalledOnce()
  const revoke = { actionId: 'siyuan.document.share.revoke', invocationId: 'revoke-sharing-fixture', resource,
    input: { shareId: `dsh_${'c'.repeat(32)}`, expectedRevision: 1 } }
  await expect(broker.invoke({ ...caller, approvals: [{ actionId: revoke.actionId, invocationId: revoke.invocationId, mode: 'confirmation' }] }, revoke))
    .resolves.toMatchObject({ changed: false, output: { share: { status: 'revoked' } } })
  expect(f.revokeShare).toHaveBeenCalledOnce()
  await expect(broker.observe(caller, { resource })).resolves.toMatchObject({ semanticRevision: resource.semanticRevision })
  expect(broker.listAuditRecords().filter(record => record.actionId === create.actionId).map(record => record.status))
    .toEqual(['rejected', 'success', 'replayed'])
  expect(f.documents.get(sourceId)?.markdown).toBe(f.longBody)
})
