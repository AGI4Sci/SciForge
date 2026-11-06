import { z } from 'zod'

const blockId = z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
const notebookSchema = z.object({
  id: blockId, name: z.string(), closed: z.boolean()
})
export type SiYuanNotebook = z.infer<typeof notebookSchema>
export type SiYuanErrorCode =
  | 'not_configured' | 'invalid_configuration' | 'invalid_input' | 'unauthorized'
  | 'secure_storage_unavailable'
  | 'provider_unavailable' | 'provider_contract_violation'
  | 'document_not_found'
  | 'api_error' | 'outcome_unknown'

/** One actionable sentence per failure, in the language of the page and of the
 * Agent. The transport only forwards a message when the error carries a `code`
 * and a `category`, so these texts are what a person or an Agent actually sees
 * instead of "the request failed before a safe result could be delivered". */
const siYuanErrorMessages: Readonly<Record<SiYuanErrorCode, string>> = Object.freeze({
  not_configured: '尚未配置思源服务地址：请在本页设置中填写，或设置 SIYUAN_BASE_URL。',
  invalid_configuration: '思源服务地址无效：必须是 HTTP 或 HTTPS 地址，且不能包含用户名、密码、查询参数或换行。',
  invalid_input: '思源请求参数不合法：请检查文档 id（形如 20240101120000-abcdefg）、以 / 开头的路径，以及笔记本 id。',
  unauthorized: '思源服务拒绝了访问：请在本页设置中填写 API 令牌，或确认该服务未启用访问授权码。',
  secure_storage_unavailable: '本机的安全存储不可用，无法保存思源令牌：请改用 SIYUAN_API_TOKEN 环境变量。',
  provider_unavailable: '连不上思源服务：请确认服务地址可访问、服务已启动，且网络未被拦截。',
  provider_contract_violation: '思源服务返回了无法识别的响应：可能是版本不兼容，请确认该服务是受支持的思源版本。',
  document_not_found: '思源里没有找到该文档：请先用 siyuan.document.search 定位，再用返回的 id 或 path 读取。',
  api_error: '思源服务返回了错误码，本次操作没有完成。',
  outcome_unknown: '写入结果未知：请求已发出但未收到确认。请先用 siyuan.document.search 确认是否已经写入，避免重复创建。'
})

/** Rejections are the caller's to fix; failures are the service's or the
 * network's. Only the latter are worth retrying. */
const rejectedSiYuanErrorCodes: ReadonlySet<SiYuanErrorCode> = new Set<SiYuanErrorCode>([
  'not_configured', 'invalid_configuration', 'invalid_input', 'unauthorized',
  'secure_storage_unavailable', 'document_not_found'
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

  constructor(input: { baseUrl: string; token?: string; timeoutMs?: number }) {
    let url: URL
    try { url = new URL(input.baseUrl) } catch { throw new SiYuanError('invalid_configuration') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || /[\r\n]/u.test(input.token ?? '')) {
      throw new SiYuanError('invalid_configuration')
    }
    this.#baseUrl = url.href.replace(/\/$/u, '')
    this.#token = input.token ?? ''
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

  async documentIds(notebook: string, path: string): Promise<string[]> {
    return this.#call('/api/filetree/getIDsByHPath', { notebook, path }, z.array(blockId), false)
  }

  async appendMarkdown(id: string, markdown: string, signal?: AbortSignal): Promise<void> {
    if (!blockId.safeParse(id).success || !markdown || markdown.length > 1_000_000) {
      throw new SiYuanError('invalid_input')
    }
    await this.#call('/api/block/appendBlock', {
      parentID: id, dataType: 'markdown', data: markdown
    }, z.array(z.object({ doOperations: z.array(z.unknown()) })).min(1), true, signal)
  }

  async readDocument(id: string, signal?: AbortSignal): Promise<string> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    const data = await this.#call('/api/block/getBlockKramdown', { id },
      z.object({ id: blockId, kramdown: z.string() }), false, signal)
    if (data.id !== id) throw new SiYuanError('provider_contract_violation')
    return data.kramdown
  }

  /** Clean Markdown export, which is what a reader wants: `getBlockKramdown`
   * interleaves SiYuan's own `{: id="…" }` block attributes into the text. */
  async exportDocumentMarkdown(id: string, signal?: AbortSignal): Promise<{ path: string; markdown: string }> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    const data = await this.#call('/api/export/exportMdContent', { id },
      z.object({ hPath: z.string(), content: z.string() }), false, signal)
    return { path: data.hPath, markdown: data.content }
  }

  async documentMetadata(id: string, signal?: AbortSignal): Promise<SiYuanDocumentRow> {
    if (!blockId.safeParse(id).success) throw new SiYuanError('invalid_input')
    const rows = await this.#call('/api/query/sql', {
      stmt: `SELECT id, box, hpath, updated FROM blocks WHERE id = ${sqlLiteral(id)} LIMIT 1`
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
        ` AND hpath = ${sqlLiteral(path)}${filter} LIMIT 1`
    }, z.array(documentRowSchema), false, signal)
    const row = rows[0]
    if (!row) throw new SiYuanError('document_not_found')
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
    if (signal?.aborted) throw new SiYuanError('provider_unavailable')
    try {
      const response = await fetch(`${this.#baseUrl}${path}`, {
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
      const envelope = z.object({ code: z.number().int(), data: z.unknown().optional() })
        .safeParse(await response.json())
      if (!envelope.success) {
        throw new SiYuanError(write ? 'outcome_unknown' : 'provider_contract_violation')
      }
      if (envelope.data.code !== 0) throw new SiYuanError('api_error')
      const data = schema.safeParse(envelope.data.data)
      if (!data.success) {
        throw new SiYuanError(write ? 'outcome_unknown' : 'provider_contract_violation')
      }
      return data.data
    } catch (error) {
      if (error instanceof SiYuanError) throw error
      // Never retry writes: a lost response can still mean the server committed them.
      throw new SiYuanError(write ? 'outcome_unknown' : 'provider_unavailable')
    }
  }
}
