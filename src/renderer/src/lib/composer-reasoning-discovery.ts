/**
 * Composer-side model identity and reasoning-level discovery helpers.
 *
 * The composer shows the real model behind a routing id and only the reasoning
 * levels that evidence supports: an upstream declaration (model access), then
 * the built-in verified table, then `unknown`. "Upstream default" is the empty
 * selection — it never collapses into an explicit "off".
 */
import type { ModelReasoningOutcome } from '@shared/model-reasoning'
import type { ModelProviderModelGroup, UpstreamModelEntry } from '@shared/sciforge-api'

export type ComposerReasoningDiscoverySnapshot = {
  /** provider|model|protocol|endpoint of the queried binding. */
  key: string
  status: 'loading' | 'ready' | 'error'
  outcome: ModelReasoningOutcome | null
  message: string | null
}

/** Locate the real-model entry behind a routing id (additive upstream:models detail). */
export function composerModelEntryFor(
  groups: ModelProviderModelGroup[] | undefined,
  modelId: string
): UpstreamModelEntry | null {
  const normalized = modelId.trim()
  if (!normalized) return null
  for (const group of groups ?? []) {
    for (const entry of group.models ?? []) {
      if (entry.id === normalized) return entry
    }
  }
  return null
}

/**
 * The entry a composer model value resolves to: an exact routing-id match, or —
 * for the default 'auto'/empty selection — the first declared entry, because
 * that entry is what the router actually serves for the default selection.
 */
export function composerReasoningEntry(
  groups: ModelProviderModelGroup[] | undefined,
  composerModel: string
): UpstreamModelEntry | null {
  const direct = composerModelEntryFor(groups, composerModel)
  if (direct) return direct
  const raw = composerModel.trim().toLowerCase()
  if (raw && raw !== 'auto') return null
  for (const group of groups ?? []) {
    for (const entry of group.models ?? []) {
      if (entry.id.trim()) return entry
    }
  }
  return null
}

export type ComposerReasoningLevelOption = {
  /** '' = upstream default (no reasoning parameter is sent). Never 'off'. */
  id: string
  isDefault: boolean
}

/**
 * Options for the composer reasoning control from a discovery outcome. The list
 * only ever contains evidence-backed levels plus the honest "upstream default";
 * an unknown model offers no guessed levels at all.
 */
export function composerReasoningOptionsFromOutcome(
  outcome: ModelReasoningOutcome | null
): ComposerReasoningLevelOption[] {
  const upstreamDefault: ComposerReasoningLevelOption = { id: '', isDefault: true }
  if (!outcome || outcome.state !== 'known') return [upstreamDefault]
  const levels = outcome.levels.map((id) => id.trim()).filter((id) => id.length > 0)
  if (levels.length === 0) return [upstreamDefault]
  return [
    upstreamDefault,
    ...levels.map((id) => ({ id, isDefault: id === (outcome.defaultLevel ?? '') }))
  ]
}

const REASONING_LEVEL_LABEL_KEYS: Readonly<Record<string, string>> = {
  off: 'composerReasoningOff',
  none: 'composerReasoningOff',
  disabled: 'composerReasoningOff',
  minimal: 'composerReasoningLow',
  low: 'composerReasoningLow',
  medium: 'composerReasoningMedium',
  high: 'composerReasoningHigh',
  xhigh: 'composerReasoningXhigh',
  max: 'composerReasoningMax'
}

export function composerReasoningLevelLabelKey(level: string): string | undefined {
  return REASONING_LEVEL_LABEL_KEYS[level.trim().toLowerCase()]
}

/** Stable identity of the binding a discovery response belongs to. */
export function composerReasoningDiscoveryKey(entry: UpstreamModelEntry): string {
  return ['model-router', entry.upstreamModel, entry.protocol, entry.endpoint].join('\u0000')
}

/** Source line for the reasoning control. */
export function composerReasoningSourceKey(outcome: ModelReasoningOutcome): string | undefined {
  switch (outcome.source) {
    case 'upstream':
      return 'composerReasoningSourceUpstream'
    case 'catalog':
      return 'composerReasoningSourceCatalog'
    case 'vocabulary':
      return 'composerReasoningSourceVocabulary'
    case 'cache':
      return 'composerReasoningSourceCache'
    default:
      return undefined
  }
}

/**
 * Whether an explicit stored level is still representable for the outcome.
 * Unknown and unsupported outcomes keep the user's explicit choice: no evidence
 * is not a reason to fold an explicit selection away.
 */
export function composerReasoningEffortRepresentable(
  outcome: ModelReasoningOutcome | null,
  effort: string
): boolean {
  const value = effort.trim()
  if (!value) return true
  if (!outcome || outcome.state !== 'known') return true
  return outcome.levels.some((level) => level.trim() === value)
}