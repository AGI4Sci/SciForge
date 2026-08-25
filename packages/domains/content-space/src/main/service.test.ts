import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import { DomainFileTransferError } from '@sciforge/domain-sdk/file-transfer'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainFileTransferHost,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import { DomainExternalNavigationError } from '@sciforge/domain-sdk/external-navigation'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry,
  type ProviderFactoryRuntimeValueInput
} from '@sciforge/domain-sdk/provider-composition'

import {
  CONTENT_SPACE_LIMITS,
  CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS,
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  defineContentSpaceProvider,
  toPortableContentContainerReference,
  type ContentEntryReference,
  type ContentSpaceCapabilityState,
  type ContentSpaceDownloadDestination,
  type ContentSpaceExternalBindingAttestation,
  type ContentSpaceProvider,
  type ContentSpaceProviderHostPorts,
  type DownloadReceipt
} from '../contract.js'
import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  defineContentSpaceAdministrationPort,
  type ContentSpaceAdministrationOperationState,
  type ContentSpaceAdministrationPort
} from '../administration-contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '../extended-operations-contract.js'
import { NATIVE_DOCUMENT_OPERATIONS } from '../native-document-contract.js'
import type {
  ContentSpaceExtendedOperationState,
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor,
  ContentSpaceNativeDocumentOperationState,
  ContentSpaceProviderContentTarget
} from '../provider-features.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'
import {
  ContentSpaceService,
  type ContentSpaceServiceCallContext,
  type ContentSpaceServiceWriteCallContext
} from './service.js'
import {
  CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  type ContentSpaceVerificationPolicy
} from '../verification-policy.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const PROVIDER_KIND = 'fixture-content-space'
const INVOCATION_ID = 'invocation_content_space_0001'
const ROOT = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'root'
})
const OTHER_ROOT = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'other-root'
})
const FILE = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  fileId: 'file-one'
})
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'content-space-service-test-device',
  identityVersion: 1
})
const externalBinding: ContentSpaceExternalBindingAttestation = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})
const operations = Object.freeze([
  'list-containers',
  'list-entries',
  'observe-entry',
  'create-folder',
  'upload-new',
  'download',
  'portal-target',
  'observe-immutable-version'
] as const)
const readyCapabilities: readonly ContentSpaceCapabilityState[] = Object.freeze(
  operations.map((operation) => Object.freeze({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
)

type ProviderDownloadDispatch = (input: Readonly<
  Parameters<ContentSpaceProvider['authorizeDownload']>[0] & {
    destination: ContentSpaceDownloadDestination
  }
>) => Promise<DownloadReceipt>

function authorizeDownloadUsing(
  dispatch: ProviderDownloadDispatch
): ContentSpaceProvider['authorizeDownload'] {
  return async ({ context, reference }) => {
    let state: 'available' | 'consumed' | 'retired' = 'available'
    return Object.freeze({
      consume: async ({ destination }) => {
        if (state !== 'available') throw new Error('Download lease is unavailable.')
        state = 'consumed'
        return dispatch({ context, reference, destination })
      },
      retire: async () => {
        if (state === 'available') state = 'retired'
      }
    })
  }
}

const defaultDownloadFile: ProviderDownloadDispatch = async ({ context, reference }) => ({
  invocationId: context.invocationId,
  reference,
  bytesWritten: 0
})

describe('ContentSpaceService', () => {
  it('blocks each unready administration operation before binding the Provider feature', async () => {
    const createSpace = vi.fn(administrationPortFixture().createSpace)
    const describeOperations = vi.fn(() => administrationStates('list-spaces'))
    const bind = vi.fn(async () => Object.freeze({
      administration: administrationPortFixture({ createSpace })
    }))
    const service = serviceFor(providerFixture({
      features: { administration: { describeOperations, bind } }
    }))

    await expect(service.executeAdministration({
      target: Object.freeze({
        kind: 'provider-administration' as const,
        providerInstanceRef: PROVIDER_INSTANCE_REF
      }),
      operation: 'create-space',
      request: {
        label: 'Research Team',
        contentOwnerUserId: 'user:owner'
      }
    }, {
      ...writeCall(),
      audience: 'agent'
    })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(describeOperations).toHaveBeenCalledOnce()
    expect(bind).not.toHaveBeenCalled()
    expect(createSpace).not.toHaveBeenCalled()
  })

  it('rejects a member from another Provider Instance before binding administration', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const addMember = vi.fn(async (
      input: Parameters<ContentSpaceAdministrationPort['addMember']>[0]
    ) => Object.freeze({
      root,
      member: input.member
    }))
    const bind = vi.fn(async () => Object.freeze({
      administration: administrationPortFixture({ addMember })
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('add-member'),
          bind
        }
      }
    }))

    await expect(service.executeAdministration({
      target: featureTarget(ROOT),
      operation: 'add-member',
      request: {
        root,
        member: {
          providerInstanceRef: 'provider-instance-beta',
          kind: 'user',
          principalId: 'provider-user-b'
        }
      }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'invalid_target' } })

    expect(bind).not.toHaveBeenCalled()
    expect(addMember).not.toHaveBeenCalled()
  })

  it('rejects an add-member receipt for a different same-Provider member after dispatch', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const requestedMember = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-requested'
    })
    const addMember = vi.fn(async () => Object.freeze({
      root,
      member: Object.freeze({
        ...requestedMember,
        principalId: 'provider-user-returned'
      })
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('add-member'),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({ addMember })
          })
        }
      }
    }))

    await expect(service.executeAdministration({
      target: featureTarget(ROOT),
      operation: 'add-member',
      request: {
        root,
        member: requestedMember
      }
    }, writeCall())).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(addMember).toHaveBeenCalledOnce()
  })

  it('rejects a remove-member receipt for a different same-Provider member after dispatch', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const requestedMember = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-requested'
    })
    const removeMember = vi.fn(async () => Object.freeze({
      root,
      member: Object.freeze({
        ...requestedMember,
        principalId: 'provider-user-returned'
      }),
      removed: true as const
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('remove-member'),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({ removeMember })
          })
        }
      }
    }))

    await expect(service.executeAdministration({
      target: featureTarget(ROOT),
      operation: 'remove-member',
      request: {
        root,
        member: requestedMember
      }
    }, writeCall())).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(removeMember).toHaveBeenCalledOnce()
  })

  it('rejects a remove-member receipt for a different same-Provider root after dispatch', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const member = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-requested'
    })
    const removeMember = vi.fn(async () => Object.freeze({
      root: toPortableContentContainerReference(OTHER_ROOT),
      member,
      removed: true as const
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('remove-member'),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({ removeMember })
          })
        }
      }
    }))

    await expect(service.executeAdministration({
      target: featureTarget(ROOT),
      operation: 'remove-member',
      request: {
        root,
        member
      }
    }, writeCall())).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(removeMember).toHaveBeenCalledOnce()
  })

  it('rejects a listed member whose Provider Instance drifts from the root', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const listMembers = vi.fn(async () => Object.freeze({
      root,
      items: Object.freeze([Object.freeze({
        member: Object.freeze({
          providerInstanceRef: 'provider-instance-beta',
          kind: 'user' as const,
          principalId: 'provider-user-b'
        })
      })])
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('list-members'),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({ listMembers })
          })
        }
      }
    }))

    await expect(service.executeAdministration({
      target: featureTarget(ROOT),
      operation: 'list-members',
      request: { root, page: { limit: 25 } }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })

    expect(listMembers).toHaveBeenCalledOnce()
  })

  const exactAdministrationRoot = toPortableContentContainerReference(ROOT)
  const otherAdministrationRoot = toPortableContentContainerReference(OTHER_ROOT)
  const foreignAdministrationRoot = toPortableContentContainerReference({
    providerInstanceRef: 'provider-instance-beta',
    containerId: 'foreign-root'
  })
  const administrationSummary = Object.freeze({
    root: exactAdministrationRoot,
    label: 'Research Team',
    contentOwnerUserId: 'user:owner',
    pinned: false
  })
  const administrationMember = Object.freeze({
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    kind: 'user' as const,
    principalId: 'provider-user-a'
  })

  it.each([
    {
      name: 'list-spaces page bound',
      operation: 'list-spaces' as const,
      method: 'listSpaces' as const,
      request: { page: { limit: 1 } },
      output: { items: [administrationSummary, {
        ...administrationSummary,
        root: otherAdministrationRoot
      }] },
      code: 'provider_unavailable'
    },
    {
      name: 'list-spaces cursor progress',
      operation: 'list-spaces' as const,
      method: 'listSpaces' as const,
      request: { page: { limit: 2, cursor: 'same-cursor' } },
      output: { items: [administrationSummary], nextCursor: 'same-cursor' },
      code: 'provider_unavailable'
    },
    {
      name: 'list-spaces empty continuation',
      operation: 'list-spaces' as const,
      method: 'listSpaces' as const,
      request: { page: { limit: 2 } },
      output: { items: [], nextCursor: 'next-cursor' },
      code: 'provider_unavailable'
    },
    {
      name: 'list-spaces unique roots',
      operation: 'list-spaces' as const,
      method: 'listSpaces' as const,
      request: { page: { limit: 2 } },
      output: { items: [administrationSummary, administrationSummary] },
      code: 'provider_unavailable'
    },
    {
      name: 'list-spaces Provider authority',
      operation: 'list-spaces' as const,
      method: 'listSpaces' as const,
      request: { page: { limit: 2 } },
      output: { items: [{ ...administrationSummary, root: foreignAdministrationRoot }] },
      code: 'provider_unavailable'
    },
    {
      name: 'create-space label',
      operation: 'create-space' as const,
      method: 'createSpace' as const,
      request: { label: 'Research Team', contentOwnerUserId: 'user:owner' },
      output: { ...administrationSummary, label: 'Different Team' },
      code: 'outcome_unknown'
    },
    {
      name: 'create-space owner',
      operation: 'create-space' as const,
      method: 'createSpace' as const,
      request: { label: 'Research Team', contentOwnerUserId: 'user:owner' },
      output: { ...administrationSummary, contentOwnerUserId: 'user:other' },
      code: 'outcome_unknown'
    },
    {
      name: 'observe-space root',
      operation: 'observe-space' as const,
      method: 'observeSpace' as const,
      request: { root: exactAdministrationRoot },
      output: { ...administrationSummary, root: otherAdministrationRoot },
      code: 'provider_unavailable'
    },
    {
      name: 'update-space label',
      operation: 'update-space' as const,
      method: 'updateSpace' as const,
      request: { root: exactAdministrationRoot, label: 'Renamed Team' },
      output: administrationSummary,
      code: 'outcome_unknown'
    },
    {
      name: 'pin-space state',
      operation: 'pin-space' as const,
      method: 'pinSpace' as const,
      request: { root: exactAdministrationRoot },
      output: administrationSummary,
      code: 'outcome_unknown'
    },
    {
      name: 'unpin-space state',
      operation: 'unpin-space' as const,
      method: 'unpinSpace' as const,
      request: { root: exactAdministrationRoot },
      output: { ...administrationSummary, pinned: true },
      code: 'outcome_unknown'
    },
    {
      name: 'open-root identity',
      operation: 'open-root' as const,
      method: 'openRoot' as const,
      request: { root: exactAdministrationRoot },
      output: { root: otherAdministrationRoot },
      code: 'provider_unavailable'
    },
    {
      name: 'list-members page bound',
      operation: 'list-members' as const,
      method: 'listMembers' as const,
      request: { root: exactAdministrationRoot, page: { limit: 1 } },
      output: {
        root: exactAdministrationRoot,
        items: [
          { member: administrationMember },
          { member: { ...administrationMember, principalId: 'provider-user-b' } }
        ]
      },
      code: 'provider_unavailable'
    },
    {
      name: 'list-members root identity',
      operation: 'list-members' as const,
      method: 'listMembers' as const,
      request: { root: exactAdministrationRoot, page: { limit: 2 } },
      output: { root: otherAdministrationRoot, items: [{ member: administrationMember }] },
      code: 'provider_unavailable'
    },
    {
      name: 'list-members cursor progress',
      operation: 'list-members' as const,
      method: 'listMembers' as const,
      request: { root: exactAdministrationRoot, page: { limit: 2, cursor: 'same-cursor' } },
      output: {
        root: exactAdministrationRoot,
        items: [{ member: administrationMember }],
        nextCursor: 'same-cursor'
      },
      code: 'provider_unavailable'
    },
    {
      name: 'list-members empty continuation',
      operation: 'list-members' as const,
      method: 'listMembers' as const,
      request: { root: exactAdministrationRoot, page: { limit: 2 } },
      output: { root: exactAdministrationRoot, items: [], nextCursor: 'next-cursor' },
      code: 'provider_unavailable'
    },
    {
      name: 'list-members unique identities',
      operation: 'list-members' as const,
      method: 'listMembers' as const,
      request: { root: exactAdministrationRoot, page: { limit: 2 } },
      output: {
        root: exactAdministrationRoot,
        items: [{ member: administrationMember }, { member: administrationMember }]
      },
      code: 'provider_unavailable'
    },
    {
      name: 'add-member root',
      operation: 'add-member' as const,
      method: 'addMember' as const,
      request: { root: exactAdministrationRoot, member: administrationMember },
      output: { root: otherAdministrationRoot, member: administrationMember },
      code: 'outcome_unknown'
    },
    {
      name: 'remove-member root',
      operation: 'remove-member' as const,
      method: 'removeMember' as const,
      request: { root: exactAdministrationRoot, member: administrationMember },
      output: { root: otherAdministrationRoot, member: administrationMember, removed: true },
      code: 'outcome_unknown'
    }
  ])('rejects same-Provider $name drift after exactly one dispatch', async (testCase) => {
    const dispatch = vi.fn(async () => testCase.output)
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates(testCase.operation),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({
              [testCase.method]: dispatch
            } as Partial<ContentSpaceAdministrationPort>)
          })
        }
      }
    }))
    const target = testCase.operation === 'list-spaces' || testCase.operation === 'create-space'
      ? Object.freeze({
          kind: 'provider-administration' as const,
          providerInstanceRef: PROVIDER_INSTANCE_REF
        })
      : featureTarget(ROOT)

    const error = await service.executeAdministration({
      target,
      operation: testCase.operation,
      request: testCase.request
    }, writeCall()).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ detail: { code: testCase.code } })
    if (testCase.code === 'outcome_unknown') {
      expect(error).toMatchObject({
        detail: { code: 'outcome_unknown', retry: 'never' }
      })
    }
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('rejects an administration binding with an extra legacy port before dispatch', async () => {
    const listSpaces = vi.fn(administrationPortFixture().listSpaces)
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('list-spaces'),
          bind: async () => Object.freeze({
            administration: administrationPortFixture({ listSpaces }),
            legacyPort: Object.freeze({})
          })
        }
      }
    }))

    await expect(service.executeAdministration({
      target: Object.freeze({
        kind: 'provider-administration' as const,
        providerInstanceRef: PROVIDER_INSTANCE_REF
      }),
      operation: 'list-spaces',
      request: { page: { limit: 25 } }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })

    expect(listSpaces).not.toHaveBeenCalled()
  })

  it('keeps PoC-only reads blocked without a separately reviewed trusted gate', async () => {
    const provider = providerFixture({
      describeCapabilities: async () => operations.map((operation) => ({
        operation,
        readiness: operation === 'list-containers' ? 'poc_only' : 'blocked_by_contract',
        reasonCode: operation === 'list-containers'
          ? 'verification_profile_required'
          : 'provider_contract_missing'
      }))
    })
    const service = serviceFor(provider)
    const request = { providerInstanceRef: PROVIDER_INSTANCE_REF, page: { limit: 10 } }

    for (const audience of ['ui', 'agent', 'system'] as const) {
      await expect(service.listContainers(request, {
        ...readCall(),
        audience
      })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    }
  })

  it('admits only one exact constructor-installed PoC verification profile', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const provider = providerFixture({
      describeCapabilities: async () => operations.map((operation) => ({
        operation,
        readiness: operation === 'list-containers' ? 'poc_only' : 'blocked_by_contract',
        reasonCode: operation === 'list-containers'
          ? 'verification_profile_required'
          : 'provider_contract_missing'
      }))
    })
    const verificationPolicy: ContentSpaceVerificationPolicy = Object.freeze({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: Object.freeze([Object.freeze({
        profileId: 'fixture-list-containers',
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        audience: 'agent' as const,
        authority: Object.freeze({
          kind: 'provider-instance' as const,
          providerInstanceRef: PROVIDER_INSTANCE_REF
        }),
        operation: Object.freeze({
          family: 'ordinary' as const,
          operation: 'list-containers' as const
        }),
        transferLimits: Object.freeze({ maxUploadBytes: 0, maxDownloadBytes: 0 }),
        validFrom: '2026-08-21T00:00:00.000Z',
        expiresAt: '2026-08-21T02:00:00.000Z'
      })])
    })
    const service = serviceFor(provider, {
      verificationPolicy,
      now: () => now
    })
    const request = { providerInstanceRef: PROVIDER_INSTANCE_REF, page: { limit: 10 } }

    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'agent'
    })).resolves.toMatchObject({ providerInstanceRef: PROVIDER_INSTANCE_REF })
    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'ui'
    })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'agent',
      reauthorizedPrincipal: { ...principal, identityVersion: 2 }
    })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
  })

  it('reports Provider PoC evidence separately from exact current UI admission', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const provider = providerFixture({
      describeCapabilities: async () => operations.map((operation) => ({
        operation,
        readiness: operation === 'list-containers' ? 'poc_only' : 'blocked_by_contract',
        reasonCode: operation === 'list-containers'
          ? 'verification_profile_required'
          : 'provider_contract_missing'
      }))
    })
    const service = serviceFor(provider, {
      verificationPolicy: {
        contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
        profiles: [{
          profileId: 'fixture-ui-list-containers',
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          principal,
          audience: 'ui',
          authority: {
            kind: 'provider-instance',
            providerInstanceRef: PROVIDER_INSTANCE_REF
          },
          operation: { family: 'ordinary', operation: 'list-containers' },
          transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
          validFrom: '2026-08-21T00:00:00.000Z',
          expiresAt: '2026-08-21T02:00:00.000Z'
        }]
      },
      now: () => now
    })

    const described = await service.describeCapabilities(PROVIDER_INSTANCE_REF, {
      ...readCall(),
      audience: 'ui'
    })

    expect(described.items.find(({ operation }) => operation === 'list-containers'))
      .toEqual({
        operation: 'list-containers',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required',
        admission: {
          status: 'admitted',
          reasonCode: 'verification_profile_admitted'
        }
      })
  })

  it('admits an exact Broker verification binding and rejects a different target', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const poc = operations.map((operation) => ({
      operation,
      readiness: ['list-entries', 'observe-entry'].includes(operation)
        ? 'poc_only' as const
        : 'blocked_by_contract' as const,
      reasonCode: ['list-entries', 'observe-entry'].includes(operation)
        ? 'verification_profile_required' as const
        : 'provider_contract_missing' as const
    }))
    const observeEntry = vi.fn<ContentSpaceProvider['observeEntry']>(async ({ reference }) => ({
      ...observationFor(reference),
      capabilities: poc
    }))
    const listEntries = vi.fn<ContentSpaceProvider['listEntries']>(async ({ parent }) => ({
      parent,
      items: []
    }))
    const provider = providerFixture({
      describeCapabilities: async () => poc,
      observeEntry,
      listEntries
    })
    const profiles = (['list-entries', 'observe-entry'] as const).map((operation) => ({
      profileId: `fixture-${operation}`,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'agent' as const,
      authority: { kind: 'content-root' as const, root: ROOT },
      operation: { family: 'ordinary' as const, operation },
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
      validFrom: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T02:00:00.000Z'
    }))
    const service = serviceFor(provider, {
      verificationPolicy: {
        contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
        profiles
      },
      now: () => now
    })

    await expect(service.listEntries({ parent: ROOT, page: { limit: 10 } }, {
      ...readCall(),
      audience: 'agent',
      verificationBinding: { root: ROOT, reference: ROOT }
    })).resolves.toMatchObject({ parent: ROOT, items: [] })
    expect(observeEntry).toHaveBeenCalledOnce()
    expect(listEntries).toHaveBeenCalledOnce()
    observeEntry.mockClear()
    listEntries.mockClear()

    await expect(service.listEntries({ parent: OTHER_ROOT, page: { limit: 10 } }, {
      ...readCall(),
      audience: 'agent',
      verificationBinding: { root: ROOT, reference: ROOT }
    })).rejects.toMatchObject({
      detail: { code: 'unauthorized' }
    })
    expect(observeEntry).not.toHaveBeenCalled()
    expect(listEntries).not.toHaveBeenCalled()
  })

  it('does not let caller data install a verification policy or admit blocked readiness', async () => {
    const provider = providerFixture({
      describeCapabilities: async () => operations.map((operation) => ({
        operation,
        readiness: operation === 'list-containers' ? 'poc_only' : 'blocked_by_contract',
        reasonCode: operation === 'list-containers'
          ? 'verification_profile_required'
          : 'provider_contract_missing'
      }))
    })
    const service = serviceFor(provider)
    await expect(service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, {
      ...readCall(),
      audience: 'agent',
      verificationPolicy: { admit: true }
    } as ContentSpaceServiceCallContext)).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })
  })

  it('keeps PoC resource reads blocked without a separately reviewed trusted gate', async () => {
    const poc = operations.map((operation) => ({
      operation,
      readiness: ['list-entries', 'observe-entry'].includes(operation)
        ? 'poc_only' as const
        : 'blocked_by_contract' as const,
      reasonCode: ['list-entries', 'observe-entry'].includes(operation)
        ? 'verification_profile_required' as const
        : 'provider_contract_missing' as const
    }))
    const provider = providerFixture({
      describeCapabilities: async () => poc,
      observeEntry: async ({ reference }) => {
        if (!('containerId' in reference)) throw new Error('Expected container')
        return {
          entry: { kind: 'container' as const, reference, label: 'Root' },
          capabilities: poc
        }
      }
    })
    const service = serviceFor(provider)
    const request = { parent: ROOT, page: { limit: 10 } }

    for (const audience of ['ui', 'agent', 'system'] as const) {
      await expect(service.listEntries(request, { ...readCall(), audience }))
        .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    }
  })

  it('keeps one shared pending Provider pin when one caller aborts', async () => {
    const firstFactory = deferred<ContentSpaceProvider>()
    const unexpectedSecondFactory = deferred<ContentSpaceProvider>()
    const firstProvider = providerFixture()
    const secondProvider = providerFixture()
    const createProvider = vi.fn()
      .mockImplementationOnce(() => firstFactory.promise)
      .mockImplementationOnce(() => unexpectedSecondFactory.promise)
    const service = serviceForFactory(createProvider)
    const firstCaller = new AbortController()
    const request = {
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }

    const first = service.listContainers(request, {
      ...readCall(),
      signal: firstCaller.signal
    })
    const second = service.listContainers(request, readCall())
    await vi.waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1))

    firstCaller.abort()
    await expect(first).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    const third = service.listContainers(request, readCall())
    await Promise.resolve()
    expect(createProvider).toHaveBeenCalledTimes(1)

    firstFactory.resolve(firstProvider)
    unexpectedSecondFactory.resolve(secondProvider)
    const [secondPage, thirdPage] = await Promise.all([second, third])
    expect(secondPage.providerInstanceRef).toBe(PROVIDER_INSTANCE_REF)
    expect(thirdPage.providerInstanceRef).toBe(PROVIDER_INSTANCE_REF)
    expect(createProvider).toHaveBeenCalledTimes(1)
  })

  it('bounds a never-resolving Provider factory before any business operation', async () => {
    const createProvider = vi.fn(() => new Promise<ContentSpaceProvider>(() => undefined))
    const service = serviceForFactory(createProvider, { operationDeadlineMs: 10 })

    await expect(service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    expect(createProvider).toHaveBeenCalledTimes(1)
  })

  it('bounds a Provider that ignores the read signal', async () => {
    const listContainers = vi.fn(() => new Promise<never>(() => undefined))
    const service = serviceFor(providerFixture({ listContainers }), {
      operationDeadlineMs: 10
    })

    await expect(service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    expect(listContainers).toHaveBeenCalledTimes(1)
  })

  it('downgrades Host-gated readiness and never calls gated Provider methods', async () => {
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const downloadFile = vi.fn(defaultDownloadFile)
    const resolvePortalTarget = vi.fn(providerFixture().resolvePortalTarget)
    const service = serviceFor(providerFixture({
      uploadNewFile,
      authorizeDownload: authorizeDownloadUsing(downloadFile),
      resolvePortalTarget
    }), {
      platform: { fileTransfers: false, externalNavigation: false }
    })
    const described = await service.describeCapabilities(PROVIDER_INSTANCE_REF, readCall())
    for (const operation of ['upload-new', 'download', 'portal-target'] as const) {
      expect(described.items.find((state) => state.operation === operation)).toMatchObject({
        readiness: 'production_ready',
        reasonCode: 'available',
        admission: { status: 'blocked', reasonCode: 'platform_gate_blocked' }
      })
    }
    const openSource = vi.fn()
    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'blocked.txt',
      openSource
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    await expect(service.resolvePortalTarget(FILE, readCall())).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })
    expect(openSource).not.toHaveBeenCalled()
    expect(uploadNewFile).not.toHaveBeenCalled()
    expect(downloadFile).not.toHaveBeenCalled()
    expect(resolvePortalTarget).not.toHaveBeenCalled()
  })

  it('enforces exact resource readiness before the requested business operation', async () => {
    const createFolder = vi.fn(providerFixture().createFolder)
    const observeEntry = vi.fn(async ({ reference }) => ({
      entry: {
        kind: 'container' as const,
        reference,
        label: 'Root'
      },
      capabilities: [{
        operation: 'create-folder' as const,
        readiness: 'blocked_by_contract' as const,
        reasonCode: 'instance_policy_blocked' as const
      }]
    })) satisfies ContentSpaceProvider['observeEntry']
    const service = serviceFor(providerFixture({ createFolder, observeEntry }))

    await expect(service.createFolder({ parent: ROOT, name: 'Blocked' }, writeCall()))
      .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(observeEntry).toHaveBeenCalledTimes(1)
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('downgrades target operations when global observation preflight is unavailable', async () => {
    const observeEntry = vi.fn(providerFixture().observeEntry)
    const createFolder = vi.fn(providerFixture().createFolder)
    const provider = providerFixture({
      describeCapabilities: async () => readyCapabilities.map((state) =>
        state.operation === 'observe-entry'
          ? Object.freeze({
              operation: state.operation,
              readiness: 'blocked_by_contract' as const,
              reasonCode: 'provider_contract_missing' as const
            })
          : state
      ),
      observeEntry,
      createFolder
    })
    const service = serviceFor(provider)
    const described = await service.describeCapabilities(PROVIDER_INSTANCE_REF, readCall())
    expect(described.items.find(({ operation }) => operation === 'create-folder'))
      .toMatchObject({
        readiness: 'production_ready',
        reasonCode: 'available',
        admission: { status: 'blocked', reasonCode: 'resource_capability_missing' }
      })
    await expect(service.createFolder({ parent: ROOT, name: 'Blocked' }, writeCall()))
      .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(observeEntry).not.toHaveBeenCalled()
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('rejects non-progressing or empty-loop pagination cursors', async () => {
    const service = serviceFor(providerFixture({
      listEntries: async ({ parent }) => ({ parent, items: [], nextCursor: 'offset_10' })
    }))
    await expect(service.listEntries({
      parent: ROOT,
      page: { cursor: 'offset_10', limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })
  })

  it('returns cancelled without Provider dispatch when a write lease is already aborted', async () => {
    const controller = new AbortController()
    const createFolder = vi.fn(providerFixture().createFolder)
    const observeEntry = vi.fn(async ({ reference }) => {
      const observation = observationFor(reference)
      return {
        ...observation,
        get capabilities() {
          controller.abort()
          return observation.capabilities
        }
      }
    }) satisfies ContentSpaceProvider['observeEntry']
    const service = serviceFor(providerFixture({ observeEntry, createFolder }))

    const error = await service.createFolder(
      { parent: ROOT, name: 'Never Dispatched' },
      writeCall(controller.signal)
    ).catch((caught: unknown) => caught)
    expect(observeEntry).toHaveBeenCalledOnce()
    expect(createFolder).not.toHaveBeenCalled()
    expect(error).toMatchObject({ detail: { code: 'cancelled', retry: 'never' } })
  })

  it('returns cancelled when the write lease aborts during pre-dispatch revalidation', async () => {
    const controller = new AbortController()
    const createFolder = vi.fn(providerFixture().createFolder)
    let observationReturned = false
    let observationPostcheckPassed = false
    const observeEntry = vi.fn(async ({ reference }) => {
      observationReturned = true
      return observationFor(reference)
    }) satisfies ContentSpaceProvider['observeEntry']
    const service = serviceFor(providerFixture({ observeEntry, createFolder }))

    const error = await service.createFolder(
      { parent: ROOT, name: 'Never Dispatched' },
      writeCall(controller.signal, () => {
        if (!observationReturned) return
        if (!observationPostcheckPassed) {
          observationPostcheckPassed = true
          return
        }
        controller.abort()
      })
    ).catch((caught: unknown) => caught)
    expect(observeEntry).toHaveBeenCalledOnce()
    expect(createFolder).not.toHaveBeenCalled()
    expect(error).toMatchObject({ detail: { code: 'cancelled', retry: 'never' } })
  })

  it('returns cancelled when the deadline expires before synchronous Provider dispatch', async () => {
    const baseNow = Date.now()
    let deadlineExpired = false
    const now = vi.spyOn(Date, 'now').mockImplementation(() =>
      baseNow + (deadlineExpired ? 2_000 : 0))
    const createFolder = vi.fn(providerFixture().createFolder)
    let observationReturned = false
    let observationPostcheckPassed = false
    const observeEntry = vi.fn(async ({ reference }) => {
      observationReturned = true
      return observationFor(reference)
    }) satisfies ContentSpaceProvider['observeEntry']
    const service = serviceFor(providerFixture({ observeEntry, createFolder }), {
      operationDeadlineMs: 1_000
    })

    try {
      const error = await service.createFolder(
        { parent: ROOT, name: 'Never Dispatched' },
        writeCall(undefined, () => {
          if (!observationReturned) return
          if (!observationPostcheckPassed) {
            observationPostcheckPassed = true
            return
          }
          deadlineExpired = true
        })
      ).catch((caught: unknown) => caught)
      expect(observeEntry).toHaveBeenCalledOnce()
      expect(createFolder).not.toHaveBeenCalled()
      expect(error).toMatchObject({ detail: { code: 'cancelled', retry: 'never' } })
    } finally {
      now.mockRestore()
    }
  })

  it('returns outcome_unknown when a dispatched Provider write ignores its deadline', async () => {
    const createFolder = vi.fn(() => new Promise<never>(() => undefined))
    const service = serviceFor(providerFixture({ createFolder }), {
      operationDeadlineMs: 10
    })

    await expect(service.createFolder({ parent: ROOT, name: 'Folder' }, writeCall()))
      .rejects.toMatchObject({ detail: { code: 'outcome_unknown', retry: 'never' } })
    expect(createFolder).toHaveBeenCalledTimes(1)
  })

  it('preserves outcome_unknown and requests source cleanup after upload dispatch times out', async () => {
    vi.useFakeTimers()
    try {
      const dispatched = deferred<void>()
      const close = vi.fn(async () => undefined)
      const uploadNewFile = vi.fn(() => {
        dispatched.resolve()
        return new Promise<never>(() => undefined)
      })
      const service = serviceFor(providerFixture({ uploadNewFile }), {
        operationDeadlineMs: 10
      })

      const pending = service.uploadNewFile({
        parent: ROOT,
        name: 'input.txt',
        openSource: async () => ({
          name: 'input.txt',
          size: 1,
          read: async () => new Uint8Array([1]),
          close
        })
      }, writeCall())
      const outcome = expect(pending).rejects.toMatchObject({
        detail: { code: 'outcome_unknown', retry: 'never' }
      })
      await dispatched.promise
      await vi.advanceTimersByTimeAsync(10)

      await outcome
      expect(uploadNewFile).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a read result when the Host Principal changes during Provider await', async () => {
    const gate = deferred<void>()
    const entered = deferred<void>()
    let principalCurrent = true
    const listContainers = vi.fn(async ({ context }) => {
      entered.resolve()
      await gate.promise
      return { providerInstanceRef: context.providerInstanceRef, items: [] }
    }) satisfies ContentSpaceProvider['listContainers']
    const service = serviceFor(providerFixture({ listContainers }))
    const pending = service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall(() => {
      if (!principalCurrent) throw new Error('Principal changed')
    }))

    await entered.promise
    principalCurrent = false
    gate.resolve()
    await expect(pending).rejects.toMatchObject({ detail: { code: 'unauthorized' } })
  })

  it('returns outcome_unknown when the Principal changes after write dispatch', async () => {
    const gate = deferred<void>()
    const entered = deferred<void>()
    let principalCurrent = true
    const createFolder = vi.fn(async ({ context, parent, name }) => {
      entered.resolve()
      await gate.promise
      return {
        invocationId: context.invocationId,
        parent,
        name,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'created' }
      } as const
    }) satisfies ContentSpaceProvider['createFolder']
    const service = serviceFor(providerFixture({ createFolder }))
    const pending = service.createFolder(
      { parent: ROOT, name: 'Folder' },
      writeCall(undefined, () => {
        if (!principalCurrent) throw new Error('Principal changed')
      })
    )

    await entered.promise
    principalCurrent = false
    gate.resolve()
    await expect(pending).rejects.toMatchObject({ detail: { code: 'outcome_unknown' } })
  })

  it('maps malformed and unbound write receipts to outcome_unknown', async () => {
    const createFolder = vi.fn(async () => ({
      invocationId: 'wrong_invocation_0000'
    }) as never)
    const service = serviceFor(providerFixture({ createFolder }))

    await expect(service.createFolder({ parent: ROOT, name: 'Folder' }, writeCall()))
      .rejects.toMatchObject({ detail: { code: 'outcome_unknown' } })
  })

  it('opens an upload source only after readiness and always closes it', async () => {
    const close = vi.fn(async () => undefined)
    const openSource = vi.fn(async () => ({
      name: 'input.txt',
      size: 3,
      read: async () => new Uint8Array([1, 2, 3]),
      close
    }))
    const uploadNewFile = vi.fn(async ({ context, parent, name, source }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
      writeAfterObservation: {
        parent,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
        name,
        size: source.size
      }
    })) satisfies ContentSpaceProvider['uploadNewFile']
    const service = serviceFor(providerFixture({ uploadNewFile }))

    await expect(service.uploadNewFile({ parent: ROOT, name: 'input.txt', openSource }, writeCall()))
      .resolves.toMatchObject({ sourceSize: 3 })
    expect(openSource).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)

    const blocked = providerFixture({
      describeCapabilities: async () => readyCapabilities.map((state) =>
        state.operation === 'upload-new'
          ? Object.freeze({
              operation: state.operation,
              readiness: 'blocked_by_contract' as const,
              reasonCode: 'platform_gate_blocked' as const
            })
          : state
      )
    })
    const blockedOpen = vi.fn(async () => ({
      name: 'blocked.txt',
      size: 1,
      read: async () => new Uint8Array([1]),
      close: async () => undefined
    }))
    await expect(serviceFor(blocked).uploadNewFile({
      parent: ROOT,
      name: 'input.txt',
      openSource: blockedOpen
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(blockedOpen).not.toHaveBeenCalled()
  })

  it('rechecks an exact external binding before opening a PoC upload source', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const pocCapabilities = readyCapabilities.map((state) =>
      ['upload-new', 'observe-entry'].includes(state.operation)
        ? Object.freeze({
            operation: state.operation,
            readiness: 'poc_only' as const,
            reasonCode: 'verification_profile_required' as const
          })
        : state
    )
    const profiles = [
      {
        profileId: 'fixture-upload-new',
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        audience: 'agent' as const,
        authority: { kind: 'content-root' as const, root: ROOT },
        operation: { family: 'ordinary' as const, operation: 'upload-new' as const },
        transferLimits: { maxUploadBytes: CONTENT_SPACE_LIMITS.maxUploadBytes, maxDownloadBytes: 0 },
        externalBinding: {
          externalSubject: externalBinding.externalSubject,
          bindingRevision: externalBinding.bindingRevision
        },
        validFrom: '2026-08-21T00:00:00.000Z',
        expiresAt: '2026-08-21T02:00:00.000Z'
      },
      {
        profileId: 'fixture-upload-observation',
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        audience: 'agent' as const,
        authority: { kind: 'content-root' as const, root: ROOT },
        operation: { family: 'ordinary' as const, operation: 'observe-entry' as const },
        transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
        validFrom: '2026-08-21T00:00:00.000Z',
        expiresAt: '2026-08-21T02:00:00.000Z'
      }
    ]
    const openSource = vi.fn(async () => ({
      name: 'acceptance.txt',
      size: 1,
      read: async () => new Uint8Array([1]),
      close: async () => undefined
    }))
    const uploadNewFile = vi.fn<ContentSpaceProvider['uploadNewFile']>(async ({
      context,
      parent,
      name,
      source
    }) => {
      expect(context.expectedExternalBinding).toEqual(externalBinding)
      return {
        invocationId: context.invocationId,
        parent,
        name,
        sourceSize: source.size,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
        writeAfterObservation: {
          parent,
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
          name,
          size: source.size
        }
      }
    })
    const attestExternalBinding = vi.fn(async () => externalBinding)
    const provider = providerFixture({
      attestExternalBinding,
      describeCapabilities: async () => pocCapabilities,
      observeEntry: async ({ reference }) => ({
        ...observationFor(reference),
        capabilities: pocCapabilities
      }),
      uploadNewFile
    })
    const service = serviceFor(provider, {
      verificationPolicy: {
        contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
        profiles
      },
      now: () => now
    })

    await expect(service.uploadNewFile({ parent: ROOT, name: 'acceptance.txt', openSource }, {
      ...writeCall(),
      audience: 'agent'
    })).resolves.toMatchObject({ sourceSize: 1 })
    expect(attestExternalBinding).toHaveBeenCalledOnce()
    expect(openSource).toHaveBeenCalledOnce()
    expect(uploadNewFile).toHaveBeenCalledOnce()

    const blockedOpenSource = vi.fn(async () => ({
      name: 'blocked.txt',
      size: 1,
      read: async () => new Uint8Array([1]),
      close: async () => undefined
    }))
    const blockedUpload = vi.fn<ContentSpaceProvider['uploadNewFile']>(async () => {
      throw new Error('must not dispatch')
    })
    const wrongBinding = serviceFor(providerFixture({
      attestExternalBinding: async () => ({
        ...externalBinding,
        bindingRevision: 'c'.repeat(64)
      }),
      describeCapabilities: async () => pocCapabilities,
      observeEntry: async ({ reference }) => ({
        ...observationFor(reference),
        capabilities: pocCapabilities
      }),
      uploadNewFile: blockedUpload
    }), {
      verificationPolicy: {
        contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
        profiles
      },
      now: () => now
    })
    await expect(wrongBinding.uploadNewFile({
      parent: ROOT,
      name: 'blocked.txt',
      openSource: blockedOpenSource
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })
    expect(blockedOpenSource).not.toHaveBeenCalled()
    expect(blockedUpload).not.toHaveBeenCalled()
  })

  it('uses real production-ready transfer evidence without a static verification profile', async () => {
    const attestExternalBinding = vi.fn(async () => externalBinding)
    const observeEntry = vi.fn(providerFixture().observeEntry)
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const openSource = vi.fn(async () => ({
      name: 'real.txt',
      size: 1,
      sha256: createHash('sha256').update(new Uint8Array([1])).digest('hex'),
      read: async () => new Uint8Array([1]),
      close: async () => undefined
    }))
    const service = serviceFor(providerFixture({
      attestExternalBinding,
      observeEntry,
      uploadNewFile
    }))

    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'real.txt',
      includeTransferEvidence: true,
      openSource
    }, systemWriteCall())).resolves.toMatchObject({
      receipt: { name: 'real.txt', sourceSize: 1 },
      bytes: 1
    })

    expect(attestExternalBinding).toHaveBeenCalledOnce()
    expect(observeEntry).toHaveBeenCalledOnce()
    expect(openSource).toHaveBeenCalledOnce()
    expect(uploadNewFile).toHaveBeenCalledOnce()
  })

  it('preflights an exact download without issuing authority and reauthorizes the later transfer', async () => {
    const attestExternalBinding = vi.fn(async () => externalBinding)
    const proveFileDescendant = vi.fn(providerFixture().proveFileDescendant)
    const authorizeDownload = vi.fn(providerFixture().authorizeDownload)
    const service = serviceFor(providerFixture({
      attestExternalBinding,
      proveFileDescendant,
      authorizeDownload
    }))

    await expect(service.preflightSystemTransfer({
      operation: 'download',
      root: ROOT,
      candidate: FILE
    }, systemWriteCall())).resolves.toEqual({
      status: 'ready',
      providerObservationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })

    expect(attestExternalBinding).toHaveBeenCalledTimes(2)
    expect(proveFileDescendant).toHaveBeenCalledOnce()
    expect(authorizeDownload).not.toHaveBeenCalled()

    const openDestination = vi.fn(async () => destinationFixture())
    await expect(service.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).resolves.toMatchObject({ bytes: 0 })

    expect(attestExternalBinding).toHaveBeenCalledTimes(3)
    expect(proveFileDescendant).toHaveBeenCalledTimes(2)
    expect(authorizeDownload).toHaveBeenCalledOnce()
    expect(openDestination).toHaveBeenCalledOnce()
  })

  it('returns bounded system preflight states for stale Principal, binding, and Provider readiness', async () => {
    const rebound = Object.freeze({
      ...externalBinding,
      bindingRevision: 'c'.repeat(64)
    })
    const bindingAttestation = vi.fn()
      .mockResolvedValueOnce(externalBinding)
      .mockResolvedValueOnce(rebound)
    const staleBindingService = serviceFor(providerFixture({
      attestExternalBinding: bindingAttestation
    }))
    await expect(staleBindingService.preflightSystemTransfer({
      operation: 'upload-new',
      root: ROOT
    }, systemWriteCall())).resolves.toEqual({
      status: 'binding_stale',
      providerObservationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })

    const providerCalls = {
      attestExternalBinding: vi.fn(async () => externalBinding),
      observeEntry: vi.fn(providerFixture().observeEntry)
    }
    const pocCapabilities = readyCapabilities.map((state) =>
      state.operation === 'upload-new'
        ? Object.freeze({
            operation: state.operation,
            readiness: 'poc_only' as const,
            reasonCode: 'verification_profile_required' as const
          })
        : state)
    const providerNotReadyService = serviceFor(providerFixture({
      ...providerCalls,
      describeCapabilities: async () => pocCapabilities
    }), {
      verificationPolicy: systemTransferPolicy(
        'upload-new',
        CONTENT_SPACE_LIMITS.maxUploadBytes,
        new Date()
      )
    })
    await expect(providerNotReadyService.preflightSystemTransfer({
      operation: 'upload-new',
      root: ROOT
    }, systemWriteCall())).resolves.toEqual({
      status: 'provider_not_ready',
      providerObservationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })
    expect(providerCalls.attestExternalBinding).not.toHaveBeenCalled()
    expect(providerCalls.observeEntry).not.toHaveBeenCalled()

    const principalProvider = providerFixture({
      attestExternalBinding: vi.fn(async () => externalBinding)
    })
    const principalStaleService = serviceFor(principalProvider)
    await expect(principalStaleService.preflightSystemTransfer({
      operation: 'upload-new',
      root: ROOT
    }, systemWriteCall(new AbortController().signal, () => {
      throw new Error('Principal changed')
    }))).resolves.toEqual({
      status: 'principal_stale',
      providerObservationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })
  })

  it('uses the production upload bound and returns Host and Provider observations', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const bytes = new Uint8Array([1, 2, 3])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const close = vi.fn(async () => undefined)
    const openSource = vi.fn(async (_signal: AbortSignal, maxBytes: number) => {
      expect(maxBytes).toBe(CONTENT_SPACE_LIMITS.maxUploadBytes)
      return {
        name: 'workspace-payload.bin',
        size: bytes.byteLength,
        sha256,
        read: async () => bytes,
        close
      }
    })
    const uploadNewFile = vi.fn<ContentSpaceProvider['uploadNewFile']>(async ({
      context,
      parent,
      name,
      source
    }) => {
      expect(context.expectedExternalBinding).toEqual(externalBinding)
      expect(source.sha256).toBe(sha256)
      expect(await source.read({ offset: 0, length: bytes.byteLength })).toEqual(bytes)
      return {
        invocationId: context.invocationId,
        parent,
        name,
        sourceSize: source.size,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'system-uploaded' },
        writeAfterObservation: {
          parent,
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'system-uploaded' },
          name,
          size: source.size
        }
      }
    })
    const service = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      uploadNewFile
    }), { now: () => now })

    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'uploaded.bin',
      includeTransferEvidence: true,
      openSource
    }, systemWriteCall())).resolves.toEqual({
      receipt: {
        invocationId: INVOCATION_ID,
        parent: ROOT,
        name: 'uploaded.bin',
        sourceSize: bytes.byteLength,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'system-uploaded' }
      },
      writeAfterObservation: {
        parent: ROOT,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'system-uploaded' },
        name: 'uploaded.bin',
        size: bytes.byteLength
      },
      bytes: bytes.byteLength,
      sha256
    })

    expect(openSource).toHaveBeenCalledOnce()
    expect(uploadNewFile).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('retires an oversized system upload source without Provider dispatch', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const close = vi.fn(async () => undefined)
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const service = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      uploadNewFile
    }), { now: () => now })

    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'oversized.bin',
      includeTransferEvidence: true,
      openSource: async (_signal, maxBytes) => {
        expect(maxBytes).toBe(CONTENT_SPACE_LIMITS.maxUploadBytes)
        return {
          name: 'oversized.bin',
          size: CONTENT_SPACE_LIMITS.maxUploadBytes + 1,
          sha256: createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'),
          read: async () => new Uint8Array([1, 2, 3]),
          close
        }
      }
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'bounds_exceeded', retry: 'never' }
    })

    expect(close).toHaveBeenCalledOnce()
    expect(uploadNewFile).not.toHaveBeenCalled()
  })

  it('freshly proves a paired system download before opening its destination and returns actual bytes', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const bytes = new Uint8Array([9, 8, 7, 6])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const order: string[] = []
    const destination = destinationFixture({
      write: vi.fn(async () => { order.push('write') }),
      commit: vi.fn(async () => { order.push('commit') })
    })
    const observeEntry = vi.fn<ContentSpaceProvider['observeEntry']>(async ({ reference }) => {
      order.push('containerId' in reference ? 'observe-root' : 'observe-candidate')
      const observation = observationFor(reference, 'fileId' in reference ? bytes.byteLength : 0)
      return 'containerId' in reference
        ? {
            ...observation,
            capabilities: observation.capabilities.map((state) => state.operation === 'download'
              ? {
                  operation: state.operation,
                  readiness: 'blocked_by_contract' as const,
                  reasonCode: 'resource_capability_missing' as const
                }
              : state)
          }
        : observation
    })
    const proveFileDescendant = vi.fn<ContentSpaceProvider['proveFileDescendant']>(async (input) => {
      order.push('prove')
      expect(input.root).toEqual(ROOT)
      expect(input.candidate).toEqual(FILE)
      expect(input.limits).toEqual(CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS)
      expect(input.context.expectedExternalBinding).toEqual(externalBinding)
      return {
        invocationId: input.context.invocationId,
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        authority: PROVIDER_INSTANCE_REF,
        root: input.root,
        candidate: input.candidate,
        binding: externalBinding,
        counts: {
          depth: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxDepth,
          pages: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxPages,
          nodes: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.maxNodes,
          elapsedMs: 0
        },
        provedAt: now.toISOString(),
        cacheable: false,
        portable: false
      }
    })
    const downloadFile = vi.fn<ProviderDownloadDispatch>(async ({
      context,
      reference,
      destination: sink
    }) => {
      order.push('download')
      await sink.write(bytes)
      return {
        invocationId: context.invocationId,
        reference,
        bytesWritten: bytes.byteLength
      }
    })
    const openDestination = vi.fn(async (_signal: AbortSignal, maxBytes: number) => {
      order.push('open-destination')
      expect(maxBytes).toBe(CONTENT_SPACE_LIMITS.maxFileBytes)
      return destination
    })
    const service = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      observeEntry,
      proveFileDescendant,
      authorizeDownload: async (input) => {
        order.push('authorize')
        return authorizeDownloadUsing(downloadFile)(input)
      }
    }), {
      now: () => now,
      monotonicNow: () => 100
    })

    await expect(service.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).resolves.toEqual({
      receipt: {
        invocationId: INVOCATION_ID,
        reference: FILE,
        bytesWritten: bytes.byteLength,
        digest: { algorithm: 'sha256', value: sha256 }
      },
      bytes: bytes.byteLength,
      sha256
    })

    expect(order).toEqual([
      'observe-root',
      'observe-candidate',
      'prove',
      'authorize',
      'open-destination',
      'download',
      'write',
      'commit'
    ])
    expect(proveFileDescendant).toHaveBeenCalledOnce()
    expect(downloadFile).toHaveBeenCalledOnce()
    expect(destination.commit).toHaveBeenCalledOnce()
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('does not open a Host destination when the real Provider read check denies access', async () => {
    const openDestination = vi.fn(async () => destinationFixture())
    const authorizeDownload = vi.fn<ContentSpaceProvider['authorizeDownload']>(async () => {
      throw new ContentSpaceOperationError({
        code: 'unauthorized',
        message: 'The Provider denied the exact file read.',
        retry: 'after-human-action'
      })
    })
    const proveFileDescendant = vi.fn(providerFixture().proveFileDescendant)
    const service = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      proveFileDescendant,
      authorizeDownload
    }))

    await expect(service.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'unauthorized', retry: 'after-human-action' }
    })

    expect(proveFileDescendant).toHaveBeenCalledOnce()
    expect(authorizeDownload).toHaveBeenCalledOnce()
    expect(openDestination).not.toHaveBeenCalled()
  })

  it('rejects stale paired proof evidence before opening a destination or dispatching download', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const destination = destinationFixture()
    const openDestination = vi.fn(async () => destination)
    const downloadFile = vi.fn(defaultDownloadFile)
    const proveFileDescendant = vi.fn<ContentSpaceProvider['proveFileDescendant']>(async ({
      context,
      root,
      candidate
    }) => ({
      invocationId: context.invocationId,
      providerInstanceRef: context.providerInstanceRef,
      authority: context.providerInstanceRef,
      root,
      candidate,
      binding: externalBinding,
      counts: { depth: 1, pages: 0, nodes: 2, elapsedMs: 0 },
      provedAt: new Date(now.getTime() - 1).toISOString(),
      cacheable: false,
      portable: false
    }))
    const service = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      observeEntry: async ({ reference }) => observationFor(reference, 0),
      proveFileDescendant,
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }), {
      verificationPolicy: systemTransferPolicy('download', 1, now),
      now: () => now,
      monotonicNow: () => 0
    })

    await expect(service.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })

    expect(proveFileDescendant).toHaveBeenCalledOnce()
    expect(downloadFile).not.toHaveBeenCalled()
    expect(openDestination).not.toHaveBeenCalled()
    expect(destination.commit).not.toHaveBeenCalled()
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('enforces the proof monotonic deadline and rejects unrelated PoC resource state', async () => {
    const now = new Date('2026-08-21T01:00:00.000Z')
    const destination = destinationFixture()
    const timedOpenDestination = vi.fn(async () => destination)
    const downloadFile = vi.fn(defaultDownloadFile)
    let monotonicRead = 0
    const timedService = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      observeEntry: async ({ reference }) => observationFor(reference, 0),
      proveFileDescendant: async ({ context, root, candidate }) => ({
        invocationId: context.invocationId,
        providerInstanceRef: context.providerInstanceRef,
        authority: context.providerInstanceRef,
        root,
        candidate,
        binding: externalBinding,
        counts: { depth: 1, pages: 0, nodes: 2, elapsedMs: 0 },
        provedAt: now.toISOString(),
        cacheable: false,
        portable: false
      }),
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }), {
      verificationPolicy: systemTransferPolicy('download', 1, now),
      now: () => now,
      monotonicNow: () => monotonicRead++ === 0
        ? 0
        : CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.deadlineMs + 1
    })

    await expect(timedService.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination: timedOpenDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'bounds_exceeded', retry: 'never' }
    })
    expect(downloadFile).not.toHaveBeenCalled()
    expect(timedOpenDestination).not.toHaveBeenCalled()
    expect(destination.abort).not.toHaveBeenCalled()

    const blockedDestination = destinationFixture()
    const proveBlocked = vi.fn(providerFixture().proveFileDescendant)
    const blockedDownload = vi.fn(defaultDownloadFile)
    const blockedService = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      observeEntry: async ({ reference }) => {
        const observation = observationFor(reference, 0)
        if ('containerId' in reference) return observation
        return {
          ...observation,
          capabilities: observation.capabilities.map((state) => state.operation === 'download'
            ? {
                operation: state.operation,
                readiness: 'poc_only' as const,
                reasonCode: 'instance_policy_blocked' as const
              }
            : state)
        }
      },
      proveFileDescendant: proveBlocked,
      authorizeDownload: authorizeDownloadUsing(blockedDownload)
    }), {
      verificationPolicy: systemTransferPolicy('download', 1, now),
      now: () => now
    })

    await expect(blockedService.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination: async () => blockedDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract', retry: 'never' }
    })
    expect(proveBlocked).not.toHaveBeenCalled()
    expect(blockedDownload).not.toHaveBeenCalled()
    expect(blockedDestination.abort).not.toHaveBeenCalled()

    const observeBlocked = vi.fn(providerFixture().observeEntry)
    const globallyBlockedService = serviceFor(providerFixture({
      attestExternalBinding: async () => externalBinding,
      describeCapabilities: async () => readyCapabilities.map((state) =>
        state.operation === 'observe-entry'
          ? {
              operation: state.operation,
              readiness: 'poc_only' as const,
              reasonCode: 'instance_policy_blocked' as const
            }
          : state),
      observeEntry: observeBlocked,
      proveFileDescendant: proveBlocked,
      authorizeDownload: authorizeDownloadUsing(blockedDownload)
    }), {
      verificationPolicy: systemTransferPolicy('download', 1, now),
      now: () => now
    })
    await expect(globallyBlockedService.downloadFile({
      reference: FILE,
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination: async () => blockedDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract', retry: 'never' }
    })
    expect(observeBlocked).not.toHaveBeenCalled()
  })

  it('rejects cross-Provider and Artifact candidates before a system destination is opened', async () => {
    const openDestination = vi.fn(async () => destinationFixture())
    const service = serviceFor(providerFixture())

    await expect(service.downloadFile({
      reference: { providerInstanceRef: 'provider-instance-beta', fileId: 'foreign' },
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'invalid_reference', retry: 'never' }
    })
    await expect(service.downloadFile({
      reference: { ...FILE, immutableVersionId: 'immutable-v1' },
      proofRoot: ROOT,
      includeTransferEvidence: true,
      openDestination
    }, systemWriteCall())).rejects.toMatchObject({
      detail: { code: 'invalid_reference', retry: 'never' }
    })
    expect(openDestination).not.toHaveBeenCalled()
  })

  it('bounds Host upload-source and download-destination acquisition within the total lease', async () => {
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const downloadFile = vi.fn(defaultDownloadFile)
    const service = serviceFor(providerFixture({
      uploadNewFile,
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }), {
      operationDeadlineMs: 10
    })
    const neverOpenSource = vi.fn((_signal: AbortSignal) =>
      new Promise<never>(() => undefined))
    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'input.txt',
      openSource: neverOpenSource
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    expect(uploadNewFile).not.toHaveBeenCalled()
    expect(neverOpenSource.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
    expect(neverOpenSource.mock.calls[0]?.[0].aborted).toBe(true)

    const neverOpenDestination = vi.fn((_signal: AbortSignal) =>
      new Promise<never>(() => undefined))
    await expect(service.downloadFile({
      reference: FILE,
      openDestination: neverOpenDestination
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    expect(downloadFile).not.toHaveBeenCalled()
    expect(neverOpenDestination.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
    expect(neverOpenDestination.mock.calls[0]?.[0].aborted).toBe(true)
  })

  it('maps an expired Agent Workspace transfer lease to unauthorized before Provider dispatch', async () => {
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const downloadFile = vi.fn(defaultDownloadFile)
    const service = serviceFor(providerFixture({
      uploadNewFile,
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }))
    const sensitiveHostMessage = 'expired lease at /private/sensitive/workspace'
    const expiredLease = () => new DomainFileTransferError(
      'principal_changed',
      sensitiveHostMessage
    )

    const upload = service.uploadNewFile({
      parent: ROOT,
      name: 'input.txt',
      openSource: async () => { throw expiredLease() }
    }, writeCall())
    await expect(upload).rejects.toMatchObject({
      message: 'The Host Principal changed.',
      detail: { code: 'unauthorized', retry: 'never' }
    })

    const download = service.downloadFile({
      reference: FILE,
      openDestination: async () => { throw expiredLease() }
    }, writeCall())
    await expect(download).rejects.toMatchObject({
      message: 'The Host Principal changed.',
      detail: { code: 'unauthorized', retry: 'never' }
    })

    await expect(upload.catch((error: unknown) => JSON.stringify(error)))
      .resolves.not.toContain(sensitiveHostMessage)
    await expect(download.catch((error: unknown) => JSON.stringify(error)))
      .resolves.not.toContain(sensitiveHostMessage)
    expect(uploadNewFile).not.toHaveBeenCalled()
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('keeps invalid-source bounds authoritative while cancelling unbounded Host cleanup', async () => {
    const close = vi.fn(() => new Promise<never>(() => undefined))
    let grantSignal: AbortSignal | undefined
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const service = serviceFor(providerFixture({ uploadNewFile }), {
      operationDeadlineMs: 10
    })

    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'oversized.bin',
      openSource: async (signal) => {
        grantSignal = signal
        return {
          name: 'oversized.bin',
          size: 16 * 1024 * 1024 + 1,
          read: async () => new Uint8Array(),
          close
        }
      }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'bounds_exceeded' } })
    expect(grantSignal?.aborted).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    expect(uploadNewFile).not.toHaveBeenCalled()
  })

  it('rejects concurrent or ignored invalid Provider writes and aborts without commit', async () => {
    const downloadFile = vi.fn<ProviderDownloadDispatch>(async ({
      context,
      reference,
      destination
    }) => {
      void destination.write(new Uint8Array([1]))
      void destination.write(new Uint8Array([2]))
      void destination.write(new Uint8Array())
      return { invocationId: context.invocationId, reference, bytesWritten: 0 }
    }) satisfies ProviderDownloadDispatch
    const destination = destinationFixture()
    const service = serviceFor(providerFixture({
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }))

    await expect(service.downloadFile({
      reference: FILE,
      openDestination: async () => destination
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })
    expect(destination.commit).not.toHaveBeenCalled()
    expect(destination.abort).toHaveBeenCalledTimes(1)
  })

  it('waits for an unawaited destination write, verifies bytes, then commits once', async () => {
    const writeGate = deferred<void>()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const digest = createHash('sha256').update(bytes).digest('hex')
    const destination = destinationFixture({
      write: vi.fn(() => writeGate.promise)
    })
    const entered = deferred<void>()
    const downloadFile = vi.fn<ProviderDownloadDispatch>(async ({
      context,
      reference,
      destination: sink
    }) => {
      void sink.write(bytes)
      entered.resolve()
      return {
        invocationId: context.invocationId,
        reference,
        bytesWritten: bytes.byteLength,
        digest: { algorithm: 'sha256' as const, value: digest }
      }
    }) satisfies ProviderDownloadDispatch
    const service = serviceFor(providerFixture({
      observeEntry: async ({ reference }) => observationFor(reference, bytes.byteLength),
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }))
    const pending = service.downloadFile({
      reference: FILE,
      openDestination: async () => destination
    }, writeCall())

    await entered.promise
    expect(destination.commit).not.toHaveBeenCalled()
    writeGate.resolve()
    await expect(pending).resolves.toMatchObject({ bytesWritten: 4 })
    expect(destination.commit).toHaveBeenCalledTimes(1)
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('aborts a self-consistent short download instead of committing partial bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const destination = destinationFixture()
    const downloadFile = vi.fn<ProviderDownloadDispatch>(async ({
      context,
      reference,
      destination: sink
    }) => {
      await sink.write(bytes)
      return {
        invocationId: context.invocationId,
        reference,
        bytesWritten: bytes.byteLength
      }
    }) satisfies ProviderDownloadDispatch
    const service = serviceFor(providerFixture({
      observeEntry: async ({ reference }) => observationFor(reference, bytes.byteLength + 1),
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }))

    await expect(service.downloadFile({
      reference: FILE,
      openDestination: async () => destination
    }, writeCall())).rejects.toMatchObject({
      detail: { code: 'provider_unavailable' }
    })
    expect(destination.commit).not.toHaveBeenCalled()
    expect(destination.abort).toHaveBeenCalledTimes(1)
  })

  it('uses an Artifact digest instead of the current live file size', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const digest = createHash('sha256').update(bytes).digest('hex')
    const artifact = Object.freeze({
      ...FILE,
      immutableVersionId: 'immutable-version-1',
      digest: Object.freeze({ algorithm: 'sha256' as const, value: digest })
    })
    const destination = destinationFixture()
    const downloadFile = vi.fn<ProviderDownloadDispatch>(async ({
      context,
      reference,
      destination: sink
    }) => {
      await sink.write(bytes)
      return {
        invocationId: context.invocationId,
        reference,
        bytesWritten: bytes.byteLength,
        digest: artifact.digest
      }
    }) satisfies ProviderDownloadDispatch
    const service = serviceFor(providerFixture({
      observeEntry: async ({ reference }) => observationFor(reference, bytes.byteLength + 1),
      observeImmutableVersion: async () => ({
        proven: true,
        proof: {
          reference: FILE,
          immutableVersionId: artifact.immutableVersionId,
          immutableIdentity: true,
          retentionGuaranteed: true,
          versionSpecificRetrieval: true,
          digest: artifact.digest
        }
      }),
      authorizeDownload: authorizeDownloadUsing(downloadFile)
    }))

    await expect(service.downloadFile({
      reference: artifact,
      openDestination: async () => destination
    }, writeCall())).resolves.toMatchObject({ bytesWritten: bytes.byteLength })
    expect(destination.commit).toHaveBeenCalledTimes(1)
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('returns outcome_unknown if Principal changes while destination commit is publishing', async () => {
    let principalCurrent = true
    const destination = destinationFixture({
      commit: vi.fn(async () => { principalCurrent = false })
    })
    const service = serviceFor(providerFixture())

    await expect(service.downloadFile({
      reference: FILE,
      openDestination: async () => destination
    }, writeCall(undefined, () => {
      if (!principalCurrent) throw new Error('Principal changed')
    }))).rejects.toMatchObject({ detail: { code: 'outcome_unknown' } })
  })

  it('re-proves a public ArtifactReference before portal dispatch', async () => {
    const resolvePortalTarget = vi.fn(async () => ({
      url: 'https://provider.invalid/portal',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }))
    const service = serviceFor(providerFixture({
      resolvePortalTarget,
      observeImmutableVersion: async () => ({
        proven: true,
        proof: {
          reference: FILE,
          immutableVersionId: 'real-version',
          immutableIdentity: true,
          retentionGuaranteed: true,
          versionSpecificRetrieval: true
        }
      })
    }))

    await expect(service.resolvePortalTarget({
      ...FILE,
      immutableVersionId: 'forged-version'
    }, readCall())).rejects.toMatchObject({
      detail: { code: 'immutable_version_unproven' }
    })
    expect(resolvePortalTarget).not.toHaveBeenCalled()
  })

  it('cannot bypass global or resource immutable-version Gates during Artifact re-proof', async () => {
    const artifact = Object.freeze({
      ...FILE,
      immutableVersionId: 'immutable-version-1'
    })
    const proof = vi.fn(async () => ({
      proven: true as const,
      proof: {
        reference: FILE,
        immutableVersionId: artifact.immutableVersionId,
        immutableIdentity: true as const,
        retentionGuaranteed: true as const,
        versionSpecificRetrieval: true as const
      }
    }))
    const globallyBlocked = serviceFor(providerFixture({
      describeCapabilities: async () => readyCapabilities.map((state) =>
        state.operation === 'observe-immutable-version'
          ? {
              operation: state.operation,
              readiness: 'blocked_by_contract' as const,
              reasonCode: 'instance_policy_blocked' as const
            }
          : state
      ),
      observeImmutableVersion: proof
    }))
    await expect(globallyBlocked.resolvePortalTarget(artifact, readCall()))
      .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })

    const resourceBlocked = serviceFor(providerFixture({
      observeEntry: async ({ reference }) => ({
        ...observationFor(reference),
        capabilities: readyCapabilities.map((state) =>
          state.operation === 'observe-immutable-version'
            ? {
                operation: state.operation,
                readiness: 'blocked_by_contract' as const,
                reasonCode: 'resource_capability_missing' as const
              }
            : state
        )
      }),
      observeImmutableVersion: proof
    }))
    await expect(resourceBlocked.resolvePortalTarget(artifact, readCall()))
      .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(proof).not.toHaveBeenCalled()
  })

  it('intersects observed resource readiness with Provider-level readiness', async () => {
    const service = serviceFor(providerFixture({
      describeCapabilities: async () => readyCapabilities.map((state) =>
        state.operation === 'download'
          ? {
              operation: state.operation,
              readiness: 'blocked_by_contract' as const,
              reasonCode: 'instance_policy_blocked' as const
            }
          : state
      )
    }))
    const observation = await service.observeEntry(FILE, readCall())
    expect(observation.capabilities.find(({ operation }) => operation === 'download'))
      .toEqual({
        operation: 'download',
        readiness: 'production_ready',
        reasonCode: 'available',
        admission: { status: 'blocked', reasonCode: 'instance_policy_blocked' }
      })
  })

  it('preserves an exact signed HTTPS query and rejects non-canonical targets', async () => {
    const exact = 'https://provider.invalid/portal?sig=a%2Bb&token=opaque%2Fvalue'
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    await expect(serviceFor(providerFixture({
      resolvePortalTarget: async () => ({ url: exact, expiresAt })
    })).resolvePortalTarget(FILE, readCall())).resolves.toEqual({ url: exact, expiresAt })

    for (const url of [
      ` ${exact}`,
      'https://provider.invalid/portal path',
      'https://provider.invalid\\@attacker.invalid/portal',
      'https://user@provider.invalid/portal',
      'https://@provider.invalid/portal',
      'https://provider.invalid/portal#secret',
      'https://provider.invalid/portal#'
    ]) {
      await expect(serviceFor(providerFixture({
        resolvePortalTarget: async () => ({ url, expiresAt })
      })).resolvePortalTarget(FILE, readCall())).rejects.toMatchObject({
        detail: { code: 'unsafe_portal_target' }
      })
    }
  })

  it('maps Host portal cancellation and post-dispatch uncertainty without fallback', async () => {
    const service = serviceFor(providerFixture())
    await expect(service.openPortalTarget(async () => {
      throw new DomainExternalNavigationError('cancelled', 'not dispatched')
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'cancelled' } })
    await expect(service.openPortalTarget(async () => {
      throw new DomainExternalNavigationError('outcome_unknown', 'secret target')
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'outcome_unknown' } })
  })

  it('rejects Provider authority and identity drift', async () => {
    const service = serviceFor(providerFixture({
      listContainers: async () => ({
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        items: [{
          reference: { providerInstanceRef: 'provider-instance-beta', containerId: 'root' },
          scope: 'shared',
          label: 'Wrong authority'
        }]
      })
    }))
    await expect(service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })

    const emptyDrift = serviceFor(providerFixture({
      listContainers: async () => ({
        providerInstanceRef: 'provider-instance-beta',
        items: []
      }),
      listEntries: async () => ({
        parent: { ...ROOT, containerId: 'other-root' },
        items: []
      })
    }))
    await expect(emptyDrift.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })
    await expect(emptyDrift.listEntries({
      parent: ROOT,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })

    const observeService = serviceFor(providerFixture({
      observeEntry: async () => ({
        entry: {
          kind: 'file',
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'other-file' },
          label: 'Wrong file',
          size: 0
        },
        capabilities: readyCapabilities
      })
    }))
    await expect(observeService.observeEntry(FILE, readCall())).rejects.toMatchObject({
      detail: { code: 'provider_unavailable' }
    })
  })

  it('maps a malformed factory return to provider_unavailable', async () => {
    const service = serviceForFactory(() => ({
      contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION
    }) as ContentSpaceProvider)
    await expect(service.listContainers({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      page: { limit: 10 }
    }, readCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })
  })

  it('blocks unverified native-document operations before transfer or Provider dispatch', async () => {
    const execute = vi.fn(async () => { throw new Error('must not dispatch') })
    const openWorkspaceUploadSource = vi.fn(async () => {
      throw new Error('must not open transfer')
    })
    const service = serviceFor(providerFixture({
      features: {
        nativeDocuments: nativeDocumentsFixture(execute, [
          {
            operation: 'update',
            readiness: 'poc_only',
            reasonCode: 'verification_profile_required'
          },
          {
            operation: 'edit',
            readiness: 'blocked_by_contract',
            reasonCode: 'provider_contract_missing'
          }
        ])
      }
    }), {
      featureFileTransfers: {
        openUploadSource: vi.fn(async () => { throw new Error('must not open transfer') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('must not open transfer') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination: vi.fn(async () => {
          throw new Error('must not open transfer')
        })
      }
    })

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'update',
        document: { resourceType: 'native_document', reference: FILE },
        baseHash: 'a'.repeat(64),
        content: { encoding: 'json', value: { type: 'doc' } }
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'edit',
        document: { resourceType: 'native_document', reference: FILE },
        planReceiptId: 'receipt_plan_a',
        baseHash: 'a'.repeat(64)
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('dispatches native-document reads only against the exact Broker content target', async () => {
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    const execute = vi.fn(async ({ context }: any) => {
      expect(context.assertPrincipalCurrent).toBe(assertPrincipalCurrent)
      await context.assertPrincipalCurrent()
      const remainingMs = Date.parse(context.deadlineAt) - Date.now()
      expect(remainingMs).toBeGreaterThan(180_000)
      expect(remainingMs).toBeLessThanOrEqual(240_000)
      return {
        contractVersion: '1.0.0' as const,
        resourceType: 'native_document' as const,
        operation: 'read' as const,
        invocationId: context.invocationId,
        outcome: 'succeeded' as const,
        result: {
          kind: 'content' as const,
          document: { resourceType: 'native_document' as const, reference: FILE },
          documentHash: 'a'.repeat(64),
          content: { type: 'doc' }
        }
      }
    })
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }))
    const target = featureTarget(FILE)

    await expect(service.executeNativeDocument({
      target,
      request: {
        operation: 'read',
        document: { resourceType: 'native_document', reference: FILE }
      }
    }, writeCall(undefined, assertPrincipalCurrent))).resolves.toMatchObject({
      outcome: 'succeeded',
      operation: 'read'
    })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      effect: 'read',
      target,
      operation: 'read'
    }))
    expect(assertPrincipalCurrent.mock.calls.length).toBeGreaterThanOrEqual(3)

    await expect(service.executeNativeDocument({
      target,
      request: {
        operation: 'read',
        document: {
          resourceType: 'native_document',
          reference: { ...FILE, fileId: 'other-file' }
        }
      }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'invalid_target' } })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a native-document receipt for a different document', async () => {
    const execute = vi.fn(async (input: any) => ({
      contractVersion: '1.0.0' as const,
      resourceType: 'native_document' as const,
      operation: 'read' as const,
      invocationId: input.context.invocationId,
      outcome: 'succeeded' as const,
      result: {
        kind: 'content' as const,
        document: {
          resourceType: 'native_document' as const,
          reference: { ...FILE, fileId: 'different-file' }
        },
        documentHash: 'a'.repeat(64),
        content: { type: 'doc' }
      }
    }))
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }))

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'read',
        document: { resourceType: 'native_document', reference: FILE }
      }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'provider_unavailable' } })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps Host transfer handles out of native Provider dispatch and injects them after commit', async () => {
    const bytes = new TextEncoder().encode('exported')
    const destination = {
      label: 'draft.pdf',
      write: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('unexpected source') }),
      openDownloadDestination: vi.fn(async () => destination),
      openWorkspaceUploadSource: vi.fn(async () => { throw new Error('unexpected source') }),
      openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unexpected path') })
    }
    const execute = vi.fn(async (input: any) => {
      expect(input.request).not.toHaveProperty('destinationHandle')
      expect(input.destination).toBeDefined()
      await input.destination.write(bytes)
      return {
        contractVersion: '1.0.0',
        resourceType: 'native_document',
        operation: 'export',
        invocationId: input.context.invocationId,
        outcome: 'succeeded',
        result: {
          kind: 'artifact',
          name: 'draft.pdf',
          mediaType: 'application/pdf',
          bytesWritten: bytes.byteLength,
          digest: {
            algorithm: 'sha256',
            value: createHash('sha256').update(bytes).digest('hex')
          }
        }
      } as const
    })
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const destinationHandle = 'xfer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'export',
        document: { resourceType: 'native_document', reference: FILE },
        format: 'pdf',
        destinationHandle
      }
    }, writeCall())).resolves.toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'artifact', transferHandle: destinationHandle }
    })
    expect(destination.commit).toHaveBeenCalledOnce()
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('opens Agent native-document upload bytes only from the active Workspace path', async () => {
    const bytes = new TextEncoder().encode('native import')
    const close = vi.fn(async () => undefined)
    const openWorkspaceUploadSource = vi.fn(async () => ({
      name: 'import.mdoc',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close
    }))
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
      openWorkspaceUploadSource,
      openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
    }
    const execute = vi.fn(async (input: any) => {
      expect(input.request).not.toHaveProperty('workspaceRelativePath')
      expect(input.request).not.toHaveProperty('sourceHandle')
      expect(await input.source.read({ offset: 0, length: bytes.byteLength })).toEqual(bytes)
      return {
        contractVersion: '1.0.0',
        resourceType: 'native_document',
        operation: 'import',
        invocationId: input.context.invocationId,
        outcome: 'succeeded',
        result: {
          kind: 'document',
          document: { resourceType: 'native_document', reference: FILE },
          documentHash: 'a'.repeat(64),
          revisionId: 'revision-import'
        }
      } as const
    })
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const assertPrincipalCurrent = vi.fn()

    await expect(service.executeNativeDocument({
      target: featureTarget(ROOT),
      request: {
        operation: 'import',
        resourceType: 'native_document',
        parent: ROOT,
        workspaceRelativePath: 'imports/import.mdoc'
      }
    }, { ...writeCall(undefined, assertPrincipalCurrent), audience: 'agent' }))
      .resolves.toMatchObject({ outcome: 'succeeded' })

    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'imports/import.mdoc',
      maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes
    }))
    expect(fileTransfers.openUploadSource).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalled()
  })

  it('commits Agent native-document downloads to a no-overwrite Workspace destination', async () => {
    const bytes = new TextEncoder().encode('workspace export')
    const destination = {
      label: 'document.pdf',
      write: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined)
    }
    const openWorkspaceDownloadDestination = vi.fn(async () => destination)
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('unused') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openWorkspaceUploadSource: vi.fn(async () => { throw new Error('unused') }),
      openWorkspaceDownloadDestination
    }
    const execute = vi.fn(async (input: any) => {
      expect(input.request).not.toHaveProperty('workspaceRelativePath')
      expect(input.request).not.toHaveProperty('destinationHandle')
      await input.destination.write(bytes)
      return {
        contractVersion: '1.0.0',
        resourceType: 'native_document',
        operation: 'export',
        invocationId: input.context.invocationId,
        outcome: 'succeeded',
        result: {
          kind: 'artifact',
          name: 'document.pdf',
          mediaType: 'application/pdf',
          bytesWritten: bytes.byteLength,
          digest: {
            algorithm: 'sha256',
            value: createHash('sha256').update(bytes).digest('hex')
          }
        }
      } as const
    })
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const assertPrincipalCurrent = vi.fn()

    const receipt = await service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'export',
        document: { resourceType: 'native_document', reference: FILE },
        format: 'pdf',
        workspaceRelativePath: 'exports/document.pdf'
      }
    }, { ...writeCall(undefined, assertPrincipalCurrent), audience: 'agent' })

    expect(receipt).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'artifact',
        workspaceRelativePath: 'exports/document.pdf',
        bytesWritten: bytes.byteLength
      }
    })
    expect(JSON.stringify(receipt)).not.toContain('xfer_')
    expect(openWorkspaceDownloadDestination).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'exports/document.pdf',
      maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes
    }))
    expect(fileTransfers.openDownloadDestination).not.toHaveBeenCalled()
    expect(destination.commit).toHaveBeenCalledOnce()
    expect(destination.abort).not.toHaveBeenCalled()
    expect(assertPrincipalCurrent).toHaveBeenCalled()
  })

  it('bridges Agent native-document image transfers through Workspace byte ports', async () => {
    const bytes = new TextEncoder().encode('image bytes')
    const source = {
      name: 'figure.png',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const destination = {
      label: 'figure.png',
      write: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openWorkspaceUploadSource: vi.fn(async () => source),
      openWorkspaceDownloadDestination: vi.fn(async () => destination)
    }
    const execute = vi.fn(async (input: any) => {
      expect(input.request).not.toHaveProperty('workspaceRelativePath')
      if (input.operation === 'image-upload') {
        expect(await input.source.read({ offset: 0, length: bytes.byteLength })).toEqual(bytes)
        return {
          contractVersion: '1.0.0',
          resourceType: 'native_document',
          operation: 'image-upload',
          invocationId: input.context.invocationId,
          outcome: 'succeeded',
          result: { kind: 'image', resourceId: 'image-one', mediaType: 'image/png' }
        } as const
      }
      await input.destination.write(bytes)
      return {
        contractVersion: '1.0.0',
        resourceType: 'native_document',
        operation: 'image-download',
        invocationId: input.context.invocationId,
        outcome: 'succeeded',
        result: {
          kind: 'artifact',
          name: 'figure.png',
          mediaType: 'image/png',
          bytesWritten: bytes.byteLength
        }
      } as const
    })
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const call = { ...writeCall(), audience: 'agent' as const }

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'image-upload',
        document: { resourceType: 'native_document', reference: FILE },
        workspaceRelativePath: 'assets/figure.png',
        mediaType: 'image/png'
      }
    }, call)).resolves.toMatchObject({ outcome: 'succeeded', result: { kind: 'image' } })
    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'image-download',
        document: { resourceType: 'native_document', reference: FILE },
        position: 1,
        workspaceRelativePath: 'downloads/figure.png'
      }
    }, call)).resolves.toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'artifact', workspaceRelativePath: 'downloads/figure.png' }
    })

    expect(fileTransfers.openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'assets/figure.png'
    }))
    expect(fileTransfers.openWorkspaceDownloadDestination).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'downloads/figure.png' })
    )
    expect(fileTransfers.openUploadSource).not.toHaveBeenCalled()
    expect(fileTransfers.openDownloadDestination).not.toHaveBeenCalled()
    expect(source.close).toHaveBeenCalledOnce()
    expect(destination.commit).toHaveBeenCalledOnce()
  })

  it('fails closed before Provider dispatch when an Agent Workspace destination exists', async () => {
    const execute = vi.fn()
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('unused') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openWorkspaceUploadSource: vi.fn(async () => { throw new Error('unused') }),
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new DomainFileTransferError(
          'destination_conflict',
          'The Workspace destination already exists.'
        )
      })
    }
    const service = serviceFor(providerFixture({
      features: { nativeDocuments: nativeDocumentsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })

    await expect(service.executeNativeDocument({
      target: featureTarget(FILE),
      request: {
        operation: 'export',
        document: { resourceType: 'native_document', reference: FILE },
        format: 'pdf',
        workspaceRelativePath: 'exports/existing.pdf'
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'conflict', retry: 'after-human-action' }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires provider administration authority for provider-scoped extended operations', async () => {
    const execute = vi.fn(async () => ({ ok: true, value: { items: [] } }))
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }))
    const request = { providerInstanceRef: PROVIDER_INSTANCE_REF, page: { limit: 10 } }

    await expect(service.executeExtendedOperation({
      target: {
        kind: 'provider-administration',
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      operation: 'listMetadataTypes',
      request
    }, writeCall())).resolves.toEqual({ ok: true, value: { items: [] } })
    await expect(service.executeExtendedOperation({
      target: featureTarget(ROOT),
      operation: 'listMetadataTypes',
      request
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('blocks root source and permission mutations while allowing the root as a destination', async () => {
    const execute = vi.fn(async () => ({
      ok: true as const,
      value: {
        items: [{
          ok: true as const,
          source: FILE,
          result: { ...FILE, fileId: 'copy-one' }
        }]
      }
    }))
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }))
    const target = featureTarget(ROOT)

    await expect(service.executeExtendedOperation({
      target,
      operation: 'deleteEntries',
      request: { entries: [ROOT] }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'invalid_target' } })
    await expect(service.executeExtendedOperation({
      target,
      operation: 'changePermissions',
      request: {
        target: ROOT,
        targetKind: 'shared-container',
        changes: [{
          action: 'remove',
          principal: {
            providerInstanceRef: PROVIDER_INSTANCE_REF,
            kind: 'user',
            principalId: 'user-one'
          }
        }]
      }
    }, writeCall())).rejects.toMatchObject({ detail: { code: 'invalid_target' } })
    expect(execute).not.toHaveBeenCalled()

    await expect(service.executeExtendedOperation({
      target,
      operation: 'copyEntries',
      request: { entries: [FILE], destination: ROOT }
    }, writeCall())).resolves.toMatchObject({ ok: true })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('fails closed on an undeclared exact extended operation before opening its transfer', async () => {
    const execute = vi.fn(async () => { throw new Error('unexpected execute') })
    const openWorkspaceUploadSource = vi.fn(async () => {
      throw new Error('unexpected transfer')
    })
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('unexpected transfer') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('unexpected transfer') }),
      openWorkspaceUploadSource,
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new Error('unexpected transfer')
      })
    }
    const service = serviceFor(providerFixture({
      features: {
        extendedOperations: extendedOperationsFixture(execute, [{
          operation: 'renameEntry',
          readiness: 'production_ready',
          reasonCode: 'available'
        }])
      }
    }), { featureFileTransfers: fileTransfers })

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        workspaceRelativePath: 'versions/file-v2.bin',
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract' }
    })
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('keeps extended PoC operations blocked without a separately reviewed trusted gate', async () => {
    const execute = vi.fn(async () => ({ ok: true as const, value: { items: [] } }))
    let operationStates: ContentSpaceExtendedOperationState[] = [{
      operation: 'listMetadataTypes' as const,
      readiness: 'poc_only' as const,
      reasonCode: 'verification_profile_required' as const
    }]
    const service = serviceFor(providerFixture({
      features: {
        extendedOperations: Object.freeze({
          describeOperations: () => operationStates,
          execute
        })
      }
    }))
    const input = {
      target: {
        kind: 'provider-administration' as const,
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      operation: 'listMetadataTypes' as const,
      request: { providerInstanceRef: PROVIDER_INSTANCE_REF, page: { limit: 10 } }
    }

    await expect(service.executeExtendedOperation(
      input,
      { ...writeCall(), audience: 'agent' }
    )).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    await expect(service.executeExtendedOperation(
      input,
      { ...writeCall(), audience: 'ui' }
    )).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })

    operationStates = [{
      operation: 'listMetadataTypes',
      readiness: 'poc_only',
      reasonCode: 'audience_policy_blocked'
    }]
    await expect(service.executeExtendedOperation(
      input,
      { ...writeCall(), audience: 'ui' }
    )).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports an unknown write outcome when Provider version evidence contradicts the Host snapshot', async () => {
    const bytes = new TextEncoder().encode('attested version')
    const source = {
      name: 'version.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => source),
      openDownloadDestination: vi.fn(async () => { throw new Error('unexpected destination') }),
      openWorkspaceUploadSource: vi.fn(async () => source),
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new Error('unexpected destination')
      })
    }
    const execute = vi.fn(async () => ({
      ok: true as const,
      value: {
        reference: FILE,
        versionId: 'version-two',
        strategy: 'major' as const,
        byteLength: bytes.byteLength,
        digest: { algorithm: 'sha256' as const, value: 'f'.repeat(64) }
      }
    }))
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        workspaceRelativePath: 'versions/version.bin',
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['changes the file identity', {
      reference: { ...FILE, fileId: 'file-two' },
      versionId: 'version-two',
      strategy: 'major' as const
    }],
    ['does not return a new version identity', {
      reference: FILE,
      versionId: 'version-one',
      strategy: 'major' as const
    }],
    ['changes the requested version strategy', {
      reference: FILE,
      versionId: 'version-two',
      strategy: 'minor' as const
    }]
  ])('reports an unknown write outcome when the Provider %s', async (_label, receipt) => {
    const bytes = new TextEncoder().encode('same-file update')
    const source = {
      name: 'version.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => source),
      openDownloadDestination: vi.fn(async () => { throw new Error('unexpected destination') }),
      openWorkspaceUploadSource: vi.fn(async () => source),
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new Error('unexpected destination')
      })
    }
    const execute = vi.fn(async () => ({ ok: true as const, value: receipt }))
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        workspaceRelativePath: 'versions/version.bin',
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }, { ...writeCall(), audience: 'agent' })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it('bridges extended source handles without exposing them to the Provider', async () => {
    const bytes = new TextEncoder().encode('extended-source')
    const source = {
      name: 'update.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => source),
      openDownloadDestination: vi.fn(async () => { throw new Error('unexpected destination') }),
      openWorkspaceUploadSource: vi.fn(async () => { throw new Error('unexpected path') }),
      openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unexpected path') })
    }
    const execute = vi.fn(async (input: any) => {
      if (input.operation === 'updateFileVersion') {
        expect(input.request).not.toHaveProperty('sourceHandle')
        expect(await input.source.read({ offset: 0, length: bytes.byteLength })).toEqual(bytes)
        return {
          ok: true,
          value: { reference: FILE, versionId: 'version-two', strategy: 'major' }
        }
      }
      if (input.operation === 'addAttachment') {
        expect(input.request).not.toHaveProperty('sourceHandle')
        expect(input.source).toBeDefined()
        return {
          ok: true,
          value: {
            master: FILE,
            attachment: { ...FILE, fileId: 'attachment-one' },
            name: 'attachment.bin',
            size: bytes.byteLength
          }
        }
      }
      throw new Error(`unexpected extended operation ${String(input.operation)}`)
    })
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const sourceHandle = 'xfer_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        sourceHandle,
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }, writeCall())).resolves.toEqual({
      ok: true,
      value: {
        reference: FILE,
        versionId: 'version-two',
        strategy: 'major',
        byteLength: bytes.byteLength,
        digest: { algorithm: 'sha256', value: source.sha256 }
      }
    })
    expect(source.close).toHaveBeenCalledOnce()

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'addAttachment',
      request: { master: FILE, name: 'attachment.bin', sourceHandle }
    }, writeCall())).resolves.toMatchObject({ ok: true })
    expect(source.close).toHaveBeenCalledTimes(2)
  })

  it('bridges Agent extended uploads through active Workspace paths', async () => {
    const bytes = new TextEncoder().encode('agent extended bytes')
    const source = {
      name: 'payload.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('raw handle path was used') }),
      openWorkspaceUploadSource: vi.fn(async () => source),
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new Error('unexpected destination')
      })
    }
    const execute = vi.fn(async (input: any) => {
      expect(input.request).not.toHaveProperty('workspaceRelativePath')
      expect(input.request).not.toHaveProperty('sourceHandle')
      expect(input.request).not.toHaveProperty('destinationHandle')
      if (input.operation === 'updateFileVersion') {
        expect(await input.source.read({ offset: 0, length: bytes.byteLength })).toEqual(bytes)
        return {
          ok: true,
          value: { reference: FILE, versionId: 'version-two', strategy: 'major' }
        } as const
      }
      if (input.operation === 'addAttachment') {
        expect(input.source).toBeDefined()
        return {
          ok: true,
          value: {
            master: FILE,
            attachment: { ...FILE, fileId: 'attachment-agent' },
            name: 'evidence.bin',
            size: bytes.byteLength
          }
        } as const
      }
      throw new Error(`unexpected extended operation ${String(input.operation)}`)
    })
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const call = { ...writeCall(), audience: 'agent' as const }

    const updated = await service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        workspaceRelativePath: 'versions/payload-v2.bin',
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }, call)
    expect(updated).toEqual({
      ok: true,
      value: {
        reference: FILE,
        versionId: 'version-two',
        strategy: 'major',
        byteLength: bytes.byteLength,
        digest: {
          algorithm: 'sha256',
          value: source.sha256
        }
      }
    })
    expect(JSON.stringify(updated)).not.toMatch(/xfer_|workspaceRelativePath|\/private\//u)
    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'addAttachment',
      request: {
        master: FILE,
        name: 'evidence.bin',
        workspaceRelativePath: 'attachments/evidence.bin'
      }
    }, call)).resolves.toMatchObject({ ok: true })

    expect(fileTransfers.openWorkspaceUploadSource).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        relativePath: 'versions/payload-v2.bin',
        maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes
      })
    )
    expect(fileTransfers.openWorkspaceUploadSource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        relativePath: 'attachments/evidence.bin',
        maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes
      })
    )
    expect(fileTransfers.openWorkspaceDownloadDestination).not.toHaveBeenCalled()
    expect(fileTransfers.openUploadSource).not.toHaveBeenCalled()
    expect(fileTransfers.openDownloadDestination).not.toHaveBeenCalled()
    expect(source.close).toHaveBeenCalledTimes(2)
  })
})

