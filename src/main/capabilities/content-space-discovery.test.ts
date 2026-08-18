import { describe, expect, it } from 'vitest'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { CONTENT_SPACE_CAPABILITY_IDS } from '@sciforge/domain-content-space/contract'
import { CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION } from '@sciforge/domain-content-space/definition'
import { createDomainMainEntry } from '@sciforge/domain-content-space/main'

import { CapabilityRegistry, defineCapability, type CapabilityDefinition } from './registry'

describe('Content Space Agent discovery integration', () => {
  it('routes one external Team library intent through Provider, candidate, and root authorization discovery', () => {
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

    const discovered = registry.discover(caller, query)
    expect(discovered.map(({ id }) => id)).toEqual(expect.arrayContaining([
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ]))
    expect(discovered.find(({ id }) =>
      id === CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    )?.description).toMatch(/first.*provider instance/iu)
    expect(discovered.find(({ id }) =>
      id === CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )?.description).toMatch(/after.*provider instance.*human-visible/iu)
    expect(discovered.find(({ id }) =>
      id === CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    )?.description).toMatch(/exact.*label.*re-enumerates live/iu)
    expect(registry.discover(caller, { ...query, providerFamily: 'managed-mcp' }))
      .toEqual([])

    const verboseNativeProviderDiscovery = registry.discover(caller, {
      text: 'OpenContent Provider Instance list discover native',
      scope: 'global',
      providerFamily: 'native',
      effects: ['read'],
      limit: 20
    })
    expect(verboseNativeProviderDiscovery.map(({ id }) => id)).toContain(
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    )

    const humanReferenceQueries = [{
      id: CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
      text: 'Observe Immutable Content Version'
    }, {
      id: CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
      text: 'Resolve Content Space Portal Target'
    }, {
      id: CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget,
      text: 'Open Content Space Portal Target'
    }]
    for (const { id, text } of humanReferenceQueries) {
      expect(registry.discover(caller, {
        text,
        scope: 'global',
        limit: 20
      }).map((definition) => definition.id)).not.toContain(id)
    }
  })
})
