import { parseExperimentArtifacts } from './artifact-parser.js'
import { resolveMemoryContext } from './context-resolver.js'
import { reflectExperimentRuns } from './reflection.js'
import { ResearchMemoryStore } from './store.js'
import { writeResearchMemorySnapshot } from './snapshot.js'
import type {
  ExperimentRun,
  ExperimentRunDraft,
  MemoryItem,
  MemoryItemDraft,
  MemoryReviewAction,
  ReflectionOutput,
  ResearchMemoryServiceOptions,
  ResolveContextInput,
  ResolveContextOutput
} from './types.js'

export class ResearchMemoryService {
  private readonly store: ResearchMemoryStore
  private readonly workspaceRoot: string
  private readonly projectId: string

  constructor(options: ResearchMemoryServiceOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.projectId = options.projectId?.trim() || options.workspaceRoot
    this.store = new ResearchMemoryStore(options)
  }

  recordExperiment(draft: ExperimentRunDraft): { run: ExperimentRun } {
    const parsed = parseExperimentArtifacts({
      workspaceRoot: this.workspaceRoot,
      metrics: draft.metrics,
      metricsPath: draft.metricsPath,
      logsExcerpt: draft.logsExcerpt,
      logPath: draft.logPath,
      artifactRefs: draft.artifactRefs,
      artifactManifestPath: draft.artifactManifestPath
    })
    const run = this.store.upsertExperimentRun({
      ...draft,
      projectId: draft.projectId ?? this.defaultProjectId(),
      status: draft.status ?? 'completed',
      metrics: parsed.metrics,
      logsExcerpt: parsed.logsExcerpt,
      artifactRefs: parsed.artifactRefs
    })
    return { run }
  }

  proposeInsight(draft: MemoryItemDraft): { item: MemoryItem } {
    const item = this.store.createMemoryItem({
      ...draft,
      projectId: draft.projectId ?? this.defaultProjectId()
    })
    return { item }
  }

  reflectExperiments(input: {
    projectId?: string
    runIds?: string[]
    includeWeakCandidates?: boolean
  }): ReflectionOutput {
    const projectId = input.projectId ?? this.defaultProjectId()
    const requested = new Set(input.runIds ?? [])
    const runs = this.store.listExperimentRuns(projectId)
      .filter((run) => requested.size === 0 || requested.has(run.id))
    const output = reflectExperimentRuns({
      projectId,
      runs,
      includeWeakCandidates: input.includeWeakCandidates,
      create: (draft) => this.store.createMemoryItem(draft)
    })
    this.store.createReflectionRun({
      projectId,
      kind: 'experiments',
      sourceRunIds: runs.map((run) => run.id),
      createdMemoryIds: output.created.map((item) => item.id)
    })
    return output
  }

  reflectThread(input: {
    projectId?: string
    threadId: string
    scope: 'recent_turns' | 'full_thread' | 'since_last_reflection'
    threadText?: string
    highlights?: string[]
    turns?: Array<{ id?: string; role?: string; text?: string }>
  }): { created: MemoryItem[]; warnings: string[] } {
    const projectId = input.projectId ?? this.defaultProjectId()
    const warnings: string[] = []
    const candidates = extractThreadMemoryDrafts(input)
    if (candidates.length === 0) {
      warnings.push('No thread content was supplied; no Research Memory item was created.')
      this.store.createReflectionRun({
        projectId,
        kind: 'thread',
        sourceThreadRefs: [input.threadId],
        createdMemoryIds: []
      })
      return { created: [], warnings }
    }
    const turnRefs = uniqueStrings((input.turns ?? [])
      .map((turn) => turn.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => `turn:${id}`))
    const created = candidates.map((candidate) => this.store.createMemoryItem({
      projectId,
      ...candidate,
      evidenceRefs: uniqueStrings([`thread:${input.threadId}`, ...turnRefs, ...(candidate.evidenceRefs ?? [])]),
      sourceThreadRefs: [input.threadId],
      confidence: candidate.confidence ?? 0.58
    }))
    this.store.createReflectionRun({
      projectId,
      kind: 'thread',
      sourceThreadRefs: [input.threadId],
      createdMemoryIds: created.map((item) => item.id)
    })
    return { created, warnings }
  }

  resolveContext(input: ResolveContextInput): ResolveContextOutput {
    const requestedProjectId = input.projectId ?? this.defaultProjectId()
    const { projectId, items, warnings } = this.resolveProjectMemoryItems(requestedProjectId)
    const output = resolveMemoryContext(
      { ...input, projectId },
      items
    )
    return {
      ...output,
      warnings: [...warnings, ...output.warnings]
    }
  }

  reviewItem(input: {
    memoryId: string
    action: MemoryReviewAction
    note?: string
    supersededBy?: string
  }): { item: MemoryItem } {
    return { item: this.store.reviewMemoryItem(input) }
  }

  snapshot(input: {
    projectId?: string
    format: 'markdown' | 'json'
  }): { path: string } {
    const projectId = input.projectId ?? this.defaultProjectId()
    return writeResearchMemorySnapshot({
      workspaceRoot: this.workspaceRoot,
      projectId,
      format: input.format,
      runs: this.store.listExperimentRuns(projectId),
      items: this.store.listMemoryItems(projectId)
    })
  }

