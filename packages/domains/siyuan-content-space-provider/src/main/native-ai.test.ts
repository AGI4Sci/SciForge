import { afterEach, expect, it, vi } from 'vitest'
import { createNativeAi, nativeAiPrompt, type NativeAiOptions } from './native-ai.js'

const LF = String.fromCharCode(10)
const key = 'private-router-test-key'
const payload = { taskID: 'task-1', input: '原文', action: '总结' }
const request = (value: unknown = payload, signal?: AbortSignal) => new Request('https://notes.test/api/ai/editor/chat', {
  method: 'POST', body: JSON.stringify(value), signal })
const frame = (value: unknown) => 'data: ' + (typeof value === 'string' ? value : JSON.stringify(value)) + LF + LF
const content = (text: string) => ({ type: 'response.output_text.delta', delta: text })
const complete = { type: 'response.completed', response: { status: 'completed' } }
function sse(parts: unknown[], byteChunks = false) {
  const data = new TextEncoder().encode(parts.map(frame).join(''))
  return new Response(new ReadableStream({ start(stream) {
    if (byteChunks) for (const byte of data) stream.enqueue(Uint8Array.of(byte))
    else stream.enqueue(data)
    stream.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const instances: ReturnType<typeof createNativeAi>[] = []
const access = () => Promise.resolve({ baseUrl: 'http://127.0.0.1:3892/v1', apiKey: key, model: 'text-reasoner' })
function adapter(overrides: Partial<NativeAiOptions> = {}) {
  const value = createNativeAi({ authorized: () => true, textReasoner: access,
    readBlock: async () => '# 来源', settings: () => ({ maxHistoryMessages: 7, temperature: 1, maxCompletionTokens: 0 }), ...overrides })
  instances.push(value)
  return value
}
afterEach(() => { instances.splice(0).forEach(item => item.dispose()); vi.unstubAllGlobals(); vi.useRealTimers() })

it('preserves SiYuan action substitution without creating another action catalog', () => {
  expect(nativeAiPrompt('原文')).toBe('原文')
  expect(nativeAiPrompt('原文', ' 翻译 {{input}} / {{input}} ')).toBe('翻译 原文 / 原文')
  expect(nativeAiPrompt('原文', ' 总结 ')).toBe('总结:' + LF + LF + '原文')
})

it('streams UTF-8 reasoning and content in the native editor SSE contract', async () => {
  const fetcher = vi.fn(async () => sse([{ type: 'response.reasoning_summary_text.delta', delta: '思考' }, content('摘要🙂'), complete, '[DONE]'], true))
  vi.stubGlobal('fetch', fetcher)
  const response = adapter().handle(request())
  expect(response.headers.get('Content-Type')).toContain('text/event-stream')
  const text = await response.text()
  expect(text).toContain('event: start' + LF + 'data: {"taskID":"task-1"}')
  expect(text).toContain('event: reasoning' + LF + 'data: {"token":"思考"}')
  expect(text).toContain('event: content' + LF + 'data: {"token":"摘要🙂"}')
  expect(text).toContain('event: done')
  expect(text).not.toContain(key)
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('http://127.0.0.1:3892/v1/responses')
  expect(init.redirect).toBe('error')
  expect(init.headers).toMatchObject({ Authorization: 'Bearer ' + key })
  expect(JSON.parse(init.body as string)).toMatchObject({ model: 'text-reasoner', stream: true,
    input: [expect.objectContaining({ role: 'system' }), { role: 'user', content: '总结:' + LF + LF + '原文' }] })
})

it('reads selected blocks only when the native request has no selection text', async () => {
  const readBlock = vi.fn(async () => '# 块内容')
  const fetcher = vi.fn(async () => sse([complete, '[DONE]']))
  vi.stubGlobal('fetch', fetcher)
  await adapter({ readBlock }).handle(request({ taskID: 't', ids: ['20261030161847-n9jvf50'], action: '{{input}}' })).text()
  expect(readBlock).toHaveBeenCalledWith('20261030161847-n9jvf50', expect.any(AbortSignal))
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(body.input.at(-1).content).toContain('# 块内容')
  await adapter({ readBlock }).handle(request({ ...payload, ids: ['20261030161847-n9jvf50'] })).text()
  expect(readBlock).toHaveBeenCalledTimes(1)
})

it('trims existing history locally and passes shared editing limits without provider settings', async () => {
  const fetcher = vi.fn(async () => sse([complete, '[DONE]']))
  vi.stubGlobal('fetch', fetcher)
  const history = Array.from({ length: 40 }, (_, i) => ({ role: 'user', content: 'history-' + i }))
  await adapter({ settings: () => ({ maxHistoryMessages: 2, temperature: 0.5, maxCompletionTokens: 256 }) })
    .handle(request({ ...payload, history })).text()
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(body.input.map((item: { content: string }) => item.content).slice(1, -1)).toEqual(['history-38', 'history-39'])
  expect(body).toMatchObject({ temperature: 0.5, max_output_tokens: 256 })
})

it('reports truncation and accepts CRLF frames split across chunks', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([content('一部分'), { type: 'response.incomplete',
    response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }, '[DONE]'])))
  const text = await adapter().handle(request()).text()
  expect(text).toContain('event: truncated')
  expect(text).toContain('data: {"finishReason":"length"}')
  const data = frame(content('正文')).replaceAll(LF, String.fromCharCode(13) + LF) + frame(complete) + frame('[DONE]')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(data, { headers: { 'Content-Type': 'text/event-stream' } })))
  expect(await adapter().handle(request()).text()).toContain('正文')
})

