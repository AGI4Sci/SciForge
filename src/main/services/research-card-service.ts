import { randomUUID } from 'node:crypto'
import type {
  ResearchCard,
  ResearchCardArchiveInput,
  ResearchCardCreateInput,
  ResearchCardDecision,
  ResearchCardDecisionValue,
  ResearchCardKind,
  ResearchCardListInput,
  ResearchCardOrigin,
  ResearchCardOriginKind,
  ResearchCardPriority,
  ResearchCardRef,
  ResearchCardRefKind,
  ResearchCardStage,
  ResearchCardStatus,
  ResearchCardUpdateInput,
  ResearchCardUpdatePatch
} from '../../shared/research-cards'
import {
  RESEARCH_CARD_SCHEMA_VERSION,
  defaultResearchCardStage,
  isResearchCardStageForKind
} from '../../shared/research-cards'
import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from './app-data-store'
import { canonicalPath } from './workspace-paths'

type StoredResearchCards = {
  schemaVersion: typeof RESEARCH_CARD_SCHEMA_VERSION
  cards: ResearchCard[]
}

const RESEARCH_CARDS_STORE = ['research-cards', 'cards.json'] as const

export class ResearchCardService {
  private loaded: Promise<StoredResearchCards> | null = null

  constructor(private readonly dataDir: string) {}

  async list(input: ResearchCardListInput = {}): Promise<ResearchCard[]> {
    const store = await this.load()
    const workspace = input.workspaceRoot?.trim() ? await safeCanonical(input.workspaceRoot) : ''
    const queryTokens = tokenize(input.query ?? '')
    const wantedTags = normalizeTags(input.tags)
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500))
    return store.cards
      .filter((card) => input.includeArchived === true || card.archived !== true)
      .filter((card) => !workspace || card.workspaceRoot === workspace)
      .filter((card) => !input.kind || card.kind === input.kind)
      .filter((card) => !input.status || card.status === input.status)
      .filter((card) => !input.stage || card.stage === input.stage)
      .filter((card) => !input.threadId?.trim() || card.threadId === input.threadId.trim())
      .filter((card) => wantedTags.length === 0 || wantedTags.every((tag) => card.tags.includes(tag)))
      .filter((card) => queryTokens.length === 0 || matchesQuery(card, queryTokens))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(cloneCard)
  }

  async create(input: ResearchCardCreateInput): Promise<ResearchCard> {
    const store = await this.load()
    const card = await normalizeCreate(input)
    if (store.cards.some((item) => item.id === card.id)) {
      throw new Error(`Research card already exists: ${card.id}`)
    }
    store.cards.unshift(card)
    await this.save(store)
    return cloneCard(card)
  }

  async update(input: ResearchCardUpdateInput): Promise<ResearchCard> {
    const store = await this.load()
    const index = store.cards.findIndex((card) => card.id === input.cardId)
    if (index < 0) throw new Error(`Research card not found: ${input.cardId}`)
    const current = store.cards[index]!
    const next = await applyPatch(current, input.patch)
    store.cards[index] = next
    await this.save(store)
    return cloneCard(next)
  }

  async archive(input: ResearchCardArchiveInput): Promise<ResearchCard> {
    return this.update({
      cardId: input.cardId,
      patch: { archived: input.archived !== false }
    })
  }

  private async load(): Promise<StoredResearchCards> {
    if (!this.loaded) {
      this.loaded = readAppDataStoreText(this.dataDir, RESEARCH_CARDS_STORE)
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown))
        .catch(() => ({ schemaVersion: RESEARCH_CARD_SCHEMA_VERSION, cards: [] }))
    }
    return this.loaded
  }

  private async save(store: StoredResearchCards): Promise<void> {
    await atomicWriteAppDataJson(this.dataDir, RESEARCH_CARDS_STORE, normalizeStore(store))
  }
}

