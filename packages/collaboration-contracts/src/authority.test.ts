import { describe, expect, it } from 'vitest'

import {
  agentProfilePublicProjectionSchema,
  canonicalTaskIdForLineage,
  cloudProjectDashboardSchema,
  dashboardMaterialConflictSchema,
  dashboardMentionOptionSchema,
  deliveryManifestDigest,
  deliveryManifestSchema,
  migrationProvenanceRecordSchema,
  isActivityCursorReplay,
  isIdempotencyReplay,
  isRevisionCurrent,
  parsePublicProgressUpdate,
  taskLineageSchema,
  taskOfferAcceptanceBindingSchema,
  type PublicActivityCursor,
  type IdempotencyReceipt,
  type PublicActivityEvent
} from './authority.js'

const ids = {
  projectId: 'prj_authority0001',
  taskId: 'tsk_authority0001',
  offerId: 'ofr_authority0001',
  executionId: 'exe_authority0001',
  workerUserId: 'usr_authority0001',
  agentId: 'agt_authority0001',
  deviceId: 'dev_authority0001',
  profileId: 'prf_authority0001',
  sessionId: 'ses_authority0001',
  eventId: 'evt_authority0001',
  updateId: 'ppu_authority0001',
  contractDigest: 'a'.repeat(64),
  proofDigest: 'b'.repeat(64),
  sourceObjectId: 'obj_authority0001',
  deliveryId: 'mft_authority0001'
} as const

const contract = {
  projectId: ids.projectId,
  taskId: ids.taskId,
  contractRevision: 2,
  contractDigest: ids.contractDigest,
  inputReferences: [{ kind: 'material_revision', referenceId: 'mat_authority0001', revision: 2, digest: 'd'.repeat(64) }]
}

