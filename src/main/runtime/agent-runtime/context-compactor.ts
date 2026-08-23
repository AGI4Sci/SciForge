import { createHash } from 'node:crypto'
import { toWellFormedUnicode, truncateWellFormedUnicode } from '@sciforge/domain-sdk/unicode'
import type { AgentRuntimeItem } from '../../../shared/agent-runtime-contract'

export type AgentRuntimeCompactionMode = 'normal' | 'aggressive' | 'force'

export type AgentRuntimeCompactionPlan = {
  mode: AgentRuntimeCompactionMode
  keepRecent: number
  reason: string
  estimatedTokens: number
}

export type AgentRuntimeCompactionResult = {
  effectiveItems: AgentRuntimeItem[]
  summaryItem: AgentRuntimeItem & {
    kind: 'compaction'
    summary: string
    replacedTokens: number
    sourceDigest?: string
    digestMarker?: string
    sourceItemIds?: string[]
  }
  replacedTokens: number
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
}

export type AgentRuntimeContextCompactorOptions = {
  softThreshold?: number
  hardThreshold?: number
}

export class AgentRuntimeContextCompactor {
  private readonly softThreshold: number
  private readonly hardThreshold: number

  constructor(options: AgentRuntimeContextCompactorOptions = {}) {
    this.softThreshold = positiveInteger(options.softThreshold, 16_000)
    this.hardThreshold = Math.max(
      this.softThreshold,
      positiveInteger(options.hardThreshold, 24_000)
    )
  }

  estimate(items: AgentRuntimeItem[]): number {
    return estimateRuntimeItems(items)
  }

  planCompaction(
    items: AgentRuntimeItem[],
    options: { promptTokens?: number; frozenItemCount?: number } = {}
  ): AgentRuntimeCompactionPlan | null {
    const frozenItemCount = normalizeFrozenItemCount(options.frozenItemCount, items.length)
    const compactableItems = frozenItemCount > 0 ? items.slice(frozenItemCount) : items
    const estimatedTokens = this.estimate(compactableItems)
    const promptTokens = typeof options.promptTokens === 'number' && Number.isFinite(options.promptTokens)
      ? Math.max(0, Math.floor(options.promptTokens))
      : undefined
    const tokens = Math.max(estimatedTokens, promptTokens ?? 0)
    if (tokens < this.softThreshold) return null
    const aggressiveThreshold = this.softThreshold + Math.floor((this.hardThreshold - this.softThreshold) * 0.6)
    const mode: AgentRuntimeCompactionMode =
      tokens >= this.hardThreshold
        ? 'force'
        : tokens >= aggressiveThreshold
          ? 'aggressive'
          : 'normal'
    const keepRecent = mode === 'force' ? 1 : mode === 'aggressive' ? 2 : 4
    const source = promptTokens !== undefined && promptTokens >= estimatedTokens
      ? 'usage prompt_tokens'
      : 'estimated prompt tokens'
    return {
      mode,
      keepRecent,
      reason: `${source} ${tokens} reached ${mode} compaction threshold`,
      estimatedTokens: tokens
    }
  }

