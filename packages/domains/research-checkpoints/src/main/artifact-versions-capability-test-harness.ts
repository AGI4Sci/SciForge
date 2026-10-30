import {
  ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS
} from '@sciforge/domain-artifact-versions/contract'
import {
  createDomainMainEntry as createArtifactVersionsDomainMainEntry,
  type ArtifactVersionsCapabilityFactory,
  type ArtifactVersionsCapabilityOptions
} from '@sciforge/domain-artifact-versions/main'
import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'

const RESEARCH_CHECKPOINTS_ACCESS = Object.freeze({
  audience: 'system' as const,
  callerId: 'domain-runtime:sciforge.research-checkpoints',
  capabilityGrants: Object.freeze([
    ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities
  ])
})

export type ArtifactVersionsCapabilityTestHarness = Readonly<{
  invoker: DomainMainSystemCapabilityInvoker
  invokeAction<TOutput = unknown>(
    actionId: string,
    input: unknown,
    workspaceId: string
  ): Promise<TOutput>
  dispose(): Promise<void>
}>

/**
 * Activates Artifact Versions through its published domain entry and invokes
 * only the capability definitions it contributes. This deliberately avoids
 * importing package-private service implementation paths in consumer tests.
 */
export async function createArtifactVersionsCapabilityTestHarness(
  userDataDir: string
): Promise<ArtifactVersionsCapabilityTestHarness> {
  const entry = createArtifactVersionsDomainMainEntry<ArtifactVersionsCapabilityOptions>({
    defineCapability: (definition: ArtifactVersionsCapabilityOptions) => definition
  } as never)
  const factory = entry.contributions.find(
    ({ kind }) => kind === 'main.capability-factory'
  )?.value as ArtifactVersionsCapabilityFactory<ArtifactVersionsCapabilityOptions> | undefined
  const lifecycle = entry.contributions.find(
    ({ kind }) => kind === 'main.runtime-lifecycle'
  )?.value as { activate(context: unknown): Promise<() => void | Promise<void>> } | undefined
  if (!factory) throw new Error('Artifact Versions capability factory contribution is required.')
  if (!lifecycle) throw new Error('Artifact Versions lifecycle contribution is required.')

  const dispose = await lifecycle.activate({ userDataDir })
  const definitions = new Map(
    factory.createDefinitions().map((definition) => [definition.id, definition])
  )
  const invokeAction = async <TOutput>(
    actionId: string,
    input: unknown,
    workspaceId: string
  ): Promise<TOutput> => {
    const definition = definitions.get(actionId)
    if (!definition) throw new Error(`Missing Artifact Versions capability ${actionId}`)
    const result = await definition.handler(input, {
      caller: { ...RESEARCH_CHECKPOINTS_ACCESS, workspaceId }
    })
    return definition.outputSchema.parse(result.output) as TOutput
  }
  const invoker: DomainMainSystemCapabilityInvoker = Object.freeze({
    invoke: async <TInput, TOutput>(
      contract: DomainCapabilityContract<TInput, TOutput>,
      input: TInput,
      options?: Readonly<{ workspaceId?: string }>
    ): Promise<TOutput> => {
      const workspaceId = options?.workspaceId?.trim()
      if (!workspaceId) throw new Error('Artifact Versions test invocation requires workspace scope.')
      return contract.outputSchema.parse(await invokeAction(
        contract.actionId,
        input,
        workspaceId
      ))
    },
    createApprovedBatch: () => {
      throw new Error('Artifact Versions test harness does not create approved capability batches.')
    }
  })
  return Object.freeze({
    invoker,
    invokeAction,
    dispose: async () => { await dispose() }
  })
}
