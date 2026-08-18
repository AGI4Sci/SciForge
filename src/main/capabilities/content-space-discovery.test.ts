import { describe, expect, it } from 'vitest'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { CONTENT_SPACE_CAPABILITY_IDS } from '@sciforge/domain-content-space/contract'
import { CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION } from '@sciforge/domain-content-space/definition'
import { createDomainMainEntry } from '@sciforge/domain-content-space/main'

import { CapabilityRegistry, defineCapability, type CapabilityDefinition } from './registry'

describe('Content Space Agent discovery integration', () => {
  it('routes external Team library file intents to native root authorization', () => {
    const entry = createDomainMainEntry({ defineCapability } as unknown as DomainMainHost)
    const factory = entry.contributions.find(({ id }) =>
      id === CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id
    )?.value as Readonly<{ createDefinitions(): readonly CapabilityDefinition[] }> | undefined
    if (!factory) throw new Error('Content Space capability factory is missing.')
    const registry = new CapabilityRegistry(factory.createDefinitions())
    const caller = {
      audience: 'agent' as const,
      callerId: 'content-space-discovery-agent',
      workspaceId: '/workspace'
    }
    const query = {
      text: 'OpenContent team library create folder upload',
      scope: 'global' as const,
      limit: 10
    }

    expect(registry.discover(caller, query).map(({ id }) => id))
      .toContain(CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    expect(registry.discover(caller, { ...query, providerFamily: 'managed-mcp' }))
      .toEqual([])
  })
})
