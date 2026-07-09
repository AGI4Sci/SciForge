import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { decideEvidenceStatus } from './evidence-gate.js'
import type {
  EvidenceLevel,
  ExperimentRun,
  ExperimentRunDraft,
  MemoryItem,
  MemoryItemDraft,
  MemoryItemStatus,
  ResearchMemoryServiceOptions
} from './types.js'

type StoreOptions = ResearchMemoryServiceOptions

type DbRow = Record<string, unknown>

export class ResearchMemoryStore {
  readonly workspaceRoot: string
  readonly sqlitePath: string
  private readonly nowIso: () => string
  private readonly idGenerator: (prefix: string) => string
  private db: BetterSqliteDatabase | null = null

  constructor(options: StoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.sqlitePath = options.sqlitePath ?? researchMemoryStoragePath(options.workspaceRoot)
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.idGenerator = options.idGenerator ?? ((prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`)
  }

  initialize(): void {
    if (this.db) return
    mkdirSync(dirname(this.sqlitePath), { recursive: true })
    this.db = new Database(this.sqlitePath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  upsertExperimentRun(draft: ExperimentRunDraft): ExperimentRun {
    const db = this.database()
    const now = this.nowIso()
    const existing = draft.id ? this.getExperimentRun(draft.id) : null
    const run: ExperimentRun = {
      id: draft.id?.trim() || existing?.id || this.idGenerator('run'),
      projectId: draft.projectId?.trim() || this.workspaceRoot,
      title: draft.title.trim(),
      status: draft.status ?? 'completed',
      ...(draft.command ? { command: draft.command } : {}),
      ...(draft.scriptPath ? { scriptPath: draft.scriptPath } : {}),
      ...(draft.datasetVersion ? { datasetVersion: draft.datasetVersion } : {}),
      ...(draft.environment ? { environment: draft.environment } : {}),
      ...(draft.parameters ? { parameters: draft.parameters } : {}),
      ...(draft.seed !== undefined ? { seed: draft.seed } : {}),
      ...(draft.metrics ? { metrics: draft.metrics } : {}),
      ...(draft.logsExcerpt ? { logsExcerpt: draft.logsExcerpt } : {}),
      artifactRefs: uniqueStrings(draft.artifactRefs ?? []),
      ...(draft.threadRef ? { threadRef: draft.threadRef } : {}),
      ...(draft.turnRef ? { turnRef: draft.turnRef } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    db.prepare(`
      INSERT INTO experiment_run (
        id, project_id, title, status, command, script_path, dataset_version, environment_json,
        parameters_json, seed_json, metrics_json, logs_excerpt, artifact_refs_json,
        thread_ref, turn_ref, created_at, updated_at
      ) VALUES (
        @id, @projectId, @title, @status, @command, @scriptPath, @datasetVersion, @environmentJson,
        @parametersJson, @seedJson, @metricsJson, @logsExcerpt, @artifactRefsJson,
        @threadRef, @turnRef, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        status = excluded.status,
        command = excluded.command,
        script_path = excluded.script_path,
        dataset_version = excluded.dataset_version,
        environment_json = excluded.environment_json,
        parameters_json = excluded.parameters_json,
        seed_json = excluded.seed_json,
        metrics_json = excluded.metrics_json,
        logs_excerpt = excluded.logs_excerpt,
        artifact_refs_json = excluded.artifact_refs_json,
        thread_ref = excluded.thread_ref,
        turn_ref = excluded.turn_ref,
        updated_at = excluded.updated_at
    `).run({
      ...run,
      command: run.command ?? null,
      scriptPath: run.scriptPath ?? null,
      datasetVersion: run.datasetVersion ?? null,
      environmentJson: json(run.environment),
      parametersJson: json(run.parameters),
      seedJson: json(run.seed),
      metricsJson: json(run.metrics),
      logsExcerpt: run.logsExcerpt ?? null,
      artifactRefsJson: json(run.artifactRefs),
      threadRef: run.threadRef ?? null,
      turnRef: run.turnRef ?? null
    })
    return run
  }

  getExperimentRun(id: string): ExperimentRun | null {
    const row = this.database().prepare('SELECT * FROM experiment_run WHERE id = ?').get(id) as DbRow | undefined
    return row ? experimentFromRow(row) : null
  }

  listExperimentRuns(projectId: string): ExperimentRun[] {
    const rows = this.database()
      .prepare('SELECT * FROM experiment_run WHERE project_id = ? ORDER BY created_at ASC, id ASC')
      .all(projectId) as DbRow[]
    return rows.map(experimentFromRow)
  }

  createMemoryItem(draft: MemoryItemDraft): MemoryItem {
    const db = this.database()
    const now = this.nowIso()
    const decision = decideEvidenceStatus(draft)
    const item: MemoryItem = {
      id: this.idGenerator('mem'),
      projectId: draft.projectId?.trim() || this.workspaceRoot,
      type: draft.type,
      status: decision.status,
      claim: draft.claim.trim(),
      ...(draft.rationale ? { rationale: draft.rationale } : {}),
      ...(draft.recommendedAction ? { recommendedAction: draft.recommendedAction } : {}),
      ...(draft.applicability ? { applicability: draft.applicability } : {}),
      evidenceRefs: uniqueStrings(draft.evidenceRefs ?? []),
      sourceRunIds: uniqueStrings(draft.sourceRunIds ?? []),
      sourceThreadRefs: uniqueStrings(draft.sourceThreadRefs ?? []),
      confidence: decision.confidence,
      evidenceLevel: decision.evidenceLevel,
      ...(decision.reviewReason ? { reviewReason: decision.reviewReason } : {}),
      ...(draft.metadata ? { metadata: draft.metadata } : {}),
      createdAt: now,
      updatedAt: now
    }
    this.insertMemoryItem(item)
    return item
  }

  getMemoryItem(id: string): MemoryItem | null {
    const row = this.database().prepare('SELECT * FROM memory_item WHERE id = ?').get(id) as DbRow | undefined
    return row ? memoryFromRow(row) : null
  }

  listMemoryItems(projectId: string): MemoryItem[] {
    const rows = this.database()
      .prepare('SELECT * FROM memory_item WHERE project_id = ? ORDER BY created_at ASC, id ASC')
      .all(projectId) as DbRow[]
    return rows.map(memoryFromRow)
  }

  listMemoryProjectIds(): string[] {
    const rows = this.database()
      .prepare('SELECT DISTINCT project_id FROM memory_item ORDER BY project_id ASC')
      .all() as Array<{ project_id?: unknown }>
    return rows
      .map((row) => stringColumn(row.project_id))
      .filter(Boolean)
  }

  reviewMemoryItem(input: {
    memoryId: string
    action: 'approve' | 'reject' | 'invalidate' | 'supersede' | 'mark_hypothesis'
    note?: string
    supersededBy?: string
  }): MemoryItem {
    const db = this.database()
    const current = this.getMemoryItem(input.memoryId)
    if (!current) throw new Error(`Memory item not found: ${input.memoryId}`)
    const now = this.nowIso()
    const reviewId = this.idGenerator('review')
    const nextStatus = statusForReviewAction(input.action)
    const next: MemoryItem = {
      ...current,
      status: nextStatus,
      evidenceLevel: input.action === 'approve' ? 'human_approved' : current.evidenceLevel,
      confidence: input.action === 'approve' ? Math.max(current.confidence, 0.9) : current.confidence,
      reviewReason: input.note ?? current.reviewReason,
      evidenceRefs: input.action === 'approve'
        ? uniqueStrings([...current.evidenceRefs, `human:${reviewId}`])
        : current.evidenceRefs,
      metadata: input.supersededBy
        ? { ...(current.metadata ?? {}), supersededBy: input.supersededBy }
        : current.metadata,
      updatedAt: now
    }
    const tx = db.transaction(() => {
      this.insertMemoryItem(next)
      db.prepare(`
        INSERT INTO memory_review_event (
          id, memory_id, project_id, action, note, superseded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(reviewId, next.id, next.projectId, input.action, input.note ?? null, input.supersededBy ?? null, now)
    })
    tx()
    return next
  }

  createReflectionRun(input: {
    projectId: string
    kind: 'experiments' | 'thread'
    sourceRunIds?: string[]
    sourceThreadRefs?: string[]
    createdMemoryIds: string[]
  }): void {
    this.database().prepare(`
      INSERT INTO reflection_run (
        id, project_id, kind, source_run_ids_json, source_thread_refs_json, created_memory_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.idGenerator('reflection'),
      input.projectId,
      input.kind,
      json(uniqueStrings(input.sourceRunIds ?? [])),
      json(uniqueStrings(input.sourceThreadRefs ?? [])),
      json(uniqueStrings(input.createdMemoryIds)),
      this.nowIso()
    )
  }

  private insertMemoryItem(item: MemoryItem): void {
    const db = this.database()
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO memory_item (
          id, project_id, type, status, claim, rationale, recommended_action,
          applicability_json, evidence_refs_json, source_run_ids_json, source_thread_refs_json,
          confidence, evidence_level, review_reason, metadata_json, created_at, updated_at
        ) VALUES (
          @id, @projectId, @type, @status, @claim, @rationale, @recommendedAction,
          @applicabilityJson, @evidenceRefsJson, @sourceRunIdsJson, @sourceThreadRefsJson,
          @confidence, @evidenceLevel, @reviewReason, @metadataJson, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          status = excluded.status,
          claim = excluded.claim,
          rationale = excluded.rationale,
          recommended_action = excluded.recommended_action,
          applicability_json = excluded.applicability_json,
          evidence_refs_json = excluded.evidence_refs_json,
          source_run_ids_json = excluded.source_run_ids_json,
          source_thread_refs_json = excluded.source_thread_refs_json,
          confidence = excluded.confidence,
          evidence_level = excluded.evidence_level,
          review_reason = excluded.review_reason,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run({
        ...item,
        rationale: item.rationale ?? null,
        recommendedAction: item.recommendedAction ?? null,
        applicabilityJson: json(item.applicability),
        evidenceRefsJson: json(item.evidenceRefs),
        sourceRunIdsJson: json(item.sourceRunIds),
        sourceThreadRefsJson: json(item.sourceThreadRefs),
        reviewReason: item.reviewReason ?? null,
        metadataJson: json(item.metadata)
      })
      db.prepare('DELETE FROM memory_evidence_ref WHERE memory_id = ?').run(item.id)
      for (const ref of item.evidenceRefs) {
        db.prepare(`
          INSERT INTO memory_evidence_ref (memory_id, project_id, evidence_ref, created_at)
          VALUES (?, ?, ?, ?)
        `).run(item.id, item.projectId, ref, item.createdAt)
      }
    })
    tx()
  }

  private database(): BetterSqliteDatabase {
    this.initialize()
    if (!this.db) throw new Error('Research Memory database failed to initialize.')
    return this.db
  }

  private migrate(): void {
    const db = this.database()
    db.exec(`
      CREATE TABLE IF NOT EXISTS experiment_run (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        command TEXT,
        script_path TEXT,
        dataset_version TEXT,
        environment_json TEXT,
        parameters_json TEXT,
        seed_json TEXT,
        metrics_json TEXT,
        logs_excerpt TEXT,
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        thread_ref TEXT,
        turn_ref TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_run_project ON experiment_run(project_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_item (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        claim TEXT NOT NULL,
        rationale TEXT,
        recommended_action TEXT,
        applicability_json TEXT,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        source_run_ids_json TEXT NOT NULL DEFAULT '[]',
        source_thread_refs_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        evidence_level TEXT NOT NULL,
        review_reason TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_item_project_status ON memory_item(project_id, status, type);

      CREATE TABLE IF NOT EXISTS memory_evidence_ref (
        memory_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(memory_id, evidence_ref)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_evidence_ref_project ON memory_evidence_ref(project_id, evidence_ref);

      CREATE TABLE IF NOT EXISTS memory_review_event (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        action TEXT NOT NULL,
        note TEXT,
        superseded_by TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reflection_run (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_run_ids_json TEXT NOT NULL DEFAULT '[]',
        source_thread_refs_json TEXT NOT NULL DEFAULT '[]',
        created_memory_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
    `)
  }
}

export function researchMemoryStoragePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.sciforge', 'research-memory', 'research-memory.sqlite')
}

function experimentFromRow(row: DbRow): ExperimentRun {
  return {
    id: stringColumn(row.id),
    projectId: stringColumn(row.project_id),
    title: stringColumn(row.title),
    status: stringColumn(row.status) as ExperimentRun['status'],
    ...optionalString('command', row.command),
    ...optionalString('scriptPath', row.script_path),
    ...optionalString('datasetVersion', row.dataset_version),
    ...optionalJson('environment', row.environment_json),
    ...optionalJson('parameters', row.parameters_json),
    ...optionalJson('seed', row.seed_json),
    ...optionalJson('metrics', row.metrics_json),
    ...optionalString('logsExcerpt', row.logs_excerpt),
    artifactRefs: jsonArray(row.artifact_refs_json),
    ...optionalString('threadRef', row.thread_ref),
    ...optionalString('turnRef', row.turn_ref),
    createdAt: stringColumn(row.created_at),
    updatedAt: stringColumn(row.updated_at)
  }
}

function memoryFromRow(row: DbRow): MemoryItem {
  return {
    id: stringColumn(row.id),
    projectId: stringColumn(row.project_id),
    type: stringColumn(row.type) as MemoryItem['type'],
    status: stringColumn(row.status) as MemoryItemStatus,
    claim: stringColumn(row.claim),
    ...optionalString('rationale', row.rationale),
    ...optionalString('recommendedAction', row.recommended_action),
    ...optionalJson('applicability', row.applicability_json),
    evidenceRefs: jsonArray(row.evidence_refs_json),
    sourceRunIds: jsonArray(row.source_run_ids_json),
    sourceThreadRefs: jsonArray(row.source_thread_refs_json),
    confidence: Number(row.confidence),
    evidenceLevel: stringColumn(row.evidence_level) as EvidenceLevel,
    ...optionalString('reviewReason', row.review_reason),
    ...optionalJson('metadata', row.metadata_json),
    createdAt: stringColumn(row.created_at),
    updatedAt: stringColumn(row.updated_at)
  }
}

function statusForReviewAction(action: 'approve' | 'reject' | 'invalidate' | 'supersede' | 'mark_hypothesis'): MemoryItemStatus {
  switch (action) {
    case 'approve':
      return 'active'
    case 'reject':
      return 'rejected'
    case 'invalidate':
      return 'invalidated'
    case 'supersede':
      return 'superseded'
    case 'mark_hypothesis':
      return 'hypothesis'
  }
}

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return JSON.parse(value)
}

function jsonArray(value: unknown): string[] {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function optionalJson(key: string, value: unknown): Record<string, unknown> {
  const parsed = parseJson(value)
  return parsed === undefined ? {} : { [key]: parsed }
}

function optionalString(key: string, value: unknown): Record<string, string> {
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {}
}

function stringColumn(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
