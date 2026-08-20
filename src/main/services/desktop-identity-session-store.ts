import { chmod, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageEncryption } from '../domain-package-storage'
import { atomicWriteFile } from '../atomic-write-file'

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

type StoredEnvelope = Readonly<{
  version: 1
  encryptedSession: string
}>

export class DesktopIdentitySessionStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DesktopIdentitySessionStoreError'
  }
}

export class EncryptedDesktopIdentitySessionStore implements DesktopIdentitySessionStore {
  readonly #path: string

  constructor(
    userDataDir: string,
    private readonly encryption: PackageEncryption
  ) {
    this.#path = join(userDataDir, 'collaboration-identity', 'oidc-session.json')
  }

  async load(): Promise<StoredDesktopIdentitySession | null> {
    this.#requireEncryption()
    const serialized = await readFile(this.#path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw new DesktopIdentitySessionStoreError('The saved login session could not be read.', { cause: error })
    })
    if (serialized === null) return null

    try {
      const envelope = parseEnvelope(JSON.parse(serialized))
      const decrypted = this.encryption.decryptString(Buffer.from(envelope.encryptedSession, 'base64'))
      return parseSession(JSON.parse(decrypted))
    } catch (error) {
      if (error instanceof DesktopIdentitySessionStoreError) throw error
      throw new DesktopIdentitySessionStoreError('The saved login session is invalid or cannot be decrypted.', {
        cause: error
      })
    }
  }

  async save(session: StoredDesktopIdentitySession): Promise<void> {
    this.#requireEncryption()
    const parsed = parseSession(session)
    try {
      const encryptedSession = this.encryption
        .encryptString(JSON.stringify(parsed))
        .toString('base64')
      const envelope: StoredEnvelope = { version: 1, encryptedSession }
      await atomicWriteFile(this.#path, JSON.stringify(envelope))
      if (process.platform !== 'win32') await chmod(this.#path, 0o600)
    } catch (error) {
      throw new DesktopIdentitySessionStoreError('The login session could not be stored securely.', {
        cause: error
      })
    }
  }

  async clear(): Promise<void> {
    await rm(this.#path, { force: true }).catch((error) => {
      throw new DesktopIdentitySessionStoreError('The saved login session could not be removed.', {
        cause: error
      })
    })
  }

  #requireEncryption(): void {
    if (this.encryption.state() !== 'available') {
      throw new DesktopIdentitySessionStoreError(
        'Secure operating-system storage is unavailable for the login session.'
      )
    }
  }
}

function parseEnvelope(value: unknown): StoredEnvelope {
  const record = requireRecord(value, 'Saved login envelope')
  if (record.version !== 1 || !validString(record.encryptedSession, 1, 100_000)) {
    throw new DesktopIdentitySessionStoreError('The saved login envelope has an unsupported format.')
  }
  return { version: 1, encryptedSession: record.encryptedSession }
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
    throw new DesktopIdentitySessionStoreError('The saved login session has an unsupported format.')
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
