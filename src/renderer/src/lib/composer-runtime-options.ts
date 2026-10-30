import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeModelReasoningEffort,
  AgentRuntimeModelServiceTier
} from '@shared/agent-runtime-contract'
import type { AgentRuntimeTurnControls } from '@shared/agent-runtime-turn-controls'

/** Level tokens that mean an explicit “off / no thinking” on the wire. */
const OFF_REASONING_LEVEL_IDS = new Set(['off', 'none', 'disabled'])

/**
 * Runtime half of the “可选档位 = 模型能力 ∩ Runtime 传递能力” intersection.
 *  - a runtime without a reasoning channel yields no level options at all;
 *  - an explicit “off” option is only offered when the runtime can actually
 *    transmit an off/disabled state (otherwise it would have to be dropped or
 *    silently replaced — both forbidden).
 */
export function filterReasoningOptionsForRuntime<T extends { id: string }>(
  options: readonly T[],
  controls: AgentRuntimeTurnControls
): T[] {
  if (controls.reasoningLevel === 'unsupported') return []
  if (controls.reasoningOff) return [...options]
  return options.filter((option) => !OFF_REASONING_LEVEL_IDS.has(option.id.trim().toLowerCase()))
}

export function runtimeTransfersServiceTier(controls: AgentRuntimeTurnControls): boolean {
  return controls.serviceTier !== 'unsupported'
}

export function composerRuntimeModelIds(
  catalog: AgentRuntimeModelCatalog | null | undefined,
  fallbackIds: readonly string[]
): string[] {
  const ids = catalog?.available ? catalog.models.map(({ id }) => id) : fallbackIds
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

export function composerModelControlOptions(
  modelId: string,
  catalog: AgentRuntimeModelCatalog | null | undefined
): {
  reasoningEfforts: readonly AgentRuntimeModelReasoningEffort[]
  serviceTiers: readonly AgentRuntimeModelServiceTier[]
} {
  if (!catalog?.available) return { reasoningEfforts: [], serviceTiers: [] }
  const normalized = modelId.trim()
  const model = normalized
    ? catalog.models.find((candidate) => candidate.id === normalized)
    : catalog.models.find((candidate) => candidate.id === catalog.defaultModelId) ??
      catalog.models.find((candidate) => candidate.isDefault)
  const serviceTiers = [...(model?.serviceTiers ?? [])]
  const defaultServiceTierId = model?.defaultServiceTierId?.trim()
  if (defaultServiceTierId && !serviceTiers.some((tier) => tier.id === defaultServiceTierId)) {
    serviceTiers.push({
      id: defaultServiceTierId,
      displayName: defaultServiceTierId,
      isDefault: true
    })
  }
  return {
    reasoningEfforts: model?.reasoningEfforts ?? [],
    serviceTiers
  }
}

/**
 * A stored effort (restored session, earlier thread, previous model) that the
 * current model's catalog does not declare is reset to that model's declared
 * default effort, or to the upstream default ('') when it declares none.
 * Returns null when the stored effort is supported or cannot be judged.
 */
export function storedReasoningEffortReset(
  settings: { model: string; reasoningEffort: string },
  catalog: AgentRuntimeModelCatalog | null | undefined
): { from: string; to: string } | null {
  const from = (settings.reasoningEffort ?? '').trim()
  if (!catalog?.available || !from) return null
  const model = settings.model.trim()
  if (model && !catalog.models.some((candidate) => candidate.id === model)) return null
  const { reasoningEfforts } = composerModelControlOptions(settings.model ?? '', catalog)
  if (reasoningEfforts.some((option) => option.id === from)) return null
  return { from, to: reasoningEfforts.find((option) => option.isDefault)?.id ?? '' }
}

export function supportedComposerTurnSettings(
  settings: { model: string; reasoningEffort: string; serviceTier: string },
  catalog: AgentRuntimeModelCatalog | null | undefined,
  authority: { providerManaged?: boolean } = {}
): { model?: string; reasoningEffort?: string; serviceTier?: string } {
  const model = (settings.model ?? '').trim()
  const reasoningEffort = (settings.reasoningEffort ?? '').trim()
  const serviceTier = (settings.serviceTier ?? '').trim()
  const passthrough = {
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {})
  }
  // A managed-provider alias can itself be present in the Runtime catalog.
  // Its controls still belong to the provider's exact-or-refuse boundary.
  if (authority.providerManaged || !catalog?.available) return passthrough
  if (model && !catalog.models.some((candidate) => candidate.id === model)) {
    // The model is not part of this runtime's catalog: it routes through a
    // configured provider (e.g. the Model Router alias). The catalog cannot
    // validate levels for it, and an explicit choice must reach the provider —
    // the provider side enforces “exact or refuse”. Dropping it here would be
    // a silent downgrade to the provider default.
    return passthrough
  }
  const options = composerModelControlOptions(model, catalog)
  return {
    ...(model ? { model } : {}),
    ...(options.reasoningEfforts.some((option) => option.id === reasoningEffort)
      ? { reasoningEffort }
      : {}),
    ...(options.serviceTiers.some((option) => option.id === serviceTier)
      ? { serviceTier }
      : {})
  }
}