async function normalizeCreate(input: ResearchCardCreateInput): Promise<ResearchCard> {
  const now = new Date().toISOString()
  const kind = input.kind
  const stage = normalizeStage(kind, input.stage ?? defaultResearchCardStage(kind))
  const title = normalizeRequiredString(input.title, 'Research card title is required.', 300)
  const workspaceRoot = await normalizeWorkspace(input.workspaceRoot)
  return {
    schemaVersion: RESEARCH_CARD_SCHEMA_VERSION,
    id: normalizeOptionalString(input.id, 256) || `rc_${Date.now()}_${randomUUID()}`,
    kind,
    title,
    ...optionalStringField('summary', input.summary, 4_000),
    status: input.status ?? 'open',
    stage,
    priority: input.priority ?? 'normal',
    ...optionalStringField('workspaceRoot', workspaceRoot, 4_096),
    ...optionalRuntimeId(input.runtimeId),
    ...optionalStringField('threadId', input.threadId, 256),
    ...optionalStringField('turnId', input.turnId, 256),
    evidenceRefs: normalizeRefs(input.evidenceRefs),
    artifactRefs: normalizeRefs(input.artifactRefs),
    sourceRefs: normalizeRefs(input.sourceRefs),
    relatedCardIds: normalizeIdList(input.relatedCardIds),
    tags: normalizeTags(input.tags),
    ...optionalDecision(input.decision),
    ...optionalStringField('nextAction', input.nextAction, 2_000),
    createdFrom: normalizeOrigin(input.createdFrom),
    ...optionalMetadata(input.metadata),
    createdAt: now,
    updatedAt: now
  }
}

async function applyPatch(current: ResearchCard, patch: ResearchCardUpdatePatch): Promise<ResearchCard> {
  const workspaceRoot = Object.prototype.hasOwnProperty.call(patch, 'workspaceRoot')
    ? patch.workspaceRoot === null
      ? null
      : await normalizeWorkspace(patch.workspaceRoot)
    : undefined
  const stage = patch.stage ? normalizeStage(current.kind, patch.stage) : current.stage
  const title = Object.prototype.hasOwnProperty.call(patch, 'title')
    ? normalizeRequiredString(patch.title ?? '', 'Research card title is required.', 300)
    : current.title
  return {
    ...current,
    title,
    ...nullableStringPatch('summary', current.summary, patch.summary, 4_000),
    status: patch.status ?? current.status,
    stage,
    priority: patch.priority ?? current.priority,
    ...nullableStringPatch('workspaceRoot', current.workspaceRoot, workspaceRoot, 4_096),
    ...nullableRuntimeIdPatch(current.runtimeId, patch.runtimeId),
    ...nullableStringPatch('threadId', current.threadId, patch.threadId, 256),
    ...nullableStringPatch('turnId', current.turnId, patch.turnId, 256),
    evidenceRefs: patch.evidenceRefs ? normalizeRefs(patch.evidenceRefs) : current.evidenceRefs,
    artifactRefs: patch.artifactRefs ? normalizeRefs(patch.artifactRefs) : current.artifactRefs,
    sourceRefs: patch.sourceRefs ? normalizeRefs(patch.sourceRefs) : current.sourceRefs,
    relatedCardIds: patch.relatedCardIds ? normalizeIdList(patch.relatedCardIds) : current.relatedCardIds,
    tags: patch.tags ? normalizeTags(patch.tags) : current.tags,
    ...nullableDecisionPatch(current.decision, patch.decision),
    ...nullableStringPatch('nextAction', current.nextAction, patch.nextAction, 2_000),
    createdFrom: patch.createdFrom ? normalizeOrigin(patch.createdFrom) : current.createdFrom,
    ...nullableMetadataPatch(current.metadata, patch.metadata),
    archived: patch.archived ?? current.archived,
    updatedAt: new Date().toISOString()
  }
}

function normalizeStore(value: unknown): StoredResearchCards {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { cards?: unknown }).cards)) {
    return { schemaVersion: RESEARCH_CARD_SCHEMA_VERSION, cards: [] }
  }
  return {
    schemaVersion: RESEARCH_CARD_SCHEMA_VERSION,
    cards: (value as { cards: unknown[] }).cards
      .map(normalizeCard)
      .filter((card): card is ResearchCard => card != null)
  }
}

function normalizeCard(value: unknown): ResearchCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const kind = stringValue(raw.kind) as ResearchCardKind
  const id = stringValue(raw.id)
  const title = normalizeOptionalString(raw.title, 300)
  if (!id || !title || !isKnownKind(kind)) return null
  const createdAt = normalizeOptionalString(raw.createdAt, 64) || new Date().toISOString()
  const updatedAt = normalizeOptionalString(raw.updatedAt, 64) || createdAt
  const stageCandidate = stringValue(raw.stage) as ResearchCardStage
  const stage = isResearchCardStageForKind(kind, stageCandidate)
    ? stageCandidate
    : defaultResearchCardStage(kind)
  return {
    schemaVersion: RESEARCH_CARD_SCHEMA_VERSION,
    id,
    kind,
    title,
    ...optionalStringField('summary', stringValue(raw.summary), 4_000),
    status: normalizeStatus(raw.status),
    stage,
    priority: normalizePriority(raw.priority),
    ...optionalStringField('workspaceRoot', stringValue(raw.workspaceRoot), 4_096),
    ...optionalRuntimeId(normalizeRuntimeId(raw.runtimeId)),
    ...optionalStringField('threadId', stringValue(raw.threadId), 256),
    ...optionalStringField('turnId', stringValue(raw.turnId), 256),
    evidenceRefs: normalizeRefs(raw.evidenceRefs),
    artifactRefs: normalizeRefs(raw.artifactRefs),
    sourceRefs: normalizeRefs(raw.sourceRefs),
    relatedCardIds: normalizeIdList(raw.relatedCardIds),
    tags: normalizeTags(raw.tags),
    ...optionalDecision(normalizeDecision(raw.decision)),
    ...optionalStringField('nextAction', stringValue(raw.nextAction), 2_000),
    createdFrom: normalizeOrigin(raw.createdFrom),
    ...optionalMetadata(normalizeMetadata(raw.metadata)),
    archived: raw.archived === true,
    createdAt,
    updatedAt
  }
}