  compact(input: {
    threadId: string
    turnId: string
    history: AgentRuntimeItem[]
    mode?: AgentRuntimeCompactionMode
    keepRecent?: number
    reason?: string
    summaryOverride?: string
    frozenItemCount?: number
    pinnedConstraints?: string[]
    budgetTokens?: number
  }): AgentRuntimeCompactionResult {
    const frozenItemCount = normalizeFrozenItemCount(input.frozenItemCount, input.history.length)
    const frozen = frozenItemCount > 0 ? input.history.slice(0, frozenItemCount) : []
    const history = trimTrailingRunningTools(input.history.slice(frozenItemCount))
    const requestedKeepRecent = Math.max(0, Math.floor(input.keepRecent ?? 4))
    const keepRecent = history.length <= 1
      ? history.length
      : Math.min(requestedKeepRecent, history.length - 1)
    if (history.length <= 1 || history.length - keepRecent <= 0) {
      const summaryItem = makeRuntimeCompactionItem({
        id: `compaction_${input.turnId}_noop`,
        turnId: input.turnId,
        summary: 'no compaction needed',
        replacedTokens: 0
      })
      return {
        effectiveItems: [...frozen, ...history],
        summaryItem,
        replacedTokens: 0
      }
    }

    const head = keepRecent === 0 ? history : history.slice(0, history.length - keepRecent)
    const tail = keepRecent === 0 ? [] : history.slice(-keepRecent)
    const replacedTokens = this.estimate(head)
    const sourceDigest = computeShortHash(compactedRuntimeItemsDigestSource(head))
    const digestMarker = createRuntimeDigestMarker(sourceDigest)
    const summaryBase = toWellFormedUnicode(input.summaryOverride?.trim() || buildRuntimeCompactionSummary({
      history,
      head,
      tail,
      reason: input.reason,
      mode: input.mode,
      budgetTokens: input.budgetTokens,
      pinnedConstraints: input.pinnedConstraints ?? []
    }))
    const summary = appendDigestMarker(summaryBase, digestMarker)
    const sourceItemIds = head.map((item) => item.id)
    const summaryItem = makeRuntimeCompactionItem({
      id: `compaction_${input.turnId}_${sourceDigest}`,
      turnId: input.turnId,
      summary,
      replacedTokens,
      sourceDigest,
      digestMarker,
      sourceItemIds
    })
    return {
      effectiveItems: [...frozen, summaryItem, ...tail],
      summaryItem,
      replacedTokens,
      sourceDigest,
      digestMarker,
      sourceItemIds
    }
  }
}

export function estimateRuntimeItems(items: AgentRuntimeItem[]): number {
  return items.reduce((total, item) => total + estimateRuntimeItem(item), 0)
}

function estimateRuntimeItem(item: AgentRuntimeItem): number {
  const text = runtimeItemText(item)
  const meta = item.meta ? stableStringify(stableShape(item.meta)) : ''
  return Math.max(1, Math.ceil((text.length + meta.length + item.kind.length + 16) / 4))
}

function trimTrailingRunningTools(history: AgentRuntimeItem[]): AgentRuntimeItem[] {
  let end = history.length
  while (end > 0) {
    const item = history[end - 1]
    if (item.kind !== 'tool' || (item.status !== 'running' && item.status !== 'pending')) break
    end -= 1
  }
  return end === history.length ? history : history.slice(0, end)
}

function makeRuntimeCompactionItem(input: {
  id: string
  turnId: string
  summary: string
  replacedTokens: number
  sourceDigest?: string
  digestMarker?: string
  sourceItemIds?: string[]
}): AgentRuntimeCompactionResult['summaryItem'] {
  return {
    id: input.id,
    turnId: input.turnId,
    kind: 'compaction',
    summary: input.summary,
    status: 'completed',
    replacedTokens: input.replacedTokens,
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    ...(input.digestMarker ? { digestMarker: input.digestMarker } : {}),
    ...(input.sourceItemIds ? { sourceItemIds: [...input.sourceItemIds] } : {})
  }
}

function buildRuntimeCompactionSummary(input: {
  history: AgentRuntimeItem[]
  head: AgentRuntimeItem[]
  tail: AgentRuntimeItem[]
  reason?: string
  mode?: AgentRuntimeCompactionMode
  budgetTokens?: number
  pinnedConstraints: string[]
}): string {
  const contentBudget = summaryCharBudget(input.budgetTokens)
  const lines: string[] = []
  if (input.reason) lines.push(`Reason: ${input.reason}`)
  if (input.mode) lines.push(`Mode: ${input.mode}`)
  if (input.budgetTokens !== undefined) lines.push(`Budget: ${input.budgetTokens} tokens`)
  lines.push('Pinned constraints (preserved across compaction):')
  if (input.pinnedConstraints.length === 0) {
    lines.push('- (none)')
  } else {
    for (const pinned of input.pinnedConstraints) lines.push(`- ${pinned}`)
  }
  const skillPins = extractSkillPins(input.history)
  if (skillPins.length > 0) {
    lines.push('Pinned skills (preserved across compaction):')
    for (const skillPin of skillPins) lines.push(`- ${skillPin}`)
    lines.push('')
  }
  lines.push('')
  lines.push(
    `Summarized ${input.history.length} item(s); ${input.tail.length} recent item(s) are also kept verbatim for the current request.`
  )
  lines.push('Conversation and work summary:')
  const summaryLines = fitLinesToBudget(
    selectSummaryLines(input.history.map(summarizeRuntimeItem).filter(Boolean)),
    contentBudget
  )
  lines.push(...(summaryLines.length ? summaryLines : ['- No user-visible content before compaction.']))
  return lines.join('\n')
}

