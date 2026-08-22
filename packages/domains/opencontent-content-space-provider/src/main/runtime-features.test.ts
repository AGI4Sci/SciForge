import { describe, expect, it, vi } from 'vitest'

import {
  DOCFLOW_COMMAND_RESULT_PROTOCOL
} from '@sciforge/opencontent-skill-runtime/main/docflow-native-document-adapter'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from '@sciforge/domain-content-space/provider-features'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  type OpenContentSkillRuntimeTransport,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'
import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentTeamUserType
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import { createOpenContentRuntimeFeatures } from './runtime-features.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'content-owner',
  assurance: 'local-selection' as const,
  deviceId: 'runtime-feature-no-assets-test',
  identityVersion: 1
})
const teamRoot = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  containerId: 'team-root-guid'
})
const externalBinding = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})
const createdDocumentHash = 'c'.repeat(64)
const existingDocument = Object.freeze({
  resourceType: 'native_document' as const,
  reference: Object.freeze({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    fileId: 'existing-document'
  })
})
const teamId = openContentTeamIdSchema.parse(9000019)
const folderId = openContentFolderIdSchema.parse(9002213)
const currentIdentityId = openContentIdentityIdSchema.parse(42)
const memberIdentityId = openContentIdentityIdSchema.parse(84)
const ownerIdentityId = openContentIdentityIdSchema.parse(91)

