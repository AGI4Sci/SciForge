import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagAuditQueryOutputSchema,
  evidenceDagSidechainRecordV1Schema,
  type EvidenceDagAuditQueryInput,
  type EvidenceDagSidechainRecordV1
} from '@sciforge/domain-evidence-dag/contract'
import { createEvidenceDagCapabilityFactory } from '@sciforge/domain-evidence-dag/main'
import {
  CHANGE_INSPECTOR_CAPABILITY_IDS,
  changeInspectorChangeSummarySchema,
  changeInspectorListChangesOutputSchema,
  type ChangeInspectorChangeSummary,
  type ChangeInspectorListChangesInput,
  type ChangeInspectorListChangesOutput
} from '@sciforge/domain-change-inspector/contract'
import { createChangeInspectorCapabilityFactory } from '@sciforge/domain-change-inspector/main'
import {
  PROJECT_DAG_CAPABILITY_IDS,
  projectDagReleaseV1Schema,
  type ProjectDagReadRecordsInput,
  type ProjectDagReadRecordsOutput,
  type ProjectDagReleaseV1
} from '@sciforge/domain-project-dag/contract'
import { createProjectDagCapabilityFactory } from '@sciforge/domain-project-dag/main'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import type { CapabilityDefinition } from '../capabilities/registry'
import {
  ResearchAuditProjectionService,
  researchAuditProjectionOutputSchema,
  type ResearchAuditCapabilityInvoker,
  type ResearchAuditThreadDirectory
} from './research-audit-projection'

const WORKSPACE = '/workspace'
const CLOSURE_DIGEST = `sha256:${'f'.repeat(64)}`
const HEAD_DIGEST = `sha256:${'e'.repeat(64)}`
const RECORD_DIGEST = `sha256:${'a'.repeat(64)}`
const SNAPSHOT_DIGEST = `sha256:${'b'.repeat(64)}`
const CONTENT_HEX = 'c'.repeat(64)
const OTHER_CONTENT_HEX = 'd'.repeat(64)
const CONTENT_DIGEST = `sha256:${CONTENT_HEX}`
const OTHER_CONTENT_DIGEST = `sha256:${OTHER_CONTENT_HEX}`
const THREAD_ID = 'codex:thread-1'
const RAW_THREAD_ID = 'thread-1'

type FixtureDefinition = CapabilityDefinition

/**
 * Fixture ports behind the real capability definitions: the registry holds
 * the production descriptors (so the structural zero-write assertion looks
 * real effects up via the registry), while the handlers serve fixture data.
 */
function createFixturePorts() {
  const invocations: { actionId: string; input: unknown }[] = []
  const auditQuery = new Map<string, (input: EvidenceDagAuditQueryInput) => unknown>()
  const listChanges = new Map<string, (input: ChangeInspectorListChangesInput) => unknown>()
  const readRecords = new Map<string, (input: ProjectDagReadRecordsInput) => unknown>()

  const evidenceFactory = createEvidenceDagCapabilityFactory<FixtureDefinition>({
    defineCapability: (options) => defineCapability(options as never),
    getRuntime: () => ({
      auditQuery: (input: EvidenceDagAuditQueryInput) => {
        const handler = auditQuery.get(keyOf(input.subject))
        if (!handler) throw new Error(`No audit-query fixture for ${keyOf(input.subject)}`)
        return handler(input)
      }
    }) as never
  })
  const changeInspectorFactory = createChangeInspectorCapabilityFactory<FixtureDefinition>({
    defineCapability: (options) => defineCapability(options as never),
    snapshot: () => {
      throw new Error('open-session is not part of the audit projection.')
    },
    listChanges: async (input) => {
      const handler = listChanges.get(input.sessionId)
      if (!handler) throw new Error(`No list-changes fixture for ${input.sessionId}`)
      return await handler(input) as ChangeInspectorListChangesOutput
    }
  })
  const projectDagFactory = createProjectDagCapabilityFactory<FixtureDefinition>({
    defineCapability: (options) => defineCapability(options as never),
    getRuntime: () => ({
      readRecords: async (input: ProjectDagReadRecordsInput) => {
        const handler = readRecords.get(input.recordType)
        if (!handler) throw new Error(`No read-records fixture for ${input.recordType}`)
        return await handler(input) as ProjectDagReadRecordsOutput
      }
    }) as never
  })

  const registry = new CapabilityRegistry([
    ...evidenceFactory.createDefinitions(),
    ...changeInspectorFactory.createDefinitions(),
    ...projectDagFactory.createDefinitions()
  ])

  const invoker: ResearchAuditCapabilityInvoker = {
    invoke: async (actionId, input) => {
      invocations.push({ actionId, input })
      const definition = registry.require(actionId)
      const result = await definition.handler(input as never, {
        caller: { audience: 'agent', callerId: 'test:audit-projection', workspaceId: WORKSPACE },
        assertPrincipalCurrent: () => undefined,
        issueResource: () => {
          throw new Error('The audit projection issues no resources.')
        }
      } as never)
      return result.output
    }
  }

  return { registry, invoker, invocations, auditQuery, listChanges, readRecords }
}

