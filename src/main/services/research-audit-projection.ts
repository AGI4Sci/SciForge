import { z } from 'zod'
import {
  RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS,
  researchAuditEvidenceAuditQueryOutputSchema,
  researchAuditFreshnessSchema,
  researchAuditProjectReadRecordsResultSchema,
  researchAuditSessionChangeListChangesOutputSchema,
  researchAuditSubjectSchema,
  type ResearchAuditEvidenceSidechainRecordV1,
  type ResearchAuditProjectRelease,
  type ResearchAuditSessionChangeSummary,
  type ResearchAuditSubject
} from '@sciforge/domain-sdk/research-audit'
import type { CapabilityBroker } from '../capabilities/broker'
import { capabilityJsonValueSchema } from '../../shared/capability-broker'

/**
 * Host-side read-only aggregation behind `research-audit.query` (design
 * seal-evidence-versioning-audit §4.2). The service owns no records: it only
 * invokes the three landed per-domain read ports
 * (`evidence-dag.audit-query`, `change-inspector.list-changes`,
 * `project-dag.read-records`) and merges their bounded read models. It never
 * writes, never caches as authority, and keeps every cross-source rule
 * (freshness precedence, completeness gap codes, scan budget) in this one
 * place — domains keep their record-specific business rules.
 */

export const RESEARCH_AUDIT_PROJECTION_SOURCE_IDS = [
  'evidence',
  'sessionChange',
  'project',
  'checkpoint'
] as const
export type ResearchAuditProjectionSourceId =
  (typeof RESEARCH_AUDIT_PROJECTION_SOURCE_IDS)[number]

export const researchAuditProjectionFreshnessSchema = researchAuditFreshnessSchema
export type ResearchAuditProjectionFreshness =
  z.infer<typeof researchAuditProjectionFreshnessSchema>

/** Cross-source precedence per the audit spec: failed > stale > pending > fresh > unknown. */
const FRESHNESS_PRECEDENCE: readonly ResearchAuditProjectionFreshness[] = [
  'failed',
  'stale',
  'pending',
  'fresh',
  'unknown'
]

export const RESEARCH_AUDIT_PROJECTION_DEFAULT_LIMIT = 100
export const RESEARCH_AUDIT_PROJECTION_MAX_LIMIT = 500
export const RESEARCH_AUDIT_PROJECTION_DEFAULT_SCAN_BUDGET = 1000
export const RESEARCH_AUDIT_PROJECTION_MAX_SCAN_BUDGET = 1000
const PROJECT_RELEASE_PAGE_SIZE = 500
const SESSION_CHANGE_PAGE_SIZE = 500
/** One snapshot holds at most 5_000 changes; paging beyond that is a port violation. */
const MAX_SESSION_CHANGE_PAGES = 11
const MAX_CURSOR_BYTES = 4_096

const isoDateTimeSchema = z.string().datetime({ offset: true })
const availabilitySchema = z.enum(['available', 'unavailable'])
const gapCodeSchema = z.string().trim().min(1).max(256)

export const researchAuditProjectionRecordSchema = z.object({
  recordType: z.enum([
    'evidence-sidechain',
    'session-change',
    'project-decision',
    'project-approval',
    'project-release'
  ]),
  recordId: z.string().trim().min(1).max(512),
  digest: z.string().trim().min(1).max(256).optional(),
  producer: z.string().trim().min(1).max(256).optional(),
  reviewer: z.string().trim().min(1).max(256).optional(),
  // Session-change summaries may carry no occurredAt; absence is honest,
  // never fabricated. Records without a createdAt sort first.
  createdAt: isoDateTimeSchema.optional(),
  payload: z.record(z.string(), z.unknown())
}).strict()
export type ResearchAuditProjectionRecord = z.infer<typeof researchAuditProjectionRecordSchema>

export const researchAuditProjectionOutputSchema = z.object({
  subject: researchAuditSubjectSchema,
  records: z.array(researchAuditProjectionRecordSchema).max(RESEARCH_AUDIT_PROJECTION_MAX_LIMIT),
  sourceAvailability: z.object({
    evidence: availabilitySchema,
    sessionChange: availabilitySchema,
    project: availabilitySchema,
    checkpoint: availabilitySchema
  }).strict(),
  completeness: z.object({
    complete: z.boolean(),
    gapCodes: z.array(gapCodeSchema).max(64)
  }).strict(),
  freshness: researchAuditProjectionFreshnessSchema,
  freshnessSources: z.array(z.enum(RESEARCH_AUDIT_PROJECTION_SOURCE_IDS)).max(4),
  nextCursor: z.string().trim().min(1).max(MAX_CURSOR_BYTES).nullable()
}).strict()
export type ResearchAuditProjectionOutput = z.infer<typeof researchAuditProjectionOutputSchema>