describe('OpenContent optional runtime features', () => {
  it('declares native import blocked when the Provider contract is missing', async () => {
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async () => { throw new Error('Readiness description must not open the runtime.') }
    const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: nativeFacadeFixture({
        useSkillRuntime,
        listFolderEntries: vi.fn()
      })
    }))

    expect(native.describeOperations(operationContext())).toContainEqual({
      operation: 'import',
      readiness: 'blocked_by_contract',
      reasonCode: 'provider_contract_missing'
    })
  })

  it('returns native create success only after the created file is listed under the exact authorized parent', async () => {
    const signal = new AbortController().signal
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    let attachmentSessionActive = false
    const transport = nativeCreateTransport()
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async (session, operation) => {
        expect(session).toMatchObject({
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          expectedBindingAttestation: externalBinding,
          deadlineAt: '2099-08-20T12:00:00.000Z',
          signal,
          assertPrincipalCurrent
        })
        attachmentSessionActive = true
        try {
          return await operation(transport)
        } finally {
          attachmentSessionActive = false
        }
      }
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>(
      async (input) => {
        expect(attachmentSessionActive).toBe(false)
        expect(input).toEqual({
          principal,
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          expectedBindingAttestation: externalBinding,
          parentFolderGuid: teamRoot.containerId,
          page: 1,
          pageSize: 100,
          signal,
          assertPrincipalCurrent
        })
        return {
          parentFolderGuid: teamRoot.containerId,
          entries: [{
            kind: 'file',
            fileGuid: 'created-document',
            label: 'Draft.mdoc',
            size: 128
          }]
        }
      }
    )
    const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
    }))

    await expect(native.execute(nativeCreateInput({
      signal,
      assertPrincipalCurrent
    }))).resolves.toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'document',
        document: { reference: { fileId: 'created-document' } },
        documentHash: createdDocumentHash,
        revisionId: 'version-created'
      }
    })
    expect(listFolderEntries).toHaveBeenCalledOnce()
    expect(transport.invoke).toHaveBeenCalledTimes(2)
  })

  it('continues exact-parent pagination until the created file is proven', async () => {
    const signal = new AbortController().signal
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    const transport = nativeCreateTransport()
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async (_session, operation) => operation(transport)
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>(
      async ({ parentFolderGuid, page }) => page === 1
        ? {
            parentFolderGuid,
            entries: [{
              kind: 'file',
              fileGuid: 'another-document',
              label: 'Earlier.mdoc',
              size: 32
            }],
            nextPage: 2
          }
        : {
            parentFolderGuid,
            entries: [{
              kind: 'file',
              fileGuid: 'created-document',
              label: 'Draft.mdoc',
              size: 128
            }]
          }
    )
    const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
    }))

    await expect(native.execute(nativeCreateInput({
      signal,
      assertPrincipalCurrent
    }))).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(listFolderEntries).toHaveBeenCalledTimes(2)
    expect(listFolderEntries.mock.calls.map(([input]) => input.page)).toEqual([1, 2])
    expect(transport.invoke).toHaveBeenCalledTimes(2)
  })

  it('blocks native import before opening an attachment runtime session', async () => {
    const signal = new AbortController().signal
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    const transport = nativeCreateTransport()
    let attachmentRuntimeSessions = 0
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async (_session, operation) => {
        attachmentRuntimeSessions += 1
        return operation(transport)
      }
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
    const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
    }))

    await expect(native.execute(nativeImportInput({
      signal,
      assertPrincipalCurrent
    }))).resolves.toEqual({
      contractVersion: '1.0.0',
      resourceType: 'native_document',
      operation: 'import',
      invocationId: 'invocation_native_import_parent_0001',
      outcome: 'failed',
      error: {
        code: 'unsupported',
        message: 'OpenContent import is blocked because the pinned snapshot exposes no verifiable source-identity or content postcondition.',
        retry: 'never'
      }
    })
    expect(attachmentRuntimeSessions).toBe(0)
    expect(listFolderEntries).not.toHaveBeenCalled()
    expect(transport.invoke).not.toHaveBeenCalled()
  })

  it('returns non-retryable outcome_unknown when exact-parent pagination is exhausted', async () => {
    const signal = new AbortController().signal
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    const transport = nativeCreateTransport()
    const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
      async (_session, operation) => operation(transport)
    const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>(
      async ({ parentFolderGuid, page }) => ({
        parentFolderGuid,
        entries: page === 1
          ? [{
              kind: 'file' as const,
              fileGuid: 'another-document',
              label: 'Earlier.mdoc',
              size: 32
            }]
          : [],
        ...(page === 1 ? { nextPage: 2 } : {})
      })
    )
    const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
    }))

    await expect(native.execute(nativeCreateInput({
      signal,
      assertPrincipalCurrent
    }))).resolves.toEqual({
      contractVersion: '1.0.0',
      resourceType: 'native_document',
      operation: 'create',
      invocationId: 'invocation_native_create_parent_0001',
      outcome: 'outcome_unknown',
      error: {
        code: 'outcome_unknown',
        stage: 'verify',
        message: 'The OpenContent document outcome cannot be proven.',
        retry: 'never'
      }
    })
    expect(listFolderEntries).toHaveBeenCalledTimes(2)
    expect(transport.invoke.mock.calls.filter(([invocation]) =>
      invocation.command === 'docflow-create')).toHaveLength(1)
  })

  it.each(['parent echo drift', 'oversized page'] as const)(
    'returns outcome_unknown when the post-create folder page has %s',
    async (failure) => {
      const signal = new AbortController().signal
      const assertPrincipalCurrent = vi.fn(async () => undefined)
      const transport = nativeCreateTransport()
      const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
        async (_session, operation) => operation(transport)
      const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>(
        async () => failure === 'parent echo drift'
          ? { parentFolderGuid: 'another-parent', entries: [] }
          : {
              parentFolderGuid: teamRoot.containerId,
              entries: Array.from({ length: 101 }, (_, index) => ({
                kind: 'file' as const,
                fileGuid: `unrelated-document-${String(index)}`,
                label: `Unrelated ${String(index)}.mdoc`,
                size: 1
              }))
            }
      )
      const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
      }))

      await expect(native.execute(nativeCreateInput({
        signal,
        assertPrincipalCurrent
      }))).resolves.toMatchObject({
        outcome: 'outcome_unknown',
        error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
      })
      expect(listFolderEntries).toHaveBeenCalledOnce()
      expect(transport.invoke.mock.calls.filter(([invocation]) =>
        invocation.command === 'docflow-create')).toHaveLength(1)
    }
  )

  it.each([
    ['non-advancing', 1],
    ['non-integral', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1]
  ] as const)(
    'rejects a %s post-create nextPage before another Provider read',
    async (_label, nextPage) => {
      const signal = new AbortController().signal
      const assertPrincipalCurrent = vi.fn(async () => undefined)
      const transport = nativeCreateTransport()
      const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
        async (_session, operation) => operation(transport)
      const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
        .mockResolvedValueOnce({
          parentFolderGuid: teamRoot.containerId,
          entries: [],
          nextPage
        })
        .mockRejectedValueOnce(new Error('An invalid cursor must not dispatch another read.'))
      const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
      }))

      await expect(native.execute(nativeCreateInput({
        signal,
        assertPrincipalCurrent
      }))).resolves.toMatchObject({
        outcome: 'outcome_unknown',
        error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
      })
      expect(listFolderEntries).toHaveBeenCalledOnce()
      expect(transport.invoke.mock.calls.filter(([invocation]) =>
        invocation.command === 'docflow-create')).toHaveLength(1)
    }
  )

  it.each([
    ['binding drift', new OpenContentConnectorError('unauthorized', 'binding changed')],
    ['deadline cancellation', new OpenContentConnectorError('cancelled', 'deadline elapsed')],
    ['Provider read failure', new OpenContentConnectorError('provider_unavailable', 'read failed')],
    ['unexpected read failure', new Error('unexpected read failure')]
  ] as const)(
    'maps a post-create %s to non-retryable outcome_unknown',
    async (_label, error) => {
      const signal = new AbortController().signal
      const assertPrincipalCurrent = vi.fn(async () => undefined)
      const transport = nativeCreateTransport()
      const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
        async (_session, operation) => operation(transport)
      const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
        .mockRejectedValue(error)
      const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
      }))

      await expect(native.execute(nativeCreateInput({
        signal,
        assertPrincipalCurrent
      }))).resolves.toEqual({
        contractVersion: '1.0.0',
        resourceType: 'native_document',
        operation: 'create',
        invocationId: 'invocation_native_create_parent_0001',
        outcome: 'outcome_unknown',
        error: {
          code: 'outcome_unknown',
          stage: 'verify',
          message: 'The OpenContent document outcome cannot be proven.',
          retry: 'never'
        }
      })
      expect(listFolderEntries).toHaveBeenCalledOnce()
      expect(transport.invoke.mock.calls.filter(([invocation]) =>
        invocation.command === 'docflow-create')).toHaveLength(1)
    }
  )

  it.each([
    ['failed', false],
    ['outcome_unknown', true]
  ] as const)(
    'does not list the parent after a non-success native create %s receipt',
    async (expectedOutcome, dispatched) => {
      const signal = new AbortController().signal
      const assertPrincipalCurrent = vi.fn(async () => undefined)
      const transport = nativeCreateFailureTransport(dispatched)
      const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
        async (_session, operation) => operation(transport)
      const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
      }))

      await expect(native.execute(nativeCreateInput({
        signal,
        assertPrincipalCurrent
      }))).resolves.toMatchObject({ outcome: expectedOutcome })
      expect(listFolderEntries).not.toHaveBeenCalled()
      expect(transport.invoke.mock.calls.filter(([invocation]) =>
        invocation.command === 'docflow-create')).toHaveLength(1)
    }
  )

  it.each(['read', 'probe'] as const)(
    'does not list a parent after a successful native %s',
    async (operation) => {
      const signal = new AbortController().signal
      const assertPrincipalCurrent = vi.fn(async () => undefined)
      const transport = nativeReadTransport()
      const useSkillRuntime: NonNullable<OpenContentContentSpaceFacade['useSkillRuntime']> =
        async (_session, invoke) => invoke(transport)
      const listFolderEntries = vi.fn<OpenContentContentSpaceFacade['listFolderEntries']>()
      const native = requiredNativeFeature(createOpenContentRuntimeFeatures({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        facade: nativeFacadeFixture({ useSkillRuntime, listFolderEntries })
      }))

      await expect(native.execute(nativeReadInput({
        operation,
        signal,
        assertPrincipalCurrent
      }))).resolves.toMatchObject({ outcome: 'succeeded' })
      expect(listFolderEntries).not.toHaveBeenCalled()
      expect(transport.invoke).toHaveBeenCalledOnce()
    }
  )

  it('keeps both public Team governance adapters available but declares them PoC-only', async () => {
    let memberUserType: OpenContentTeamUserType = 3
    let currentOwnerIdentityId = currentIdentityId
    const setTeamUserRole = vi.fn<OpenContentBoundTeamAdministration['setTeamUserRole']>(
      async ({ userType }) => { memberUserType = userType }
    )
    const transferTeamOwner = vi.fn<OpenContentBoundTeamAdministration['transferTeamOwner']>(
      async ({ ownerIdentityId: nextOwnerIdentityId }) => {
        currentOwnerIdentityId = nextOwnerIdentityId
      }
    )
    const administration = teamAdministrationFixture({
      listTeams: vi.fn(async ({ pageNumber, pageSize }) => ({
        pageNumber,
        pageSize,
        totalCount: 1,
        teams: [teamValue(currentOwnerIdentityId)]
      })),
      observeTeam: vi.fn(async () => teamValue(currentOwnerIdentityId)),
      listTeamUsers: vi.fn(async ({ pageNumber, pageSize }) => ({
        pageNumber,
        pageSize,
        totalCount: 1,
        users: [{ identityId: memberIdentityId, userType: memberUserType }]
      })),
      resolveTeamRoot: vi.fn(async () => ({
        teamId,
        folderId,
        folderGuid: teamRoot.containerId
      })),
      setTeamUserRole,
      transferTeamOwner
    })
    const useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration'] =
      async (_input, operation) => operation({
        externalIdentityId: currentIdentityId,
        administration
      })
    const facade = facadeFixture(useTeamAdministration)
    const features = createOpenContentRuntimeFeatures({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade
    })

    expect(Object.hasOwn(facade, 'useSkillRuntime')).toBe(false)
    expect(features.nativeDocuments).toBeUndefined()
    const extended = features.extendedOperations
    expect(extended).toBeDefined()
    const states = await extended!.describeOperations(operationContext())
    expect(states).toHaveLength(54)
    expect(states.filter(({ readiness }) => readiness === 'poc_only'))
      .toEqual([
        {
          operation: 'updateTeamMemberRole',
          readiness: 'poc_only',
          reasonCode: 'verification_profile_required'
        },
        {
          operation: 'transferTeamOwnership',
          readiness: 'poc_only',
          reasonCode: 'verification_profile_required'
        }
      ])
    expect(states.filter(({ readiness }) => readiness === 'blocked_by_contract'))
      .toHaveLength(52)

    await expect(extended!.execute(teamInput({
      invocationId: 'invocation_no_assets_role_0001',
      operation: 'updateTeamMemberRole',
      request: {
        teamRoot,
        member: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          kind: 'user',
          principalId: String(memberIdentityId)
        },
        role: 'manager'
      }
    }))).resolves.toMatchObject({ ok: true, value: { role: 'manager' } })
    expect(setTeamUserRole).toHaveBeenCalledOnce()

    await expect(extended!.execute(teamInput({
      invocationId: 'invocation_no_assets_owner_0001',
      operation: 'transferTeamOwnership',
      request: {
        teamRoot,
        newOwner: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          kind: 'user',
          principalId: String(ownerIdentityId)
        }
      }
    }))).resolves.toMatchObject({
      ok: true,
      value: { owner: { principalId: String(ownerIdentityId) } }
    })
    expect(transferTeamOwner).toHaveBeenCalledOnce()

    await expect(extended!.execute(blockedCliInput())).resolves.toMatchObject({
      ok: false,
      error: { code: 'blocked_by_contract', retry: 'never' }
    })
  })
})

