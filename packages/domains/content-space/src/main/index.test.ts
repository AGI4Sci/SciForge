import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainMainHost,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import { DomainExternalNavigationError } from '@sciforge/domain-sdk/external-navigation'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_REFERENCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_LIMITS,
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
  CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID,
  ContentSpaceOperationError,
  contentSpaceSystemDownloadResultSchema,
  contentSpaceSystemUploadNewResultSchema,
  contentSpaceSuccess,
  defineContentSpaceProvider,
  toPortableContentContainerReference,
  toPortableContentFileReference,
  type ContentSpaceProvider,
  type ContentSpaceResult
} from '../contract.js'
import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  type ContentSpaceAdministrationPort
} from '../administration-contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '../extended-operations-contract.js'
import { NATIVE_DOCUMENT_OPERATIONS } from '../native-document-contract.js'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from '../provider-features.js'
import {
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION,
  CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION
} from '../definition.js'
import {
  CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
  defineContentSpaceVerificationProfileContribution
} from '../verification-policy.js'
import * as mainExports from './index.js'
import { createDomainMainEntry } from './index.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const ROOT = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'root'
})
const FILE = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  fileId: 'file-one'
})
const exactSignedUrl = 'https://provider.invalid/portal?sig=a%2Bb&token=opaque%2Fvalue'
const principal: PrincipalSnapshot = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'content-space-main-test-device',
  identityVersion: 1
})
const externalBinding = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})
const readyAdministrationStates = Object.freeze(
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => Object.freeze({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
)
type CapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    callerId: string
    principal: typeof principal
    workspaceId?: string
    capabilityGrants?: readonly string[]
    principalSnapshotDigest?: string
    executionContextDigest?: string
  }>
  invocationId: string
  signal: AbortSignal
  assertPrincipalCurrent(): void
  resource?: Readonly<{ resourceId: string; resourceKind: string; workspaceId?: string }>
  issueResource(registration: any): unknown
}>

type PortableMaterializeReference = Parameters<
  NonNullable<DomainMainHost['portableResources']>['materialize']
>[0]

type CapabilityDefinition = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global' | 'workspace' | 'resource'
  resourceKinds?: readonly string[]
  tags: readonly string[]
  effect: 'read' | 'workspace-write' | 'external-write' | 'destructive'
  approval: 'none' | 'confirmation'
  delegatedBatchGrant?: string
  autonomousWrite?: 'resource-authorized'
  concurrency: Readonly<{ revision: 'none'; idempotency: 'none' | 'required' }>
  inputSchema: Readonly<{
    parse(value: unknown): unknown
    safeParse(value: unknown): Readonly<{ success: boolean }>
  }>
  outputSchema: Readonly<{ safeParse(value: unknown): Readonly<{ success: boolean }> }>
  handler(input: unknown, context: CapabilityContext): Promise<Readonly<{
    output: ContentSpaceResult<unknown>
  }>>
}>