function featureTarget(primary: ContentEntryReference): ContentSpaceProviderContentTarget {
  return Object.freeze({
    kind: 'content',
    root: ROOT,
    primary,
    authorized: Object.freeze([ROOT, FILE])
  })
}

function administrationStates(
  readyOperation: (typeof CONTENT_SPACE_ADMINISTRATION_OPERATIONS)[number]
): readonly ContentSpaceAdministrationOperationState[] {
  return Object.freeze(CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => Object.freeze({
    operation,
    readiness: operation === readyOperation
      ? 'production_ready' as const
      : 'blocked_by_contract' as const,
    reasonCode: operation === readyOperation
      ? 'available' as const
      : 'provider_contract_missing' as const
  })))
}

function administrationPortFixture(
  overrides: Partial<ContentSpaceAdministrationPort> = {}
): ContentSpaceAdministrationPort {
  const root = toPortableContentContainerReference(ROOT)
  const summary = Object.freeze({
    root,
    label: 'Research Team',
    contentOwnerUserId: 'user:owner',
    pinned: false
  })
  return defineContentSpaceAdministrationPort({
    contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
    listSpaces: async () => Object.freeze({ items: Object.freeze([summary]) }),
    createSpace: async () => summary,
    observeSpace: async () => summary,
    updateSpace: async () => summary,
    pinSpace: async () => Object.freeze({ ...summary, pinned: true }),
    unpinSpace: async () => summary,
    openRoot: async () => Object.freeze({ root }),
    listMembers: async () => Object.freeze({ root, items: Object.freeze([]) }),
    addMember: async (input) => Object.freeze({
      root,
      member: input.member
    }),
    removeMember: async (input) => Object.freeze({
      root,
      member: input.member,
      removed: true as const
    }),
    ...overrides
  })
}

