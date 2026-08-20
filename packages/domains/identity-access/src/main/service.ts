import { copyFileSync, constants, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  DomainMainPrincipalProvider,
  PrincipalContextSnapshot,
  PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { definePrincipalContextSnapshot } from '@sciforge/domain-sdk/principal'
import {
  IDENTITY_PRINCIPAL_AUTHORITY,
  IdentityValidationError,
  identityUnavailableStateSchema,
  type IdentityAvailableState,
  type IdentityListAccountsOutput,
  type IdentityUiState
} from '../contract.js'
import {
  activeCloudDeviceId,
  activeCloudUserId,
  subscribeCloudIdentityChanges
} from './cloud-link-service.js'
import { IdentityStore, IdentityStoreOpenError } from './store.js'

type StoreFactory = Readonly<{
  open(userDataDir: string): IdentityStore
  openDatabasePath(databasePath: string): IdentityStore
}>

export class IdentityService implements DomainMainPrincipalProvider {
  private store: IdentityStore | null = null
  private unavailableState: IdentityUiState | null = null
  private readonly listeners = new Set<(snapshot: PrincipalContextSnapshot) => void>()
  private readonly databasePath: string
  private readonly disposeCloudIdentitySubscription: () => void
  private lastPublishedVersion = 0

  constructor(
    private readonly userDataDir: string,
    private readonly deviceId: string,
    private readonly stores: StoreFactory = IdentityStore
  ) {
    this.databasePath = join(this.userDataDir, 'identity-access', 'identity.sqlite')
    this.initialize()
    this.disposeCloudIdentitySubscription = subscribeCloudIdentityChanges(
      this.databasePath,
      () => this.refreshCloudIdentityState()
    )
  }

  inspect(): IdentityUiState {
    if (this.unavailableState) return this.unavailableState
    return this.executeRead((store) => store.state())
  }

  listAccounts(): IdentityListAccountsOutput {
    if (this.unavailableState) {
      return Object.freeze({ state: this.unavailableState, accounts: [] })
    }
    return this.executeRead((store) => Object.freeze({
      state: store.state(),
      accounts: [...store.listAccounts()]
    }))
  }

  createAccount(username: string): IdentityAvailableState {
    return this.executeMutation((store) => store.createAccount(username))
  }

  selectAccount(userId: string): IdentityAvailableState {
    return this.executeMutation((store) => store.selectAccount(userId))
  }

  renameAccount(userId: string, username: string): IdentityAvailableState {
    return this.executeMutation((store) => store.renameAccount(userId, username))
  }

  exitAccount(): IdentityAvailableState {
    return this.executeMutation((store) => store.exitAccount())
  }

  dismissFirstPrompt(): IdentityAvailableState {
    return this.executeMutation((store) => store.dismissFirstPrompt())
  }

  backupAndReset(secondConfirmation: string): Readonly<{
    state: IdentityAvailableState
    backupPath: string
  }> {
    if (secondConfirmation !== 'RESET LOCAL IDENTITY') {
      throw new IdentityValidationError('reset-not-confirmed', 'The second reset confirmation is missing.')
    }
    if (!this.unavailableState) {
      throw new IdentityValidationError(
        'identity-unavailable',
        'Identity reset is available only when the Identity database is unavailable.'
      )
    }
    const resetIdentityVersion = nextIdentityVersion(this.lastPublishedVersion)

    const databasePath = this.databasePath
    const backupPath = nextBackupPath(databasePath)
    try {
      copyFileSync(databasePath, backupPath, constants.COPYFILE_EXCL)
      const source = statSync(databasePath)
      const backup = statSync(backupPath)
      if (!backup.isFile() || backup.size !== source.size) {
        throw new Error('Identity backup verification failed.')
      }
    } catch (error) {
      throw new IdentityValidationError(
        'backup-failed',
        `Identity backup failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    const temporaryPath = join(
      dirname(databasePath),
      `.identity-reset-${Date.now()}-${process.pid}.sqlite`
    )
    let replacement: IdentityStore | null = null
    try {
      replacement = this.stores.openDatabasePath(temporaryPath)
      replacement.setIdentityVersion(resetIdentityVersion)
      replacement.close()
      replacement = null
      renameSync(temporaryPath, databasePath)
      this.store = this.stores.open(this.userDataDir)
      this.unavailableState = null
      const state = this.store.state()
      this.publish(state)
      return Object.freeze({ state, backupPath })
    } catch (error) {
      replacement?.close()
      removeIfExists(temporaryPath)
      this.store = null
      this.unavailableState = identityUnavailableStateSchema.parse({
        status: 'unavailable',
        reason: error instanceof IdentityStoreOpenError ? error.reason : 'open-failed',
        recoveryAvailable: existsSync(databasePath)
      })
      throw error
    }
  }

  current(): PrincipalSnapshot | undefined {
    return this.snapshot().principal ?? undefined
  }

  snapshot(): PrincipalContextSnapshot {
    const state = this.inspect()
    if (state.status === 'unavailable') {
      return definePrincipalContextSnapshot({
        identityVersion: this.lastPublishedVersion,
        principal: null
      })
    }
    return principalContextFromState(
      state,
      this.deviceId,
      activeCloudUserId(this.databasePath),
      activeCloudDeviceId(this.databasePath)
    )
  }

  subscribe(listener: (snapshot: PrincipalContextSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.disposeCloudIdentitySubscription()
    this.store?.close()
    this.store = null
    this.listeners.clear()
  }

  private initialize(): void {
    try {
      this.store = this.stores.open(this.userDataDir)
      const state = this.store.state()
      this.lastPublishedVersion = state.identityVersion
    } catch (error) {
      this.store = null
      this.unavailableState = identityUnavailableStateSchema.parse({
        status: 'unavailable',
        reason: error instanceof IdentityStoreOpenError ? error.reason : 'open-failed',
        recoveryAvailable: existsSync(join(this.userDataDir, 'identity-access', 'identity.sqlite'))
      })
    }
  }

  private requireStore(): IdentityStore {
    if (!this.store || this.unavailableState) {
      throw new IdentityValidationError('identity-unavailable', 'Identity is unavailable.')
    }
    return this.store
  }

  private executeRead<T>(operation: (store: IdentityStore) => T): T {
    try {
      return operation(this.requireStore())
    } catch (error) {
      if (error instanceof IdentityValidationError) throw error
      this.failClosed(error)
      throw error
    }
  }

  private executeMutation(operation: (store: IdentityStore) => IdentityAvailableState): IdentityAvailableState {
    try {
      const store = this.requireStore()
      const before = store.state().identityVersion
      const state = operation(store)
      if (state.identityVersion > before) this.publish(state)
      return state
    } catch (error) {
      if (error instanceof IdentityValidationError) throw error
      this.failClosed(error)
      throw error
    }
  }

  private failClosed(_error: unknown): void {
    this.store?.close()
    this.store = null
    this.unavailableState = identityUnavailableStateSchema.parse({
      status: 'unavailable',
      reason: 'open-failed',
      recoveryAvailable: existsSync(join(this.userDataDir, 'identity-access', 'identity.sqlite'))
    })
    const unavailableVersion = this.lastPublishedVersion < Number.MAX_SAFE_INTEGER
      ? this.lastPublishedVersion + 1
      : this.lastPublishedVersion
    const snapshot = definePrincipalContextSnapshot({
      identityVersion: unavailableVersion,
      principal: null
    })
    this.lastPublishedVersion = snapshot.identityVersion
    this.notify(snapshot)
  }

  private publish(state: IdentityAvailableState): void {
    const snapshot = principalContextFromState(
      state,
      this.deviceId,
      activeCloudUserId(this.databasePath),
      activeCloudDeviceId(this.databasePath)
    )
    if (snapshot.identityVersion <= this.lastPublishedVersion) return
    this.lastPublishedVersion = snapshot.identityVersion
    this.notify(snapshot)
  }

  private notify(snapshot: PrincipalContextSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A projection listener is not part of the committed Identity
        // transaction and cannot revoke or poison the Principal authority.
      }
    }
  }

  private refreshCloudIdentityState(): void {
    if (!this.store || this.unavailableState) return
    try {
      this.publish(this.store.state())
    } catch (error) {
      this.failClosed(error)
    }
  }
}

function nextIdentityVersion(identityVersion: number): number {
  if (identityVersion >= Number.MAX_SAFE_INTEGER) {
    throw new IdentityValidationError(
      'identity-version-exhausted',
      'Identity authorization revision is exhausted.'
    )
  }
  return identityVersion + 1
}

function principalContextFromState(
  state: IdentityAvailableState,
  localDeviceId: string,
  activeCloudUser: string | null,
  activeCloudDevice: string | null
): PrincipalContextSnapshot {
  const account = state.currentAccount
  const cloudIdentity = account?.cloudIdentity
  const hasActiveCloudDevice = cloudIdentity?.cloudUserId === activeCloudUser &&
    cloudIdentity.deviceStatus === 'active' &&
    cloudIdentity.deviceId === activeCloudDevice
  const principal = account
    ? hasActiveCloudDevice
      ? {
          authority: 'sciforge-cloud',
          subject: cloudIdentity.cloudUserId,
          assurance: 'cloud-authenticated' as const,
          deviceId: cloudIdentity.deviceId,
          identityVersion: state.identityVersion
        }
      : {
        authority: IDENTITY_PRINCIPAL_AUTHORITY,
        subject: account.userId,
        assurance: 'local-selection' as const,
        deviceId: localDeviceId,
        identityVersion: state.identityVersion
      }
    : null
  return definePrincipalContextSnapshot({
    identityVersion: state.identityVersion,
    principal
  })
}

function nextBackupPath(databasePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = `${databasePath}.backup-${timestamp}${suffix ? `-${suffix}` : ''}`
    if (!existsSync(candidate)) return candidate
  }
  throw new IdentityValidationError('backup-failed', 'Could not allocate an Identity backup path.')
}

function removeIfExists(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code !== 'ENOENT') throw error
  }
}
