import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  researchRecordNodeSchema, researchRecordMessageSchema, researchRecordStatePatchSchema,
  type ResearchRecordNode
} from '../research-record-contract.js'

export const organizationJobSchema = z.object({
  fingerprint: z.string(), sourceIds: z.array(z.string()), processedIds: z.array(z.string()), assignedIds: z.array(z.string()),
  fullExcerptIds: z.array(z.string()), truncatedIds: z.array(z.string()), unavailableIds: z.array(z.string()), changedIds: z.array(z.string()),
  semanticPendingIds: z.array(z.string()),
  attempts: z.number(), nextAt: z.number()
}).strict()
export const phaseJobSchema = z.object({
  dirtyRoundIds: z.array(z.string()), attempts: z.number(), nextAt: z.number()
}).strict()
const common = {
  workspaceRoot: z.string(), revision: z.number(), paused: z.boolean(), model: z.string(),
  messages: z.record(z.string(), z.array(researchRecordMessageSchema)),
  receipts: z.record(z.string(), z.object({ digest: z.string(), output: z.unknown() })),
  handoffs: z.record(z.string(), z.unknown()),
  history: z.array(z.object({ at: z.string(), nodeId: z.string(), kind: z.string(), value: z.unknown() })),
  failures: z.array(z.object({ nodeId: z.string(), message: z.string(), at: z.string() })), lastScanAt: z.string().nullable()
}
export const researchRecordStateSchema = z.object({ ...common, version: z.literal(2),
  nodes: z.record(z.string(), researchRecordNodeSchema), jobs: z.record(z.string(), organizationJobSchema),
  phaseJobs: z.record(z.string(), phaseJobSchema),
  ingestion: z.record(z.string(), z.object({
    watermark: z.string(), fingerprint: z.string(),
    turns: z.record(z.string(), z.object({ status: z.string(), sources: z.record(z.string(), z.string()) }).strict()),
    missingIds: z.array(z.string()),
    contextBoundaries: z.record(z.string(), z.string()).optional()
  }).strict()).optional()
}).strict()
export type ResearchRecordState = z.infer<typeof researchRecordStateSchema>
export type OrganizationJob = z.infer<typeof organizationJobSchema>
export type StatePatch = z.infer<typeof researchRecordStatePatchSchema>
export const recordHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const recordKey = (...parts: string[]) => `record:${recordHash(parts).slice(0, 32)}`
export const unlocked = () => ({ placement: false, title: false, summary: false })
export const union = (...groups: readonly string[][]): string[] => [...new Set(groups.flat())]
export const remainingSources = (job: OrganizationJob | undefined): string[] => job ? job.sourceIds.filter(id =>
  (!job.processedIds.includes(id) || job.semanticPendingIds.includes(id)) && !job.unavailableIds.includes(id) && !job.changedIds.includes(id)) : []

/** The sole v1 -> v2 migration. Never changes source bytes, receipts or old revisions. */
export function readResearchRecordState(raw: unknown): { state: ResearchRecordState; migrated: boolean } {
  if ((raw as { version?: unknown })?.version !== 1) return { state: researchRecordStateSchema.parse(raw), migrated: false }
  const legacy = z.object({ ...common, version: z.literal(1),
    nodes: z.record(z.string(), researchRecordNodeSchema.omit({ locks: true }).extend({ locked: z.boolean().optional() })),
    jobs: z.record(z.string(), z.object({ fingerprint: z.string(), sourceIds: z.array(z.string()), classifiedIds: z.array(z.string()), done: z.boolean(), attempts: z.number(), nextAt: z.number() }))
  }).strict().parse(raw)
  const state: ResearchRecordState = { ...legacy, version: 2, nodes: {}, jobs: {}, phaseJobs: {} }
  const at = new Date().toISOString()
  for (const [id, old] of Object.entries(legacy.nodes)) {
    const { locked, ...node } = old
    const humanPhase = node.kind === 'phase' && node.origin === 'human'
    state.nodes[id] = { ...node, locks: { placement: locked === true, title: locked === true && humanPhase,
      summary: locked === true && humanPhase && Boolean(node.summary.trim()) },
      ...(['round', 'phase'].includes(node.kind) && node.summary ? {
        synthesis: { revision: 0, updatedAt: at, entries: [], legacySummary: node.summary, summaryLimited: false }
      } : {}) }
  }
  for (const [id, job] of Object.entries(legacy.jobs)) {
    const assignedIds = job.sourceIds.filter(sourceId => {
      let node = state.nodes[sourceId]
      while (node && node.id !== id) {
        if (node.kind === 'step' && node.origin === 'model') return true
        node = state.nodes[node.parentId]
      }
      return false
    })
    state.jobs[id] = { fingerprint: job.fingerprint, sourceIds: job.sourceIds, processedIds: job.classifiedIds,
      assignedIds, fullExcerptIds: [], truncatedIds: [], unavailableIds: [], changedIds: [], semanticPendingIds: assignedIds, attempts: 0, nextAt: Date.now() + 1500 }
    let node = state.nodes[state.nodes[id]?.parentId]
    const seen = new Set<string>()
    while (node && !seen.has(node.id)) {
      seen.add(node.id)
      if (node.kind === 'phase') {
        const phase = state.phaseJobs[node.id] ??= { dirtyRoundIds: [], attempts: 0, nextAt: Date.now() + 60000 }
        phase.dirtyRoundIds = union(phase.dirtyRoundIds, [id])
      }
      node = state.nodes[node.parentId]
    }
  }
  state.history.push({ at, nodeId: 'root', kind: 'schema-migration-v1-v2', value: {
    previousVersion: 1, previousLocks: Object.fromEntries(Object.entries(legacy.nodes).filter(([, n]) => n.locked !== undefined).map(([id, n]) => [id, { locked: n.locked, origin: n.origin, kind: n.kind, title: n.title, summary: n.summary }])),
    previousJobs: legacy.jobs,
    coverageNote: 'Legacy classified IDs mean processed, not necessarily assigned. Full excerpt coverage was not recorded and is not inferred.'
  } })
  return { state: researchRecordStateSchema.parse(state), migrated: true }
}

