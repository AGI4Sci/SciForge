import type { IdentityPrivateVault } from './private-vault.js'

const SESSION_SECRET_KEY = 'oidc-session' as const

export type StoredDesktopIdentitySession = Readonly<{
  version: 1
  issuer: string
  clientId: string
  refreshToken: string
  idToken?: string
}>

export interface DesktopIdentitySessionStore {
  load(): Promise<StoredDesktopIdentitySession | null>
  save(session: StoredDesktopIdentitySession): Promise<void>
  clear(): Promise<void>
}

export class DesktopIdentitySessionStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DesktopIdentitySessionStoreError'
  }
}

/** Main-process-only session storage backed by the Identity-owned native vault. */
export class PrivateVaultDesktopIdentitySessionStore implements DesktopIdentitySessionStore {
  constructor(private readonly vault: IdentityPrivateVault) {}

  async load(): Promise<StoredDesktopIdentitySession | null> {
    try {
      const serialized = await this.vault.read({ kind: SESSION_SECRET_KEY })
      return serialized === null ? null : parseSession(JSON.parse(serialized))
    } catch (error) {
      throw new DesktopIdentitySessionStoreError(
        'The saved login session is invalid or cannot be read from secure storage.',
        { cause: error }
      )
    }
  }

  async save(session: StoredDesktopIdentitySession): Promise<void> {
    try {
      await this.vault.write({ kind: SESSION_SECRET_KEY }, JSON.stringify(parseSession(session)))
    } catch (error) {
      throw new DesktopIdentitySessionStoreError(
        'The login session could not be stored securely.',
        { cause: error }
      )
    }
  }

  async clear(): Promise<void> {
    try {
      await this.vault.remove({ kind: SESSION_SECRET_KEY })
    } catch (error) {
      throw new DesktopIdentitySessionStoreError(
        'The saved login session could not be removed.',
        { cause: error }
      )
    }
  }
}

function parseSession(value: unknown): StoredDesktopIdentitySession {
  const record = requireRecord(value, 'Saved login session')
  if (
    record.version !== 1 ||
    !validString(record.issuer, 1, 2_048) ||
    !validString(record.clientId, 1, 256) ||
    !validString(record.refreshToken, 16, 100_000) ||
    (record.idToken !== undefined && !validString(record.idToken, 16, 100_000))
  ) {
    throw new DesktopIdentitySessionStoreError(
      'The saved login session has an unsupported format.'
    )
  }
  return {
    version: 1,
    issuer: record.issuer,
    clientId: record.clientId,
    refreshToken: record.refreshToken,
    ...(record.idToken === undefined ? {} : { idToken: record.idToken })
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DesktopIdentitySessionStoreError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function validString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}
