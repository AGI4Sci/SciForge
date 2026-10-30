import {
  MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
  defineVisualSourceProvider,
  visualSourceContributionContractSchema,
  visualSourceContractsEqual,
  type VisualSourceProvider,
  type VisualSourceRegistrationInput
} from '@sciforge/domain-sdk/visual-source'

import {
  DomainModuleCatalog,
  type DomainContributionRuntimeGuard
} from './catalog'

export { MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND } from '@sciforge/domain-sdk/visual-source'

export type MainVisualSourceContribution = VisualSourceProvider

export const isMainVisualSourceContribution: DomainContributionRuntimeGuard<
  MainVisualSourceContribution
> = (value, metadata): value is MainVisualSourceContribution => {
  if (!isRecord(value) || !hasExactKeys(value, ['contract', 'render'])) return false
  if (typeof value.render !== 'function') return false

  const providerContract = visualSourceContributionContractSchema.safeParse(value.contract)
  const canonicalContract = visualSourceContributionContractSchema.safeParse(metadata.contract)
  if (!providerContract.success || !canonicalContract.success) return false
  if (metadata.declaration.id !== providerContract.data.id) return false
  return visualSourceContractsEqual(providerContract.data, canonicalContract.data)
}

export function listMainVisualSourceContributions(
  catalog: DomainModuleCatalog
): readonly VisualSourceRegistrationInput[] {
  return Object.freeze(catalog.listContributions(
    MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
    isMainVisualSourceContribution
  ).map((installed) => Object.freeze({
    ownerId: installed.owner.moduleId,
    provider: defineVisualSourceProvider(installed.value)
  })))
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const expectedKeys = new Set(expected)
  const actualKeys = Object.keys(value)
  return actualKeys.length === expectedKeys.size &&
    actualKeys.every((key) => expectedKeys.has(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
