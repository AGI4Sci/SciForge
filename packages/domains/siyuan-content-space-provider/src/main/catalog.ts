import { createHash } from 'node:crypto'
import { z } from 'zod'
import { siyuanDirectoryListContract, siyuanNotebookListContract } from '../catalog-contract.js'
import { SiYuanError, type SiYuanClient } from './client.js'

const cursorSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/u), offset: z.number().int().positive()
}).strict()

/** A cursor is a consistency check, not authorization. Each page re-reads the
 * authenticated service. Any changed listing invalidates the whole traversal. */
function page<T extends { id: string }>(items: T[], scope: readonly string[], request: { limit: number; cursor?: string }) {
  items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new SiYuanError('provider_contract_violation')
  const revision = createHash('sha256').update(JSON.stringify([scope, items])).digest('hex')
  let offset = 0
  if (request.cursor) {
    let parsed: z.infer<typeof cursorSchema>
    try { parsed = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'))) }
    catch { throw new SiYuanError('invalid_input') }
    if (parsed.revision !== revision) throw new SiYuanError('catalog_changed')
    offset = parsed.offset
    if (offset >= items.length) throw new SiYuanError('invalid_input')
  }
  const end = Math.min(items.length, offset + request.limit)
  return {
    items: items.slice(offset, end), total: items.length,
    nextCursor: end < items.length ? Buffer.from(JSON.stringify({ revision, offset: end })).toString('base64url') : null
  }
}

export function createSiYuanCatalog(options: {
  client: (spaceId?: string, signal?: AbortSignal) => Promise<{ client: Pick<SiYuanClient, 'listNotebooks' | 'listDirectory'>; scope: string }>
}) {
  return {
    notebooks: async (input: unknown, signal?: AbortSignal) => {
      const request = siyuanNotebookListContract.inputSchema.parse(input)
      signal?.throwIfAborted()
      const { client, scope } = await options.client(request.spaceId, signal)
      const result = page(await client.listNotebooks(signal), [request.spaceId ?? '', scope, 'notebooks'], request)
      signal?.throwIfAborted()
      return siyuanNotebookListContract.outputSchema.parse({
        ...(request.spaceId ? { spaceId: request.spaceId } : {}),
        notebooks: result.items, total: result.total, nextCursor: result.nextCursor
      })
    },
    directory: async (input: unknown, signal?: AbortSignal) => {
      const request = siyuanDirectoryListContract.inputSchema.parse(input)
      signal?.throwIfAborted()
      const { client, scope } = await options.client(request.spaceId, signal)
      const notebook = (await client.listNotebooks(signal)).find(item => item.id === request.notebook)
      if (!notebook) throw new SiYuanError('document_not_found')
      if (notebook.closed) throw new SiYuanError('notebook_closed')
      const result = page(await client.listDirectory(request.notebook, request.path, signal),
        [request.spaceId ?? '', scope, request.notebook, request.path], request)
      signal?.throwIfAborted()
      return siyuanDirectoryListContract.outputSchema.parse({
        ...(request.spaceId ? { spaceId: request.spaceId } : {}),
        notebook: request.notebook, path: request.path, scope: 'direct-children',
        documents: result.items, total: result.total, nextCursor: result.nextCursor
      })
    }
  }
}