function operationContext() {
  return Object.freeze({
    principal,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    deadlineAt: '2099-08-20T12:00:00.000Z',
    signal: new AbortController().signal,
    assertPrincipalCurrent: () => undefined
  })
}

function teamInput(input: Readonly<{
  invocationId: string
  operation: 'updateTeamMemberRole' | 'transferTeamOwnership'
  request: unknown
}>): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  return {
    effect: 'external-write',
    context: { ...operationContext(), invocationId: input.invocationId },
    target: { kind: 'content', root: teamRoot, primary: teamRoot, authorized: [teamRoot] },
    operation: input.operation,
    request: input.request
  }
}

function blockedCliInput(): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  const file = Object.freeze({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    fileId: 'document-one'
  })
  return {
    effect: 'read',
    context: { ...operationContext(), invocationId: 'invocation_no_assets_cli_0001' },
    target: { kind: 'content', root: teamRoot, primary: file, authorized: [file] },
    operation: 'getEntryInfo',
    request: { reference: file }
  }
}

function facadeFixture(
  useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration']
): OpenContentContentSpaceFacade {
  return {
    attestExternalBinding: vi.fn(async ({ principal: currentPrincipal, providerInstanceRef }) => ({
      providerInstanceRef,
      principal: currentPrincipal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    })),
    useTeamAdministration,
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    downloadFile: vi.fn()
  }
}

