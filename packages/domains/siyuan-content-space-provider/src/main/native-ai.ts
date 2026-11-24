import { z } from 'zod'
import type { DomainMainTextReasoner } from '@sciforge/domain-sdk/host'

const LF = String.fromCharCode(10)
const MAX_INPUT = 1_000_000
const MAX_OUTPUT = 2_000_000
const requestSchema = z.object({
  taskID: z.string().min(1).max(200),
  ids: z.array(z.string().regex(/^[0-9]{14}-[a-z0-9]{7}$/u)).max(32).optional(),
  input: z.string().max(MAX_INPUT).optional(),
  action: z.string().max(16_000).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_INPUT) }).strict()).max(1_000).optional()
}).strict()

export type NativeAiSettings = Readonly<{ maxHistoryMessages: number; temperature: number; maxCompletionTokens: number }>
export type NativeAiOptions = Readonly<{
  authorized: () => boolean
  textReasoner: () => Promise<DomainMainTextReasoner | null>
  readBlock: (id: string, signal: AbortSignal) => Promise<string>
  settings: () => NativeAiSettings
}>

class NativeAiError extends Error {}
const unavailable = '本机模型调用失败，请检查 SciForge 的模型配置或稍后重试。'

/** Only the SDK-provided local router may receive the runtime credential. */
function modelUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new NativeAiError(unavailable)
  }
  url.pathname = '/v1/responses'
  return url.href
}

/** Same substitution rule as SiYuan v3.8.6 BuildAIEditorPrompt. */
export function nativeAiPrompt(input: string, action = ''): string {
  action = action.trim()
  if (!action) return input
  return action.includes('{{input}}') ? action.replaceAll('{{input}}', input) : action + ':' + LF + LF + input
}

const systemPrompt = 'Act as an inline Markdown editor. Return only the requested text to insert, ' +
  'using the supplied content. Preserve its language and structure unless asked to change them. ' +
  'Resolve ambiguity reasonably without asking follow-up questions or adding a conversational preamble.'

/** Covers chunked bodies without Content-Length as well. */
export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let size = 0, value = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new NativeAiError('内容过长，请缩小选区后重试。')
      value += decoder.decode(chunk.value, { stream: true })
    }
    return value + decoder.decode()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

type AiEvent = Readonly<{ event: string; data: Record<string, unknown> }>
const event = (name: string, data: Record<string, unknown>): AiEvent => ({ event: name, data })

/** Parse complete SSE data frames, including split UTF-8 and CRLF. */
async function* dataFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', lines: string[] = [], frameSize = 0, size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (!chunk.done) {
        size += chunk.value.byteLength
        if (size > MAX_OUTPUT * 4) throw new NativeAiError('模型输出过长，请缩小任务后重试。')
      }
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      if (buffer.length > MAX_INPUT) throw new NativeAiError(unavailable)
      if (chunk.done) buffer += LF + LF
      let end: number
      while ((end = buffer.indexOf(LF)) >= 0) {
        let line = buffer.slice(0, end)
        if (line.endsWith(String.fromCharCode(13))) line = line.slice(0, -1)
        buffer = buffer.slice(end + 1)
        if (!line) {
          if (lines.length) yield lines.join(LF)
          lines = []; frameSize = 0
        } else if (line.startsWith('data:')) {
          frameSize += line.length
          if (frameSize > MAX_INPUT) throw new NativeAiError(unavailable)
          lines.push(line.slice(5).replace(/^ /u, ''))
        }
      }
      if (chunk.done) return
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function* run(request: Request, signal: AbortSignal, check: () => void,
  options: NativeAiOptions): AsyncGenerator<AiEvent> {
  check()
  const parsed = requestSchema.safeParse(JSON.parse(await boundedText(request.body, MAX_INPUT)))
  if (!parsed.success) throw new NativeAiError('AI 请求格式无效，请重新选择内容后重试。')
  const input = parsed.data
  yield event('start', { taskID: input.taskID })
  const reasoner = await options.textReasoner()
  check()
  if (!reasoner?.apiKey.trim() || !reasoner.model.trim()) {
    throw new NativeAiError('请先在本机 SciForge 配置 API 模式的文本模型；无需在云笔记填写 API Key。')
  }
  const url = modelUrl(reasoner.baseUrl)
  let source = input.input ?? ''
  if (!source && input.ids?.length) {
    for (const id of input.ids) {
      check()
      source += await options.readBlock(id, signal) + LF + LF
      if (source.length > MAX_INPUT) throw new NativeAiError('内容过长，请缩小选区后重试。')
    }
  }
  const prompt = nativeAiPrompt(source, input.action)
  if (!prompt.trim()) throw new NativeAiError('请先选择内容或输入写作要求。')
  const settings = options.settings()
  const history = settings.maxHistoryMessages > 0 ? (input.history ?? []).slice(-settings.maxHistoryMessages) : []
  const messages = [{ role: 'system', content: systemPrompt },
    ...history.filter(item => item.content.trim()), { role: 'user', content: prompt }]
  if (JSON.stringify(messages).length > MAX_INPUT) throw new NativeAiError('上下文过长，请清除 AI 上下文后重试。')
  check()
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + reasoner.apiKey },
    body: JSON.stringify({ model: reasoner.model, input: messages, stream: true, temperature: settings.temperature,
      ...(settings.maxCompletionTokens > 0 ? { max_output_tokens: settings.maxCompletionTokens } : {}) }) })
  check()
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel().catch(() => undefined)
    throw new NativeAiError(unavailable)
  }
  let terminal = false, finishReason = 'stop', outputSize = 0
  for await (const frame of dataFrames(response.body)) {
    check()
    if (frame === '[DONE]') break
    const packet = JSON.parse(frame) as { type?: string; delta?: unknown; error?: unknown;
      response?: { status?: string; incomplete_details?: { reason?: string } } }
    if (packet.error || packet.type === 'error' || packet.type === 'response.failed' ||
        packet.response?.status === 'failed') throw new NativeAiError(unavailable)
    const name = packet.type === 'response.output_text.delta' ? 'content' :
      ['response.reasoning_text.delta', 'response.reasoning_summary_text.delta'].includes(packet.type ?? '') ? 'reasoning' : null
    if (name) {
      const token = packet.delta
      if (typeof token !== 'string' || !token) continue
      outputSize += token.length
      if (outputSize > MAX_OUTPUT) throw new NativeAiError('模型输出过长，请缩小任务后重试。')
      yield event(name, { token })
    }
    if (packet.type === 'response.completed' || packet.type === 'response.incomplete') {
      if (packet.type === 'response.incomplete') {
        if (packet.response?.incomplete_details?.reason !== 'max_output_tokens') throw new NativeAiError(unavailable)
        finishReason = 'length'
      }
      terminal = true
      break
    }
  }
  check()
  if (!terminal) throw new NativeAiError('模型连接提前中断，请重试。')
  if (finishReason === 'length') yield event('truncated', { message: '输出达到模型长度限制，可缩小选区后重试。' })
  yield event('done', { finishReason })
}

