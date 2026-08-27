import { describe, expect, it } from 'vitest'

import { PostgresCollaborationRepository, type SqlConnection, type SqlPool } from './postgres.js'
import { CollaborationService } from './service.js'

describe('PostgreSQL production transaction path', () => {
  it('fences stale managed-container completions by claim attempt inside one transaction', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.includes('UPDATE sciforge_collaboration.managed_provider_container_jobs')) {
          return { rows: [], rowCount: 0 }
        }
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const pool: SqlPool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    }
    const repository = new PostgresCollaborationRepository(pool)
    const at = '2026-08-15T02:00:00.000Z'
    await expect(repository.completeManagedContainerJob({
      jobId: 'mcj_123456789012', workerId: 'mcw_123456789012', expectedAttemptCount: 2,
      container: {
        managedContainerId: 'mco_123456789012', ownerUserId: 'usr_123456789012',
        humanEndpointId: 'hep_123456789012', provider: 'fake', realmId: 'realm-1',
        ownerProviderUserId: '42', stableKey: 'managed-owner-realm', displayName: 'sciforge-owner',
        externalContainerId: 'owner-channel', policy: {
          version: 1, visibility: 'private', history: 'protected', membership: 'owner_and_message_bot',
          memberManagement: 'provisioning_service_only', channelManagement: 'provisioning_service_only',
          ownerCanSend: true, ownerCanCreateTopics: true, messageBotCanSend: true,
          messageBotCreatesProjectTopics: false
        },
        status: 'active', revision: 3, createdAt: at, updatedAt: at
      },
      expectedContainerRevision: 2,
      completedAt: at
    })).rejects.toMatchObject({ code: 'revision_conflict' })

    const fenced = queries.find(({ text }) => text.includes('managed_provider_container_jobs'))
    expect(fenced?.text).toContain('attempt_count = $4')
    expect(fenced?.values).toEqual(['mcj_123456789012', 'mcw_123456789012', at, 2])
    expect(queries.at(-1)?.text).toBe('ROLLBACK')
  })

  it('binds inbox expiry before LIMIT using PostgreSQL-compatible parameter types', async () => {
    const captured: Array<{ text: string; values: readonly unknown[] }> = []
    const pool: SqlPool = {
      query: async (text, values = []) => {
        captured.push({ text, values })
        if (text.includes('FROM sciforge_collaboration.inbox_messages')) {
          if (typeof values[3] !== 'string' || !Number.isFinite(new Date(values[3]).valueOf())) {
            throw Object.assign(new Error('invalid input syntax for type timestamp with time zone'), { code: '22007' })
          }
          if (!Number.isSafeInteger(values[4]) || Number(values[4]) < 1) {
            throw Object.assign(new Error('invalid input syntax for type bigint'), { code: '22P02' })
          }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => { throw new Error('read path must not open a transaction') },
      end: async () => undefined
    }
    const repository = new PostgresCollaborationRepository(pool)
    const now = '2026-08-15T02:00:00.000Z'

    await expect(repository.pullInbox({ kind: 'agent', id: 'agn_123456789012' }, 7, 25, now))
      .resolves.toEqual([])

    const query = captured.find(({ text }) => text.includes('FROM sciforge_collaboration.inbox_messages'))
    expect(query?.values).toEqual(['agent', 'agn_123456789012', 7, now, 25])
  })

  it('creates an OIDC-owned endpoint challenge without sending a NUL-containing advisory lock key', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        for (const value of values) {
          if (typeof value === 'string' && value.includes('\u0000')) {
            throw new Error('PostgreSQL text parameters reject NUL bytes.')
          }
        }
        queries.push({ text, values })
        if (text.includes('FROM sciforge_collaboration.user_principals')) {
          return { rows: [{ user_id: 'usr_123456789012', display_name: 'OIDC User', status: 'active', revision: 1,
            created_at: new Date('2026-08-15T02:00:00.000Z'), updated_at: new Date('2026-08-15T02:00:00.000Z'),
            revoked_at: null }], rowCount: 1 }
        }
        if (text.includes('INSERT INTO sciforge_collaboration.endpoint_challenge_rate_windows')) {
          return { rows: [{
            user_id: values[0], provider: values[1], realm_id: values[2],
            window_started_at: new Date(String(values[3])), expires_at: new Date(String(values[4])),
            attempt_count: 1, revision: 1, updated_at: new Date(String(values[6]))
          }], rowCount: 1 }
        }
        return { rows: [], rowCount: text.startsWith('SELECT * FROM sciforge_collaboration.receipts') ? 0 : 1 }
      },
      release: () => undefined
    }
    const pool: SqlPool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    }
    const service = new CollaborationService({
      repository: new PostgresCollaborationRepository(pool),
      now: () => new Date('2026-08-15T02:00:00.000Z')
    })

    const actor = { kind: 'user' as const, authentication: 'oidc' as const, actorKey: 'oidc:oid_123456789012',
      userId: 'usr_123456789012', identityId: 'oid_123456789012', issuer: 'https://identity.test',
      subject: 'subject-123', authTime: 1_755_220_800, expiresAt: 1_755_224_400,
      assurance: 'verified' as const }
    const begun = await service.createEndpointChallenge(actor, {
      provider: 'fake-im',
      realmId: 'fake-realm',
      expectedProviderUserId: 'provider-user-01',
      idempotencyKey: 'idem_postgres_pairing_begin_01'
    })

    expect(begun).toMatchObject({ type: 'endpoint.challenge.created' })
    expect(typeof begun.challengeCode).toBe('string')
    expect(begun).not.toHaveProperty('pollSecret')
    const advisory = queries.find(({ text }) => text.includes('pg_advisory_xact_lock'))
    expect(advisory?.values).toHaveLength(1)
    expect(String(advisory?.values[0])).not.toContain('\u0000')
    expect(JSON.parse(String(advisory?.values[0]))).toEqual([
      actor.actorKey,
      'idem_postgres_pairing_begin_01'
    ])
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.human_endpoint_challenges'))).toBe(true)
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.audit_events'))).toBe(true)
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.receipts'))).toBe(true)
    expect(queries.at(-1)?.text).toBe('COMMIT')
  })

  it('reads pending endpoint challenge status by OIDC User without a poll-secret column or write', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const challengeRow = {
      challenge_id: 'chl_123456789012', requested_user_id: 'usr_123456789012', provider: 'fake-im', realm_id: 'fake-realm',
      expected_provider_user_id: 'provider-user-01', challenge_digest: Buffer.alloc(32, 1),
      expires_at: new Date('2026-08-15T02:10:00.000Z'), verified_user_id: null,
      verified_endpoint_id: null, verified_at: null,
      created_at: new Date('2026-08-15T02:00:00.000Z')
    }
    const pool: SqlPool = { query: async (text, values = []) => {
      queries.push({ text, values })
      return text.includes('human_endpoint_challenges')
        ? { rows: [challengeRow], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }, connect: async () => { throw new Error('pending challenge read must not start a transaction') },
    end: async () => undefined }
    const service = new CollaborationService({ repository: new PostgresCollaborationRepository(pool),
      now: () => new Date('2026-08-15T02:00:00.000Z') })

    const pending = await service.getEndpointChallenge({ kind: 'user', authentication: 'oidc',
      actorKey: 'oidc:oid_123456789012', userId: 'usr_123456789012', identityId: 'oid_123456789012',
      issuer: 'https://identity.test', subject: 'subject-123', authTime: 1_755_220_800,
      expiresAt: 1_755_224_400, assurance: 'verified' }, challengeRow.challenge_id)

    expect(pending).toMatchObject({ type: 'endpoint.challenge.pending', challengeId: challengeRow.challenge_id })
    expect(queries).toHaveLength(1)
    expect(queries[0]?.text).not.toMatch(/poll_secret|requested_display_name|consumed_at/u)
  })

  it('atomically consumes a durable endpoint challenge rate window', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const now = '2026-08-24T05:00:00.000Z'
    const expiresAt = '2026-08-24T05:05:00.000Z'
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.includes('INSERT INTO sciforge_collaboration.endpoint_challenge_rate_windows')) {
          return { rows: [{ user_id: 'usr_RateWindow001', provider: 'opencontent', realm_id: 'run0',
            window_started_at: new Date(now), expires_at: new Date(expiresAt), attempt_count: 1,
            revision: 1, updated_at: new Date(now) }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })

    await expect(repository.transaction((tx) => tx.consumeEndpointChallengeRateWindow({
      userId: 'usr_RateWindow001', provider: 'opencontent', realmId: 'run0',
      windowStartedAt: now, expiresAt, maxAttempts: 5, updatedAt: now
    }))).resolves.toMatchObject({ allowed: true, window: { attemptCount: 1, revision: 1 } })

    const consume = queries.find(({ text }) => text.includes('endpoint_challenge_rate_windows AS rate_window'))
    expect(consume?.text).toContain('ON CONFLICT (user_id,provider,realm_id,window_started_at) DO UPDATE')
    expect(consume?.text).toContain('rate_window.attempt_count<$6')
    expect(consume?.values).toEqual(['usr_RateWindow001', 'opencontent', 'run0', now, expiresAt, 5, now])
  })

  it('persists only factual provisioning binding metadata and no authorization proof', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })
    const at = '2026-08-24T05:00:00.000Z'
    await repository.transaction((tx) => tx.upsertProjectContentSpaceBinding({
      projectContentBindingId: 'pcb_Binding000001', projectId: 'prj_Binding000001',
      contentOwnerUserId: 'usr_BindingOwner01', providerInstance: {
        schemaVersion: 1, type: 'provider_instance_reference', providerInstanceRef: 'opencontent.run0'
      },
      rootLocator: {
        contractVersion: 1, kind: 'content-space.container-reference', authority: 'opencontent.run0',
        identity: { directoryId: 'candidate-root' }
      },
      rootLocatorDigest: '0'.repeat(64), provisioningIntentId: 'pci_Binding000001',
      provisioningRevision: 1, attestationId: null, attestationDigest: null,
      status: 'provisioning', statusReason: 'provisioning_incomplete', activatedAt: null,
      degradedAt: null, closedAt: null, revision: 1, createdAt: at, updatedAt: at
    }, null))

    const write = queries.find(({ text }) => text.includes('project_content_space_bindings') && text.includes('INSERT'))
    expect(write?.text).toContain('attestation_id')
    expect(write?.text).not.toMatch(/authorization|scope|expires_at/u)
  })

  it('persists a global User and Provider Instance directory fact without Project or authority fields', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 0 }
      },
      connect: async () => connection,
      end: async () => undefined
    })
    const at = '2026-08-24T05:00:00.000Z'
    const providerInstance = {
      schemaVersion: 1 as const, type: 'provider_instance_reference' as const,
      providerInstanceRef: 'opencontent.run0'
    }
    await repository.transaction((tx) => tx.insertProviderDirectoryPrincipalFact({
      providerPrincipalFactId: 'ppf_Global0000001', userId: 'usr_Global0000001',
      providerPrincipal: { schemaVersion: 1, type: 'provider_directory_principal_reference',
        providerInstance, principalKind: 'user', principalId: 'provider-user-1' },
      principalIdentityRevision: 1, providerBindingAttestationDigest: 'a'.repeat(64),
      publishedByDeviceId: 'dev_Global0000001', readiness: 'ready', readinessReason: null,
      observedAt: at, revision: 1, createdAt: at, updatedAt: at
    }))
    await repository.listProviderDirectoryPrincipalFacts({
      userIds: ['usr_Global0000001'], providerInstance, includeDegraded: false,
      afterFactId: null, limit: 25
    })

    const write = queries.find(({ text }) => text.includes('INSERT INTO sciforge_collaboration.provider_directory_principal_facts'))
    expect(write?.text).toContain('provider_principal_fact_id')
    expect(write?.text).not.toMatch(/project_id|authorization|credential|secret|scope/u)
    const list = queries.find(({ text }) => text.includes('user_id=ANY'))
    expect(list?.text).toContain("provider_principal->'providerInstance'->>'providerInstanceRef'")
    expect(list?.text).toContain("readiness='ready'")
    expect(list?.values).toEqual([
      ['usr_Global0000001'], 'opencontent.run0', false, null, 25
    ])
  })

  it('persists canonical ProjectRecord provenance in the same transaction as the Coordinator write', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })
    const at = '2026-08-24T05:00:00.000Z'

    await repository.transaction((tx) => tx.insertProjectRecord({
      projectRecordId: 'rec_Observation0001', projectId: 'prj_RecordProject01',
      kind: 'observation', status: 'accepted', summary: 'Accepted Worker result.',
      authorUserId: 'usr_RecordOwner001', authorAgentId: 'agt_RecordCoord001',
      sourceTaskId: 'tsk_RecordTask0001', sourceResultSubmissionId: 'rsu_RecordResult001',
      sourceRevision: 1, acceptedByUserId: 'usr_RecordOwner001',
      acceptedByAgentId: 'agt_RecordCoord001', acceptedAt: at,
      revision: 1, createdAt: at, updatedAt: at
    }))

    const insert = queries.find(({ text }) => text.includes('INSERT INTO sciforge_collaboration.project_records'))
    expect(insert?.text).toContain('source_result_submission_id,source_human_answer_id,source_revision')
    expect(insert?.values.slice(7, 11)).toEqual([
      'tsk_RecordTask0001', 'rsu_RecordResult001', null, 1
    ])
    expect(insert?.values.slice(11, 14)).toEqual([
      'usr_RecordOwner001', 'agt_RecordCoord001', at
    ])
    expect(queries.at(-1)?.text).toBe('COMMIT')
  })

  it('persists one HumanNeeded scope shape and exactly one authenticated HumanAnswer source', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })
    const observedAt = '2026-08-24T05:00:00.000Z'
    const expiresAt = '2026-08-24T05:05:00.000Z'

    await repository.transaction(async (tx) => {
      await tx.insertHumanRequest({
        humanRequestId: 'hrq_WorkerRequest01', projectId: 'prj_HumanProject01',
        context: { scope: 'worker_execution', taskId: 'tsk_HumanTask0001', executionId: 'exe_HumanExec0001' },
        targetUserId: 'usr_HumanOwner001', requestedByAgentId: 'agt_HumanWorker01',
        requiredAssurance: 'verified', prompt: 'Confirm Worker input.', confirmableAction: null,
        status: 'pending', revision: 1, expiresAt, createdAt: observedAt, updatedAt: observedAt
      })
      await tx.insertHumanRequest({
        humanRequestId: 'hrq_CoordRequest001', projectId: 'prj_HumanProject01',
        context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: 3 },
        targetUserId: 'usr_HumanOwner001', requestedByAgentId: 'agt_HumanCoord001',
        requiredAssurance: 'verified', prompt: 'Confirm Project decision.', confirmableAction: null,
        status: 'pending', revision: 1, expiresAt, createdAt: observedAt, updatedAt: observedAt
      })
      await tx.insertHumanAnswer({
        humanAnswerId: 'han_CoordAnswer001', humanRequestId: 'hrq_CoordRequest001',
        projectId: 'prj_HumanProject01',
        context: { scope: 'coordinator_project', coordinatorAuthorityEpoch: 3 }, requestRevision: 1,
        answeredByUserId: 'usr_HumanOwner001',
        answeredFrom: { type: 'human_endpoint', humanEndpointId: 'hep_HumanOwner001' },
        assurance: 'verified', answer: 'Proceed.', decision: null, confirmationId: null,
        revision: 1, answeredAt: observedAt, createdAt: observedAt, updatedAt: observedAt
      })
    })

    const requests = queries.filter(({ text }) => text.includes('INSERT INTO sciforge_collaboration.human_requests'))
    expect(requests[0]?.values.slice(2, 6)).toEqual([
      'worker_execution', 'tsk_HumanTask0001', 'exe_HumanExec0001', null
    ])
    expect(requests[1]?.values.slice(2, 6)).toEqual([
      'coordinator_project', null, null, 3
    ])
    const answer = queries.find(({ text }) => text.includes('INSERT INTO sciforge_collaboration.human_answers'))
    expect(answer?.values.slice(3, 11)).toEqual([
      'coordinator_project', null, null, 3, 1, 'usr_HumanOwner001', null, 'hep_HumanOwner001'
    ])
    expect(queries.at(-1)?.text).toBe('COMMIT')
  })

  it('uses the final immutable revision names for content readiness, recovery, resources and results', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }), connect: async () => connection,
      end: async () => undefined
    })
    const at = '2026-08-24T05:00:00.000Z'
    const providerInstance = {
      schemaVersion: 1 as const, type: 'provider_instance_reference' as const,
      providerInstanceRef: 'opencontent.run0'
    }
    const locator = {
      contractVersion: 1 as const, kind: 'content-space.file-reference' as const,
      authority: 'opencontent.run0', identity: { fileId: 'output-one' }
    }

    await repository.transaction(async (tx) => {
      await tx.upsertProjectContentReadiness({
        projectId: 'prj_FinalNames0001', userId: 'usr_FinalNames0001', providerInstance,
        state: 'missing_identity', reason: 'identity_missing', providerPrincipalFactId: null,
        snapshottedFactRevision: null, providerPrincipal: null, bindingRevision: null,
        lastObservationId: null, effectiveAt: at, revision: 1, createdAt: at, updatedAt: at
      }, null)
      await tx.insertExternalOperationJournal({
        contentRecoveryJournalEntryId: 'crj_FinalNames0001', scope: 'task_content_transfer',
        logicalInvocationId: 'logical-final-names-1', projectId: 'prj_FinalNames0001',
        taskId: 'tsk_FinalNames0001', preparedTaskRevision: 2, provisioningIntentId: null,
        provisioningRevision: null, executionId: 'exe_FinalNames0001', preparedExecutionRevision: 1,
        operation: 'download', requestDigest: '1'.repeat(64), state: 'prepared',
        observationDigest: null, receiptDigest: null, safeFailureCode: null, preparedAt: at,
        dispatchedAt: null, resolvedAt: null, revision: 1, createdAt: at, updatedAt: at
      })
      await tx.insertCloudResourceRefs([{
        resourceRefId: 'rrf_FinalNames0001', projectId: 'prj_FinalNames0001',
        taskId: 'tsk_FinalNames0001', executionId: 'exe_FinalNames0001', assignmentTaskRevision: 2,
        bindingRevision: 1, intentDigest: '2'.repeat(64), role: 'output-file', ordinal: 0,
        locator, locatorDigest: '3'.repeat(64), status: 'available', invalidatedAt: null,
        revision: 1, createdAt: at, updatedAt: at
      }])
      await tx.insertTaskResultSubmission({
        resultSubmissionId: 'rsu_FinalNames0001', projectId: 'prj_FinalNames0001',
        taskId: 'tsk_FinalNames0001', executionId: 'exe_FinalNames0001',
        submittedTaskRevision: 3, submittedExecutionRevision: 2,
        submittedByUserId: 'usr_FinalNames0001', submittedByAgentId: 'agn_FinalNames0001',
        summary: 'Synthetic result', runtimeProvenance: {
          runtimeId: 'runtime-final-names', modelId: null, startedAt: at, completedAt: at
        }, outputs: [], recoveryJournalEntryIds: ['crj_FinalNames0001'],
        submissionDigest: '4'.repeat(64), submittedAt: at, revision: 1, createdAt: at, updatedAt: at
      })
      await tx.insertProjectFinalSummary({
        projectId: 'prj_FinalNames0001', projectRecordId: 'prr_FinalNames0001',
        projectPlanId: 'ppl_FinalNames0001', confirmedPlanRevision: 1,
        acceptedResultSubmissionIds: ['rsu_FinalNames0001'], summary: 'Synthetic final summary',
        createdByUserId: 'usr_FinalNames0001', createdByCoordinatorAgentId: 'agn_FinalNames0001',
        coordinatorAuthorityEpoch: 1, completedAt: at, revision: 1, createdAt: at, updatedAt: at
      })
    })

    const sql = queries.map(({ text }) => text).join('\n')
    expect(sql).toContain('provider_instance')
    expect(sql).toContain('prepared_task_revision')
    expect(sql).toContain('prepared_execution_revision')
    expect(sql).toContain('assignment_task_revision')
    expect(sql).toContain('submitted_task_revision')
    expect(sql).toContain('submitted_execution_revision')
    expect(sql).not.toContain('integrity_verified')
    expect(sql).not.toMatch(/\btask_revision\b/u)
    expect(sql).not.toMatch(/\bexecution_revision\b/u)
  })

  it('reads and CAS-updates contract-shaped visible recovery actions by exact durable identifiers', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const at = '2026-08-24T05:00:00.000Z'
    const actionRow = {
      recovery_action_id: 'rca_Visible000001', project_id: 'prj_Visible000001',
      task_id: 'tsk_Visible000001', execution_id: 'exe_Visible000001',
      journal_entry_id: 'crj_Visible000001', audience: 'coordinator',
      action: 'reconcile_exact_output', status: 'available', requires_fresh_observation: true,
      safe_summary: 'Reconcile the exact output before choosing a terminal action.',
      available_at: new Date(at), completed_at: null, revision: 1,
      created_at: new Date(at), updated_at: new Date(at)
    }
    const query = async (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values })
      if (text.includes('FROM sciforge_collaboration.visible_recovery_actions')) {
        return { rows: [actionRow], rowCount: 1 }
      }
      return { rows: [], rowCount: text === 'BEGIN' || text === 'COMMIT' ? null : 1 }
    }
    const connection: SqlConnection = { query, release: () => undefined }
    const repository = new PostgresCollaborationRepository({
      query, connect: async () => connection, end: async () => undefined
    })

    const expected = {
      recoveryActionId: 'rca_Visible000001', projectId: 'prj_Visible000001',
      taskId: 'tsk_Visible000001', executionId: 'exe_Visible000001',
      journalEntryId: 'crj_Visible000001', audience: 'coordinator' as const,
      action: 'reconcile_exact_output' as const, status: 'available' as const,
      requiresFreshObservation: true,
      safeSummary: 'Reconcile the exact output before choosing a terminal action.',
      availableAt: at, completedAt: null, revision: 1, createdAt: at, updatedAt: at
    }
    await expect(repository.getVisibleRecoveryAction(expected.recoveryActionId)).resolves.toEqual(expected)
    await expect(repository.listVisibleRecoveryActionsByProject(expected.projectId)).resolves.toEqual([expected])
    await expect(repository.getExternalOperationJournalById(expected.journalEntryId)).resolves.toBeNull()

    await repository.transaction(async (tx) => {
      await expect(tx.getVisibleRecoveryActionForUpdate(expected.recoveryActionId)).resolves.toEqual(expected)
      await expect(tx.getExternalOperationJournalByIdForUpdate(expected.journalEntryId)).resolves.toBeNull()
      await tx.insertVisibleRecoveryAction(expected)
      await tx.updateVisibleRecoveryAction({
        ...expected, status: 'completed', completedAt: at, revision: 2, updatedAt: at
      }, 1)
    })

    expect(queries.find(({ text }) => (
      text.includes('visible_recovery_actions') && text.includes('FOR UPDATE')
    ))?.values).toEqual([expected.recoveryActionId])
    expect(queries.find(({ text }) => (
      text.includes('external_operation_journal') && text.includes('content_recovery_journal_entry_id=$1') &&
      text.includes('FOR UPDATE')
    ))?.values).toEqual([expected.journalEntryId])
    const insert = queries.find(({ text }) => text.includes('INSERT INTO sciforge_collaboration.visible_recovery_actions'))
    expect(insert?.text).not.toMatch(/credential|secret|authorization/u)
    const update = queries.find(({ text }) => text.includes('UPDATE sciforge_collaboration.visible_recovery_actions'))
    expect(update?.text).toContain('WHERE recovery_action_id=$1 AND revision=$6 AND $4=$6+1')
    expect(update?.text).not.toMatch(
      /SET[\s\S]*(journal_entry_id|project_id|task_id|execution_id|audience|action|requires_fresh_observation|safe_summary)=/u
    )
  })

  it('rolls back a stale visible recovery action CAS without a second write path', async () => {
    const queries: string[] = []
    const at = '2026-08-24T05:00:00.000Z'
    const connection: SqlConnection = {
      query: async (text) => {
        queries.push(text)
        return { rows: [], rowCount: text.includes('UPDATE sciforge_collaboration.visible_recovery_actions')
          ? 0
          : 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }), connect: async () => connection,
      end: async () => undefined
    })

    await expect(repository.transaction((tx) => tx.updateVisibleRecoveryAction({
      recoveryActionId: 'rca_Stale0000001', projectId: 'prj_Stale0000001',
      taskId: null, executionId: null, journalEntryId: 'crj_Stale0000001', audience: 'owner',
      action: 'resume_provisioning', status: 'completed', requiresFreshObservation: false,
      safeSummary: 'Resume provisioning after an exact Provider reconcile.', availableAt: at,
      completedAt: at, revision: 2, createdAt: at, updatedAt: at
    }, 1))).rejects.toMatchObject({ code: 'revision_conflict' })

    expect(queries.filter((text) => text.includes('UPDATE sciforge_collaboration.visible_recovery_actions')))
      .toHaveLength(1)
    expect(queries.at(-1)).toBe('ROLLBACK')
  })

  it('seek-pages canonical Project, Task, and HumanNeeded facts by stable IDs', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const at = new Date('2026-08-24T05:00:00.000Z')
    const projectRow = {
      project_id: 'prj_Page00000002', owner_user_id: 'usr_PageOwner0001',
      display_name: 'Page two', goal: 'Verify bounded reads', status: 'completed',
      coordinator_agent_id: 'agn_PageCoord0001', max_tasks: 20, max_tasks_per_round: 5,
      max_task_retries: 2, max_coordination_rounds: 4, coordination_round: 1,
      revision: 3, created_at: at, updated_at: at, content_mode: 'none',
      coordinator_authority_epoch: 1, execution_authority_epoch: 2, content_owner_user_id: null
    }
    const taskRow = {
      task_id: 'tsk_Page00000002', project_id: projectRow.project_id,
      title: 'Historical task', objective: 'Remain visible after completion',
      completion_criteria: ['reviewed'], dependency_task_ids: [], status: 'completed', max_retries: 2,
      coordination_round: 1, revision: 3, created_at: at, updated_at: at, completed_at: at,
      file_intent: null, created_by_coordinator_agent_id: projectRow.coordinator_agent_id,
      current_execution_id: 'exe_Page00000002', current_execution_state: 'completed', execution_count: 1
    }
    const requestRow = {
      human_request_id: 'hur_Page00000002', project_id: projectRow.project_id,
      task_id: taskRow.task_id, execution_id: taskRow.current_execution_id,
      request_scope: 'worker_execution', coordinator_authority_epoch: null,
      target_user_id: 'usr_PageWorker001', requested_by_agent_id: projectRow.coordinator_agent_id,
      required_assurance: 'verified', prompt: 'Confirm the synthetic result.', confirmable_action: null,
      status: 'pending', revision: 1, expires_at: at, created_at: at, updated_at: at
    }
    const pool: SqlPool = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.includes('FROM sciforge_collaboration.projects AS project')) {
          return { rows: [projectRow], rowCount: 1 }
        }
        if (text.includes('FROM sciforge_collaboration.tasks')) return { rows: [taskRow], rowCount: 1 }
        if (text.includes('FROM sciforge_collaboration.human_requests')) {
          return { rows: [requestRow], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => { throw new Error('canonical reads must not start a transaction') },
      end: async () => undefined
    }
    const repository = new PostgresCollaborationRepository(pool)

    await expect(repository.listProjectsForUser(
      'usr_PageWorker001', 'prj_Page00000001', 26
    )).resolves.toMatchObject([{ projectId: projectRow.project_id, status: 'completed' }])
    await expect(repository.listTasksByProject(
      projectRow.project_id, 'tsk_Page00000001', 51
    )).resolves.toMatchObject([{ taskId: taskRow.task_id, status: 'completed' }])
    await expect(repository.listHumanRequestsByProject(
      projectRow.project_id, 'pending', 'hur_Page00000001', 26
    )).resolves.toMatchObject([{ humanRequestId: requestRow.human_request_id, status: 'pending' }])
    await repository.listHumanRequestsByProject(projectRow.project_id, null, null, 26)
    await expect(repository.listTaskExecutionsByProject(
      projectRow.project_id, 'exe_Page00000001', 51
    )).resolves.toEqual([])
    await expect(repository.listTaskOffersByProject(
      projectRow.project_id, 'tof_Page00000001', 51
    )).resolves.toEqual([])
    await expect(repository.listTaskResultSubmissionsByProject(
      projectRow.project_id, 'rsu_Page00000001', 51
    )).resolves.toEqual([])
    await expect(repository.listTaskResultReviewsByProject(
      projectRow.project_id, 'trv_Page00000001', 51
    )).resolves.toEqual([])

    const projects = queries.find(({ text }) => text.includes('FROM sciforge_collaboration.projects AS project'))
    expect(projects?.text).toContain('UNION')
    expect(projects?.text).toContain('owner_user_id=$1')
    expect(projects?.text).toContain('member.user_id=$1')
    expect(projects?.text).toContain("member.state IN ('active','membership_removal_pending')")
    expect(projects?.text).not.toMatch(/member\.state IN \([^)]*'removed'/u)
    expect(projects?.text).not.toMatch(/member\.state IN \([^)]*'pending_membership'/u)
    expect(projects?.text).not.toMatch(/(?:project|owned)\.status/u)
    expect(projects?.text).toContain('ORDER BY project.project_id ASC LIMIT $3')
    expect(projects?.values).toEqual(['usr_PageWorker001', 'prj_Page00000001', 26])
    const tasks = queries.find(({ text }) => text.includes('FROM sciforge_collaboration.tasks'))
    expect(tasks?.text).toContain('task_id>COALESCE($2::text')
    expect(tasks?.text).toContain('ORDER BY task_id ASC LIMIT $3')
    expect(tasks?.values).toEqual([projectRow.project_id, 'tsk_Page00000001', 51])
    const filteredHuman = queries.find(({ text, values }) => (
      text.includes('FROM sciforge_collaboration.human_requests') && values.length === 4
    ))
    expect(filteredHuman?.text).toContain('status=$2')
    expect(filteredHuman?.text).toContain('ORDER BY human_request_id ASC LIMIT $4')
    expect(filteredHuman?.values).toEqual([projectRow.project_id, 'pending', 'hur_Page00000001', 26])
    const allHuman = queries.find(({ text, values }) => (
      text.includes('FROM sciforge_collaboration.human_requests') && values.length === 3
    ))
    expect(allHuman?.text).not.toContain('status=')
    expect(allHuman?.values).toEqual([projectRow.project_id, null, 26])
    for (const [table, idColumn, afterId] of [
      ['task_executions', 'execution_id', 'exe_Page00000001'],
      ['task_offers', 'task_offer_id', 'tof_Page00000001'],
      ['task_result_submissions', 'result_submission_id', 'rsu_Page00000001'],
      ['task_result_reviews', 'review_decision_id', 'trv_Page00000001']
    ] as const) {
      const page = queries.find(({ text }) => text.includes(`FROM sciforge_collaboration.${table}`))
      expect(page?.text).toContain(`${idColumn}>COALESCE($2::text`)
      expect(page?.text).toContain(`ORDER BY ${idColumn} ASC LIMIT $3`)
      expect(page?.values).toEqual([projectRow.project_id, afterId, 51])
    }
  })

  it('locks only current executions assigned to one exact Device during Device revoke', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        return { rows: [], rowCount: text === 'BEGIN' || text === 'COMMIT' ? null : 0 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }), connect: async () => connection,
      end: async () => undefined
    })
    await expect(repository.transaction((tx) => (
      tx.listCurrentTaskExecutionsForDeviceForUpdate('dev_Revoke000001')
    ))).resolves.toEqual([])

    const lock = queries.find(({ text }) => text.includes('FOR UPDATE OF execution,task'))
    expect(lock?.text).toContain('execution.assignee_device_id=$1')
    expect(lock?.text).not.toMatch(/owner_user_id|task_authorities/u)
    expect(lock?.values).toEqual(['dev_Revoke000001'])
  })

  it('commits execution and offer CAS transitions with audit, inbox and receipt in one transaction', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.includes('RETURNING next_sequence-1 AS next_sequence')) {
          return { rows: [{ next_sequence: 1 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const repository = new PostgresCollaborationRepository({
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    })
    const at = '2026-08-24T05:00:00.000Z'
    const expiresAt = '2026-08-24T05:30:00.000Z'
    const sequence = await repository.transaction(async (tx) => {
      await tx.updateTaskExecution({
        executionId: 'exe_Event0000001', taskId: 'tsk_Event0000001', projectId: 'prj_Event0000001',
        attempt: 1, offeredByCoordinatorAgentId: 'agn_Coordinator01', assigneeUserId: 'usr_Worker000001',
        assigneeAgentId: 'agn_Worker000001', assigneeDeviceId: 'dev_Worker000001', state: 'accepted',
        stateRevision: 2, fence: {
          schemaVersion: 1, executionId: 'exe_Event0000001', assigneeUserId: 'usr_Worker000001',
          assigneeAgentId: 'agn_Worker000001', assigneeDeviceId: 'dev_Worker000001', assignmentTaskRevision: 1,
          projectExecutionAuthorityEpoch: 1, userTaskAuthorityEpoch: 1, bindingRevision: null,
          status: 'open', reason: null, fencedAt: null
        }, fileIntent: null, currentResultSubmissionId: null, offeredAt: at, acceptedAt: at,
        startedAt: null, terminalAt: null, revision: 2, createdAt: at, updatedAt: at
      }, 1)
      await tx.updateTaskOffer({
        taskOfferId: 'tof_Event0000001', executionId: 'exe_Event0000001',
        taskId: 'tsk_Event0000001', projectId: 'prj_Event0000001',
        assigneeUserId: 'usr_Worker000001', assigneeAgentId: 'agn_Worker000001',
        assigneeDeviceId: 'dev_Worker000001', state: 'accepted', offeredAt: at, expiresAt,
        respondedAt: at, rejectionReason: null, safeReasonDetail: null, revision: 2,
        createdAt: at, updatedAt: at
      }, 1)
      await tx.insertAudit({
        auditEventId: 'aud_Event0000001', actorKind: 'agent', actorUserId: 'usr_Worker000001',
        actorAgentId: 'agn_Worker000001', action: 'task.execution.transition',
        resourceKind: 'task_execution', resourceId: 'exe_Event0000001', outcome: 'accepted',
        metadata: { fromState: 'offered', toState: 'accepted', fromRevision: 1, toRevision: 2 }, createdAt: at
      })
      const message = await tx.appendInbox({
        recipient: { kind: 'agent', id: 'agn_Coordinator01' }, messageId: 'msg_Event0000001',
        messageType: 'task.execution.accepted', payload: { executionId: 'exe_Event0000001', stateRevision: 2 },
        createdAt: at, expiresAt
      })
      await tx.insertReceipt({
        receiptId: 'rcp_Event0000001', actorKey: 'agent:agn_Worker000001',
        idempotencyKey: 'idem_Event0000001', requestDigest: '00'.repeat(32),
        operation: 'task.offer.accept', resourceKind: 'task_execution', resourceId: 'exe_Event0000001',
        response: { executionId: 'exe_Event0000001', stateRevision: 2 }, createdAt: at, expiresAt
      })
      return message.sequence
    })

    expect(sequence).toBe(1)
    const commit = queries.findIndex(({ text }) => text === 'COMMIT')
    for (const marker of [
      'UPDATE sciforge_collaboration.task_executions',
      'UPDATE sciforge_collaboration.task_offers',
      'INSERT INTO sciforge_collaboration.audit_events',
      'INSERT INTO sciforge_collaboration.inbox_messages',
      'INSERT INTO sciforge_collaboration.receipts'
    ]) {
      const index = queries.findIndex(({ text }) => text.includes(marker))
      expect(index).toBeGreaterThan(queries.findIndex(({ text }) => text === 'BEGIN'))
      expect(index).toBeLessThan(commit)
    }
    expect(queries.find(({ text }) => text.includes('UPDATE sciforge_collaboration.task_executions'))?.text)
      .toContain('AND $9=$11+1 AND $3=$11+1')
    expect(queries.find(({ text }) => text.includes('UPDATE sciforge_collaboration.task_offers'))?.text)
      .toContain('WHERE task_offer_id=$1 AND revision=$8 AND $6=$8+1')
    expect(queries.some(({ text }) => text.includes('task_execution_events'))).toBe(false)
  })
})
