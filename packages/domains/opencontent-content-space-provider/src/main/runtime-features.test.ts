import { describe, expect, it, vi } from 'vitest'

import type {
  ContentSpaceExtendedOperationsExecutor
} from '@sciforge/domain-content-space/provider-features'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
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
const teamId = openContentTeamIdSchema.parse(19)
const folderId = openContentFolderIdSchema.parse(2213)
const currentIdentityId = openContentIdentityIdSchema.parse(42)
const memberIdentityId = openContentIdentityIdSchema.parse(84)
const ownerIdentityId = openContentIdentityIdSchema.parse(91)

describe('OpenContent optional runtime features', () => {
  it('keeps both public Team governance operations executable without attachment transport', async () => {
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
    expect(states.filter(({ readiness }) => readiness === 'production_ready'))
      .toEqual([
        {
          operation: 'updateTeamMemberRole',
          readiness: 'production_ready',
          reasonCode: 'available'
        },
        {
          operation: 'transferTeamOwnership',
          readiness: 'production_ready',
          reasonCode: 'available'
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
    useTeamAdministration,
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    downloadFile: vi.fn()
  }
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
