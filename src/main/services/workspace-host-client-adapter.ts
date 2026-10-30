import {
  parseWorkspaceHostOperationInput,
  parseWorkspaceHostOperationOutput,
  workspaceHostSessionSchema,
  workspaceLocatorSchema,
  type WorkspaceHostBuiltInOperation,
  type WorkspaceHostBuiltInOperationTypeMap,
  type WorkspaceHostClient,
  type WorkspaceHostOperationInput,
  type WorkspaceHostRequestOptions,
  type WorkspaceHostSession,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'

export type WorkspaceHostClientBinding = Readonly<{
  locator: WorkspaceLocator
  client: Pick<WorkspaceHostClient, 'getSession' | 'request'>
}>

/**
 * Binds service calls to one opaque Workspace Host session.
 *
 * Placement is selected by composition before this adapter is constructed.
 * Individual service operations therefore never branch on transport, target,
 * domain, or host identifiers.
 */
export class BoundWorkspaceHostClient {
  readonly locator: WorkspaceLocator
  readonly #client: WorkspaceHostClientBinding['client']

  constructor(binding: WorkspaceHostClientBinding) {
    this.locator = workspaceLocatorSchema.parse(binding.locator)
    this.#client = binding.client
    this.#requireCurrentSession()
  }

  get session(): WorkspaceHostSession {
    return this.#requireCurrentSession()
  }

  async request<Operation extends WorkspaceHostBuiltInOperation>(
    operation: Operation,
    input: WorkspaceHostBuiltInOperationTypeMap[Operation]['input'],
    options?: WorkspaceHostRequestOptions
  ): Promise<WorkspaceHostBuiltInOperationTypeMap[Operation]['output']> {
    const session = this.#requireCurrentSession()
    if (!session.capabilities.some((capability) => capability.operation === operation)) {
      throw new Error(`Workspace Host operation is unavailable: ${operation}`)
    }
    const parsedInput = parseWorkspaceHostOperationInput(operation, input)
    const output = await this.#client.request(
      operation,
      parsedInput as WorkspaceHostOperationInput<Operation>,
      options
    )
    return parseWorkspaceHostOperationOutput(operation, output)
  }

  #requireCurrentSession(): WorkspaceHostSession {
    const session = workspaceHostSessionSchema.parse(this.#client.getSession())
    if (
      session.sessionId !== this.locator.hostSessionId ||
      session.locator.hostSessionId !== this.locator.hostSessionId
    ) {
      throw new Error('Workspace locator does not belong to the injected Workspace Host client.')
    }
    return session
  }
}
