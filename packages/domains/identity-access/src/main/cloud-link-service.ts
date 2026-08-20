import type { IdentityAvailableState } from '../contract.js'
import {
  IdentityStore,
  type CloudIdentityLinkInput
} from './store.js'

type CloudIdentityRuntime = {
  activeCloudUserId: string | null
  activeCloudDeviceId: string | null
  listeners: Set<() => void>
}

const cloudIdentityRuntimes = new Map<string, CloudIdentityRuntime>()

function runtimeFor(databasePath: string): CloudIdentityRuntime {
  let runtime = cloudIdentityRuntimes.get(databasePath)
  if (!runtime) {
    runtime = { activeCloudUserId: null, activeCloudDeviceId: null, listeners: new Set() }
    cloudIdentityRuntimes.set(databasePath, runtime)
  }
  return runtime
}

export function activeCloudUserId(databasePath: string): string | null {
  return runtimeFor(databasePath).activeCloudUserId
}

export function activeCloudDeviceId(databasePath: string): string | null {
  return runtimeFor(databasePath).activeCloudDeviceId
}

export function subscribeCloudIdentityChanges(
  databasePath: string,
  listener: () => void
): () => void {
  const runtime = runtimeFor(databasePath)
  runtime.listeners.add(listener)
  return () => runtime.listeners.delete(listener)
}

function notifyCloudIdentityChanges(databasePath: string): void {
  for (const listener of runtimeFor(databasePath).listeners) {
    try {
      listener()
    } catch {
      // Cloud-link commits remain authoritative even if a projection listener fails.
    }
  }
}

export class LocalCloudIdentityLinkService {
  readonly #store: IdentityStore
  readonly #databasePath: string
  #closed = false

  constructor(userDataDir: string) {
    this.#store = IdentityStore.open(userDataDir)
    this.#databasePath = this.#store.databasePath
  }

  linkIdentity(input: CloudIdentityLinkInput): IdentityAvailableState {
    this.#assertOpen()
    const state = this.#store.linkCloudIdentity(input)
    notifyCloudIdentityChanges(this.#databasePath)
    return state
  }

  linkDevice(
    cloudUserId: string,
    deviceId: string,
    status: 'active' | 'revoked'
  ): IdentityAvailableState {
    this.#assertOpen()
    const runtime = runtimeFor(this.#databasePath)
    const previousVersion = this.#store.state().identityVersion
    let state = this.#store.linkCloudDevice(cloudUserId, deviceId, status)
    const nextActiveDeviceId = runtime.activeCloudUserId === cloudUserId && status === 'active'
      ? deviceId
      : null
    if (runtime.activeCloudDeviceId !== nextActiveDeviceId) {
      if (state.identityVersion === previousVersion) state = this.#store.advanceIdentityVersion()
      runtime.activeCloudDeviceId = nextActiveDeviceId
    }
    notifyCloudIdentityChanges(this.#databasePath)
    return state
  }

  setAuthenticatedCloudUser(cloudUserId: string | null): IdentityAvailableState {
    this.#assertOpen()
    const runtime = runtimeFor(this.#databasePath)
    if (runtime.activeCloudUserId === cloudUserId) return this.#store.state()

    const current = this.#store.state()
    if (
      cloudUserId !== null &&
      current.currentAccount?.cloudIdentity?.cloudUserId !== cloudUserId
    ) {
      throw new Error('The authenticated cloud User is not linked to the selected Local Account.')
    }

    const state = this.#store.advanceIdentityVersion()
    runtime.activeCloudUserId = cloudUserId
    runtime.activeCloudDeviceId = null
    notifyCloudIdentityChanges(this.#databasePath)
    return state
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const runtime = runtimeFor(this.#databasePath)
    runtime.activeCloudUserId = null
    runtime.activeCloudDeviceId = null
    notifyCloudIdentityChanges(this.#databasePath)
    this.#store.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Local cloud identity links are closed.')
  }
}
