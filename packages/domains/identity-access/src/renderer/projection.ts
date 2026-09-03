import type {
  IdentityListAccountsOutput,
  IdentityUiState,
  LocalAccount
} from '../contract.js'
import type { IdentityRendererClient } from './client.js'

export type IdentityProjectionSnapshot = Readonly<{
  loading: boolean
  state: IdentityUiState | null
  accounts: readonly LocalAccount[]
  error: string | null
}>

const INITIAL_SNAPSHOT: IdentityProjectionSnapshot = Object.freeze({
  loading: false,
  state: null,
  accounts: Object.freeze([]),
  error: null
})

export class IdentityRendererProjection {
  private snapshotValue = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private loading: Promise<IdentityProjectionSnapshot> | null = null
  private disposed = false

  constructor(readonly client: IdentityRendererClient) {}

  getSnapshot = (): IdentityProjectionSnapshot => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  load(): Promise<IdentityProjectionSnapshot> {
    if (this.loading) return this.loading
    this.set({ ...this.snapshotValue, loading: true, error: null })
    this.loading = this.client.listAccounts()
      .then((output) => {
        if (this.disposed) return this.snapshotValue
        this.acceptList(output)
        return this.snapshotValue
      })
      .catch((error: unknown) => {
        if (this.disposed) return this.snapshotValue
        this.set({
          ...this.snapshotValue,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        })
        return this.snapshotValue
      })
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  async createAccount(username: string): Promise<void> {
    await this.mutate(() => this.client.createAccount(username))
  }

  async selectAccount(userId: string): Promise<void> {
    await this.mutate(() => this.client.selectAccount(userId))
  }

  async renameAccount(userId: string, username: string): Promise<void> {
    await this.mutate(() => this.client.renameAccount(userId, username))
  }

  async exitAccount(): Promise<void> {
    await this.mutate(() => this.client.exitAccount())
  }

  async dismissFirstPrompt(): Promise<void> {
    await this.mutate(() => this.client.dismissFirstPrompt())
  }

  async backupAndReset(secondConfirmation: string): Promise<string> {
    try {
      const result = await this.client.backupAndReset(secondConfirmation)
      this.set({
        ...this.snapshotValue,
        loading: false,
        state: result.state,
        accounts: Object.freeze([]),
        error: null
      })
      await this.load()
      return result.backupPath
    } catch (error) {
      this.setError(error)
      throw error
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private async mutate(operation: () => Promise<IdentityUiState>): Promise<void> {
    this.set({ ...this.snapshotValue, loading: true, error: null })
    let state: IdentityUiState
    try {
      state = await operation()
    } catch (error) {
      this.setError(error)
      throw error
    }
    this.set({
      ...this.snapshotValue,
      loading: true,
      state,
      accounts: accountsAfterMutation(this.snapshotValue.accounts, state),
      error: null
    })
    try {
      const listed = await this.client.listAccounts()
      this.acceptList({ ...listed, state })
    } catch (error) {
      this.setError(error)
    }
  }

  private acceptList(output: IdentityListAccountsOutput): void {
    this.set({
      ...this.snapshotValue,
      loading: false,
      state: output.state,
      accounts: Object.freeze([...output.accounts]),
      error: null
    })
  }

  private setError(error: unknown): void {
    this.set({
      ...this.snapshotValue,
      loading: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  private set(snapshot: IdentityProjectionSnapshot): void {
    this.snapshotValue = Object.freeze(snapshot)
    for (const listener of this.listeners) listener()
  }
}

function accountsAfterMutation(
  accounts: readonly LocalAccount[],
  state: IdentityUiState
): readonly LocalAccount[] {
  if (state.status !== 'available') return Object.freeze([])
  const current = state.currentAccount
  if (!current) return accounts
  const existingIndex = accounts.findIndex((account) => account.userId === current.userId)
  if (existingIndex < 0) return Object.freeze([...accounts, current])
  return Object.freeze(accounts.map((account, index) => index === existingIndex ? current : account))
}
