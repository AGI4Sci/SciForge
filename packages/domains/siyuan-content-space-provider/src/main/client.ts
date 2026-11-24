import { z } from 'zod'
import { siyuanTreePathSchema } from '../catalog-contract.js'
import { bodyMarkdown } from './markdown.js'

const blockId = z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
const notebookSchema = z.object({
  id: blockId, name: z.string(), closed: z.boolean()
})
export type SiYuanNotebook = z.infer<typeof notebookSchema>
type DocumentPrecondition = Readonly<{ id: string; kramdown: string }>
export type SiYuanErrorCode =
  | 'space_required' | 'identity_required' | 'not_configured' | 'invalid_configuration' | 'invalid_input' | 'unauthorized' | 'cancelled'
  | 'secure_storage_unavailable'
  | 'configuration_unavailable' | 'document_conflict' | 'document_ambiguous' | 'stale_document' | 'write_verification_failed'
  | 'provider_unavailable' | 'provider_contract_violation'
  | 'document_not_found' | 'pagination_hash_required' | 'pagination_offset_invalid'
  | 'api_error' | 'outcome_unknown'
  | 'protected_content' | 'edit_scope_invalid' | 'operation_conflict' | 'conditional_write_unsupported'
  | 'catalog_changed' | 'notebook_closed' | 'document_changed' | 'comments_changed' | 'comment_not_found' | 'comment_edit_forbidden' | 'comments_format_unsupported'

/** One actionable sentence per failure, in the language of the page and of the
 * Agent. The transport only forwards a message when the error carries a `code`
 * and a `category`, so these texts are what a person or an Agent actually sees
 * instead of "the request failed before a safe result could be delivered". */
const siYuanErrorMessages: Readonly<Record<SiYuanErrorCode, string>> = Object.freeze({
  pagination_hash_required: 'Continuation reads (offset > 0) require contentHash from the previous page. Pass its nextOffset as offset and its contentHash together; if unavailable, read offset 0 first.',
  pagination_offset_invalid: 'Invalid continuation offset. Use nextOffset from the previous page, with its contentHash; nextOffset=null means the document is fully read.',
  catalog_changed: 'The notebook or directory listing changed; restart from the first page.',
  notebook_closed: 'This notebook is closed. Open it before listing its documents.',
  document_changed: '文档已更新，请重新读取。',
  conditional_write_unsupported: '此云笔记服务尚未支持原子版本校验，请更新服务后再修改文档。',
  protected_content: '写入被拒绝：不得修改人工定稿区、表格列结构或未指定的已有单元格。',
  edit_scope_invalid: '局部修改范围无效：请使用唯一的章节标题和原文片段，且每次文本替换须位于一个普通正文块内；表格请使用单元格或追加行操作。',
  operation_conflict: '同一 operationId 已用于不同内容，请为新的编辑步骤使用新的标识。',
  comments_changed: 'Comments changed. Read them again before editing.',
  comment_not_found: 'The requested comment or reply was not found.',
  comment_edit_forbidden: 'Only comments written by the signed-in account can be edited.',
  comments_format_unsupported: 'This document uses an unsupported comment format; no comments were changed.',

  space_required: 'Choose an explicit personal or project cloud space before accessing documents.',
  identity_required: 'Sign in to SciForge to use cloud spaces.',
  not_configured: '尚未配置思源服务地址：请在本页设置中填写，或设置 SIYUAN_BASE_URL。',
  invalid_configuration: '思源服务地址无效：必须是 HTTP 或 HTTPS 地址，且不能包含用户名、密码、查询参数或换行。',
  invalid_input: '思源请求参数不合法：请检查文档 id（形如 20240101120000-abcdefg）、以 / 开头的路径，以及笔记本 id。',
  unauthorized: '思源服务拒绝了访问：请在本页设置中填写 API 令牌，或确认该服务未启用访问授权码。',
  cancelled: '云笔记操作已取消；尚未发出的写入不会继续执行。',
  secure_storage_unavailable: '本机的安全存储不可用，无法保存思源令牌：请改用 SIYUAN_API_TOKEN 环境变量。',
  configuration_unavailable: '云笔记配置读取或保存失败，请在 File → Settings → 云笔记 检查设置后重试；本次未改用其他服务。',
  document_conflict: '目标路径已存在不同内容的云笔记，本次没有覆盖或另建副本；请指定新路径或先读取该文档。',
  document_ambiguous: '存在多个同名笔记本或同路径文档，请使用搜索结果中的文档 id 或指定笔记本。',
  stale_document: '云笔记内容在分段读取期间已变化，请从 offset=0 重新读取，不能拼接不同版本。',
  write_verification_failed: '云笔记已创建，但回读内容与提交内容不同，尚未确认保存完整；请读取该文档核对，不要重复创建。',
  provider_unavailable: '连不上思源服务：请确认服务地址可访问、服务已启动，且网络未被拦截。',
  provider_contract_violation: '思源服务返回了无法识别的响应：可能是版本不兼容，请确认该服务是受支持的思源版本。',
  document_not_found: '思源里没有找到该文档：请先用 siyuan.document.search 定位，再用返回的 id 或 path 读取。',
  api_error: '思源服务返回了错误码，本次操作没有完成。',
  outcome_unknown: '写入结果未知：请求已发出但未收到确认。请先用 siyuan.document.search 确认是否已经写入，避免重复创建。'
})

