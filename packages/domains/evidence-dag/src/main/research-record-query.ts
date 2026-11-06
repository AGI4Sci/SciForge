import type { z } from 'zod'
import type { ResearchRecordNode, ResearchRecordView, researchRecordQuerySchema, ResearchRecordScope } from '../research-record-contract.js'
import { buildResearchRecordIndex, type ResearchRecordIndex } from './research-record-index.js'
import { recordHash, type ResearchRecordState } from './research-record-state.js'

type Query = z.infer<typeof researchRecordQuerySchema>
type Coverage = ResearchRecordView['organizationCoverage']
const empty = (): Coverage => ({ observed: 0, historical: 0, processed: 0, assigned: 0, fullExcerpt: 0, truncated: 0, unavailable: 0, changed: 0, unassigned: 0, pending: 0, blocked: 0 })
const caches = new WeakMap<ResearchRecordState, { revision: number; query: ResearchRecordQueryIndex }>()

/** Disposable, revision-bound projection of the sole durable ResearchRecord owner.
 * Building is O(nodes * depth + source memberships). Warm pages are O(limit).
 * Search scans once per scope/filter, then retains only IDs (at most 16 queries).
 */
export class ResearchRecordQueryIndex {
  readonly sourceRefs: NonNullable<ResearchRecordNode['source']>[] = []
  readonly index: ResearchRecordIndex
  private coverage = new Map<string, Coverage>()
  private statuses = new Map<string, 'current' | 'changed' | 'unavailable' | 'unknown'>()
  private concerns = new Map<string, { negative: number; open: number }>()
  private selections = new Map<string, readonly ResearchRecordNode[]>()
  private discussions = new Map<string, { events: ResearchRecordNode[]; summaries: ResearchRecordNode[]; totalEvents: number; limited: boolean }>()
  private coveragePages = new Map<string, [string, [string, unknown][]][]>()
  private summaryCounts = new Map<string, { negative: number; open: number; members: number }>()
  private phaseStatuses = new Map<string, ResearchRecordNode['synthesisStatus']>()
  readonly pendingOrganization = new Map<string, number>()
  readonly pending = new Map<string, number>()
  readonly blocked = new Map<string, number>()
  private contextBoundaryCounts = new Map<string, number>()
  constructor(readonly state: ResearchRecordState, index?: ResearchRecordIndex) {
    this.index = index ?? buildResearchRecordIndex(state.nodes)
    const blockedRound = new Map<string, boolean>()
    const sourceFlags = new Map<string, Set<string>>()
    const jobScopes = (id: string) => ['root', ...this.index.ancestors(id).map(node => node.id)]
    for (const [id, job] of Object.entries(state.jobs)) {
      const processed = new Set(job.processedIds), semantic = new Set(job.semanticPendingIds)
      const unavailable = new Set(job.unavailableIds), changed = new Set(job.changedIds)
      const groups = { processed: job.processedIds, assigned: job.assignedIds, fullExcerpt: job.fullExcerptIds,
        truncated: job.truncatedIds, unavailable: job.unavailableIds, changed: job.changedIds }
      for (const sourceId of job.unavailableIds) this.statuses.set(sourceId, 'unavailable')
      for (const sourceId of job.changedIds) this.statuses.set(sourceId, 'changed')
      const memberships = Object.fromEntries(Object.entries(groups).map(([field, ids]) => [field, new Set(ids)]))
      let pendingJob = false, remainingJob = false, blockedJob = false
      const sourceAncestors = new Set<string>()
      for (const sourceId of new Set(job.sourceIds)) {
        const flags = sourceFlags.get(sourceId) ?? new Set<string>()
        const remaining = (!processed.has(sourceId) || semantic.has(sourceId)) && !unavailable.has(sourceId) && !changed.has(sourceId)
        if (remaining) { flags.add('pending'); pendingJob = true; remainingJob = true }
        if (!processed.has(sourceId) || semantic.has(sourceId)) pendingJob = true
        for (const [field, ids] of Object.entries(memberships)) if (ids.has(sourceId)) flags.add(field)
        sourceFlags.set(sourceId, flags)
        if (state.nodes[sourceId]?.source) for (const ancestor of jobScopes(sourceId)) sourceAncestors.add(ancestor)
        if (remaining && job.attempts >= 3) blockedJob = true
      }
      blockedRound.set(id, job.attempts >= 3 || !remainingJob && (!state.nodes[id]?.synthesis?.entries.length || job.sourceIds.some(source => !memberships.assigned.has(source) || semantic.has(source))))
      if (blockedJob) for (const scope of sourceAncestors) this.getCoverage(scope).blocked++
      if (state.nodes[id]) for (const scope of jobScopes(id)) {
        if (remainingJob) this.pendingOrganization.set(scope, (this.pendingOrganization.get(scope) ?? 0) + 1)
        if (pendingJob) this.pending.set(scope, (this.pending.get(scope) ?? 0) + 1)
        if (job.attempts >= 3 || job.unavailableIds.length || job.changedIds.length) this.blocked.set(scope, (this.blocked.get(scope) ?? 0) + 1)
      }
    }
    for (const row of state.history) if (row.kind === 'context-boundary') {
      for (const scope of state.nodes[row.nodeId] ? jobScopes(row.nodeId) : ['root']) this.contextBoundaryCounts.set(scope, (this.contextBoundaryCounts.get(scope) ?? 0) + 1)
    }
    const sourceRefs = new Map<string, NonNullable<ResearchRecordNode['source']>>()
    for (const node of this.index.orderedNodes()) {
      if (node.source) sourceRefs.set(recordHash(node.source), node.source)
      if (node.source) {
        const flags = sourceFlags.get(node.id)
        this.statuses.set(node.id, this.statuses.get(node.id) ?? (flags ? 'current' : 'unknown'))
        for (const scope of jobScopes(node.id)) {
          const c = this.getCoverage(scope)
          if (!flags) { c.historical++; continue }
          c.observed++
          for (const field of ['processed', 'assigned', 'fullExcerpt', 'truncated', 'unavailable', 'changed', 'pending'] as const) if (flags.has(field)) c[field]++
          if (!flags.has('assigned')) c.unassigned++
        }
      }
      if (node.synthesis) {
        const entries = node.synthesis.entries
        const maps = ['coveredChildRevisions', 'coveredEntryDigests', 'coveredChildMembership', 'coveredChildMetadata'].flatMap(field => {
          const value = node.synthesis![field as keyof typeof node.synthesis]
          return value ? [[field, Object.entries(value)] as [string, [string, unknown][]]] : []
        })
        this.coveragePages.set(node.id, maps)
        this.summaryCounts.set(node.id, {
          negative: entries.filter(entry => entry.kind === 'negative' && entry.status === 'active').length,
          open: entries.filter(entry => entry.kind === 'open' && entry.status === 'active').length,
          members: Math.max(0, ...maps.map(([, entries]) => entries.length))
        })
      }
      if (node.kind === 'round') {
        const current = new Set(state.jobs[node.id]?.sourceIds ?? [])
        const entries = node.synthesis?.entries.filter(entry => entry.status === 'active' && entry.membership !== 'historical' && entry.sourceIds.some(id => current.has(id))) ?? []
        const counts = { negative: entries.filter(entry => entry.kind === 'negative').length, open: entries.filter(entry => entry.kind === 'open').length }
        for (const scope of jobScopes(node.id)) {
          const previous = this.concerns.get(scope) ?? { negative: 0, open: 0 }
          previous.negative += counts.negative; previous.open += counts.open; this.concerns.set(scope, previous)
        }
      }
    }
    this.sourceRefs.push(...sourceRefs.values())
    for (const node of this.index.orderedNodes()) if (node.kind === 'phase') {
      const coverage = this.getCoverage(node.id), job = state.phaseJobs[node.id]
      const status = coverage.unavailable || coverage.changed ? 'unavailable'
        : job?.dirtyRoundIds.length ? job.attempts >= 3 || job.dirtyRoundIds.every(id => blockedRound.get(id)) ? 'unavailable' : node.synthesis ? 'stale' : 'pending'
          : (this.pendingOrganization.get(node.id) ?? 0) > 0 ? node.synthesis ? 'stale' : 'pending' : node.synthesis ? 'ready' : 'missing'
      this.phaseStatuses.set(node.id, status)
    }
  }
  private getCoverage(id: string): Coverage {
    let value = this.coverage.get(id)
    if (!value) { value = empty(); this.coverage.set(id, value) }
    return value
  }
  organizationCoverage(id: string): Coverage { return { ...this.getCoverage(id) } }
  boundaryCount(id: string): number { return this.contextBoundaryCounts.get(id) ?? 0 }
  discussion(id: string) {
    const previous = this.discussions.get(id)
    if (previous) return previous
    const nodes = [...this.index.scopedNodes(id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const events = nodes.filter(node => node.source), summaries = nodes.filter(node => node.summary && node.kind !== 'event')
    const result = { events: events.slice(0, 48), summaries: summaries.slice(0, 12), totalEvents: events.length,
      limited: events.length > 48 || summaries.length > 12 || summaries.some(node => node.summary.length > 500) }
    if (this.discussions.size >= 16) this.discussions.delete(this.discussions.keys().next().value!)
    this.discussions.set(id, result)
    return result
  }
  matches(node: ResearchRecordNode, query?: Query): boolean {
    if (!query) return true
    if (query.sourceStatus && this.statuses.get(node.id) !== query.sourceStatus) return false
    if (query.concern === 'failed' && !['failed', 'error', 'cancelled', 'interrupted'].includes(node.status) && !this.index.project(node).behaviorCounts?.failed) return false
    if (query.concern && query.concern !== 'failed' && !(this.concerns.get(node.id)?.[query.concern])) return false
    if (query.text) {
      const haystack = [node.id, node.title, node.summary, node.source?.itemId, ...node.synthesis?.entries.map(entry => entry.text) ?? []].join('\n').toLowerCase()
      if (!haystack.includes(query.text.toLowerCase())) return false
    }
    return true
  }
  select(id: string, query?: Query): { nodes: readonly ResearchRecordNode[]; scanned: number } {
    if (id !== 'root') this.index.children(id) // reject an unknown scope even with no matches
    if (!query || !Object.keys(query).length) return { nodes: this.index.children(id), scanned: 0 }
    const key = JSON.stringify([id, query.text ?? null, query.sourceStatus ?? null, query.concern ?? null])
    const cached = this.selections.get(key)
    if (cached) return { nodes: cached, scanned: 0 }
    const nodes: ResearchRecordNode[] = []
    let scanned = 0
    for (const node of this.index.scopedNodes(id)) { scanned++; if (this.matches(node, query)) nodes.push(node) }
    if (this.selections.size >= 16) this.selections.delete(this.selections.keys().next().value!)
    this.selections.set(key, nodes)
    return { nodes, scanned }
  }
  project(node: ResearchRecordNode, offset = 0): ResearchRecordNode {
    const projected = this.index.project(node), coverage = this.organizationCoverage(node.id)
    const result = { ...projected, concernCounts: this.concerns.get(node.id) ?? { negative: 0, open: 0 },
      ...(node.kind === 'phase' ? { synthesisStatus: this.phaseStatuses.get(node.id) } : {}), ...(node.source ? { sourceStatus: this.statuses.get(node.id)! } : {}),
      ...(['phase', 'round'].includes(node.kind) ? { organizationCoverage: coverage } : {}) }
    if (!node.synthesis) return result
    const entries = node.synthesis.entries
    const recentPage = <T>(values: T[]) => {
      const end = Math.max(0, values.length - offset)
      return values.slice(Math.max(0, end - 48), end)
    }
    const page = recentPage(entries)
    const counts = this.summaryCounts.get(node.id)!
    const total = Math.max(entries.length, counts.members)
    const limited = offset > 0 || offset + 48 < total
    const coveragePage = Object.fromEntries(this.coveragePages.get(node.id)!.map(([field, entries]) => [field, Object.fromEntries(recentPage(entries))]))
    return { ...result, synthesis: { revision: node.synthesis.revision, updatedAt: node.synthesis.updatedAt,
      entries: page, ...coveragePage, summaryLimited: node.synthesis.summaryLimited || limited,
      ...(node.synthesis.legacySummary ? { legacySummary: node.synthesis.legacySummary } : {}) },
      summaryProjection: { version: 'research-record-summary-v1', throughRevision: this.state.revision, synthesisRevision: node.synthesis.revision,
        totalEntries: entries.length, negative: counts.negative, open: counts.open, totalCoverageMembers: counts.members,
        offset, nextOffset: offset + 48 < total ? offset + 48 : null, limited,
        sourceCoverage: coverage.unavailable || coverage.changed || coverage.truncated || coverage.unassigned ? 'gaps' : coverage.observed && coverage.fullExcerpt === coverage.observed ? 'observed' : 'unknown' } }
  }
}
export function researchRecordQueryIndex(state: ResearchRecordState, index?: ResearchRecordIndex) {
  const previous = caches.get(state)
  if (previous?.revision === state.revision) return { query: previous.query, built: 0 }
  const query = new ResearchRecordQueryIndex(state, index)
  caches.set(state, { revision: state.revision, query })
  return { query, built: Object.keys(state.nodes).length }
}

export function researchRecordPagePosition(input: ResearchRecordScope & { nodeId: string; cursor?: string; offset: number }, revision: number, selector: unknown): { offset: number; cursor: (offset: number) => string } {
  const binding = recordHash([input.runtimeId, input.threadId, input.workspaceRoot, input.nodeId, selector])
  let offset = input.offset
  if (input.cursor) {
    let value: unknown
    try { value = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) } catch { throw new Error('研究分页游标无效。') }
    const page = value as { version?: unknown; revision?: unknown; binding?: unknown; offset?: unknown } | null
    if (!page || page.version !== 1 || !Number.isSafeInteger(page.offset) || Number(page.offset) < 0) throw new Error('研究分页游标无效。')
    if (page.revision !== revision || page.binding !== binding) throw new Error('研究分页范围或修订已变化，请从首页重新读取。')
    if (input.offset !== 0 && input.offset !== page.offset) throw new Error('研究分页游标与偏移不一致。')
    offset = Number(page.offset)
  }
  return { offset, cursor: next => Buffer.from(JSON.stringify({ version: 1, revision, binding, offset: next })).toString('base64url') }
}