export function synthesisContext(node: ResearchRecordNode, budget = 12000) {
  const synthesis = node.synthesis
  if (!synthesis) return { revision: 0, entries: [], limited: false }
  const priority = [...synthesis.entries].reverse().sort((left, right) =>
    Number(right.kind === 'open' && right.status === 'active') - Number(left.kind === 'open' && left.status === 'active'))
  const entries: typeof synthesis.entries = []
  let used = 0
  for (const entry of priority) {
    const size = JSON.stringify(entry).length
    if (used + size > budget || entries.length >= 48) continue
    entries.push(entry); used += size
  }
  const legacySummary = synthesis.legacySummary?.slice(0, Math.max(0, Math.min(1000, budget - used)))
  return { revision: synthesis.revision, entries, legacySummary,
    limited: entries.length < synthesis.entries.length || (synthesis.legacySummary?.length ?? 0) > (legacySummary?.length ?? 0) }
}

/** Validate the whole patch before touching state. Only provided active questions can be resolved. */
export function applyStatePatch(node: ResearchRecordNode, patch: StatePatch, allowedSources: Set<string>, allowedEntries: Set<string>, sanitize: (text: string) => string): void {
  const synthesis = structuredClone(node.synthesis ?? { revision: 0, updatedAt: '', entries: [], summaryLimited: false })
  const resolved = new Set<string>()
  for (const change of patch) {
    if (new Set(change.sourceIds).size !== change.sourceIds.length || change.sourceIds.some(id => !allowedSources.has(id))) throw new Error('综合变更包含未提供或重复的来源。')
    if (change.op === 'add') {
      const text = sanitize(change.text)
      const id = recordKey(node.id, 'state', change.kind, text, ...[...change.sourceIds].sort())
      if (!synthesis.entries.some(entry => entry.id === id)) synthesis.entries.push({ id, kind: change.kind, text, sourceIds: change.sourceIds, status: 'active' })
    } else {
      const entry = synthesis.entries.find(entry => entry.id === change.entryId)
      if (!entry || !allowedEntries.has(entry.id) || entry.kind !== 'open' || entry.status !== 'active' || resolved.has(entry.id)) throw new Error('只能解决本批提供的未决项；不得移除负例或修改未授权条目。')
      resolved.add(entry.id)
      entry.status = 'resolved'; entry.resolution = { note: sanitize(change.note), sourceIds: change.sourceIds, at: new Date().toISOString() }
    }
  }
  synthesis.revision++; synthesis.updatedAt = new Date().toISOString()
  node.synthesis = synthesis
  projectSynthesisSummary(node)
}

export function projectSynthesisSummary(node: ResearchRecordNode): void {
  const synthesis = node.synthesis!
  const labels = { goal: '目标', progress: '进展', negative: '负例', open: '未决' }
  // Display a compact present state; all entries and resolutions remain durable.
  const recent = [...synthesis.entries].reverse()
  const selected = [
    ...recent.filter(entry => entry.kind === 'progress').slice(0, 4),
    ...recent.filter(entry => entry.kind === 'goal').slice(0, 2),
    ...recent.filter(entry => entry.kind === 'negative').slice(0, 4),
    ...recent.filter(entry => entry.kind === 'open' && entry.status === 'active').slice(0, 4),
    ...recent.filter(entry => entry.status === 'resolved').slice(0, 2)
  ]
  const lines: string[] = []
  let used = 0
  for (const entry of selected) {
    const line = `${entry.membership === 'historical' ? '历史迁出 · ' : entry.membership === 'mixed' ? '跨归属 · ' : ''}${labels[entry.kind]}${entry.status === 'resolved' ? '（已解决）' : ''}：${entry.text}${entry.resolution ? ` → ${entry.resolution.note}` : ''}`
    if (used + line.length > 7000 || lines.length >= 16) continue
    lines.push(line); used += line.length + 1
  }
  if (synthesis.legacySummary) lines.push(`历史摘要：${synthesis.legacySummary.slice(0, 500)}`)
  const text = lines.join('\n')
  synthesis.summaryLimited = lines.length - Number(Boolean(synthesis.legacySummary)) < synthesis.entries.length || (synthesis.legacySummary?.length ?? 0) > 500
  if (!node.locks?.summary) node.summary = text.slice(0, 8000)
}

/** New revisions store the changed fields and resolution predecessors, not an ever-growing state copy. */
export function patchPredecessor(node: ResearchRecordNode, patch: StatePatch) {
  const resolved = new Set(patch.filter(change => change.op === 'resolve').map(change => change.entryId))
  return { id: node.id, parentId: node.parentId, title: node.title, summary: node.summary, origin: node.origin,
    locks: node.locks, synthesisRevision: node.synthesis?.revision ?? 0,
    resolvedEntries: node.synthesis?.entries.filter(entry => resolved.has(entry.id)) ?? [] }
}