function keyOf(subject: EvidenceDagAuditQueryInput['subject']): string {
  return JSON.stringify(subject)
}

function sidechainRecord(overrides: Partial<EvidenceDagSidechainRecordV1> = {}): EvidenceDagSidechainRecordV1 {
  return evidenceDagSidechainRecordV1Schema.parse({
    recordDigest: RECORD_DIGEST,
    threadId: THREAD_ID,
    sequence: 1,
    recordId: 'record-1',
    recordType: 'audit',
    closureDigest: CLOSURE_DIGEST,
    idempotencyKey: 'idem-record-1',
    payload: { summary: 'fixture audit record' },
    producerIdentity: 'producer:fixture',
    reviewerIdentity: null,
    createdAt: '2026-10-26T00:00:00.000Z',
    ...overrides
  })
}

function auditOutput(
  subject: EvidenceDagAuditQueryInput['subject'],
  records: EvidenceDagSidechainRecordV1[],
  freshness: 'fresh' | 'stale' | 'pending' | 'failed' | 'unknown'
) {
  return evidenceDagAuditQueryOutputSchema.parse({
    subject,
    records,
    completeness: { complete: true, gapCodes: [] },
    freshness,
    source: 'evidence-dag'
  })
}

const DIFF = [
  'diff --git a/note.txt b/note.txt',
  '--- a/note.txt',
  '+++ b/note.txt',
  '@@ -0,0 +1 @@',
  '+hello'
].join('\n')

function changeSummary(
  id: string,
  occurredAt = '2026-10-26T00:30:00.000Z'
): ChangeInspectorChangeSummary {
  return changeInspectorChangeSummarySchema.parse({
    id,
    status: 'success',
    patch: DIFF,
    patchBytes: Buffer.byteLength(DIFF),
    patchTruncated: false,
    occurredAt
  })
}

function release(overrides: Partial<ProjectDagReleaseV1> = {}): ProjectDagReleaseV1 {
  return projectDagReleaseV1Schema.parse({
    releaseId: 'release-1',
    projectSnapshot: SNAPSHOT_DIGEST,
    classification: 'internal',
    target: 'paper-draft',
    outputArtifactVersions: [{
      artifactVersionId: 'artifact-version:version-1',
      contentDigest: CONTENT_DIGEST,
      artifactId: 'artifact:artifact-1'
    }],
    auditRefs: [],
    decisionRefs: [],
    approvalRefs: [],
    attemptOutcome: 'completed',
    createdAt: '2026-10-26T01:00:00.000Z',
    ...overrides
  })
}

