import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
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
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  defineContentSpaceProvider,
  type ContentEntryReference,
  type ContentSpaceCapabilityState,
  type ContentSpaceProvider,
  type ContentSpaceProviderHostPorts
} from '../contract.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'
import {
  ContentSpaceService,
  type ContentSpaceServiceCallContext,
  type ContentSpaceServiceWriteCallContext
} from './service.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const PROVIDER_KIND = 'fixture-content-space'
const INVOCATION_ID = 'invocation_content_space_0001'
const ROOT = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'root'
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
  it('admits PoC-only reads only for trusted UI and Agent caller audiences', async () => {
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

    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'ui'
    })).resolves.toMatchObject({ providerInstanceRef: PROVIDER_INSTANCE_REF })
    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'agent'
    })).resolves.toMatchObject({ providerInstanceRef: PROVIDER_INSTANCE_REF })
    await expect(service.listContainers(request, {
      ...readCall(),
      audience: 'system'
    })).rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
  })

  it('applies the same trusted-audience gate to PoC resource reads', async () => {
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

    await expect(service.listEntries(request, { ...readCall(), audience: 'ui' }))
      .resolves.toMatchObject({ parent: ROOT })
    await expect(service.listEntries(request, { ...readCall(), audience: 'agent' }))
      .resolves.toMatchObject({ parent: ROOT })
    await expect(service.listEntries(request, { ...readCall(), audience: 'system' }))
      .rejects.toMatchObject({ detail: { code: 'blocked_by_contract' } })
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
      }
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
})

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
  }> = {}
): ContentSpaceService {
  return serviceForFactory(() => provider, options)
}

function serviceForFactory(
  createProvider: CreateProvider,
  options: Readonly<{
    operationDeadlineMs?: number
    platform?: Readonly<{ fileTransfers: boolean; externalNavigation: boolean }>
  }> = {}
): ContentSpaceService {
  const catalog = new ContentSpaceProviderCatalog(contributionHost([
    factoryContribution(createProvider),
    instanceContribution()
  ]))
  return new ContentSpaceService({
    catalog,
    platform: options.platform ?? { fileTransfers: true, externalNavigation: true },
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
  assertPrincipalCurrent: () => void = () => undefined
): ContentSpaceServiceCallContext {
  return Object.freeze({ reauthorizedPrincipal: principal, assertPrincipalCurrent })
}

function writeCall(
  signal = new AbortController().signal,
  assertPrincipalCurrent: () => void = () => undefined
): ContentSpaceServiceWriteCallContext {
  return Object.freeze({
    ...readCall(assertPrincipalCurrent),
    invocationId: INVOCATION_ID,
    signal
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
