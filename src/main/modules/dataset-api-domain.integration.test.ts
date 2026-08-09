import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATASET_API_CAPABILITY_IDS } from '@sciforge/domain-dataset-api/main'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from '../capabilities/agent-tools'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe('installed Dataset API domain package', () => {
  it('discovers and invokes Dataset operations through the generic agent surface', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-domain-'))
    temporaryDirectories.push(workspaceRoot)
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => workspaceRoot
    })
    const broker = new CapabilityBroker(
      createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
    )
    const agent = createCapabilityAgentToolSurface({
      broker,
      resolveCaller: () => ({
        audience: 'agent',
        callerId: 'dataset-domain-test',
        workspaceId: workspaceRoot
      })
    })
    const context = {
      requestId: 'request-1',
      runtimeId: 'codex',
      threadId: 'thread-1'
    }

    const discovery = await agent.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.discover,
      arguments: { tags: ['dataset'], limit: Object.keys(DATASET_API_CAPABILITY_IDS).length },
      context
    })
    expect(discovery.tool).toBe(CAPABILITY_AGENT_TOOL_NAMES.discover)
    if (discovery.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover) {
      throw new Error('Expected Dataset capability discovery result.')
    }
    // `dataset` is a cross-domain tag, while credential-bearing registration
    // actions are intentionally UI-only. Assert the operations exercised by
    // this Agent integration instead of coupling discovery to the contract's
    // total action count.

    const register = discovery.value.find(({ title }) =>
      title === 'Register a built-in dataset provider'
    )
    expect(register).toBeDefined()
    const registered = await agent.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: {
        operationRef: register?.operationRef,
        input: { providerId: 'uniprot' }
      },
      context
    })
    expect(registered).toMatchObject({
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      value: {
        output: {
          datasetApi: {
            actionId: DATASET_API_CAPABILITY_IDS.registerProvider,
            success: true,
            result: {
              source: { id: 'uniprot' }
            }
          }
        }
      }
    })

    const list = discovery.value.find(({ title }) =>
      title === 'List registered dataset databases'
    )
    expect(list).toBeDefined()
    const listed = await agent.call({
      name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      arguments: { operationRef: list?.operationRef, input: {} },
      context
    })
    expect(listed).toMatchObject({
      tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
      value: {
        output: {
          datasetApi: {
            actionId: DATASET_API_CAPABILITY_IDS.list,
            result: {
              sources: [{ id: 'uniprot' }]
            }
          }
        }
      }
    })

    catalog.dispose()
  })
})

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}