function providerFixture(
  overrides: Partial<ContentSpaceProvider> = {}
): ContentSpaceProvider {
  const provider: ContentSpaceProvider = {
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    attestExternalBinding: async () => undefined,
    describeCapabilities: async () => readyCapabilities,
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: [{ reference: ROOT, scope: 'personal', label: 'Root' }]
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async ({ reference }) => observationFor(reference),
    proveFileDescendant: async ({ context, root, candidate }) => ({
      invocationId: context.invocationId,
      providerInstanceRef: context.providerInstanceRef,
      authority: context.providerInstanceRef,
      root,
      candidate,
      binding: context.expectedExternalBinding ?? externalBinding,
      counts: { depth: 1, pages: 1, nodes: 2, elapsedMs: 0 },
      provedAt: new Date().toISOString(),
      cacheable: false,
      portable: false
    }),
    createFolder: async ({ context, parent, name }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'created' }
    }),
    uploadNewFile: async ({ context, parent, name, source }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
      writeAfterObservation: {
        parent,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' },
        name,
        size: source.size
      }
    }),
    authorizeDownload: authorizeDownloadUsing(defaultDownloadFile),
    resolvePortalTarget: async () => ({
      url: 'https://provider.invalid/portal',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }),
    observeImmutableVersion: async () => ({
      proven: false,
      reasonCode: 'resource_capability_missing'
    }),
    ...overrides
  }
  return defineContentSpaceProvider(provider)
}

