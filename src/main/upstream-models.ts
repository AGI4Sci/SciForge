import {
  getModelRouterSettings,
  listModelRouterModelIds,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ModelRouterMemberSettingsV1
} from '../shared/app-settings'
import type { ModelProviderModelGroup, UpstreamModelEntry } from '../shared/sciforge-api'
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

    const rows = data.flatMap((row) => {
      const parsed = parseUpstreamModelRow(row)
      return parsed ? [parsed] : []
    })
    const modelIds = [...new Set(
      rows
        .map((row) => row.id)
        .filter((id) => supportedIds.has(id))
    )].sort((a, b) => a.localeCompare(b))

    if (modelIds.length === 0) {
      return { ok: false, message: 'Model Router returned no supported public model aliases.' }
    }
    // Real-model identity: routing ids stay the public alias, and each entry
    // names the real model so pickers and reasoning-level discovery show what
    // a request actually reaches. Undeclared reasoning stays empty (unknown).
    const textReasoner = getModelRouterSettings(settings).profiles.default.textReasoner
    const models = modelIds.map((id) => upstreamModelEntry(id, rows, textReasoner))
    return {
      ok: true,
      modelIds,
      modelGroups: [{
        providerId: MODEL_ROUTER_PROVIDER_ID,
        label: MODEL_ROUTER_PROVIDER_LABEL,
        modelIds,
        models
      }]
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

type UpstreamModelRow = Readonly<{
  id: string
  reasoningLevels: readonly string[]
  defaultReasoningLevel: string | null
}>

function parseUpstreamModelRow(row: unknown): UpstreamModelRow | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return undefined
  const levels = Array.isArray(record.supported_reasoning_levels)
    ? record.supported_reasoning_levels.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
        const effort = (entry as { effort?: unknown }).effort
        return typeof effort === 'string' && effort.trim() ? [effort.trim()] : []
      })
    : []
  const defaultLevel = typeof record.default_reasoning_level === 'string' && record.default_reasoning_level.trim()
    ? record.default_reasoning_level.trim()
    : null
  return { id, reasoningLevels: [...new Set(levels)], defaultReasoningLevel: defaultLevel }
}

function upstreamModelEntry(
  id: string,
  rows: readonly UpstreamModelRow[],
  textReasoner: ModelRouterMemberSettingsV1
): UpstreamModelEntry {
  const row = rows.find((candidate) => candidate.id === id)
  const upstreamModel = textReasoner.model.trim()
  return {
    id,
    upstreamModel,
    displayName: upstreamModel || id,
    protocol: textReasoner.protocol ?? 'auto',
    endpoint: textReasoner.baseUrl.trim(),
    reasoning: {
      levels: row ? [...row.reasoningLevels] : [],
      defaultLevel: row ? row.defaultReasoningLevel : null
    }
  }
}
