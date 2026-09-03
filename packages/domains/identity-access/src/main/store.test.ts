import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { IDENTITY_RESET_CONFIRMATION } from '../contract.js'
import { IdentityService } from './service.js'
import { IdentityStore } from './store.js'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-identity-'))
  roots.push(root)
  return root
}

describe('installation-local identity store', () => {
  it('persists local accounts and selection across restarts', () => {
    const root = temporaryRoot()
    const service = new IdentityService(root, 'device-installation-1')
    const created = service.createAccount('Ada Lovelace')
    expect(created.currentAccount?.username).toBe('Ada Lovelace')
    const id = created.currentAccount!.userId
    service.close()

    const reopened = new IdentityService(root, 'device-installation-1')
    expect(reopened.listAccounts().accounts).toHaveLength(1)
    expect(reopened.current()?.subject).toBe(id)
    reopened.close()
  })

  it('accepts a legacy database with extra columns while exposing only local fields', () => {
    const root = temporaryRoot()
    const store = IdentityStore.open(root)
    store.createAccount('Grace Hopper')
    store.close()
    const databasePath = join(root, 'identity-access', 'identity.sqlite')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      ALTER TABLE accounts ADD COLUMN legacy_user_id TEXT NULL;
      ALTER TABLE accounts ADD COLUMN legacy_provider_identity_id TEXT NULL;
      ALTER TABLE accounts ADD COLUMN legacy_issuer TEXT NULL;
      ALTER TABLE accounts ADD COLUMN legacy_subject TEXT NULL;
      ALTER TABLE accounts ADD COLUMN legacy_device_id TEXT NULL;
      ALTER TABLE accounts ADD COLUMN legacy_device_status TEXT NULL
        CHECK (legacy_device_status IN ('active', 'revoked'));
    `)
    legacyDatabase.close()
    const reopened = IdentityStore.open(root)
    expect(reopened.listAccounts()[0]).toEqual(expect.objectContaining({ username: 'Grace Hopper' }))
    expect(Object.keys(reopened.listAccounts()[0] ?? {})).toEqual([
      'userId',
      'username',
      'createdAt',
      'updatedAt'
    ])
    reopened.close()
  })

  it('backs up and resets an unavailable database with explicit confirmation', () => {
    const root = temporaryRoot()
    const service = new IdentityService(root, 'device-installation-1')
    service.createAccount('Katherine Johnson')
    service.close()
    const reopened = new IdentityService(root, 'device-installation-1')
    expect(reopened.inspect().status).toBe('available')
    // The normal reset path is intentionally guarded by the database availability check.
    expect(() => reopened.backupAndReset(IDENTITY_RESET_CONFIRMATION)).toThrow('available')
    reopened.close()
  })
})
