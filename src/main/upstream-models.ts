import {
  listModelRouterModelIds,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import type { ModelProviderModelGroup } from '../shared/sciforge-api'
import { upstreamOpenAiModelsUrl } from '../shared/openai-compat-url'

export type FetchUpstreamModelsResult =
  | { ok: true; modelIds: string[]; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }

const UPSTREAM_MODELS_TIMEOUT_MS = 8_000
const MODEL_ROUTER_PROVIDER_ID = 'model-router'
const MODEL_ROUTER_PROVIDER_LABEL = 'Model Router'

export async function fetchUpstreamModelIds(
  settings: AppSettingsV1
): Promise<FetchUpstreamModelsResult> {
  const rawBaseUrl = typeof settings.modelRouter?.baseUrl === 'string'
    ? settings.modelRouter.baseUrl.trim()
    : ''
  if (!rawBaseUrl) {
    return { ok: false, message: 'Missing Model Router base URL; cannot query local /v1/models.' }
  }
  const runtime = resolveRuntimeModelRouterSettings(settings)
  const key = runtime.apiKey.trim()
  if (!key) {
    return { ok: false, message: 'Missing Model Router runtime API key; cannot query local /v1/models.' }
  }

  const supportedIds = new Set(listModelRouterModelIds(settings))
  const url = upstreamOpenAiModelsUrl(runtime.baseUrl)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`
      },
      signal: AbortSignal.timeout(UPSTREAM_MODELS_TIMEOUT_MS)
    })
    const text = await res.text()
    if (!res.ok) {
      return {
        ok: false,
        message: `Model Router models request failed (${res.status}): ${text.slice(0, 400)}`
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      return { ok: false, message: 'Model Router /v1/models returned non-JSON body.' }
    }
    const data = (parsed as { data?: unknown }).data
    if (!Array.isArray(data)) {
      return { ok: false, message: 'Model Router /v1/models JSON missing data[] array.' }
    }

    const modelIds = [...new Set(data.flatMap((row) => {
      if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') {
        return []
      }
      const id = (row as { id: string }).id.trim()
      return supportedIds.has(id) ? [id] : []
    }))].sort((a, b) => a.localeCompare(b))

    if (modelIds.length === 0) {
      return { ok: false, message: 'Model Router returned no supported public model aliases.' }
    }
    return {
      ok: true,
      modelIds,
      modelGroups: [{
        providerId: MODEL_ROUTER_PROVIDER_ID,
        label: MODEL_ROUTER_PROVIDER_LABEL,
        modelIds
      }]
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
