import type { AppSettingsV1 } from '../../shared/app-settings-types'
import { getModelAccessSettings, resolveRuntimeModelRouterSettings } from '../../shared/app-settings-model-router'
import { buildModelRouterResponsesUrl } from '../../shared/model-router-url'
import type { DomainPackageJsonValue as Json } from '@sciforge/domain-sdk/contract'

function outputText(value: unknown): string {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const direct = root.output_text
  if (typeof direct === 'string') return direct
  const output = Array.isArray(root.output) ? root.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function operationOutputFloor(messages: unknown[]): number {
  const systemText = messages
    .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object'))
    .filter(message => message.role === 'system')
    .map(message => typeof message.content === 'string' ? message.content : '')
    .join('\n')
  return systemText.includes('EDAG-TASK: nli') || systemText.includes('EDAG-TASK: adversarial') ? 2_048 : 0
}

export function createEvidenceModelReasoner(loadSettings: () => AppSettingsV1 | Promise<AppSettingsV1>, defaultAssertCurrent?: () => void) {
  return async (input: Json, signal: AbortSignal, assertCurrent = defaultAssertCurrent ?? (() => undefined)): Promise<string> => {
    assertCurrent()
    signal.throwIfAborted()
    const settings = await loadSettings()
    assertCurrent()
    signal.throwIfAborted()
    if (getModelAccessSettings(settings)?.mode !== 'api') throw new Error('Evidence reasoning requires API model access.')
    const router = resolveRuntimeModelRouterSettings(settings)
    if (!router.baseUrl.trim() || !router.apiKey.trim() || !router.model.trim()) throw new Error('Evidence reasoning model configuration is incomplete.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Evidence reasoner input must be an object.')
    const payload = input as Record<string, unknown>
    if (!Array.isArray(payload.messages) || typeof payload.temperature !== 'number' || typeof payload.maxTokens !== 'number') throw new Error('Evidence reasoner input is malformed.')
    assertCurrent()
    signal.throwIfAborted()
    const initialOutputTokens = Math.max(1, Math.floor(payload.maxTokens), operationOutputFloor(payload.messages))
    const maxAdaptiveOutputTokens = Math.max(initialOutputTokens, 16_384)
    let outputTokens = initialOutputTokens
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertCurrent()
      signal.throwIfAborted()
      const response = await fetch(buildModelRouterResponsesUrl(router.baseUrl), {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${router.apiKey}`, 'Content-Type': 'application/json' },
        // Model Router's Responses boundary normalizes max_output_tokens and
        // reasoning.effort. Do not send the legacy max_tokens field here.
        body: JSON.stringify({
          model: router.model.trim(), input: payload.messages, temperature: payload.temperature,
          max_output_tokens: outputTokens, reasoning: { effort: 'low' }
        }),
        signal
      })
      const body = await response.text()
      assertCurrent()
      signal.throwIfAborted()
      if (!response.ok) throw new Error(`Evidence reasoning model request failed (${response.status}).`)
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch { throw new Error('Evidence reasoning model returned invalid JSON.') }
      const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
      const incomplete = root.status === 'incomplete' && root.incomplete_details && typeof root.incomplete_details === 'object'
        ? (root.incomplete_details as Record<string, unknown>).reason
        : undefined
      if (incomplete === 'max_output_tokens' && attempt === 0 && outputTokens < maxAdaptiveOutputTokens) {
        outputTokens = Math.min(maxAdaptiveOutputTokens, Math.max(outputTokens * 2, outputTokens + 1_024))
        continue
      }
      if (root.status === 'incomplete') throw new Error(`Evidence reasoning model response incomplete (reason=${String(incomplete ?? 'unknown')}).`)
      const text = outputText(parsed).trim()
      if (!text) throw new Error('Evidence reasoning model returned no text.')
      return text
    }
    throw new Error('Evidence reasoning model response incomplete (reason=max_output_tokens).')
  }
}
