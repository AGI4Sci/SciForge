import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import type { OpenContentExternalBindingAttestation } from './contract.js'
import type {
  OpenContentBoundTeamAdministration,
  OpenContentIdentityId
} from './team-administration-contract.js'
import type { DocflowCommandInvocation } from './supplier-docflow-protocol.js'
import type { OpenContentExtendedCommandInvocation } from './supplier-extended-operation-protocol.js'

export {
  DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
  docflowCommandInvocationSchema,
  docflowNativeDocumentConflictReceiptSchema,
  docflowNativeDocumentFailureReceiptSchema,
  docflowNativeDocumentOutcomeUnknownReceiptSchema,
  docflowNativeDocumentReceiptSchema,
  docflowNativeDocumentSuccessReceiptSchema,
  docflowTransportErrorSchema,
  docflowTransportResultSchema
} from './supplier-docflow-protocol.js'
export type {
  DocflowCommand,
  DocflowCommandInvocation,
  DocflowCommandTransport,
  DocflowNativeDocumentReceipt
} from './supplier-docflow-protocol.js'
export {
  openContentExtendedCommandInvocationSchema,
  openContentExtendedCommandSuccessSchema
} from './supplier-extended-operation-protocol.js'
export type {
  OpenContentExtendedCommandTransport,
  OpenContentExtendedDataFile,
  OpenContentExtendedOperationCommand,
  OpenContentExtendedUploadSource
} from './supplier-extended-operation-protocol.js'

/**
 * The only supplier invocation boundary exposed by the Connector. It contains
 * typed, token-free command data and never carries argv, environment, paths,
 * credentials, or executable selection.
 */
export type OpenContentSupplierInvocation =
  | DocflowCommandInvocation
  | OpenContentExtendedCommandInvocation

const OPENCONTENT_SUPPLIER_MUTATION_COMMANDS = Object.freeze([
  'file-edit',
  'folder-edit',
  'upload',
  'attach-remove',
  'relation-create',
  'relation-remove',
  'publish',
  'create-share',
  'cancel-publish',
  'cancel-share',
  'rename',
  'copy',
  'move',
  'delete',
  'file-tag-set',
  'file-tag-delete',
  'create-shortcut',
  'meta-edit',
  'favorite-add',
  'favorite-remove',
  'perm-set',
  'docflow-export',
  'docflow-create',
  'docflow-image-upload',
  'docflow-image-download'
] as const satisfies readonly OpenContentSupplierInvocation['command'][])
const openContentSupplierMutationCommands = new Set<string>(
  OPENCONTENT_SUPPLIER_MUTATION_COMMANDS
)

/** True only when a started supplier command may have changed external state. */
export function isOpenContentSupplierMutationCommand(command: string): boolean {
  return openContentSupplierMutationCommands.has(command)
}

export interface OpenContentSupplierCommandTransport {
  invoke(invocation: OpenContentSupplierInvocation): Promise<unknown>
}

export type OpenContentSupplierExecutionContext = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  expectedBindingAttestation?: OpenContentExternalBindingAttestation
  invocationId: string
  deadlineAt: string
  signal: AbortSignal
  assertPrincipalCurrent(): void | Promise<void>
}>

/**
 * One currently observable, token-free hierarchy edge. Provider numeric IDs
 * remain Connector-private and are never part of this contract.
 */
export type OpenContentEntryParentFact = Readonly<{
  child:
    | Readonly<{ kind: 'container'; resourceGuid: string }>
    | Readonly<{ kind: 'file'; resourceGuid: string }>
  parent?: Readonly<{ kind: 'container'; resourceGuid: string }>
}>

export type OpenContentObservedEntry =
  | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
  | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>

/** Exact token-free file fact re-read after one upload-new write. */
export type OpenContentUploadWriteAfterObservation = Readonly<{
  parentFolderGuid: string
  fileGuid: string
  name: string
  size: number
}>

/**
 * Opaque one-use read authorization. It contains no Token, URL, Provider
 * locator, or reusable handle and remains inside the Connector/Provider main
 * process boundary.
 */
export type OpenContentDownloadAuthorizationLease = Readonly<{
  consume(input: Readonly<{
    write(chunk: Uint8Array): Promise<void>
  }>): Promise<Readonly<{ bytesWritten: number }>>
  retire(): Promise<void>
}>

/**
 * One proof-scoped view of the exact current Connector session. The session
 * owns the Token and Provider numeric identities; its caller receives only
 * generic, token-free observations and the captured binding attestation.
 */
export type OpenContentHierarchyProofSession = Readonly<{
  bindingAttestation: OpenContentExternalBindingAttestation
  observeContainer(input: Readonly<{
    resourceGuid: string
  }>): Promise<Readonly<{
    kind: 'container'
    folderGuid: string
    label: string
  }>>
  observeEntryParent(input: Readonly<{
    kind: 'container' | 'file'
    resourceGuid: string
  }>): Promise<OpenContentEntryParentFact>
}>

/** The token-free main-process contract acquired by the pinned Provider. */
export type OpenContentContentSpaceFacade = Readonly<{
  attestExternalBinding(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentExternalBindingAttestation>
  useSupplierTransport?: <T>(
    input: OpenContentSupplierExecutionContext,
    operation: (transport: OpenContentSupplierCommandTransport) => T | Promise<T>
  ) => Promise<T>
  useTeamAdministration<T>(
    input: Readonly<{
      principal: PrincipalSnapshot
      providerInstanceRef: string
      expectedBindingAttestation?: OpenContentExternalBindingAttestation
      signal?: AbortSignal
      assertPrincipalCurrent(): void | Promise<void>
    }>,
    operation: (session: Readonly<{
      externalIdentityId: OpenContentIdentityId
      administration: OpenContentBoundTeamAdministration
    }>) => T | Promise<T>
  ): Promise<T>
  useHierarchyProofSession<T>(
    input: Readonly<{
      principal: PrincipalSnapshot
      providerInstanceRef: string
      expectedBindingAttestation: OpenContentExternalBindingAttestation
      signal: AbortSignal
      assertPrincipalCurrent(): void | Promise<void>
    }>,
    operation: (session: OpenContentHierarchyProofSession) => T | Promise<T>
  ): Promise<T>
  listRootFolders(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation?: OpenContentExternalBindingAttestation
    teamPage: number
    teamPageSize: number
    includePersonal?: boolean
    includeTeams?: boolean
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    roots: readonly Readonly<{
      source: 'personal-root' | 'team-root'
      folderGuid: string
      label: string
    }>[]
    nextTeamPage?: number
  }>>
  listFolderEntries(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation?: OpenContentExternalBindingAttestation
    parentFolderGuid: string
    page: number
    pageSize: number
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    parentFolderGuid: string
    entries: readonly (
      | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
      | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>
    )[]
    nextPage?: number
  }>>
  observeEntry(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation?: OpenContentExternalBindingAttestation
    kind: 'container' | 'file'
    resourceGuid: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentObservedEntry>
  createFolder(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation?: OpenContentExternalBindingAttestation
    parentFolderGuid: string
    name: string
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{ folderGuid: string }>>
  uploadNewFile(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation?: OpenContentExternalBindingAttestation
    parentFolderGuid: string
    name: string
    size: number
    read(range: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    fileGuid: string
    writeAfterObservation: OpenContentUploadWriteAfterObservation
  }>>
  authorizeDownload(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    expectedBindingAttestation: OpenContentExternalBindingAttestation
    fileGuid: string
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentDownloadAuthorizationLease>
}>
