import type {
  DomainRendererCapabilityObservation,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  REMOTE_SSH_CAPABILITY_IDS,
  REMOTE_SSH_TARGET_RESOURCE_KIND,
  remoteSshBindingGetInputSchema,
  remoteSshBindingGetResultSchema,
  remoteSshBindingSaveInputSchema,
  remoteSshBindingSaveResultSchema,
  remoteSshCommandCancelInputSchema,
  remoteSshCommandCancelResultSchema,
  remoteSshCommandExecuteInputSchema,
  remoteSshCommandExecuteResultSchema,
  remoteSshFileDownloadInputSchema,
  remoteSshFileDownloadResultSchema,
  remoteSshFileUploadInputSchema,
  remoteSshFileUploadResultSchema,
  remoteSshLabDeleteInputSchema,
  remoteSshLabDeleteResultSchema,
  remoteSshLabEnvironmentEnsureInputSchema,
  remoteSshLabEnvironmentGetInputSchema,
  remoteSshLabEnvironmentOpenConsoleInputSchema,
  remoteSshLabEnvironmentOpenConsoleResultSchema,
  remoteSshLabEnvironmentResultSchema,
  remoteSshLabEnvironmentStopInputSchema,
  remoteSshLabListInputSchema,
  remoteSshLabListResultSchema,
  remoteSshOpenConfigInputSchema,
  remoteSshOpenConfigResultSchema,
  remoteSshEgressSessionOpenInputSchema,
  remoteSshEgressSessionOpenResultSchema,
  remoteSshVirtualBoxMachineListInputSchema,
  remoteSshVirtualBoxMachineListResultSchema,
  remoteSshLabSaveInputSchema,
  remoteSshLabSaveResultSchema,
  remoteSshTargetDeleteInputSchema,
  remoteSshTargetDeleteResultSchema,
  remoteSshTargetCatalogInputSchema,
  remoteSshTargetCatalogResultSchema,
  remoteSshTargetListInputSchema,
  remoteSshTargetListResultSchema,
  remoteSshTargetObserveResultSchema,
  remoteSshTargetProbeInputSchema,
  remoteSshTargetProbeResultSchema,
  remoteSshTargetSaveInputSchema,
  remoteSshTargetSaveResultSchema,
  remoteSshWorkspaceHostSessionOpenInputSchema,
  remoteSshWorkspaceHostSessionOpenResultSchema,
  type RemoteSshBindingGetResult,
  type RemoteSshBindingSaveInput,
  type RemoteSshBindingSaveResult,
  type RemoteSshCommandCancelInput,
  type RemoteSshCommandCancelResult,
  type RemoteSshCommandExecuteInput,
  type RemoteSshCommandExecuteResult,
  type RemoteSshFileDownloadInput,
  type RemoteSshFileDownloadResult,
  type RemoteSshFileUploadInput,
  type RemoteSshFileUploadResult,
  type RemoteSshEgressSessionOpenResult,
  type RemoteSshLabDeleteInput,
  type RemoteSshLabDeleteResult,
  type RemoteSshLabEnvironmentOpenConsoleResult,
  type RemoteSshLabEnvironmentResult,
  type RemoteSshLabListResult,
  type RemoteSshOpenConfigResult,
  type RemoteSshVirtualBoxMachineListResult,
  type RemoteSshLabSaveInput,
  type RemoteSshLabSaveResult,
  type RemoteSshTargetDeleteInput,
  type RemoteSshTargetDeleteResult,
  type RemoteSshTargetCatalogResult,
  type RemoteSshTargetHandle,
  type RemoteSshTargetListResult,
  type RemoteSshTargetObserveResult,
  type RemoteSshTargetProbeResult,
  type RemoteSshTargetSaveInput,
  type RemoteSshTargetSaveResult,
  type RemoteSshWorkspaceHostSessionOpenInput,
  type RemoteSshWorkspaceHostSessionOpenResult
} from '../contract'

