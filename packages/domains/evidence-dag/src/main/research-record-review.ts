import type { z } from 'zod'
import type { ResearchRecordNode, ResearchRecordReview, researchRecordReviewInputSchema } from '../research-record-contract.js'
import { researchRecordQueryIndex, researchRecordPagePosition } from './research-record-query.js'
import type { ResearchRecordState } from './research-record-state.js'

export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
export function historyOrigin(kind: string): 'model' | 'human' | 'system' {
  return kind === 'model-organization' || kind === 'phase-synthesis' || kind === 'model-rejected' ? 'model' : kind.startsWith('human-') ? 'human' : 'system'
}
export function recordFields(node?: ResearchRecordNode) {
  return node ? { parentId: node.parentId, title: node.title, summary: node.summary, locks: node.locks ?? null } : null
}
export function historySources(value: unknown): string[] {
  const entry = object(value), result = object(entry.result)
  const patch = Array.isArray(result.statePatch) ? result.statePatch : []
  return [...new Set([...strings(entry.sourceIds), ...patch.flatMap(change => strings(object(change).sourceIds))])]
}
export function nodePath(state: ResearchRecordState, id: string): string[] {
  const path: string[] = [], seen = new Set<string>()
  let current = state.nodes[id]
  while (current && !seen.has(current.id)) { seen.add(current.id); path.push(current.id); current = state.nodes[current.parentId] }
  return path
}

const reviewCaches = new WeakMap<ResearchRecordState, { revision: number; selections: Map<string, ResearchRecordReview['items']> }>()

