import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { principalIdentityVersionSchema } from '@sciforge/domain-sdk/principal'
import {
  MAX_LOCAL_ACCOUNTS,
  IdentityValidationError,
  identityAvailableStateSchema,
  localCloudIdentityLinkSchema,
  localAccountSchema,
  normalizeUsername,
  type IdentityAvailableState,
  type IdentityUnavailableState,
  type LocalAccount,
  type LocalCloudIdentityLink
} from '../contract.js'

const SCHEMA_VERSION = 2

type AccountRow = {
  user_id: string
  username: string
  created_at: string
  updated_at: string
  cloud_user_id: string | null
  cloud_oidc_identity_id: string | null
  cloud_issuer: string | null
  cloud_subject: string | null
  cloud_device_id: string | null
  cloud_device_status: string | null
}

export type CloudIdentityLinkInput = Readonly<{
  cloudUserId: string
  oidcIdentityId: string
  issuer: string
  subject: string
  displayName: string
}>

type StateRow = {
  current_user_id: string | null
  identity_version: number
  first_prompt_dismissed: number
}

export class IdentityStoreOpenError extends Error {
  readonly reason: IdentityUnavailableState['reason']

  constructor(reason: IdentityUnavailableState['reason'], cause: unknown) {
    super(`Identity database ${reason}: ${errorMessage(cause)}`, { cause })
    this.name = 'IdentityStoreOpenError'
    this.reason = reason
  }
}

export class IdentityStore {
  readonly databasePath: string
  private closed = false

  private constructor(private readonly database: DatabaseSync, databasePath: string) {
    this.databasePath = databasePath
  }

  static open(userDataDir: string): IdentityStore {
    const databasePath = join(userDataDir, 'identity-access', 'identity.sqlite')
    return IdentityStore.openDatabasePath(databasePath)
  }

  static openDatabasePath(databasePath: string): IdentityStore {
    mkdirSync(dirname(databasePath), { recursive: true })
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(databasePath)
      database.exec('PRAGMA foreign_keys = ON')
      database.exec('PRAGMA journal_mode = DELETE')
    } catch (error) {
      closeQuietly(database)
      throw new IdentityStoreOpenError('open-failed', error)
    }

    try {
      const row = database.prepare('PRAGMA integrity_check').get() as
        | Record<string, unknown>
        | undefined
      if (!row || Object.values(row)[0] !== 'ok') {
        throw new Error('SQLite integrity_check did not return ok.')
      }
    } catch (error) {
      closeQuietly(database)
      throw new IdentityStoreOpenError('integrity-failed', error)
    }

