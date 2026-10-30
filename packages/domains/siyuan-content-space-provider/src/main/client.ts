import { z } from 'zod'

const blockId = z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
const notebookSchema = z.object({
  id: blockId, name: z.string(), closed: z.boolean()
})
export type SiYuanNotebook = z.infer<typeof notebookSchema>
export type SiYuanErrorCode =
  | 'invalid_configuration' | 'invalid_input' | 'unauthorized'
  | 'provider_unavailable' | 'provider_contract_violation'
  | 'api_error' | 'outcome_unknown'

export class SiYuanError extends Error {
  constructor(readonly code: SiYuanErrorCode) {
    // Do not include server messages, request bodies, tokens or raw transport errors.
    super(`SiYuan request failed: ${code}.`)
    this.name = 'SiYuanError'
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
