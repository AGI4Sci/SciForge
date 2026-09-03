import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { principalIdentityVersionSchema } from '@sciforge/domain-sdk/principal'
import {
  MAX_LOCAL_ACCOUNTS,
  IdentityValidationError,
  identityAvailableStateSchema,
  localAccountSchema,
  normalizeUsername,
  type IdentityAvailableState,
  type IdentityUnavailableState,
  type LocalAccount
} from '../contract.js'

const SCHEMA_VERSION = 2

type AccountRow = {
  user_id: string
  username: string
  created_at: string
  updated_at: string
}

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
      SELECT user_id, username, created_at, updated_at
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

  advanceIdentityVersion(): IdentityAvailableState {
    return this.transaction(() => {
      const current = this.state()
      requireNextIdentityVersion(current.identityVersion)
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
      SELECT user_id, username, created_at, updated_at
      FROM accounts WHERE user_id = ?
    `).get(userId) as AccountRow | undefined
    return row ? mapAccount(row) : null
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
  return localAccountSchema.parse({
    userId: row.user_id,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