describe('Content Space main composition', () => {
  it('exports only the standard process entry, not raw catalog/service/Provider paths', () => {
    expect(Object.keys(mainExports).sort()).toEqual(['createDomainMainEntry'])
  })

  it('stays lazy through composition and lists instances without creating a Provider', async () => {
    const createProvider = vi.fn(() => providerFixture())
    const defineCapability = vi.fn((options: unknown) => options)
    const host = mainHost({ defineCapability })
    const entry = createDomainMainEntry(host)
    expect(defineCapability).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()

    const definitions = await activateDefinitions(entry.contributions, contributionHost(
      providerContributions(createProvider)
    ))
    const expectedCapabilityIds = Object.values(CONTENT_SPACE_CAPABILITY_IDS).sort()
    expect(definitions.map(({ id }) => id).sort()).toEqual(expectedCapabilityIds)
    expect(defineCapability).toHaveBeenCalledTimes(expectedCapabilityIds.length)
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances)
    const result = await list.handler({}, capabilityContext())
    expect(result.output).toEqual(contentSpaceSuccess({
      items: [{
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        providerKind: 'fixture-content-space',
        label: 'Fixture Content Space'
      }]
    }))
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('contributes provider-owned transfer and provisioning grants with exact delegated actions', async () => {
    const entry = createDomainMainEntry(mainHost())
    const transferGrant = entry.contributions.find(({ id }) =>
      id === CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION.id
    )

    expect(transferGrant).toMatchObject({
      id: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION.id,
      kind: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION.kind,
      value: {
        id: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID,
        eligibility: 'trusted-domain-runtime'
      }
    })
    expect(entry.contributions.find(({ id }) =>
      id === CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION.id
    )).toMatchObject({
      id: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION.id,
      kind: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION.kind,
      value: {
        id: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        eligibility: 'trusted-domain-runtime'
      }
    })

    const definitions = await activateDefinitions(
      entry.contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    expect(definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemTransferPreflight
    )).toMatchObject({
      id: 'content-space.system-transfer-preflight',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.systemDownload)).toMatchObject({
      id: 'content-space.system-download',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew)).toMatchObject({
      id: 'content-space.system-upload-new',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect([
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminObserveSpace,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember
    ].map((actionId) => definition(definitions, actionId))).toEqual([
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID }),
      expect.objectContaining({ audiences: ['agent', 'system'], delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID })
    ])
  })

  it('enforces system audience, Workspace scope, and the exact grant before decoding authority', async () => {
    const createProvider = vi.fn(() => providerFixture())
    const openUploadSource = vi.fn(async () => { throw new Error('unexpected UI source') })
    const openDownloadDestination = vi.fn(async () => {
      throw new Error('unexpected UI destination')
    })
    const openWorkspaceUploadSource = vi.fn(async () => {
      throw new Error('unexpected Workspace source')
    })
    const openWorkspaceDownloadDestination = vi.fn(async () => {
      throw new Error('unexpected Workspace destination')
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        fileTransfers: {
          openUploadSource,
          openDownloadDestination,
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination
        }
      })).contributions,
      contributionHost(providerContributions(createProvider))
    )
    const upload = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew)
    const granted = [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
    const invalidContexts: readonly CapabilityContext[] = [
      capabilityContext(undefined, 'agent', {
        workspaceId: 'workspace-one',
        capabilityGrants: granted
      }),
      capabilityContext(undefined, 'system', { capabilityGrants: granted }),
      capabilityContext(undefined, 'system', { workspaceId: 'workspace-one' }),
      capabilityContext(undefined, 'system', {
        workspaceId: 'workspace-one',
        capabilityGrants: ['content-space.some-other-grant']
      }),
      capabilityContext(undefined, 'system', {
        workspaceId: 'workspace-one',
        capabilityGrants: granted,
        resource: {
          resourceId: 'unexpected-resource',
          resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
          workspaceId: 'workspace-one'
        }
      })
    ]

    for (const context of invalidContexts) {
      const result = await upload.handler({}, context)
      expect(result.output).toMatchObject({
        ok: false,
        error: { code: 'unauthorized', retry: 'never' }
      })
    }
    expect(createProvider).not.toHaveBeenCalled()
    expect(openUploadSource).not.toHaveBeenCalled()
    expect(openDownloadDestination).not.toHaveBeenCalled()
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
    expect(openWorkspaceDownloadDestination).not.toHaveBeenCalled()
  })

  it('runs a production-ready Provider transfer without a static verification profile', async () => {
    const attestExternalBinding = vi.fn(async () => externalBinding)
    const uploadNewFile = vi.fn<ContentSpaceProvider['uploadNewFile']>(async ({
      context, parent, name, source
    }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'profile-free-file' },
      writeAfterObservation: {
        parent,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'profile-free-file' },
        name,
        size: source.size
      }
    }))
    const createProvider = vi.fn(() => providerFixture({
      attestExternalBinding,
      uploadNewFile
    }))
    const bytes = Uint8Array.of(1)
    const openWorkspaceUploadSource = vi.fn(async () => ({
      name: 'real.txt',
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      read: async () => bytes,
      close: async () => undefined
    }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination: vi.fn(async () => {
            throw new Error('unused')
          })
        }
      })).contributions,
      contributionHost(providerContributions(createProvider))
    )

    const systemAuthority = {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
    } as const
    const transferInput = {
      root: toPortableContentContainerReference(ROOT),
      name: 'real.txt',
      workspaceRelativePath: 'inputs/real.txt'
    } as const
    const preflightDefinition = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemTransferPreflight
    )
    expect(preflightDefinition).toMatchObject({
      effect: 'read',
      approval: 'none',
      scope: 'workspace',
      audiences: ['system'],
      concurrency: { revision: 'none', idempotency: 'none' }
    })
    const preflight = await preflightDefinition.handler({
      operation: 'upload-new',
      input: transferInput
    }, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_preflight_0001'
    }))
    expect(preflight.output).toMatchObject(contentSpaceSuccess({
      execution: {
        invocationId: 'invocation_content_space_system_preflight_0001'
      },
      status: 'ready',
      intentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observationRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      authorization: 'not_granted',
      cacheable: false
    }))
    expect(JSON.stringify(preflight.output)).not.toMatch(
      /token|credential|https?:|externalSubject|bindingRevision/u
    )
    expect(attestExternalBinding).toHaveBeenCalledTimes(2)
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
    expect(uploadNewFile).not.toHaveBeenCalled()

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler(transferInput, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_upload_0001'
    }))

    expect(result.output).toMatchObject({ ok: true, value: { bytes: 1 } })
    expect(createProvider).toHaveBeenCalledOnce()
    expect(attestExternalBinding).toHaveBeenCalledTimes(3)
    expect(openWorkspaceUploadSource).toHaveBeenCalledOnce()
    expect(uploadNewFile).toHaveBeenCalledOnce()
  })

  it('fails a system transfer before Provider dispatch when portable materialization is unavailable', async () => {
    const createProvider = vi.fn(() => providerFixture({
      attestExternalBinding: async () => externalBinding
    }))
    const openWorkspaceUploadSource = vi.fn(async () => {
      throw new Error('Workspace source must remain unopened.')
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        portableResources: undefined,
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
        }
      })).contributions,
      contributionHost([
        ...providerContributions(createProvider),
        systemVerificationProfileContribution(
          'fixture-system-materialization-required',
          'upload-new',
          64
        )
      ])
    )

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      name: 'blocked.txt',
      workspaceRelativePath: 'inputs/blocked.txt'
    }, capabilityContext(undefined, 'system', {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
    }))

    expect(result.output).toMatchObject({
      ok: false,
      error: { code: 'composition_not_ready', retry: 'never' }
    })
    expect(createProvider).not.toHaveBeenCalled()
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
  })

  it('discards an acquired root when candidate materialization rejects the current session', async () => {
    const portableResources = portableResourcesFixture({ failAt: 2 })
    const createProvider = vi.fn(() => providerFixture())
    const openWorkspaceDownloadDestination = vi.fn(async () => {
      throw new Error('Workspace destination must remain unopened.')
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        portableResources,
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceDownloadDestination
        }
      })).contributions,
      contributionHost(providerContributions(createProvider))
    )

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemDownload
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      candidate: toPortableContentFileReference(FILE),
      workspaceRelativePath: 'outputs/session-rejected.bin'
    }, capabilityContext(undefined, 'system', {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
    }))

    expect(result.output).toMatchObject({ ok: false })
    expect(portableResources.materialize).toHaveBeenCalledTimes(2)
    expect(portableResources.discard).toHaveBeenCalledTimes(1)
    expect(portableResources.liveCount()).toBe(0)
    expect(createProvider).not.toHaveBeenCalled()
    expect(openWorkspaceDownloadDestination).not.toHaveBeenCalled()
  })

  it('propagates exact profile limits through real system upload and download receipts', async () => {
    const uploadBytes = new TextEncoder().encode('real upload bytes')
    const downloadBytes = new TextEncoder().encode('real download bytes')
    const uploadSha256 = createHash('sha256').update(uploadBytes).digest('hex')
    const downloadSha256 = createHash('sha256').update(downloadBytes).digest('hex')
    const uploadLimit = uploadBytes.byteLength + 11
    const downloadLimit = downloadBytes.byteLength + 13
    const uploadedReference = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: 'uploaded-system-file'
    })
    const sourceRead = vi.fn(async ({ offset, length }: Readonly<{
      offset: number
      length: number
    }>) => uploadBytes.slice(offset, offset + length))
    const sourceClose = vi.fn(async () => undefined)
    const destinationWrite = vi.fn(async (chunk: Uint8Array) => {
      expect(chunk).toEqual(downloadBytes)
    })
    const destinationCommit = vi.fn(async () => undefined)
    const destinationAbort = vi.fn(async () => undefined)
    const events: string[] = []
    const portableResources = portableResourcesFixture()
    const openWorkspaceUploadSource = vi.fn(async () => {
      events.push('open-upload-source')
      return Object.freeze({
        name: 'workspace-upload.bin',
        size: uploadBytes.byteLength,
        sha256: uploadSha256,
        read: sourceRead,
        close: sourceClose
      })
    })
    const openWorkspaceDownloadDestination = vi.fn(async () => {
      events.push('open-download-destination')
      return Object.freeze({
        label: 'workspace-download.bin',
        write: destinationWrite,
        commit: destinationCommit,
        abort: destinationAbort
      })
    })
    const systemCapabilities = Object.freeze([
      Object.freeze({
        operation: 'observe-entry' as const,
        readiness: 'production_ready' as const,
        reasonCode: 'available' as const
      }),
      Object.freeze({
        operation: 'upload-new' as const,
        readiness: 'production_ready' as const,
        reasonCode: 'available' as const
      }),
      Object.freeze({
        operation: 'download' as const,
        readiness: 'production_ready' as const,
        reasonCode: 'available' as const
      })
    ])
    const attestExternalBinding = vi.fn(async () => externalBinding)
    const observeEntry = vi.fn(async ({ reference }:
      Parameters<ContentSpaceProvider['observeEntry']>[0]) => ({
      entry: 'containerId' in reference
        ? {
            kind: 'container' as const,
            reference,
            label: 'Root'
          }
        : {
            kind: 'file' as const,
            reference,
            label: 'Candidate',
            size: downloadBytes.byteLength
          },
      capabilities: systemCapabilities
    }))
    let uploadAuthorized = true
    const uploadNewFile = vi.fn(async ({ context, parent, name, source }:
      Parameters<ContentSpaceProvider['uploadNewFile']>[0]) => {
      events.push('provider-upload')
      if (!uploadAuthorized) {
        throw new ContentSpaceOperationError({
          code: 'unauthorized',
          message: 'The current Provider session cannot upload to this root.',
          retry: 'never'
        })
      }
      const actual = await source.read({ offset: 0, length: source.size })
      expect(actual).toEqual(uploadBytes)
      expect(source.sha256).toBe(uploadSha256)
      return {
        invocationId: context.invocationId,
        parent,
        name,
        sourceSize: source.size,
        reference: uploadedReference,
        writeAfterObservation: {
          parent,
          reference: uploadedReference,
          name,
          size: source.size
        }
      }
    })
    const proveFileDescendant = vi.fn(async ({ context, root, candidate }:
      Parameters<ContentSpaceProvider['proveFileDescendant']>[0]) => {
      events.push('prove-descendant')
      return {
        invocationId: context.invocationId,
        providerInstanceRef: context.providerInstanceRef,
        authority: context.providerInstanceRef,
        root,
        candidate,
        binding: context.expectedExternalBinding!,
        counts: { depth: 1, pages: 1, nodes: 2, elapsedMs: 0 },
        provedAt: new Date().toISOString(),
        cacheable: false as const,
        portable: false as const
      }
    })
    let downloadAuthorized = true
    const authorizeDownload = vi.fn<ContentSpaceProvider['authorizeDownload']>(async ({
      context,
      reference
    }) => {
      events.push('provider-authorize-download')
      if (!downloadAuthorized) {
        throw new ContentSpaceOperationError({
          code: 'unauthorized',
          message: 'The current Provider session cannot download this file.',
          retry: 'never'
        })
      }
      let available = true
      return {
        consume: async ({ destination }) => {
          if (!available) throw new Error('lease already consumed')
          available = false
          events.push('provider-download')
          await destination.write(downloadBytes)
          return {
            invocationId: context.invocationId,
            reference,
            bytesWritten: downloadBytes.byteLength
          }
        },
        retire: async () => { available = false }
      }
    })
    const provider = providerFixture({
      attestExternalBinding,
      describeCapabilities: async () => systemCapabilities,
      observeEntry,
      uploadNewFile,
      proveFileDescendant,
      authorizeDownload
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        portableResources,
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination
        }
      })).contributions,
      contributionHost([
        ...providerContributions(() => provider),
        systemVerificationProfileContribution(
          'fixture-system-upload',
          'upload-new',
          uploadLimit
        ),
        systemVerificationProfileContribution(
          'fixture-system-download',
          'download',
          downloadLimit
        )
      ])
    )
    const systemAuthority = {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
    } as const
    const upload = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      name: 'uploaded.bin',
      workspaceRelativePath: 'inputs/uploaded.bin'
    }, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_upload_0001'
    }))

    expect(upload.output).toMatchObject(contentSpaceSuccess({
      operation: 'upload-new',
      execution: {
        callerId: 'renderer:test',
        principal,
        principalSnapshotDigest: 'a'.repeat(64),
        workspaceId: 'workspace-one',
        executionContextDigest: 'b'.repeat(64),
        invocationId: 'invocation_content_space_system_upload_0001'
      },
      root: toPortableContentContainerReference(ROOT),
      receipt: {
        invocationId: 'invocation_content_space_system_upload_0001',
        parent: ROOT,
        name: 'uploaded.bin',
        sourceSize: uploadBytes.byteLength,
        reference: uploadedReference
      },
      portableReference: toPortableContentFileReference(uploadedReference),
      writeAfterObservation: {
        parent: toPortableContentContainerReference(ROOT),
        reference: toPortableContentFileReference(uploadedReference),
        name: 'uploaded.bin',
        size: uploadBytes.byteLength
      },
      workspaceRelativePath: 'inputs/uploaded.bin',
      observedAt: expect.any(String),
      bytes: uploadBytes.byteLength,
      sha256: uploadSha256,
      transferReceiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      providerDigest: {
        status: 'deferred', reason: 'provider_digest_not_in_run0_contract'
      }
    }))
    const uploadResult = contentSpaceSystemUploadNewResultSchema.parse(upload.output)
    if (!uploadResult.ok) throw new Error('Expected a system upload receipt.')
    const {
      transferReceiptDigest: uploadReceiptDigest,
      observationDigest: uploadObservationDigest,
      ...uploadReceiptFacts
    } = uploadResult.value
    expect(uploadReceiptDigest).toBe(canonicalDigestFixture(uploadReceiptFacts))
    expect(uploadObservationDigest).toBe(canonicalDigestFixture({
      operation: uploadResult.value.operation,
      execution: uploadResult.value.execution,
      root: uploadResult.value.root,
      observation: uploadResult.value.writeAfterObservation,
      observedAt: uploadResult.value.observedAt
    }))
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith({
      relativePath: 'inputs/uploaded.bin',
      maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
      systemAuthorization: {
        requiredSystemCapabilityGrant: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
      },
      signal: expect.any(AbortSignal)
    })
    expect(sourceRead).toHaveBeenCalledWith({
      offset: 0,
      length: uploadBytes.byteLength
    })
    expect(sourceClose).toHaveBeenCalledOnce()
    expect(portableResources.materialize).toHaveBeenCalledTimes(1)
    expect(portableResources.materialize).toHaveBeenNthCalledWith(
      1,
      toPortableContentContainerReference(ROOT),
      { exportPolicy: 'forbid', signal: expect.any(AbortSignal) }
    )
    expect(portableResources.discard).toHaveBeenCalledTimes(1)
    expect(portableResources.liveCount()).toBe(0)
    expect(JSON.stringify(upload.output)).not.toContain('portable-process-local')

    const download = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemDownload
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      candidate: toPortableContentFileReference(FILE),
      workspaceRelativePath: 'outputs/downloaded.bin'
    }, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_download_0001'
    }))

    expect(download.output).toMatchObject(contentSpaceSuccess({
      operation: 'download',
      execution: {
        callerId: 'renderer:test',
        principal,
        principalSnapshotDigest: 'a'.repeat(64),
        workspaceId: 'workspace-one',
        executionContextDigest: 'b'.repeat(64),
        invocationId: 'invocation_content_space_system_download_0001'
      },
      root: toPortableContentContainerReference(ROOT),
      receipt: {
        invocationId: 'invocation_content_space_system_download_0001',
        reference: FILE,
        bytesWritten: downloadBytes.byteLength,
        digest: { algorithm: 'sha256', value: downloadSha256 }
      },
      readAfterObservation: {
        reference: toPortableContentFileReference(FILE),
        bytes: downloadBytes.byteLength,
        sha256: downloadSha256
      },
      workspaceRelativePath: 'outputs/downloaded.bin',
      observedAt: expect.any(String),
      bytes: downloadBytes.byteLength,
      sha256: downloadSha256,
      transferReceiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      providerDigest: {
        status: 'deferred', reason: 'provider_digest_not_in_run0_contract'
      }
    }))
    const downloadResult = contentSpaceSystemDownloadResultSchema.parse(download.output)
    if (!downloadResult.ok) throw new Error('Expected a system download receipt.')
    const {
      transferReceiptDigest: downloadReceiptDigest,
      observationDigest: downloadObservationDigest,
      ...downloadReceiptFacts
    } = downloadResult.value
    expect(downloadReceiptDigest).toBe(canonicalDigestFixture(downloadReceiptFacts))
    expect(downloadObservationDigest).toBe(canonicalDigestFixture({
      operation: downloadResult.value.operation,
      execution: downloadResult.value.execution,
      root: downloadResult.value.root,
      observation: downloadResult.value.readAfterObservation,
      observedAt: downloadResult.value.observedAt
    }))
    expect(openWorkspaceDownloadDestination).toHaveBeenCalledWith({
      relativePath: 'outputs/downloaded.bin',
      maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes,
      systemAuthorization: {
        requiredSystemCapabilityGrant: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
      },
      signal: expect.any(AbortSignal)
    })
    expect(proveFileDescendant).toHaveBeenCalledOnce()
    expect(events.indexOf('prove-descendant')).toBeLessThan(
      events.indexOf('provider-authorize-download')
    )
    expect(events.indexOf('provider-authorize-download')).toBeLessThan(
      events.indexOf('open-download-destination')
    )
    expect(events.indexOf('open-download-destination'))
      .toBeLessThan(events.indexOf('provider-download'))
    expect(destinationWrite).toHaveBeenCalledOnce()
    expect(destinationCommit).toHaveBeenCalledOnce()
    expect(destinationAbort).not.toHaveBeenCalled()
    expect(attestExternalBinding).toHaveBeenCalledTimes(2)
    expect(portableResources.materialize).toHaveBeenCalledTimes(3)
    expect(portableResources.materialize).toHaveBeenNthCalledWith(
      2,
      toPortableContentContainerReference(ROOT),
      { exportPolicy: 'forbid', signal: expect.any(AbortSignal) }
    )
    expect(portableResources.materialize).toHaveBeenNthCalledWith(
      3,
      toPortableContentFileReference(FILE),
      { exportPolicy: 'forbid', signal: expect.any(AbortSignal) }
    )
    expect(portableResources.discard).toHaveBeenCalledTimes(3)
    expect(portableResources.liveCount()).toBe(0)
    expect(JSON.stringify(download.output)).not.toContain('portable-process-local')

    downloadAuthorized = false
    const deniedDownload = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemDownload
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      candidate: toPortableContentFileReference(FILE),
      workspaceRelativePath: 'outputs/denied.bin'
    }, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_download_denied_0001'
    }))

    expect(deniedDownload.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized', retry: 'never' }
    })
    expect(proveFileDescendant).toHaveBeenCalledTimes(2)
    expect(authorizeDownload).toHaveBeenCalledTimes(2)
    expect(openWorkspaceDownloadDestination).toHaveBeenCalledTimes(1)
    expect(portableResources.materialize).toHaveBeenCalledTimes(5)
    expect(portableResources.discard).toHaveBeenCalledTimes(5)
    expect(portableResources.liveCount()).toBe(0)

    uploadAuthorized = false
    const deniedUpload = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      name: 'denied-upload.bin',
      workspaceRelativePath: 'inputs/denied-upload.bin'
    }, capabilityContext(undefined, 'system', {
      ...systemAuthority,
      invocationId: 'invocation_content_space_system_upload_denied_0001'
    }))

    expect(deniedUpload.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized', retry: 'never' }
    })
    expect(uploadNewFile).toHaveBeenCalledTimes(2)
    expect(portableResources.materialize).toHaveBeenCalledTimes(6)
    expect(portableResources.discard).toHaveBeenCalledTimes(6)
    expect(portableResources.liveCount()).toBe(0)
  })

  it('returns unauthorized without dispatch when Principal invalidation aborts before dispatch', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Principal changed', 'AbortError'))
    const assertPrincipalCurrent = vi.fn(() => {
      throw new Error('Principal changed')
    })
    const createProvider = vi.fn(() => providerFixture())
    const openWorkspaceUploadSource = vi.fn(async () => {
      throw new Error('Workspace source must remain unopened')
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination: vi.fn(async () => {
            throw new Error('unused')
          })
        }
      })).contributions,
      contributionHost(providerContributions(createProvider))
    )

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      name: 'never-dispatched.txt',
      workspaceRelativePath: 'inputs/never-dispatched.txt'
    }, capabilityContext(assertPrincipalCurrent, 'system', {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID],
      signal: controller.signal
    }))

    expect(result.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized', retry: 'never' }
    })
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
    expect(createProvider).not.toHaveBeenCalled()
    expect(openWorkspaceUploadSource).not.toHaveBeenCalled()
  })

  it('preserves outcome_unknown when Principal drift aborts after Provider write dispatch', async () => {
    const bytes = new TextEncoder().encode('possibly dispatched')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const transferLimit = bytes.byteLength + 7
    const sourceClose = vi.fn(async () => undefined)
    const controller = new AbortController()
    let principalCurrent = true
    const assertPrincipalCurrent = vi.fn(() => {
      if (!principalCurrent) throw new Error('Principal changed')
    })
    const uploadNewFile = vi.fn(async ({ context, parent, name, source }:
      Parameters<ContentSpaceProvider['uploadNewFile']>[0]) => {
      await source.read({ offset: 0, length: source.size })
      principalCurrent = false
      controller.abort(new DOMException('Principal changed', 'AbortError'))
      return {
        invocationId: context.invocationId,
        parent,
        name,
        sourceSize: source.size,
        reference: {
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          fileId: 'indeterminate-upload'
        },
        writeAfterObservation: {
          parent,
          reference: {
            providerInstanceRef: PROVIDER_INSTANCE_REF,
            fileId: 'indeterminate-upload'
          },
          name,
          size: source.size
        }
      }
    })
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'indeterminate.txt',
      size: bytes.byteLength,
      sha256,
      read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
        bytes.slice(offset, offset + length),
      close: sourceClose
    }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost({
        fileTransfers: {
          openUploadSource: vi.fn(async () => { throw new Error('unused') }),
          openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
          openWorkspaceUploadSource,
          openWorkspaceDownloadDestination: vi.fn(async () => {
            throw new Error('unused')
          })
        }
      })).contributions,
      contributionHost([
        ...providerContributions(() => providerFixture({
          attestExternalBinding: async () => externalBinding,
          uploadNewFile
        })),
        systemVerificationProfileContribution(
          'fixture-system-post-dispatch-drift',
          'upload-new',
          transferLimit
        )
      ])
    )

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew
    ).handler({
      root: toPortableContentContainerReference(ROOT),
      name: 'indeterminate.txt',
      workspaceRelativePath: 'inputs/indeterminate.txt'
    }, capabilityContext(assertPrincipalCurrent, 'system', {
      workspaceId: 'workspace-one',
      capabilityGrants: [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID],
      invocationId: 'invocation_content_space_post_dispatch_0001',
      signal: controller.signal
    }))

    await Promise.resolve()
    expect(result.output).toMatchObject({
      ok: false,
      error: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'inputs/indeterminate.txt',
      maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
      systemAuthorization: {
        requiredSystemCapabilityGrant: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
      }
    }))
    expect(uploadNewFile).toHaveBeenCalledOnce()
    expect(sourceClose).toHaveBeenCalledOnce()
  })

  it('admits an exact PoC list-containers profile through composed Broker capability routing', async () => {
    const currentTime = Date.now()
    const profileContribution = defineContentSpaceVerificationProfileContribution({
      location: MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profile: Object.freeze({
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
        validFrom: new Date(currentTime - 60_000).toISOString(),
        expiresAt: new Date(currentTime + 60_000).toISOString()
      })
    })
    const listContainers = vi.fn(async () => ({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      items: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'root' },
        scope: 'personal' as const,
        label: 'Root'
      }]
    }))
    const provider = providerFixture({
      describeCapabilities: async () => ([{
        operation: 'list-containers' as const,
        readiness: 'poc_only' as const,
        reasonCode: 'verification_profile_required' as const
      }]),
      listContainers
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost([
        ...providerContributions(() => provider),
        contribution(
          'fixture.verification-profile',
          profileContribution,
          profileContribution,
          CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
          'forbidden'
        )
      ])
    )

    const listCandidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )
    const input = {
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      page: { limit: 10 }
    }
    const result = await listCandidates.handler(input, capabilityContext(undefined, 'agent'))

    expect(result.output).toEqual(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      items: [{ libraryLabel: 'Root' }]
    }))
    expect(listContainers).toHaveBeenCalledOnce()

    const principalMismatch = await listCandidates.handler(input, capabilityContext(
      undefined,
      'agent',
      { principal: Object.freeze({ ...principal, identityVersion: 2 }) }
    ))
    expect(principalMismatch.output).toMatchObject({
      ok: false,
      error: { code: 'blocked_by_contract' }
    })
    expect(listContainers).toHaveBeenCalledOnce()
  })

  it('fails Provider Instance discovery when the Host Principal lease is stale', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances)
    const result = await list.handler({}, capabilityContext(() => {
      throw new Error('Principal changed')
    }))
    expect(result.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('keeps signed Provider query text inside Host navigation and returns only an opaque handle', async () => {
    const handle = `portal_${'a'.repeat(32)}`
    const issueTarget = vi.fn((_input: Readonly<{ url: string; expiresAt: string }>) => ({
      handle,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }))
    const openTarget = vi.fn(async (_input: Readonly<{
      handle: string
      signal?: AbortSignal
    }>) => undefined)
    const host = mainHost({ externalNavigation: { issueTarget, openTarget } })
    const entry = createDomainMainEntry(host)
    const definitions = await activateDefinitions(
      entry.contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const resolved = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())
    expect(resolved.output).toMatchObject({ ok: true, value: { handle } })
    expect(JSON.stringify(resolved.output)).not.toContain('token=')
    expect(JSON.stringify(resolved.output)).not.toContain('opaque%2Fvalue')
    expect(issueTarget.mock.calls[0]?.[0].url).toBe(exactSignedUrl)

    const opened = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ).handler({ handle }, capabilityContext())
    expect(opened.output).toEqual(contentSpaceSuccess({ opened: true }))
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(openTarget.mock.calls[0]?.[0]).toMatchObject({ handle })
    expect(openTarget.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['principal_changed', 'unauthorized'],
    ['invalid_target', 'unsafe_portal_target'],
    ['capacity_exceeded', 'bounds_exceeded']
  ] as const)('maps Host issueTarget %s without leaking Host details', async (hostCode, domainCode) => {
    const host = mainHost({
      externalNavigation: {
        issueTarget: () => {
          throw new DomainExternalNavigationError(hostCode, 'signed token=do-not-leak')
        },
        openTarget: vi.fn(async () => undefined)
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())

    expect(result.output).toMatchObject({ ok: false, error: { code: domainCode } })
    expect(JSON.stringify(result.output)).not.toContain('do-not-leak')
  })

  it('projects typed errors with domain-owned messages so Provider secrets cannot escape', async () => {
    const provider = providerFixture({
      resolvePortalTarget: async () => {
        throw new ContentSpaceOperationError({
          code: 'provider_unavailable',
          message: 'signed token=do-not-leak',
          retry: 'never'
        })
      }
    })
    const host = mainHost({
      externalNavigation: {
        issueTarget: vi.fn((_input: Readonly<{ url: string; expiresAt: string }>) => ({
          handle: `portal_${'b'.repeat(32)}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        })),
        openTarget: vi.fn(async (_input: Readonly<{
          handle: string
          signal?: AbortSignal
        }>) => undefined)
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => provider))
    )
    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())
    expect(result.output).toMatchObject({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'The selected Provider is unavailable.'
      }
    })
    expect(JSON.stringify(result.output)).not.toContain('do-not-leak')
  })

  it('uses the authorized Agent resource as write authority without weakening global writes', async () => {
    const entry = createDomainMainEntry(mainHost())
    const definitions = await activateDefinitions(
      entry.contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const confirmedWriteIds = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.createFolder,
      CONTENT_SPACE_CAPABILITY_IDS.uploadNew,
      CONTENT_SPACE_CAPABILITY_IDS.download,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminUpdateSpace,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminPinSpace,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminUnpinSpace,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentDestructive,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ])
    const autonomousResourceWriteIds = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
      CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWrite,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace
    ])
    const workspaceWriteIds = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWorkspaceWrite
    ])
    const systemWriteIds = new Map<string, 'workspace-write' | 'external-write'>([
      [CONTENT_SPACE_CAPABILITY_IDS.systemDownload, 'workspace-write'],
      [CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew, 'external-write']
    ])
    for (const capability of definitions) {
      if (confirmedWriteIds.has(capability.id)) {
        expect(capability).toMatchObject({
          approval: 'confirmation',
          concurrency: { idempotency: 'required' }
        })
        expect(['external-write', 'destructive']).toContain(capability.effect)
      } else if (autonomousResourceWriteIds.has(capability.id)) {
        expect(capability).toMatchObject({
          audiences: capability.delegatedBatchGrant
            ? ['agent', 'system']
            : ['agent'],
          scope: 'resource',
          approval: 'none',
          autonomousWrite: 'resource-authorized',
          concurrency: { idempotency: 'required' }
        })
        expect(['external-write', 'destructive']).toContain(capability.effect)
      } else if (workspaceWriteIds.has(capability.id)) {
        expect(capability).toMatchObject({
          audiences: ['agent'],
          scope: 'resource',
          effect: 'workspace-write',
          approval: 'none',
          concurrency: { idempotency: 'required' }
        })
      } else if (systemWriteIds.has(capability.id)) {
        expect(capability).toMatchObject({
          audiences: ['system'],
          scope: 'workspace',
          effect: systemWriteIds.get(capability.id),
          approval: 'none',
          concurrency: { idempotency: 'required' }
        })
      } else {
        expect(capability.effect).toBe('read')
        expect(capability.approval).toBe('none')
      }
    }
  })

  it('keeps Human browsing global while Agent or an approved batch starts from a confirmed resource root', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listContainers)).toMatchObject({
      audiences: ['ui'],
      scope: 'global'
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)).toMatchObject({
      audiences: ['agent', 'system'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation',
      delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)).toMatchObject({
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
      effect: 'read'
    })
  })

  it('routes Agent upload input through the active Workspace transfer port only', async () => {
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'input.txt',
      size: 5,
      sha256: createHash('sha256').update('input').digest('hex'),
      read: async () => new TextEncoder().encode('input'),
      close: async () => undefined
    }))
    const host = mainHost({
      fileTransfers: {
        openUploadSource: vi.fn(async () => { throw new Error('UI handle path was used') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    let registration: any
    const resource = { token: `cap_${'a'.repeat(32)}`, semanticRevision: 'live:root', expiresAt: '2026-08-17T17:00:00.000Z' }
    const authorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      issueResource: (value) => {
        registration = value
        return resource
      }
    }))
    expect(authorization.output).toMatchObject({ ok: true })

    const result = await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew).handler({
      name: 'input.txt',
      workspaceRelativePath: 'results/input.txt'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      resource: {
        resourceId: registration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))

    expect(result.output).toMatchObject({ ok: true })
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'results/input.txt',
      maxBytes: 16 * 1024 * 1024
    }))
  })

  it('rejects raw GUIDs and Agent resources outside the exact Principal, caller, Workspace, and kind', async () => {
    const listEntries = vi.fn(async ({ parent }: Parameters<ContentSpaceProvider['listEntries']>[0]) => ({
      parent,
      items: []
    }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listEntries })))
    )
    let registration: any
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot).handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:thread-1',
      workspaceId: '/workspace-a',
      issueResource: (value) => {
        registration = value
        return {
          token: `cap_${'b'.repeat(32)}`,
          semanticRevision: 'live:root',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))

    const validResource = Object.freeze({
      resourceId: registration.resourceId as string,
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace-a'
    })
    const attempts = [
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-a',
        resource: { ...validResource, resourceId: 'raw-team-folder-guid' }
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-2',
        workspaceId: '/workspace-a',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        principal: { ...principal, subject: '123e4567-e89b-42d3-a456-426614174001' },
        workspaceId: '/workspace-a',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-b',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-a',
        resource: { ...validResource, resourceKind: 'content-space.file' }
      })
    ]
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)
    for (const context of attempts) {
      await expect(list.handler({ page: { limit: 20 } }, context)).resolves.toMatchObject({
        output: { ok: false, error: { code: 'unauthorized' } }
      })
    }
    expect(listEntries).not.toHaveBeenCalled()

    await expect(list.handler({ page: { limit: 20 } }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:thread-1',
      workspaceId: '/workspace-a',
      resource: validResource
    }))).resolves.toMatchObject({ output: { ok: true } })
    expect(listEntries).toHaveBeenCalledTimes(1)
  })

  it('resolves a Human-named Agent root from the complete live container listing', async () => {
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'team-root'
            },
            scope: 'shared' as const,
            label: 'SciForge Test'
          }]
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-root'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn(() => ({
      token: `cap_${'c'.repeat(32)}`,
      semanticRevision: 'live:authorized-root',
      expiresAt: '2026-08-17T17:00:00.000Z'
    }))

    const result = await authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: 'sciforge test'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      issueResource
    }))

    expect(result.output).toMatchObject({
      ok: true,
      value: { resource: { token: expect.stringMatching(/^cap_/u) } }
    })
    expect(JSON.stringify(result.output)).not.toContain('team-root')
    expect(listContainers).toHaveBeenCalledTimes(2)
    expect(issueResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace'
    }))
  })

  it('reauthorizes and observes one exact live root only inside the approved provisioning batch', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'existing-team-root'
    })
    const portableRoot = toPortableContentContainerReference(root)
    const summary = Object.freeze({
      root: portableRoot,
      label: 'Project Existing Team',
      contentOwnerUserId: principal.subject,
      pinned: false
    })
    const listContainers = vi.fn(async ({ context }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: [{ reference: root, scope: 'shared' as const, label: summary.label }]
    }))
    const observeSpace = vi.fn(async () => summary)
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers,
        observeEntry: async () => ({
          entry: { kind: 'container' as const, reference: root, label: summary.label },
          capabilities: []
        }),
        features: {
          administration: {
            describeOperations: () => readyAdministrationStates,
            bind: async () => Object.freeze({
              administration: administrationPortFixture({ observeSpace })
            })
          }
        }
      })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResourceWithoutProof = vi.fn()
    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: summary.label
    }, capabilityContext(undefined, 'system', {
      callerId: 'sciforge.project-coordinator',
      workspaceId: '/workspace',
      issueResource: issueResourceWithoutProof
    }))).resolves.toMatchObject({
      output: { ok: false, error: { code: 'unauthorized' } }
    })
    expect(listContainers).not.toHaveBeenCalled()
    expect(issueResourceWithoutProof).not.toHaveBeenCalled()

    let registration: any
    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: summary.label
    }, capabilityContext(undefined, 'system', {
      callerId: 'sciforge.project-coordinator',
      workspaceId: '/workspace',
      capabilityGrants: [CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID],
      issueResource: (value) => {
        registration = value
        return resourceHandle('r', value.semanticRevision)
      }
    }))).resolves.toMatchObject({ output: { ok: true } })

    const observed = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminObserveSpace
    ).handler({}, capabilityContext(undefined, 'system', {
      callerId: 'sciforge.project-coordinator',
      workspaceId: '/workspace',
      capabilityGrants: [CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID],
      resource: {
        resourceId: registration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))
    expect(observed.output).toEqual(contentSpaceSuccess(summary))
    expect(listContainers).toHaveBeenCalledOnce()
    expect(observeSpace).toHaveBeenCalledExactlyOnceWith({ root: portableRoot })
  })

  it('derives the Provider Instance from discovery and pages scope-filtered Agent root labels without identities', async () => {
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'team-folder-guid'
            },
            scope: 'shared' as const,
            label: 'SciForge Research'
          }]
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-folder-guid'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string; label: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    expect(providerInstanceRef).toBe(PROVIDER_INSTANCE_REF)

    const listCandidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )

    const first = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const second = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { cursor: 'team-page', limit: 20 }
    }, capabilityContext(undefined, 'agent'))

    expect(first.output).toEqual(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [],
      nextCursor: 'team-page'
    }))
    expect(second.output).toEqual(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [{ libraryLabel: 'SciForge Research' }]
    }))
    expect(JSON.stringify([first.output, second.output])).not.toContain('folder-guid')
    expect(JSON.stringify([first.output, second.output])).not.toMatch(
      /containerId|folderId|folderGuid|teamId|reference/iu
    )
    expect(listCandidates).toMatchObject({
      audiences: ['agent'],
      scope: 'global',
      effect: 'read',
      approval: 'none'
    })
    expect(listCandidates.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      page: { limit: 20 },
      folderGuid: 'raw-team-folder-guid'
    }).success).toBe(false)
    expect(listCandidates.outputSchema.safeParse(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [{
        libraryLabel: 'SciForge Research',
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-team-root' }
      }]
    })).success).toBe(false)
    expect(listContainers.mock.calls.map(([input]) => input.page.cursor)).toEqual([
      undefined,
      'team-page'
    ])
  })

  it.each([
    {
      name: 'the listed Team label becomes stale',
      liveTeamItems: []
    },
    {
      name: 'the listed Team label becomes canonically ambiguous',
      liveTeamItems: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'live-team-a' },
        scope: 'shared' as const,
        label: 'SciForge Research'
      }, {
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'live-team-b' },
        scope: 'shared' as const,
        label: 'sciforge research'
      }]
    }
  ])('freshly re-enumerates authorization when $name', async ({ liveTeamItems }) => {
    let phase: 'candidate' | 'authorization' = 'candidate'
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: phase === 'candidate'
            ? [{
                reference: {
                  providerInstanceRef: context.providerInstanceRef,
                  containerId: 'candidate-team-root'
                },
                scope: 'shared' as const,
                label: 'SciForge Research'
              }]
            : liveTeamItems
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-root'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    const listCandidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )
    const first = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const second = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { cursor: successValue<{ nextCursor?: string }>(first.output).nextCursor, limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const libraryLabel = successValue<{
      items: Array<{ libraryLabel: string }>
    }>(second.output).items[0]?.libraryLabel
    expect(libraryLabel).toBe('SciForge Research')

    phase = 'authorization'
    const issueResource = vi.fn()
    const authorized = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef,
      scope: 'shared',
      label: libraryLabel
    }, capabilityContext(undefined, 'agent', { issueResource }))

    expect(authorized.output).toMatchObject({
      ok: false,
      error: { code: 'invalid_target' }
    })
    expect(issueResource).not.toHaveBeenCalled()
    expect(listContainers.mock.calls.map(([input]) => input.page.cursor)).toEqual([
      undefined,
      'team-page',
      undefined,
      'team-page'
    ])
  })

  it('creates, re-lists the exact child resource, and uploads without using the create receipt as authority', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'team-root'
    })
    const child = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'reports-folder'
    })
    let created = false
    const createFolder = vi.fn(async ({ context, parent, name }:
      Parameters<ContentSpaceProvider['createFolder']>[0]) => {
      created = true
      return {
        invocationId: context.invocationId,
        parent,
        name,
        reference: child
      }
    })
    const listEntries = vi.fn(async ({ parent }:
      Parameters<ContentSpaceProvider['listEntries']>[0]) => ({
      parent,
      items: created
        ? [{ kind: 'container' as const, reference: child, label: 'Reports' }]
        : []
    }))
    const uploadNewFile = vi.fn(async ({ context, parent, name, source }:
      Parameters<ContentSpaceProvider['uploadNewFile']>[0]) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'report-file' },
      writeAfterObservation: {
        parent,
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'report-file' },
        name,
        size: source.size
      }
    }))
    let nativeOutcome: 'outcome_unknown' | 'failed' = 'outcome_unknown'
    const nativeExecute: ContentSpaceNativeDocumentExecutor['execute'] = vi.fn(async (input) =>
      nativeOutcome === 'outcome_unknown'
        ? Object.freeze({
            contractVersion: '1.0.0' as const,
            resourceType: 'native_document' as const,
            operation: 'create' as const,
            invocationId: input.context.invocationId!,
            outcome: 'outcome_unknown' as const,
            error: Object.freeze({
              code: 'outcome_unknown' as const,
              stage: 'write' as const,
              message: 'The create outcome is unknown.',
              retry: 'never' as const
            })
          })
        : Object.freeze({
            contractVersion: '1.0.0' as const,
            resourceType: 'native_document' as const,
            operation: 'create' as const,
            invocationId: input.context.invocationId!,
            outcome: 'failed' as const,
            error: Object.freeze({
              code: 'provider_unavailable' as const,
              message: 'The create operation failed.',
              retry: 'never' as const
            })
          }))
    const close = vi.fn(async () => undefined)
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'report.md',
      size: 6,
      sha256: createHash('sha256').update('report').digest('hex'),
      read: async () => new TextEncoder().encode('report'),
      close
    }))
    const host = mainHost({
      fileTransfers: {
        openUploadSource: vi.fn(async () => { throw new Error('UI handle path was used') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [{ reference: root, scope: 'shared', label: 'SciForge Research' }]
        }),
        createFolder,
        listEntries,
        uploadNewFile,
        features: {
          nativeDocuments: nativeDocumentsFixture(nativeExecute)
        }
      })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    let rootRegistration: any
    const authorized = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef,
      scope: 'shared',
      label: 'SciForge Research'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      issueResource: (registration) => {
        rootRegistration = registration
        return {
          token: `cap_${'r'.repeat(32)}`,
          semanticRevision: 'live:root',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))
    expect(authorized.output).toMatchObject({ ok: true })
    const rootResource = Object.freeze({
      resourceId: rootRegistration.resourceId as string,
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace'
    })

    const nativeWrite = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWrite
    )
    const nativeRequest = {
      request: {
        operation: 'create',
        resourceType: 'native_document',
        parent: root,
        title: 'Draft',
        content: { encoding: 'json', value: { type: 'doc' } }
      }
    }
    const unknownNativeWrite = await nativeWrite.handler(
      nativeRequest,
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:content-flow',
        workspaceId: '/workspace',
        resource: rootResource
      })
    )
    expect(unknownNativeWrite).toMatchObject({
      output: { ok: true, value: { outcome: 'outcome_unknown' } },
      changed: false
    })
    expect(unknownNativeWrite).not.toHaveProperty('semanticRevision')
    nativeOutcome = 'failed'
    const failedNativeWrite = await nativeWrite.handler(
      nativeRequest,
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:content-flow',
        workspaceId: '/workspace',
        resource: rootResource
      })
    )
    expect(failedNativeWrite).toMatchObject({
      output: { ok: true, value: { outcome: 'failed' } },
      changed: false
    })
    expect(failedNativeWrite).not.toHaveProperty('semanticRevision')

    const createdFolder = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder
    ).handler({ name: 'Reports' }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: rootResource
    }))
    expect(createdFolder.output).toMatchObject({
      ok: true,
      value: { reference: child }
    })
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ parent: root, name: 'Reports' }))

    let childRegistration: any
    const listed = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentListEntries
    ).handler({ page: { limit: 20 } }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: rootResource,
      issueResource: (registration) => {
        childRegistration = registration
        return {
          token: `cap_${'c'.repeat(32)}`,
          semanticRevision: 'live:child',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))
    expect(listed.output).toMatchObject({
      ok: true,
      value: {
        items: [{
          entry: { kind: 'container', label: 'Reports' },
          resource: { token: expect.stringMatching(/^cap_/u) }
        }]
      }
    })
    expect(childRegistration).toMatchObject({ resourceKind: CONTENT_CONTAINER_RESOURCE_KIND })

    const uploaded = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew
    ).handler({
      name: 'report.md',
      workspaceRelativePath: 'reports/report.md'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: {
        resourceId: childRegistration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))

    expect(uploaded.output).toMatchObject({ ok: true, value: { parent: child } })
    expect(uploadNewFile).toHaveBeenCalledWith(expect.objectContaining({
      parent: child,
      name: 'report.md'
    }))
    expect(uploadNewFile).not.toHaveBeenCalledWith(expect.objectContaining({ parent: root }))
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'reports/report.md'
    }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'wrong scope',
      items: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root' },
        scope: 'shared' as const,
        label: 'SciForge Test'
      }],
      selection: { scope: 'personal' as const, label: 'SciForge Test' }
    },
    {
      name: 'missing label',
      items: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root' },
        scope: 'shared' as const,
        label: 'SciForge Test'
      }],
      selection: { scope: 'shared' as const, label: 'Unknown Team' }
    },
    {
      name: 'ambiguous canonical label',
      items: [
        {
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root-a' },
          scope: 'shared' as const,
          label: 'SciForge Test'
        },
        {
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root-b' },
          scope: 'shared' as const,
          label: 'sciforge test'
        }
      ],
      selection: { scope: 'shared' as const, label: 'SCIFORGE TEST' }
    }
  ])('does not issue an Agent root for $name', async ({ items, selection }) => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items
        })
      })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn()

    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      ...selection
    }, capabilityContext(undefined, 'agent', { issueResource }))).resolves.toMatchObject({
      output: { ok: false, error: { code: 'invalid_target' } }
    })
    expect(issueResource).not.toHaveBeenCalled()
  })

  it('does not authorize from an incomplete cyclic container listing', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [],
          nextCursor: 'repeated-page'
        })
      })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn()

    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: 'SciForge Test'
    }, capabilityContext(undefined, 'agent', { issueResource }))).resolves.toMatchObject({
      output: { ok: false, error: { code: 'provider_unavailable' } }
    })
    expect(issueResource).not.toHaveBeenCalled()
  })

  it('authorizes Provider administration once, creates a root resource, and injects that root', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'admin-created-root'
    })
    const portableRoot = toPortableContentContainerReference(root)
    const summary = Object.freeze({
      root: portableRoot,
      label: 'Research Team',
      contentOwnerUserId: 'user:owner',
      pinned: false
    })
    const updateSpace = vi.fn(async (
      input: Parameters<ContentSpaceAdministrationPort['updateSpace']>[0]
    ) => Object.freeze({
      ...summary,
      label: input.label
    }))
    const createSpace = vi.fn(async (
      input: Parameters<ContentSpaceAdministrationPort['createSpace']>[0]
    ) => Object.freeze({
      ...summary,
      label: input.label,
      contentOwnerUserId: input.contentOwnerUserId
    }))
    const administration = administrationPortFixture({ createSpace, updateSpace })
    const bind = vi.fn(async () => Object.freeze({
      administration
    }))
    const describeOperations = vi.fn(() => readyAdministrationStates)
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        features: { administration: { describeOperations, bind } }
      })))
    )
    let administrationRegistration: any
    const authorized = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration
    ).handler({ providerInstanceRef: PROVIDER_INSTANCE_REF }, capabilityContext(
      undefined,
      'agent',
      {
        callerId: 'agent:administration',
        workspaceId: '/workspace',
        issueResource: (registration) => {
          administrationRegistration = registration
          return resourceHandle('a', registration.semanticRevision)
        }
      }
    ))
    expect(authorized.output).toMatchObject({
      ok: true,
      value: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        resource: { token: expect.stringMatching(/^cap_/u) }
      }
    })
    expect(bind).not.toHaveBeenCalled()
    expect(describeOperations).toHaveBeenCalledOnce()

    let rootRegistration: any
    const createCapability = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace
    )
    expect(createCapability.inputSchema.safeParse({ label: 'Research Team' }).success).toBe(true)
    expect(createCapability.inputSchema.safeParse({
      label: 'Research Team',
      idempotencyKey: 'idem_create_space_0001'
    }).success).toBe(false)
    const created = await createCapability.handler({ label: 'Research Team' }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:administration',
      workspaceId: '/workspace',
      resource: {
        resourceId: administrationRegistration.resourceId,
        resourceKind: CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND,
        workspaceId: '/workspace'
      },
      issueResource: (registration) => {
        rootRegistration = registration
        return resourceHandle('r', registration.semanticRevision)
      }
    }))
    expect(created.output).toMatchObject({
      ok: true,
      value: {
        space: { root: portableRoot, label: 'Research Team' },
        resource: { token: expect.stringMatching(/^cap_/u) }
      }
    })
    expect(rootRegistration).toMatchObject({
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace'
    })
    expect(createSpace).toHaveBeenCalledWith({
      label: 'Research Team',
      contentOwnerUserId: principal.subject
    })
    expect(bind).toHaveBeenLastCalledWith(expect.objectContaining({
      invocationId: 'invocation_content_space_main_0001'
    }))

    const updateCapability = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminUpdateSpace
    )
    expect(updateCapability.inputSchema.safeParse({ label: 'Renamed Team' }).success).toBe(true)
    expect(updateCapability.inputSchema.safeParse({
      expectedRevision: 'revision:1',
      label: 'Renamed Team',
      contentOwnerUserId: 'user:new-owner'
    }).success).toBe(false)
    expect(updateCapability.inputSchema.safeParse({
      expectedRevision: 'revision:1',
      label: 'Renamed Team',
      idempotencyKey: 'idem_update_space_0001'
    }).success).toBe(false)

    const updated = await updateCapability.handler({
      label: 'Renamed Team'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:administration',
      workspaceId: '/workspace',
      resource: {
        resourceId: rootRegistration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))
    expect(updated).toMatchObject({
      output: { ok: true, value: { label: 'Renamed Team', root: portableRoot } },
      changed: true,
      semanticRevision: expect.any(String)
    })
    expect(updateSpace).toHaveBeenCalledWith({
      root: portableRoot,
      label: 'Renamed Team'
    })
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal
    }))
  })

  it('uses a Provider directory user as the only Agent member mutation identity', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const member = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-b'
    })
    const input = { member }

    for (const capabilityId of [
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember
    ]) {
      const capability = definition(definitions, capabilityId)
      expect(capability.version).toBe('2.0.0')
      expect(capability.inputSchema.parse(input)).toEqual(input)
      expect(capability.inputSchema.safeParse({
        contentUserId: 'user-member-b'
      }).success).toBe(false)
      expect(capability.inputSchema.safeParse({
        member,
        expectedRevision: 'revision:1'
      }).success).toBe(false)
    }
    expect(definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers
    ).version).toBe('2.0.0')
  })

  it('keeps approved-batch removal bound to the exact issued root and rejects caller-supplied authority', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'batch-removal-root'
    })
    const portableRoot = toPortableContentContainerReference(root)
    const summary = Object.freeze({
      root: portableRoot,
      label: 'Removal Team',
      contentOwnerUserId: principal.subject,
      pinned: false
    })
    const removeMember = vi.fn(async (
      input: Parameters<ContentSpaceAdministrationPort['removeMember']>[0]
    ) => Object.freeze({ root: portableRoot, member: input.member, removed: true as const }))
    const administration = administrationPortFixture({
      createSpace: async () => summary,
      removeMember
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        features: {
          administration: {
            describeOperations: () => readyAdministrationStates,
            bind: async () => Object.freeze({ administration })
          }
        }
      })))
    )
    let administrationRegistration: any
    await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration
    ).handler({ providerInstanceRef: PROVIDER_INSTANCE_REF }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:batch-removal',
      workspaceId: '/workspace',
      issueResource: (registration) => {
        administrationRegistration = registration
        return resourceHandle('a', registration.semanticRevision)
      }
    }))
    let rootRegistration: any
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace).handler({
      label: 'Removal Team'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:batch-removal',
      workspaceId: '/workspace',
      resource: {
        resourceId: administrationRegistration.resourceId,
        resourceKind: CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND,
        workspaceId: '/workspace'
      },
      issueResource: (registration) => {
        rootRegistration = registration
        return resourceHandle('r', registration.semanticRevision)
      }
    }))
    const member = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-remove'
    })
    const remove = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember)
    expect(remove).toMatchObject({
      effect: 'destructive',
      approval: 'confirmation',
      delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
      resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND]
    })
    expect(remove.inputSchema.safeParse({ member, root: portableRoot }).success).toBe(false)
    await expect(remove.handler({ member }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:batch-removal',
      workspaceId: '/workspace',
      resource: {
        resourceId: 'caller-supplied-root',
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))).rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    await expect(remove.handler({ member }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:other',
      workspaceId: '/workspace',
      resource: {
        resourceId: rootRegistration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))).rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    expect(removeMember).not.toHaveBeenCalled()

    await expect(remove.handler({ member }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:batch-removal',
      workspaceId: '/workspace',
      resource: {
        resourceId: rootRegistration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))).resolves.toMatchObject({
      output: { ok: true, value: { root: portableRoot, member, removed: true } },
      changed: true,
      semanticRevision: expect.any(String)
    })
    expect(removeMember).toHaveBeenCalledExactlyOnceWith({ root: portableRoot, member })
  })

  it('versions the literal directory-search and Team-governance Agent wires', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )

    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentExtendedRead).version)
      .toBe('2.0.0')
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite).version)
      .toBe('2.0.0')
    expect(definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive
    ).version).toBe('1.0.0')
  })

  it('bounds Provider administration grants to the same finite capacity as content resources', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        features: {
          administration: {
            describeOperations: () => readyAdministrationStates,
            bind: async () => { throw new Error('Administration binding was not expected.') }
          }
        }
      })))
    )
    const authorize = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration
    )
    const issueResource = vi.fn((registration) =>
      resourceHandle('b', registration.semanticRevision))
    for (let index = 0; index < 2_048; index += 1) {
      const result = await authorize.handler(
        { providerInstanceRef: PROVIDER_INSTANCE_REF },
        capabilityContext(undefined, 'agent', { issueResource })
      )
      expect(result.output.ok).toBe(true)
    }
    const overflow = await authorize.handler(
      { providerInstanceRef: PROVIDER_INSTANCE_REF },
      capabilityContext(undefined, 'agent', { issueResource })
    )
    expect(overflow.output).toMatchObject({
      ok: false,
      error: { code: 'bounds_exceeded', retry: 'never' }
    })
    expect(issueResource).toHaveBeenCalledTimes(2_048)
  })

  it('rejects raw parent, reference, and Provider identities from every Agent operation schema', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const candidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const listEntries = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)
    const createFolder = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder)
    const uploadNew = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew)
    const download = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentDownload)
    const rawIdentityFields = [{
      parent: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-parent-guid' }
    }, {
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-reference-guid' }
    }, {
      root: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-root-guid' }
    }, {
      containerId: 'raw-container-guid'
    }, {
      fileId: 'raw-file-guid'
    }, {
      resourceId: 'raw-provider-resource-id'
    }, {
      resourceRef: `res_${'x'.repeat(26)}`
    }, {
      folderId: 42
    }, {
      folderGuid: 'raw-folder-guid'
    }, {
      teamId: 9
    }]
    const schemas = [{
      capability: candidates,
      valid: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        scope: 'shared',
        page: { limit: 20 }
      }
    }, {
      capability: authorize,
      valid: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        scope: 'personal',
        label: 'Root'
      }
    }, {
      capability: listEntries,
      valid: { page: { limit: 20 } }
    }, {
      capability: createFolder,
      valid: { name: 'Reports' }
    }, {
      capability: uploadNew,
      valid: { name: 'report.md', workspaceRelativePath: 'reports/report.md' }
    }, {
      capability: download,
      valid: { workspaceRelativePath: 'downloads/report.md' }
    }]

    for (const { capability, valid } of schemas) {
      expect(capability.inputSchema.safeParse(valid).success).toBe(true)
      for (const rawIdentity of rawIdentityFields) {
        expect(capability.inputSchema.safeParse({ ...valid, ...rawIdentity }).success).toBe(false)
      }
    }
    expect(candidates.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      page: { limit: 20 },
      label: 'OpenContent'
    }).success).toBe(false)
    expect(authorize.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }).success).toBe(true)

    const rawContainerReference = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'raw-container-guid'
    })
    const agentCapabilitiesAcceptingRawReferences = definitions
      .filter(({ audiences }) => audiences.includes('agent'))
      .filter(({ inputSchema }) =>
        inputSchema.safeParse({ reference: FILE }).success ||
        inputSchema.safeParse({ reference: rawContainerReference }).success
      )
      .map(({ id }) => id)
    expect(agentCapabilitiesAcceptingRawReferences).toEqual([])
  })

  it('keeps Human portal and immutable-reference operations out of the Agent audience', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const humanGlobalIds = [
      CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ]
    for (const id of humanGlobalIds) {
      expect(definition(definitions, id)).toMatchObject({
        audiences: ['ui'],
        scope: 'global'
      })
    }

    const agentGlobalAllowlist = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates,
      CONTENT_SPACE_CAPABILITY_IDS.describeCapabilities,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration
    ])
    const unexpectedAgentGlobalIds = definitions
      .filter(({ audiences, scope }) => audiences.includes('agent') && scope === 'global')
      .map(({ id }) => id)
      .filter((id) => !agentGlobalAllowlist.has(id))
    expect(unexpectedAgentGlobalIds).toEqual([])
  })

  it('exposes only Workspace-relative locators on Agent native and extended transfers', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const document = { resourceType: 'native_document' as const, reference: FILE }
    const sourceHandle = `xfer_${'s'.repeat(32)}`
    const destinationHandle = `xfer_${'d'.repeat(32)}`
    const nativeWrite = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWrite
    ).inputSchema
    const nativeWorkspaceWrite = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWorkspaceWrite
    ).inputSchema
    const extendedWrite = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).inputSchema

    expect(nativeWrite.safeParse({ request: {
      operation: 'image-upload',
      document,
      workspaceRelativePath: 'assets/figure.png',
      mediaType: 'image/png'
    } }).success).toBe(true)
    expect(nativeWrite.safeParse({ request: {
      operation: 'image-upload', document, sourceHandle, mediaType: 'image/png'
    } }).success).toBe(false)
    expect(nativeWorkspaceWrite.safeParse({ request: {
      operation: 'export',
      document,
      format: 'pdf',
      workspaceRelativePath: 'exports/document.pdf'
    } }).success).toBe(true)
    expect(nativeWorkspaceWrite.safeParse({ request: {
      operation: 'export', document, format: 'pdf', destinationHandle
    } }).success).toBe(false)

    expect(extendedWrite.safeParse({
      operation: 'updateFileVersion',
      request: {
        reference: FILE,
        workspaceRelativePath: 'versions/document-v2.pdf',
        strategy: 'major',
        expectedVersionId: 'version-one'
      }
    }).success).toBe(true)
    expect(extendedWrite.safeParse({
      operation: 'addAttachment',
      request: { master: FILE, name: 'data.csv', sourceHandle }
    }).success).toBe(false)
  })

  it('does not let one exact Agent file resource authorize a sibling batch deletion', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'shared-root'
    })
    const fileA = Object.freeze({ providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'file-a' })
    const fileB = Object.freeze({ providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'file-b' })
    const execute = vi.fn<ContentSpaceExtendedOperationsExecutor['execute']>(async () =>
      Object.freeze({
        ok: true as const,
        value: Object.freeze({ deleted: Object.freeze([fileA, fileB]), failed: Object.freeze([]) })
      }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [{ reference: root, scope: 'shared', label: 'Shared Research' }]
        }),
        listEntries: async ({ parent }) => ({
          parent,
          items: [
            { kind: 'file' as const, reference: fileA, label: 'A.md', size: 1 },
            { kind: 'file' as const, reference: fileB, label: 'B.md', size: 1 }
          ]
        }),
        features: { extendedOperations: extendedOperationsFixture(execute) }
      })))
    )
    const registrations: any[] = []
    const caller = {
      callerId: 'agent:exact-batch',
      workspaceId: '/workspace',
      issueResource: (registration: any) => {
        registrations.push(registration)
        return resourceHandle(String.fromCharCode(97 + registrations.length), registration.semanticRevision)
      }
    }
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot).handler(
      { providerInstanceRef: PROVIDER_INSTANCE_REF, scope: 'shared', label: 'Shared Research' },
      capabilityContext(undefined, 'agent', caller)
    )
    const rootRegistration = registrations[0]
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries).handler(
      { page: { limit: 20 } },
      capabilityContext(undefined, 'agent', {
        ...caller,
        resource: {
          resourceId: rootRegistration.resourceId,
          resourceKind: rootRegistration.resourceKind,
          workspaceId: '/workspace'
        }
      })
    )

    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive
    ).handler({
      operation: 'deleteEntries',
      request: { entries: [fileA, fileB] }
    }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: registrations[1].resourceId,
        resourceKind: registrations[1].resourceKind,
        workspaceId: '/workspace'
      }
    }))

    expect(result.output).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('authorizes and executes an exact composite selection for a multi-entry copy', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'shared-root'
    })
    const fileA = Object.freeze({ providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'file-a' })
    const fileB = Object.freeze({ providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'file-b' })
    const request = Object.freeze({ entries: Object.freeze([fileA, fileB]), destination: root })
    let nextFailureCode: 'conflict' | 'outcome_unknown' | 'provider_unavailable' | undefined
    const execute = vi.fn<ContentSpaceExtendedOperationsExecutor['execute']>(async () =>
      nextFailureCode
        ? Object.freeze({
            ok: false as const,
            error: Object.freeze({
              code: nextFailureCode,
              message: 'The composite write did not succeed.',
              retry: 'never' as const
            })
          })
        : Object.freeze({
            ok: true as const,
            value: Object.freeze({
              items: Object.freeze([
                { ok: true as const, source: fileA, result: { ...fileA, fileId: 'copy-a' } },
                { ok: true as const, source: fileB, result: { ...fileB, fileId: 'copy-b' } }
              ])
            })
          }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [{ reference: root, scope: 'shared', label: 'Shared Research' }]
        }),
        listEntries: async ({ parent }) => ({
          parent,
          items: [
            { kind: 'file' as const, reference: fileA, label: 'A.md', size: 1 },
            { kind: 'file' as const, reference: fileB, label: 'B.md', size: 1 }
          ]
        }),
        features: { extendedOperations: extendedOperationsFixture(execute) }
      })))
    )
    const registrations: any[] = []
    const caller = {
      callerId: 'agent:composite-copy',
      workspaceId: '/workspace',
      issueResource: (registration: any) => {
        registrations.push(registration)
        return resourceHandle(String.fromCharCode(97 + registrations.length), registration.semanticRevision)
      }
    }
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot).handler(
      { providerInstanceRef: PROVIDER_INSTANCE_REF, scope: 'shared', label: 'Shared Research' },
      capabilityContext(undefined, 'agent', caller)
    )
    const rootRegistration = registrations[0]
    const rootResource = {
      resourceId: rootRegistration.resourceId,
      resourceKind: rootRegistration.resourceKind,
      workspaceId: '/workspace'
    }
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries).handler(
      { page: { limit: 20 } },
      capabilityContext(undefined, 'agent', { ...caller, resource: rootResource })
    )

    const authorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeFeatureSelection
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: rootResource
    }))
    expect(authorization.output).toMatchObject({
      ok: true,
      value: { operation: 'copyEntries', requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) }
    })
    const selection = registrations[3]
    const concurrentAuthorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeFeatureSelection
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: rootResource
    }))
    expect(concurrentAuthorization.output).toMatchObject({ ok: true })
    const concurrentSelection = registrations[4]

    const drifted = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({
      operation: 'copyEntries',
      request: { destination: root, entries: [fileB, fileA] }
    }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: selection.resourceId,
        resourceKind: selection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(drifted.output).toMatchObject({ ok: false, error: { code: 'invalid_target' } })
    expect(execute).not.toHaveBeenCalled()

    const copied = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({
      operation: 'copyEntries',
      request: { destination: root, entries: [fileA, fileB] }
    }, capabilityContext(undefined, 'agent', {
      ...caller,
      invocationId: 'invocation_composite_copy_success_0001',
      resource: {
        resourceId: selection.resourceId,
        resourceKind: selection.resourceKind,
        workspaceId: '/workspace'
      }
    }))

    expect(copied).toMatchObject({ output: { ok: true }, changed: true })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        primary: root,
        authorized: expect.arrayContaining([root, fileA, fileB])
      }),
      operation: 'copyEntries',
      request
    }))

    const consumedSelection = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      invocationId: 'invocation_composite_copy_consumed_0002',
      resource: {
        resourceId: selection.resourceId,
        resourceKind: selection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(consumedSelection.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
    expect(execute).toHaveBeenCalledTimes(1)

    let staleObservationError: unknown
    try {
      concurrentSelection.observe({
        audience: 'agent',
        callerId: caller.callerId,
        principal,
        workspaceId: caller.workspaceId
      }, { signal: new AbortController().signal })
    } catch (error) {
      staleObservationError = error
    }
    expect(staleObservationError).toMatchObject({ detail: { code: 'unauthorized' } })

    const staleConcurrentSelection = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      invocationId: 'invocation_composite_copy_stale_0003',
      resource: {
        resourceId: concurrentSelection.resourceId,
        resourceKind: concurrentSelection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(staleConcurrentSelection.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
    expect(execute).toHaveBeenCalledTimes(1)

    const retryableAuthorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeFeatureSelection
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: rootResource
    }))
    expect(retryableAuthorization.output).toMatchObject({ ok: true })
    expect(successValue<{ requestDigest: string }>(retryableAuthorization.output).requestDigest)
      .not.toBe(successValue<{ requestDigest: string }>(authorization.output).requestDigest)
    const retryableSelection = registrations[5]
    for (const failureCode of [
      'conflict',
      'provider_unavailable',
      'outcome_unknown'
    ] as const) {
      nextFailureCode = failureCode
      const failed = await definition(
        definitions,
        CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
      ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
        ...caller,
        invocationId: `invocation_composite_copy_failure_${failureCode}`,
        resource: {
          resourceId: retryableSelection.resourceId,
          resourceKind: retryableSelection.resourceKind,
          workspaceId: '/workspace'
        }
      }))
      expect(failed).toMatchObject({
        output: { ok: true, value: { ok: false, error: { code: failureCode } } },
        changed: false
      })
    }
    nextFailureCode = undefined
    const retried = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      invocationId: 'invocation_composite_copy_retry_success_0004',
      resource: {
        resourceId: retryableSelection.resourceId,
        resourceKind: retryableSelection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(retried).toMatchObject({ output: { ok: true }, changed: true })
    expect(execute).toHaveBeenCalledTimes(5)
    const consumedRetryableSelection = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      invocationId: 'invocation_composite_copy_retry_consumed_0005',
      resource: {
        resourceId: retryableSelection.resourceId,
        resourceKind: retryableSelection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(consumedRetryableSelection.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
    expect(execute).toHaveBeenCalledTimes(5)

    const moveAuthorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeFeatureSelection
    ).handler({ operation: 'moveEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: registrations[1].resourceId,
        resourceKind: registrations[1].resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(moveAuthorization.output).toMatchObject({ ok: true })
    const moveSelection = registrations[6]
    const moved = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'moveEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: moveSelection.resourceId,
        resourceKind: moveSelection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(moved).toMatchObject({ output: { ok: true }, changed: true })
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: 'moveEntries',
      target: expect.objectContaining({ authorized: expect.arrayContaining([root, fileA, fileB]) })
    }))

    await registrations[1].dispose()
    const afterConstituentDisposal = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({ operation: 'copyEntries', request }, capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: selection.resourceId,
        resourceKind: selection.resourceKind,
        workspaceId: '/workspace'
      }
    }))
    expect(afterConstituentDisposal.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
    expect(execute).toHaveBeenCalledTimes(6)
  })

  it('blocks shared-root deletion and direct permission mutation before Provider dispatch', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'shared-root'
    })
    const execute = vi.fn<ContentSpaceExtendedOperationsExecutor['execute']>(async () => {
      throw new Error('shared-root mutation reached Provider')
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [{ reference: root, scope: 'shared', label: 'Shared Research' }]
        }),
        features: { extendedOperations: extendedOperationsFixture(execute) }
      })))
    )
    let rootRegistration: any
    const caller = {
      callerId: 'agent:shared-root-guard',
      workspaceId: '/workspace',
      issueResource: (registration: any) => {
        rootRegistration = registration
        return resourceHandle('g', registration.semanticRevision)
      }
    }
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot).handler(
      { providerInstanceRef: PROVIDER_INSTANCE_REF, scope: 'shared', label: 'Shared Research' },
      capabilityContext(undefined, 'agent', caller)
    )
    const context = capabilityContext(undefined, 'agent', {
      ...caller,
      resource: {
        resourceId: rootRegistration.resourceId,
        resourceKind: rootRegistration.resourceKind,
        workspaceId: '/workspace'
      }
    })

    const deleted = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive
    ).handler({ operation: 'deleteEntries', request: { entries: [root] } }, context)
    const changedPermissions = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite
    ).handler({
      operation: 'changePermissions',
      request: {
        target: root,
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
    }, context)

    expect(deleted.output).toMatchObject({ ok: false, error: { code: 'invalid_target' } })
    expect(changedPermissions.output).toMatchObject({
      ok: false,
      error: { code: 'invalid_target' }
    })
    expect(execute).not.toHaveBeenCalled()
  })
})

function mainHost(overrides: Partial<DomainMainHost> = {}): DomainMainHost {
  return Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-content-space-main-test',
    defineCapability: (options: unknown) => options,
    portableResources: portableResourcesFixture(),
    ...overrides
  })
}

function portableResourcesFixture(options: Readonly<{ failAt?: number }> = {}) {
  let sequence = 0
  const live = new Set<string>()
  const materialize = vi.fn(async (reference: PortableMaterializeReference) => {
    sequence += 1
    if (sequence === options.failAt) {
      throw new Error('The current portable resource session is unavailable.')
    }
    const marker = String(sequence).padStart(4, '0')
    const resourceRef = `res_portable-process-local-${marker}`
    live.add(resourceRef)
    return Object.freeze({
      resource: Object.freeze({
        token: `cap_portable-process-local-${marker}`,
        semanticRevision: `portable-process-local-${marker}`,
        expiresAt: '2026-08-25T23:59:59.000Z'
      }),
      resourceRef,
      resourceKind: typeof reference !== 'string' &&
        reference.kind === CONTENT_FILE_REFERENCE_KIND
        ? CONTENT_FILE_RESOURCE_KIND
        : CONTENT_CONTAINER_RESOURCE_KIND
    })
  })
  const discard = vi.fn(async ({ resourceRef }: Readonly<{ resourceRef: string }>) => {
    live.delete(resourceRef)
  })
  return Object.freeze({
    materialize,
    discard,
    export: vi.fn(async () => {
      throw new Error('Process-local test resources are not exportable.')
    }),
    liveCount: () => live.size
  })
}

async function activateDefinitions(
  contributions: readonly Readonly<{ id: string; value: unknown }>[],
  composed: DomainMainContributionHost
): Promise<readonly CapabilityDefinition[]> {
  const lifecycle = contributions.find(({ id }) =>
    id === CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  )?.value as DomainMainRuntimeLifecycleContribution | undefined
  const factory = contributions.find(({ id }) =>
    id === CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id
  )?.value as Readonly<{ createDefinitions(): readonly unknown[] }> | undefined
  if (!lifecycle || !factory) throw new Error('Content Space composition is incomplete')
  await lifecycle.activate({
    contributions: composed
  } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])
  return factory.createDefinitions() as readonly CapabilityDefinition[]
}

function definition(
  definitions: readonly CapabilityDefinition[],
  id: string
): CapabilityDefinition {
  const found = definitions.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing capability ${id}`)
  return found
}

function successValue<Value>(result: ContentSpaceResult<unknown>): Value {
  if (!result.ok) throw new Error(`Expected Content Space success, received ${result.error.code}`)
  return result.value as Value
}

function resourceHandle(marker: string, semanticRevision: string) {
  return Object.freeze({
    token: `cap_${marker.repeat(32)}`,
    semanticRevision,
    expiresAt: '2026-08-17T17:00:00.000Z'
  })
}

function administrationPortFixture(
  overrides: Partial<ContentSpaceAdministrationPort> = {}
): ContentSpaceAdministrationPort {
  const root = toPortableContentContainerReference({
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    containerId: 'admin-created-root'
  })
  const summary = Object.freeze({
    root,
    label: 'Research Team',
    contentOwnerUserId: 'user:owner',
    pinned: false
  })
  const port: ContentSpaceAdministrationPort = {
    contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
    listSpaces: async () => Object.freeze({ items: Object.freeze([summary]) }),
    createSpace: async () => summary,
    observeSpace: async () => summary,
    updateSpace: async () => summary,
    pinSpace: async () => Object.freeze({ ...summary, pinned: true }),
    unpinSpace: async () => summary,
    openRoot: async () => Object.freeze({ root }),
    listMembers: async () => Object.freeze({
      root,
      items: Object.freeze([{
        member: Object.freeze({
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          kind: 'user' as const,
          principalId: 'provider-owner'
        })
      }])
    }),
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
  }
  return Object.freeze(port)
}

function capabilityContext(
  assertPrincipalCurrent: (() => void) | undefined = () => undefined,
  audience: 'ui' | 'agent' | 'system' = 'ui',
  options: Readonly<{
    callerId?: string
    principal?: typeof principal
    workspaceId?: string
    capabilityGrants?: readonly string[]
    principalSnapshotDigest?: string
    executionContextDigest?: string
    invocationId?: string
    signal?: AbortSignal
    resource?: CapabilityContext['resource']
    issueResource?: CapabilityContext['issueResource']
  }> = {}
): CapabilityContext {
  return Object.freeze({
    caller: Object.freeze({
      audience,
      callerId: options.callerId ?? 'renderer:test',
      principal: options.principal ?? principal,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.capabilityGrants
        ? { capabilityGrants: options.capabilityGrants }
        : {}),
      ...(audience === 'system'
        ? {
            principalSnapshotDigest: options.principalSnapshotDigest ?? 'a'.repeat(64),
            executionContextDigest: options.executionContextDigest ?? 'b'.repeat(64)
          }
        : {})
    }),
    invocationId: options.invocationId ?? 'invocation_content_space_main_0001',
    signal: options.signal ?? new AbortController().signal,
    assertPrincipalCurrent: assertPrincipalCurrent ?? (() => undefined),
    ...(options.resource ? { resource: options.resource } : {}),
    issueResource: options.issueResource ?? (() => {
      throw new Error('Unexpected resource issuance')
    })
  })
}

function extendedOperationsFixture(
  execute: ContentSpaceExtendedOperationsExecutor['execute']
): ContentSpaceExtendedOperationsExecutor {
  return Object.freeze({
    describeOperations: () => Object.keys(
      CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
    ).map((operation) => ({
      operation: operation as keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
    })),
    execute
  })
}

function nativeDocumentsFixture(
  execute: ContentSpaceNativeDocumentExecutor['execute']
): ContentSpaceNativeDocumentExecutor {
  return Object.freeze({
    describeOperations: () => NATIVE_DOCUMENT_OPERATIONS.map((operation) => ({
      operation,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
    })),
    execute
  })
}

function systemVerificationProfileContribution(
  profileId: string,
  operation: 'upload-new' | 'download',
  maxBytes: number,
  currentTime = Date.now()
): DomainMainContribution {
  const profileContribution = defineContentSpaceVerificationProfileContribution({
    location: MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
    contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
    profile: Object.freeze({
      profileId,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'system' as const,
      authority: Object.freeze({
        kind: 'content-root' as const,
        root: ROOT
      }),
      operation: Object.freeze({
        family: 'ordinary' as const,
        operation
      }),
      transferLimits: operation === 'upload-new'
        ? Object.freeze({ maxUploadBytes: maxBytes, maxDownloadBytes: 0 })
        : Object.freeze({ maxUploadBytes: 0, maxDownloadBytes: maxBytes }),
      externalBinding: Object.freeze({
        externalSubject: externalBinding.externalSubject,
        bindingRevision: externalBinding.bindingRevision
      }),
      validFrom: new Date(currentTime - 60_000).toISOString(),
      expiresAt: new Date(currentTime + 60_000).toISOString()
    })
  })
  return contribution(
    `fixture.verification-profile.${profileId}`,
    profileContribution,
    profileContribution,
    CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
    'forbidden'
  )
}

function providerFixture(overrides: Partial<ContentSpaceProvider> = {}): ContentSpaceProvider {
  const ready = ([
    'list-containers',
    'list-entries',
    'observe-entry',
    'create-folder',
    'upload-new',
    'download',
    'portal-target',
    'observe-immutable-version'
  ] as const).map((operation) => ({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    attestExternalBinding: async () => undefined,
    describeCapabilities: async () => ready,
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: [{
        reference: { providerInstanceRef: context.providerInstanceRef, containerId: 'root' },
        scope: 'personal',
        label: 'Root'
      }]
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async ({ reference }) => ({
      entry: 'containerId' in reference
        ? { kind: 'container' as const, reference, label: 'Container' }
        : {
            kind: 'file' as const,
            reference: {
              providerInstanceRef: reference.providerInstanceRef,
              fileId: reference.fileId
            },
            label: 'File',
            size: 0
          },
      capabilities: ready
    }),
    proveFileDescendant: async ({ context, root, candidate }) => ({
      invocationId: context.invocationId,
      providerInstanceRef: context.providerInstanceRef,
      authority: context.providerInstanceRef,
      root,
      candidate,
      binding: context.expectedExternalBinding ?? {
        providerInstanceRef: context.providerInstanceRef,
        principal: context.principal,
        externalSubject: 'a'.repeat(64),
        bindingRevision: 'b'.repeat(64)
      },
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
    authorizeDownload: async ({ context, reference }) => ({
      consume: async () => ({
        invocationId: context.invocationId,
        reference,
        bytesWritten: 0
      }),
      retire: async () => undefined
    }),
    resolvePortalTarget: async () => ({
      url: exactSignedUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }),
    observeImmutableVersion: async () => ({
      proven: false,
      reasonCode: 'resource_capability_missing'
    }),
    ...overrides
  })
}

function providerContributions(
  createProvider: () => ContentSpaceProvider | Promise<ContentSpaceProvider>
): readonly DomainMainContribution[] {
  return Object.freeze([
    contribution('fixture.factory', {
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space'
    }, defineContentSpaceProviderFactory({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space',
      createProvider
    })),
    contribution('fixture.instance', {
      location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture Content Space'
    }, defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture Content Space'
    }))
  ])
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown,
  version: string = PROVIDER_FACTORY_CONTRACT_VERSION,
  publicRelease?: 'allowed' | 'forbidden'
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/content-space-provider',
    owner: Object.freeze({ moduleId: 'fixture.content-space', moduleVersion: '1.0.0' }),
    version,
    ...(publicRelease === undefined ? {} : { publicRelease }),
    contract,
    value
  })
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({ list: () => contributions })
}

function canonicalDigestFixture(value: unknown): string {
  return createHash('sha256').update(canonicalJsonFixture(value)).digest('hex')
}

function canonicalJsonFixture(value: unknown): string {
  if (value === null || typeof value === 'boolean' ||
    typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonFixture).join(',')}]`
  if (!value || typeof value !== 'object') throw new TypeError('Unsupported canonical fixture.')
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJsonFixture(child)}`)
    .join(',')}}`
}