export type ResearchAuditQuerySubject = ResearchAuditSubject

export type ResearchAuditCapabilityInvoker = Readonly<{
  invoke(actionId: string, input: unknown): Promise<unknown>
}>

/**
 * Read-only view of the Host thread authority, used only to bind a
 * `threadId` subject to the session identity that
 * `change-inspector.list-changes` resolves. It never reads change data —
 * the port remains the one canonical session-change read path.
 */
export type ResearchAuditThreadDirectory = Readonly<{
  list(): Promise<readonly Readonly<{ id: string; runtimeId: string }>[]>
}>

/**
 * Which of the four canonical sources can bind to each subject kind today.
 * A `false` is a designed gap, reported as `source_unavailable:<source>` —
 * never silently omitted:
 * - closureDigest → sessionChange: change summaries carry no closure binding.
 * - closureDigest → project: S4 `evidenceClosureDigest` is not implemented
 *   yet, so project records cannot be filtered by closure digest.
 * - threadId → project: project records carry no thread linkage.
 * - artifactVersionRef → sessionChange: change summaries carry no
 *   artifact-version binding.
 * - checkpoint: no checkpoint back-ref exists for any subject kind until S2
 *   lands `versioned-workspace` (task 3.7 note).
 */
const SUBJECT_SOURCE_BINDINGS: Readonly<
  Record<'closureDigest' | 'threadId' | 'artifactVersionRef', Record<ResearchAuditProjectionSourceId, boolean>>
> = Object.freeze({
  closureDigest: { evidence: true, sessionChange: false, project: false, checkpoint: false },
  threadId: { evidence: true, sessionChange: true, project: false, checkpoint: false },
  artifactVersionRef: { evidence: true, sessionChange: false, project: true, checkpoint: false }
})

type SubjectKind = keyof typeof SUBJECT_SOURCE_BINDINGS

const cursorSchema = z.object({
  v: z.literal(1),
  /** Offset into the merged, sorted record list. */
  o: z.number().int().nonnegative(),
  /**
   * Project release scan: how many releases (in deterministic chain order)
   * have been examined so far. Each call examines up to `scanBudget` more;
   * the already-examined prefix is re-read (read-only) so the merged page
   * stays stable across calls.
   */
  ps: z.number().int().nonnegative()
}).strict()

function subjectKindOf(subject: ResearchAuditQuerySubject): SubjectKind {
  if ('closureDigest' in subject) return 'closureDigest'
  if ('threadId' in subject) return 'threadId'
  return 'artifactVersionRef'
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function encodeCursor(state: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | undefined): z.infer<typeof cursorSchema> {
  if (!raw?.trim()) return { v: 1, o: 0, ps: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw.trim(), 'base64url').toString('utf8'))
  } catch {
    throw new Error('research-audit.query cursor is not decodable.')
  }
  return cursorSchema.parse(parsed)
}

/**
 * The Evidence engine thread id is `runtimeId:threadId` (the same identity
 * the delta store keys chains by); see the host thread key convention. This
 * mirrors that construction without re-deriving domain storage logic.
 */
function engineThreadIdentity(runtimeId: string, threadId: string): string {
  const runtime = runtimeId.trim()
  const id = threadId.trim()
  return runtime && id && !id.startsWith(`${runtime}:`) ? `${runtime}:${id}` : id
}

function toEvidenceRecord(record: ResearchAuditEvidenceSidechainRecordV1): ResearchAuditProjectionRecord {
  return researchAuditProjectionRecordSchema.parse({
    recordType: 'evidence-sidechain',
    recordId: record.recordId,
    digest: record.recordDigest,
    producer: record.producerIdentity,
    ...(record.reviewerIdentity ? { reviewer: record.reviewerIdentity } : {}),
    createdAt: record.createdAt,
    payload: record.payload
  })
}

