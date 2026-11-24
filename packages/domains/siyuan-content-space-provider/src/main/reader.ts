import { documentContent } from './document-content.js'
import {
  siyuanDocumentLookupReadRequestSchema, siyuanDocumentReadResultSchema,
  siyuanDocumentSearchRequestSchema, siyuanDocumentSearchResultSchema
} from '../editor-contract.js'
import { SiYuanClient, SiYuanError, type SiYuanDocumentRow } from './client.js'

/** `/SciForge/实验记录-1a2b3c` reads as `实验记录-1a2b3c` in the SiYuan tree. */
const titleOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** Read path over the configured service: it never writes, so it never needs
 * the durable writer's receipts, queue or reconciliation. */
export function createDocumentReader(input: {
  client: (spaceId?: string) => Promise<{ client: SiYuanClient; baseUrl: string }>
}) {
  const notebookFor = async (
    client: SiYuanClient,
    request: { notebook?: string; notebookName?: string }, signal?: AbortSignal
  ): Promise<string | undefined> => {
    if (request.notebook) return request.notebook
    if (!request.notebookName) return undefined
    const notebooks = (await client.listNotebooks(signal)).filter(item => !item.closed && item.name === request.notebookName)
    if (notebooks.length > 1) throw new SiYuanError('document_ambiguous')
    const notebook = notebooks[0]?.id
    if (!notebook) throw new SiYuanError('document_not_found')
    return notebook
  }

  /** A document is addressed by id or by human path; both resolve to one row so
   * the caller always learns the same path/notebook/updated triple. */
  const locate = async (
    client: SiYuanClient,
    request: { id?: string; path?: string; notebook?: string; notebookName?: string }, signal?: AbortSignal
  ): Promise<SiYuanDocumentRow> => {
    if (request.id !== undefined && request.path !== undefined) {
      throw new SiYuanError('invalid_input')
    }
    if (request.id !== undefined) {
      const row = await client.documentMetadata(request.id, signal)
      const notebook = await notebookFor(client, request, signal)
      if (notebook && row.box !== notebook) throw new SiYuanError('document_not_found')
      return row
    }
    if (request.path !== undefined) {
      return client.findDocumentByPath(request.path, await notebookFor(client, request, signal), signal)
    }
    throw new SiYuanError('invalid_input')
  }

  const read = async (raw: unknown, signal?: AbortSignal) => {
    const request = siyuanDocumentLookupReadRequestSchema.parse(raw)
    if (request.offset > 0 && !request.contentHash) throw new SiYuanError('pagination_hash_required')
    const { client } = await input.client(request.spaceId)
    const row = await locate(client, request, signal)
    const { markdown, contentHash, updated } = await documentContent(client, row.id, signal)
    if (request.contentHash && request.contentHash !== contentHash) throw new SiYuanError('stale_document')
    if (request.offset > markdown.length || (request.offset > 0 && /[\uDC00-\uDFFF]/u.test(markdown[request.offset]))) throw new SiYuanError('pagination_offset_invalid')
    let end = Math.min(markdown.length, request.offset + request.maxChars)
    if (end < markdown.length && /[\uD800-\uDBFF]/u.test(markdown[end - 1])) end--
    const truncated = end < markdown.length
    return siyuanDocumentReadResultSchema.parse({
      id: row.id,
      path: row.hpath,
      notebook: row.box,
      title: titleOf(row.hpath),
      updated,
      markdown: markdown.slice(request.offset, end), truncated,
      offset: request.offset, nextOffset: truncated ? end : null, totalChars: markdown.length, contentHash
    })
  }

  const search = async (raw: unknown, signal?: AbortSignal) => {
    const request = siyuanDocumentSearchRequestSchema.parse(raw)
    const { client } = await input.client(request.spaceId)
    const notebook = await notebookFor(client, request, signal)
    const rows = await client.searchDocuments({
      query: request.query, ...(notebook ? { notebook } : {}), limit: request.limit, ...(signal ? { signal } : {})
    })
    return siyuanDocumentSearchResultSchema.parse({
      documents: rows.map((row) => ({
        id: row.id, path: row.hpath, notebook: row.box, updated: row.updated
      }))
    })
  }

  const describe = async (raw: unknown, signal?: AbortSignal) => {
    const request = siyuanDocumentLookupReadRequestSchema.parse(raw)
    const { client } = await input.client(request.spaceId)
    const row = await locate(client, request, signal)
    return { id: row.id, path: row.hpath, notebook: row.box, title: titleOf(row.hpath), updated: row.updated }
  }
  return { describe, read, search }
}
