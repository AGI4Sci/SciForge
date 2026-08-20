import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainMainHost,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { samePrincipalSnapshot, type PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  defineContentSpaceProviderFactory,
  type ContentSpaceProviderFactoryRuntimeValue
} from '@sciforge/domain-sdk/provider-composition'
import {
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_DOMAIN_MODULE_ID,
  defineContentSpaceProvider,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import {
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION
} from '@sciforge/domain-content-space/definition'
import { createDomainMainEntry } from '@sciforge/domain-content-space/main'
import { NATIVE_DOCUMENT_OPERATIONS } from
  '@sciforge/domain-content-space/native-document-contract'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from
  '@sciforge/domain-content-space/provider-features'
import { LOCAL_MOCK_PROVIDER_INSTANCE_REF } from
  '@sciforge/domain-content-space-mock-provider/definition'
import { createDomainMainEntry as createMockProviderMainEntry } from
  '@sciforge/domain-content-space-mock-provider/main'

import { CapabilityBroker } from './broker'
import { CapabilityRegistry, defineCapability, type CapabilityDefinition } from './registry'
import { HostFileTransferService } from '../modules/file-transfer'

const principal: PrincipalSnapshot = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection',
  deviceId: 'content-space-broker-integration-device',
  identityVersion: 1
})

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

  it('round-trips an authorized Workspace file through real Broker and Host transfers', async () => {
    const rootDirectory = await mkdtemp('/private/tmp/sciforge-content-space-transfer-')
    const workspace = join(rootDirectory, 'workspace')
    const temporary = join(rootDirectory, 'temporary')
    const userData = join(rootDirectory, 'user-data')
    await Promise.all([
      mkdir(join(workspace, 'outputs'), { recursive: true }),
      mkdir(join(workspace, 'inputs'), { recursive: true }),
      mkdir(temporary, { recursive: true }),
      mkdir(userData, { recursive: true })
    ])
    const uploadBytes = new TextEncoder().encode('real Broker and Host transfer')
    await writeFile(join(workspace, 'outputs', 'result.txt'), uploadBytes)

    let broker: CapabilityBroker | undefined
    let dispose: Awaited<
      ReturnType<DomainMainRuntimeLifecycleContribution['activate']>
    > = undefined
    const transfers = new HostFileTransferService({
      temporaryRoot: temporary,
      isPrincipalCurrent: (candidate) => samePrincipalSnapshot(candidate, principal)
    })
    const host = Object.freeze({
      getUserDataDir: () => userData,
      defineCapability,
      fileTransfers: transfers.forOwner(
        CONTENT_SPACE_DOMAIN_MODULE_ID,
        () => broker?.currentInvocation()
      )
    }) as unknown as DomainMainHost
    const contentEntry = createDomainMainEntry(host)
    const providerEntry = createMockProviderMainEntry(host)
    const lifecycle = contribution<DomainMainRuntimeLifecycleContribution>(
      contentEntry,
      CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
    )
    const factory = contribution<Readonly<{
      createDefinitions(): readonly CapabilityDefinition[]
    }>>(contentEntry, CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id)

    try {
      dispose = await lifecycle.activate({
        contributions: contributionHost(projectMainExtensions(providerEntry))
      } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])
      broker = new CapabilityBroker(
        new CapabilityRegistry(factory.createDefinitions()),
        { resolveCurrentPrincipal: () => principal }
      )
      const caller = Object.freeze({
        audience: 'agent' as const,
        callerId: 'agent:content-space-real-transfer',
        workspaceId: workspace
      })
      const authorizeInvocationId = 'content_space_real_transfer_authorize_0001'
      const authorized = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: authorizeInvocationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: authorizeInvocationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const root = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        invocationId: 'content_space_real_transfer_create_0002',
        resource: root,
        input: { name: 'Results' }
      }, { signal: new AbortController().signal })
      expect(created.output).toMatchObject({ ok: true, value: { name: 'Results' } })
      expect(created).toMatchObject({
        changed: true,
        resource: { semanticRevision: expect.any(String) }
      })
      const rootListing = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: created.resource!,
        input: { page: { limit: 20 } }
      })
      const folder = successValue<{
        items: Array<{
          entry: Readonly<{ kind: string; label: string }>
          resource: NonNullable<typeof created.resource>
        }>
      }>(rootListing.output).items.find(({ entry }) =>
        entry.kind === 'container' && entry.label === 'Results'
      )
      expect(folder).toBeDefined()

      const uploaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_real_transfer_upload_0003',
        resource: folder!.resource,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(uploaded).toMatchObject({
        output: { ok: true, value: { sourceSize: uploadBytes.byteLength } },
        changed: true
      })

      const conflictingUpload = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_real_transfer_upload_conflict_0004',
        resource: uploaded.resource!,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(conflictingUpload).toMatchObject({
        output: {
          ok: false,
          error: { code: 'conflict', retry: 'after-human-action' }
        },
        changed: false
      })

      const folderListing = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: uploaded.resource!,
        input: { page: { limit: 20 } }
      })
      const files = successValue<{
        items: Array<{
          entry: Readonly<{ kind: string; label: string }>
          resource: NonNullable<typeof uploaded.resource>
        }>
      }>(folderListing.output).items.filter(({ entry }) =>
        entry.kind === 'file' && entry.label === 'result.txt'
      )
      expect(files).toHaveLength(1)
      const file = files[0]
      expect(file).toBeDefined()

      const downloaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_real_transfer_download_0005',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(downloaded).toMatchObject({
        output: { ok: true, value: { bytesWritten: uploadBytes.byteLength } },
        changed: false
      })
      await expect(readFile(join(workspace, 'inputs', 'result.txt')))
        .resolves.toEqual(Buffer.from(uploadBytes))

      const conflictingDownload = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_real_transfer_download_conflict_0006',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(conflictingDownload).toMatchObject({
        output: {
          ok: false,
          error: { code: 'conflict', retry: 'after-human-action' }
        },
        changed: false
      })
      await expect(readFile(join(workspace, 'inputs', 'result.txt')))
        .resolves.toEqual(Buffer.from(uploadBytes))
    } finally {
      if (typeof dispose === 'function') await dispose()
      await transfers.dispose()
      await rm(rootDirectory, { recursive: true, force: true })
    }
  })

  it('invokes authorized create, upload, and download through the real Broker receipt path', async () => {
    const uploadBytes = new TextEncoder().encode('broker receipt integration')
    const downloaded: Uint8Array[] = []
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'result.txt',
      size: uploadBytes.byteLength,
      read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
        uploadBytes.slice(offset, Math.min(offset + length, uploadBytes.byteLength)),
      close: vi.fn(async () => undefined)
    }))
    const commit = vi.fn(async () => undefined)
    const unknownCommit = vi.fn(async () => { throw new Error('commit outcome unavailable') })
    const openWorkspaceDownloadDestination = vi.fn(async (
      { relativePath }: Readonly<{ relativePath: string }>
    ) => Object.freeze({
      label: relativePath,
      write: async (chunk: Uint8Array) => { downloaded.push(chunk.slice()) },
      commit: relativePath === 'inputs/unknown-result.txt' ? unknownCommit : commit,
      abort: vi.fn(async () => undefined)
    }))
    const host = Object.freeze({
      getUserDataDir: () => '/private/tmp/sciforge-content-space-broker-integration',
      defineCapability,
      fileTransfers: Object.freeze({
        openUploadSource: vi.fn(async () => { throw new Error('UI upload path was used.') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('UI download path was used.') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination
      })
    }) as unknown as DomainMainHost
    const contentEntry = createDomainMainEntry(host)
    const providerEntry = createMockProviderMainEntry(host)
    const nativeReadInvocationIds: string[] = []
    const extendedReadInvocationIds: string[] = []
    const nativeReadExecute: ContentSpaceNativeDocumentExecutor['execute'] = vi.fn(async (input) => {
      const invocationId = input.context.invocationId
      if (!invocationId || !('fileId' in input.target.primary)) {
        throw new Error('Native read was not invocation- and file-bound.')
      }
      nativeReadInvocationIds.push(invocationId)
      return Object.freeze({
        contractVersion: '1.0.0' as const,
        resourceType: 'native_document' as const,
        operation: 'read' as const,
        invocationId,
        outcome: 'succeeded' as const,
        result: Object.freeze({
          kind: 'content' as const,
          document: Object.freeze({
            resourceType: 'native_document' as const,
            reference: input.target.primary
          }),
          documentHash: 'a'.repeat(64),
          content: Object.freeze({ type: 'doc' })
        })
      })
    })
    const extendedReadExecute: ContentSpaceExtendedOperationsExecutor['execute'] = vi.fn(
      async (input) => {
        const invocationId = input.context.invocationId
        if (!invocationId || input.operation !== 'getEntryInfo' ||
          !('fileId' in input.target.primary)) {
          throw new Error('Extended read was not invocation- and file-bound.')
        }
        extendedReadInvocationIds.push(invocationId)
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({
            kind: 'file' as const,
            reference: input.target.primary,
            name: 'result.txt',
            parent: input.target.root,
            size: uploadBytes.byteLength
          })
        })
      }
    )
    const providerExtensions = projectMainExtensions(providerEntry).map((extension) => {
      const candidate = extension.value as Partial<
        ContentSpaceProviderFactoryRuntimeValue<ContentSpaceProvider, unknown>
      >
      if (candidate.location !== MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION ||
        !candidate.createProvider || !candidate.contractVersion || !candidate.providerKind) {
        return extension
      }
      const original = candidate as ContentSpaceProviderFactoryRuntimeValue<
        ContentSpaceProvider,
        unknown
      >
      return Object.freeze({
        ...extension,
        value: defineContentSpaceProviderFactory<ContentSpaceProvider, unknown>({
          contractVersion: original.contractVersion,
          providerKind: original.providerKind,
          createProvider: async (hostView) => {
            const provider = await original.createProvider(hostView)
            return defineContentSpaceProvider({
              ...provider,
              features: Object.freeze({
                ...provider.features,
                nativeDocuments: Object.freeze({
                  describeOperations: () => Object.freeze(
                    NATIVE_DOCUMENT_OPERATIONS.map((operation) => Object.freeze({
                      operation,
                      readiness: 'production_ready' as const,
                      reasonCode: 'available' as const
                    }))
                  ),
                  execute: nativeReadExecute
                }),
                extendedOperations: Object.freeze({
                  describeOperations: () => Object.freeze([Object.freeze({
                    operation: 'getEntryInfo' as const,
                    readiness: 'production_ready' as const,
                    reasonCode: 'available' as const
                  })]),
                  execute: extendedReadExecute
                })
              })
            })
          }
        })
      })
    })
    const lifecycle = contribution<DomainMainRuntimeLifecycleContribution>(
      contentEntry,
      CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
    )
    const factory = contribution<Readonly<{
      createDefinitions(): readonly CapabilityDefinition[]
    }>>(contentEntry, CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id)
    const dispose = await lifecycle.activate({
      contributions: contributionHost(providerExtensions)
    } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])

    try {
      const broker = new CapabilityBroker(
        new CapabilityRegistry(factory.createDefinitions()),
        { resolveCurrentPrincipal: () => principal }
      )
      const caller = Object.freeze({
        audience: 'agent' as const,
        callerId: 'agent:content-space-broker-integration',
        workspaceId: '/workspace'
      })
      const authorizeInvocationId = 'content_space_authorize_root_0001'
      const authorized = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: authorizeInvocationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: authorizeInvocationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const root = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        invocationId: 'content_space_create_folder_0002',
        resource: root,
        input: { name: 'Results' }
      }, { signal: new AbortController().signal })
      expect(created).toMatchObject({
        output: { ok: true, value: { name: 'Results' } },
        changed: true,
        beforeRevision: root.semanticRevision,
        resource: { semanticRevision: expect.any(String) }
      })
      expect(created.afterRevision).not.toBe(created.beforeRevision)

      const uploaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_upload_file_0003',
        resource: created.resource!,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(uploaded).toMatchObject({
        output: {
          ok: true,
          value: { name: 'result.txt', sourceSize: uploadBytes.byteLength }
        },
        changed: true,
        resource: { semanticRevision: expect.any(String) }
      })
      expect(uploaded.afterRevision).not.toBe(uploaded.beforeRevision)

      const listed = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: uploaded.resource!,
        input: { page: { limit: 20 } }
      })
      const file = successValue<{
        items: Array<{
          entry: {
            kind: string
            label: string
            reference: Readonly<{ providerInstanceRef: string; fileId?: string }>
          }
          resource: NonNullable<typeof uploaded.resource>
        }>
      }>(listed.output).items.find(({ entry }) =>
        entry.kind === 'file' && entry.label === 'result.txt'
      )
      expect(file).toBeDefined()

      const nativeRead = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentRead,
        resource: file!.resource,
        input: {
          request: {
            operation: 'read',
            document: {
              resourceType: 'native_document',
              reference: file!.entry.reference
            }
          }
        }
      })
      expect(nativeRead).toMatchObject({
        output: {
          ok: true,
          value: { outcome: 'succeeded', operation: 'read' }
        },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(nativeRead.resource).toBeUndefined()
      expect(nativeReadInvocationIds).toEqual([expect.stringMatching(/^read_[a-f0-9]{32}$/u)])

      const extendedRead = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentExtendedRead,
        resource: file!.resource,
        input: {
          operation: 'getEntryInfo',
          request: { reference: file!.entry.reference }
        }
      })
      expect(extendedRead).toMatchObject({
        output: {
          ok: true,
          value: { ok: true, value: { kind: 'file', name: 'result.txt' } }
        },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(extendedRead.resource).toBeUndefined()
      expect(extendedReadInvocationIds).toEqual([
        expect.stringMatching(/^read_[a-f0-9]{32}$/u)
      ])

      const downloadedResult = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_download_file_0004',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(downloadedResult).toMatchObject({
        output: { ok: true, value: { bytesWritten: uploadBytes.byteLength } },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(downloadedResult.resource).toBeUndefined()
      expect(Buffer.concat(downloaded.map((chunk) => Buffer.from(chunk))))
        .toEqual(Buffer.from(uploadBytes))
      expect(commit).toHaveBeenCalledOnce()
      expect(openWorkspaceUploadSource).toHaveBeenCalledOnce()
      expect(openWorkspaceDownloadDestination).toHaveBeenCalledOnce()

      const outcomeUnknownRequest = {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_download_unknown_0005',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/unknown-result.txt' }
      }
      const outcomeUnknown = await broker.invoke(
        caller,
        outcomeUnknownRequest,
        { signal: new AbortController().signal }
      )
      const replayedUnknown = await broker.invoke(
        caller,
        outcomeUnknownRequest,
        { signal: new AbortController().signal }
      )
      expect(outcomeUnknown).toMatchObject({
        output: { ok: false, error: { code: 'outcome_unknown', retry: 'never' } },
        changed: false,
        replayed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(replayedUnknown).toMatchObject({
        output: { ok: false, error: { code: 'outcome_unknown', retry: 'never' } },
        changed: false,
        replayed: true
      })
      expect(unknownCommit).toHaveBeenCalledOnce()
      expect(openWorkspaceDownloadDestination).toHaveBeenCalledTimes(2)

      const writeAudit = broker.listAuditRecords().filter(({ actionId }) => [
        CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        CONTENT_SPACE_CAPABILITY_IDS.agentDownload
      ].includes(actionId as typeof CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder))
      expect(writeAudit.slice(0, 3)).toMatchObject([
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder, approval: 'none' },
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew, approval: 'none' },
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload, approval: 'none' }
      ])
    } finally {
      if (typeof dispose === 'function') await dispose()
    }
  })
})

