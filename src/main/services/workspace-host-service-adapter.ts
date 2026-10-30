import {
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostDirectoryListInput,
  type WorkspaceHostDirectoryListOutput,
  type WorkspaceHostFileReadInput,
  type WorkspaceHostFileReadOutput,
  type WorkspaceHostFileReadRangeInput,
  type WorkspaceHostFileStatInput,
  type WorkspaceHostFileStatOutput,
  type WorkspaceHostFileUnwatchInput,
  type WorkspaceHostFileWatchInput,
  type WorkspaceHostFileWatchOutput,
  type WorkspaceHostFileWriteInput,
  type WorkspaceHostFileWriteOutput,
  type WorkspaceHostMutationOutput,
  type WorkspaceHostTextSearchInput,
  type WorkspaceHostTextSearchOutput
} from '@sciforge/domain-sdk/workspace-host'
import type {
  VersionControlDiffInput,
  VersionControlStatusOutput,
  VersionControlTextOutput
} from '@sciforge/domain-sdk/version-control'
import {
  BoundWorkspaceHostClient,
  type WorkspaceHostClientBinding
} from './workspace-host-client-adapter'

type DefaultableWorkspacePath = Readonly<{ path?: string }>

export type WorkspaceHostDirectoryListRequest =
  Omit<WorkspaceHostDirectoryListInput, 'path'> & DefaultableWorkspacePath
export type WorkspaceHostFileStatRequest =
  Omit<WorkspaceHostFileStatInput, 'path'> & DefaultableWorkspacePath
export type WorkspaceHostTextSearchRequest =
  Omit<WorkspaceHostTextSearchInput, 'path'> & DefaultableWorkspacePath

/**
 * Service-facing adapter for filesystem, search, and version-control operations
 * owned by a selected Workspace Host.
 */
export class WorkspaceHostServiceAdapter {
  readonly #host: BoundWorkspaceHostClient

  constructor(binding: WorkspaceHostClientBinding) {
    this.#host = new BoundWorkspaceHostClient(binding)
  }

  get locator(): WorkspaceHostClientBinding['locator'] {
    return this.#host.locator
  }

  listDirectory(
    input: WorkspaceHostDirectoryListRequest = {}
  ): Promise<WorkspaceHostDirectoryListOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.directoryList, {
      ...input,
      path: input.path ?? '.'
    })
  }

  stat(input: WorkspaceHostFileStatRequest = {}): Promise<WorkspaceHostFileStatOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.fileStat, {
      ...input,
      path: input.path ?? '.'
    })
  }

  readFile(input: WorkspaceHostFileReadInput): Promise<WorkspaceHostFileReadOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.fileRead, input)
  }

  readFileRange(input: WorkspaceHostFileReadRangeInput): Promise<WorkspaceHostFileReadOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.fileReadRange, input)
  }

  writeFile(input: WorkspaceHostFileWriteInput): Promise<WorkspaceHostFileWriteOutput> {
    return this.#host.request(
      WORKSPACE_HOST_OPERATIONS.fileWrite,
      input,
      input.expectedRevision ? { expectedRevision: input.expectedRevision } : undefined
    )
  }

  watchFile(input: WorkspaceHostFileWatchInput): Promise<WorkspaceHostFileWatchOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.fileWatch, input)
  }

  unwatchFile(input: WorkspaceHostFileUnwatchInput): Promise<WorkspaceHostMutationOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.fileUnwatch, input)
  }

  searchText(input: WorkspaceHostTextSearchRequest): Promise<WorkspaceHostTextSearchOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.textSearch, {
      ...input,
      path: input.path ?? '.'
    })
  }

  versionControlStatus(): Promise<VersionControlStatusOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.versionControlStatus, {})
  }

  versionControlDiff(input: VersionControlDiffInput): Promise<VersionControlTextOutput> {
    return this.#host.request(WORKSPACE_HOST_OPERATIONS.versionControlDiff, input)
  }
}
