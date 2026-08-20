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
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  defineContentSpaceProvider,
  toPortableContentContainerReference,
  type ContentEntryReference,
  type ContentSpaceCapabilityState,
  type ContentSpaceProvider,
  type ContentSpaceProviderHostPorts
} from '../contract.js'
import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
  defineContentSpaceAdministrationPort,
  type ContentSpaceAdministrationOperationState,
  type ContentSpaceAdministrationPort,
  type ProjectContentSpaceProvisioningPort
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

describe('ContentSpaceService', () => {
  it('does not authorize an Agent administration scope from dormant Project provisioning', async () => {
    const describeOperations = vi.fn(() => administrationStates('provision-project'))
    const bind = vi.fn(async () => Object.freeze({
      administration: administrationPortFixture()
    }))
    const service = serviceFor(providerFixture({
      features: { administration: { describeOperations, bind } }
    }))

    await expect(service.authorizeProviderAdministration(PROVIDER_INSTANCE_REF, {
      ...writeCall(),
      audience: 'agent'
    })).rejects.toMatchObject({
      detail: { code: 'blocked_by_contract', retry: 'never' }
    })
    expect(describeOperations).toHaveBeenCalledOnce()
    expect(bind).not.toHaveBeenCalled()
  })

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
        contentOwnerUserId: 'user:owner',
        idempotencyKey: 'idem_create_space_0001'
      }
    }, {
      ...writeCall(),
      audience: 'agent'
    })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
    expect(describeOperations).toHaveBeenCalledOnce()
    expect(bind).not.toHaveBeenCalled()
    expect(createSpace).not.toHaveBeenCalled()
  })

  it('dispatches ready Project provisioning through the Provider-owned provisioning port', async () => {
    const root = toPortableContentContainerReference(ROOT)
    const intent = Object.freeze({
      projectId: 'project:alpha',
      projectLabel: 'Alpha Project',
      contentOwnerUserId: 'user:owner',
      contentMemberUserIds: Object.freeze(['user:owner', 'user:member']),
      intentRevision: 1,
      idempotencyKey: 'idem_project_alpha_0001'
    })
    const report = Object.freeze({
      projectId: intent.projectId,
      intentRevision: intent.intentRevision,
      status: 'ready' as const,
      root,
      contentOwnerUserId: intent.contentOwnerUserId,
      members: Object.freeze(intent.contentMemberUserIds.map((contentUserId) => Object.freeze({
        contentUserId,
        status: 'ready' as const
      })))
    })
    const provisionProjectContentSpace = vi.fn(async () => report)
    const projectProvisioning: ProjectContentSpaceProvisioningPort = Object.freeze({
      contractVersion: PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
      provisionProjectContentSpace
    })
    const bind = vi.fn(async () => Object.freeze({
      administration: administrationPortFixture(),
      projectProvisioning
    }))
    const service = serviceFor(providerFixture({
      features: {
        administration: {
          describeOperations: () => administrationStates('provision-project'),
          bind
        }
      }
    }))

    await expect(service.executeAdministration({
      target: Object.freeze({
        kind: 'provider-administration' as const,
        providerInstanceRef: PROVIDER_INSTANCE_REF
      }),
      operation: 'provision-project',
      request: intent
    }, {
      ...writeCall(),
      audience: 'agent'
    })).resolves.toEqual(report)

    expect(provisionProjectContentSpace).toHaveBeenCalledOnce()
    expect(provisionProjectContentSpace).toHaveBeenCalledWith(intent)
    expect(bind).toHaveBeenCalledOnce()
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
    const downloadFile = vi.fn(providerFixture().downloadFile)
    const resolvePortalTarget = vi.fn(providerFixture().resolvePortalTarget)
    const service = serviceFor(providerFixture({
      uploadNewFile,
      downloadFile,
      resolvePortalTarget
    }), {
      platform: { fileTransfers: false, externalNavigation: false }
    })
    const described = await service.describeCapabilities(PROVIDER_INSTANCE_REF, readCall())
    for (const operation of ['upload-new', 'download', 'portal-target'] as const) {
      expect(described.items.find((state) => state.operation === operation)).toMatchObject({
        readiness: 'blocked_by_contract',
        reasonCode: 'platform_gate_blocked'
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
        readiness: 'blocked_by_contract',
        reasonCode: 'provider_contract_missing'
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
    const close = vi.fn(async () => undefined)
    const uploadNewFile = vi.fn(() => new Promise<never>(() => undefined))
    const service = serviceFor(providerFixture({ uploadNewFile }), {
      operationDeadlineMs: 10
    })

    await expect(service.uploadNewFile({
      parent: ROOT,
      name: 'input.txt',
      openSource: async () => ({
        name: 'input.txt',
        size: 1,
        read: async () => new Uint8Array([1]),
        close
      })
    }, writeCall())).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(uploadNewFile).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
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
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' }
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

  it('bounds Host upload-source and download-destination acquisition within the total lease', async () => {
    const uploadNewFile = vi.fn(providerFixture().uploadNewFile)
    const downloadFile = vi.fn(providerFixture().downloadFile)
    const service = serviceFor(providerFixture({ uploadNewFile, downloadFile }), {
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
    const downloadFile = vi.fn(providerFixture().downloadFile)
    const service = serviceFor(providerFixture({ uploadNewFile, downloadFile }))
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
    const downloadFile = vi.fn(async ({ context, reference, destination }) => {
      void destination.write(new Uint8Array([1]))
      void destination.write(new Uint8Array([2]))
      void destination.write(new Uint8Array())
      return { invocationId: context.invocationId, reference, bytesWritten: 0 }
    }) satisfies ContentSpaceProvider['downloadFile']
    const destination = destinationFixture()
    const service = serviceFor(providerFixture({ downloadFile }))

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
    const downloadFile = vi.fn(async ({ context, reference, destination: sink }) => {
      void sink.write(bytes)
      entered.resolve()
      return {
        invocationId: context.invocationId,
        reference,
        bytesWritten: bytes.byteLength,
        digest: { algorithm: 'sha256' as const, value: digest }
      }
    }) satisfies ContentSpaceProvider['downloadFile']
    const service = serviceFor(providerFixture({ downloadFile }))
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
        readiness: 'blocked_by_contract',
        reasonCode: 'instance_policy_blocked'
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

  it('bridges extended source and destination handles without exposing them to the Provider', async () => {
    const bytes = new TextEncoder().encode('extended-pdf')
    const source = {
      name: 'update.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const destination = {
      label: 'export.pdf',
      write: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined)
    }
    const fileTransfers: DomainMainFileTransferHost = {
      openUploadSource: vi.fn(async () => source),
      openDownloadDestination: vi.fn(async () => destination),
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
      expect(input.effect).toBe('workspace-write')
      expect(input.request).not.toHaveProperty('destinationHandle')
      await input.destination.write(bytes)
      return {
        ok: true,
        value: {
          reference: FILE,
          format: 'pdf',
          bytesWritten: bytes.byteLength,
          digest: {
            algorithm: 'sha256',
            value: createHash('sha256').update(bytes).digest('hex')
          }
        }
      }
    })
    const service = serviceFor(providerFixture({
      features: { extendedOperations: extendedOperationsFixture(execute) }
    }), { featureFileTransfers: fileTransfers })
    const sourceHandle = 'xfer_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const destinationHandle = 'xfer_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

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

    await expect(service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'exportFileAsPdf',
      request: { reference: FILE, destinationHandle }
    }, writeCall())).resolves.toMatchObject({ ok: true })
    expect(destination.commit).toHaveBeenCalledOnce()
    expect(destination.abort).not.toHaveBeenCalled()
  })

  it('bridges all Agent extended transfers through active Workspace paths', async () => {
    const bytes = new TextEncoder().encode('agent extended bytes')
    const source = {
      name: 'payload.bin',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: vi.fn(async () => bytes),
      close: vi.fn(async () => undefined)
    }
    const destination = {
      label: 'export.pdf',
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
      await input.destination.write(bytes)
      return {
        ok: true,
        value: {
          reference: FILE,
          format: 'pdf',
          bytesWritten: bytes.byteLength,
          digest: {
            algorithm: 'sha256',
            value: createHash('sha256').update(bytes).digest('hex')
          }
        }
      } as const
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
    const exported = await service.executeExtendedOperation({
      target: featureTarget(FILE),
      operation: 'exportFileAsPdf',
      request: {
        reference: FILE,
        workspaceRelativePath: 'exports/file.pdf'
      }
    }, call)
    expect(exported).toMatchObject({ ok: true, value: { format: 'pdf' } })
    expect(JSON.stringify(exported)).not.toContain('xfer_')

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
    expect(fileTransfers.openWorkspaceDownloadDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: 'exports/file.pdf',
        maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes
      })
    )
    expect(fileTransfers.openUploadSource).not.toHaveBeenCalled()
    expect(fileTransfers.openDownloadDestination).not.toHaveBeenCalled()
    expect(source.close).toHaveBeenCalledTimes(2)
    expect(destination.commit).toHaveBeenCalledOnce()
    expect(destination.abort).not.toHaveBeenCalled()
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
    pinned: false,
    revision: 'revision:1'
  })
  return defineContentSpaceAdministrationPort({
    contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
    listSpaces: async () => Object.freeze({ items: Object.freeze([summary]) }),
    createSpace: async () => summary,
    observeSpace: async () => summary,
    updateSpace: async () => summary,
    pinSpace: async () => Object.freeze({ ...summary, pinned: true }),
    unpinSpace: async () => summary,
    openRoot: async () => Object.freeze({ root, revision: summary.revision }),
    listMembers: async () => Object.freeze({ root, items: Object.freeze([]) }),
    addMember: async (input) => Object.freeze({
      contentUserId: input.contentUserId,
      role: 'internal' as const,
      revision: 'revision:2'
    }),
    removeMember: async (input) => Object.freeze({
      root,
      contentUserId: input.contentUserId,
      removed: true as const,
      revision: 'revision:2'
    }),
    ...overrides
  })
}

function providerFixture(
  overrides: Partial<ContentSpaceProvider> = {}
): ContentSpaceProvider {
  const provider: ContentSpaceProvider = {
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    describeCapabilities: async () => readyCapabilities,
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: [{ reference: ROOT, scope: 'personal', label: 'Root' }]
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async ({ reference }) => observationFor(reference),
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
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' }
    }),
    downloadFile: async ({ context, reference }) => ({
      invocationId: context.invocationId,
      reference,
      bytesWritten: 0
    }),
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

function observationFor(reference: ContentEntryReference) {
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
      size: 0
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