const ARTIFACT_REF_SUBJECT: EvidenceDagAuditQueryInput['subject'] = {
  artifactVersionRef: {
    artifactId: 'artifact:artifact-1',
    versionId: 'artifact-version:version-1',
    contentDigest: CONTENT_HEX,
    byteLength: 5,
    availability: 'available',
    retention: 'snapshot',
    accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
  }
}

function threadDirectory(
  threads: readonly Readonly<{ id: string; runtimeId: string }>[]
): ResearchAuditThreadDirectory {
  return Object.freeze({ list: async () => threads })
}

function installAuditFixture(
  ports: ReturnType<typeof createFixturePorts>,
  subject: EvidenceDagAuditQueryInput['subject'],
  records: EvidenceDagSidechainRecordV1[],
  freshness: 'fresh' | 'stale' | 'pending' | 'failed' | 'unknown' = 'fresh'
) {
  ports.auditQuery.set(keyOf(subject), () => auditOutput(subject, records, freshness))
}

function installSessionFixture(
  ports: ReturnType<typeof createFixturePorts>,
  sessionId: string,
  pages: ChangeInspectorChangeSummary[][]
) {
  ports.listChanges.set(sessionId, (input) => {
    const startIndex = input.cursor ? pages.flat().findIndex((change) => change.id === input.cursor) + 1 : 0
    const flat = pages.flat()
    const limit = input.limit ?? 100
    const slice = flat.slice(startIndex, startIndex + limit)
    return changeInspectorListChangesOutputSchema.parse({
      changes: slice,
      nextCursor: startIndex + slice.length < flat.length ? slice[slice.length - 1]!.id : null,
      revision: 'rev-fixture',
      truncated: false
    })
  })
}

function installReleaseFixture(
  ports: ReturnType<typeof createFixturePorts>,
  pages: { cursor: string | null; records: ProjectDagReleaseV1[]; nextCursor: string | null }[]
) {
  ports.readRecords.set('release', (input) => {
    const page = pages.find((candidate) => candidate.cursor === (input.cursor ?? null)) ?? pages[0]!
    return { records: page.records, nextCursor: page.nextCursor }
  })
}

