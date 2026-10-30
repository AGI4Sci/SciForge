import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvidenceModelReasoner } from './evidence-model-reasoner'

const settings = {
  version: 1, locale: 'en', theme: 'dark', uiFontScale: 1, agents: {}, workspaceRoot: '/',
  log: {}, notifications: {}, appBehavior: {}, keyboardShortcuts: {},
  modelAccess: { mode: 'api' },
  modelRouter: {
    baseUrl: 'http://127.0.0.1:3892/v1', runtimeApiKey: 'router-key', publicModelAlias: 'sciforge-router',
    enabled: true, autoStart: false, profiles: { default: {} }
  }
} as any

const input = { messages: [{ role: 'system', content: 'EDAG-TASK: extract' }], temperature: 0, maxTokens: 8192 }

afterEach(() => vi.unstubAllGlobals())

describe('Evidence model reasoner Responses contract', () => {
  it('adapts exactly once when Responses reports output-token budget exhaustion', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(calls.length === 1
        ? JSON.stringify({ status: 'incomplete', output: [], output_text: '', incomplete_details: { reason: 'max_output_tokens' } })
        : JSON.stringify({ status: 'completed', output: [], output_text: '{"nodes":[],"edges":[]}' }), { status: 200 })
    }))

    const result = await createEvidenceModelReasoner(() => settings)(input as any, new AbortController().signal)

    expect(result).toBe('{"nodes":[],"edges":[]}')
    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.max_output_tokens)).toEqual([8192, 16384])
    expect(calls.every(call => call.reasoning && (call.reasoning as any).effort === 'low')).toBe(true)
    expect(calls.every(call => !('max_tokens' in call))).toBe(true)
  })

  it('applies the Python router judge floor and one bounded adaptation on NLI/review calls', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      calls.push(body)
      return new Response(calls.length === 1 || calls.length === 3
        ? JSON.stringify({ status: 'incomplete', output: [], output_text: '', incomplete_details: { reason: 'max_output_tokens' } })
        : JSON.stringify({ status: 'completed', output: [], output_text: '{"score":0.9}' }), { status: 200 })
    }))

    const reasoner = createEvidenceModelReasoner(() => settings)
    const nli = { messages: [{ role: 'system', content: 'EDAG-TASK: nli' }], temperature: 0, maxTokens: 200 }
    const review = { messages: [{ role: 'system', content: 'EDAG-TASK: adversarial' }], temperature: 0, maxTokens: 300 }
    await reasoner(nli as any, new AbortController().signal)
    await reasoner(review as any, new AbortController().signal)

    expect(calls.map(call => call.max_output_tokens)).toEqual([2048, 4096, 2048, 4096])
  })

  it('does not retry or turn a completed empty body into extraction text', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'completed', output: [], output_text: '' }), { status: 200 }
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEvidenceModelReasoner(() => settings)(input as any, new AbortController().signal))
      .rejects.toThrow('returned no text')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
