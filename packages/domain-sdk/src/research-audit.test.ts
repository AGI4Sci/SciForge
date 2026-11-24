import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS,
  RESEARCH_AUDIT_SESSION_CHANGE_MAX_LIST_CHANGES,
  RESEARCH_AUDIT_SESSION_CHANGE_MAX_SUMMARY_PATCH_BYTES,
  artifactVersionAccessPolicyV1Schema,
  artifactVersionRefV1Schema,
  researchAuditEvidenceAuditQueryOutputSchema,
  researchAuditFreshnessSchema,
  researchAuditProjectReadRecordsResultSchema,
  researchAuditSessionChangeListChangesOutputSchema,
  researchAuditSubjectSchema,
  researchAuditScientificReviewSchema,
  researchAuditReviewDecisionsSchema,
  researchAuditReviewTargetOutcomeSchema
} from './research-audit.js'

const DIGEST_A = `sha256:${'a'.repeat(64)}`

describe('research-audit SDK contracts', () => {
  it('accepts explained revision coverage and rejects negative work, over-budget queries and removed cursor metadata', () => {
    const review = { coverage: 'recorded-links-only', bounded: true, impacts: [],
      conditions: ['independence', 'controls', 'negative-results', 'reproduction', 'scope'].map(axis => ({ axis, status: 'unknown', observations: [] })),
      coverageDetails: { indexRevision: 1, indexedChains: 1, indexedDeltas: 1101, scannedDeltas: 1101, totalRelevantDeltas: 1101, queryNodes: 15, extractionNodes: 1101, omittedRecords: 0, reasons: ['projection-budget-or-output-limit; narrow the audit subject'] } }
    assert.equal(researchAuditScientificReviewSchema.safeParse(review).success, true)
    assert.equal(researchAuditScientificReviewSchema.safeParse({ ...review, coverageDetails: { ...review.coverageDetails, scannedDeltas: -1 } }).success, false)
    assert.equal(researchAuditScientificReviewSchema.safeParse({ ...review, coverageDetails: { ...review.coverageDetails, nextCursor: null } }).success, false)
    assert.equal(researchAuditScientificReviewSchema.safeParse({ ...review, coverageDetails: { ...review.coverageDetails, queryNodes: 10001 } }).success, false)
  })
  it('pins the three read-port capability ids', () => {
    assert.equal(RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.evidenceAuditQuery, 'evidence-dag.audit-query')
    assert.equal(RESEARCH_AUDIT_SESSION_CHANGE_MAX_LIST_CHANGES, 500)
    assert.equal(RESEARCH_AUDIT_SESSION_CHANGE_MAX_SUMMARY_PATCH_BYTES, 1_024)
    assert.equal(
      RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.sessionChangeListChanges,
      'change-inspector.list-changes'
    )
    assert.equal(RESEARCH_AUDIT_READ_PORT_CAPABILITY_IDS.projectReadRecords, 'project-dag.read-records')
  })

  it('keeps the shared five-value freshness vocabulary', () => {
    assert.deepEqual(researchAuditFreshnessSchema.options, [
      'fresh',
      'stale',
      'pending',
      'failed',
      'unknown'
    ])
  })

  it('discriminates the three subject kinds exactly', () => {
    assert.ok(researchAuditSubjectSchema.safeParse({ closureDigest: DIGEST_A }).success)
    assert.ok(researchAuditSubjectSchema.safeParse({ threadId: 'codex:thread-1' }).success)
    assert.ok(
      researchAuditSubjectSchema.safeParse({
        artifactVersionRef: {
          artifactId: 'artifact:paper',
          versionId: 'artifact-version:v1',
          contentDigest: 'f'.repeat(64),
          byteLength: 0,
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
        }
      }).success
    )
    assert.ok(!researchAuditSubjectSchema.safeParse({ threadId: 'codex:thread-1', closureDigest: DIGEST_A }).success)
  })

  it('enforces the restricted access-policy principal rule on the artifact ref', () => {
    const base = {
      artifactId: 'artifact:paper',
      versionId: 'artifact-version:v1',
      contentDigest: 'f'.repeat(64),
      byteLength: 0,
      availability: 'available' as const,
      retention: 'snapshot' as const
    }
    assert.ok(
      artifactVersionRefV1Schema.safeParse({
        ...base,
        accessPolicy: { visibility: 'restricted', principals: ['user:1'], allowExport: false }
      }).success
    )
    assert.ok(
      !artifactVersionAccessPolicyV1Schema.safeParse({
        visibility: 'restricted',
        principals: [],
        allowExport: false
      }).success
    )
  })

  it('narrows the project read-records result envelope and keeps records opaque', () => {
    const ok = researchAuditProjectReadRecordsResultSchema.parse({
      ok: true,
      data: { records: [{ releaseId: 'release-1' }], nextCursor: null }
    })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.deepEqual(ok.data.records, [{ releaseId: 'release-1' }])
    const failure = researchAuditProjectReadRecordsResultSchema.parse({
      ok: false,
      error: { code: 'service_unreachable', message: 'sidecar down', retryable: true }
    })
    assert.equal(failure.ok, false)
    assert.ok(!researchAuditProjectReadRecordsResultSchema.safeParse({ ok: true, data: { records: [], nextCursor: 4 } }).success)
  })

  it('bounds session-change list outputs by the shared maximum', () => {
    const change = {
      id: 'change-1',
      status: 'success',
      patch: 'diff',
      patchBytes: 4,
      patchTruncated: false
    }
    assert.ok(
      researchAuditSessionChangeListChangesOutputSchema.safeParse({
        changes: [change],
        nextCursor: null,
        revision: 'rev-1',
        truncated: false
      }).success
    )
  })

  it('requires the evidence audit-query output to name its source', () => {
    const record = {
      recordDigest: DIGEST_A,
      threadId: 'codex:thread-1',
      sequence: 1,
      recordId: 'record-1',
      recordType: 'audit',
      closureDigest: DIGEST_A,
      idempotencyKey: 'idem-12345',
      payload: { note: 'x' },
      producerIdentity: 'agent',
      reviewerIdentity: null,
      createdAt: '2026-10-27T00:00:00.000Z'
    }
    assert.ok(
      researchAuditEvidenceAuditQueryOutputSchema.safeParse({
        subject: { threadId: 'codex:thread-1' },
        records: [record],
        completeness: { complete: true, gapCodes: [] },
        freshness: 'fresh',
        source: 'evidence-dag'
      }).success
    )
    assert.ok(
      !researchAuditEvidenceAuditQueryOutputSchema.safeParse({
        subject: { threadId: 'codex:thread-1' },
        records: [record],
        completeness: { complete: true, gapCodes: [] },
        freshness: 'fresh',
        source: 'project-dag'
      }).success
    )
  })
})

