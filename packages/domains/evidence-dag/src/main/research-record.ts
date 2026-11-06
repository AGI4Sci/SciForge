import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { DomainAgentThreadDetail, DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { domainMainAgentExecutionOutputSchemaSchema } from '@sciforge/domain-sdk/agent-execution'
import {
  researchRecordPhaseSynthesisSchema, researchRecordContextBoundarySchema,
  researchRecordViewInputSchema, researchRecordEditInputSchema,
  researchRecordReviewInputSchema, researchRecordAuditInputSchema, researchRecordAuditOutputSchema,
  type ResearchRecordReview, type ResearchRecordAudit,
  type ResearchRecordNode, type ResearchRecordScope, type ResearchRecordView,
  type ResearchRecordEdit
} from '../research-record-contract.js'
import { recordArtifactReferences } from '../research-record-artifact-refs.js'
import { ResearchSourceStore } from './research-source-store.js'
import { ResearchRecordStore } from './research-record-store.js'
import { researchSourceDigest as sourceDigest, visibleResearchItems, visibleResearchContextBoundaries } from './research-record-ingestion.js'
import { reasonAboutResearchRecord, researchRecordTextDigest, researchRecordGenerationSchema, researchRecordCompactClassificationSchema } from './research-record-model.js'
import { reviewResearchRecord, historyOrigin, historySources, recordFields, nodePath, object } from './research-record-review.js'
import { researchRecordQueryIndex, researchRecordPagePosition } from './research-record-query.js'
import { buildResearchRecordIndex } from './research-record-index.js'
import { recordHash as hash, recordKey as key, unlocked, union, remainingSources,
  synthesisContext, applyStatePatch, projectSynthesisSummary, patchPredecessor, type ResearchRecordState as State, type OrganizationJob } from './research-record-state.js'

const time = () => new Date().toISOString()
const sameWorkspace = (a: string, b: string) => resolve(a) === resolve(b)
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''

/** Derived organization only. Raw actions stay in the runtime's canonical snapshot. */
export class ResearchRecordRuntime {
  private context?: DomainMainRuntimeLifecycleContext
  private enabled = false
  private closed = false
  private timer?: ReturnType<typeof setTimeout>
  private scanning?: Promise<void>
  private working?: Promise<void>
  private controller = new AbortController()
  private states = new Map<string, State>()
  private files = new Map<string, ResearchRecordStore>()
  private nextModelAt = 0
  private scanOffset = 0
  private lastWorkspace = ''
  private foregroundTurns = new Set<string>()
  private foregroundSnapshots = new Set<string>()
  private foregroundQuietUntil = 0
  private unsubscribe?: () => void | Promise<void>
  private indexes = new WeakMap<State, { revision: number; index: ReturnType<typeof buildResearchRecordIndex> }>()
  // Completed ingestion passes only; inspection always re-verifies disk bytes.
  private retentionSnapshots = new Map<string, string>()

  constructor(private readonly options: { userDataDir: string; sanitizeText?: (text: string) => string; pollMs?: number }) {}

  start(context: DomainMainRuntimeLifecycleContext, enabled: boolean): void {
    this.context = context
    this.enabled = enabled
    // Observational only: never hold a required admission or human decision lease.
    this.unsubscribe = context.turnEvents?.subscribe(event => {
      if (event.kind === 'before-turn') this.foregroundTurns.add(event.deliveryAttemptId)
      else if (event.kind === 'after-turn') {
        this.foregroundTurns.delete(event.deliveryAttemptId)
        this.foregroundQuietUntil = Date.now() + 15000
      }
      this.schedule(50)
    })
    this.schedule(0)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) { this.controller.abort(); this.controller = new AbortController() }
    this.schedule(0)
  }

  private schedule(delay = this.options.pollMs ?? 2500): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.scan().catch(() => {
        this.context?.log({ level: 'warn', message: 'Research record snapshot scan failed; canonical records were not changed.' })
      }).finally(() => this.schedule())
    }, delay)
    this.timer.unref?.()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.controller.abort()
    await this.unsubscribe?.()
    await Promise.allSettled([this.scanning, this.working])
    this.context = undefined
  }

  private requireContext(): DomainMainRuntimeLifecycleContext {
    if (!this.context || this.closed || !this.enabled) throw new Error('研究记录当前不可用。')
    return this.context
  }

  private state(workspace: string): State {
    const root = resolve(workspace)
    let value = this.states.get(root)
    if (value) return value
    const file = new ResearchRecordStore(join(this.options.userDataDir, 'evidence-dag', `research-record-${hash(root)}.json`), root)
    value = file.load() ?? { version: 2, workspaceRoot: root, revision: 0, paused: false, model: '', nodes: {}, messages: {}, jobs: {}, phaseJobs: {}, receipts: {}, handoffs: {}, history: [], failures: [], lastScanAt: null }
    if (!sameWorkspace(value.workspaceRoot, root)) throw new Error('Research record workspace mismatch.')
    this.files.set(root, file)
    this.states.set(root, value)
    return value
  }

  private save(state: State): void {
    if (this.states.get(state.workspaceRoot) !== state) throw new Error('研究记录存储状态已失效，请重新读取。')
    state.revision++
    try { this.files.get(state.workspaceRoot)!.commit(state) }
    catch (error) {
      state.paused = true
      this.states.delete(state.workspaceRoot)
      throw error
    }
  }

  private index(state: State) {
    let cached = this.indexes.get(state)
    if (!cached || cached.revision !== state.revision) {
      cached = { revision: state.revision, index: buildResearchRecordIndex(state.nodes) }
      this.indexes.set(state, cached)
    }
    return cached.index
  }

  private async authorized(scope: ResearchRecordScope): Promise<{ state: State }> {
    const context = this.requireContext()
    const identity = { runtimeId: scope.runtimeId, threadId: scope.threadId }
    const detail = context.agentThreads.readMetadata ? await context.agentThreads.readMetadata(identity) : await context.agentThreads.read(identity)
    if (detail.id !== scope.threadId || detail.runtimeId !== scope.runtimeId || !detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, scope.workspaceRoot)) {
      throw new Error('会话与工作区不匹配。')
    }
    return { state: this.state(scope.workspaceRoot) }
  }

  /** Serialized snapshots; the model worker is deliberately detached from ingestion. */
  async scan(): Promise<void> {
    if (this.scanning) return this.scanning
    if (!this.enabled || this.closed) return
    this.scanning = this.scanOnce().finally(() => { this.scanning = undefined })
    return this.scanning
  }

  private async scanOnce(): Promise<void> {
    const context = this.requireContext()
    const threads = await context.agentThreads.list({ includeArchived: true, includeSide: false })
    // Recent sessions stay responsive while historical sessions backfill fairly.
    const recent = threads.slice(0, 4), history = threads.slice(4)
    const batch = [...recent]
    for (let i = 0; i < Math.min(12, history.length); i++) batch.push(history[(this.scanOffset + i) % history.length])
    if (history.length) this.scanOffset = (this.scanOffset + 12) % history.length
    for (const thread of batch) {
      if (this.closed || !this.enabled) return
      if (!thread.workspaceRoot) continue
      try {
        const detail = await context.agentThreads.read({ runtimeId: thread.runtimeId, threadId: thread.id })
        if (detail.id !== thread.id || detail.runtimeId !== thread.runtimeId || !detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, thread.workspaceRoot)) throw new Error('Snapshot scope mismatch')
        const activityId = key(thread.runtimeId, thread.id)
        const latest = detail.turns.at(-1)
        if (latest && ['starting', 'running', 'in_progress', 'reconnecting', 'tool_waiting', 'stream_recovering', 'completing'].includes(latest.status ?? '')) this.foregroundSnapshots.add(activityId)
        else this.foregroundSnapshots.delete(activityId)
        this.ingest(this.state(detail.workspaceRoot), detail)
      } catch {
        // Report one source gap, keep other sessions ingesting, never clear prior results.
        const state = this.state(thread.workspaceRoot)
        const nodeId = key(thread.runtimeId, thread.id)
        if (!state.failures.some(failure => failure.nodeId === nodeId && failure.message === '会话来源暂不可读。')) {
          state.failures.push({ nodeId, message: '会话来源暂不可读。', at: time() }); this.save(state)
        }
      }
    }
    const listed = new Set(threads.map(thread => key(thread.runtimeId, thread.id)))
    for (const id of this.foregroundSnapshots) if (!listed.has(id)) this.foregroundSnapshots.delete(id)
    this.kickWorker()
  }

  private ingest(state: State, detail: DomainAgentThreadDetail): void {
    const scope = { runtimeId: detail.runtimeId, threadId: detail.id, workspaceRoot: state.workspaceRoot }
    const threadKey = key(state.workspaceRoot, detail.runtimeId, detail.id)
    const visible = new Map(detail.turns.map(turn => [turn.id, { turn, raw: visibleResearchItems(turn) }]))
    if (visible.size !== detail.turns.length) throw new Error('Duplicate visible research turn IDs.')
    const previousBoundary = state.ingestion?.[threadKey]
    const boundary = { watermark: detail.watermark, fingerprint: hash([...visible].map(([id, { turn, raw }]) =>
      [id, turn.status, [...raw].map(([itemId, item]) => [itemId, sourceDigest(item)]).sort()]).sort()),
      turns: structuredClone(previousBoundary?.turns ?? {}), missingIds: [] as string[],
      contextBoundaries: { ...previousBoundary?.contextBoundaries } }
    const captureSources = this.retentionSnapshots.get(threadKey) !== boundary.fingerprint
    let changed = false
    for (const { turn, raw } of visible.values()) {
      const roundId = key(scope.runtimeId, scope.threadId, turn.id)
      const round = state.nodes[roundId] ?? this.node(roundId, 'root', 'round', `研究轮次 · ${turn.id.slice(-12)}`, 'system')
      if (!state.nodes[roundId]) { if (turn.completedAt) round.createdAt = turn.completedAt; state.nodes[roundId] = round; changed = true }
      round.scope = scope; round.turnId = turn.id
      for (const metadata of visibleResearchContextBoundaries(turn)) {
        const digest = hash(metadata)
        if (boundary.contextBoundaries[key(turn.id, metadata.itemId)] === digest) continue
        boundary.contextBoundaries[key(turn.id, metadata.itemId)] = digest
        state.history.push({ at: time(), nodeId: roundId, kind: 'context-boundary', value: {
          scope, turnId: turn.id, metadata, completeness: 'unknown', hiddenReasoning: 'not-recorded'
        } })
        changed = true
      }
      if (round.status !== (turn.status ?? 'unknown')) { round.status = turn.status ?? 'unknown'; changed = true }
      boundary.turns[turn.id] = { status: turn.status ?? 'unknown', sources: {
        ...boundary.turns[turn.id]?.sources, ...Object.fromEntries([...raw].map(([id, item]) => [id, sourceDigest(item)])) } }
      for (const item of raw.values()) {
        const digest = sourceDigest(item)
        const eventId = key(roundId, item.id, digest)
        const sourceRef = { ...scope, turnId: turn.id, itemId: item.id, digest }
        const retained = !captureSources || this.sourceStore().retain(sourceRef, item)
        if (!retained && !state.failures.some(f => f.nodeId === eventId)) { state.failures.push({ nodeId: eventId, message: '来源超过 2 MiB；未保全原文，不会用截断内容替代。', at: time() }); changed = true }
        if (state.nodes[eventId]) continue
        // Keep old revisions referenced by earlier summaries; never rewrite a prior observation.
        const meta = record(item.meta)
        const skill = string(meta.skillName) || string(meta.skillId)
        const plugin = string(meta.pluginName) || string(meta.pluginId)
        const capability = skill ? `Skill · ${skill}` : plugin ? `Plugin · ${plugin}` : string(item.toolKind) || string(item.kind) || '行为'
        const groupId = key(roundId, capability)
        state.nodes[groupId] ??= this.node(groupId, roundId, 'capability', capability, 'system')
        const label = string(item.summary) || string(item.text) || string(item.detail) || capability
        const node = this.node(eventId, groupId, 'event', this.sanitize(label).slice(0, 160), 'system')
        node.status = item.status ?? 'unknown'
        node.source = { ...scope, turnId: turn.id, itemId: item.id, digest }
        node.createdAt = string(item.createdAt) || round.createdAt
        state.nodes[eventId] = node
        changed = true
      }
      const ungrouped = Object.values(state.nodes).filter(node => node.parentId === roundId && node.kind === 'capability')
      if (ungrouped.length) {
        const pendingId = key(roundId, 'unclassified')
        state.nodes[pendingId] ??= this.node(pendingId, roundId, 'step', '补充与未归类记录', 'system')
        for (const group of ungrouped) group.parentId = pendingId
        changed = true
      }
      // Only settled observations go to the model. Changing live streams remain inspectable.
      const visibleIds = [...raw.values()].map(item => key(roundId, item.id, sourceDigest(item)))
      // Absence is a projection gap; only an actually visible revision supersedes a source.
      const visibleSet = new Set(visibleIds)
      // Preserve the recorded order. A reordered projection or format upgrade
      // must not change stage metadata and trigger another model synthesis.
      const sourceIds = union((state.jobs[roundId]?.sourceIds ?? []).filter(id => {
        const source = state.nodes[id]?.source
        return visibleSet.has(id) || source && !raw.has(source.itemId)
      }), visibleIds)
      const fingerprint = hash([turn.status, sourceIds])
      if ((sourceIds.length || state.jobs[roundId]) && state.jobs[roundId]?.fingerprint !== fingerprint) {
        const previous = state.jobs[roundId] as OrganizationJob | undefined
        state.jobs[roundId] = { ...(previous ?? { processedIds: [], assignedIds: [], fullExcerptIds: [], truncatedIds: [], unavailableIds: [], changedIds: [], semanticPendingIds: [] }),
          fingerprint, sourceIds, attempts: 0, nextAt: Date.now() + 1500 }
        state.jobs[roundId].changedIds = union(state.jobs[roundId].changedIds, (previous?.sourceIds ?? []).filter(id => {
          const source = state.nodes[id]?.source
          return source && raw.has(source.itemId) && source.digest !== sourceDigest(raw.get(source.itemId))
        }))
        this.dirtyPhases(state, roundId)
        round.updatedAt = time()
        changed = true
      }
    }
    for (const [roundId, job] of Object.entries(state.jobs)) {
      const round = state.nodes[roundId]
      if (round?.scope?.runtimeId !== scope.runtimeId || round.scope.threadId !== scope.threadId) continue
      const raw = visible.get(round.turnId!)?.raw
      const missing = job.sourceIds.filter(id => !raw?.has(state.nodes[id]?.source?.itemId ?? ''))
      boundary.missingIds.push(...missing)
      const current = job.sourceIds.filter(id => {
        const ref = state.nodes[id]?.source
        return ref && raw?.has(ref.itemId) && sourceDigest(raw.get(ref.itemId)) === ref.digest
      })
      const unavailableIds = union(job.unavailableIds.filter(id => !current.includes(id)), missing).sort()
      const changedIds = job.changedIds.filter(id => !current.includes(id))
      if (hash([unavailableIds, changedIds]) !== hash([job.unavailableIds, job.changedIds])) {
        if (current.some(id => job.unavailableIds.includes(id) || job.changedIds.includes(id))) { job.attempts = 0; job.nextAt = Date.now() + 1500 }
        job.unavailableIds = unavailableIds; job.changedIds = changedIds
        // Availability is checked directly by synthesisStatus/phaseRoundReady.
        // It is not new semantic content; restoration must not leave an already
        // covered phase permanently dirty or pay for another summary.
        changed = true
      }
    }
    boundary.missingIds.sort()
    if (boundary.missingIds.length) {
      const message = `可见会话投影缺少已观察来源（${boundary.missingIds.length}）；保留旧记录与覆盖，等待来源恢复。 [${hash(boundary.missingIds).slice(0, 16)}]`
      if (!state.failures.some(failure => failure.nodeId === threadKey && failure.message === message)) {
        state.failures.push({ nodeId: threadKey, message, at: time() }); changed = true
      }
    }
    if (hash(previousBoundary ?? null) !== hash(boundary)) { (state.ingestion ??= {})[threadKey] = boundary; changed = true }
    if (changed) { state.lastScanAt = time(); this.save(state) }
    if (this.retentionSnapshots.size >= 128 && !this.retentionSnapshots.has(threadKey)) this.retentionSnapshots.delete(this.retentionSnapshots.keys().next().value!)
    this.retentionSnapshots.set(threadKey, boundary.fingerprint)
  }

  private node(id: string, parentId: string, kind: ResearchRecordNode['kind'], title: string, origin: ResearchRecordNode['origin']): ResearchRecordNode {
    return { id, parentId, kind, title, summary: '', origin, status: 'unknown', createdAt: time(), updatedAt: time() }
  }

  private sanitize(text: string): string { return this.options.sanitizeText?.(text) ?? text }

  private ancestors(state: State, nodeId: string): ResearchRecordNode[] {
    const path: ResearchRecordNode[] = []
    const seen = new Set<string>()
    while (nodeId !== 'root') {
      if (seen.has(nodeId)) throw new Error('研究阶段包含循环。')
      seen.add(nodeId)
      const node = state.nodes[nodeId]
      if (!node) throw new Error('研究节点不存在。')
      path.unshift(node); nodeId = node.parentId
    }
    return path
  }

  private descendants(state: State, nodeId: string): ResearchRecordNode[] {
    if (nodeId !== 'root' && !state.nodes[nodeId]) throw new Error('研究节点不存在。')
    const children = new Map<string, ResearchRecordNode[]>()
    for (const node of Object.values(state.nodes)) {
      const siblings = children.get(node.parentId)
      if (siblings) siblings.push(node)
      else children.set(node.parentId, [node])
    }
    const queue = nodeId === 'root' ? [...(children.get('root') ?? [])] : [state.nodes[nodeId]]
    const result: ResearchRecordNode[] = []
    for (let i = 0; i < queue.length; i++) { result.push(queue[i]); for (const child of children.get(queue[i].id) ?? []) queue.push(child) }
    return result
  }

  private dirtyPhases(state: State, roundId: string, previousPath: ResearchRecordNode[] = []): void {
    const phases = [...previousPath, ...this.ancestors(state, roundId)].filter(node => node.kind === 'phase')
    for (const phase of phases) {
      const job = state.phaseJobs[phase.id] ??= { dirtyRoundIds: [], attempts: 0, nextAt: Date.now() + 60000 }
      job.dirtyRoundIds = union(job.dirtyRoundIds, [roundId])
      job.attempts = 0
      // Keep the first due time, so continued additions cannot starve synthesis.
      if (!job.nextAt) job.nextAt = Date.now() + 60000
    }
  }

  private phaseRoundReady(state: State, phase: ResearchRecordNode, roundId: string): boolean {
    const round = state.nodes[roundId], job = state.jobs[roundId]
    if (job?.sourceIds.some(id => job.unavailableIds.includes(id) || job.changedIds.includes(id))) return false
    if (!round?.synthesis?.entries.length || remainingSources(job).length || job?.sourceIds.some(id => job.semanticPendingIds.includes(id))) return false
    return phase.synthesis?.coveredChildRevisions?.[roundId] !== round.synthesis.revision ||
      phase.synthesis?.coveredChildMetadata?.[roundId] !== this.roundMetadata(state, round) ||
      phase.synthesis?.coveredChildMembership?.[roundId] !== hash(this.ancestors(state, roundId).map(node => node.id)) ||
      round.synthesis.entries.some(entry => phase.synthesis?.coveredEntryDigests?.[entry.id] !== hash(entry))
  }

  private roundMetadata(state: State, round: ResearchRecordNode): string {
    return hash([round.title, round.summary, round.status, state.jobs[round.id]?.fingerprint])
  }

  private async source(node: ResearchRecordNode, cache?: Map<string, DomainAgentThreadDetail>): Promise<{ raw?: unknown; sourceStatus: 'current' | 'changed' | 'unavailable'; rawOrigin?: 'retained' | 'live' }> {
    if (!node.source) return { sourceStatus: 'unavailable' }
    const ref = node.source
    const cacheKey = key(ref.runtimeId, ref.threadId)
    const sharedCache = cache ?? new Map<string, DomainAgentThreadDetail>()
    try {
      const reader = this.requireContext().agentThreads
      // An individual source need not hydrate unrelated turns. Batch audits keep
      // their one shared canonical snapshot so 48 sources do not repeat scans.
      if (!cache && reader.readPage) {
        let cursor: string | undefined
        const seen = new Set<string>()
        for (let count = 0; count < 4096; count++) {
          const page = await reader.readPage({ runtimeId: ref.runtimeId, threadId: ref.threadId, workspaceRoot: ref.workspaceRoot, limit: 100, ...(cursor ? { cursor } : {}) })
          if (page.id !== ref.threadId || page.runtimeId !== ref.runtimeId || !page.workspaceRoot || !sameWorkspace(page.workspaceRoot, ref.workspaceRoot)) return { sourceStatus: 'unavailable' }
          const turn = page.turns.find(turn => turn.id === ref.turnId)
          let candidate = turn?.artifacts.find(item => record(item).id === ref.itemId)
          if (!candidate) {
            const message = turn?.messages.find(message => message.itemId === ref.itemId)
            if (message) candidate = { id: message.itemId, kind: message.kind, text: message.text, createdAt: message.occurredAt }
          }
          if (candidate) {
            if (sourceDigest(candidate) === ref.digest) return { raw: candidate, sourceStatus: 'current' }
            // A bounded page can split a message. Let the canonical full reader
            // coalesce it; never label a partial or different version as matched.
            break
          }
          if (page.nextCursor === null) return { sourceStatus: 'unavailable' }
          if (seen.has(page.nextCursor)) return { sourceStatus: 'unavailable' }
          seen.add(page.nextCursor); cursor = page.nextCursor
          if (count === 4095) return { sourceStatus: 'unavailable' }
        }
      }
      let detail = sharedCache.get(cacheKey)
      if (!detail) {
        detail = await this.requireContext().agentThreads.read({ runtimeId: ref.runtimeId, threadId: ref.threadId })
        sharedCache.set(cacheKey, detail)
      }
      if (detail.id !== ref.threadId || detail.runtimeId !== ref.runtimeId || !detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, ref.workspaceRoot)) return { sourceStatus: 'unavailable' }
      const turn = detail.turns.find(turn => turn.id === ref.turnId)
      let raw = turn?.artifacts.find(item => record(item).id === ref.itemId)
      if (!raw) {
        const message = turn?.messages.find(message => message.itemId === ref.itemId)
        if (message) raw = { id: message.itemId, kind: message.kind, text: message.text, createdAt: message.occurredAt }
      }
      if (!raw) return { sourceStatus: 'unavailable' }
      return { raw, sourceStatus: sourceDigest(raw) === ref.digest ? 'current' : 'changed' }
    } catch { return { sourceStatus: 'unavailable' } }
  }

  private sourceStore() { return new ResearchSourceStore(join(this.options.userDataDir, 'evidence-dag')) }

  private async retainedSource(node: ResearchRecordNode, cache?: Map<string, DomainAgentThreadDetail>, authorization = new Map<string, boolean>()): Promise<{ raw?: unknown; rawOrigin?: 'retained' | 'live'; sourceStatus: 'current' | 'changed' | 'unavailable'; retainedSource: 'retained' | 'not-retained' | 'corrupt' | 'denied' }> {
    const live = await this.source(node, cache)
    const ref = node.source!
    // Reading an authorized workspace is insufficient for another source thread.
    // A missing source thread never grants access to retained bytes.
    try {
      const reader = this.requireContext().agentThreads
      const identity = { runtimeId: ref.runtimeId, threadId: ref.threadId }
      const authKey = key(ref.runtimeId, ref.threadId, ref.workspaceRoot)
      if (!authorization.has(authKey)) {
        const metadata = reader.readMetadata ? await reader.readMetadata(identity) : await reader.read(identity)
        authorization.set(authKey, metadata.id === ref.threadId && metadata.runtimeId === ref.runtimeId && Boolean(metadata.workspaceRoot && sameWorkspace(metadata.workspaceRoot, ref.workspaceRoot)))
      }
      if (!authorization.get(authKey)) return { sourceStatus: live.sourceStatus, retainedSource: 'denied' as const }
    } catch { return { sourceStatus: live.sourceStatus, retainedSource: 'denied' as const } }
    const retained = this.sourceStore().read(ref)
    return { sourceStatus: live.sourceStatus, retainedSource: retained.status,
      ...(retained.status === 'retained' ? { raw: retained.raw, rawOrigin: 'retained' as const } :
        retained.status === 'not-retained' && live.sourceStatus === 'current' && Buffer.byteLength(JSON.stringify(live.raw)) <= ResearchSourceStore.maxBytes ? { raw: live.raw, rawOrigin: 'live' as const } : {}) }
  }

  async view(raw: z.input<typeof researchRecordViewInputSchema>): Promise<ResearchRecordView> {
    const input = researchRecordViewInputSchema.parse(raw)
    const { state } = await this.authorized(input)
    const revision = state.revision
    const position = researchRecordPagePosition(input, revision, ['view', input.query ?? null, input.synthesisOffset ?? 0, input.messageOffset ?? 0])
    const { query, built } = researchRecordQueryIndex(state, this.index(state))
    const path = query.index.ancestors(input.nodeId)
    const node = path.at(-1) ?? null
    const selection = query.select(input.nodeId, input.query)
    const limit = input.limit ?? 100
    const children = selection.nodes.slice(position.offset, position.offset + limit)
    const nextOffset = position.offset + children.length < selection.nodes.length ? position.offset + children.length : null
    const source = node?.source ? await this.retainedSource(node) : {}
    let discussionContext: ResearchRecordView['discussionContext']
    if (input.includeDiscussionContext) {
      const selected = query.discussion(input.nodeId)
      const data = await this.contextFor(state, selected.events, true)
      const summaries = selected.summaries
      discussionContext = {
        evidence: data.evidence.filter(item => item.ref).map(item => ({
          id: item.id, ref: item.ref!, excerpt: string(record(item.raw).excerpt), truncated: record(item.raw).truncated === true, origin: item.origin, liveStatus: item.liveStatus
        })),
        summaries: summaries.slice(0, 12).map(child => ({ id: child.id, title: child.title, summary: child.summary.slice(0, 500) })),
        limited: data.limited || selected.limited,
        totalEvents: selected.totalEvents
      }
    }
    const messageOffset = input.messageOffset ?? 0
    const messages = state.messages[input.nodeId] ?? []
    const messageEnd = Math.max(0, messages.length - messageOffset)
    const visibleMessages = messages.slice(Math.max(0, messageEnd - 20), messageEnd)
    const synthesisImpact = input.includeScientificReview ? await this.synthesisImpact(state, node ? query.project(node, input.synthesisOffset) : null, visibleMessages) : []
    const auditReferences = recordArtifactReferences('raw' in source ? source.raw : undefined)
    // Summary links are resolved through the same authorized retained observation path.
    const linkedSourceIds = [...new Set(synthesisImpact.flatMap(item => item.sourceIds))]
    const referenceSources = linkedSourceIds.slice(0, 8)
    auditReferences.limited ||= linkedSourceIds.length > referenceSources.length
    const referenceCache = new Map<string, DomainAgentThreadDetail>(), referenceAuthorization = new Map<string, boolean>()
    for (const id of referenceSources) {
      const linked = state.nodes[id]
      if (!linked?.source) continue
      const observation = await this.retainedSource(linked, referenceCache, referenceAuthorization)
      const found = recordArtifactReferences(observation.raw)
      auditReferences.limited ||= found.limited
      for (const ref of found.refs) if (!auditReferences.refs.some(item => item.artifactId === ref.artifactId && item.versionId === ref.versionId && item.contentDigest === ref.contentDigest)) {
        if (auditReferences.refs.length < 8) auditReferences.refs.push(ref)
        else auditReferences.limited = true
      }
    }
    // Native source IO may yield while ingestion or a human edit advances the
    // owner. Never label an older selection as the new revision.
    if (state.revision !== revision || this.states.get(state.workspaceRoot) !== state) throw new Error('记录已更新，请重新读取。')
    const counted = (child: ResearchRecordNode, offset = 0) => query.project(child, offset)
    const sourceRetention = this.sourceStore().coverage(query.sourceRefs)
    const sourceExport: ResearchRecordView['sourceExport'] = input.includeSourceExport ? {
      version: 'research-source-export-v1', ref: node?.source ?? null,
      ...('raw' in source && 'rawOrigin' in source && source.rawOrigin === 'retained' ? { raw: source.raw } : {}),
      complete: 'rawOrigin' in source && source.rawOrigin === 'retained',
      reasons: 'rawOrigin' in source && source.rawOrigin === 'retained' ? [] : ['selected-source-not-retained-or-not-authorized'],
      strategy: 'page-authorized-record-nodes; export-one-retained-source-per-view; preserve-ref-and-digest; never-delete-originals'
    } : undefined
    return { sourceRetention, ...(sourceExport ? { sourceExport } : {}), revision: state.revision, node: node ? counted(node, input.synthesisOffset) : null,
      ancestors: path.slice(0, -1).map(child => counted(child)), children: children.map(child => counted(child)), totalChildren: selection.nodes.length,
      page: { nextCursor: nextOffset === null ? null : position.cursor(nextOffset), nextOffset, total: selection.nodes.length,
        scanned: selection.scanned, indexBuildNodes: built, indexRevision: state.revision },
      locations: children.map(child => ({ nodeId: child.id, ancestorIds: query.index.ancestors(child.id).slice(0, -1).map(parent => parent.id) })),
      latestRecordPath: query.index.latestRecordPath(),
      messages: visibleMessages, messageTotal: messages.length,
      synthesisImpact, auditReferences, messageNextOffset: messageEnd > 20 ? messageOffset + 20 : null, ...source, ...(discussionContext ? { discussionContext } : {}), paused: state.paused, model: state.model,
      pending: query.pendingOrganization.get('root') ?? 0, failures: state.failures.slice(-20),
      organizationCoverage: query.organizationCoverage(input.nodeId),
      auditCoverage: { kind: 'visible-session-snapshots', completeness: 'unknown', contextBoundaries: query.boundaryCount(input.nodeId),
        hiddenReasoning: 'not-recorded', historicalSourceAvailability: 'unknown' },
      coverage: 'visible-session-snapshots', lastScanAt: state.lastScanAt }
  }

  private async synthesisImpact(state: State, node: ResearchRecordNode | null, messages: ResearchRecordView['messages']): Promise<NonNullable<ResearchRecordView['synthesisImpact']>> {
    if (!node) return []
    const subjects = (node.synthesis?.entries ?? []).map(entry => ({ id: entry.id, title: entry.text.slice(0, 300), sourceIds: union(entry.sourceIds, entry.resolution?.sourceIds ?? []) }))
    if (node.summary && (node.origin === 'human' || node.locks?.summary)) subjects.push({ id: node.id, title: node.title, sourceIds: [] })
    for (const message of messages) subjects.push({ id: message.id, title: message.text.slice(0, 300), sourceIds: message.sourceIds })
    for (const entry of state.history.filter(item => item.nodeId === node.id && item.kind.startsWith('human-')).slice(-4)) subjects.push({ id: `revision:${entry.at}`, title: `${entry.kind} · ${entry.at}`, sourceIds: historySources(object(entry.value)) })
    const cache = new Map<string, DomainAgentThreadDetail>(), authorization = new Map<string, boolean>()
    const statuses = new Map<string, 'current' | 'changed' | 'unavailable'>()
    for (const id of [...new Set(subjects.flatMap(item => item.sourceIds))].slice(0, 48)) {
      const source = state.nodes[id]
      if (source?.source) { const observation = await this.retainedSource(source, cache, authorization); if (observation.retainedSource !== 'denied') statuses.set(id, observation.sourceStatus) }
    }
    return subjects.map(item => ({ id: item.id, title: item.title, status: item.sourceIds.some(id => statuses.get(id) === 'changed' || statuses.get(id) === 'unavailable') ? 'requires-review' : !item.sourceIds.length || item.sourceIds.some(id => !statuses.has(id)) ? 'unknown' : 'no-recorded-impact', sourceIds: item.sourceIds.slice(0, 48) }))
  }

  private receipt(state: State, requestId: string, input: unknown): unknown {
    const receipt = state.receipts[requestId]
    if (!receipt) return undefined
    if (receipt.digest !== hash(input)) throw new Error('同一请求标识不可用于不同内容。')
    return receipt.output
  }

  private workerStatus(state: State): ResearchRecordReview['worker'] {
    if (state.paused) return 'paused'
    if (this.working) return 'working'
    if (this.foregroundTurns.size || this.foregroundSnapshots.size) return 'foreground'
    if (Date.now() < Math.max(this.nextModelAt, this.foregroundQuietUntil)) return 'cooldown'
    return 'idle'
  }

  async review(raw: z.input<typeof researchRecordReviewInputSchema>): Promise<ResearchRecordReview> {
    const input = researchRecordReviewInputSchema.parse(raw)
    const { state } = await this.authorized(input)
    return reviewResearchRecord(state, input, this.workerStatus(state))
  }

  async audit(raw: z.input<typeof researchRecordAuditInputSchema>): Promise<ResearchRecordAudit> {
    const input = researchRecordAuditInputSchema.parse(raw)
    const { state } = await this.authorized(input)
    const entry = state.history[input.sequence - 1]
    if (!entry) throw new Error('修订记录不存在。')
    const value = object(entry.value), origin = historyOrigin(entry.kind)
    const previous = object(value.previous ?? (entry.kind.startsWith('human-') ? value : null)), after = object(value.after)
    const changes = ['title', 'summary', 'parentId', 'locks', 'paused', 'model'].filter(field => field in previous || field in after)
      .filter(field => JSON.stringify(previous[field]) !== JSON.stringify(after[field]))
      .map(field => ({ field, before: previous[field] ?? null, after: after[field] ?? null }))
    const sourceIds = historySources(value), cache = new Map<string, DomainAgentThreadDetail>(), authorization = new Map<string, boolean>()
    const sources: ResearchRecordAudit['sources'] = []
    for (const id of sourceIds.slice(0, 48)) {
      const node = state.nodes[id]
      if (node?.source) { const observed = await this.retainedSource(node, cache, authorization); sources.push({ id, ref: node.source, status: observed.sourceStatus, retainedSource: observed.retainedSource, rawOrigin: observed.rawOrigin, ...(observed.raw ? { excerpt: this.sanitize(JSON.stringify(observed.raw)).slice(0, 3000) } : {}) }) }
    }
    const rawExecution = object(value.execution)
    const execution = typeof rawExecution.threadId === 'string' && typeof rawExecution.turnId === 'string' && typeof rawExecution.runtimeId === 'string'
      ? { runtimeId: rawExecution.runtimeId, threadId: rawExecution.threadId, turnId: rawExecution.turnId, requestedModel: string(rawExecution.model) } : null
    const parsedRecipe = researchRecordAuditOutputSchema.shape.recipe.safeParse(value.recipe ?? null)
    const recipe = parsedRecipe.success ? parsedRecipe.data : null
    let modelInput: string | null = null, modelOutput: string | null = null
    let inputStatus: ResearchRecordAudit['inputStatus'] = origin !== 'model' ? 'not-applicable' : !recipe ? 'not-recorded' : 'unavailable'
    let outputStatus: ResearchRecordAudit['outputStatus'] = inputStatus
    if (execution && recipe) {
      try {
        const detail = await this.requireContext().agentThreads.read(execution)
        if (detail.runtimeId !== execution.runtimeId || detail.id !== execution.threadId || !detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, state.workspaceRoot)) throw new Error('整理会话范围不一致。')
        const turn = detail.turns.find(turn => turn.id === execution.turnId)
        const prompt = turn?.messages.filter(message => message.kind === 'user-message').map(message => message.text).join('\n') ?? ''
        const start = prompt.indexOf('<research-record-data>\n'), end = prompt.lastIndexOf('\n</research-record-data>')
        if (start >= 0 && end > start) {
          const content = prompt.slice(start + '<research-record-data>\n'.length, end)
          inputStatus = researchRecordTextDigest(content) === recipe.inputDigest ? 'matched' : 'changed'
          if (content.length <= 60000) modelInput = content
        }
        const content = turn?.messages.filter(message => message.kind === 'assistant-final').map(message => message.text).join('\n')
        if (content) {
          outputStatus = researchRecordTextDigest(content) === recipe.outputDigest ? 'matched' : 'changed'
          if (content.length <= 40000) modelOutput = content
        }
      } catch { /* The receipt remains readable even when its native Session is unavailable. */ }
    }
    return { sourceRetention: this.sourceStore().coverage(sources.map(source => source.ref)), sequence: input.sequence, at: entry.at, nodeId: entry.nodeId, kind: entry.kind, origin, changes, sources,
      sourcesLimited: sources.length < sourceIds.length,
      ...(entry.kind === 'context-boundary' ? { contextBoundary: researchRecordContextBoundarySchema.parse(value) } : {}), execution, recipe, input: modelInput, output: modelOutput, inputStatus, outputStatus }
  }

  async edit(raw: ResearchRecordEdit): Promise<{ revision: number }> {
    const input = researchRecordEditInputSchema.parse(raw)
    const { state } = await this.authorized(input)
    const historyStart = state.history.length
    const replay = this.receipt(state, input.requestId, input)
    if (replay) return replay as { revision: number }
    if (input.expectedRevision !== state.revision) throw new Error('记录已更新，请刷新后重试。')
    const change = input.change
    if (change.kind === 'phase' || change.kind === 'move') {
      if (change.parentId !== 'root' && state.nodes[change.parentId]?.kind !== 'phase') throw new Error('长阶段只能归入课题根或另一阶段。')
      const nodeId = change.kind === 'phase' ? change.nodeId ?? key(input.requestId) : change.nodeId
      const previous = state.nodes[nodeId]
      if (change.kind === 'move' && (!previous || !['round', 'phase'].includes(previous.kind))) throw new Error('只能移动阶段或轮次。')
      if (change.kind === 'phase' && previous && previous.kind !== 'phase') throw new Error('节点不是阶段。')
      if (this.ancestors(state, change.parentId).some(parent => parent.id === nodeId)) throw new Error('不能将阶段移入其后代。')
      const node = previous ?? this.node(nodeId, change.parentId, 'phase', '', 'human')
      const affected = previous ? this.descendants(state, nodeId).filter(child => child.kind === 'round').map(child => ({ id: child.id, path: this.ancestors(state, child.id) })) : []
      state.history.push({ at: time(), nodeId, kind: 'human-edit', value: { previous: recordFields(previous), pathBefore: nodePath(state, nodeId) } })
      node.parentId = change.parentId; node.locks = { ...unlocked(), ...node.locks, placement: true }; node.updatedAt = time()
      if (change.kind === 'phase') { node.title = change.title; node.summary = change.summary; node.origin = 'human'; node.locks.title = true; node.locks.summary = Boolean(change.summary.trim()) }
      state.nodes[nodeId] = node
      for (const round of affected) this.dirtyPhases(state, round.id, round.path)
    } else if (change.kind === 'fields') {
      const node = state.nodes[change.nodeId]
      if (!node || !['round', 'phase'].includes(node.kind)) throw new Error('只能编辑阶段或轮次的字段。')
      state.history.push({ at: time(), nodeId: node.id, kind: 'human-fields', value: { previous: recordFields(node), pathBefore: nodePath(state, node.id) } })
      node.locks = { ...unlocked(), ...node.locks }
      if (change.title !== undefined) { node.title = change.title; node.locks.title = true }
      if (change.summary !== undefined) { node.summary = change.summary; node.locks.summary = true }
      Object.assign(node.locks, change.locks)
      node.updatedAt = time()
      for (const round of this.descendants(state, node.id).filter(child => child.kind === 'round')) this.dirtyPhases(state, round.id)
    } else if (change.kind === 'settings') {
      state.history.push({ at: time(), nodeId: 'root', kind: 'human-settings', value: { previous: { paused: state.paused, model: state.model }, after: { paused: change.paused, model: change.model } } })
      state.paused = change.paused; state.model = change.model
    } else {
      state.history.push({ at: time(), nodeId: 'root', kind: 'human-retry', value: {} })
      for (const job of Object.values(state.jobs)) {
        job.processedIds = job.processedIds.filter(id => job.assignedIds.includes(id))
        job.unavailableIds = job.unavailableIds.filter(id => job.assignedIds.includes(id) && !job.semanticPendingIds.includes(id))
        job.changedIds = job.changedIds.filter(id => job.assignedIds.includes(id) && !job.semanticPendingIds.includes(id))
        job.attempts = 0; job.nextAt = 0
      }
      for (const job of Object.values(state.phaseJobs)) { job.attempts = 0; job.nextAt = 0 }
    }
    for (const item of state.history.slice(historyStart)) {
      const value = object(item.value)
      item.value = { ...value, revision: state.revision + 1, pathAfter: nodePath(state, item.nodeId),
        ...(item.nodeId !== 'root' ? { after: recordFields(state.nodes[item.nodeId]) } : {}) }
    }
    const output = { revision: state.revision + 1 }
    state.receipts[input.requestId] = { digest: hash(input), output }
    this.save(state); this.kickWorker()
    return output
  }

  private async contextFor(state: State, nodes: ResearchRecordNode[], historical = false) {
    const cache = new Map<string, DomainAgentThreadDetail>()
    let length = 0
    const authorization = new Map<string, boolean>()
    const evidence: { id: string; ref: ResearchRecordNode['source']; raw: unknown; origin?: 'retained' | 'live'; liveStatus?: 'current' | 'changed' | 'unavailable' }[] = []
    const unavailableIds: string[] = [], changedIds: string[] = [], fullExcerptIds: string[] = [], truncatedIds: string[] = []
    const events = nodes.filter(node => node.source)
    for (const node of events.slice(0, 48)) {
      const source = historical ? await this.retainedSource(node, cache, authorization) : await this.source(node, cache)
      if (historical ? !source.raw : source.sourceStatus !== 'current') {
        ;(source.sourceStatus === 'changed' ? changedIds : unavailableIds).push(node.id)
        continue
      }
      const text = this.sanitize(JSON.stringify(source.raw))
      const excerpt = text.slice(0, 3000)
      const item = { id: node.id, ref: node.source, raw: { excerpt, truncated: text.length > excerpt.length }, ...(historical ? { origin: 'rawOrigin' in source ? source.rawOrigin : undefined, liveStatus: source.sourceStatus } : {}) }
      // Count the actual serialized envelope: escaped tool output can be much
      // larger than its visible excerpt. Remaining sources stay pending.
      const size = JSON.stringify(item).length
      if (length + size > 12000) break
      evidence.push(item)
      ;(text.length > excerpt.length ? truncatedIds : fullExcerptIds).push(node.id)
      length += size
    }
    return { evidence, unavailableIds, changedIds, fullExcerptIds, truncatedIds,
      limited: evidence.length < events.length || truncatedIds.length > 0, workspace: state.workspaceRoot }
  }

  private kickWorker(): void {
    if (this.working || this.closed || !this.enabled || this.foregroundTurns.size || this.foregroundSnapshots.size || Date.now() < Math.max(this.nextModelAt, this.foregroundQuietUntil)) return
    const states = [...this.states.values()]
    const previous = states.findIndex(state => state.workspaceRoot === this.lastWorkspace)
    const rotated = [...states.slice(previous + 1), ...states.slice(0, previous + 1)]
    for (const state of rotated) {
      if (state.paused) continue
      const entry = Object.entries(state.jobs)
        .filter(([, job]) => remainingSources(job).length > 0 && job.attempts < 3 && job.nextAt <= Date.now())
        .sort(([left], [right]) => state.nodes[right].updatedAt.localeCompare(state.nodes[left].updatedAt))[0]
      // Drain eligible round updates before summarizing a partial phase batch.
      // Backoff/blocked rounds do not prevent synthesis of already-ready work.
      const phaseEntry = entry ? undefined : Object.entries(state.phaseJobs)
        .filter(([id, job]) => job.dirtyRoundIds.length && job.attempts < 3 && job.nextAt <= Date.now() && job.dirtyRoundIds.some(roundId => this.phaseRoundReady(state, state.nodes[id], roundId)))
        .sort(([, left], [, right]) => left.nextAt - right.nextAt)[0]
      if (!entry && !phaseEntry) continue
      this.nextModelAt = Date.now() + 15000
      this.lastWorkspace = state.workspaceRoot
      this.working = (entry ? this.organize(state, entry[0], structuredClone(entry[1])) : this.synthesizePhase(state, phaseEntry![0]))
        .catch(() => this.context?.log({ level: 'warn', message: 'Research record organization could not persist; no canonical source was changed.' }))
        .finally(() => { this.working = undefined })
      return
    }
  }

  private async organize(state: State, roundId: string, job: OrganizationJob): Promise<void> {
    const signal = this.controller.signal
    let attempted: Awaited<ReturnType<typeof reasonAboutResearchRecord>> | undefined
    let attemptedSources: string[] = []
    try {
      const context = this.requireContext()
      const nodes = remainingSources(job).map(id => state.nodes[id]).filter(Boolean)
      const data = await this.contextFor(state, nodes)
      const current = state.jobs[roundId]
      current.unavailableIds = union(current.unavailableIds, data.unavailableIds)
      current.changedIds = union(current.changedIds, data.changedIds)
      if (!data.evidence.length) { this.save(state); return }
      const round = state.nodes[roundId]
      const existing = synthesisContext(round, 6000)
      const baseRevision = round.synthesis?.revision ?? 0
      const previousPath = this.ancestors(state, roundId)
      const phases = Object.values(state.nodes).filter(n => n.kind === 'phase')
      const existingPhases: string[][] = []
      for (const phase of phases.slice(-20)) {
        const path = this.ancestors(state, phase.id).map(n => n.title).slice(0, 16)
        if (JSON.stringify([...existingPhases, path]).length <= 2000) existingPhases.push(path)
      }
      attemptedSources = data.evidence.map(item => item.id)
      const openIds = existing.entries.filter(entry => entry.kind === 'open' && entry.status === 'active').map(entry => entry.id)
      const response = attempted = await reasonAboutResearchRecord(context, {
        runtimeId: state.nodes[roundId].scope!.runtimeId, sourceThreadId: state.nodes[roundId].scope!.threadId,
        workspaceRoot: state.workspaceRoot, outputSchema: domainMainAgentExecutionOutputSchemaSchema.parse(researchRecordGenerationSchema(false, attemptedSources, openIds)),
        instruction: '增量整理本轮新来源。沿用 existingPhases 合适路径，无法判断时 phasePath=[]。现有轮次和条目是累计状态，不能用本批局部结果重写或删除。只输出 JSON：{phasePath:string[],title:string,steps:[{title,summary,sourceIds}],statePatch:[{op:"add",kind:"goal"|"progress"|"negative"|"open",text,sourceIds}|{op:"resolve",entryId,note,sourceIds}]}。步骤 sourceIds 必须来自 evidence.id 且每个最多分配一次；省略将保留未归类。statePatch只能引用本批evidence.id；resolve只能针对existingRound.synthesis公开的active open条目并给出新证据。保留失败、取消、负例与未决，不推断未记录的Skill/Plugin。',
        data: { evidence: data.evidence.map(item => ({ id: item.id, raw: item.raw })), limited: data.limited, resolvableEntryIds: openIds,
          existingRound: { id: round.id, title: round.title, summary: round.synthesis ? '' : round.summary.slice(0, 1000), summaryLimited: !round.synthesis && round.summary.length > 1000, synthesis: existing },
          existingPhases, existingPhasesLimited: existingPhases.length < phases.length, status: round.status },
        model: state.model, signal
      })
      const result = researchRecordCompactClassificationSchema.parse(JSON.parse(response.text))
      const allowed = new Set(data.evidence.map(item => item.id)), assigned = new Set<string>()
      for (const step of result.steps) for (const id of step.sourceIds) {
        if (!allowed.has(id) || assigned.has(id)) throw new Error('整理结果包含无效或重复来源。')
        assigned.add(id)
      }
      if (signal.aborted || this.closed || !this.enabled || state.paused || this.states.get(state.workspaceRoot) !== state) return
      if ((round.synthesis?.revision ?? 0) !== baseRevision || data.evidence.some(item => !state.jobs[roundId].sourceIds.includes(item.id) || state.jobs[roundId].processedIds.includes(item.id) && !state.jobs[roundId].semanticPendingIds.includes(item.id))) throw new Error('本批累计状态或当前来源已变化，保留来源等待重试。')
      const sourceChecks: { sourceStatus: 'current' | 'changed' | 'unavailable' }[] = []
      const sourceCache = new Map<string, DomainAgentThreadDetail>()
      for (const item of data.evidence) sourceChecks.push(await this.source(state.nodes[item.id], sourceCache))
      const latestJob = state.jobs[roundId]
      latestJob.changedIds = union(latestJob.changedIds, data.evidence.filter((_, index) => sourceChecks[index].sourceStatus === 'changed').map(item => item.id))
      latestJob.unavailableIds = union(latestJob.unavailableIds, data.evidence.filter((_, index) => sourceChecks[index].sourceStatus === 'unavailable').map(item => item.id))
      if (sourceChecks.some(source => source.sourceStatus !== 'current')) throw new Error('本批来源已变化或不可读，未提交整理结果。')
      // Validate against a clone before placement or steps are changed.
      const patched = structuredClone(round)
      applyStatePatch(patched, result.statePatch, allowed, new Set(existing.entries.map(entry => entry.id)), text => this.sanitize(text))
      const history = { at: time(), nodeId: roundId, kind: 'model-organization', value: { revision: state.revision + 1, execution: response.execution, recipe: response.recipe,
        previous: patchPredecessor(round, result.statePatch), pathBefore: nodePath(state, roundId), after: recordFields(round), pathAfter: [] as string[], result, fingerprint: job.fingerprint, sourceIds: data.evidence.map(item => item.id), limited: data.limited } }
      if (!round.locks?.placement) {
        let parentId = 'root'
        for (const title of result.phasePath) {
          const existing = Object.values(state.nodes).find(node => node.kind === 'phase' && node.parentId === parentId && node.title === title)
          const id = existing?.id ?? key(parentId, title)
          state.nodes[id] ??= this.node(id, parentId, 'phase', title, 'model')
          parentId = id
        }
        round.parentId = parentId
      }
      if (!round.locks?.title) round.title = this.sanitize(result.title)
      round.synthesis = patched.synthesis
      if (!round.locks?.summary) round.summary = patched.summary
      round.origin = 'model'
      // Append immutable batches. Earlier step IDs (including discussions/links) survive.
      for (const [index, step] of result.steps.entries()) {
        const newSourceIds = step.sourceIds.filter(id => !state.jobs[roundId].assignedIds.includes(id))
        if (!newSourceIds.length) continue
        const stepId = key(roundId, 'step', hash(data.evidence.map(item => item.id)), String(index))
        const node = this.node(stepId, roundId, 'step', this.sanitize(step.title), 'model')
        node.summary = this.sanitize(step.summary); state.nodes[stepId] = node
        for (const sourceId of newSourceIds) {
          const event = state.nodes[sourceId]
          const oldGroup = state.nodes[event.parentId]
          const groupId = key(stepId, oldGroup?.title ?? '行为')
          state.nodes[groupId] ??= this.node(groupId, stepId, 'capability', oldGroup?.title ?? '行为', 'system')
          event.parentId = groupId
        }
      }
      // Empty group cleanup is purely derived and cannot remove a source observation.
      const parents = new Set(Object.values(state.nodes).map(node => node.parentId))
      for (const node of Object.values(state.nodes)) if (node.kind === 'capability' && !parents.has(node.id)) delete state.nodes[node.id]
      const pendingId = key(roundId, 'unclassified')
      if (!Object.values(state.nodes).some(node => node.parentId === pendingId) && !state.messages[pendingId]?.length) delete state.nodes[pendingId]
      round.updatedAt = time()
      history.value.after = recordFields(round); history.value.pathAfter = nodePath(state, roundId)
      state.history.push(history)
      const latest = state.jobs[roundId]
      latest.processedIds = union(latest.processedIds, data.evidence.map(item => item.id))
      latest.assignedIds = union(latest.assignedIds, [...assigned])
      latest.fullExcerptIds = union(latest.fullExcerptIds, data.fullExcerptIds)
      latest.truncatedIds = union(latest.truncatedIds, data.truncatedIds)
      latest.semanticPendingIds = latest.semanticPendingIds.filter(id => !allowed.has(id))
      latest.attempts = 0; latest.nextAt = 0
      this.dirtyPhases(state, roundId, previousPath)
      this.save(state)
    } catch (error) {
      if (signal.aborted || this.closed || this.states.get(state.workspaceRoot) !== state) return
      const current = state.jobs[roundId]
      current.attempts++; current.nextAt = Date.now() + 60000 * current.attempts
      this.rejectedModelReceipt(state, roundId, attempted, attemptedSources, error)
      state.failures.push({ nodeId: roundId, message: this.sanitize(error instanceof Error ? error.message : '整理失败。').slice(0, 1000), at: time() })
      this.save(state)
    }
  }

  private rejectedModelReceipt(state: State, nodeId: string, response: Awaited<ReturnType<typeof reasonAboutResearchRecord>> | undefined, sourceIds: string[], error: unknown): void {
    if (!response) return
    state.history.push({ at: time(), nodeId, kind: 'model-rejected', value: {
      revision: state.revision + 1, execution: response.execution, recipe: response.recipe, sourceIds,
      pathBefore: nodePath(state, nodeId), pathAfter: nodePath(state, nodeId),
      rejection: this.sanitize(error instanceof Error ? error.message : '整理结果未采纳。').slice(0, 1000)
    } })
  }

  private async synthesizePhase(state: State, phaseId: string): Promise<void> {
    const signal = this.controller.signal
    let attempted: Awaited<ReturnType<typeof reasonAboutResearchRecord>> | undefined
    const phase = state.nodes[phaseId], job = state.phaseJobs[phaseId]
    const existing = synthesisContext(phase, 6000)
    const rounds = job.dirtyRoundIds.filter(id => this.phaseRoundReady(state, phase, id)).map(id => state.nodes[id]).slice(0, 12)
    const changedRounds: { id: string; title: string; summary: string; status: string; revision: number; parentId: string; path: string[]; membership: 'current' | 'removed'; metadataDigest: string;
      entries: NonNullable<ResearchRecordNode['synthesis']>['entries']; legacySummary?: string; limited: boolean }[] = []
    let remaining = 10000
    for (const node of rounds) {
      const path = this.ancestors(state, node.id).map(ancestor => ancestor.id)
      const uncovered = node.synthesis!.entries.filter(entry => phase.synthesis?.coveredEntryDigests?.[entry.id] !== hash(entry))
      const pending = uncovered.length ? uncovered : node.synthesis!.entries.slice(-8)
      const bounded = synthesisContext({ ...node, synthesis: { ...node.synthesis!, entries: pending } }, Math.min(6000, remaining - 1800))
      if (pending.length && !bounded.entries.length) continue
      const snapshot = { id: node.id, title: node.title, summary: node.summary.slice(0, 1000), status: node.status,
        revision: node.synthesis!.revision, parentId: node.parentId, entries: bounded.entries,
        metadataDigest: this.roundMetadata(state, node),
        path, membership: path.includes(phaseId) ? 'current' as const : 'removed' as const,
        legacySummary: bounded.legacySummary?.slice(0, 500), limited: bounded.limited || node.summary.length > 1000 || (bounded.legacySummary?.length ?? 0) > 500 }
      const size = JSON.stringify(snapshot).length
      if (size > remaining) continue
      changedRounds.push(snapshot); remaining -= size
    }
    const allowed = new Set(changedRounds.flatMap(round => round.entries.flatMap(entry => [...entry.sourceIds, ...(entry.resolution?.sourceIds ?? [])])))
    const scope = rounds.find(node => node.scope)?.scope
    if (!scope || !allowed.size) {
      job.attempts = 3
      state.failures.push({ nodeId: phaseId, at: time(), message: '阶段暂无可综合的带来源条目；保留旧摘要，可在补录来源后显式重试。' })
      this.save(state); return
    }
    try {
      const openIds = existing.entries.filter(entry => entry.kind === 'open' && entry.status === 'active').map(entry => entry.id)
      const response = attempted = await reasonAboutResearchRecord(this.requireContext(), {
        runtimeId: scope.runtimeId, sourceThreadId: scope.threadId, workspaceRoot: state.workspaceRoot, purpose: 'phase-synthesis',
        outputSchema: domainMainAgentExecutionOutputSchemaSchema.parse(researchRecordGenerationSchema(true, [...allowed], openIds)),
        instruction: '低频增量综合一个长期阶段。existingPhase是此前累计状态；changedRounds只包含本次受影响轮次及真实来源引用。membership=removed表示迁出，仅作为历史，不得写成当前阶段进展。不得重写其它阶段或删除负例。仅输出{statePatch:[{op:"add",kind:"goal"|"progress"|"negative"|"open",text,sourceIds}|{op:"resolve",entryId,note,sourceIds}]}。所有sourceIds须来自changedRounds.entries及resolution的sourceIds。只可resolve existingPhase.synthesis提供的active open，须保留解决证据。指出负例、边界与未决，不把步骤完成当科学结论成立。',
        data: { existingPhase: { id: phase.id, title: phase.title, summary: phase.synthesis ? '' : phase.summary.slice(0, 1000), summaryLimited: !phase.synthesis && phase.summary.length > 1000, synthesis: existing }, changedRounds,
          resolvableEntryIds: openIds, limited: job.dirtyRoundIds.length > changedRounds.length || changedRounds.some(round => round.limited) || existing.limited },
        model: state.model, signal
      })
      const result = researchRecordPhaseSynthesisSchema.parse(JSON.parse(response.text))
      if (signal.aborted || this.closed || !this.enabled || state.paused || this.states.get(state.workspaceRoot) !== state) return
      if ((phase.synthesis?.revision ?? 0) !== existing.revision || changedRounds.some(round => !this.phaseRoundReady(state, phase, round.id) || state.nodes[round.id].title !== round.title || state.nodes[round.id].summary.slice(0, 1000) !== round.summary || state.nodes[round.id].status !== round.status || hash(this.ancestors(state, round.id).map(node => node.id)) !== hash(round.path) || round.entries.some(entry => hash(state.nodes[round.id]?.synthesis?.entries.find(current => current.id === entry.id)) !== hash(entry)))) throw new Error('阶段已提供的条目、字段或归属发生变化，等待局部更新。')
      const patched = structuredClone(phase)
      applyStatePatch(patched, result.statePatch, allowed, new Set(existing.entries.map(entry => entry.id)), text => this.sanitize(text))
      patched.synthesis!.coveredEntryDigests = { ...phase.synthesis?.coveredEntryDigests,
        ...Object.fromEntries(changedRounds.flatMap(round => round.entries.map(entry => [entry.id, hash(entry)]))) }
      const complete = changedRounds.filter(round => state.nodes[round.id].synthesis!.entries.every(entry => patched.synthesis!.coveredEntryDigests![entry.id] === hash(entry)))
      patched.synthesis!.coveredChildRevisions = { ...phase.synthesis?.coveredChildRevisions, ...Object.fromEntries(complete.map(round => [round.id, state.nodes[round.id].synthesis!.revision])) }
      patched.synthesis!.coveredChildMembership = { ...phase.synthesis?.coveredChildMembership, ...Object.fromEntries(complete.map(round => [round.id, hash(round.path)])) }
      patched.synthesis!.coveredChildMetadata = { ...phase.synthesis?.coveredChildMetadata, ...Object.fromEntries(complete.map(round => [round.id, round.metadataDigest])) }
      const currentSources = new Set(this.descendants(state, phaseId).filter(node => node.source).map(node => node.id))
      for (const entry of patched.synthesis!.entries) {
        const current = entry.sourceIds.filter(id => currentSources.has(id)).length
        entry.membership = current === entry.sourceIds.length ? 'current' : current ? 'mixed' : 'historical'
      }
      projectSynthesisSummary(patched)
      state.history.push({ at: time(), nodeId: phaseId, kind: 'phase-synthesis', value: { revision: state.revision + 1, execution: response.execution, recipe: response.recipe,
        previous: patchPredecessor(phase, result.statePatch), after: recordFields(patched), pathBefore: nodePath(state, phaseId), pathAfter: nodePath(state, phaseId), result,
        coveredChildRevisions: Object.fromEntries(complete.map(round => [round.id, state.nodes[round.id].synthesis!.revision])),
        membership: changedRounds.map(round => ({ id: round.id, path: round.path, membership: round.membership })) } })
      phase.synthesis = patched.synthesis
      if (!phase.locks?.summary) phase.summary = patched.summary
      phase.updatedAt = time()
      job.dirtyRoundIds = job.dirtyRoundIds.filter(id => !complete.some(round => round.id === id && this.roundMetadata(state, state.nodes[id]) === round.metadataDigest && state.jobs[id].sourceIds.every(source => state.jobs[id].assignedIds.includes(source) && !state.jobs[id].semanticPendingIds.includes(source))))
      job.attempts = 0; job.nextAt = job.dirtyRoundIds.length ? Date.now() + 60000 : 0
      this.save(state)
    } catch (error) {
      if (signal.aborted || this.closed || this.states.get(state.workspaceRoot) !== state) return
      job.attempts++; job.nextAt = Date.now() + 60000 * job.attempts
      this.rejectedModelReceipt(state, phaseId, attempted, [...allowed], error)
      state.failures.push({ nodeId: phaseId, message: this.sanitize(error instanceof Error ? error.message : '阶段综合失败。').slice(0, 1000), at: time() })
      this.save(state)
    }
  }

}
