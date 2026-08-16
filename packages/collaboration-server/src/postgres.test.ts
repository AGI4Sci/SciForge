import { describe, expect, it } from 'vitest'

import { digestSecret } from './crypto.js'
import { PostgresCollaborationRepository, type SqlConnection, type SqlPool } from './postgres.js'
import { CollaborationService } from './service.js'

describe('PostgreSQL production transaction path', () => {
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

  it('begins pairing without sending a NUL-containing advisory lock key', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        for (const value of values) {
          if (typeof value === 'string' && value.includes('\u0000')) {
            throw new Error('PostgreSQL text parameters reject NUL bytes.')
          }
        }
        queries.push({ text, values })
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

    const begun = await service.beginPairing({
      provider: 'fake-im',
      realmId: 'fake-realm',
      requestedDisplayName: 'PostgreSQL Pairing User',
      idempotencyKey: 'idem_postgres_pairing_begin_01'
    })

    expect(begun).toMatchObject({ type: 'pairing.begun' })
    expect(typeof begun.challengeCode).toBe('string')
    expect(typeof begun.pollSecret).toBe('string')
    const advisory = queries.find(({ text }) => text.includes('pg_advisory_xact_lock'))
    expect(advisory?.values).toHaveLength(1)
    expect(String(advisory?.values[0])).not.toContain('\u0000')
    expect(JSON.parse(String(advisory?.values[0]))).toEqual([
      expect.stringMatching(/^anonymous-pairing:/u),
      'idem_postgres_pairing_begin_01'
    ])
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.human_endpoint_challenges'))).toBe(true)
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.audit_events'))).toBe(true)
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.receipts'))).toBe(true)
    expect(queries.at(-1)?.text).toBe('COMMIT')
  })

  it('audits a pending pairing redeem without inserting a terminal receipt', async () => {
    const pollSecret = ['pairing', 'poll', 'INVALID', 'TEST', 'ONLY', 'x'.repeat(32)].join('_')
    const pollDigest = digestSecret(pollSecret)
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const challengeRow = {
      challenge_id: 'chl_123456789012', requested_user_id: null, provider: 'fake-im', realm_id: 'fake-realm',
      expected_provider_user_id: null, challenge_digest: Buffer.alloc(32, 1),
      poll_secret_digest: Buffer.from(pollDigest, 'hex'), requested_display_name: 'Pending User',
      expires_at: new Date('2026-08-15T02:10:00.000Z'), verified_user_id: null,
      verified_endpoint_id: null, verified_at: null, consumed_at: null,
      created_at: new Date('2026-08-15T02:00:00.000Z')
    }
    const connection: SqlConnection = {
      query: async (text, values = []) => {
        queries.push({ text, values })
        if (text.includes('FROM sciforge_collaboration.receipts')) return { rows: [], rowCount: 0 }
        if (text.includes('WHERE poll_secret_digest=$1')) return { rows: [challengeRow], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      },
      release: () => undefined
    }
    const pool: SqlPool = { query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection, end: async () => undefined }
    const service = new CollaborationService({ repository: new PostgresCollaborationRepository(pool),
      now: () => new Date('2026-08-15T02:00:00.000Z') })

    const pending = await service.redeemPairing({ pollSecret,
      idempotencyKey: 'idem_postgres_pairing_pending_01' })

    expect(pending).toMatchObject({ type: 'pairing.pending', challengeId: challengeRow.challenge_id })
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.audit_events'))).toBe(true)
    expect(queries.some(({ text }) => text.includes('INSERT INTO sciforge_collaboration.receipts'))).toBe(false)
    expect(queries.at(-1)?.text).toBe('COMMIT')
  })
})
