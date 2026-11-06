import {
  siyuanDocumentReadRequestSchema, siyuanDocumentReadResultSchema,
  siyuanDocumentSearchRequestSchema, siyuanDocumentSearchResultSchema
} from '../editor-contract.js'
import { SiYuanClient, SiYuanError, type SiYuanDocumentRow } from './client.js'

/** SiYuan exports a YAML front matter block; a reader wants the document body,
 * and the path/updated fields already carry the same bookkeeping. */
const stripFrontMatter = (markdown: string): string => {
  if (!markdown.startsWith('---\n')) return markdown
  const end = markdown.indexOf('\n---\n', 3)
  return end === -1 ? markdown : markdown.slice(end + 5)
}

/** `/SciForge/实验记录-1a2b3c` reads as `实验记录-1a2b3c` in the SiYuan tree. */
const titleOf = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** Read path over the configured service: it never writes, so it never needs
 * the durable writer's receipts, queue or reconciliation. */
export function createDocumentReader(input: {
  client: () => Promise<{ client: SiYuanClient; baseUrl: string }>
}) {
  const notebookFor = async (
    client: SiYuanClient,
    request: { notebook?: string; notebookName?: string }
  ): Promise<string | undefined> => {
    if (request.notebook) return request.notebook
    if (!request.notebookName) return undefined
    const notebook = (await client.listNotebooks())
      .find((item) => !item.closed && item.name === request.notebookName)?.id
    if (!notebook) throw new SiYuanError('document_not_found')
    return notebook
  }

  /** A document is addressed by id or by human path; both resolve to one row so
   * the caller always learns the same path/notebook/updated triple. */
  const locate = async (
    client: SiYuanClient,
    request: { id?: string; path?: string; notebook?: string; notebookName?: string }
  ): Promise<SiYuanDocumentRow> => {
    if (request.id !== undefined && request.path !== undefined) {
      throw new SiYuanError('invalid_input')
    }
    if (request.id !== undefined) return client.documentMetadata(request.id)
    if (request.path !== undefined) {
      return client.findDocumentByPath(request.path, await notebookFor(client, request))
    }
    throw new SiYuanError('invalid_input')
  }

  const read = async (raw: unknown) => {
    const request = siyuanDocumentReadRequestSchema.parse(raw)
    const { client } = await input.client()
    const row = await locate(client, request)
    const exported = await client.exportDocumentMarkdown(row.id)
    const markdown = stripFrontMatter(exported.markdown)
    const truncated = markdown.length > request.maxChars
    return siyuanDocumentReadResultSchema.parse({
      id: row.id,
      path: row.hpath,
      notebook: row.box,
      title: titleOf(row.hpath),
      updated: row.updated,
      markdown: truncated ? markdown.slice(0, request.maxChars) : markdown,
      truncated
    })
  }

  const search = async (raw: unknown) => {
    const request = siyuanDocumentSearchRequestSchema.parse(raw)
    const { client } = await input.client()
    const notebook = await notebookFor(client, request)
    const rows = await client.searchDocuments({
      query: request.query, ...(notebook ? { notebook } : {}), limit: request.limit
    })
    return siyuanDocumentSearchResultSchema.parse({
      documents: rows.map((row) => ({
        id: row.id, path: row.hpath, notebook: row.box, updated: row.updated
      }))
    })
  }

  return { read, search }
}