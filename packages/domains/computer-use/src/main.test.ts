import { describe, expect, it, vi } from 'vitest'
import { createDomainMainEntry } from './main'
import { domainPackageDefinition } from './definition'

describe('Computer Use main domain entry', () => {
  it('declares generic host contributions and constructs capabilities lazily', () => {
    const getUserDataDir = vi.fn(() => 'C:/test/user-data')
    const entry = createDomainMainEntry({
      defineCapability: (definition: unknown) => definition,
      getUserDataDir
    } as never)

    expect(entry.definition).toBe(domainPackageDefinition)
    expect(entry.contributions.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'main.capability-factory:computer-use.capabilities',
      'main.runtime-lifecycle:computer-use.runtime-lifecycle',
      'main.runtime-mcp-server:computer-use.runtime-mcp-server',
      'main.mcp-trusted-invocation-metadata:computer-use.trusted-invocation-metadata'
    ])
    const capabilityFactory = entry.contributions[0]?.value as {
      createDefinitions(): ReadonlyArray<{ id: string }>
    }
    expect(capabilityFactory.createDefinitions().map(({ id }) => id)).toEqual([
      'computer-use.status',
      'computer-use.request-permission'
    ])
    expect(getUserDataDir).not.toHaveBeenCalled()

    const metadata = entry.contributions[3]?.value
    expect(metadata).toMatchObject({
      serverId: 'gui_owl_computer_use',
      tools: ['computer_use'],
      metadataKey: 'io.sciforge/computer-use-invocation',
      source: 'trusted-invocation'
    })
  })
})
