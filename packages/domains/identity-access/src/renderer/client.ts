import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  IDENTITY_CAPABILITY_IDS,
  accountRenameInputSchema,
  accountSelectionInputSchema,
  emptyIdentityInputSchema,
  identityAvailableStateSchema,
  identityBackupAndResetInputSchema,
  identityBackupAndResetOutputSchema,
  identityListAccountsOutputSchema,
  identityUiStateSchema,
  usernameInputSchema,
  type IdentityAvailableState,
  type IdentityListAccountsOutput,
  type IdentityUiState
} from '../contract.js'

export type IdentityRendererClient = Readonly<{
  inspect(): Promise<IdentityUiState>
  listAccounts(): Promise<IdentityListAccountsOutput>
  createAccount(username: string): Promise<IdentityAvailableState>
  selectAccount(userId: string): Promise<IdentityAvailableState>
  renameAccount(userId: string, username: string): Promise<IdentityAvailableState>
  exitAccount(): Promise<IdentityAvailableState>
  dismissFirstPrompt(): Promise<IdentityAvailableState>
  backupAndReset(secondConfirmation: string): Promise<{
    state: IdentityAvailableState
    backupPath: string
  }>
}>

export function createIdentityRendererClient(
  invoker: DomainRendererCapabilityInvoker
): IdentityRendererClient {
  return Object.freeze({
    inspect: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.inspect,
      effect: 'read',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: identityUiStateSchema
    }, {}),
    listAccounts: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.listAccounts,
      effect: 'read',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: identityListAccountsOutputSchema
    }, {}),
    createAccount: (username) => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.createAccount,
      effect: 'external-write',
      inputSchema: usernameInputSchema,
      outputSchema: identityAvailableStateSchema
    }, { username }),
    selectAccount: (userId) => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.selectAccount,
      effect: 'external-write',
      inputSchema: accountSelectionInputSchema,
      outputSchema: identityAvailableStateSchema
    }, { userId }),
    renameAccount: (userId, username) => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.renameAccount,
      effect: 'external-write',
      inputSchema: accountRenameInputSchema,
      outputSchema: identityAvailableStateSchema
    }, { userId, username }),
    exitAccount: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.exitAccount,
      effect: 'external-write',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: identityAvailableStateSchema
    }, {}),
    dismissFirstPrompt: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.dismissFirstPrompt,
      effect: 'external-write',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: identityAvailableStateSchema
    }, {}),
    backupAndReset: (secondConfirmation) => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.backupAndReset,
      effect: 'destructive',
      inputSchema: identityBackupAndResetInputSchema,
      outputSchema: identityBackupAndResetOutputSchema
    }, { secondConfirmation }, { approval: { mode: 'confirmation' } })
  })
}