/** A bounded reading projection. No LLM call, approval or new scientific finding. */
export function reviewResearchRecord(state: ResearchRecordState, input: z.infer<typeof researchRecordReviewInputSchema>, worker: ResearchRecordReview['worker']): ResearchRecordReview {
  if (input.nodeId !== 'root' && !state.nodes[input.nodeId]) throw new Error('研究范围不存在。')
  const latestSequence = state.history.length
  const throughSequence = Math.min(input.throughSequence ?? latestSequence, latestSequence)
  const since = Math.min(input.sinceSequence, throughSequence)
  const selector = ['review', input.mode, since, throughSequence, input.query ?? null]
  const position = researchRecordPagePosition(input, state.revision, selector)
  const { query, built } = researchRecordQueryIndex(state)
  const inScope = (nodeId: string) => input.nodeId === 'root' || query.index.contains(input.nodeId, nodeId)
  let cache = reviewCaches.get(state)
  if (!cache || cache.revision !== state.revision) {
    cache = { revision: state.revision, selections: new Map() }; reviewCaches.set(state, cache)
  }
  const cacheKey = JSON.stringify([input.nodeId, selector])
  const previousSelection = cache.selections.get(cacheKey)
  let items: ResearchRecordReview['items'] = previousSelection ?? []
  if (!previousSelection) {
    if (input.mode === 'attention') {
      const entrySequences = new Map<string, number>()
      const identity = (nodeId: string, entry: Record<string, unknown>) => JSON.stringify([nodeId, entry.kind, entry.text, strings(entry.sourceIds)])
      state.history.forEach((row, index) => {
        const patch = object(object(row.value).result).statePatch
        if (Array.isArray(patch)) for (const entry of patch) entrySequences.set(identity(row.nodeId, object(entry)), index + 1)
      })
      // Use leaf rounds only: phase synthesis repeats their claims and must not
      // multiply a single concern into several apparently independent findings.
      for (const node of Object.values(state.nodes)) {
        if (node.kind !== 'round' || !inScope(node.id)) continue
        const current = new Set(state.jobs[node.id]?.sourceIds ?? [])
        for (const entry of node.synthesis?.entries ?? []) {
          if (entry.status !== 'active' || !['open', 'negative'].includes(entry.kind) || entry.membership === 'historical') continue
          const sources = [...entry.sourceIds, ...(entry.resolution?.sourceIds ?? [])]
          if (!sources.some(id => current.has(id))) continue
          // Sequence identifies the original derivation where available; never
          // invent a review/verification receipt for legacy state.
          const sequence = entrySequences.get(identity(node.id, entry)) ?? 0
          items.push({ id: entry.id, sequence, nodeId: node.id, title: node.title, at: node.synthesis?.updatedAt ?? node.updatedAt,
            kind: entry.kind, text: entry.text, sourceIds: entry.sourceIds, historical: false, origin: 'model', limited: false })
        }
      }
      items.sort((a, b) => Number(b.kind === 'open') - Number(a.kind === 'open') || b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    } else {
      for (let i = throughSequence - 1; i >= (input.mode === 'changes' ? since : 0); i--) {
        const row = state.history[i], value = object(row.value), previous = object(value.previous), after = object(value.after)
        const oldPaths = [...strings(value.pathBefore), ...strings(value.pathAfter)]
        const relevant = inScope(row.nodeId) || oldPaths.includes(input.nodeId)
        if (!relevant && !(input.nodeId === 'root' && row.nodeId === 'root')) continue
        const origin = historyOrigin(row.kind), patch = object(value.result).statePatch
        // Phase summaries repeat already listed round updates. They remain in the
        // full audit history and in a directly selected phase's change view.
        if (input.mode === 'changes' && row.kind === 'phase-synthesis' && row.nodeId !== input.nodeId) continue
        const statements = Array.isArray(patch) ? patch.map(p => text(object(p).text) || text(object(p).note)).filter(Boolean) : []
        const label = row.kind === 'context-boundary' ? `上下文压缩边界 · ${text(object(value.metadata).status) || 'unknown'}；内部内容未记录，覆盖未知` : row.kind === 'human-settings' ? '调整旁路整理设置' : row.kind === 'human-retry' ? '重试未完成的整理' : origin === 'human' ? '人工调整研究记录' : '记录迁移或维护'
        const fieldLabels: Record<string, string> = { title: '标题', summary: '摘要', parentId: '阶段归属', locks: '固定字段', paused: '暂停整理', model: '整理模型' }
        const manualChanges = Object.keys(fieldLabels).filter(field => field in after && JSON.stringify(previous[field]) !== JSON.stringify(after[field]))
          .map(field => field === 'parentId' ? `阶段归属：${state.nodes[text(after[field])]?.title ?? '整个课题'}`
            : field === 'locks' ? `固定字段：${Object.entries(object(after.locks)).filter(([, fixed]) => fixed).map(([name]) => ({ placement: '归属', title: '标题', summary: '摘要' })[name] ?? name).join('、') || '无'}`
              : `${fieldLabels[field]}：${field === 'paused' ? after[field] ? '是' : '否' : text(after[field]) || '（空）'}`)
        const body = text(value.rejection) ? `未采纳：${text(value.rejection)}` : statements.join('\n') || (origin === 'human' ? manualChanges.join('\n') : text(after.summary)) || label
        if (input.query?.text && ![row.nodeId, text(after.title), body].join('\n').toLowerCase().includes(input.query.text.toLowerCase())) continue
        const sourceIds = historySources(value)
        items.push({ id: `history:${i + 1}`, sequence: i + 1, nodeId: row.nodeId,
          title: text(after.title) || text(object(value.result).title) || text(previous.title) || state.nodes[row.nodeId]?.title || '整个课题',
          at: row.at, kind: row.kind, text: body.slice(0, 700), sourceIds: sourceIds.slice(0, 48), historical: !inScope(row.nodeId), origin,
          limited: body.length > 700 || sourceIds.length > 48 || value.limited === true })
      }
    }
    if (input.query) items = items.filter(item => {
      const node = state.nodes[item.nodeId], { text, sourceStatus, ...filters } = input.query!
      if (sourceStatus && !item.sourceIds.some(id => state.nodes[id] ? query.matches(state.nodes[id], { sourceStatus }) : sourceStatus === 'unknown') && !(node?.source && query.matches(node, { sourceStatus }))) return false
      if (Object.keys(filters).length && (!node || !query.matches(node, filters))) return false
      return input.mode !== 'attention' || !text || [item.id, item.nodeId, item.title, item.text].join('\n').toLowerCase().includes(text.toLowerCase())
    })
    if (cache.selections.size >= 16) cache.selections.delete(cache.selections.keys().next().value!)
    cache.selections.set(cacheKey, items)
  }
  const total = items.length, limit = input.limit ?? 20
  const page = items.slice(position.offset, position.offset + limit).map(item => ({ ...item,
    ancestorIds: state.nodes[item.nodeId] ? query.index.ancestors(item.nodeId).slice(0, -1).map(node => node.id) : [] }))
  const nextOffset = position.offset + page.length < total ? position.offset + page.length : null
  return { revision: state.revision, latestSequence, throughSequence, items: page, total, nextOffset,
    page: { nextOffset, nextCursor: nextOffset === null ? null : position.cursor(nextOffset), total,
      scanned: previousSelection ? 0 : input.mode === 'attention' ? Object.keys(state.nodes).length + state.history.length : throughSequence - (input.mode === 'changes' ? since : 0),
      indexBuildNodes: built, indexRevision: state.revision },
    pending: query.pending.get(input.nodeId) ?? 0, blocked: query.blocked.get(input.nodeId) ?? 0, worker }
}