it.each(['http-error', 'stream-error', 'bad-json', 'transport-error', 'wrong-content-type'])('redacts raw %s failures', async kind => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (kind === 'transport-error') throw new Error(key)
    if (kind === 'stream-error') return sse([{ error: { message: key } }])
    if (kind === 'bad-json') return new Response('data: ' + key + LF + LF, { headers: { 'Content-Type': 'text/event-stream' } })
    return new Response(key, { status: kind === 'http-error' ? 401 : 200 })
  }))
  const text = await adapter().handle(request()).text()
  expect(text).toContain('event: error')
  expect(text).not.toContain(key)
  expect(text).not.toContain('event: done')
})

it('fails closed when no API-mode text reasoner is configured', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const text = await adapter({ textReasoner: async () => null }).handle(request()).text()
  expect(text).toContain('本机 SciForge 配置 API 模式')
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['https://provider.test/v1', 'http://127.0.0.1.evil.test/v1', 'http://name:secret@localhost/v1', 'http://127.0.0.1:3892/other'])(
  'never sends the router credential to %s', async baseUrl => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const text = await adapter({ textReasoner: async () => ({ ...await access(), baseUrl }) }).handle(request()).text()
    expect(text).toContain('event: error')
    expect(text).not.toContain(key)
    expect(fetcher).not.toHaveBeenCalled()
  })

it('rejects signed-out callers, malformed IDs, arbitrary model fields and oversized bodies before fetch', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect(adapter({ authorized: () => false }).handle(request()).status).toBe(403)
  for (const value of [{ ...payload, ids: ['unsafe'] }, { ...payload, model: 'other' },
    { ...payload, input: 'x'.repeat(1_000_001) }]) {
    expect(await adapter().handle(request(value)).text()).toContain('event: error')
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('does not call EOF success when the model stream ended early', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([content('未完成')])))
  const text = await adapter().handle(request()).text()
  expect(text).toContain('连接提前中断')
  expect(text).not.toContain('event: done')
})

function stalledFetch() {
  let signal: AbortSignal | undefined
  const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal!
    signal.addEventListener('abort', () => reject(new Error(key)), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, signal: () => signal }
}

it('cancels the model request when the native reader is cancelled', async () => {
  const fixture = stalledFetch()
  const reader = adapter().handle(request()).body!.getReader()
  await reader.read()
  await vi.waitFor(() => expect(fixture.fetcher).toHaveBeenCalledOnce())
  await reader.cancel()
  expect(fixture.signal()?.aborted).toBe(true)
})

it.each(['logout', 'dispose', 'timeout', 'page-abort'])('aborts running streams on %s', async mode => {
  vi.useFakeTimers()
  let authorized = true
  const fixture = stalledFetch()
  const ac = new AbortController()
  const owner = adapter({ authorized: () => authorized })
  const result = owner.handle(request(payload, ac.signal)).text()
  await vi.waitFor(() => expect(fixture.fetcher).toHaveBeenCalledOnce())
  if (mode === 'logout') authorized = false
  if (mode === 'dispose') owner.dispose()
  if (mode === 'page-abort') ac.abort()
  await vi.advanceTimersByTimeAsync(mode === 'timeout' ? 180_000 : 250)
  const text = await result
  expect(fixture.signal()?.aborted).toBe(true)
  expect(text).toContain('event: error')
  expect(text).not.toContain(key)
})

it('bounds concurrent requests and releases the slot on cancellation', async () => {
  const owner = adapter()
  const a = owner.handle(request()), b = owner.handle(request())
  expect(owner.handle(request()).status).toBe(429)
  await a.body!.cancel(); await b.body!.cancel()
  const next = owner.handle(request())
  expect(next.status).toBe(200)
  await next.body!.cancel()
})