function observationFor(reference: ContentEntryReference, size = 0) {
  if ('containerId' in reference) {
    return Object.freeze({
      entry: Object.freeze({ kind: 'container' as const, reference, label: 'Container' }),
      capabilities: readyCapabilities
    })
  }
  return Object.freeze({
    entry: Object.freeze({
      kind: 'file' as const,
      reference: Object.freeze({
        providerInstanceRef: reference.providerInstanceRef,
        fileId: reference.fileId
      }),
      label: 'File',
      size
    }),
    capabilities: readyCapabilities
  })
}

type CreateProvider = ProviderFactoryRuntimeValueInput<
  ContentSpaceProvider,
  ContentSpaceProviderHostPorts
>['createProvider']

function serviceFor(
  provider: ContentSpaceProvider,
  options: Readonly<{
    operationDeadlineMs?: number
    platform?: Readonly<{ fileTransfers: boolean; externalNavigation: boolean }>
    featureFileTransfers?: DomainMainFileTransferHost
    verificationPolicy?: ContentSpaceVerificationPolicy
    now?: () => Date
    monotonicNow?: () => number
  }> = {}
): ContentSpaceService {
  return serviceForFactory(() => provider, options)
}

function serviceForFactory(
  createProvider: CreateProvider,
  options: Readonly<{
    operationDeadlineMs?: number
    platform?: Readonly<{ fileTransfers: boolean; externalNavigation: boolean }>
    featureFileTransfers?: DomainMainFileTransferHost
    verificationPolicy?: ContentSpaceVerificationPolicy
    now?: () => Date
    monotonicNow?: () => number
  }> = {}
): ContentSpaceService {
  const catalog = new ContentSpaceProviderCatalog(contributionHost([
    factoryContribution(createProvider),
    instanceContribution()
  ]))
  return new ContentSpaceService({
    catalog,
    platform: options.platform ?? { fileTransfers: true, externalNavigation: true },
    ...(options.featureFileTransfers
      ? { featureFileTransfers: options.featureFileTransfers }
      : {}),
    ...(options.verificationPolicy
      ? { verificationPolicy: options.verificationPolicy }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.monotonicNow ? { monotonicNow: options.monotonicNow } : {}),
    ...(options.operationDeadlineMs === undefined
      ? {}
      : { operationDeadlineMs: options.operationDeadlineMs })
  })
}