  listExperimentRuns(projectId = this.defaultProjectId()): ExperimentRun[] {
    return this.store.listExperimentRuns(projectId)
  }

  listMemoryItems(projectId = this.defaultProjectId()): MemoryItem[] {
    return this.store.listMemoryItems(projectId)
  }

  close(): void {
    this.store.close()
  }

  private defaultProjectId(): string {
    return this.projectId
  }

  private resolveProjectMemoryItems(requestedProjectId: string): {
    projectId: string
    items: MemoryItem[]
    warnings: string[]
  } {
    const projectId = requestedProjectId.trim() || this.defaultProjectId()
    const items = this.store.listMemoryItems(projectId)
    if (items.length > 0) return { projectId, items, warnings: [] }

    const candidateProjectIds = this.store
      .listMemoryProjectIds()
      .filter((knownProjectId) => knownProjectId !== projectId)
    if (candidateProjectIds.length === 1) {
      const fallbackProjectId = candidateProjectIds[0]
      return {
        projectId: fallbackProjectId,
        items: this.store.listMemoryItems(fallbackProjectId),
        warnings: [
          `No Research Memory items were found for projectId "${projectId}"; resolved against "${fallbackProjectId}" because it is the only project with memory in this workspace.`
        ]
      }
    }
    if (candidateProjectIds.length > 1) {
      return {
        projectId,
        items,
        warnings: [
          `No Research Memory items were found for projectId "${projectId}". Available projectIds with memory: ${candidateProjectIds.join(', ')}.`
        ]
      }
    }
    return { projectId, items, warnings: [] }
  }
}

export function createResearchMemoryService(options: ResearchMemoryServiceOptions): ResearchMemoryService {
  return new ResearchMemoryService(options)
}

function extractThreadMemoryDrafts(input: {
  threadId: string
  scope: 'recent_turns' | 'full_thread' | 'since_last_reflection'
  threadText?: string
  highlights?: string[]
  turns?: Array<{ id?: string; role?: string; text?: string }>
}): MemoryItemDraft[] {
  const explicitHighlights = (input.highlights ?? [])
    .map(cleanClaim)
    .filter(Boolean)
  const turnText = (input.turns ?? [])
    .map((turn) => cleanClaim(turn.text ?? ''))
    .filter(Boolean)
  const threadText = splitThreadText(input.threadText ?? '')
  const candidates = uniqueStrings([
    ...explicitHighlights,
    ...threadText.filter(isLikelyReusableThreadInsight),
    ...turnText.filter(isLikelyReusableThreadInsight)
  ]).slice(0, 5)
  const fallback = candidates.length > 0
    ? candidates
    : uniqueStrings([...threadText, ...turnText]).slice(0, 1)
  return fallback
    .map((claim) => ({
      type: memoryTypeForThreadClaim(claim),
      claim,
      rationale: `Extracted from reflected thread ${input.threadId} (${input.scope}).`,
      recommendedAction: recommendedActionForThreadClaim(claim),
      evidenceRefs: [`thread:${input.threadId}`],
      confidence: explicitHighlights.includes(claim) ? 0.65 : 0.58
    }))
}

function splitThreadText(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n+|(?<=[.!?。！？])\s+/u)
    .map(cleanClaim)
    .filter(Boolean)
}

function cleanClaim(value: string): string {
  return value
    .replace(/^\s*[-*>\d.)\]]+\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

function isLikelyReusableThreadInsight(text: string): boolean {
  return /debug|bug|error|failure|failed|fix|root cause|cause|metric|accuracy|loss|f1|baseline|ablation|prefer|avoid|should|next|hypothesis|规律|原则|原因|失败|修复|指标|基线|方法|选择|避免|下一步|假设/u.test(text.toLowerCase())
}

function memoryTypeForThreadClaim(claim: string): MemoryItemDraft['type'] {
  const lower = claim.toLowerCase()
  if (/debug|bug|error|failure|failed|fix|root cause|修复|失败|报错|原因/u.test(lower)) return 'debug_insight'
  if (/metric|accuracy|loss|f1|auc|auroc|指标/u.test(lower)) return 'metric_interpretation'
  if (/baseline|ablation|prefer|method|should|基线|消融|方法|选择/u.test(lower)) return 'method_choice'
  if (/principle|规律|原则/u.test(lower)) return 'research_principle'
  if (/hypothesis|假设/u.test(lower)) return 'hypothesis'
  return 'analysis_insight'
}

function recommendedActionForThreadClaim(claim: string): string {
  if (/avoid|避免|不要/u.test(claim.toLowerCase())) return 'Check this constraint before repeating the next experiment or implementation.'
  if (/next|下一步|should|prefer|建议/u.test(claim.toLowerCase())) return 'Consider this guidance when drafting the next research plan.'
  return 'Resolve Research Memory before the next related task and verify this insight against concrete files, logs, or metrics.'
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