function normalizeStage(kind: ResearchCardKind, stage: ResearchCardStage): ResearchCardStage {
  if (!isResearchCardStageForKind(kind, stage)) {
    throw new Error(`Invalid stage "${stage}" for research card kind "${kind}".`)
  }
  return stage
}

function isKnownKind(value: string): value is ResearchCardKind {
  return [
    'source_triage',
    'evidence_item',
    'hypothesis',
    'claim',
    'method_choice',
    'protocol_step',
    'quality_issue',
    'artifact_review',
    'approval_gate',
    'next_action'
  ].includes(value)
}

function normalizeStatus(value: unknown): ResearchCardStatus {
  const text = stringValue(value)
  return (
    text === 'open' ||
    text === 'needs_evidence' ||
    text === 'needs_review' ||
    text === 'approved' ||
    text === 'rejected' ||
    text === 'superseded' ||
    text === 'done'
  ) ? text : 'open'
}

function normalizePriority(value: unknown): ResearchCardPriority {
  const text = stringValue(value)
  return (
    text === 'low' ||
    text === 'normal' ||
    text === 'high' ||
    text === 'critical'
  ) ? text : 'normal'
}

function normalizeRefs(value: unknown): ResearchCardRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeRef)
    .filter((ref): ref is ResearchCardRef => ref != null)
    .slice(0, 200)
}

function normalizeRef(value: unknown): ResearchCardRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const kind = stringValue(raw.kind)
  const id = normalizeOptionalString(raw.id, 512)
  if (!id || !isKnownRefKind(kind)) return null
  return {
    kind,
    id,
    ...optionalStringField('label', stringValue(raw.label), 512),
    ...optionalStringField('uri', stringValue(raw.uri), 2_000),
    ...optionalMetadata(normalizeMetadata(raw.metadata))
  }
}

function isKnownRefKind(value: string): value is ResearchCardRefKind {
  return (
    value === 'paper' ||
    value === 'dataset' ||
    value === 'file' ||
    value === 'evidence' ||
    value === 'artifact' ||
    value === 'card' ||
    value === 'thread' ||
    value === 'turn' ||
    value === 'workflow' ||
    value === 'url' ||
    value === 'other'
  )
}

function normalizeOrigin(value: unknown): ResearchCardOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'manual' }
  }
  const raw = value as Record<string, unknown>
  const kind = stringValue(raw.kind)
  return {
    kind: isKnownOrigin(kind) ? kind : 'manual',
    ...optionalStringField('id', stringValue(raw.id), 512),
    ...optionalStringField('label', stringValue(raw.label), 512)
  }
}

function isKnownOrigin(value: string): value is ResearchCardOriginKind {
  return (
    value === 'manual' ||
    value === 'chat' ||
    value === 'paper_radar' ||
    value === 'workflow' ||
    value === 'canvas' ||
    value === 'ppt_master' ||
    value === 'write_assist' ||
    value === 'scientific_plotting' ||
    value === 'evidence_dag' ||
    value === 'model_router' ||
    value === 'other'
  )
}

function normalizeDecision(value: unknown): ResearchCardDecision | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const decision = stringValue(raw.value)
  if (!isKnownDecision(decision)) return undefined
  return {
    value: decision,
    ...optionalStringField('reason', stringValue(raw.reason), 2_000),
    ...optionalStringField('decidedBy', stringValue(raw.decidedBy), 256),
    decidedAt: normalizeOptionalString(raw.decidedAt, 64) || new Date().toISOString()
  }
}

function isKnownDecision(value: string): value is ResearchCardDecisionValue {
  return (
    value === 'accept' ||
    value === 'defer' ||
    value === 'reject' ||
    value === 'revise' ||
    value === 'approve' ||
    value === 'request_changes' ||
    value === 'route' ||
    value === 'drop' ||
    value === 'complete'
  )
}