function factoryContribution(createProvider: CreateProvider): DomainMainContribution {
  return contribution(
    'fixture.content-space-provider-factory',
    {
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: PROVIDER_KIND
    },
    defineContentSpaceProviderFactory<ContentSpaceProvider, ContentSpaceProviderHostPorts>({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: PROVIDER_KIND,
      createProvider
    })
  )
}

function instanceContribution(): DomainMainContribution {
  return contribution(
    'fixture.content-space-provider-instance',
    {
      location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: PROVIDER_KIND,
      displayName: 'Fixture Content Space'
    },
    defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: PROVIDER_KIND,
      displayName: 'Fixture Content Space'
    })
  )
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/content-space-provider',
    owner: Object.freeze({ moduleId: 'fixture.content-space', moduleVersion: '1.0.0' }),
    version: PROVIDER_FACTORY_CONTRACT_VERSION,
    contract,
    value
  })
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({
    list: (kind: typeof MAIN_EXTENSION_CONTRIBUTION_KIND) =>
      kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  })
}

function readCall(
  assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'] =
    () => undefined
): ContentSpaceServiceCallContext {
  return Object.freeze({ reauthorizedPrincipal: principal, assertPrincipalCurrent })
}

function writeCall(
  signal = new AbortController().signal,
  assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'] =
    () => undefined
): ContentSpaceServiceWriteCallContext {
  return Object.freeze({
    ...readCall(assertPrincipalCurrent),
    invocationId: INVOCATION_ID,
    signal
  })
}

