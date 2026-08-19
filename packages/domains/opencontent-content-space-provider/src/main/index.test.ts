import { describe, expect, it, vi } from 'vitest'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_PROVIDER_KIND
} from '@sciforge/domain-opencontent-connector/contract'

import { createDomainMainEntry } from './index.js'

describe('OpenContent Content Space Provider factory', () => {
  it('rejects a second same-kind Instance before acquiring the credential-bearing facade', () => {
    const acquire = vi.fn()
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => '/private/tmp/sciforge-opencontent-factory-test',
      defineCapability: (options: unknown) => options,
      internalServices: Object.freeze({
        register: vi.fn(),
        acquire
      })
    })
    const entry = createDomainMainEntry(host)
    const factory = entry.contributions[0]!.value
    const secondInstance = defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: 'opencontent-edoc2-secondary',
      providerKind: OPENCONTENT_PROVIDER_KIND,
      displayName: 'Secondary OpenContent'
    })

    expect(() => factory.createProvider({
      owner: Object.freeze({
        packageName: '@sciforge/domain-opencontent-content-space-provider',
        moduleId: 'sciforge.opencontent-content-space-provider',
        moduleVersion: '1.0.0',
        contributionId: 'opencontent-content-space.provider-factory'
      }),
      instance: secondInstance,
      ports: Object.freeze({})
    })).toThrow('Provider Instance is not installed')
    expect(acquire).not.toHaveBeenCalled()
  })
})