    try {
      migrate(database)
    } catch (error) {
      closeQuietly(database)
      throw new IdentityStoreOpenError('migration-failed', error)
    }
    return new IdentityStore(database, databasePath)
  }

  state(): IdentityAvailableState {
    this.assertOpen()
    const state = this.database.prepare(`
      SELECT current_user_id, identity_version, first_prompt_dismissed
      FROM identity_state WHERE singleton_id = 1
    `).get() as StateRow | undefined
    if (!state) throw new Error('Identity singleton state is missing.')
    const currentAccount = state.current_user_id
      ? this.account(state.current_user_id)
      : null
    if (state.current_user_id && !currentAccount) {
      throw new Error('Selected Local Account is missing.')
    }
    const accountCountRow = this.database.prepare(
      'SELECT COUNT(*) AS count FROM accounts'
    ).get() as { count: number }
    return identityAvailableStateSchema.parse({
      status: 'available',
      identityVersion: Number(state.identity_version),
      currentAccount,
      accountCount: Number(accountCountRow.count),
      firstPromptDismissed: state.first_prompt_dismissed === 1
    })
  }

  listAccounts(): readonly LocalAccount[] {
    this.assertOpen()
    const rows = this.database.prepare(`
      SELECT user_id, username, created_at, updated_at,
             cloud_user_id, cloud_oidc_identity_id, cloud_issuer, cloud_subject,
             cloud_device_id, cloud_device_status
      FROM accounts ORDER BY created_at ASC, user_id ASC
    `).all() as AccountRow[]
    return Object.freeze(rows.map(mapAccount))
  }

  createAccount(rawUsername: string): IdentityAvailableState {
    const normalized = normalizeUsername(rawUsername)
    const userId = randomUUID()
    const timestamp = new Date().toISOString()
    return this.transaction(() => {
      const current = this.state()
      if (current.accountCount >= MAX_LOCAL_ACCOUNTS) {
        throw new IdentityValidationError(
          'account-capacity-exceeded',
          `This installation supports at most ${MAX_LOCAL_ACCOUNTS} Local Accounts.`
        )
      }
      requireNextIdentityVersion(current.identityVersion)
      try {
        this.database.prepare(`
          INSERT INTO accounts (user_id, username, username_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, normalized.username, normalized.usernameKey, timestamp, timestamp)
      } catch (error) {
        throw mapWriteError(error)
      }
      this.database.prepare(`
        UPDATE identity_state
        SET current_user_id = ?, identity_version = identity_version + 1
        WHERE singleton_id = 1
      `).run(userId)
      return this.state()
    })
  }

  selectAccount(userId: string): IdentityAvailableState {
    return this.transaction(() => {
      const current = this.state()
      if (!this.account(userId)) {
        throw new IdentityValidationError('account-not-found', 'Local Account was not found.')
      }
      if (current.currentAccount?.userId === userId) return current
      requireNextIdentityVersion(current.identityVersion)
      this.database.prepare(`
        UPDATE identity_state
        SET current_user_id = ?, identity_version = identity_version + 1
        WHERE singleton_id = 1
      `).run(userId)
      return this.state()
    })
  }

  renameAccount(userId: string, rawUsername: string): IdentityAvailableState {
    const normalized = normalizeUsername(rawUsername)
    return this.transaction(() => {
      const account = this.accountWithKey(userId)
      if (!account) {
        throw new IdentityValidationError('account-not-found', 'Local Account was not found.')
      }
      if (account.username === normalized.username && account.username_key === normalized.usernameKey) {
        return this.state()
      }
      try {
        this.database.prepare(`
          UPDATE accounts SET username = ?, username_key = ?, updated_at = ?
          WHERE user_id = ?
        `).run(normalized.username, normalized.usernameKey, new Date().toISOString(), userId)
      } catch (error) {
        throw mapWriteError(error)
      }
      // Display metadata is not part of Principal authority and must not revoke
      // an otherwise unchanged authorization lease.
      return this.state()
    })
  }

  exitAccount(): IdentityAvailableState {
    return this.transaction(() => {
      const current = this.state()
      if (!current.currentAccount) return current
      requireNextIdentityVersion(current.identityVersion)
      this.database.prepare(`
        UPDATE identity_state
        SET current_user_id = NULL, identity_version = identity_version + 1
        WHERE singleton_id = 1
      `).run()
      return this.state()
    })
  }

  dismissFirstPrompt(): IdentityAvailableState {
    return this.transaction(() => {
      const current = this.state()
      if (current.firstPromptDismissed) return current
      this.database.prepare(`
        UPDATE identity_state
        SET first_prompt_dismissed = 1
        WHERE singleton_id = 1
      `).run()
      // Renderer preference changes are deliberately outside identityVersion.
      return this.state()
    })
  }

  setIdentityVersion(identityVersion: number): IdentityAvailableState {
    this.assertOpen()
    const parsed = principalIdentityVersionSchema.safeParse(identityVersion)
    if (!parsed.success) {
      throw new IdentityValidationError(
        'identity-version-exhausted',
        'Identity authorization revision is outside the safe integer range.'
      )
    }
    this.database.prepare(`
      UPDATE identity_state SET identity_version = ? WHERE singleton_id = 1
    `).run(parsed.data)
    return this.state()
  }

  linkCloudIdentity(input: CloudIdentityLinkInput): IdentityAvailableState {
    const parsedLink = localCloudIdentityLinkSchema.parse({
      cloudUserId: input.cloudUserId,
      oidcIdentityId: input.oidcIdentityId,
      issuer: input.issuer,
      subject: input.subject
    })
    return this.transaction(() => {
      const current = this.state()
      const byUser = this.accountRowByCloudUser(parsedLink.cloudUserId)
      const bySubject = this.accountRowByCloudSubject(parsedLink.issuer, parsedLink.subject)
      if (byUser && bySubject && byUser.user_id !== bySubject.user_id) {
        throw new IdentityValidationError(
          'identity-unavailable',
          'The cloud User and OIDC subject are linked to different Local Accounts.'
        )
      }

      let target = byUser ?? bySubject
      if (!target) {
        const currentRow = current.currentAccount
          ? this.accountRow(current.currentAccount.userId)
          : null
        target = currentRow && currentRow.cloud_user_id === null
          ? currentRow
          : this.createCloudAccountRow(input.displayName, current.accountCount)
      }

      const mappingChanged =
        target.cloud_user_id !== parsedLink.cloudUserId ||
        target.cloud_oidc_identity_id !== parsedLink.oidcIdentityId ||
        target.cloud_issuer !== parsedLink.issuer ||
        target.cloud_subject !== parsedLink.subject
      const selectionChanged = current.currentAccount?.userId !== target.user_id
      if (!mappingChanged && !selectionChanged) return current

      requireNextIdentityVersion(current.identityVersion)
      if (mappingChanged) {
        this.database.prepare(`
          UPDATE accounts
          SET cloud_user_id = ?, cloud_oidc_identity_id = ?, cloud_issuer = ?,
              cloud_subject = ?, updated_at = ?
          WHERE user_id = ?
        `).run(
          parsedLink.cloudUserId,
          parsedLink.oidcIdentityId,
          parsedLink.issuer,
          parsedLink.subject,
          new Date().toISOString(),
          target.user_id
        )
      }
      this.database.prepare(`
        UPDATE identity_state
        SET current_user_id = ?, identity_version = identity_version + 1
        WHERE singleton_id = 1
      `).run(target.user_id)
      return this.state()
    })
  }

  linkCloudDevice(
    cloudUserId: string,
    deviceId: string,
    status: 'active' | 'revoked'
  ): IdentityAvailableState {
    return this.transaction(() => {
      const current = this.state()
      const target = this.accountRowByCloudUser(cloudUserId)
      if (!target) {
        throw new IdentityValidationError(
          'account-not-found',
          'No Local Account is linked to this cloud User.'
        )
      }
      const parsed = localCloudIdentityLinkSchema.parse({
        cloudUserId: target.cloud_user_id,
        oidcIdentityId: target.cloud_oidc_identity_id,
        issuer: target.cloud_issuer,
        subject: target.cloud_subject,
        deviceId,
        deviceStatus: status
      })
      const linkedDeviceId = parsed.deviceId!
      const linkedDeviceStatus = parsed.deviceStatus!
      if (
        target.cloud_device_id === linkedDeviceId &&
        target.cloud_device_status === linkedDeviceStatus
      ) {
        return current
      }
      requireNextIdentityVersion(current.identityVersion)
      this.database.prepare(`
        UPDATE accounts
        SET cloud_device_id = ?, cloud_device_status = ?, updated_at = ?
        WHERE user_id = ?
      `).run(linkedDeviceId, linkedDeviceStatus, new Date().toISOString(), target.user_id)
      this.database.prepare(`
        UPDATE identity_state
        SET identity_version = identity_version + 1
        WHERE singleton_id = 1
      `).run()
      return this.state()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private account(userId: string): LocalAccount | null {
    const row = this.database.prepare(`
      SELECT user_id, username, created_at, updated_at,
             cloud_user_id, cloud_oidc_identity_id, cloud_issuer, cloud_subject,
             cloud_device_id, cloud_device_status
      FROM accounts WHERE user_id = ?
    `).get(userId) as AccountRow | undefined
    return row ? mapAccount(row) : null
  }

  private accountRow(userId: string): AccountRow | null {
    return (this.database.prepare(`
      SELECT user_id, username, created_at, updated_at,
             cloud_user_id, cloud_oidc_identity_id, cloud_issuer, cloud_subject,
             cloud_device_id, cloud_device_status
      FROM accounts WHERE user_id = ?
    `).get(userId) as AccountRow | undefined) ?? null
  }

  private accountRowByCloudUser(cloudUserId: string): AccountRow | null {
    return (this.database.prepare(`
      SELECT user_id, username, created_at, updated_at,
             cloud_user_id, cloud_oidc_identity_id, cloud_issuer, cloud_subject,
             cloud_device_id, cloud_device_status
      FROM accounts WHERE cloud_user_id = ?
    `).get(cloudUserId) as AccountRow | undefined) ?? null
  }

  private accountRowByCloudSubject(issuer: string, subject: string): AccountRow | null {
    return (this.database.prepare(`
      SELECT user_id, username, created_at, updated_at,
             cloud_user_id, cloud_oidc_identity_id, cloud_issuer, cloud_subject,
             cloud_device_id, cloud_device_status
      FROM accounts WHERE cloud_issuer = ? AND cloud_subject = ?
    `).get(issuer, subject) as AccountRow | undefined) ?? null
  }

  private createCloudAccountRow(displayName: string, accountCount: number): AccountRow {
    if (accountCount >= MAX_LOCAL_ACCOUNTS) {
      throw new IdentityValidationError(
        'account-capacity-exceeded',
        `This installation supports at most ${MAX_LOCAL_ACCOUNTS} Local Accounts.`
      )
    }
    const userId = randomUUID()
    const timestamp = new Date().toISOString()
    const normalized = this.uniqueCloudUsername(displayName)
    this.database.prepare(`
      INSERT INTO accounts (user_id, username, username_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, normalized.username, normalized.usernameKey, timestamp, timestamp)
    return this.accountRow(userId)!
  }

  private uniqueCloudUsername(displayName: string): ReturnType<typeof normalizeUsername> {
    const sanitized = Array.from(displayName.normalize('NFC'))
      .map((character) => /[\p{L}\p{N} _-]/u.test(character) ? character : ' ')
      .join('')
      .replace(/\s+/gu, ' ')
      .trim() || 'SciForge User'
    const base = Array.from(sanitized).slice(0, 64).join('')
    for (let suffix = 1; suffix <= MAX_LOCAL_ACCOUNTS + 1; suffix += 1) {
      const suffixText = suffix === 1 ? '' : ` ${suffix}`
      const candidate = `${Array.from(base).slice(0, 64 - suffixText.length).join('')}${suffixText}`
      const normalized = normalizeUsername(candidate)
      const exists = this.database.prepare(
        'SELECT 1 FROM accounts WHERE username_key = ?'
      ).get(normalized.usernameKey)
      if (!exists) return normalized
    }
    throw new IdentityValidationError('username-conflict', 'Could not allocate a Local Account name.')
  }

  private accountWithKey(userId: string): (AccountRow & { username_key: string }) | null {
    return (this.database.prepare(`
      SELECT user_id, username, username_key, created_at, updated_at
      FROM accounts WHERE user_id = ?
    `).get(userId) as (AccountRow & { username_key: string }) | undefined) ?? null
  }

  private transaction<T>(operation: () => T): T {
    this.assertOpen()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // Preserve the original operation failure.
      }
      throw error
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Identity database is closed.')
  }
}

function requireNextIdentityVersion(identityVersion: number): number {
  if (identityVersion >= Number.MAX_SAFE_INTEGER) {
    throw new IdentityValidationError(
      'identity-version-exhausted',
      'Identity authorization revision is exhausted.'
    )
  }
  return identityVersion + 1
}

function migrate(database: DatabaseSync): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as Record<string, unknown>
  const version = Number(Object.values(versionRow)[0])
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
    throw new Error(`Unsupported Identity schema version ${String(version)}.`)
  }
  if (version === SCHEMA_VERSION) return

  database.exec('BEGIN IMMEDIATE')
  try {
    if (version < 1) {
      database.exec(`
        CREATE TABLE accounts (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          username_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE identity_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          current_user_id TEXT NULL REFERENCES accounts(user_id),
          identity_version INTEGER NOT NULL CHECK (identity_version >= 0),
          first_prompt_dismissed INTEGER NOT NULL CHECK (first_prompt_dismissed IN (0, 1))
        );
        INSERT INTO identity_state (
          singleton_id, current_user_id, identity_version, first_prompt_dismissed
        ) VALUES (1, NULL, 0, 0);
        PRAGMA user_version = 1;
      `)
    }
    if (version < 2) {
      database.exec(`
        ALTER TABLE accounts ADD COLUMN cloud_user_id TEXT NULL;
        ALTER TABLE accounts ADD COLUMN cloud_oidc_identity_id TEXT NULL;
        ALTER TABLE accounts ADD COLUMN cloud_issuer TEXT NULL;
        ALTER TABLE accounts ADD COLUMN cloud_subject TEXT NULL;
        ALTER TABLE accounts ADD COLUMN cloud_device_id TEXT NULL;
        ALTER TABLE accounts ADD COLUMN cloud_device_status TEXT NULL
          CHECK (cloud_device_status IN ('active', 'revoked'));
        CREATE UNIQUE INDEX accounts_cloud_user_id_unique
          ON accounts (cloud_user_id) WHERE cloud_user_id IS NOT NULL;
        CREATE UNIQUE INDEX accounts_cloud_subject_unique
          ON accounts (cloud_issuer, cloud_subject) WHERE cloud_issuer IS NOT NULL;
        CREATE UNIQUE INDEX accounts_cloud_device_id_unique
          ON accounts (cloud_device_id) WHERE cloud_device_id IS NOT NULL;
        PRAGMA user_version = 2;
      `)
    }
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the migration failure.
    }
    throw error
  }
}