describe('ResearchAuditProjectionService availability matrix', () => {
  it('closureDigest: evidence available; session-change, project, checkpoint honestly unavailable', async () => {
    const ports = createFixturePorts()
    const subject = { closureDigest: CLOSURE_DIGEST }
    installAuditFixture(ports, subject, [sidechainRecord()])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.sourceAvailability).toEqual({
      evidence: 'available',
      sessionChange: 'unavailable',
      project: 'unavailable',
      checkpoint: 'unavailable'
    })
    expect(output.completeness).toEqual({
      complete: false,
      gapCodes: ['source_unavailable:session-change', 'source_unavailable:project', 'source_unavailable:checkpoint']
    })
    expect(output.records).toEqual([
      expect.objectContaining({
        recordType: 'evidence-sidechain',
        recordId: 'record-1',
        digest: RECORD_DIGEST,
        producer: 'producer:fixture',
        createdAt: '2026-10-26T00:00:00.000Z'
      })
    ])
    // Unbound sources are never invoked.
    expect(ports.invocations.map((invocation) => invocation.actionId)).toEqual([
      EVIDENCE_DAG_CAPABILITY_IDS.auditQuery
    ])
  })

  it('threadId: evidence and session-change available when the engine thread id resolves via the thread authority', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: THREAD_ID }
    installAuditFixture(ports, subject, [sidechainRecord()])
    installSessionFixture(ports, RAW_THREAD_ID, [[changeSummary('change-1')]])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.sourceAvailability).toEqual({
      evidence: 'available',
      sessionChange: 'available',
      project: 'unavailable',
      checkpoint: 'unavailable'
    })
    expect(output.completeness.gapCodes).toEqual([
      'source_unavailable:project',
      'source_unavailable:checkpoint'
    ])
    expect(output.records.map((record) => record.recordType).sort()).toEqual([
      'evidence-sidechain',
      'session-change'
    ])
    const sessionInvoke = ports.invocations.find((invocation) =>
      invocation.actionId === CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges
    )
    expect(sessionInvoke?.input).toEqual(expect.objectContaining({ sessionId: RAW_THREAD_ID }))
  })

  it('threadId: a raw session id subject also resolves', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: RAW_THREAD_ID }
    installAuditFixture(ports, subject, [])
    installSessionFixture(ports, RAW_THREAD_ID, [[changeSummary('change-1')]])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.sourceAvailability.sessionChange).toBe('available')
    expect(output.records).toEqual([
      expect.objectContaining({ recordType: 'session-change', recordId: 'change-1' })
    ])
  })

  it('threadId: session-change is honestly unavailable when no thread matches', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: 'codex:thread-missing' }
    installAuditFixture(ports, subject, [])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.sourceAvailability.sessionChange).toBe('unavailable')
    expect(output.completeness.gapCodes).toEqual([
      'source_unavailable:session-change',
      'source_unavailable:project',
      'source_unavailable:checkpoint'
    ])
    expect(ports.invocations.map((invocation) => invocation.actionId)).toEqual([
      EVIDENCE_DAG_CAPABILITY_IDS.auditQuery
    ])
  })

  it('threadId: a failing thread authority honestly downgrades session-change', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: THREAD_ID }
    installAuditFixture(ports, subject, [])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: {
        list: async () => {
          throw new Error('Host thread authority is unavailable.')
        }
      }
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.sourceAvailability.sessionChange).toBe('unavailable')
    expect(output.completeness.gapCodes).toContain('source_unavailable:session-change')
    expect(output.freshnessSources).toEqual(['evidence'])
  })

  it('threadId: stale declared head on evidence propagates to the cross-source rollup', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: THREAD_ID, headDigest: HEAD_DIGEST }
    installAuditFixture(ports, subject, [sidechainRecord()], 'stale')
    installSessionFixture(ports, RAW_THREAD_ID, [[changeSummary('change-1')]])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(subject))

    expect(output.freshness).toBe('stale')
    expect(output.freshnessSources).toEqual(['evidence', 'sessionChange'])
  })

  it('artifactVersionRef: project releases filtered by the exact triple only', async () => {
    const ports = createFixturePorts()
    installAuditFixture(ports, ARTIFACT_REF_SUBJECT, [sidechainRecord({ recordId: 'record-ref' })])
    installReleaseFixture(ports, [
      {
        cursor: null,
        records: [
          release({ releaseId: 'release-match' }),
          release({
            releaseId: 'release-wrong-version',
            outputArtifactVersions: [{
              artifactVersionId: 'artifact-version:version-2',
              contentDigest: CONTENT_DIGEST,
              artifactId: 'artifact:artifact-1'
            }]
          }),
          release({
            releaseId: 'release-missing-artifact-id',
            outputArtifactVersions: [{
              artifactVersionId: 'artifact-version:version-1',
              contentDigest: CONTENT_DIGEST
            }]
          }),
          release({
            releaseId: 'release-wrong-digest',
            outputArtifactVersions: [{
              artifactVersionId: 'artifact-version:version-1',
              contentDigest: OTHER_CONTENT_DIGEST,
              artifactId: 'artifact:artifact-1'
            }]
          })
        ],
        nextCursor: null
      }
    ])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })

    const output = researchAuditProjectionOutputSchema.parse(await service.query(ARTIFACT_REF_SUBJECT))

    expect(output.sourceAvailability).toEqual({
      evidence: 'available',
      sessionChange: 'unavailable',
      project: 'available',
      checkpoint: 'unavailable'
    })
    expect(output.completeness).toEqual({
      complete: false,
      gapCodes: ['source_unavailable:session-change', 'source_unavailable:checkpoint']
    })
    expect(output.records.map((record) => [record.recordType, record.recordId]).sort()).toEqual([
      ['evidence-sidechain', 'record-ref'],
      ['project-release', 'release-match']
    ])
    expect(output.freshness).toBe('fresh')
    expect(output.freshnessSources).toEqual(['evidence', 'project'])
  })
})