function toSessionChangeRecord(change: ResearchAuditSessionChangeSummary): ResearchAuditProjectionRecord {
  return researchAuditProjectionRecordSchema.parse({
    recordType: 'session-change',
    recordId: change.id,
    ...(change.occurredAt ? { createdAt: change.occurredAt } : {}),
    payload: {
      status: change.status,
      ...(change.filePath ? { filePath: change.filePath } : {}),
      patch: change.patch,
      patchBytes: change.patchBytes,
      patchTruncated: change.patchTruncated
    }
  })
}

function toProjectReleaseRecord(release: ResearchAuditProjectRelease): ResearchAuditProjectionRecord {
  return researchAuditProjectionRecordSchema.parse({
    recordType: 'project-release',
    recordId: release.releaseId,
    digest: release.projectSnapshot,
    createdAt: release.createdAt,
    payload: release
  })
}

/**
 * The Artifact Versions contract serializes a content digest as bare hex
 * while the Project release contract mandates the `sha256:`-prefixed form;
 * both name the same sha256 identity. Compare the hex value exactly; never
 * prefix, fuzzy, or per-field match the id fields.
 */
function sha256Hex(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
}

/**
 * Exact Artifact Version identity match against one release's declared
 * outputs: the full artifactId + versionId + contentDigest triple must
 * match. Release outputs that omit artifactId can never triple-match.
 */
function releaseReferencesArtifactVersion(
  release: ResearchAuditProjectRelease,
  ref: Readonly<{ artifactId: string; versionId: string; contentDigest: string }>
): boolean {
  return release.outputArtifactVersions.some((output) =>
    output.artifactId === ref.artifactId &&
    output.artifactVersionId === ref.versionId &&
    sha256Hex(output.contentDigest) === sha256Hex(ref.contentDigest)
  )
}

