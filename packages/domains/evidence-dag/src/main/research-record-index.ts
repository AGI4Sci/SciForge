import type { ResearchRecordNode } from '../research-record-contract.js'

type PhaseAggregate = {
  rounds: number
  failedRounds: number
  events: Set<string>
  start?: ResearchRecordNode
  end?: ResearchRecordNode
  latest?: ResearchRecordNode
}

function later(left: ResearchRecordNode | undefined, right: ResearchRecordNode): ResearchRecordNode {
  if (!left) return right
  const difference = Date.parse(right.createdAt) - Date.parse(left.createdAt)
  return difference > 0 || difference === 0 && `${right.updatedAt}:${right.id}` > `${left.updatedAt}:${left.id}` ? right : left
}

/** Read-only projection for one state revision. Rebuild after mutations; neither
 * model organization nor source observations are rewritten by this index. */
export function buildResearchRecordIndex(nodes: Readonly<Record<string, ResearchRecordNode>>) {
  const childrenByParent = new Map<string, ResearchRecordNode[]>()
  const phases = new Map<string, PhaseAggregate>()
  const behaviors = new Map<string, NonNullable<ResearchRecordNode['behaviorCounts']>>()
  const values = Object.values(nodes)
  const validated = new Set<string>()
  for (const node of values) {
    if (nodes[node.id] !== node) throw new Error('研究节点标识与存储键不匹配。')
    const siblings = childrenByParent.get(node.parentId)
    if (siblings) siblings.push(node)
    else childrenByParent.set(node.parentId, [node])
    if (node.kind === 'phase') phases.set(node.id, { rounds: 0, failedRounds: 0, events: new Set() })
  }

  // Validate the forest once without recursion or rebuilding an ancestor map for
  // every chapter read. Missing parents are a source problem, not an empty tree.
  for (const node of values) {
    const path = new Set<string>()
    let id = node.id
    while (id !== 'root' && !validated.has(id)) {
      if (path.has(id)) throw new Error('研究阶段包含循环。')
      path.add(id)
      if (!nodes[id]) throw new Error('研究节点父级不存在。')
      id = nodes[id].parentId
    }
    for (const entry of path) validated.add(entry)
  }

  const requireNode = (id: string) => {
    if (!nodes[id]) throw new Error('研究节点不存在。')
    return nodes[id]
  }
  const ancestors = (nodeId: string): ResearchRecordNode[] => {
    const result: ResearchRecordNode[] = []
    let id = nodeId
    while (id !== 'root') {
      const node = requireNode(id)
      result.push(node)
      id = node.parentId
    }
    return result.reverse()
  }
  const children = (id: string): readonly ResearchRecordNode[] => {
    if (id !== 'root') requireNode(id)
    return childrenByParent.get(id) ?? []
  }
  const descendants = (id: string): ResearchRecordNode[] => {
    const queue = id === 'root' ? [...children(id)] : [requireNode(id)]
    for (let i = 0; i < queue.length; i++) for (const child of children(queue[i].id)) queue.push(child)
    return queue
  }

  let latest: ResearchRecordNode | undefined
  for (const node of values) {
    if (node.kind !== 'round' && node.kind !== 'event') continue
    const dated = Number.isFinite(Date.parse(node.createdAt))
    if (node.kind === 'event' && node.source && dated) latest = later(latest, node)
    const logicalEvent = node.source && JSON.stringify([node.source.runtimeId, node.source.threadId, node.source.turnId, node.source.itemId])
    for (const ancestor of ancestors(node.id)) {
      if (node.kind === 'event' && ancestor.kind !== 'event') {
        const count = behaviors.get(ancestor.id) ?? { total: 0, failed: 0, cancelled: 0 }
        count.total++
        if (['failed', 'error'].includes(node.status)) count.failed++
        if (['cancelled', 'canceled', 'aborted', 'interrupted'].includes(node.status)) count.cancelled++
        behaviors.set(ancestor.id, count)
      }
      const aggregate = phases.get(ancestor.id)
      if (!aggregate) continue
      if (node.kind === 'round') {
        aggregate.rounds++
        if (['failed', 'cancelled'].includes(node.status)) aggregate.failedRounds++
      } else {
        if (logicalEvent) aggregate.events.add(logicalEvent)
        if (!dated) continue
        if (!aggregate.start || Date.parse(node.createdAt) < Date.parse(aggregate.start.createdAt)) aggregate.start = node
        if (!aggregate.end || Date.parse(node.createdAt) > Date.parse(aggregate.end.createdAt)) aggregate.end = node
        if (node.source) aggregate.latest = later(aggregate.latest, node)
      }
    }
  }
  const projections = new Map<string, ResearchRecordNode>()
  for (const [id, aggregate] of phases) {
    const node = nodes[id]
    const recentRound = aggregate.latest && ancestors(aggregate.latest.id).find(entry => entry.kind === 'round')
    // Remove any old projections before deriving the current revision.
    const { recordedRange: _range, recentRound: _recent, counts: _counts, ...stored } = node
    projections.set(id, {
      ...stored,
      ...(aggregate.start && aggregate.end ? { recordedRange: { start: aggregate.start.createdAt, end: aggregate.end.createdAt } } : {}),
      ...(recentRound ? { recentRound: { id: recentRound.id, title: recentRound.title, summary: recentRound.summary, status: recentRound.status } } : {}),
      counts: { rounds: aggregate.rounds, failedRounds: aggregate.failedRounds, events: aggregate.events.size }
    })
  }
  // One deterministic ordering and interval map per revision. Page reads never
  // project every sibling or walk an unrelated subtree.
  for (const [parent, siblings] of childrenByParent) {
    const ordered = siblings.filter(node => node.kind === 'phase').sort((a, b) =>
      Date.parse(projections.get(a.id)?.recordedRange?.start ?? a.createdAt) - Date.parse(projections.get(b.id)?.recordedRange?.start ?? b.createdAt))
    let position = 0
    childrenByParent.set(parent, siblings.map(node => node.kind === 'phase' ? ordered[position++] : node))
  }
  const intervals = new Map<string, { start: number; end: number }>()
  const preorder: ResearchRecordNode[] = []
  const stack = [...children('root')].reverse().map(node => ({ node, exit: false }))
  while (stack.length) {
    const { node, exit } = stack.pop()!
    if (exit) { intervals.get(node.id)!.end = preorder.length; continue }
    intervals.set(node.id, { start: preorder.length, end: 0 }); preorder.push(node)
    stack.push({ node, exit: true })
    const nested = children(node.id)
    for (let i = nested.length - 1; i >= 0; i--) stack.push({ node: nested[i], exit: false })
  }
  return {
    children, ancestors, descendants,
    orderedNodes: (): readonly ResearchRecordNode[] => preorder,
    scopedNodes: (id: string): readonly ResearchRecordNode[] => {
      if (id === 'root') return preorder
      requireNode(id)
      const range = intervals.get(id)!
      return preorder.slice(range.start, range.end)
    },
    contains: (scopeId: string, nodeId: string): boolean => {
      if (scopeId === 'root') return nodeId === 'root' || intervals.has(nodeId)
      const scope = intervals.get(scopeId), target = intervals.get(nodeId)
      return Boolean(scope && target && target.start >= scope.start && target.start < scope.end)
    },
    project: (node: ResearchRecordNode): ResearchRecordNode => {
      const projected = projections.get(node.id) ?? node
      const { behaviorCounts: _oldCounts, ...stored } = projected
      const counts = behaviors.get(node.id)
      return counts ? { ...stored, behaviorCounts: { ...counts } } : stored
    },
    latestRecordPath: (): string[] => latest ? ancestors(latest.id).map(node => node.id) : []
  }
}

export type ResearchRecordIndex = ReturnType<typeof buildResearchRecordIndex>
