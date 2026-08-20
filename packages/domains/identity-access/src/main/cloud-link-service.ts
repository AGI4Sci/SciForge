import type { IdentityAvailableState } from '../contract.js'
import {
  IdentityStore,
  type CloudIdentityLinkInput
} from './store.js'

export class LocalCloudIdentityLinkService {
  readonly #store: IdentityStore

  constructor(userDataDir: string) {
    this.#store = IdentityStore.open(userDataDir)
  }

  linkIdentity(input: CloudIdentityLinkInput): IdentityAvailableState {
    return this.#store.linkCloudIdentity(input)
  }

  linkDevice(
    cloudUserId: string,
    deviceId: string,
    status: 'active' | 'revoked'
  ): IdentityAvailableState {
    return this.#store.linkCloudDevice(cloudUserId, deviceId, status)
  }

  close(): void {
    this.#store.close()
  }
}