function systemWriteCall(
  signal = new AbortController().signal,
  assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'] =
    () => undefined
): ContentSpaceServiceWriteCallContext {
  return Object.freeze({
    ...writeCall(signal, assertPrincipalCurrent),
    audience: 'system' as const,
    requireVerificationProfile: true
  })
}

function systemTransferPolicy(
  operation: 'upload-new' | 'download',
  maxBytes: number,
  now: Date
): ContentSpaceVerificationPolicy {
  return Object.freeze({
    contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
    profiles: Object.freeze([{
      profileId: `system-${operation}`,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'system' as const,
      authority: Object.freeze({ kind: 'content-root' as const, root: ROOT }),
      operation: Object.freeze({ family: 'ordinary' as const, operation }),
      transferLimits: operation === 'upload-new'
        ? Object.freeze({ maxUploadBytes: maxBytes, maxDownloadBytes: 0 })
        : Object.freeze({ maxUploadBytes: 0, maxDownloadBytes: maxBytes }),
      externalBinding: Object.freeze({
        externalSubject: externalBinding.externalSubject,
        bindingRevision: externalBinding.bindingRevision
      }),
      validFrom: new Date(now.getTime() - 60_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString()
    }])
  })
}

function extendedOperationsFixture(
  execute: ContentSpaceExtendedOperationsExecutor['execute'],
  operationStates = Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).map((operation) => ({
    operation: operation as keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
): ContentSpaceExtendedOperationsExecutor {
  return Object.freeze({
    describeOperations: () => operationStates,
    execute
  })
}

function nativeDocumentsFixture(
  execute: ContentSpaceNativeDocumentExecutor['execute'],
  operationStates: readonly ContentSpaceNativeDocumentOperationState[] =
    NATIVE_DOCUMENT_OPERATIONS.map((operation) => ({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
): ContentSpaceNativeDocumentExecutor {
  return Object.freeze({
    describeOperations: () => operationStates,
    execute
  })
}

function destinationFixture(overrides: Partial<Readonly<{
  write(chunk: Uint8Array): Promise<void>
  commit(): Promise<void>
  abort(): Promise<void>
}>> = {}) {
  return Object.freeze({
    write: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    ...overrides
  })
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return Object.freeze({ promise, resolve, reject })
}
