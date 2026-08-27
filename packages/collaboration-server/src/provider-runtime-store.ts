import {
  providerSendResultSchema,
  type ProviderDiagnostic,
  type ProviderLocator,
  type ProviderSendResult
} from '@sciforge/collaboration-contracts'

import { CollaborationServiceError } from './errors.js'
import type { SqlConnection, SqlPool } from './postgres.js'

type SqlRow = Record<string, unknown>

export type ProviderRoutingTarget = Readonly<{
  kind: 'personal_projection' | 'project'
  resourceId: string
  locator: ProviderLocator
}>

export type ProviderDeliveryState = Readonly<{
  result: ProviderSendResult
  attemptCount: number
  terminal: boolean
  nextAttemptAt?: string
}>

const EVENT_CLAIM_LEASE_MS = 10_000
const MAX_DELIVERY_RETRY_MS = 5 * 60_000

/** PostgreSQL-owned operational repository for the provider-neutral gateway. */
export class ProviderRuntimeStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly now: () => Date = () => new Date()
  ) {}

  async claimEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
    dedupeKey: string
  }>): Promise<'claimed' | 'duplicate'> {
    for (;;) {
      const attempt = await this.tryClaimEvent(input)
      if (attempt.status !== 'wait') return attempt.status
      // Do not tell the adapter that an in-flight event is a duplicate: it would
      // advance to a later event and could checkpoint past a crashed handler.
      await delay(Math.max(25, Math.min(attempt.waitMs, 250)))
    }
  }

  async beginEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
    dedupeKey: string
  }>): Promise<
    | { status: 'claimed'; claimEventId: string }
    | { status: 'processed' }
    | { status: 'in_progress' }
  > {
    const attempt = await this.tryClaimEvent(input)
    if (attempt.status === 'claimed') return attempt
    if (attempt.status === 'duplicate') return { status: 'processed' }
    return { status: 'in_progress' }
  }

  private async tryClaimEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
    dedupeKey: string
  }>): Promise<
    | { status: 'claimed'; claimEventId: string }
    | { status: 'duplicate' }
    | { status: 'wait'; waitMs: number }
  > {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const inserted = await connection.query<{ event_id: unknown }>(
        `INSERT INTO sciforge_collaboration.provider_event_claims
         (provider,realm_id,event_id,dedupe_key,event_cursor,state,claimed_at,lease_expires_at)
         VALUES ($1,$2,$3,$4,$5,'claimed',clock_timestamp(),
                 clock_timestamp()+($6::text || ' milliseconds')::interval)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
        [input.provider, input.realmId, input.eventId, input.dedupeKey, input.eventCursor, EVENT_CLAIM_LEASE_MS]
      )
      if ((inserted.rowCount ?? 0) === 1) {
        await connection.query('COMMIT')
        return { status: 'claimed', claimEventId: String(inserted.rows[0]?.event_id) }
      }
      const reclaimed = await connection.query<{ event_id: unknown }>(
        `UPDATE sciforge_collaboration.provider_event_claims
         SET event_cursor=$4,claimed_at=clock_timestamp(),
             lease_expires_at=clock_timestamp()+($5::text || ' milliseconds')::interval
         WHERE provider=$1 AND realm_id=$2 AND (event_id=$3 OR dedupe_key=$6)
           AND state='claimed' AND lease_expires_at <= clock_timestamp()
         RETURNING event_id`,
        [input.provider, input.realmId, input.eventId, input.eventCursor, EVENT_CLAIM_LEASE_MS, input.dedupeKey]
      )
      if ((reclaimed.rowCount ?? 0) === 1) {
        await connection.query('COMMIT')
        return { status: 'claimed', claimEventId: String(reclaimed.rows[0]?.event_id) }
      }
      const existing = await connection.query<{ event_id: unknown; state: unknown; wait_ms: unknown }>(
        `SELECT event_id,state,GREATEST(0,EXTRACT(EPOCH FROM (lease_expires_at-clock_timestamp()))*1000) AS wait_ms
           FROM sciforge_collaboration.provider_event_claims
          WHERE provider=$1 AND realm_id=$2 AND (event_id=$3 OR dedupe_key=$4)
          FOR UPDATE`,
        [input.provider, input.realmId, input.eventId, input.dedupeKey]
      )
      await connection.query('COMMIT')
      const row = existing.rows[0]
      if (!row) return { status: 'wait', waitMs: 25 }
      if (String(row.state) === 'processed') return { status: 'duplicate' }
      return { status: 'wait', waitMs: Number(row.wait_ms) || 25 }
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
    }
  }

  async completeEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
  }>): Promise<void> {
    const connection = await this.pool.connect()
    const processedAt = this.timestamp()
    try {
      await connection.query('BEGIN')
      const completed = await connection.query(
        `UPDATE sciforge_collaboration.provider_event_claims
         SET state='processed',processed_at=$5,event_cursor=$4,lease_expires_at=$5
         WHERE provider=$1 AND realm_id=$2 AND event_id=$3 AND state='claimed'
         RETURNING event_id`,
        [input.provider, input.realmId, input.eventId, input.eventCursor, processedAt]
      )
      if ((completed.rowCount ?? 0) !== 1) {
        throw new CollaborationServiceError('revision_conflict', 'Provider event claim is no longer current.')
      }
      const checkpointed = await connection.query(
        `INSERT INTO sciforge_collaboration.provider_event_cursors
         (provider,realm_id,event_cursor,event_id,updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider) DO UPDATE
         SET realm_id=EXCLUDED.realm_id,event_cursor=EXCLUDED.event_cursor,
             event_id=EXCLUDED.event_id,updated_at=EXCLUDED.updated_at
         WHERE sciforge_collaboration.provider_event_cursors.realm_id=EXCLUDED.realm_id`,
        [input.provider, input.realmId, input.eventCursor, input.eventId, processedAt]
      )
      if ((checkpointed.rowCount ?? 0) !== 1) {
        throw new CollaborationServiceError('identity_conflict', 'A provider runtime may manage only one realm per installed provider.')
      }
      await connection.query('COMMIT')
    } catch (error) {
      await rollback(connection)
      throw error
    } finally {
      connection.release()
    }
  }

  async checkpointProcessedEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
    eventCursor: string
  }>): Promise<void> {
    const checkpointed = await this.pool.query(
      `INSERT INTO sciforge_collaboration.provider_event_cursors
       (provider,realm_id,event_cursor,event_id,updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider) DO UPDATE
       SET realm_id=EXCLUDED.realm_id,event_cursor=EXCLUDED.event_cursor,
           event_id=EXCLUDED.event_id,updated_at=EXCLUDED.updated_at
       WHERE sciforge_collaboration.provider_event_cursors.realm_id=EXCLUDED.realm_id`,
      [input.provider, input.realmId, input.eventCursor, input.eventId, this.timestamp()]
    )
    if ((checkpointed.rowCount ?? 0) !== 1) {
      throw new CollaborationServiceError('identity_conflict', 'A provider runtime may manage only one realm per installed provider.')
    }
  }

  async releaseEvent(input: Readonly<{
    provider: string
    realmId: string
    eventId: string
  }>): Promise<void> {
    await this.pool.query(
      `DELETE FROM sciforge_collaboration.provider_event_claims
        WHERE provider=$1 AND realm_id=$2 AND event_id=$3 AND state='claimed'`,
      [input.provider, input.realmId, input.eventId]
    )
  }

  async readCursor(provider: string): Promise<string | undefined> {
    const result = await this.pool.query<{ event_cursor: unknown }>(
      `SELECT event_cursor FROM sciforge_collaboration.provider_event_cursors WHERE provider=$1`,
      [provider]
    )
    return result.rows[0] ? String(result.rows[0].event_cursor) : undefined
  }

  async resolveTarget(input: Readonly<{
    provider: string
    realmId: string
    containerId: string
    topicDisplayName: string
  }>): Promise<ProviderRoutingTarget | undefined> {
    const result = await this.pool.query<SqlRow>(
      `SELECT 'personal_projection' AS target_kind,projection_id AS resource_id,locator
         FROM sciforge_collaboration.remote_session_projections
        WHERE status='active' AND locator->>'provider'=$1 AND locator->>'realmId'=$2
          AND locator->>'containerId'=$3
       UNION ALL
       SELECT 'project' AS target_kind,project_id AS resource_id,locator
         FROM sciforge_collaboration.project_endpoint_bindings
        WHERE status='active' AND locator->>'provider'=$1 AND locator->>'realmId'=$2
          AND locator->>'containerId'=$3`,
      [input.provider, input.realmId, input.containerId]
    )
    const topicKey = displayKey(input.topicDisplayName)
    const candidates = result.rows
      .map(mapTarget)
      .filter((candidate) => displayKey(candidate.locator.topicDisplayName ?? '') === topicKey)
    if (candidates.length > 1) {
      throw new CollaborationServiceError('identity_conflict', 'Provider coordinates resolve to more than one active collaboration target.')
    }
    return candidates[0]
  }

  async resolveExactTarget(locator: ProviderLocator): Promise<ProviderRoutingTarget | undefined> {
    const result = await this.pool.query<SqlRow>(
      `SELECT 'personal_projection' AS target_kind,projection_id AS resource_id,locator
         FROM sciforge_collaboration.remote_session_projections
        WHERE status='active' AND locator->>'provider'=$1 AND locator->>'realmId'=$2
          AND locator->>'containerId'=$3 AND locator->>'topicId'=$4
       UNION ALL
       SELECT 'project' AS target_kind,project_id AS resource_id,locator
         FROM sciforge_collaboration.project_endpoint_bindings
        WHERE status='active' AND locator->>'provider'=$1 AND locator->>'realmId'=$2
          AND locator->>'containerId'=$3 AND locator->>'topicId'=$4`,
      [locator.provider, locator.realmId, locator.containerId, locator.topicId]
    )
    if (result.rows.length > 1) {
      throw new CollaborationServiceError('identity_conflict', 'Provider locator resolves to more than one active collaboration target.')
    }
    return result.rows[0] ? mapTarget(result.rows[0]) : undefined
  }

  async hasPendingChallenge(provider: string, realmId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM sciforge_collaboration.human_endpoint_challenges
        WHERE provider=$1 AND realm_id=$2 AND verified_at IS NULL AND expires_at>$3
        LIMIT 1`,
      [provider, realmId, this.timestamp()]
    )
    return (result.rowCount ?? 0) === 1
  }

  async readDelivery(provider: string, clientMessageId: string): Promise<ProviderDeliveryState | undefined> {
    const result = await this.pool.query<SqlRow>(
      `SELECT result,attempt_count,terminal,next_attempt_at
         FROM sciforge_collaboration.provider_deliveries
        WHERE provider=$1 AND client_message_id=$2`,
      [provider, clientMessageId]
    )
    const row = result.rows[0]
    if (!row) return undefined
    return {
      result: providerSendResultSchema.parse(row.result),
      attemptCount: Number(row.attempt_count),
      terminal: Boolean(row.terminal),
      ...(row.next_attempt_at == null ? {} : { nextAttemptAt: iso(row.next_attempt_at) })
    }
  }

  async recordDelivery(provider: string, clientMessageId: string, result: ProviderSendResult): Promise<void> {
    const current = await this.readDelivery(provider, clientMessageId)
    if (current?.result.type === 'provider.send.succeeded') return
    const updatedAt = this.timestamp()
    const attemptCount = (current?.attemptCount ?? 0) + 1
    const terminal = result.type === 'provider.send.succeeded' || !result.retryable
    const retryMs = Math.min(MAX_DELIVERY_RETRY_MS, 1_000 * (2 ** Math.min(8, attemptCount - 1)))
    const nextAttemptAt = terminal ? null : new Date(new Date(updatedAt).getTime() + retryMs).toISOString()
    await this.pool.query(
      `INSERT INTO sciforge_collaboration.provider_deliveries
       (client_message_id,provider,result,attempt_count,terminal,next_attempt_at,created_at,updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$7)
       ON CONFLICT (client_message_id) DO UPDATE
       SET result=EXCLUDED.result,attempt_count=EXCLUDED.attempt_count,terminal=EXCLUDED.terminal,
           next_attempt_at=EXCLUDED.next_attempt_at,updated_at=EXCLUDED.updated_at`,
      [clientMessageId, provider, JSON.stringify(result), attemptCount, terminal, nextAttemptAt, updatedAt]
    )
  }

  async recordDiagnostic(diagnostic: ProviderDiagnostic): Promise<void> {
    const updatedAt = this.timestamp()
    await this.pool.query(
      `INSERT INTO sciforge_collaboration.provider_diagnostics
       (provider,status,safe_summary,checked_at,updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider) DO UPDATE
       SET status=EXCLUDED.status,safe_summary=EXCLUDED.safe_summary,
           checked_at=EXCLUDED.checked_at,updated_at=EXCLUDED.updated_at`,
      [diagnostic.provider, diagnostic.status, diagnostic.safeSummary, diagnostic.checkedAt, updatedAt]
    )
  }

  async listPendingEndpointIds(limit = 100): Promise<string[]> {
    const result = await this.pool.query<{ recipient_id: unknown }>(
      `SELECT recipient_id FROM sciforge_collaboration.inbox_cursors
        WHERE recipient_kind='human_endpoint' AND acked_sequence < next_sequence-1
        ORDER BY updated_at ASC LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => String(row.recipient_id))
  }

  async listPendingProviderIdentityIds(limit = 100): Promise<string[]> {
    const result = await this.pool.query<{ recipient_id: unknown }>(
      `SELECT recipient_id FROM sciforge_collaboration.inbox_cursors
        WHERE recipient_kind='provider_identity' AND acked_sequence < next_sequence-1
        ORDER BY updated_at ASC LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => String(row.recipient_id))
  }

  private timestamp(): string {
    const value = this.now()
    if (!Number.isFinite(value.valueOf())) throw new TypeError('Provider runtime clock returned an invalid timestamp.')
    return value.toISOString()
  }
}

function mapTarget(row: SqlRow): ProviderRoutingTarget {
  const locator = row.locator as ProviderLocator
  return {
    kind: String(row.target_kind) as ProviderRoutingTarget['kind'],
    resourceId: String(row.resource_id),
    locator
  }
}

function displayKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('und')
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

async function rollback(connection: SqlConnection): Promise<void> {
  await connection.query('ROLLBACK').catch(() => undefined)
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