function successValue<Value>(output: unknown): Value {
  if (!output || typeof output !== 'object' || !('ok' in output) || output.ok !== true || !('value' in output)) {
    throw new Error('Expected a successful Content Space result.')
  }
  return output.value as Value
}

function contribution<Value>(
  entry: TrustedDomainProcessEntryInput<unknown>,
  id: string
): Value {
  const found = entry.contributions.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing contribution ${id}.`)
  return found.value as Value
}

function projectMainExtensions(
  entry: TrustedDomainProcessEntryInput<unknown>
): readonly DomainMainContribution[] {
  const declarations = entry.definition.entrypoints.find(({ process }) => process === 'main')
    ?.contributions
  if (!declarations) throw new Error('Provider has no main entrypoint.')
  return Object.freeze(entry.contributions.flatMap((runtime) => {
    const declaration = declarations.find(({ id }) => id === runtime.id)
    if (!declaration || declaration.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND) return []
    if (!runtime.contract) throw new Error(`Provider contribution ${runtime.id} has no contract.`)
    return [Object.freeze({
      id: runtime.id,
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: entry.definition.packageName,
      owner: Object.freeze({
        moduleId: entry.definition.module.id,
        moduleVersion: entry.definition.module.version
      }),
      ...(declaration.version ? { version: declaration.version } : {}),
      contract: runtime.contract,
      value: runtime.value
    })]
  }))
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({
    list: (kind) => kind === MAIN_EXTENSION_CONTRIBUTION_KIND ? contributions : []
  })
}
