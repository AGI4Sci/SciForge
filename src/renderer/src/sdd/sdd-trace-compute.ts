import {
  computeSddCoverage,
  deriveSddStatuses,
  diffSddRequirementChanges,
  parseSddPlanCovers,
  parseSddRequirementBlocks,
  type SddPlanCoverageItem,
  type SddRequirementBlock,
  type SddRequirementCoverage,
  type SddRequirementStatus,
  type SddTraceSnapshot
} from '@shared/sdd-trace'
import type { ThreadTodoList } from '../agent/types'
import { todoContentHash } from '../plan/plan-todo-sync'

export type SddTraceResult = {
  blocks: SddRequirementBlock[]
  perRequirement: SddRequirementCoverage[]
  uncoveredIds: string[]
  derivedStatuses: Record<string, SddRequirementStatus>
  changedIds: string[]
  addedIds: string[]
}

const STATUS_RANK: Record<SddRequirementStatus, number> = {
  draft: 0,
  planned: 1,
  building: 2,
  done: 3,
  verified: 4
}

function todoStatusFor(
  item: SddPlanCoverageItem,
  todos: ThreadTodoList | null | undefined,
  planRelativePath: string
): 'pending' | 'in_progress' | 'completed' | null {
  if (!todos) return null
  const hash = todoContentHash(item.rawText)
  for (const todo of todos.items) {
    if (todo.source?.kind !== 'plan') continue
    if (todo.source.relativePath !== planRelativePath) continue
    if (todo.source.contentHash === hash || todoContentHash(todo.content) === hash) {
      return todo.status
    }
  }
  return null
}

export function computeSddTrace(input: {
  requirementMarkdown: string
  planMarkdown: string | null
  planRelativePath: string
  threadTodos?: ThreadTodoList | null
  traceSnapshot?: SddTraceSnapshot | null
}): SddTraceResult {
  const blocks = parseSddRequirementBlocks(input.requirementMarkdown)
  const planItems = input.planMarkdown ? parseSddPlanCovers(input.planMarkdown) : []

  const buildingIds = new Set<string>()
  const effectiveItems = planItems.map((item) => {
    const todoStatus = todoStatusFor(item, input.threadTodos, input.planRelativePath)
    if (todoStatus === 'in_progress') {
      for (const id of item.requirementIds) buildingIds.add(id)
    }
    return todoStatus === 'completed' ? { ...item, checked: true } : item
  })

  const { perRequirement, uncoveredIds } = computeSddCoverage(blocks, effectiveItems)
  const derivedStatuses = deriveSddStatuses(blocks, perRequirement)
  for (const id of buildingIds) {
    const block = blocks.find((candidate) => candidate.id === id)
    if (!block) continue
    const currentRank = STATUS_RANK[derivedStatuses[id] ?? block.status]
    if (currentRank < STATUS_RANK.building) derivedStatuses[id] = 'building'
  }

  const drift = input.traceSnapshot
    ? diffSddRequirementChanges(input.requirementMarkdown, input.traceSnapshot)
    : { changedIds: [], addedIds: [] }

  return {
    blocks,
    perRequirement,
    uncoveredIds,
    derivedStatuses,
    changedIds: drift.changedIds,
    addedIds: drift.addedIds
  }
}
