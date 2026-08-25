import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '@sciforge/domain-content-space/extended-operations-contract'
import { NATIVE_DOCUMENT_OPERATIONS } from '@sciforge/domain-content-space/native-document-contract'
import {
  CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
} from '@sciforge/domain-content-space/contract'

import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type {
  OpenContentContentSpaceFacade,
  OpenContentDownloadAuthorizationLease,
  OpenContentHierarchyProofSession
} from '@sciforge/domain-opencontent-connector/main-contract'

import { createOpenContentContentSpaceProvider } from './provider.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})
const assertPrincipalCurrent = () => undefined
const externalBinding = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})

type FacadeDownloadDispatch = (input: Readonly<
  Parameters<OpenContentContentSpaceFacade['authorizeDownload']>[0] & {
    write(chunk: Uint8Array): Promise<void>
  }
>) => Promise<Readonly<{ bytesWritten: number }>>

function facadeAuthorizeDownloadUsing(
  dispatch: FacadeDownloadDispatch
): OpenContentContentSpaceFacade['authorizeDownload'] {
  return async (input) => {
    let state: 'available' | 'consumed' | 'retired' = 'available'
    return Object.freeze({
      consume: async ({ write }) => {
        if (state !== 'available') throw new Error('Download lease is unavailable.')
        state = 'consumed'
        return dispatch({ ...input, write })
      },
      retire: async () => {
        if (state === 'available') state = 'retired'
      }
    }) satisfies OpenContentDownloadAuthorizationLease
  }
}

