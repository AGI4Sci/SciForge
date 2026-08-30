import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityInvoker,
  DomainRendererCapabilityObservation
} from '@sciforge/domain-sdk/host'
import {
  IDENTITY_CAPABILITY_IDS,
  accountRenameInputSchema,
  accountSelectionInputSchema,
  cloudDeviceRevokeInputSchema,
  cloudIdentityInspectOutputSchema,
  cloudIdentityObservationContract,
  cloudIdentitySnapshotSchema,
  emptyIdentityInputSchema,
  identityAvailableStateSchema,
  identityBackupAndResetInputSchema,
  identityBackupAndResetOutputSchema,
  identityListAccountsOutputSchema,
  identityUiStateSchema,
  usernameInputSchema,
  type IdentityAvailableState,
  type CloudIdentityInspectOutput,
  type CloudIdentitySnapshot,
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
  inspectCloud(): Promise<CloudIdentityInspectOutput>
  observeCloud(
    resource: DomainCapabilityResourceHandle
  ): Promise<DomainRendererCapabilityObservation<CloudIdentitySnapshot>>
  subscribeCloud?(
    resourceRef: string,
    listener: () => void
  ): Promise<() => void>
  loginCloud(): Promise<CloudIdentitySnapshot>
  reauthenticateCloud(): Promise<CloudIdentitySnapshot>
  logoutCloud(): Promise<CloudIdentitySnapshot>
  enrollCloudDevice(): Promise<CloudIdentitySnapshot>
  refreshCloudDevices(): Promise<CloudIdentitySnapshot>
  revokeCloudDevice(deviceId: string): Promise<CloudIdentitySnapshot>
  openCloudAccountDeletion(): Promise<CloudIdentitySnapshot>
}>

export function createIdentityRendererClient(
  invoker: DomainRendererCapabilityInvoker
): IdentityRendererClient {
  const cloudMutation = (
    actionId: string,
    inputSchema: typeof emptyIdentityInputSchema | typeof cloudDeviceRevokeInputSchema,
    input: Record<string, unknown>
  ): Promise<CloudIdentitySnapshot> => invoker.invoke({
    actionId,
    effect: 'external-write',
    inputSchema,
    outputSchema: cloudIdentitySnapshotSchema
  }, input)
  const subscribeCloud = invoker.subscribe
    ? (resourceRef: string, listener: () => void): Promise<() => void> =>
        invoker.subscribe!(resourceRef, listener)
    : undefined
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
    }, { secondConfirmation }, { approval: { mode: 'confirmation' } }),
    inspectCloud: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.cloudInspect,
      effect: 'read',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: cloudIdentityInspectOutputSchema
    }, {}),
    observeCloud: (resource) => invoker.observe(
      cloudIdentityObservationContract,
      resource
    ),
    ...(subscribeCloud ? { subscribeCloud } : {}),
    loginCloud: () => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudLogin,
      emptyIdentityInputSchema,
      {}
    ),
    reauthenticateCloud: () => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudReauthenticate,
      emptyIdentityInputSchema,
      {}
    ),
    logoutCloud: () => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudLogout,
      emptyIdentityInputSchema,
      {}
    ),
    enrollCloudDevice: () => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudEnrollDevice,
      emptyIdentityInputSchema,
      {}
    ),
    refreshCloudDevices: () => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudRefreshDevices,
      emptyIdentityInputSchema,
      {}
    ),
    revokeCloudDevice: (deviceId) => cloudMutation(
      IDENTITY_CAPABILITY_IDS.cloudRevokeDevice,
      cloudDeviceRevokeInputSchema,
      { deviceId }
    ),
    openCloudAccountDeletion: () => invoker.invoke({
      actionId: IDENTITY_CAPABILITY_IDS.cloudOpenAccountDeletion,
      effect: 'destructive',
      inputSchema: emptyIdentityInputSchema,
      outputSchema: cloudIdentitySnapshotSchema
    }, {}, { approval: { mode: 'confirmation' } })
  })
}