function nativeFacadeFixture(
  overrides: Pick<OpenContentContentSpaceFacade, 'useSkillRuntime' | 'listFolderEntries'>
): OpenContentContentSpaceFacade {
  const useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration'] =
    async () => {
      throw new Error('Team administration is outside this native-document test.')
    }
  return {
    attestExternalBinding: vi.fn(async ({ principal: currentPrincipal, providerInstanceRef }) => ({
      providerInstanceRef,
      principal: currentPrincipal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    })),
    useTeamAdministration,
    listRootFolders: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    downloadFile: vi.fn(),
    ...overrides
  }
}

function requiredNativeFeature(
  features: ReturnType<typeof createOpenContentRuntimeFeatures>
): ContentSpaceNativeDocumentExecutor {
  const native = features.nativeDocuments
  if (!native) throw new Error('The native-document fixture requires attachment assets.')
  return native
}

function nativeCreateInput(input: Readonly<{
  signal: AbortSignal
  assertPrincipalCurrent: () => void | Promise<void>
}>): Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0] {
  return {
    effect: 'external-write',
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation_native_create_parent_0001',
      deadlineAt: '2099-08-20T12:00:00.000Z',
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    },
    target: {
      kind: 'content',
      root: teamRoot,
      primary: teamRoot,
      authorized: [teamRoot]
    },
    operation: 'create',
    request: {
      operation: 'create',
      resourceType: 'native_document',
      parent: teamRoot,
      title: 'Draft',
      content: { encoding: 'json', value: { type: 'doc', children: [] } }
    }
  }
}

