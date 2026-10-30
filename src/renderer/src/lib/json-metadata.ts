import { domainPackageJsonValueSchema, type DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

/** Copy valid JSON fields independently so an absent optional field cannot erase provenance. */
export function copyJsonMetadataFields(
  value: Record<string, unknown> | undefined
): Record<string, DomainPackageJsonValue> | undefined {
  if (!value) return undefined
  const entries = Object.entries(value).flatMap(([key, candidate]) => {
    const parsed = domainPackageJsonValueSchema.safeParse(candidate)
    return parsed.success ? [[key, parsed.data] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}