export const remoteSshCapabilityContracts = Object.freeze({
  openOpenSshConfig: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.openOpenSshConfig,
    effect: 'external-write' as const,
    inputSchema: remoteSshOpenConfigInputSchema,
    outputSchema: remoteSshOpenConfigResultSchema
  },
  listLabs: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.listLabs,
    effect: 'read' as const,
    inputSchema: remoteSshLabListInputSchema,
    outputSchema: remoteSshLabListResultSchema
  },
  listVirtualBoxMachines: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.listVirtualBoxMachines,
    effect: 'read' as const,
    inputSchema: remoteSshVirtualBoxMachineListInputSchema,
    outputSchema: remoteSshVirtualBoxMachineListResultSchema
  },
  saveLab: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.saveLab,
    effect: 'external-write' as const,
    inputSchema: remoteSshLabSaveInputSchema,
    outputSchema: remoteSshLabSaveResultSchema
  },
  deleteLab: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.deleteLab,
    effect: 'external-write' as const,
    inputSchema: remoteSshLabDeleteInputSchema,
    outputSchema: remoteSshLabDeleteResultSchema
  },
  getLabEnvironment: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.getLabEnvironment,
    effect: 'read' as const,
    inputSchema: remoteSshLabEnvironmentGetInputSchema,
    outputSchema: remoteSshLabEnvironmentResultSchema
  },
  ensureLabEnvironment: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.ensureLabEnvironment,
    effect: 'external-write' as const,
    inputSchema: remoteSshLabEnvironmentEnsureInputSchema,
    outputSchema: remoteSshLabEnvironmentResultSchema
  },
  openLabEnvironmentConsole: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.openLabEnvironmentConsole,
    effect: 'external-write' as const,
    inputSchema: remoteSshLabEnvironmentOpenConsoleInputSchema,
    outputSchema: remoteSshLabEnvironmentOpenConsoleResultSchema
  },
  stopLabEnvironment: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.stopLabEnvironment,
    effect: 'external-write' as const,
    inputSchema: remoteSshLabEnvironmentStopInputSchema,
    outputSchema: remoteSshLabEnvironmentResultSchema
  },
  getBinding: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.getBinding,
    effect: 'read' as const,
    inputSchema: remoteSshBindingGetInputSchema,
    outputSchema: remoteSshBindingGetResultSchema
  },
  saveBinding: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.saveBinding,
    effect: 'external-write' as const,
    inputSchema: remoteSshBindingSaveInputSchema,
    outputSchema: remoteSshBindingSaveResultSchema
  },
  listTargetCatalog: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.listTargetCatalog,
    effect: 'read' as const,
    inputSchema: remoteSshTargetCatalogInputSchema,
    outputSchema: remoteSshTargetCatalogResultSchema
  },
  listTargets: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.listTargets,
    effect: 'read' as const,
    inputSchema: remoteSshTargetListInputSchema,
    outputSchema: remoteSshTargetListResultSchema
  },
  probeTarget: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.probeTarget,
    effect: 'read' as const,
    inputSchema: remoteSshTargetProbeInputSchema,
    outputSchema: remoteSshTargetProbeResultSchema
  },
  openEgressSession: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.openEgressSession,
    effect: 'external-write' as const,
    inputSchema: remoteSshEgressSessionOpenInputSchema,
    outputSchema: remoteSshEgressSessionOpenResultSchema
  },
  openWorkspaceHostSession: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.openWorkspaceHostSession,
    effect: 'external-write' as const,
    inputSchema: remoteSshWorkspaceHostSessionOpenInputSchema,
    outputSchema: remoteSshWorkspaceHostSessionOpenResultSchema
  },
  saveTarget: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.saveTarget,
    effect: 'external-write' as const,
    inputSchema: remoteSshTargetSaveInputSchema,
    outputSchema: remoteSshTargetSaveResultSchema
  },
  deleteTarget: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.deleteTarget,
    effect: 'external-write' as const,
    inputSchema: remoteSshTargetDeleteInputSchema,
    outputSchema: remoteSshTargetDeleteResultSchema
  },
  executeCommand: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.executeCommand,
    effect: 'destructive' as const,
    inputSchema: remoteSshCommandExecuteInputSchema,
    outputSchema: remoteSshCommandExecuteResultSchema
  },
  cancelCommand: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.cancelCommand,
    effect: 'external-write' as const,
    inputSchema: remoteSshCommandCancelInputSchema,
    outputSchema: remoteSshCommandCancelResultSchema
  },
  uploadFile: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.uploadFile,
    effect: 'external-write' as const,
    inputSchema: remoteSshFileUploadInputSchema,
    outputSchema: remoteSshFileUploadResultSchema
  },
  downloadFile: {
    actionId: REMOTE_SSH_CAPABILITY_IDS.downloadFile,
    effect: 'workspace-write' as const,
    inputSchema: remoteSshFileDownloadInputSchema,
    outputSchema: remoteSshFileDownloadResultSchema
  }
})