function nativeReadInput(input: Readonly<{
  operation: 'read' | 'probe'
  signal: AbortSignal
  assertPrincipalCurrent: () => void | Promise<void>
}>): Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0] {
  const request = input.operation === 'read'
    ? { operation: 'read' as const, document: existingDocument }
    : {
        operation: 'probe' as const,
        document: existingDocument,
        selector: { kind: 'text' as const, text: 'Body', occurrence: 1 },
        requestedCapability: 'replace_text' as const
      }
  return {
    effect: 'read',
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: `invocation_native_${input.operation}_parent_0001`,
      deadlineAt: '2099-08-20T12:00:00.000Z',
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    },
    target: {
      kind: 'content',
      root: teamRoot,
      primary: existingDocument.reference,
      authorized: [existingDocument.reference]
    },
    operation: input.operation,
    request
  }
}

function nativeImportInput(input: Readonly<{
  signal: AbortSignal
  assertPrincipalCurrent: () => void | Promise<void>
}>): Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0] {
  const bytes = new TextEncoder().encode('Body')
  return {
    effect: 'external-write',
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: externalBinding,
      invocationId: 'invocation_native_import_parent_0001',
      deadlineAt: '2099-08-20T12:00:00.000Z',
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    },
    target: {
      kind: 'content',
      root: teamRoot,
      primary: teamRoot,
      authorized: [teamRoot]
    },
    operation: 'import',
    request: {
      operation: 'import',
      resourceType: 'native_document',
      parent: teamRoot
    },
    source: {
      name: 'Imported.md',
      size: bytes.byteLength,
      read: async ({ offset, length }) => bytes.slice(offset, offset + length)
    }
  }
}