function optionalDecision(value: ResearchCardDecision | undefined): { decision?: ResearchCardDecision } {
  return value ? { decision: { ...value } } : {}
}

function nullableDecisionPatch(
  current: ResearchCardDecision | undefined,
  value: ResearchCardUpdatePatch['decision']
): { decision?: ResearchCardDecision } {
  if (value === undefined) return current ? { decision: current } : {}
  if (value === null) return { decision: undefined }
  return optionalDecision(value)
}

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return { ...(value as Record<string, unknown>) }
}

function normalizeRuntimeId(value: unknown): ResearchCard['runtimeId'] | undefined {
  const text = stringValue(value)
  return text === 'sciforge' || text === 'codex' || text === 'claude' ? text : undefined
}

function optionalRuntimeId(value: ResearchCard['runtimeId'] | undefined): { runtimeId?: ResearchCard['runtimeId'] } {
  return value ? { runtimeId: value } : {}
}

function nullableRuntimeIdPatch(
  current: ResearchCard['runtimeId'] | undefined,
  value: ResearchCardUpdatePatch['runtimeId']
): { runtimeId?: ResearchCard['runtimeId'] } {
  if (value === undefined) return current ? { runtimeId: current } : {}
  if (value === null) return { runtimeId: undefined }
  return optionalRuntimeId(value)
}

function optionalMetadata(value: Record<string, unknown> | undefined): { metadata?: Record<string, unknown> } {
  return value ? { metadata: { ...value } } : {}
}

function nullableMetadataPatch(
  current: Record<string, unknown> | undefined,
  value: ResearchCardUpdatePatch['metadata']
): { metadata?: Record<string, unknown> } {
  if (value === undefined) return current ? { metadata: { ...current } } : {}
  if (value === null) return { metadata: undefined }
  return optionalMetadata(value)
}

async function normalizeWorkspace(value: string | undefined): Promise<string | undefined> {
  const text = normalizeOptionalString(value, 4_096)
  return text ? safeCanonical(text) : undefined
}

async function safeCanonical(path: string): Promise<string> {
  return canonicalPath(path)
}

function normalizeRequiredString(value: unknown, message: string, max: number): string {
  const text = normalizeOptionalString(value, max)
  if (!text) throw new Error(message)
  return text
}

function normalizeOptionalString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalStringField<K extends string>(
  key: K,
  value: unknown,
  max: number
): { [P in K]?: string } {
  const text = normalizeOptionalString(value, max)
  return text ? { [key]: text } as { [P in K]?: string } : {}
}

function nullableStringPatch<K extends string>(
  key: K,
  current: string | undefined,
  value: string | null | undefined,
  max: number
): { [P in K]?: string } {
  if (value === undefined) return current ? { [key]: current } as { [P in K]?: string } : {}
  if (value === null) return { [key]: undefined } as { [P in K]?: string }
  return optionalStringField(key, value, max)
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, 500)
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 100)
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const cjk = [...normalized.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)]
    .map((match) => match[0])
  return [...new Set([...words, ...cjk])].filter(Boolean).slice(0, 80)
}

function matchesQuery(card: ResearchCard, tokens: string[]): boolean {
  const refs = [...card.evidenceRefs, ...card.artifactRefs, ...card.sourceRefs]
    .map((ref) => `${ref.kind} ${ref.id} ${ref.label ?? ''} ${ref.uri ?? ''}`)
    .join(' ')
  const haystack = [
    card.title,
    card.summary ?? '',
    card.kind,
    card.status,
    card.stage,
    card.priority,
    card.nextAction ?? '',
    card.tags.join(' '),
    refs
  ].join(' ').toLowerCase()
  return tokens.some((token) => haystack.includes(token))
}

function cloneCard(card: ResearchCard): ResearchCard {
  return {
    ...card,
    evidenceRefs: card.evidenceRefs.map(cloneRef),
    artifactRefs: card.artifactRefs.map(cloneRef),
    sourceRefs: card.sourceRefs.map(cloneRef),
    relatedCardIds: [...card.relatedCardIds],
    tags: [...card.tags],
    ...(card.decision ? { decision: { ...card.decision } } : {}),
    createdFrom: { ...card.createdFrom },
    ...(card.metadata ? { metadata: { ...card.metadata } } : {})
  }
}

function cloneRef(ref: ResearchCardRef): ResearchCardRef {
  return {
    ...ref,
    ...(ref.metadata ? { metadata: { ...ref.metadata } } : {})
  }
}