describe('OpenContent Content Space Provider', () => {
  it('maps the exact Provider Instance and complete Principal through facade v4 attestation', async () => {
    const attestation = Object.freeze({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      principal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    })
    const attestExternalBinding = vi.fn(async () => attestation)
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ attestExternalBinding })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    }

    await expect(provider.attestExternalBinding(context)).resolves.toEqual(attestation)
    expect(attestExternalBinding).toHaveBeenCalledWith({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      signal: context.signal,
      assertPrincipalCurrent
    })
  })

  it.each([
    ['another Provider Instance', {
      providerInstanceRef: 'opencontent-other-instance',
      principal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    }],
    ['a different Principal lease', {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      principal: { ...principal, identityVersion: principal.identityVersion + 1 },
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    }],
    ['a malformed attestation', {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      principal,
      externalSubject: 'not-a-digest',
      bindingRevision: 'b'.repeat(64),
      unexpected: true
    }]
  ])('fails closed when facade v4 returns %s', async (_label, rawAttestation) => {
    const attestExternalBinding = vi.fn(async () => rawAttestation) as unknown as
      OpenContentContentSpaceFacade['attestExternalBinding']
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ attestExternalBinding })
    })

    await expect(provider.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
  })

  it('forwards one exact Content Space binding expectation to every ordinary facade call', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValue({
        roots: [{
          source: 'personal-root',
          folderGuid: 'ordinary-root-guid',
          label: 'Personal library'
        }]
      })
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockResolvedValue({ parentFolderGuid: 'ordinary-root-guid', entries: [] })
    const observeEntry = vi.fn<OpenContentContentSpaceFacade['observeEntry']>()
      .mockResolvedValue({
        kind: 'container',
        folderGuid: 'ordinary-root-guid',
        label: 'Personal library'
      })
    const createFolder = vi.fn<OpenContentContentSpaceFacade['createFolder']>()
      .mockResolvedValue({ folderGuid: 'created-folder-guid' })
    const uploadNewFile = vi.fn<OpenContentContentSpaceFacade['uploadNewFile']>()
      .mockResolvedValue({
        fileGuid: 'uploaded-file-guid',
        writeAfterObservation: {
          parentFolderGuid: 'ordinary-root-guid',
          fileGuid: 'uploaded-file-guid',
          name: 'result.txt',
          size: 0
        }
      })
    const downloadDispatch = vi.fn<FacadeDownloadDispatch>()
      .mockResolvedValue({ bytesWritten: 0 })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries,
        observeEntry,
        createFolder,
        uploadNewFile,
        downloadDispatch
      })
    })
    const signal = new AbortController().signal
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation_binding_propagation_0001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal,
      assertPrincipalCurrent
    }
    const root = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'ordinary-root-guid'
    }

    await provider.listContainers({ context, page: { limit: 20 } })
    await provider.listEntries({ context, parent: root, page: { limit: 20 } })
    await provider.observeEntry({ context, reference: root })
    await provider.createFolder({ context, parent: root, name: 'Experiment' })
    await provider.uploadNewFile({
      context,
      parent: root,
      name: 'result.txt',
      source: { name: 'result.txt', size: 0, read: async () => new Uint8Array() }
    })
    const downloadLease = await provider.authorizeDownload({
      context,
      reference: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        fileId: 'uploaded-file-guid'
      }
    })
    await downloadLease.consume({
      destination: { write: async () => undefined }
    })

    for (const facadeCall of [
      listRootFolders,
      listFolderEntries,
      observeEntry,
      createFolder,
      uploadNewFile,
      downloadDispatch
    ]) {
      expect(facadeCall).toHaveBeenCalledWith(expect.objectContaining({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        expectedBindingAttestation: externalBinding,
        assertPrincipalCurrent
      }))
    }
  })

  it('proves one direct file child with exact current-session binding and neutral evidence', async () => {
    const observeEntryParent = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
      .mockResolvedValue({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
      })
    const useHierarchyProofSession = hierarchyProofSession({ observeEntryParent })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ useHierarchyProofSession })
    })
    const signal = new AbortController().signal
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation-proof-direct-0001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal,
      assertPrincipalCurrent
    }
    const root = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'authorized-root-guid'
    }
    const candidate = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      fileId: 'candidate-file-guid'
    }

    await expect(provider.proveFileDescendant({
      context,
      root,
      candidate,
      limits: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      authority: OPENCONTENT_PROVIDER_INSTANCE_REF,
      root,
      candidate,
      binding: externalBinding,
      counts: { depth: 1, pages: 0, nodes: 2 },
      provedAt: expect.any(String),
      cacheable: false,
      portable: false
    })
    expect(useHierarchyProofSession).toHaveBeenCalledOnce()
    expect(useHierarchyProofSession).toHaveBeenCalledWith({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: externalBinding,
      signal: expect.any(AbortSignal),
      assertPrincipalCurrent
    }, expect.any(Function))
    expect(observeEntryParent).toHaveBeenCalledWith({
      kind: 'file',
      resourceGuid: 'candidate-file-guid'
    })
    expect(JSON.stringify(observeEntryParent.mock.calls[0]?.[0]))
      .not.toMatch(/token|parentFolderId/u)
  })

  it('accepts exactly 32 parent edges and stops before an incomplete 33rd edge', async () => {
    const boundaryFact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>(
      async ({ kind, resourceGuid }) => {
        if (kind === 'file') {
          return {
            child: { kind, resourceGuid },
            parent: { kind: 'container', resourceGuid: 'folder-31' }
          }
        }
        const index = Number(/^folder-(\d+)$/u.exec(resourceGuid)?.[1])
        return {
          child: { kind, resourceGuid },
          parent: {
            kind: 'container',
            resourceGuid: index === 1 ? 'authorized-root-guid' : `folder-${String(index - 1)}`
          }
        }
      }
    )
    const boundaryProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent: boundaryFact })
      })
    })

    await expect(boundaryProvider.proveFileDescendant(proofInput()))
      .resolves.toMatchObject({ counts: { depth: 32, pages: 0, nodes: 33 } })
    expect(boundaryFact).toHaveBeenCalledTimes(64)

    const overBoundFact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>(
      async ({ kind, resourceGuid }) => {
        if (kind === 'file') {
          return {
            child: { kind, resourceGuid },
            parent: { kind: 'container', resourceGuid: 'folder-32' }
          }
        }
        const index = Number(/^folder-(\d+)$/u.exec(resourceGuid)?.[1])
        return {
          child: { kind, resourceGuid },
          parent: {
            kind: 'container',
            resourceGuid: index === 1 ? 'authorized-root-guid' : `folder-${String(index - 1)}`
          }
        }
      }
    )
    const overBoundProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent: overBoundFact })
      })
    })

    await expect(overBoundProvider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'bounds_exceeded', retry: 'never' } })
    expect(overBoundFact).toHaveBeenCalledTimes(32)
  })

  it('fails closed on a hierarchy cycle, missing parent, ACL revoke, or changed binding', async () => {
    const cycleFact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>(
      async ({ kind, resourceGuid }) => ({
        child: { kind, resourceGuid },
        parent: {
          kind: 'container',
          resourceGuid: kind === 'file'
            ? 'folder-a'
            : resourceGuid === 'folder-a' ? 'folder-b' : 'folder-a'
        }
      })
    )
    const cycleProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent: cycleFact })
      })
    })
    await expect(cycleProvider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'invalid_reference', retry: 'never' } })

    const missingParentFact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>(
      async ({ kind, resourceGuid }) => kind === 'file'
        ? {
            child: { kind, resourceGuid },
            parent: { kind: 'container', resourceGuid: 'sibling-root-guid' }
          }
        : { child: { kind, resourceGuid } }
    )
    const missingParentProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({
          observeEntryParent: missingParentFact
        })
      })
    })
    await expect(missingParentProvider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'invalid_reference', retry: 'never' } })
    expect(missingParentFact).toHaveBeenCalledTimes(2)

    const aclFact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
      .mockResolvedValueOnce({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'intermediate-folder-guid' }
      })
      .mockRejectedValueOnce(new OpenContentConnectorError(
        'unauthorized',
        'The current ACL was revoked.'
      ))
    const aclProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent: aclFact })
      })
    })
    await expect(aclProvider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })

    const changedBindingProvider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({
          observeEntryParent: vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>(
            async ({ kind, resourceGuid }) => ({
              child: { kind, resourceGuid },
              parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
            })
          ),
          bindingAttestation: {
            ...externalBinding,
            bindingRevision: 'c'.repeat(64)
          }
        })
      })
    })
    await expect(changedBindingProvider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
  })

  it('fails closed when a candidate is reparented while its proof is in flight', async () => {
    const observeEntryParent = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
      .mockResolvedValueOnce({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
      })
      .mockResolvedValueOnce({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'different-root-guid' }
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent })
      })
    })

    await expect(provider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'invalid_reference', retry: 'never' } })
    expect(observeEntryParent).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the exact root ACL is revoked after its parent edge is proven', async () => {
    const observeEntryParent = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
      .mockResolvedValue({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
      })
    const observeContainer = vi.fn<OpenContentHierarchyProofSession['observeContainer']>()
      .mockRejectedValue(new OpenContentConnectorError(
        'unauthorized',
        'The exact root ACL was revoked.'
      ))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({
          observeEntryParent,
          observeContainer
        })
      })
    })

    await expect(provider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    expect(observeEntryParent).toHaveBeenCalledTimes(2)
    expect(observeContainer).toHaveBeenCalledWith({
      resourceGuid: 'authorized-root-guid'
    })
  })

  it('rejects mismatched Provider roots, wrong child facts, and non-canonical proof limits', async () => {
    const observeEntryParent = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent })
      })
    })
    await expect(provider.proveFileDescendant({
      ...proofInput(),
      root: {
        providerInstanceRef: 'opencontent-other-instance',
        containerId: 'authorized-root-guid'
      }
    })).rejects.toMatchObject({ detail: { code: 'invalid_reference' } })
    await expect(provider.proveFileDescendant({
      ...proofInput(),
      limits: { ...CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS, maxDepth: 31 } as never
    })).rejects.toMatchObject({ detail: { code: 'invalid_input' } })
    expect(observeEntryParent).not.toHaveBeenCalled()

    observeEntryParent.mockResolvedValue({
      child: { kind: 'container', resourceGuid: 'candidate-file-guid' },
      parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
    })
    await expect(provider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'provider_contract_violation' } })
  })

  it('accepts the 10,000 ms boundary and rejects a fact returned after it', async () => {
    const fact = vi.fn<OpenContentHierarchyProofSession['observeEntryParent']>()
      .mockResolvedValue({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'authorized-root-guid' }
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        useHierarchyProofSession: hierarchyProofSession({ observeEntryParent: fact })
      })
    })
    const boundaryClock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(10_000)
    await expect(provider.proveFileDescendant(proofInput()))
      .resolves.toMatchObject({ counts: { elapsedMs: 10_000 } })
    boundaryClock.mockRestore()

    const lateClock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(10_001)
    await expect(provider.proveFileDescendant(proofInput()))
      .rejects.toMatchObject({ detail: { code: 'bounds_exceeded', retry: 'never' } })
    lateClock.mockRestore()
  })

  it('keeps an ordinary safe read usable without inventing a binding expectation', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockResolvedValue({ parentFolderGuid: 'ordinary-root-guid', entries: [] })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ listFolderEntries })
    })

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        signal: new AbortController().signal,
        assertPrincipalCurrent
      },
      parent: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        containerId: 'ordinary-root-guid'
      },
      page: { limit: 20 }
    })).resolves.toMatchObject({ items: [] })
    expect(listFolderEntries.mock.calls[0]?.[0])
      .not.toHaveProperty('expectedBindingAttestation')
  })

  it('declares exactly the ten supported administration operations PoC-only', async () => {
    const useTeamAdministration = vi.fn(async () => {
      throw new Error('Administration readiness must not open a remote session.')
    }) as unknown as NonNullable<OpenContentContentSpaceFacade['useTeamAdministration']>
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ useTeamAdministration })
    })

    const administration = provider.features?.administration
    expect(administration?.describeOperations).toBeTypeOf('function')
    expect(administration?.bind).toBeTypeOf('function')
    const administrationStates = await administration!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(administrationStates).toHaveLength(10)
    expect(administrationStates.every(({ readiness, reasonCode }) => (
      readiness === 'poc_only' && reasonCode === 'verification_profile_required'
    ))).toBe(true)
    expect(administrationStates.some(({ readiness }) => readiness === 'production_ready'))
      .toBe(false)
    expect(useTeamAdministration).not.toHaveBeenCalled()
  })

  it('keeps hardened transfer operations PoC-only without packaged-live evidence', async () => {
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({})
    })

    expect(provider.features?.nativeDocuments).toBeUndefined()
    const extended = provider.features?.extendedOperations
    expect(extended).toBeDefined()
    const capabilities = await provider.describeCapabilities({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(capabilities).toHaveLength(8)
    expect(capabilities).toEqual(expect.arrayContaining([
      {
        operation: 'list-containers',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'list-entries',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'observe-entry',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'create-folder',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'upload-new',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      },
      {
        operation: 'download',
        readiness: 'poc_only',
        reasonCode: 'verification_profile_required'
      }
    ]))
    expect(capabilities.filter(({ readiness }) => readiness === 'poc_only')).toHaveLength(6)
    expect(capabilities.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toEqual([
        {
          operation: 'portal-target',
          readiness: 'blocked_by_contract',
          reasonCode: 'provider_contract_missing'
        },
        {
          operation: 'observe-immutable-version',
          readiness: 'blocked_by_contract',
          reasonCode: 'provider_contract_missing'
        }
      ])
    expect(capabilities.some(({ readiness }) => readiness === 'production_ready')).toBe(false)

    const states = await extended!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(states).toHaveLength(50)
    expect(states.filter(({ readiness }) => readiness === 'poc_only'))
      .toEqual([
        {
          operation: 'getCurrentPrincipal',
          readiness: 'poc_only',
          reasonCode: 'verification_profile_required'
        }
      ])
    expect(states.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toHaveLength(49)
  })

  it('advertises the exact extended-operation readiness split with an overlay', async () => {
    const useSupplierTransport: NonNullable<OpenContentContentSpaceFacade['useSupplierTransport']> =
      async () => { throw new Error('Execution is outside this readiness test.') }
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({ useSupplierTransport })
    })
    const extended = provider.features?.extendedOperations
    const native = provider.features?.nativeDocuments
    expect(extended).toBeDefined()
    expect(native).toBeDefined()
    const states = await extended!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })

    expect(states.map(({ operation }) => operation).sort()).toEqual(
      Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS).sort()
    )
    expect(states).toHaveLength(50)
    expect(states.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toEqual([
        'resolveInternalLink',
        'listMetadataChoices',
        'updateFileVersion',
        'searchUsers',
        'searchDepartments',
        'searchPositions',
        'searchGroups',
        'resolveCollaborationInvitation',
        'listKnowledgeCollections',
        'searchKnowledgeCollections'
      ].map((operation) => ({
        operation,
        readiness: 'blocked_by_contract',
        reasonCode: 'provider_contract_missing'
      })))
    expect(states.filter(({ readiness }) => readiness === 'poc_only')
      .every(({ readiness, reasonCode }) =>
        readiness === 'poc_only' && reasonCode === 'verification_profile_required'))
      .toBe(true)
    expect(states.filter(({ readiness }) => readiness === 'poc_only')).toHaveLength(40)

    const nativeStates = await native!.describeOperations({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })
    expect(nativeStates.map(({ operation }) => operation).sort())
      .toEqual([...NATIVE_DOCUMENT_OPERATIONS].sort())
    expect(nativeStates).toHaveLength(20)
    expect(nativeStates.filter(({ readiness }) => readiness === 'blocked_by_contract')
      .map(({ operation }) => operation).sort()).toEqual([
        'comment-create',
        'comment-delete',
        'comment-reopen',
        'comment-reply',
        'comment-solve',
        'edit',
        'import',
        'insert',
        'redo',
        'undo',
        'update'
      ])
    expect(nativeStates.filter(({ readiness }) => readiness === 'poc_only'))
      .toHaveLength(9)
    expect(nativeStates.filter(({ readiness }) => readiness === 'poc_only')
      .every(({ reasonCode }) => reasonCode === 'verification_profile_required')).toBe(true)
    expect(nativeStates.some(({ readiness }) => readiness === 'production_ready')).toBe(false)
  })

  it.each([
    ['invalid_input', 'invalid_input', 'never'],
    ['unauthorized', 'unauthorized', 'after-human-action'],
    ['reauthentication_required', 'unauthorized', 'after-human-action'],
    ['cancelled', 'cancelled', 'never'],
    ['rate_limited', 'rate_limited', 'after-human-action'],
    ['provider_contract_violation', 'provider_contract_violation', 'never'],
    ['bounds_exceeded', 'bounds_exceeded', 'never'],
    ['conflict', 'conflict', 'after-human-action'],
    ['outcome_unknown', 'outcome_unknown', 'never']
  ] as const)(
    'preserves the bounded %s Connector outcome',
    async (connectorCode, contentCode, retry) => {
      const provider = createOpenContentContentSpaceProvider({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: facadeFixture({
          listRootFolders: vi.fn().mockRejectedValue(
            new OpenContentConnectorError(connectorCode, 'secret provider diagnostic')
          ),
          listFolderEntries: vi.fn(),
          observeEntry: vi.fn(),
          createFolder: vi.fn(),
          uploadNewFile: vi.fn(),
          downloadDispatch: vi.fn()
        })
      })

      const error = await provider.listContainers({
        context: {
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          assertPrincipalCurrent
        },
        page: { limit: 20 }
      }).catch((caught: unknown) => caught)
      expect(error).toMatchObject({
        detail: { code: contentCode, retry }
      })
      expect(JSON.stringify(error)).not.toContain('secret provider diagnostic')
    }
  )

  it('maps the personal root and Team roots to stable scoped containers', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({
        roots: [{
          source: 'personal-root',
          folderGuid: 'personal-folder-guid',
          label: 'Personal library'
        }]
      })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'team-folder-guid',
          label: 'sciforge test'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    await expect(provider.listContainers({
      context,
      page: { limit: 20 }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'personal-folder-guid'
        },
        scope: 'personal',
        label: 'Personal library'
      }],
      nextCursor: 'teams_1'
    })
    await expect(provider.listContainers({
      context,
      page: { limit: 20, cursor: 'teams_1' }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'team-folder-guid'
        },
        scope: 'shared',
        label: 'sciforge test'
      }]
    })
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      includePersonal: true,
      includeTeams: false,
      assertPrincipalCurrent
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      includePersonal: false,
      includeTeams: true,
      teamPage: 1,
      assertPrincipalCurrent
    }))
  })

  it('continues past an empty OpenContent Team page before returning a public cursor page', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({ roots: [], nextTeamPage: 2 })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'later-team-root-guid',
          label: 'Later Team'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })

    await expect(provider.listContainers({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      page: { limit: 200, cursor: 'teams_1' }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'later-team-root-guid'
        },
        scope: 'shared',
        label: 'Later Team'
      }]
    })
    expect(listRootFolders).toHaveBeenCalledTimes(2)
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      teamPage: 1,
      teamPageSize: 100
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      teamPage: 2,
      teamPageSize: 100
    }))
  })

  it('continues into Team roots when OpenContent returns no personal root', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockResolvedValueOnce({ roots: [] })
      .mockResolvedValueOnce({
        roots: [{
          source: 'team-root',
          folderGuid: 'first-team-root-guid',
          label: 'First Team'
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })

    await expect(provider.listContainers({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      page: { limit: 20 }
    })).resolves.toEqual({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      items: [{
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'first-team-root-guid'
        },
        scope: 'shared',
        label: 'First Team'
      }]
    })
    expect(listRootFolders).toHaveBeenNthCalledWith(1, expect.objectContaining({
      includePersonal: true,
      includeTeams: false
    }))
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      includePersonal: false,
      includeTeams: true,
      teamPage: 1
    }))
  })

  it('keeps the OpenContent Team page size in the cursor when the public limit changes', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockImplementation(async ({ teamPage, teamPageSize }) => ({
        roots: Array.from({ length: teamPageSize }, (_, index) => ({
          source: 'team-root' as const,
          folderGuid: `team-root-${String((teamPage - 1) * teamPageSize + index + 1)}`,
          label: `Team ${String((teamPage - 1) * teamPageSize + index + 1)}`
        })),
        nextTeamPage: teamPage + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    const first = await provider.listContainers({
      context,
      page: { limit: 20, cursor: 'teams_1' }
    })
    expect(first.nextCursor).toBe('teams_2_20')
    const second = await provider.listContainers({
      context,
      page: { limit: 100, cursor: first.nextCursor }
    })
    expect(second.items).toHaveLength(20)
    expect(second.items[0]).toMatchObject({ label: 'Team 21' })
    expect(second.items[19]).toMatchObject({ label: 'Team 40' })
    expect(second.nextCursor).toBe('teams_3_20')
    expect(listRootFolders).toHaveBeenNthCalledWith(2, expect.objectContaining({
      teamPage: 2,
      teamPageSize: 20
    }))
  })

  it('uses a Team cursor offset when the next public limit is smaller than the Provider page', async () => {
    const listRootFolders = vi.fn<OpenContentContentSpaceFacade['listRootFolders']>()
      .mockImplementation(async ({ teamPage, teamPageSize }) => ({
        roots: Array.from({ length: teamPageSize }, (_, index) => ({
          source: 'team-root' as const,
          folderGuid: `team-root-${String((teamPage - 1) * teamPageSize + index + 1)}`,
          label: `Team ${String((teamPage - 1) * teamPageSize + index + 1)}`
        })),
        nextTeamPage: teamPage + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders,
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      assertPrincipalCurrent
    }

    const first = await provider.listContainers({
      context,
      page: { limit: 100, cursor: 'teams_1' }
    })
    expect(first.nextCursor).toBe('teams_2_100')
    const second = await provider.listContainers({
      context,
      page: { limit: 20, cursor: first.nextCursor }
    })
    expect(second.items).toHaveLength(20)
    expect(second.items[0]).toMatchObject({ label: 'Team 101' })
    expect(second.items[19]).toMatchObject({ label: 'Team 120' })
    expect(second.nextCursor).toBe('teams_2_100_20')
  })

  it('maps Provider folder and file GUIDs without exposing numeric IDs', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockResolvedValue({
        parentFolderGuid: 'team-folder-guid',
        entries: [{
          kind: 'container',
          folderGuid: 'child-folder-guid',
          label: 'Experiment A'
        }, {
          kind: 'file',
          fileGuid: 'child-file-guid',
          label: 'result.txt',
          size: 98
        }]
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent,
      page: { limit: 20 }
    })).resolves.toEqual({
      parent,
      items: [{
        kind: 'container',
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId: 'child-folder-guid'
        },
        label: 'Experiment A'
      }, {
        kind: 'file',
        reference: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          fileId: 'child-file-guid'
        },
        label: 'result.txt',
        size: 98
      }]
    })
  })

  it('serves a 200-item Content Space page through bounded 100-item OpenContent pages', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      .mockImplementation(async ({ parentFolderGuid, page, pageSize }) => ({
        parentFolderGuid,
        entries: Array.from({ length: pageSize }, (_, index) => ({
          kind: 'container' as const,
          folderGuid: `folder-${String((page - 1) * pageSize + index + 1)}`,
          label: `Folder ${String((page - 1) * pageSize + index + 1)}`
        })),
        nextPage: page + 1
      }))
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }

    const result = await provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent,
      page: { limit: 200 }
    })

    expect(result.items).toHaveLength(200)
    expect(result.items[0]).toMatchObject({ label: 'Folder 1' })
    expect(result.items[199]).toMatchObject({ label: 'Folder 200' })
    expect(result.nextCursor).toBe('entries_3_100_0')
    expect(listFolderEntries).toHaveBeenCalledTimes(2)
    expect(listFolderEntries).toHaveBeenNthCalledWith(1, expect.objectContaining({
      page: 1,
      pageSize: 100
    }))
    expect(listFolderEntries).toHaveBeenNthCalledWith(2, expect.objectContaining({
      page: 2,
      pageSize: 100
    }))
  })

  it('rejects obsolete entry cursors before invoking the Connector', async () => {
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries,
        observeEntry: vi.fn(),
        createFolder: vi.fn(),
        uploadNewFile: vi.fn(),
        downloadDispatch: vi.fn()
      })
    })

    await expect(provider.listEntries({
      context: {
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        assertPrincipalCurrent
      },
      parent: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        containerId: 'team-folder-guid'
      },
      page: { limit: 20, cursor: 'page_2' }
    })).rejects.toMatchObject({ detail: { code: 'invalid_input' } })
    expect(listFolderEntries).not.toHaveBeenCalled()
  })

  it('binds write and transfer receipts to the exact invocation and GUID references', async () => {
    const bytes = new TextEncoder().encode('result bytes')
    const createFolder = vi.fn<OpenContentContentSpaceFacade['createFolder']>()
      .mockResolvedValue({ folderGuid: 'created-folder-guid' })
    const uploadNewFile = vi.fn<OpenContentContentSpaceFacade['uploadNewFile']>()
      .mockResolvedValue({
        fileGuid: 'uploaded-file-guid',
        writeAfterObservation: {
          parentFolderGuid: 'team-folder-guid',
          fileGuid: 'uploaded-file-guid',
          name: 'result.txt',
          size: bytes.byteLength
        }
      })
    const downloadDispatch = vi.fn<FacadeDownloadDispatch>()
      .mockImplementation(async ({ write }) => {
        await write(bytes)
        return { bytesWritten: bytes.byteLength }
      })
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        listRootFolders: vi.fn(),
        listFolderEntries: vi.fn(),
        observeEntry: vi.fn(),
        createFolder,
        uploadNewFile,
        downloadDispatch
      })
    })
    const parent = {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'team-folder-guid'
    }
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation-opencontent-001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    }

    await expect(provider.createFolder({ context, parent, name: 'Experiment' }))
      .resolves.toMatchObject({
        invocationId: context.invocationId,
        reference: { containerId: 'created-folder-guid' }
      })
    await expect(provider.uploadNewFile({
      context,
      parent,
      name: 'result.txt',
      source: {
        name: 'result.txt',
        size: bytes.byteLength,
        read: async ({ offset, length }) => bytes.slice(offset, offset + length)
      }
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      sourceSize: bytes.byteLength,
      reference: { fileId: 'uploaded-file-guid' }
    })
    const writes: Uint8Array[] = []
    const downloadLease = await provider.authorizeDownload({
      context,
      reference: {
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        fileId: 'uploaded-file-guid'
      }
    })
    await expect(downloadLease.consume({
      destination: { write: async (chunk) => { writes.push(Uint8Array.from(chunk)) } }
    })).resolves.toMatchObject({
      invocationId: context.invocationId,
      bytesWritten: bytes.byteLength
    })
    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
  })

  it('classifies unknown or mismatched write receipts as outcome_unknown without retry', async () => {
    const provider = createOpenContentContentSpaceProvider({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture({
        uploadNewFile: vi.fn()
          .mockRejectedValueOnce(new Error('transport disappeared after dispatch'))
          .mockResolvedValueOnce({
            fileGuid: '7001',
            writeAfterObservation: {
              parentFolderGuid: 'authorized-root-guid',
              fileGuid: '7001',
              name: 'result.txt',
              size: 0
            }
          })
          .mockResolvedValueOnce({
            fileGuid: 'valid-upload-guid',
            writeAfterObservation: {
              parentFolderGuid: 'different-root-guid',
              fileGuid: 'valid-upload-guid',
              name: 'result.txt',
              size: 0
            }
          }),
        downloadDispatch: vi.fn().mockRejectedValue(new Error('read transport disappeared'))
      })
    })
    const input = proofInput()
    const parent = input.root
    const source = {
      name: 'result.txt',
      size: 0,
      read: async () => new Uint8Array()
    }
    await expect(provider.uploadNewFile({
      context: input.context,
      parent,
      name: 'result.txt',
      source
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    await expect(provider.uploadNewFile({
      context: input.context,
      parent,
      name: 'result.txt',
      source
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    await expect(provider.uploadNewFile({
      context: input.context,
      parent,
      name: 'result.txt',
      source
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    const downloadLease = await provider.authorizeDownload({
      context: input.context,
      reference: input.candidate
    })
    await expect(downloadLease.consume({
      destination: { write: async () => undefined }
    })).rejects.toMatchObject({
      detail: { code: 'provider_unavailable', retry: 'never' }
    })
  })

  it.each(['2', '7', '19'])(
    'never forwards numeric OpenContent identity %s as a folder parent',
    async (containerId) => {
      const createFolder = vi.fn<OpenContentContentSpaceFacade['createFolder']>()
      const provider = createOpenContentContentSpaceProvider({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: facadeFixture({
          listRootFolders: vi.fn(),
          listFolderEntries: vi.fn(),
          observeEntry: vi.fn(),
          createFolder,
          uploadNewFile: vi.fn(),
          downloadDispatch: vi.fn()
        })
      })

      await expect(provider.createFolder({
        context: {
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          invocationId: 'invocation-opencontent-magic-parent',
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          signal: new AbortController().signal,
          assertPrincipalCurrent
        },
        parent: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          containerId
        },
        name: 'Experiment'
      })).rejects.toMatchObject({
        detail: { code: 'invalid_input', retry: 'never' }
      })
      expect(createFolder).not.toHaveBeenCalled()
    }
  )
})

function proofInput() {
  return {
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation-proof-fixture-0001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    },
    root: {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: 'authorized-root-guid'
    },
    candidate: {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      fileId: 'candidate-file-guid'
    },
    limits: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
  } as const
}

type FacadeFixtureOverrides = Partial<OpenContentContentSpaceFacade> & Readonly<{
  downloadDispatch?: FacadeDownloadDispatch
}>

function facadeFixture(
  overrides: FacadeFixtureOverrides
): OpenContentContentSpaceFacade {
  const useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration'] =
    async () => {
      throw new Error('Team administration is outside this provider test.')
    }
  const { downloadDispatch, ...facadeOverrides } = overrides
  return {
    attestExternalBinding: async (input) => Object.freeze({
      providerInstanceRef: input.providerInstanceRef,
      principal: input.principal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    }),
    useTeamAdministration,
    useHierarchyProofSession: hierarchyProofSession(),
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn<OpenContentContentSpaceFacade['observeEntry']>(
      async ({ kind, resourceGuid }) => kind === 'container'
        ? { kind, folderGuid: resourceGuid, label: 'Observed container' }
        : { kind, fileGuid: resourceGuid, label: 'Observed file', size: 0 }
    ),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    authorizeDownload: downloadDispatch
      ? facadeAuthorizeDownloadUsing(downloadDispatch)
      : vi.fn<OpenContentContentSpaceFacade['authorizeDownload']>(),
    ...facadeOverrides
  }
}

function hierarchyProofSession(
  overrides: Partial<OpenContentHierarchyProofSession> = {}
): OpenContentContentSpaceFacade['useHierarchyProofSession'] & ReturnType<typeof vi.fn> {
  const implementation: OpenContentContentSpaceFacade['useHierarchyProofSession'] =
    async (input, operation) => operation(Object.freeze({
      bindingAttestation: input.expectedBindingAttestation,
      observeContainer: async ({ resourceGuid }) => Object.freeze({
        kind: 'container' as const,
        folderGuid: resourceGuid,
        label: 'Observed proof root'
      }),
      observeEntryParent: async () => {
        throw new Error('The hierarchy parent fact was not configured for this proof test.')
      },
      ...overrides
    }))
  return vi.fn(implementation) as unknown as
    OpenContentContentSpaceFacade['useHierarchyProofSession'] & ReturnType<typeof vi.fn>
}