function nativeCreateTransport(): OpenContentSkillRuntimeTransport & Readonly<{
  invoke: ReturnType<typeof vi.fn<OpenContentSkillRuntimeTransport['invoke']>>
}> {
  const invoke = vi.fn<OpenContentSkillRuntimeTransport['invoke']>(async (invocation) => {
    if (invocation.command === 'docflow-create') {
      return {
        protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
        command: invocation.command,
        ok: true,
        json: {
          success: true,
          operation: 'create',
          fileId: 'created-document'
        },
        structuredDeliveryItems: [{
          protocolVersion: '1.0',
          kind: 'docflowCard',
          version: 'v1',
          businessIdentity: 'created-document',
          outcome: 'succeeded',
          payload: {
            projectId: 'created-document',
            versionId: 'version-created',
            name: 'Draft.mdoc',
            versionName: '',
            accessUrl: 'https://provider.invalid/preview/created-document',
            updateTime: '2026-08-20T10:00:00+08:00'
          }
        }],
        managedDataFiles: []
      }
    }
    if (invocation.command === 'docflow-read') {
      return {
        protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
        command: invocation.command,
        ok: true,
        json: {
          success: true,
          operation: 'read',
          fileId: 'created-document',
          document: {
            documentHash: createdDocumentHash,
            type: 'doc',
            children: []
          }
        },
        structuredDeliveryItems: [],
        managedDataFiles: []
      }
    }
    throw new Error(`Unexpected native-document command: ${invocation.command}`)
  })
  return Object.freeze({ invoke })
}

function nativeCreateFailureTransport(
  dispatched: boolean
): OpenContentSkillRuntimeTransport & Readonly<{
  invoke: ReturnType<typeof vi.fn<OpenContentSkillRuntimeTransport['invoke']>>
}> {
  const invoke = vi.fn<OpenContentSkillRuntimeTransport['invoke']>(async (invocation) => ({
    protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
    command: invocation.command,
    ok: false,
    error: {
      code: dispatched ? 'DOCFLOW_WRITE_FAILED' : 'DOCFLOW_INVALID_INPUT',
      message: dispatched ? 'The write result is uncertain.' : 'The request is invalid.',
      stage: dispatched ? 'write' : 'validation',
      dispatched
    }
  }))
  return Object.freeze({ invoke })
}

function nativeReadTransport(): OpenContentSkillRuntimeTransport & Readonly<{
  invoke: ReturnType<typeof vi.fn<OpenContentSkillRuntimeTransport['invoke']>>
}> {
  const invoke = vi.fn<OpenContentSkillRuntimeTransport['invoke']>(async (invocation) => {
    if (invocation.command === 'docflow-read') {
      return {
        protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
        command: invocation.command,
        ok: true,
        json: {
          success: true,
          operation: 'read',
          fileId: existingDocument.reference.fileId,
          document: {
            documentHash: createdDocumentHash,
            type: 'doc',
            children: []
          }
        },
        structuredDeliveryItems: [],
        managedDataFiles: []
      }
    }
    if (invocation.command === 'docflow-probe') {
      return {
        protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
        command: invocation.command,
        ok: true,
        json: {
          success: true,
          operation: 'probe',
          view: 'target',
          fileId: existingDocument.reference.fileId,
          probe: {
            schemaVersion: 1,
            fileId: existingDocument.reference.fileId,
            documentHash: createdDocumentHash,
            capabilities: { requestedOperation: 'replaceText', supported: false },
            matches: []
          },
          truncation: { total: 0, returned: 0, truncated: false }
        },
        structuredDeliveryItems: [],
        managedDataFiles: []
      }
    }
    throw new Error(`Unexpected native-document command: ${invocation.command}`)
  })
  return Object.freeze({ invoke })
}

function teamAdministrationFixture(
  overrides: Partial<OpenContentBoundTeamAdministration>
): OpenContentBoundTeamAdministration {
  return {
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
    transferTeamOwner: vi.fn(),
    ...overrides
  }
}

function teamValue(ownerIdentityId: typeof currentIdentityId) {
  return Object.freeze({
    teamId,
    folderId,
    name: 'Research Team',
    ownerIdentityId,
    status: 1,
    permission: 15,
    teamType: 2,
    isStuck: false
  })
}