describe('ResearchAuditProjectionService freshness rollup', () => {
  it('failed beats stale beats pending beats fresh, and contributing sources are named', async () => {
    const ports = createFixturePorts()
    installReleaseFixture(ports, [
      {
        cursor: null,
        records: [release()],
        nextCursor: null
      }
    ])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })

    // The project source answers with a live completed read ('fresh'); the
    // precedence chain is driven through the evidence port's five values.
    const cases: ReadonlyArray<[
      'failed' | 'stale' | 'pending' | 'unknown',
      'failed' | 'stale' | 'pending' | 'fresh'
    ]> = [
      ['failed', 'failed'],
      ['stale', 'stale'],
      ['pending', 'pending'],
      ['unknown', 'fresh']
    ]
    for (const [evidenceFreshness, expected] of cases) {
      ports.auditQuery.clear()
      installAuditFixture(ports, ARTIFACT_REF_SUBJECT, [], evidenceFreshness)
      const output = researchAuditProjectionOutputSchema.parse(
        await service.query(ARTIFACT_REF_SUBJECT)
      )
      expect(output.freshness).toBe(expected)
      expect(output.freshnessSources).toEqual(['evidence', 'project'])
    }
  })

  it('no available source rolls up to unknown with no contributing sources', async () => {
    const ports = createFixturePorts()
    installAuditFixture(ports, { closureDigest: CLOSURE_DIGEST }, [], 'unknown')
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })

    const output = researchAuditProjectionOutputSchema.parse(
      await service.query({ closureDigest: CLOSURE_DIGEST })
    )

    expect(output.freshness).toBe('unknown')
    // Evidence contributed its `unknown` reading; the rollup names sources
    // that contributed a freshness value, not only stale/failed ones.
    expect(output.freshnessSources).toEqual(['evidence'])
  })
})