function summarizeRuntimeItem(item: AgentRuntimeItem): string {
  const text = runtimeItemText(item)
  if (!text) return ''
  switch (item.kind) {
    case 'user_message':
      return `- User: ${clipText(text)}`
    case 'assistant_message':
      return `- Assistant: ${clipText(text)}`
    case 'tool':
      return `- Tool${item.toolKind ? ` ${item.toolKind}` : ''}${item.status ? ` ${item.status}` : ''}: ${clipText(text)}`
    case 'compaction':
      return `- Earlier compaction summary: ${clipText(text, 600)}`
    case 'review':
      return `- Review: ${clipText(text)}`
    case 'approval':
      return `- Approval ${item.status ?? 'pending'}: ${clipText(text)}`
    case 'user_input':
      return `- User input ${item.status ?? 'pending'}: ${clipText(text)}`
    case 'system':
      return `- System: ${clipText(text)}`
    case 'reasoning':
      return ''
  }
}

function runtimeItemText(item: AgentRuntimeItem): string {
  return (item.text ?? item.summary ?? item.detail ?? '').trim().replace(/\s+/gu, ' ')
}

function extractSkillPins(history: AgentRuntimeItem[]): string[] {
  const pins = new Set<string>()
  for (const item of history) {
    if (item.kind !== 'assistant_message' && item.kind !== 'user_message' && item.kind !== 'compaction') continue
    const text = runtimeItemText(item)
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (/^(Active Skill:|Skill Pin:|Pinned Skill:)/iu.test(trimmed)) {
        pins.add(clipText(trimmed, 600))
      }
    }
  }
  return [...pins]
}

function summaryCharBudget(budgetTokens: number | undefined): number {
  if (budgetTokens === undefined) return 4_000
  return Math.max(1_200, Math.min(12_000, budgetTokens * 4))
}

function selectSummaryLines(lines: string[]): string[] {
  if (lines.length <= 20) return lines
  const start = lines.slice(0, 4)
  const end = lines.slice(-14)
  return [
    ...start,
    `- ${lines.length - start.length - end.length} middle item(s) omitted from this compact summary.`,
    ...end
  ]
}

function fitLinesToBudget(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const nextCost = line.length + 1
    if (used + nextCost <= budget) {
      out.push(line)
      used += nextCost
      continue
    }
    const remaining = budget - used
    if (remaining > 80) out.push(clipText(line, remaining))
    break
  }
  return out
}

function compactedRuntimeItemsDigestSource(items: AgentRuntimeItem[]): string {
  return stableStringify(items.map(runtimeItemDigestShape))
}

function runtimeItemDigestShape(item: AgentRuntimeItem): unknown {
  return {
    kind: item.kind,
    text: item.text,
    summary: item.summary,
    detail: item.detail,
    status: item.status,
    toolKind: item.toolKind,
    meta: stableShape(item.meta)
  }
}

function computeShortHash(content: string | Uint8Array, length = 16): string {
  return createHash('sha256').update(content).digest('hex').slice(0, Math.max(1, length))
}

function createRuntimeDigestMarker(shortHash: string): string {
  return `<runtime:compaction_digest sha256="${escapeMarkerAttribute(shortHash)}">`
}

function appendDigestMarker(summary: string, digestMarker: string): string {
  const trimmed = summary.trim()
  if (trimmed.includes(digestMarker)) return trimmed
  return `${trimmed}\n\nCompaction digest marker: ${digestMarker}`
}

function stableShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableShape)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = stableShape((value as Record<string, unknown>)[key])
  }
  return out
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableShape(value))
}

function escapeMarkerAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function clipText(text: string, max = 360): string {
  const compact = toWellFormedUnicode(text).replace(/\s+/gu, ' ').trim()
  if (compact.length <= max) return compact
  return `${truncateWellFormedUnicode(compact, Math.max(0, max - 3)).trim()}...`
}

function normalizeFrozenItemCount(value: number | undefined, historyLength: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(historyLength, Math.floor(value)))
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}