function sortRecords(records: readonly ResearchAuditProjectionRecord[]): ResearchAuditProjectionRecord[] {
  const unique = new Map<string, ResearchAuditProjectionRecord>()
  for (const record of records) {
    unique.set(`${record.recordType}\u0000${record.recordId}`, record)
  }
  return [...unique.values()].sort((left, right) =>
    (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
    left.recordType.localeCompare(right.recordType) ||
    left.recordId.localeCompare(right.recordId)
  )
}

export class ResearchAuditProjectionService {
  readonly #invoker: ResearchAuditCapabilityInvoker
  readonly #threads: ResearchAuditThreadDirectory

  constructor(options: Readonly<{
    invoker: ResearchAuditCapabilityInvoker
    threads: ResearchAuditThreadDirectory
  }>) {
    this.#invoker = options.invoker
    this.#threads = options.threads
  }

  /**
   * Stateless per call: no result is cached or reused as authority. Every
   * source that can bind to the subject is consulted live; a source that
   * cannot bind (or fails at runtime) is reported unavailable by name.
   */
  async query(
    subject: ResearchAuditQuerySubject,
    options: Readonly<{ limit?: number; cursor?: string; scanBudget?: number }> = {}
  ): Promise<ResearchAuditProjectionOutput> {
    const parsedSubject = researchAuditSubjectSchema.parse(subject)
    const limit = clampInteger(
      options.limit,
      RESEARCH_AUDIT_PROJECTION_DEFAULT_LIMIT,
      1,
      RESEARCH_AUDIT_PROJECTION_MAX_LIMIT
    )
    const scanBudget = clampInteger(
      options.scanBudget,
      RESEARCH_AUDIT_PROJECTION_DEFAULT_SCAN_BUDGET,
      1,
      RESEARCH_AUDIT_PROJECTION_MAX_SCAN_BUDGET
    )
    const cursor = decodeCursor(options.cursor)
    const bindings = SUBJECT_SOURCE_BINDINGS[subjectKindOf(parsedSubject)]

    const availability: Record<ResearchAuditProjectionSourceId, 'available' | 'unavailable'> = {
      evidence: 'unavailable',
      sessionChange: 'unavailable',
      project: 'unavailable',
      checkpoint: 'unavailable'
    }
    const sourceGaps = new Map<ResearchAuditProjectionSourceId, string>()
    const freshnessBySource = new Map<ResearchAuditProjectionSourceId, ResearchAuditProjectionFreshness>()
    const records: ResearchAuditProjectionRecord[] = []
    let scanBounded = false
    let examinedReleases = cursor.ps

    // Evidence: the only source that binds to all three subject kinds.
    if (bindings.evidence) {
      try {
        const output = researchAuditEvidenceAuditQueryOutputSchema.parse(await this.#invoker.invoke(
          RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.evidenceAuditQuery,
          { subject: parsedSubject }
        ))
        for (const record of output.records) records.push(toEvidenceRecord(record))
        availability.evidence = 'available'
        freshnessBySource.set('evidence', output.freshness)
      } catch {
        availability.evidence = 'unavailable'
        sourceGaps.set('evidence', 'source_unavailable:evidence')
      }
    } else {
      sourceGaps.set('evidence', 'source_unavailable:evidence')
    }

    // Session changes: only a threadId subject binds, and only when the
    // engine thread id resolves through the Host thread authority to the
    // session id the change-inspector port resolves.
    if (bindings.sessionChange && 'threadId' in parsedSubject) {
      try {
        const sessionId = await this.#resolveSessionId(parsedSubject.threadId)
        if (sessionId) {
          for (const change of await this.#listSessionChanges(sessionId)) {
            records.push(toSessionChangeRecord(change))
          }
          availability.sessionChange = 'available'
          freshnessBySource.set('sessionChange', 'fresh')
        } else {
          sourceGaps.set('sessionChange', 'source_unavailable:session-change')
        }
      } catch {
        availability.sessionChange = 'unavailable'
        sourceGaps.set('sessionChange', 'source_unavailable:session-change')
      }
    } else {
      sourceGaps.set('sessionChange', 'source_unavailable:session-change')
    }

    // Project governance: only an artifactVersionRef subject binds; release
    // records are scanned through the read port and filtered here by the
    // exact triple, bounded by the scan budget.
    if (bindings.project && 'artifactVersionRef' in parsedSubject) {
      const ref = parsedSubject.artifactVersionRef
      try {
        const scan = await this.#scanProjectReleases(
          { artifactId: ref.artifactId, versionId: ref.versionId, contentDigest: ref.contentDigest },
          cursor.ps,
          scanBudget
        )
        for (const release of scan.matches) records.push(toProjectReleaseRecord(release))
        availability.project = 'available'
        freshnessBySource.set('project', scan.truncated ? 'pending' : 'fresh')
        scanBounded = scan.truncated
        examinedReleases = scan.examined
      } catch {
        availability.project = 'unavailable'
        sourceGaps.set('project', 'source_unavailable:project')
      }
    } else {
      sourceGaps.set('project', 'source_unavailable:project')
    }

    // Checkpoints cannot back-reference any subject kind until S2 lands
    // versioned-workspace; reported by name instead of being omitted.
    sourceGaps.set('checkpoint', 'source_unavailable:checkpoint')

    const gapCodes: string[] = []
    for (const source of RESEARCH_AUDIT_PROJECTION_SOURCE_IDS) {
      const gap = sourceGaps.get(source)
      if (gap) gapCodes.push(gap)
    }
    if (scanBounded) gapCodes.push('scan_bounded')

    const merged = sortRecords(records)
    const page = merged.slice(cursor.o, cursor.o + limit)
    const hasMore = cursor.o + page.length < merged.length
    const nextCursor = hasMore || scanBounded
      ? encodeCursor({ v: 1, o: cursor.o + page.length, ps: examinedReleases })
      : null

    const freshnessSources = RESEARCH_AUDIT_PROJECTION_SOURCE_IDS.filter((source) =>
      freshnessBySource.has(source)
    )
    const freshness = rollupFreshness(
      freshnessSources.map((source) => freshnessBySource.get(source)!)
    )

    return researchAuditProjectionOutputSchema.parse({
      subject: parsedSubject,
      records: page,
      sourceAvailability: availability,
      completeness: { complete: gapCodes.length === 0, gapCodes },
      freshness,
      freshnessSources,
      nextCursor
    })
  }

  /**
   * Binds an Evidence engine thread id to the session id the change-inspector
   * port resolves. The port's `sessionId` is the raw Host thread id (what
   * `agentThreads.list()` projects), while the Evidence subject threadId is
   * the engine thread id (`runtimeId:threadId`). Matching is exact on either
   * form through the Host thread authority — no prefix string surgery.
   */
  async #resolveSessionId(engineThreadId: string): Promise<string | null> {
    const threads = await this.#threads.list()
    const direct = threads.find((thread) => thread.id === engineThreadId)
    const matched = direct ??
      threads.find((thread) => engineThreadIdentity(thread.runtimeId, thread.id) === engineThreadId)
    return matched ? matched.id : null
  }

  async #listSessionChanges(sessionId: string): Promise<ResearchAuditSessionChangeSummary[]> {
    const changes: ResearchAuditSessionChangeSummary[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_SESSION_CHANGE_PAGES; page += 1) {
      const output = researchAuditSessionChangeListChangesOutputSchema.parse(await this.#invoker.invoke(
        RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.sessionChangeListChanges,
        {
          sessionId,
          limit: SESSION_CHANGE_PAGE_SIZE,
          ...(cursor ? { cursor } : {})
        }
      ))
      changes.push(...output.changes)
      if (!output.nextCursor) return changes
      cursor = output.nextCursor
    }
    throw new Error('change-inspector.list-changes did not terminate within its snapshot bound.')
  }

  /**
   * Walks the release chain in its deterministic read order. The scan is
   * bounded per call: at most `budget` releases that were not examined in a
   * prior call are examined anew (the cursor carries the cumulative count).
   * The already-examined prefix is re-read — the service is stateless and
   * read-only — so the merged page stays stable across calls; matches among
   * the prefix are re-collected, never double-counted against the budget.
   *
   * Exhausting the budget before the chain ends yields `truncated`, which
   * the caller surfaces as `scan_bounded` with a cursor that resumes within
   * the budget on the next call.
   */
  async #scanProjectReleases(
    ref: Readonly<{ artifactId: string; versionId: string; contentDigest: string }>,
    previouslyExamined: number,
    budget: number
  ): Promise<Readonly<{
    matches: ResearchAuditProjectRelease[]
    truncated: boolean
    examined: number
  }>> {
    const matches: ResearchAuditProjectRelease[] = []
    let globalIndex = 0
    let newExaminations = 0
    let truncated = false
    let pc: string | null = null
    while (true) {
      const result = researchAuditProjectReadRecordsResultSchema.parse(await this.#invoker.invoke(
        RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.projectReadRecords,
        {
          recordType: 'release',
          limit: PROJECT_RELEASE_PAGE_SIZE,
          ...(pc ? { cursor: pc } : {})
        }
      ))
      if (!result.ok) {
        throw new Error(`project-dag.read-records failed: ${result.error.code}: ${result.error.message}`)
      }
      const page = result.data.records as ResearchAuditProjectRelease[]
      for (const record of page) {
        if (globalIndex >= previouslyExamined) {
          if (newExaminations >= budget) {
            truncated = true
            break
          }
          newExaminations += 1
        }
        if (releaseReferencesArtifactVersion(record, ref)) matches.push(record)
        globalIndex += 1
      }
      if (truncated) break
      if (result.data.nextCursor === null) break
      pc = result.data.nextCursor
    }
    return {
      matches,
      truncated,
      examined: previouslyExamined + newExaminations
    }
  }
}

function rollupFreshness(values: readonly ResearchAuditProjectionFreshness[]): ResearchAuditProjectionFreshness {
  if (!values.length) return 'unknown'
  for (const candidate of FRESHNESS_PRECEDENCE) {
    if (values.includes(candidate)) return candidate
  }
  return 'unknown'
}

/**
 * Canonical production invoker: host-internal `agent`-audience caller through
 * the CapabilityBroker. All three owner ports declare `effect: 'read'` and
 * audiences `['ui', 'agent']`; the broker validates both at dispatch, so a
 * non-read effect can never be reached through this adapter.
 */
export function createBrokerResearchAuditInvoker(
  broker: CapabilityBroker,
  options: Readonly<{ callerId?: string; workspaceId?: string }> = {}
): ResearchAuditCapabilityInvoker {
  const callerId = options.callerId ?? 'host:research-audit-projection'
  const workspaceId = options.workspaceId?.trim()
  return Object.freeze({
    invoke: async (actionId, input) => {
      const result = await broker.invoke(
        {
          audience: 'agent',
          callerId,
          ...(workspaceId ? { workspaceId } : {})
        },
        { actionId, input: capabilityJsonValueSchema.parse(input) }
      )
      return result.output
    }
  })
}