/** One local execution path; no credentials or raw errors enter the page. */
export function createNativeAi(options: NativeAiOptions) {
  const pending = new Set<AbortController>()
  let disposed = false
  return {
    handle(request: Request): Response {
      if (disposed || !options.authorized()) return Response.json({ code: -1, msg: '请先登录 SciForge 后再使用 AI。' }, { status: 403 })
      if (pending.size >= 2) return Response.json({ code: -1, msg: '已有 AI 请求正在进行，请先停止或等待完成。' }, { status: 429 })
      const controller = new AbortController()
      pending.add(controller)
      const abort = () => controller.abort()
      request.signal.addEventListener('abort', abort, { once: true })
      if (request.signal.aborted) abort()
      const check = () => {
        if (disposed || !options.authorized()) controller.abort()
        controller.signal.throwIfAborted()
      }
      const timeout = setTimeout(abort, 180_000)
      const fence = setInterval(() => { if (!options.authorized()) abort() }, 250)
      timeout.unref?.(); fence.unref?.()
      const iterator = run(request, controller.signal, check, options)
      const cleanup = () => {
        clearTimeout(timeout); clearInterval(fence)
        request.signal.removeEventListener('abort', abort)
        pending.delete(controller)
      }
      controller.signal.addEventListener('abort', cleanup, { once: true })
      if (controller.signal.aborted) cleanup()
      const encoder = new TextEncoder()
      let closed = false
      const encode = (item: AiEvent) => encoder.encode('event: ' + item.event + LF + 'data: ' + JSON.stringify(item.data) + LF + LF)
      return new Response(new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            check()
            const next = await iterator.next()
            if (closed) return
            check()
            if (next.done) { closed = true; cleanup(); stream.close() }
            else stream.enqueue(encode(next.value))
          } catch (error) {
            if (!closed) {
              closed = true
              stream.enqueue(encode(event('error', { message: controller.signal.aborted ?
                'AI 请求已停止、账号已切换或请求超时，请重试。' : error instanceof NativeAiError ? error.message : unavailable })))
              stream.close()
            }
            abort(); cleanup()
            await iterator.return(undefined).catch(() => undefined)
          }
        },
        async cancel() {
          closed = true
          abort(); cleanup()
          await iterator.return(undefined).catch(() => undefined)
        }
      }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } })
    },
    dispose() { disposed = true; pending.forEach(controller => controller.abort()); pending.clear() }
  }
}
