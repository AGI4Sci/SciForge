import type {
  MemoryItem,
  MemoryPacket,
  ResolveContextInput,
  ResolveContextOutput
} from './types.js'

const DEFAULT_BUDGET_CHARS = 8000

export function resolveMemoryContext(
  input: ResolveContextInput,
  items: MemoryItem[]
): ResolveContextOutput {
  const query = input.query.trim()
  const includeHypotheses = input.includeHypotheses === true
  const eligible = items
    .filter((item) => item.status !== 'rejected' && item.status !== 'invalidated' && item.status !== 'superseded')
    .filter((item) => includeHypotheses || item.status !== 'hypothesis')
    .sort((a, b) => scoreItem(b, query) - scoreItem(a, query))

  const negativeResults = eligible.filter((item) => item.type === 'negative_result').map(packetFromItem)
  const methodChoices = eligible.filter((item) => item.type === 'method_choice').map(packetFromItem)
  const hypotheses = includeHypotheses
    ? eligible.filter((item) => item.status === 'hypothesis' || item.type === 'hypothesis').map(packetFromItem)
    : []
  const relevantInsights = eligible
    .filter((item) => item.type !== 'negative_result' && item.type !== 'method_choice')
    .filter((item) => item.status !== 'hypothesis' && item.type !== 'hypothesis')
    .map(packetFromItem)

  const warnings = []
  if (!includeHypotheses && items.some((item) => item.status === 'hypothesis' || item.type === 'hypothesis')) {
    warnings.push('Hypotheses were excluded. Pass includeHypotheses=true to inspect unvalidated ideas.')
  }

  const budget = boundedBudget(input.budgetChars)
  const trimmed = trimPacketsToBudget({
    relevantInsights,
    negativeResults,
    methodChoices,
    hypotheses,
    budgetChars: budget
  })
  return {
    ...trimmed,
    evidenceRefs: uniqueStrings([
      ...trimmed.relevantInsights.flatMap((item) => item.evidenceRefs),
      ...trimmed.negativeResults.flatMap((item) => item.evidenceRefs),
      ...trimmed.methodChoices.flatMap((item) => item.evidenceRefs),
      ...trimmed.hypotheses.flatMap((item) => item.evidenceRefs)
    ]),
    warnings
  }
}

function packetFromItem(item: MemoryItem): MemoryPacket {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    claim: item.claim,
    ...(item.rationale ? { rationale: item.rationale } : {}),
    ...(item.recommendedAction ? { recommendedAction: item.recommendedAction } : {}),
    confidence: item.confidence,
    evidenceLevel: item.evidenceLevel,
    evidenceRefs: item.evidenceRefs,
    sourceRunIds: item.sourceRunIds
  }
}

function scoreItem(item: MemoryItem, query: string): number {
  const haystack = [
    item.claim,
    item.rationale,
    item.recommendedAction,
    item.type,
    item.status,
    item.evidenceRefs.join(' ')
  ].join(' ').toLowerCase()
  const terms = query.toLowerCase().split(/[^a-z0-9_\u4e00-\u9fff]+/).filter(Boolean)
  const termScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
  const statusScore = item.status === 'active' ? 3 : item.status === 'candidate' ? 1 : 0
  return termScore + statusScore + item.confidence
}

function trimPacketsToBudget(input: {
  relevantInsights: MemoryPacket[]
  negativeResults: MemoryPacket[]
  methodChoices: MemoryPacket[]
  hypotheses: MemoryPacket[]
  budgetChars: number
}): Pick<ResolveContextOutput, 'relevantInsights' | 'negativeResults' | 'methodChoices' | 'hypotheses'> {
  let used = 0
  const take = (packet: MemoryPacket): boolean => {
    const size = JSON.stringify(packet).length
    if (used + size > input.budgetChars) return false
    used += size
    return true
  }
  return {
    methodChoices: input.methodChoices.filter(take),
    negativeResults: input.negativeResults.filter(take),
    relevantInsights: input.relevantInsights.filter(take),
    hypotheses: input.hypotheses.filter(take)
  }
}

function boundedBudget(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? Math.min(value, 64_000)
    : DEFAULT_BUDGET_CHARS
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