it('review absence and partial authority coverage are explicit, never an empty success by default', () => {
  assert.equal(researchAuditReviewDecisionsSchema.safeParse({ status: 'unavailable', records: [], reasons: ['sidecar_offline'] }).success, true)
  assert.equal(researchAuditReviewDecisionsSchema.safeParse({ status: 'available', records: [], reasons: [], asOf: 'not-a-date' }).success, false)
  assert.equal(researchAuditReviewDecisionsSchema.safeParse({ records: [] }).success, false)
})

describe('review decision target outcomes', () => {
  const decision = {
    type: 'HumanReviewDecisionRecorded', persistent: true, eventId: 'event-1', sequence: 1, idempotencyKey: 'key-1',
    occurredAt: '2026-01-01T00:00:00Z', threadId: 'thread-1', snapshotDigest: DIGEST_A, reviewPacketId: 'review-packet:1',
    action: 'reject', actor: 'human:reviewer', rationale: 'Inspected the sample.',
    reviewReceipt: { scope: { kind: 'unknown' }, identity: { status: 'unknown', source: 'not-recorded', principal: null },
      timing: { status: 'unknown', elapsedMs: null, activeMs: null }, previousDecisionEventId: null }
  }
  const wrap = (record: unknown) => ({ status: 'available', records: [record], reasons: [] })

  it('keeps decisions without outcomes valid and accepts well-formed per-target outcomes', () => {
    assert.equal(researchAuditReviewDecisionsSchema.safeParse(wrap(decision)).success, true)
    const outcomes = [{ targetId: 'node:a', errorFound: true, errorOrigin: 'source' },
      { targetId: 'node:b', errorFound: true, errorOrigin: 'inherited' },
      { targetId: 'node:c', errorFound: true, errorOrigin: 'undetermined' },
      { targetId: 'node:d', errorFound: false, errorOrigin: null }]
    assert.equal(researchAuditReviewDecisionsSchema.safeParse(wrap({ ...decision, targetOutcomes: outcomes })).success, true)
  })

  it('rejects an origin without an error, an error without an origin, unknown origins, extra keys and empty lists', () => {
    for (const bad of [
      { targetId: 'node:a', errorFound: false, errorOrigin: 'source' },
      { targetId: 'node:a', errorFound: true, errorOrigin: null },
      { targetId: 'node:a', errorFound: true, errorOrigin: 'elsewhere' },
      { targetId: 'node:a', errorFound: 'yes', errorOrigin: null },
      { targetId: 'node:a', errorFound: false, errorOrigin: null, extra: 1 }
    ]) {
      assert.equal(researchAuditReviewTargetOutcomeSchema.safeParse(bad).success, false, JSON.stringify(bad))
    }
    assert.equal(researchAuditReviewDecisionsSchema.safeParse(wrap({ ...decision, targetOutcomes: [] })).success, false)
  })
})
