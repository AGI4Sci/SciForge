import { describe, expect, it, vi } from 'vitest'

import type { ContentSpaceProvider } from '@sciforge/domain-content-space/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'
import { openContentIdentityIdSchema } from '@sciforge/domain-opencontent-connector/team-administration-contract'

import { createDomainMainEntry } from './index.js'

describe('OpenContent Content Space Provider factory', () => {
  it('composes the Principal-bound administration feature through the existing internal facade', async () => {
    const externalIdentityId = openContentIdentityIdSchema.parse(42)
    const useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration'] =
      async (_input, operation) => operation({
        externalIdentityId,
        administration: {
          listTeams: vi.fn(),
          createTeam: vi.fn(),
          observeTeam: vi.fn(),
          editTeam: vi.fn(),
          stickTeam: vi.fn(),
          unstickTeam: vi.fn(),
          listTeamUsers: vi.fn(),
          addTeamUsers: vi.fn(),
          removeTeamUsers: vi.fn(),
          resolveTeamRoot: vi.fn(),
          setTeamUserRole: vi.fn(),
          transferTeamOwner: vi.fn()
        }
      })
    const facade: OpenContentContentSpaceFacade = {
      attestExternalBinding: async (input) => Object.freeze({
        providerInstanceRef: input.providerInstanceRef,
        principal: input.principal,
        externalSubject: 'a'.repeat(64),
        bindingRevision: 'b'.repeat(64)
      }),
      useTeamAdministration,
      listRootFolders: vi.fn(),
      listFolderEntries: vi.fn(),
      observeEntry: vi.fn(),
      createFolder: vi.fn(),
      uploadNewFile: vi.fn(),
      downloadFile: vi.fn()
    }
    const acquireFacade = vi.fn()
    const acquire: NonNullable<DomainMainHost['internalServices']>['acquire'] =
      <Service extends object>() => {
        acquireFacade()
        return facade as unknown as Service
      }
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => '/private/tmp/sciforge-opencontent-factory-test',
      defineCapability: (options: unknown) => options,
      internalServices: Object.freeze({ register: vi.fn(), acquire })
    })
    const entry = createDomainMainEntry(host, {
      identities: {
        resolveContentUserIdentity: vi.fn(async () => externalIdentityId),
        resolveExternalIdentityContentUser: vi.fn(async () => 'content-owner')
      }
    })
    const factory = entry.contributions[0]!.value
    const instance = defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      providerKind: OPENCONTENT_PROVIDER_KIND,
      displayName: 'OpenContent'
    })

    const provider = factory.createProvider({
      owner: Object.freeze({
        packageName: '@sciforge/domain-opencontent-content-space-provider',
        moduleId: 'sciforge.opencontent-content-space-provider',
        moduleVersion: '1.0.0',
        contributionId: 'opencontent-content-space.provider-factory'
      }),
      instance,
      ports: Object.freeze({})
    }) as ContentSpaceProvider
    const binding = await provider.features?.administration?.bind({
      principal: Object.freeze({
        authority: 'sciforge.identity-access',
        subject: 'content-owner',
        assurance: 'local-selection',
        deviceId: 'test-device',
        identityVersion: 1
      }),
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent: () => undefined
    })

    expect(acquireFacade).toHaveBeenCalledOnce()
    expect(binding?.administration.contractVersion).toBe('3.0.0')
    expect(binding?.projectProvisioning?.contractVersion).toBe('1.0.0')
  })

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