/** Rejections are the caller's to fix; failures are the service's or the
 * network's. Only the latter are worth retrying. */
const rejectedSiYuanErrorCodes: ReadonlySet<SiYuanErrorCode> = new Set<SiYuanErrorCode>([
  'protected_content', 'edit_scope_invalid', 'operation_conflict', 'conditional_write_unsupported',
  'pagination_hash_required', 'pagination_offset_invalid', 'catalog_changed', 'notebook_closed', 'document_changed', 'comments_changed', 'comment_not_found', 'comment_edit_forbidden', 'comments_format_unsupported',
  'space_required', 'identity_required', 'not_configured', 'invalid_configuration', 'invalid_input', 'unauthorized', 'cancelled',
  'secure_storage_unavailable', 'configuration_unavailable', 'document_not_found', 'document_conflict', 'document_ambiguous', 'stale_document'
])

export const siYuanErrorMessage = (code: SiYuanErrorCode): string => siYuanErrorMessages[code]
const documentRowSchema = z.object({
  id: blockId, box: blockId, hpath: z.string(), updated: z.string()
})
export type SiYuanDocumentRow = z.infer<typeof documentRowSchema>

/** SQL literals must stay inert: SiYuan paths come from people and from the
 * Agent, so a quote in a title may never change the statement. */
const sqlLiteral = (value: string): string => `'${value.replace(/'/gu, "''")}'`
/** `ESCAPE '\'` keeps a literal `%` or `_` from widening the search. */
const sqlLikePattern = (value: string): string =>
  `'%${value.replace(/[\\%_']/gu, (character) => (character === "'" ? "''" : `\\${character}`))}%'`

export class SiYuanError extends Error {
  readonly category: 'rejected' | 'failed'
  readonly retryable: boolean

  constructor(readonly code: SiYuanErrorCode) {
    // Never include server messages, request bodies, tokens or raw transport errors.
    super(siYuanErrorMessage(code))
    this.name = 'SiYuanError'
    this.category = rejectedSiYuanErrorCodes.has(code) ? 'rejected' : 'failed'
    this.retryable = code === 'provider_unavailable'
  }
}