describe('authority contracts', () => {
  it('derives deterministic identity from the complete Plan lineage', () => {
    const lineage = taskLineageSchema.parse({
      projectId: ids.projectId,
      requirementsBaselineId: 'baseline-2026-10-12',
      workItemId: 'item_authority001'
    })
    expect(canonicalTaskIdForLineage(lineage.projectId, lineage.requirementsBaselineId, lineage.workItemId))
      .toBe(canonicalTaskIdForLineage(lineage.projectId, lineage.requirementsBaselineId, lineage.workItemId))
    expect(canonicalTaskIdForLineage(lineage.projectId, 'baseline-2026-10-13', lineage.workItemId))
      .not.toBe(canonicalTaskIdForLineage(lineage.projectId, lineage.requirementsBaselineId, lineage.workItemId))
  })

  it('binds one human proof to exactly one Agent, Device and Execution', () => {
    const result = taskOfferAcceptanceBindingSchema.safeParse({
      taskOfferId: ids.offerId,
      taskId: ids.taskId,
      executionId: ids.executionId,
      workerUserId: ids.workerUserId,
      agentId: ids.agentId,
      agentProfileId: ids.profileId,
      profileRevision: 3,
      deviceId: ids.deviceId,
      contract,
      proof: {
        userId: ids.workerUserId,
        deviceId: ids.deviceId,
        acceptedAt: '2026-10-12T00:00:00Z',
        proofDigest: ids.proofDigest,
        interaction: 'explicit_click'
      },
      idempotencyKey: 'idem_authority-accept-001'
    })
    expect(result.success).toBe(true)
    expect(taskOfferAcceptanceBindingSchema.safeParse({
      ...(result.success ? result.data : {}),
      proof: { ...(result.success ? result.data.proof : {}), deviceId: 'dev_otherauthority1' }
    }).success).toBe(false)
  })

  it('keeps Agent Profile private fields out of the public projection', () => {
    const profile = agentProfilePublicProjectionSchema.parse({
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      type: 'agent_profile_public_projection',
      agentProfileId: ids.profileId,
      ownerUserId: ids.workerUserId,
      profileRevision: 1,
      responsibilitySummary: 'Runs bounded scientific tasks',
      capabilityTags: ['analysis'],
      modelFamily: 'local',
      status: 'active'
    })
    expect(profile).not.toHaveProperty('privatePrompt')
    expect(agentProfilePublicProjectionSchema.safeParse({ ...profile, privatePrompt: 'secret' }).success).toBe(false)
  })

  it('rejects transcript-derived or private progress and allows bounded public progress', () => {
    const valid = parsePublicProgressUpdate({
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      type: 'public_progress_update',
      publicProgressUpdateId: ids.updateId,
      projectId: ids.projectId,
      taskId: ids.taskId,
      contract,
      executionId: ids.executionId,
      sessionBindingId: ids.sessionId,
      actorAgentId: ids.agentId,
      actorAgentProfileId: ids.profileId,
      actorProfileRevision: 1,
      visibility: 'project_public',
      stage: 'running',
      summary: 'Validated the requested input set.',
      blocker: null,
      nextAction: 'Run the deterministic analysis.',
      referencedObjectIds: [ids.sourceObjectId],
      sourceEventId: ids.eventId,
      idempotencyKey: 'idem_authority-progress-001'
    })
    expect(valid.visibility).toBe('project_public')
    expect(() => parsePublicProgressUpdate({ ...valid, summary: 'Transcript: private prompt text' })).toThrow()
    expect(() => parsePublicProgressUpdate({ ...valid, transcript: 'private' })).toThrow()
  })

  it('supports cursor replay, stale revision rejection and idempotent retry checks', () => {
    const cursor = { projectId: ids.projectId, sequence: 4 } as PublicActivityCursor
    const event = { projectId: ids.projectId, sequence: 5 } as Pick<PublicActivityEvent, 'projectId' | 'sequence'>
    expect(isActivityCursorReplay(cursor, event)).toBe(true)
    expect(isActivityCursorReplay(cursor, { ...event, sequence: 4 })).toBe(false)
    expect(isActivityCursorReplay(cursor, { ...event, projectId: 'prj_otherauthority1' })).toBe(false)
    expect(isRevisionCurrent(2, 2)).toBe(true)
    expect(isRevisionCurrent(2, 3)).toBe(false)
    const receipt = { idempotencyKey: 'idem_authority-receipt-001', bodyDigest: 'c'.repeat(64) } as Pick<IdempotencyReceipt, 'idempotencyKey' | 'bodyDigest'>
    expect(isIdempotencyReplay(receipt, receipt)).toBe(true)
    expect(isIdempotencyReplay(receipt, { ...receipt, bodyDigest: 'd'.repeat(64) })).toBe(false)
  })

  it('requires an approved Worker decision and exact Task contract for sealed deliveries', () => {
    const deliveryPayload = {
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      type: 'delivery_manifest' as const,
      deliveryManifestId: ids.deliveryId,
      projectId: ids.projectId,
      taskId: ids.taskId,
      executionId: ids.executionId,
      contract,
      objects: [{
        objectId: ids.sourceObjectId,
        objectKey: 'projects/prj_authority0001/objects/opaque',
        revision: 1,
        sha256: 'e'.repeat(64),
        byteCount: 42,
        mediaType: 'text/plain',
        projectId: ids.projectId,
        visibility: 'project_public' as const,
        ownerUserId: ids.workerUserId,
        retentionUntil: null
      }],
      workerDecision: 'approved' as const,
      verificationEvidence: ['Hash verified'],
      operationId: 'xfr_authority0001',
      sealedAt: '2026-10-12T00:00:00Z'
    } as const
    const delivery = { ...deliveryPayload, manifestDigest: deliveryManifestDigest(deliveryPayload) }
    expect(deliveryManifestSchema.safeParse(delivery).success).toBe(true)
    expect(deliveryManifestSchema.safeParse({ ...delivery, workerDecision: 'returned' }).success).toBe(false)
    expect(deliveryManifestSchema.safeParse({ ...delivery, manifestDigest: '0'.repeat(64) }).success).toBe(false)
  })

  it('keeps Plan/Task identity and material conflict choices explicit in the Dashboard projection', () => {
    const mention = dashboardMentionOptionSchema.parse({
      userId: ids.workerUserId,
      displayName: 'Worker A',
      role: 'worker'
    })
    expect(mention.role).toBe('worker')
    const conflict = dashboardMaterialConflictSchema.parse({
      logicalMaterialId: 'material_authority001',
      current: { materialRevisionId: 'mat_authority0001', revision: 1, sha256: '1'.repeat(64) },
      incoming: { materialRevisionId: 'mat_authority0002', revision: 2, sha256: '2'.repeat(64) },
      allowedDecisions: ['keep_current', 'adopt_incoming', 'save_as_new']
    })
    expect(conflict.allowedDecisions).toContain('save_as_new')
    expect(() => dashboardMaterialConflictSchema.parse({
      ...conflict,
      incoming: conflict.current
    })).toThrow()
    const dashboard = cloudProjectDashboardSchema.parse({
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      type: 'cloud_project_dashboard',
      projectId: ids.projectId,
      projectName: 'Authority project',
      role: 'worker',
      view: 'board',
      tasks: [],
      activity: [],
      activityCursor: null,
      stale: false,
      offline: false,
      revoked: false
    })
    expect(dashboard.mentionableUsers).toEqual([])
    expect(dashboard.materialConflicts).toEqual([])
  })

  it('requires complete provenance before a Git import can be cut over', () => {
    const planned = migrationProvenanceRecordSchema.parse({
      schemaVersion: 1,
      revision: 1,
      createdAt: '2026-10-12T00:00:00Z',
      updatedAt: '2026-10-12T00:00:00Z',
      type: 'migration_provenance_record',
      migrationOperationId: 'mig_authority0001',
      objectId: null,
      sourceKind: 'git',
      sourceCommit: 'c'.repeat(40),
      sourcePath: 'results/report.txt',
      sourceSha256: 'f'.repeat(64),
      status: 'planned',
      cutoverAt: null
    })
    expect(planned.status).toBe('planned')
    expect(migrationProvenanceRecordSchema.safeParse({ ...planned, status: 'committed', cutoverAt: '2026-10-12T00:00:01Z' }).success).toBe(false)
    expect(migrationProvenanceRecordSchema.safeParse({
      ...planned,
      objectId: ids.sourceObjectId,
      status: 'committed',
      cutoverAt: '2026-10-12T00:00:01Z'
    }).success).toBe(true)
  })
})
