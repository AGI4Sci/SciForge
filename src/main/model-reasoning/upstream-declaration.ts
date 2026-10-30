/**
 * Reasoning-level declaration provider for the model-reasoning discovery service.
 *
 * Source of truth order stays: upstream declaration > vocabulary > unknown.
 * The "upstream" here is the model listing the runtimes actually talk to
 * (`upstream:models`, i.e. Model Router's /v1/models): every entry carries the
 * routing id, the real upstream model and the reasoning levels the active
 * binding declares.
 *
 * Behaviour:
 *  - a listing that declares levels     → `declared` (observedAt = now);
 *  - a listing without levels (null/[]) → `unknown` (undeclared is not "unsupported");
 *  - a failed observation               → throw, so discovery degrades to
 *    `unknown` and does not cache the failure (the next check retries).
 */
import { getModelRouterSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { fetchUpstreamModelIds } from '../upstream-models'
import type { DeclarationProvider, ReasoningDiscoveryQuery } from './reasoning-discovery'

export function createUpstreamReasoningDeclarationProvider(options: {
  loadSettings: () => Promise<AppSettingsV1> | AppSettingsV1
}): DeclarationProvider {
  const provider: DeclarationProvider = async (query: ReasoningDiscoveryQuery) => {
    const settings = await options.loadSettings()
    const router = getModelRouterSettings(settings)
    const textReasoner = router.profiles.default.textReasoner
    const knownIds = new Set(
      [router.publicModelAlias.trim(), textReasoner.model.trim()].filter((value) => value.length > 0)
    )
    const requestedModel = query.model.trim()
    if (!knownIds.has(requestedModel)) return { kind: 'unknown' }

    const result = await fetchUpstreamModelIds(settings)
    if (!result.ok) throw new Error(result.message)

    const entry = result.modelGroups
      ?.flatMap((group) => group.models ?? [])
      .find((candidate) => candidate.id === requestedModel || candidate.upstreamModel === requestedModel)
    const levels = entry?.reasoning.levels ?? []
    // An empty declaration is no evidence; the vocabulary still gets its say.
    if (levels.length === 0) return { kind: 'unknown' }
    const defaultLevel = entry?.reasoning.defaultLevel ?? null
    return {
      kind: 'declared',
      levels: levels.map((id) => (defaultLevel !== null && id === defaultLevel ? { id, isDefault: true } : { id })),
      observedAt: new Date().toISOString()
    }
  }
  return provider
}