export class SiYuanClient {
  readonly #baseUrl: string
  readonly #token: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(input: { baseUrl: string; token?: string; timeoutMs?: number; fetchImpl?: typeof fetch }) {
    let url: URL
    try { url = new URL(input.baseUrl) } catch { throw new SiYuanError('invalid_configuration') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || /[\r\n]/u.test(input.token ?? '')) {
      throw new SiYuanError('invalid_configuration')
    }
    this.#baseUrl = url.href.replace(/\/$/u, '')
    this.#token = input.token ?? ''
    this.#fetch = input.fetchImpl ?? fetch
    this.#timeoutMs = input.timeoutMs ?? 10_000
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new SiYuanError('invalid_configuration')
    }
  }

  async version(signal?: AbortSignal): Promise<string> {
    return this.#call('/api/system/version', {}, z.string(), false, signal)
  }

  async listNotebooks(signal?: AbortSignal): Promise<SiYuanNotebook[]> {
    const data = await this.#call('/api/notebook/lsNotebooks', {},
      z.object({ notebooks: z.array(notebookSchema).max(10_000) }), false, signal)
    return data.notebooks
  }

  /** Ask the authoritative file tree for every direct child, independent of
   * the UI's display limit. Pagination is applied to this complete directory. */
  async listDirectory(notebook: string, path: string, signal?: AbortSignal) {
    if (!blockId.safeParse(notebook).success || !siyuanTreePathSchema.safeParse(path).success) {
      throw new SiYuanError('invalid_input')
    }
    const data = await this.#call('/api/filetree/listDocsByPath', {
      notebook, path, maxListCount: 0, showHidden: true, ignoreMaxListHint: true
    }, z.object({
      box: blockId, path: siyuanTreePathSchema,
      files: z.array(z.object({
        id: blockId, name: z.string(), path: siyuanTreePathSchema,
        subFileCount: z.number().int().min(0)
      })).max(100_000)
    }), false, signal)
    if (data.box !== notebook || data.path !== path) throw new SiYuanError('provider_contract_violation')
    const prefix = path === '/' ? '/' : path.slice(0, -3) + '/'
    const ids = new Set<string>()
    for (const file of data.files) {
      if (file.path !== `${prefix}${file.id}.sy` || ids.has(file.id)) {
        throw new SiYuanError('provider_contract_violation')
      }
      ids.add(file.id)
    }
    return data.files.map(file => ({ id: file.id, title: file.name, path: file.path, childCount: file.subFileCount }))
  }

  async createDocument(input: {
    notebook: string; path: string; markdown: string; signal?: AbortSignal
  }): Promise<string> {
    if (!blockId.safeParse(input.notebook).success || !input.path.startsWith('/') ||
      input.path.split('/').some((segment) => segment === '..') ||
      input.path.length > 1024 || !input.markdown || input.markdown.length > 1_000_000) {
      throw new SiYuanError('invalid_input')
    }
    return this.#call('/api/filetree/createDocWithMd', {
      notebook: input.notebook, path: input.path, markdown: input.markdown
    }, blockId, true, input.signal)
  }

  async createNotebook(name: string, signal?: AbortSignal): Promise<string> {
    if (!name.trim() || name.length > 100) throw new SiYuanError('invalid_input')
    const data = await this.#call('/api/notebook/createNotebook', { name: name.trim() },
      z.object({ notebook: z.object({ id: blockId }) }), true, signal)
    return data.notebook.id
  }

  async documentIds(notebook: string, path: string, signal?: AbortSignal): Promise<string[]> {
    return this.#call('/api/filetree/getIDsByHPath', { notebook, path }, z.array(blockId), false, signal)
  }

  async appendMarkdown(id: string, markdown: string, signal?: AbortSignal, expectedDocument?: DocumentPrecondition): Promise<void> {
    if (!blockId.safeParse(id).success || !markdown || markdown.length > 1_000_000) {
      throw new SiYuanError('invalid_input')
    }
    await this.#call('/api/block/appendBlock', {
      parentID: id, dataType: 'markdown', data: markdown, ...(expectedDocument ? { expectedDocument } : {})
    }, z.array(z.object({ doOperations: z.array(z.unknown()) })).min(1), true, signal)
  }

  async readDocument(id: string, signal?: AbortSignal): Promise<string> {
    return (await this.#readBlockSnapshot(id, signal)).kramdown
  }

  async #readBlockSnapshot(id: string, signal?: AbortSignal) {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    const data = await this.#call('/api/block/getBlockKramdown', { id },
      z.object({ id: blockId, kramdown: z.string(), conditionalWriteVersion: z.number().int().optional() }), false, signal)
    if (data.id !== id) throw new SiYuanError('provider_contract_violation')
    return data
  }

  /** Canonical editable body; publication export expands citations according
   * to shared server preferences and is unsuitable for IO verification. */
  async exportDocumentMarkdown(id: string, signal?: AbortSignal) {
    const snapshot = await this.#readBlockSnapshot(id, signal)
    const raw = snapshot.kramdown
    const rootAttributes = raw.trimEnd().split('\n').at(-1) ?? ''
    const updated = rootAttributes.match(/\bupdated="(\d{14})"/u)?.[1]
    if (!rootAttributes.startsWith('{: ') || !rootAttributes.includes(`id="${id}"`) || !updated) throw new SiYuanError('provider_contract_violation')
    const path = await this.#call('/api/filetree/getHPathByID', { id }, z.string(), false, signal)
    return { path, markdown: bodyMarkdown(raw), updated, raw, conditionalWriteVersion: snapshot.conditionalWriteVersion }
  }

  async childBlocks(id: string, signal?: AbortSignal) {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    return this.#call('/api/block/getChildBlocks', { id },
      z.array(z.object({ id: blockId, type: z.string() })).nullable().transform(value => value ?? []), false, signal)
  }

  async updateBlocks(blocks: readonly { id: string; markdown: string }[], signal?: AbortSignal, expectedDocument?: DocumentPrecondition): Promise<void> {
    if (!blocks.length || blocks.some(block => !blockId.safeParse(block.id).success || block.markdown.length > 1_000_000)) throw new SiYuanError('invalid_input')
    await this.#call('/api/block/batchUpdateBlock', {
      blocks: blocks.map(block => ({ id: block.id, dataType: 'markdown', data: block.markdown, lockType: true })),
      ...(expectedDocument ? { expectedDocument } : {})
    }, z.array(z.object({ doOperations: z.array(z.unknown()).min(1) })).min(1), true, signal)
  }

  async replaceMarkdown(id: string, markdown: string, signal?: AbortSignal, expectedDocument?: DocumentPrecondition): Promise<void> {
    if (!blockId.safeParse(id).success || markdown.length > 1_000_000) {
      throw new SiYuanError('invalid_input')
    }
    await this.#call('/api/block/updateBlock', {
      id, dataType: 'markdown', data: markdown, ...(expectedDocument ? { expectedDocument } : {})
    }, z.array(z.object({ doOperations: z.array(z.unknown()).min(1) })).min(1), true, signal)
  }

  async blockAttributes(id: string, signal?: AbortSignal): Promise<Record<string, string>> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    return this.#call('/api/attr/getBlockAttrs', { id }, z.record(z.string(), z.string()), false, signal)
  }

  async setBlockAttributes(id: string, attrs: Record<string, string>, signal?: AbortSignal): Promise<void> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    await this.#call('/api/attr/setBlockAttrs', { id, attrs }, z.null(), true, signal)
  }

  async assertDocumentBlock(id: string, documentId: string, signal?: AbortSignal): Promise<void> {
    if (!blockId.safeParse(id).success || !blockId.safeParse(documentId).success) throw new SiYuanError('invalid_input')
    const rows = await this.#call('/api/query/sql', {
      stmt: `SELECT id, root_id FROM blocks WHERE id = ${sqlLiteral(id)} AND root_id = ${sqlLiteral(documentId)} LIMIT 1`
    }, z.array(z.object({ id: blockId, root_id: blockId })), false, signal)
    if (rows[0]?.id !== id || rows[0]?.root_id !== documentId) throw new SiYuanError('document_not_found')
  }

  async hasLegacyComments(documentId: string, signal?: AbortSignal): Promise<boolean> {
    if (!blockId.safeParse(documentId).success) throw new SiYuanError('invalid_input')
    const rows = await this.#call('/api/query/sql', {
      stmt: `SELECT name FROM attributes WHERE root_id = ${sqlLiteral(documentId)}` +
        ` AND (name LIKE 'custom-cmt-%' OR name LIKE 'custom-cmtr-%' OR name LIKE 'custom-cmtres-%') LIMIT 1`
    }, z.array(z.object({ name: z.string() })).max(1), false, signal)
    return rows.length > 0
  }

  async documentMetadata(id: string, signal?: AbortSignal): Promise<SiYuanDocumentRow> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    const rows = await this.#call('/api/query/sql', {
      stmt: `SELECT id, box, hpath, updated FROM blocks WHERE type = 'd' AND id = ${sqlLiteral(id)} LIMIT 1`
    }, z.array(documentRowSchema), false, signal)
    const row = rows[0]
    if (!row || row.id !== id) throw new SiYuanError('document_not_found')
    return row
  }

  async findDocumentByPath(path: string, notebook?: string, signal?: AbortSignal):
  Promise<SiYuanDocumentRow> {
    if (!path.startsWith('/') || path.length > 1_024) throw new SiYuanError('invalid_input')
    if (notebook !== undefined && !blockId.safeParse(notebook).success) {
      throw new SiYuanError('invalid_input')
    }
    const filter = notebook === undefined ? '' : ` AND box = ${sqlLiteral(notebook)}`
    const rows = await this.#call('/api/query/sql', {
      stmt: `SELECT id, box, hpath, updated FROM blocks WHERE type = 'd'` +
        ` AND hpath = ${sqlLiteral(path)}${filter} LIMIT 2`
    }, z.array(documentRowSchema), false, signal)
    const row = rows[0]
    if (!row) throw new SiYuanError('document_not_found')
    if (rows.length > 1) throw new SiYuanError('document_ambiguous')
    return row
  }

  async searchDocuments(input: {
    query: string; notebook?: string; limit: number; signal?: AbortSignal
  }): Promise<SiYuanDocumentRow[]> {
    if (!input.query.trim() || input.query.length > 200 ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new SiYuanError('invalid_input')
    }
    if (input.notebook !== undefined && !blockId.safeParse(input.notebook).success) {
      throw new SiYuanError('invalid_input')
    }
    const filter = input.notebook === undefined ? '' : ` AND box = ${sqlLiteral(input.notebook)}`
    return this.#call('/api/query/sql', {
      stmt: `SELECT id, box, hpath, updated FROM blocks WHERE type = 'd'` +
        ` AND hpath LIKE ${sqlLikePattern(input.query)} ESCAPE '\\'${filter}` +
        ` ORDER BY updated DESC LIMIT ${input.limit}`
    }, z.array(documentRowSchema).max(50), false, input.signal)
  }

  async #call<T>(path: string, body: unknown, schema: z.ZodType<T>,
    write: boolean, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.#attempt(path, body, schema, write, signal) }
      catch (error) {
        if (write || attempt >= 1 || signal?.aborted || !(error instanceof SiYuanError) || error.code !== 'provider_unavailable') throw error
      }
    }
  }

  async #attempt<T>(path: string, body: unknown, schema: z.ZodType<T>,
    write: boolean, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new SiYuanError('cancelled')
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'POST', redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(this.#token ? { Authorization: `Token ${this.#token}` } : {})
        },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
          : AbortSignal.timeout(this.#timeoutMs)
      })
      if (response.status === 401 || response.status === 403) throw new SiYuanError('unauthorized')
      if (!response.ok) throw new SiYuanError(write ? 'outcome_unknown' : 'provider_unavailable')
      let raw: unknown
      try { raw = await response.json() }
      catch { throw new SiYuanError(write ? 'outcome_unknown' : 'provider_contract_violation') }
      const envelope = z.object({ code: z.number().int(), msg: z.string().optional(), data: z.unknown().optional() }).safeParse(raw)
      if (!envelope.success) {
        throw new SiYuanError(write ? 'outcome_unknown' : 'provider_contract_violation')
      }
      if (envelope.data.code !== 0) {
        if (write && envelope.data.code === -1 && envelope.data.msg === 'document_changed') throw new SiYuanError('document_changed')
        throw new SiYuanError('api_error')
      }
      const data = schema.safeParse(envelope.data.data)
      if (!data.success) {
        throw new SiYuanError(write ? 'outcome_unknown' : 'provider_contract_violation')
      }
      return data.data
    } catch (error) {
      if (error instanceof SiYuanError) throw error
      // Never retry writes: a lost response can still mean the server committed them.
      throw new SiYuanError(write ? 'outcome_unknown' : signal?.aborted ? 'cancelled' : 'provider_unavailable')
    }
  }
}