export const remoteSshTargetObservationContract = Object.freeze({
  resourceKind: REMOTE_SSH_TARGET_RESOURCE_KIND,
  stateSchema: remoteSshTargetObserveResultSchema
})

export type RemoteSshMutationConfirmation = Readonly<{
  approval: Readonly<{ mode: 'confirmation' }>
}>

export type RemoteSshCapabilityClient = Readonly<{
  openOpenSshConfig: (
    confirmation: RemoteSshMutationConfirmation
  ) => Promise<RemoteSshOpenConfigResult>
  listLabs: () => Promise<RemoteSshLabListResult>
  listVirtualBoxMachines: () => Promise<RemoteSshVirtualBoxMachineListResult>
  saveLab: (input: RemoteSshLabSaveInput, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshLabSaveResult>
  deleteLab: (input: RemoteSshLabDeleteInput, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshLabDeleteResult>
  getLabEnvironment: (labId: string) => Promise<RemoteSshLabEnvironmentResult>
  ensureLabEnvironment: (labId: string, expectedRevision: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshLabEnvironmentResult>
  openLabEnvironmentConsole: (labId: string, expectedRevision: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshLabEnvironmentOpenConsoleResult>
  stopLabEnvironment: (labId: string, expectedRevision: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshLabEnvironmentResult>
  getBinding: (workspaceId: string) => Promise<RemoteSshBindingGetResult>
  saveBinding: (workspaceId: string, input: RemoteSshBindingSaveInput, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshBindingSaveResult>
  listTargetCatalog: () => Promise<RemoteSshTargetCatalogResult>
  listTargets: (workspaceId: string) => Promise<RemoteSshTargetListResult>
  observeTarget: (resource: RemoteSshTargetHandle, workspaceId: string) => Promise<DomainRendererCapabilityObservation<RemoteSshTargetObserveResult>>
  probeTarget: (resource: RemoteSshTargetHandle, workspaceId: string) => Promise<RemoteSshTargetProbeResult>
  openEgressSession: (resource: RemoteSshTargetHandle, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshEgressSessionOpenResult>
  openWorkspaceHostSession: (resource: RemoteSshTargetHandle, input: RemoteSshWorkspaceHostSessionOpenInput, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshWorkspaceHostSessionOpenResult>
  saveTarget: (input: RemoteSshTargetSaveInput, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshTargetSaveResult>
  deleteTarget: (input: RemoteSshTargetDeleteInput, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshTargetDeleteResult>
  executeCommand: (resource: RemoteSshTargetHandle, input: RemoteSshCommandExecuteInput, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshCommandExecuteResult>
  cancelCommand: (input: RemoteSshCommandCancelInput, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshCommandCancelResult>
  uploadFile: (resource: RemoteSshTargetHandle, input: RemoteSshFileUploadInput, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshFileUploadResult>
  downloadFile: (resource: RemoteSshTargetHandle, input: RemoteSshFileDownloadInput, workspaceId: string, confirmation: RemoteSshMutationConfirmation) => Promise<RemoteSshFileDownloadResult>
}>

export function createRemoteSshCapabilityClient(
  client: DomainRendererCapabilityInvoker
): RemoteSshCapabilityClient {
  return Object.freeze({
    openOpenSshConfig: (confirmation) =>
      client.invoke(remoteSshCapabilityContracts.openOpenSshConfig, {}, confirmation),
    listLabs: () => client.invoke(remoteSshCapabilityContracts.listLabs, {}),
    listVirtualBoxMachines: () =>
      client.invoke(remoteSshCapabilityContracts.listVirtualBoxMachines, {}),
    saveLab: (input, confirmation) => client.invoke(remoteSshCapabilityContracts.saveLab, input, confirmation),
    deleteLab: (input, confirmation) => client.invoke(remoteSshCapabilityContracts.deleteLab, input, confirmation),
    getLabEnvironment: (labId) => client.invoke(remoteSshCapabilityContracts.getLabEnvironment, { labId }),
    ensureLabEnvironment: (labId, expectedRevision, confirmation) => client.invoke(
      remoteSshCapabilityContracts.ensureLabEnvironment,
      { labId, expectedRevision },
      confirmation
    ),
    openLabEnvironmentConsole: (labId, expectedRevision, confirmation) => client.invoke(
      remoteSshCapabilityContracts.openLabEnvironmentConsole,
      { labId, expectedRevision },
      confirmation
    ),
    stopLabEnvironment: (labId, expectedRevision, confirmation) => client.invoke(
      remoteSshCapabilityContracts.stopLabEnvironment,
      { labId, expectedRevision },
      confirmation
    ),
    getBinding: (workspaceId) => client.invoke(remoteSshCapabilityContracts.getBinding, {}, { workspaceId }),
    saveBinding: (workspaceId, input, confirmation) => client.invoke(
      remoteSshCapabilityContracts.saveBinding,
      input,
      { workspaceId, ...confirmation }
    ),
    listTargetCatalog: () => client.invoke(remoteSshCapabilityContracts.listTargetCatalog, {}),
    listTargets: (workspaceId) => client.invoke(
      remoteSshCapabilityContracts.listTargets,
      {},
      { workspaceId }
    ),
    observeTarget: (resource, workspaceId) => client.observe(
      remoteSshTargetObservationContract,
      resource,
      { workspaceId }
    ),
    probeTarget: (resource, workspaceId) => client.invoke(
      remoteSshCapabilityContracts.probeTarget,
      {},
      { resource, workspaceId }
    ),
    openEgressSession: (resource, workspaceId, confirmation) => client.invoke(
      remoteSshCapabilityContracts.openEgressSession,
      {},
      {
        workspaceId,
        resource,
        expectedRevision: resource.semanticRevision,
        ...confirmation
      }
    ),
    openWorkspaceHostSession: (
      resource,
      input,
      workspaceId,
      confirmation
    ) => client.invoke(
      remoteSshCapabilityContracts.openWorkspaceHostSession,
      input,
      {
        workspaceId,
        resource,
        expectedRevision: resource.semanticRevision,
        ...confirmation
      }
    ),
    saveTarget: (input, confirmation) => client.invoke(remoteSshCapabilityContracts.saveTarget, input, confirmation),
    deleteTarget: (input, confirmation) => client.invoke(remoteSshCapabilityContracts.deleteTarget, input, confirmation),
    executeCommand: (resource, input, workspaceId, confirmation) => client.invoke(
      remoteSshCapabilityContracts.executeCommand,
      input,
      { workspaceId, resource, expectedRevision: resource.semanticRevision, ...confirmation }
    ),
    cancelCommand: (input, workspaceId, confirmation) => client.invoke(
      remoteSshCapabilityContracts.cancelCommand,
      input,
      { workspaceId, ...confirmation }
    ),
    uploadFile: (resource, input, workspaceId, confirmation) => client.invoke(
      remoteSshCapabilityContracts.uploadFile,
      input,
      { workspaceId, resource, expectedRevision: resource.semanticRevision, ...confirmation }
    ),
    downloadFile: (resource, input, workspaceId, confirmation) => client.invoke(
      remoteSshCapabilityContracts.downloadFile,
      input,
      { workspaceId, resource, expectedRevision: resource.semanticRevision, ...confirmation }
    )
  })
}
