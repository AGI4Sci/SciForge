import { z } from 'zod'
import { createHash } from 'node:crypto'
import { resourceSearchResultSchema, type ResourceSearchInput, type SealedResource } from '../resource-contract.js'
import type { DerivationCoverage } from '../derive.js'

type Coverage = DerivationCoverage & { versionsScanned: number; skipped: readonly { versionId: string; reason: string }[] }
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cursorSchema = z.strictObject({ snapshot: z.string().regex(/^[a-f0-9]{64}$/), filter: z.string().regex(/^[a-f0-9]{64}$/), after: z.string().min(1).max(512) })

export function normalizeResourceIdentifier(identifier: { scheme: string; value: string }): { scheme: string; value: string } {
  const scheme = identifier.scheme.trim().toLowerCase()
  const value = identifier.value.trim()
  return { scheme, value: scheme === 'doi' ? value.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').toLowerCase() : value }
}

export function searchResources(resources: readonly SealedResource[], input: ResourceSearchInput, coverage: Coverage) {
  const sorted = [...resources].sort((a, b) => a.resourceId.localeCompare(b.resourceId, 'en'))
  const { cursor, ...filters } = input
  const snapshot = hash([sorted.map((item) => [item.resourceId, item.versionId, item.contentDigest]), coverage])
  const filter = hash(filters)
  let after: string | undefined
  if (cursor) {
    try {
      const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
      if (parsed.snapshot !== snapshot || parsed.filter !== filter || !sorted.some((item) => item.resourceId === parsed.after)) throw new Error()
      after = parsed.after
    } catch { throw new Error('invalid_cursor: resource cursor is invalid or expired; restart this search.') }
  }
  const matched = sorted.filter(({ resourceId, resource }) => {
    if (input.resourceId && input.resourceId !== resourceId) return false
    if (input.parentResourceId && input.parentResourceId !== resource.parentResourceId) return false
    if (input.paperId && !resource.paperLinks.some((link) => link.paperId === input.paperId)) return false
    if (input.accessModes && !input.accessModes.includes(resource.access.mode)) return false
    if (input.processingLevels && !input.processingLevels.includes(resource.processingLevel)) return false
    if (input.dataTypes && !input.dataTypes.some((tag) => resource.dataTypes.some((type) => normalize(type) === normalize(tag)))) return false
    if (input.query && !normalize([resource.name, ...resource.aliases, resource.description,
      ...resource.identifiers.flatMap((item) => [item.scheme, item.value])].join(' ')).includes(normalize(input.query))) return false
    return true
  })
  const remaining = after ? matched.slice(matched.findIndex((item) => item.resourceId === after) + 1) : matched
  const page = remaining.slice(0, input.limit ?? 100)
  const duplicateCandidates: z.infer<typeof resourceSearchResultSchema>['duplicateCandidates'] = []
  const byIdentifier = new Map<string, SealedResource[]>()
  for (const item of sorted) {
    for (const key of new Set(item.resource.identifiers.map((id) => JSON.stringify(normalizeResourceIdentifier(id))))) {
      const existing = byIdentifier.get(key) ?? []
      for (const other of existing) {
        const pair = duplicateCandidates.find((pair) => pair.resourceId === other.resourceId && pair.otherResourceId === item.resourceId)
        const identifier = JSON.parse(key) as { scheme: string; value: string }
        if (pair) pair.identifiers.push(identifier)
        else duplicateCandidates.push({ resourceId: other.resourceId, otherResourceId: item.resourceId, identifiers: [identifier] })
      }
      existing.push(item); byIdentifier.set(key, existing)
    }
  }
  const byId = new Map(sorted.map((item) => [item.resourceId, item]))
  const relationIssues: z.infer<typeof resourceSearchResultSchema>['relationIssues'] = []
  for (const item of sorted) {
    const parent = item.resource.parentResourceId
    if (!parent) continue
    let code: 'self_parent' | 'unresolved_parent' | 'parent_cycle' | undefined
    if (parent === item.resourceId) code = 'self_parent'
    else if (!byId.has(parent)) code = 'unresolved_parent'
    else {
      const seen = new Set([item.resourceId])
      let next: string | undefined = parent
      while (next && byId.has(next)) {
        if (seen.has(next)) { code = 'parent_cycle'; break }
        seen.add(next); next = byId.get(next)?.resource.parentResourceId
      }
    }
    if (code) relationIssues.push({ resourceId: item.resourceId, parentResourceId: parent, code })
  }
  const pageIds = new Set(page.map((item) => item.resourceId))
  return resourceSearchResultSchema.parse({
    status: matched.length ? 'hit' : coverage.coverage === 'partial' ? 'coverage_unknown' : 'no_recorded_match',
    resources: page.map((item) => {
      const latest = new Map<string, typeof item.resource.checks[number]>()
      for (const check of item.resource.checks) {
        const previous = latest.get(check.kind)
        if (!previous || Date.parse(check.observedAt) >= Date.parse(previous.observedAt)) latest.set(check.kind, check)
      }
      return { ...item, latestChecks: [...latest.values()] }
    }),
    duplicateCandidates: duplicateCandidates.filter((pair) => pageIds.has(pair.resourceId) || pageIds.has(pair.otherResourceId)),
    relationIssues: relationIssues.filter((issue) => pageIds.has(issue.resourceId)),
    nextCursor: remaining.length > page.length ? Buffer.from(JSON.stringify({ snapshot, filter, after: page.at(-1)!.resourceId })).toString('base64url') : null,
    derivedFrom: { coverage: coverage.coverage, coverageReasons: coverage.coverageReasons, eventsScanned: coverage.eventsScanned,
      versionsScanned: coverage.versionsScanned, skipped: coverage.skipped, resources: resources.length }
  })
}
