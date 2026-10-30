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
  researchAuditSubjectSchema
} from './research-audit.js'

const DIGEST_A = `sha256:${'a'.repeat(64)}`

describe('research-audit SDK contracts', () => {
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