function mapAccount(row: AccountRow): LocalAccount {
  const cloudIdentity = cloudIdentityFromRow(row)
  return localAccountSchema.parse({
    userId: row.user_id,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(cloudIdentity ? { cloudIdentity } : {})
  })
}

function cloudIdentityFromRow(row: AccountRow): LocalCloudIdentityLink | null {
  const values = [
    row.cloud_user_id,
    row.cloud_oidc_identity_id,
    row.cloud_issuer,
    row.cloud_subject
  ]
  if (values.every((value) => value === null)) return null
  if (values.some((value) => value === null)) {
    throw new Error('Local Account cloud identity columns are inconsistent.')
  }
  return localCloudIdentityLinkSchema.parse({
    cloudUserId: row.cloud_user_id,
    oidcIdentityId: row.cloud_oidc_identity_id,
    issuer: row.cloud_issuer,
    subject: row.cloud_subject,
    ...(row.cloud_device_id ? { deviceId: row.cloud_device_id } : {}),
    ...(row.cloud_device_status ? { deviceStatus: row.cloud_device_status } : {})
  })
}

function mapWriteError(error: unknown): Error {
  const message = errorMessage(error)
  if (message.includes('UNIQUE constraint failed: accounts.username_key')) {
    return new IdentityValidationError(
      'username-conflict',
      'That username is already used by another Local Account.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}

function closeQuietly(database: DatabaseSync | undefined): void {
  try {
    database?.close()
  } catch {
    // Initialization already failed; the original failure remains authoritative.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
