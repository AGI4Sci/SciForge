import { describe, expect, it, vi } from 'vitest'
import { DOMAIN_PACKAGE_CONTRACT_VERSION } from '@sciforge/domain-sdk'
import {
  MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
  type WorkspaceHostProvider
} from '@sciforge/domain-sdk/workspace-host'

import { DomainModuleCatalog, type MainDomainModuleDefinition } from './catalog'
import {
  WorkspaceHostProviderRegistry,
  WorkspaceHostProviderRegistryError,
  listMainWorkspaceHostProviderContributions
} from './workspace-host-contributions'

function provider(): WorkspaceHostProvider {
  return {
    attach: vi.fn(async () => {
      throw new Error('not used')
    })
  }
}

function moduleEntry(input: Readonly<{
  packageName: string
  moduleId: string
  contributionId: string
  provider: unknown
  priority?: number
}>): MainDomainModuleDefinition {
  return {
    definition: {
      contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
      kind: 'trusted-compile-time' as const,
      packageName: input.packageName,
      module: {
        id: input.moduleId,
        displayName: input.moduleId,
        version: '1.2.3',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: input.priority ?? 1
      },
      entrypoints: [{
        process: 'main' as const,
        export: './main' as const,
        contributions: [{
          id: input.contributionId,
          kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
          priority: input.priority ?? 1
        }]
      }]
    },
    contributions: [{
      id: input.contributionId,
      kind: MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND,
      value: input.provider
    }]
  }
}

describe('WorkspaceHostProviderRegistry', () => {
  it('projects providers with their catalog owner and declaration identity', () => {
    const remote = provider()
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(moduleEntry({
      packageName: '@fixture/remote-workspace',
      moduleId: 'fixture.remote-workspace',
      contributionId: 'fixture.remote-workspace.provider',
      provider: remote
    }))

    expect(listMainWorkspaceHostProviderContributions(catalog)).toEqual([{
      providerId: 'fixture.remote-workspace.provider',
      owner: {
        moduleId: 'fixture.remote-workspace',
        moduleVersion: '1.2.3'
      },
      ownerDisplayName: 'fixture.remote-workspace',
      provider: remote
    }])
    const registry = new WorkspaceHostProviderRegistry(catalog)
    expect(registry.require(' fixture.remote-workspace.provider ').provider).toBe(remote)
  })

  it('rejects malformed provider values through the canonical catalog guard', () => {
    const catalog = new DomainModuleCatalog()
    catalog.registerModule(moduleEntry({
      packageName: '@fixture/invalid-workspace',
      moduleId: 'fixture.invalid-workspace',
      contributionId: 'fixture.invalid-workspace.provider',
      provider: { open: vi.fn() }
    }))

    expect(() => new WorkspaceHostProviderRegistry(catalog)).toThrow(
      /failed runtime validation/u
    )
  })

  it('fails closed for empty and unregistered provider identities', () => {
    const registry = new WorkspaceHostProviderRegistry(new DomainModuleCatalog())

    expect(() => registry.require('')).toThrow(WorkspaceHostProviderRegistryError)
    expect(() => registry.require('fixture.missing.provider')).toThrow(
      /No Workspace Host provider/u
    )
  })
})