describe('ResearchAuditProjectionService scan budget and pagination', () => {
  it('scanBudget truncation reports scan_bounded with complete false and resumes via cursor', async () => {
    const ports = createFixturePorts()
    installAuditFixture(ports, ARTIFACT_REF_SUBJECT, [])
    installReleaseFixture(ports, [
      {
        cursor: null,
        records: [
          release({ releaseId: 'release-1' }),
          release({ releaseId: 'release-2' }),
          release({ releaseId: 'release-3-match', outputArtifactVersions: [{
            artifactVersionId: 'artifact-version:version-1',
            contentDigest: CONTENT_DIGEST,
            artifactId: 'artifact:artifact-1'
          }] })
        ],
        nextCursor: 'page-2'
      },
      {
        cursor: 'page-2',
        records: [
          release({ releaseId: 'release-4-match', outputArtifactVersions: [{
            artifactVersionId: 'artifact-version:version-1',
            contentDigest: CONTENT_DIGEST,
            artifactId: 'artifact:artifact-1'
          }] }),
          release({
            releaseId: 'release-5',
            outputArtifactVersions: [{
              artifactVersionId: 'artifact-version:version-9',
              contentDigest: OTHER_CONTENT_DIGEST,
              artifactId: 'artifact:artifact-9'
            }]
          })
        ],
        nextCursor: null
      }
    ])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })

    const first = researchAuditProjectionOutputSchema.parse(
      await service.query(ARTIFACT_REF_SUBJECT, { scanBudget: 3 })
    )
    expect(first.completeness).toEqual({
      complete: false,
      gapCodes: [
        'source_unavailable:session-change',
        'source_unavailable:checkpoint',
        'scan_bounded'
      ]
    })
    expect(first.freshness).toBe('pending')
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = researchAuditProjectionOutputSchema.parse(
      await service.query(ARTIFACT_REF_SUBJECT, { scanBudget: 10, cursor: first.nextCursor! })
    )
    expect(second.completeness.gapCodes).toEqual([
      'source_unavailable:session-change',
      'source_unavailable:checkpoint'
    ])
    // The merged page is stable across calls: release-3-match was already
    // delivered on the truncated first page; the resumed scan re-reads the
    // examined prefix (read-only) and delivers only the new match.
    expect(second.records.map((record) => record.recordId)).toEqual(['release-4-match'])
    expect(second.nextCursor).toBeNull()
  })

  it('a failing evidence port is reported unavailable instead of failing the query', async () => {
    const ports = createFixturePorts()
    // No audit-query fixture is installed: the port fails at runtime.
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })

    const output = researchAuditProjectionOutputSchema.parse(
      await service.query({ closureDigest: CLOSURE_DIGEST })
    )

    expect(output.sourceAvailability.evidence).toBe('unavailable')
    expect(output.completeness.gapCodes).toEqual([
      'source_unavailable:evidence',
      'source_unavailable:session-change',
      'source_unavailable:project',
      'source_unavailable:checkpoint'
    ])
    expect(output.freshness).toBe('unknown')
    expect(output.records).toEqual([])
  })

  it('merged pages honor limit and the cursor resumes the merged offset in createdAt order', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: THREAD_ID }
    installAuditFixture(ports, subject, [
      sidechainRecord({ recordId: 'record-early', createdAt: '2026-10-26T00:00:00.000Z' }),
      sidechainRecord({ recordId: 'record-late', createdAt: '2026-10-26T02:00:00.000Z' })
    ])
    installSessionFixture(ports, RAW_THREAD_ID, [[
      changeSummary('change-mid', '2026-10-26T01:00:00.000Z')
    ]])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    const first = researchAuditProjectionOutputSchema.parse(
      await service.query(subject, { limit: 2 })
    )
    expect(first.records.map((record) => record.recordId)).toEqual(['record-early', 'change-mid'])
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = researchAuditProjectionOutputSchema.parse(
      await service.query(subject, { limit: 2, cursor: first.nextCursor! })
    )
    expect(second.records.map((record) => record.recordId)).toEqual(['record-late'])
    expect(second.nextCursor).toBeNull()
  })

  it('invalid cursor fails closed', async () => {
    const ports = createFixturePorts()
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([])
    })
    await expect(service.query({ closureDigest: CLOSURE_DIGEST }, { cursor: 'not-a-cursor' }))
      .rejects.toThrow()
  })
})

describe('ResearchAuditProjectionService zero-write structure', () => {
  it('every invoked actionId resolves to effect read through the registry', async () => {
    const ports = createFixturePorts()
    const subject = { threadId: THREAD_ID }
    installAuditFixture(ports, subject, [sidechainRecord()])
    installSessionFixture(ports, RAW_THREAD_ID, [[changeSummary('change-1')]])
    installReleaseFixture(ports, [{ cursor: null, records: [release()], nextCursor: null }])
    const service = new ResearchAuditProjectionService({
      invoker: ports.invoker,
      threads: threadDirectory([{ id: RAW_THREAD_ID, runtimeId: 'codex' }])
    })

    await service.query(subject)
    await service.query(ARTIFACT_REF_SUBJECT)

    const invokedActionIds = [...new Set(ports.invocations.map((invocation) => invocation.actionId))]
    expect(invokedActionIds).toEqual([
      EVIDENCE_DAG_CAPABILITY_IDS.auditQuery,
      CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges,
      PROJECT_DAG_CAPABILITY_IDS.readRecords
    ])
    for (const actionId of invokedActionIds) {
      expect(ports.registry.require(actionId).descriptor.effect).toBe('read')
    }
  })
})
