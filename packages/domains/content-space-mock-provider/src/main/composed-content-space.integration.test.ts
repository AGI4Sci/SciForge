import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_CAPABILITY_IDS,
  type ContentContainerReference,
  type ContentFileReference,
  type ContentSpaceResult
} from '@sciforge/domain-content-space/contract'
import {
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION
} from '@sciforge/domain-content-space/definition'
import { createDomainMainEntry as createContentSpaceMainEntry } from
  '@sciforge/domain-content-space/main'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainMainHost,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'

import { LOCAL_MOCK_PROVIDER_INSTANCE_REF } from '../definition.js'
import { createDomainMainEntry as createMockMainEntry } from './index.js'

const uploadHandle = `xfer_${'u'.repeat(32)}`
const downloadHandle = `xfer_${'d'.repeat(32)}`
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'content-space-composed-test-device',
  identityVersion: 1
})

type CapabilityDefinition = Readonly<{
  id: string
  handler(input: unknown, context: ReturnType<typeof capabilityContext>): Promise<Readonly<{
    output: ContentSpaceResult<unknown>
  }>>
}>

describe('composed Content Space with local mock Provider', () => {
  it('preserves one pinned Provider state across create/list/observe and upload/download', async () => {
    const uploadBytes = new Uint8Array([11, 22, 33, 44])
    const downloaded: Uint8Array[] = []
    const commit = vi.fn(async () => undefined)
    const abort = vi.fn(async () => undefined)
    const fileTransfers: NonNullable<DomainMainHost['fileTransfers']> = Object.freeze({
      openUploadSource: vi.fn(async ({ handle }) => {
        expect(handle).toBe(uploadHandle)
        return Object.freeze({
          name: 'evidence.bin',
          size: uploadBytes.byteLength,
          sha256: createHash('sha256').update(uploadBytes).digest('hex'),
          read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
            uploadBytes.slice(offset, Math.min(offset + length, uploadBytes.byteLength)),
          close: vi.fn(async () => undefined)
        })
      }),
      openDownloadDestination: vi.fn(async ({ handle }) => {
        expect(handle).toBe(downloadHandle)
        return Object.freeze({
          label: 'evidence.bin',
          write: async (chunk: Uint8Array) => { downloaded.push(chunk.slice()) },
          commit,
          abort
        })
      }),
      openWorkspaceUploadSource: vi.fn(async () => {
        throw new Error('Agent Workspace transfers are outside this UI integration case.')
      }),
      openWorkspaceDownloadDestination: vi.fn(async () => {
        throw new Error('Agent Workspace transfers are outside this UI integration case.')
      })
    })
    const host: DomainMainHost = Object.freeze({
      getUserDataDir: () => '/private/tmp/sciforge-content-space-composed-test',
      defineCapability: (options: unknown) => options,
      fileTransfers
    })
    const contentEntry = createContentSpaceMainEntry(host)
    const mockEntry = createMockMainEntry(host)
    const lifecycle = runtimeContribution<DomainMainRuntimeLifecycleContribution>(
      contentEntry,
      CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
    )
    const factory = runtimeContribution<Readonly<{
      createDefinitions(): readonly CapabilityDefinition[]
    }>>(contentEntry, CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id)
    const dispose = await lifecycle.activate({
      contributions: contributionHost(projectMainExtensions(mockEntry))
    } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])

    try {
      const definitions = factory.createDefinitions()
      const containers = await invoke<Readonly<{
        providerInstanceRef: string
        items: readonly Readonly<{
          reference: ContentContainerReference
          scope: 'personal' | 'shared'
          label: string
        }>[]
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.listContainers, {
        providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
        page: { limit: 10 }
      }, 'invocation_composed_list_containers_0001')
      const root = containers.items[0]!.reference

      const created = await invoke<Readonly<{
        reference: ContentContainerReference
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.createFolder, {
        parent: root,
        name: 'Results'
      }, 'invocation_composed_create_folder_0002')
      const afterCreate = await invoke<Readonly<{
        items: readonly Readonly<{
          kind: 'container' | 'file'
          reference: ContentContainerReference | ContentFileReference
          label: string
        }>[]
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.listEntries, {
        parent: root,
        page: { limit: 10 }
      }, 'invocation_composed_list_after_create_0003')
      expect(afterCreate.items).toContainEqual(expect.objectContaining({
        kind: 'container',
        reference: created.reference,
        label: 'Results'
      }))
      const observed = await invoke<Readonly<{
        entry: Readonly<{ kind: string; reference: ContentContainerReference; label: string }>
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.observeEntry, {
        reference: created.reference
      }, 'invocation_composed_observe_folder_0004')
      expect(observed.entry).toMatchObject({
        kind: 'container',
        reference: created.reference,
        label: 'Results'
      })

      const uploaded = await invoke<Readonly<{
        reference: ContentFileReference
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.uploadNew, {
        parent: root,
        name: 'evidence.bin',
        sourceHandle: uploadHandle
      }, 'invocation_composed_upload_file_0005')
      const receipt = await invoke<Readonly<{
        bytesWritten: number
      }>>(definitions, CONTENT_SPACE_CAPABILITY_IDS.download, {
        reference: uploaded.reference,
        destinationHandle: downloadHandle
      }, 'invocation_composed_download_file_0006')

      expect(Buffer.concat(downloaded.map((chunk) => Buffer.from(chunk))))
        .toEqual(Buffer.from(uploadBytes))
      expect(receipt.bytesWritten).toBe(uploadBytes.byteLength)
      expect(commit).toHaveBeenCalledTimes(1)
      expect(abort).not.toHaveBeenCalled()
    } finally {
      if (typeof dispose === 'function') await dispose()
    }
  })
})

function capabilityContext(invocationId: string) {
  return Object.freeze({
    caller: Object.freeze({
      audience: 'ui' as const,
      callerId: 'renderer:content-space-composed-test',
      principal
    }),
    invocationId,
    signal: new AbortController().signal,
    assertPrincipalCurrent: () => undefined
  })
}

async function invoke<Value>(
  definitions: readonly CapabilityDefinition[],
  id: string,
  input: unknown,
  invocationId: string
): Promise<Value> {
  const definition = definitions.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Missing Content Space capability ${id}.`)
  const { output } = await definition.handler(input, capabilityContext(invocationId))
  if (!output.ok) throw new Error(`${output.error.code}: ${output.error.message}`)
  return output.value as Value
}

function runtimeContribution<Value>(
  entry: TrustedDomainProcessEntryInput<unknown>,
  id: string
): Value {
  const contribution = entry.contributions.find((candidate) => candidate.id === id)
  if (!contribution) throw new Error(`Missing runtime contribution ${id}.`)
  return contribution.value as Value
}

function projectMainExtensions(
  entry: TrustedDomainProcessEntryInput<unknown>
): readonly DomainMainContribution[] {
  const declarations = entry.definition.entrypoints.find(({ process }) => process === 'main')
    ?.contributions
  if (!declarations) throw new Error('Mock Provider has no main entrypoint.')
  return Object.freeze(entry.contributions.flatMap((runtime) => {
    const declaration = declarations.find(({ id }) => id === runtime.id)
    if (!declaration || declaration.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND) return []
    const contract = runtime.contract
    if (!contract) throw new Error(`Mock Provider contribution ${runtime.id} has no contract.`)
    return [Object.freeze({
      id: runtime.id,
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: entry.definition.packageName,
      owner: Object.freeze({
        moduleId: entry.definition.module.id,
        moduleVersion: entry.definition.module.version
      }),
      ...(declaration.version ? { version: declaration.version } : {}),
      contract,
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
