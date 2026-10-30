import {
  WORKSPACE_HOST_OPERATIONS,
  type WorkspaceHostProcessCreateInput
} from '@sciforge/domain-sdk/workspace-host'
import {
  BoundWorkspaceHostClient,
  type WorkspaceHostClientBinding
} from '../services/workspace-host-client-adapter'
import {
  requireWorkspaceLocatorRoot,
  workspaceHostWirePath
} from '../services/workspace-host-path'
import {
  CONTROLLED_PROCESS_DEFAULT_COLUMNS,
  CONTROLLED_PROCESS_DEFAULT_ROWS,
  CONTROLLED_PROCESS_MAX_SESSIONS,
  type ControlledProcessCreateInput,
  type ControlledProcessCreateResult,
  type ControlledProcessReadInput,
  type ControlledProcessReadResult
} from './controlled-process-service'

export type WorkspaceHostControlledProcessServiceOptions =
  WorkspaceHostClientBinding & Readonly<{
    maxSessions?: number
  }>

type RemoteProcessLease = Readonly<{
  ownerId: string
  processId: string
}>

/**
 * Owner-scoped controlled-process facade backed by one Workspace Host client.
 *
 * It mirrors the local service's public operations while keeping remote process
 * identifiers behind the same owner checks.
 */
export class WorkspaceHostControlledProcessService {
  readonly #host: BoundWorkspaceHostClient
  readonly #maxSessions: number
  readonly #leases = new Map<string, RemoteProcessLease>()

  constructor(options: WorkspaceHostControlledProcessServiceOptions) {
    this.#host = new BoundWorkspaceHostClient(options)
    this.#maxSessions = Math.max(
      1,
      Math.min(
        CONTROLLED_PROCESS_MAX_SESSIONS,
        options.maxSessions ?? CONTROLLED_PROCESS_MAX_SESSIONS
      )
    )
  }

  async create(input: ControlledProcessCreateInput): Promise<ControlledProcessCreateResult> {
    const ownerId = requireOwnerId(input.ownerId)
    requireWorkspaceLocatorRoot(this.#host.locator, input.workspaceRoot)
    if (this.#leases.size >= this.#maxSessions) {
      throw new Error(`Controlled process session limit reached (${this.#maxSessions}).`)
    }
    const request: WorkspaceHostProcessCreateInput = {
      profile: 'system-shell',
      cwd: workspaceHostWirePath(this.#host.locator, input.cwd),
      terminal: {
        columns: input.columns ?? CONTROLLED_PROCESS_DEFAULT_COLUMNS,
        rows: input.rows ?? CONTROLLED_PROCESS_DEFAULT_ROWS
      }
    }
    const result = await this.#host.request(WORKSPACE_HOST_OPERATIONS.processCreate, request)
    if (this.#leases.has(result.processId)) {
      throw new Error('Workspace Host returned a duplicate controlled process identifier.')
    }
    this.#leases.set(result.processId, {
      ownerId,
      processId: result.processId
    })
    return {
      resourceId: result.processId,
      cursor: result.cursor
    }
  }

  async read(input: ControlledProcessReadInput): Promise<ControlledProcessReadResult> {
    const lease = this.#requireOwned(input.ownerId, input.resourceId)
    const result = await this.#host.request(WORKSPACE_HOST_OPERATIONS.processRead, {
      processId: lease.processId,
      cursor: input.cursor,
      maxCharacters: input.maxCharacters,
      waitMilliseconds: input.waitMilliseconds
    })
    return {
      ...result,
      chunks: result.chunks.map((chunk) => ({
        stream: 'stdout' as const,
        data: chunk.data
      }))
    }
  }

  async write(ownerId: string, resourceId: string, data: string): Promise<number> {
    const lease = this.#requireOwned(ownerId, resourceId)
    const result = await this.#host.request(WORKSPACE_HOST_OPERATIONS.processWrite, {
      processId: lease.processId,
      data
    })
    return result.acceptedCharacters
  }

  async resize(
    ownerId: string,
    resourceId: string,
    columns: number,
    rows: number
  ): Promise<void> {
    const lease = this.#requireOwned(ownerId, resourceId)
    await this.#host.request(WORKSPACE_HOST_OPERATIONS.processResize, {
      processId: lease.processId,
      columns,
      rows
    })
  }

  async dispose(ownerId: string, resourceId: string): Promise<boolean> {
    const lease = this.#leases.get(resourceId)
    if (!lease || lease.ownerId !== ownerId) return false
    await this.#host.request(WORKSPACE_HOST_OPERATIONS.processDispose, {
      processId: lease.processId
    })
    this.#leases.delete(resourceId)
    return true
  }

  async disposeOwner(ownerId: string): Promise<void> {
    const leases = [...this.#leases.values()].filter((lease) => lease.ownerId === ownerId)
    await Promise.all(leases.map((lease) => this.dispose(ownerId, lease.processId)))
  }

  async disposeAll(): Promise<void> {
    const leases = [...this.#leases.values()]
    await Promise.all(leases.map((lease) => this.dispose(lease.ownerId, lease.processId)))
  }

  has(ownerId: string, resourceId: string): boolean {
    const lease = this.#leases.get(resourceId)
    return Boolean(lease && lease.ownerId === ownerId)
  }

  #requireOwned(ownerId: string, resourceId: string): RemoteProcessLease {
    const lease = this.#leases.get(resourceId)
    if (!lease || lease.ownerId !== ownerId) {
      throw new Error('Controlled process session is unavailable to this caller.')
    }
    return lease
  }
}

function requireOwnerId(value: string): string {
  const ownerId = value.trim()
  if (!ownerId) throw new Error('Controlled process owner is required.')
  return ownerId
}
