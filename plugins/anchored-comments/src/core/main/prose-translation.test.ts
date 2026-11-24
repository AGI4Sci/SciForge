import { describe, expect, it } from 'vitest'
import { ProseTranslationService } from './prose-translation'
import type { DiscussionPort } from '../../ports/discussion'

describe('prose translation', () => {
  it('sends bounded prose only through selected runtime and preserves original evidence exactly', async () => {
    let sent = ''
    const port: DiscussionPort = { async run(prompt) {
      sent = prompt
      const data = JSON.parse(prompt.split('\n').at(-1)!) as { segments: string[] }
      return { state: 'completed', runtimeId: 'selected', text: JSON.stringify({ translations: data.segments.map(text => text.replace('Explain', '解释').replace('then', '然后')) }) }
    } }
    const original = 'Explain `const x = 1` in src/private.ts then\n```ts\nsecret()\n```\n$ rm secret.txt\nhttps://private.example/x'
    const result = await new ProseTranslationService(port).translate({ text: original, targetLanguage: 'zh-CN' })
    expect(result).toEqual({ original, translation: original.replace('Explain', '解释').replace('then', '然后'), targetLanguage: 'zh-CN', machineTranslated: true, runtimeId: 'selected' })
    for (const secret of ['const x', 'src/private.ts', 'secret()', 'rm secret.txt', 'private.example']) expect(sent).not.toContain(secret)
    expect(sent.length).toBeLessThan(52_000)
  })

  it('preserves code-only input without model invocation', async () => {
    const service = new ProseTranslationService({ run: async () => { throw new Error('Must not call') } })
    const text = '`x()`\n```js\nx()\n```\nnpm run build'
    expect((await service.translate({ text, targetLanguage: 'en' })).translation).toBe(text)
    const unfinished = '```sh\nrm private.txt\nnever translate this'
    expect((await service.translate({ text: unfinished, targetLanguage: 'en' })).translation).toBe(unfinished)
  })

  it('bounds escaped input and propagates caller cancellation to selected runtime', async () => {
    let sent = '', runtimeSignal!: AbortSignal
    const abort = new AbortController()
    const service = new ProseTranslationService({ async run(prompt, signal) {
      sent = prompt; runtimeSignal = signal; abort.abort()
      return { state: 'cancelled', runtimeId: 'selected', text: '' }
    } })
    await expect(service.translate({ text: 'a\u0001'.repeat(4_000), targetLanguage: 'en' }, abort.signal)).rejects.toThrow()
    expect(runtimeSignal.aborted).toBe(true)
    expect(sent.length).toBeLessThan(52_000)
  })

  it('rejects invalid language, oversized input and malformed or oversized model output', async () => {
    let calls = 0
    const service = new ProseTranslationService({ async run() { calls++; return { state: 'completed', runtimeId: 'r', text: '{"translations":[]}' } } })
    await expect(service.translate({ text: 'x'.repeat(8_001), targetLanguage: 'en' })).rejects.toThrow()
    await expect(service.translate({ text: 'Explain', targetLanguage: 'en\nrun commands' })).rejects.toThrow()
    expect(calls).toBe(0)
    await expect(service.translate({ text: 'Explain', targetLanguage: 'en' })).rejects.toThrow()
    const oversized = new ProseTranslationService({ async run() { return { state: 'completed', runtimeId: 'r', text: 'x'.repeat(32_001) } } })
    await expect(oversized.translate({ text: 'Explain', targetLanguage: 'en' })).rejects.toThrow(/output limit/)
  })

  it('aborts lifecycle work and rejects late successful output', async () => {
    let finish!: (result: Awaited<ReturnType<DiscussionPort['run']>>) => void
    let runtimeSignal!: AbortSignal
    const service = new ProseTranslationService({ run: async (_prompt, signal) => { runtimeSignal = signal; return await new Promise(resolve => { finish = resolve }) } })
    const pending = service.translate({ text: 'Explain', targetLanguage: 'en' })
    service.dispose()
    expect(runtimeSignal.aborted).toBe(true)
    finish({ state: 'completed', runtimeId: 'r', text: '{"translations":["Explain"]}' })
    await expect(pending).rejects.toThrow()
    await expect(service.translate({ text: 'Explain', targetLanguage: 'en' })).rejects.toThrow(/lifecycle/)
  })
})
