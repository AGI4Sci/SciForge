import {
  createDomainMainEntry as createArtifactVersionsDomainMainEntry
} from '@sciforge/domain-artifact-versions/main'
import {
  SCIENTIFIC_PLOTTING_CAPABILITY_IDS
} from '@sciforge/domain-scientific-plotting/contract'
import {
  createDomainMainEntry as createScientificPlottingDomainMainEntry
} from '@sciforge/domain-scientific-plotting/main'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const CAPABILITY_FACTORY_KIND = 'main.capability-factory'
const RUNTIME_LIFECYCLE_KIND = 'main.runtime-lifecycle'
const CALLER = Object.freeze({
  audience: 'system',
  callerId: 'scientific-plotting-smoke'
})

/**
 * Compose the real Artifact Versions and Scientific Plotting domain factories
 * for standalone smoke scripts. Calls cross the same capability contracts and
 * exact workspace scope as the application; retired plotting MCP tools are not
 * reintroduced as a compatibility transport.
 */
export async function createScientificPlottingCapabilityHarness(options) {
  const workspaceRoot = requiredAbsolutePath(options?.workspaceRoot, 'workspaceRoot')
  const userDataDir = requiredAbsolutePath(options?.userDataDir, 'userDataDir')
  await mkdir(userDataDir, { recursive: true })

  const artifactEntry = createArtifactVersionsDomainMainEntry({
    getUserDataDir: () => userDataDir,
    defineCapability: identity
  })
  const artifactFactory = requireContribution(
    artifactEntry,
    CAPABILITY_FACTORY_KIND,
    'Artifact Versions capability factory'
  ).value
  const artifactLifecycle = requireContribution(
    artifactEntry,
    RUNTIME_LIFECYCLE_KIND,
    'Artifact Versions runtime lifecycle'
  ).value
  const disposeArtifactRuntime = await artifactLifecycle.activate({ userDataDir })
  const artifactDefinitions = definitionsById(artifactFactory.createDefinitions())

  const systemInvoker = Object.freeze({
    async invoke(contract, input, invocation = {}) {
      const definition = requireDefinition(artifactDefinitions, contract.actionId)
      const scopedWorkspace = requiredAbsolutePath(
        invocation.workspaceId,
        `workspace scope for ${contract.actionId}`
      )
      const parsedInput = contract.inputSchema.parse(input)
      const response = await definition.handler(
        definition.inputSchema.parse(parsedInput),
        {
          caller: {
            ...CALLER,
            workspaceId: scopedWorkspace
          }
        }
      )
      return contract.outputSchema.parse(
        definition.outputSchema.parse(response.output)
      )
    }
  })

  let plottingEntry
  try {
    plottingEntry = createScientificPlottingDomainMainEntry({
      getUserDataDir: () => userDataDir,
      defineCapability: identity,
      capabilities: systemInvoker
    })
  } catch (error) {
    await disposeArtifactRuntime()
    throw error
  }
  const plottingContribution = requireContribution(
    plottingEntry,
    CAPABILITY_FACTORY_KIND,
    'Scientific Plotting capability factory'
  )
  const plottingDefinitions = definitionsById(
    plottingContribution.value.createDefinitions()
  )
  let disposed = false

  const invoke = async (actionId, input) => {
    if (disposed) throw new Error('Scientific Plotting capability harness is disposed.')
    const definition = requireDefinition(plottingDefinitions, actionId)
    const response = await definition.handler(
      definition.inputSchema.parse(input),
      {
        caller: {
          ...CALLER,
          ...(definition.scope === 'workspace' ? { workspaceId: workspaceRoot } : {})
        }
      }
    )
    return definition.outputSchema.parse(response.output)
  }

  return Object.freeze({
    status: () => invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status, {}),
    mapData: (input) => invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData, input),
    render: (input) => invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render, input),
    async dispose() {
      if (disposed) return
      disposed = true
      await plottingContribution.onDispose?.()
      await disposeArtifactRuntime()
    }
  })
}

function identity(value) {
  return value
}

function definitionsById(definitions) {
  const entries = definitions.map((definition) => [definition.id, definition])
  const result = new Map(entries)
  if (result.size !== entries.length) {
    throw new Error('Capability harness received duplicate action IDs.')
  }
  return result
}

function requireDefinition(definitions, actionId) {
  const definition = definitions.get(actionId)
  if (!definition) throw new Error(`Capability harness is missing action ${actionId}.`)
  return definition
}

function requireContribution(entry, kind, label) {
  const contribution = entry.contributions.find((candidate) => candidate.kind === kind)
  if (!contribution) throw new Error(`${label} contribution is missing.`)
  return contribution
}

function requiredAbsolutePath(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`Scientific Plotting capability harness requires ${label}.`)
  return resolve(normalized)
}
