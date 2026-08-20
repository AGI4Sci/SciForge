import { describe, expect, it, vi } from 'vitest'

import {
  PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
  type ProjectContentSpaceProvisioningIntent
} from '@sciforge/domain-content-space/administration-contract'
import { toPortableContentContainerReference } from '@sciforge/domain-content-space/contract'
import { OpenContentConnectorError } from '@sciforge/domain-opencontent-connector/contract'
import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  type OpenContentBoundTeamAdministration
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  createOpenContentProjectProvisioning,
  deterministicOpenContentProjectTeamName
} from './project-provisioning.js'
import { createCurrentPrincipalOpenContentIdentityBinding } from './identity-binding.js'

const teamId = openContentTeamIdSchema.parse(19)
const folderId = openContentFolderIdSchema.parse(2213)
const ownerIdentityId = openContentIdentityIdSchema.parse(42)
const memberAIdentityId = openContentIdentityIdSchema.parse(41)
const memberBIdentityId = openContentIdentityIdSchema.parse(43)
const staleMemberIdentityId = openContentIdentityIdSchema.parse(45)

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})

const intent: ProjectContentSpaceProvisioningIntent = Object.freeze({
  projectId: 'project-alpha',
  projectLabel: 'Alpha research',
  contentOwnerUserId: 'user-owner',
  contentMemberUserIds: ['user-member-a', 'user-member-b'],
  coordinatorAgentId: 'agent-coordinator',
  intentRevision: 1,
  idempotencyKey: 'idem_project.alpha.1'
})

describe('OpenContent Project Content Space provisioning', () => {
  it('keeps the deterministic Team name stable across intent revisions', () => {
    const first = deterministicOpenContentProjectTeamName(intent)
    const nextRevision = deterministicOpenContentProjectTeamName({
      ...intent,
      intentRevision: 2,
      idempotencyKey: 'idem_project.alpha.2'
    })

    expect(first).toBe(nextRevision)
    expect(first).toMatch(/^SciForge-MVP-Alpha-research-[a-f0-9]{16}$/u)
    expect([...first]).toHaveLength(first.length)
    expect(first.length).toBeLessThanOrEqual(240)
  })

  it('creates one deterministic Team, reads back its creator owner, reconciles all pages, and returns a receipt', async () => {
    const teamName = deterministicOpenContentProjectTeamName(intent)
    const listTeams = vi.fn<OpenContentBoundTeamAdministration['listTeams']>()
      .mockResolvedValueOnce({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 0,
        teams: []
      })
      .mockResolvedValueOnce({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 1,
        teams: [teamFixture(teamName)]
      })
    const listTeamUsers = vi.fn<OpenContentBoundTeamAdministration['listTeamUsers']>()
      .mockResolvedValueOnce({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 3,
        users: [
          { identityId: ownerIdentityId, userType: 1 },
          { identityId: staleMemberIdentityId, userType: 3 }
        ],
        nextPage: 2
      })
      .mockResolvedValueOnce({
        pageNumber: 2,
        pageSize: 100,
        totalCount: 3,
        users: [{ identityId: memberAIdentityId, userType: 3 }]
      })
      .mockResolvedValueOnce({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 3,
        users: [
          { identityId: ownerIdentityId, userType: 1 },
          { identityId: memberAIdentityId, userType: 3 },
          { identityId: memberBIdentityId, userType: 3 }
        ]
      })
    const createTeam = vi.fn<OpenContentBoundTeamAdministration['createTeam']>()
      .mockResolvedValue(undefined)
    const addTeamUsers = vi.fn<OpenContentBoundTeamAdministration['addTeamUsers']>()
      .mockResolvedValue(undefined)
    const removeTeamUsers = vi.fn<OpenContentBoundTeamAdministration['removeTeamUsers']>()
      .mockResolvedValue(undefined)
    const setTeamUserRole = vi.fn<OpenContentBoundTeamAdministration['setTeamUserRole']>(() => {
      throw new Error('Stage 1 must not change roles')
    })
    const transferTeamOwner = vi.fn<OpenContentBoundTeamAdministration['transferTeamOwner']>(() => {
      throw new Error('Stage 1 must not transfer ownership')
    })
    const teams = teamAdministrationFixture({
      listTeams,
      createTeam,
      listTeamUsers,
      addTeamUsers,
      removeTeamUsers,
      setTeamUserRole,
      transferTeamOwner,
      observeTeam: vi.fn().mockResolvedValue(teamFixture(teamName)),
      resolveTeamRoot: vi.fn().mockResolvedValue({
        teamId,
        folderId,
        folderGuid: '7031fd44-2a4a-4c3c-9c74-121104b4324a'
      })
    })
    const useTeamAdministration = vi.fn(async (_context, operation) => operation({
      administration: teams,
      externalIdentityId: ownerIdentityId
    }))
    const resolveContentUserIdentity = vi.fn(async ({ contentUserId }) => {
      const identities = {
        'user-owner': ownerIdentityId,
        'user-member-a': memberAIdentityId,
        'user-member-b': memberBIdentityId
      } as const
      return identities[contentUserId as keyof typeof identities]
    })
    const provisioning = createOpenContentProjectProvisioning({
      connection: { useTeamAdministration },
      identities: { resolveContentUserIdentity }
    })
    const context = {
      principal,
      providerInstanceRef: 'opencontent-test',
      assertPrincipalCurrent: vi.fn()
    }

    await expect(provisioning.provisionProject({ intent, context })).resolves.toEqual({
      report: {
        projectId: 'project-alpha',
        intentRevision: 1,
        status: 'ready',
        root: toPortableContentContainerReference({
          providerInstanceRef: 'opencontent-test',
          containerId: '7031fd44-2a4a-4c3c-9c74-121104b4324a'
        }),
        contentOwnerUserId: 'user-owner',
        members: [{ contentUserId: 'user-member-a', status: 'ready' }, {
          contentUserId: 'user-member-b', status: 'ready'
        }]
      },
      team: {
        teamId: 19,
        folderId: 2213,
        name: teamName,
        ownerIdentityId: 42,
        created: true
      },
      root: {
        teamId: 19,
        folderId: 2213,
        folderGuid: '7031fd44-2a4a-4c3c-9c74-121104b4324a'
      },
      reconciliation: {
        addedIdentityIds: [43],
        removedIdentityIds: [45]
      }
    })
    expect(createTeam).toHaveBeenCalledOnce()
    expect(createTeam).toHaveBeenCalledWith({ name: teamName })
    expect(listTeamUsers).toHaveBeenNthCalledWith(1, {
      teamId,
      pageNumber: 1,
      pageSize: 100
    })
    expect(listTeamUsers).toHaveBeenNthCalledWith(2, {
      teamId,
      pageNumber: 2,
      pageSize: 100
    })
    expect(addTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [memberBIdentityId]
    })
    expect(removeTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [staleMemberIdentityId]
    })
    expect(setTeamUserRole).not.toHaveBeenCalled()
    expect(transferTeamOwner).not.toHaveBeenCalled()
    expect(useTeamAdministration).toHaveBeenCalledWith(context, expect.any(Function))
  })

  it('binds the provider adapter to the provider-neutral Project provisioning port', async () => {
    const teamName = deterministicOpenContentProjectTeamName(intent)
    const unrelatedTeam = Object.freeze({
      ...teamFixture('another-project'),
      teamId: openContentTeamIdSchema.parse(18),
      folderId: openContentFolderIdSchema.parse(2212)
    })
    const listTeams = vi.fn<OpenContentBoundTeamAdministration['listTeams']>()
      .mockResolvedValueOnce({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 2,
        teams: [unrelatedTeam],
        nextPage: 2
      })
      .mockResolvedValueOnce({
        pageNumber: 2,
        pageSize: 100,
        totalCount: 2,
        teams: [teamFixture(teamName)]
      })
    const teams = teamAdministrationFixture({
      listTeams,
      observeTeam: vi.fn().mockResolvedValue(teamFixture(teamName)),
      listTeamUsers: vi.fn().mockResolvedValue({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 3,
        users: [
          { identityId: ownerIdentityId, userType: 1 },
          { identityId: memberAIdentityId, userType: 3 },
          { identityId: memberBIdentityId, userType: 3 }
        ]
      }),
      resolveTeamRoot: vi.fn().mockResolvedValue({
        teamId,
        folderId,
        folderGuid: 'team-root-guid'
      })
    })
    const provisioning = createOpenContentProjectProvisioning({
      connection: {
        useTeamAdministration: async (_context, operation) => operation({
          administration: teams,
          externalIdentityId: ownerIdentityId
        })
      },
      identities: {
        resolveContentUserIdentity: async ({ contentUserId }) => identityFor(contentUserId)
      }
    })
    const port = provisioning.bindProjectProvisioningPort({
      principal,
      providerInstanceRef: 'opencontent-test',
      assertPrincipalCurrent: vi.fn()
    })

    expect(port.contractVersion).toBe(PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION)
    await expect(port.provisionProjectContentSpace(intent)).resolves.toMatchObject({
      projectId: 'project-alpha',
      status: 'ready',
      root: toPortableContentContainerReference({
        providerInstanceRef: 'opencontent-test',
        containerId: 'team-root-guid'
      })
    })
    expect(listTeams).toHaveBeenNthCalledWith(1, expect.objectContaining({
      pageNumber: 1,
      pageSize: 100
    }))
    expect(listTeams).toHaveBeenNthCalledWith(2, expect.objectContaining({
      pageNumber: 2,
      pageSize: 100
    }))
  })

  it('reports owner synchronization instead of transferring ownership in Stage 1', async () => {
    const teamName = deterministicOpenContentProjectTeamName(intent)
    const transferTeamOwner = vi.fn<OpenContentBoundTeamAdministration['transferTeamOwner']>()
    const createTeam = vi.fn<OpenContentBoundTeamAdministration['createTeam']>()
    const teams = teamAdministrationFixture({
      listTeams: vi.fn().mockResolvedValue({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 1,
        teams: [teamFixture(teamName)]
      }),
      observeTeam: vi.fn().mockResolvedValue({
        ...teamFixture(teamName),
        ownerIdentityId: openContentIdentityIdSchema.parse(99)
      }),
      resolveTeamRoot: vi.fn().mockResolvedValue({
        teamId,
        folderId,
        folderGuid: 'owner-sync-team-root-guid'
      }),
      createTeam,
      transferTeamOwner
    })
    const provisioning = createOpenContentProjectProvisioning({
      connection: {
        useTeamAdministration: async (_context, operation) => operation({
          administration: teams,
          externalIdentityId: ownerIdentityId
        })
      },
      identities: {
        resolveContentUserIdentity: async ({ contentUserId }) => identityFor(contentUserId)
      }
    })
    const port = provisioning.bindProjectProvisioningPort({
      principal,
      providerInstanceRef: 'opencontent-test',
      assertPrincipalCurrent: vi.fn()
    })

    await expect(port.provisionProjectContentSpace(intent)).resolves.toEqual({
      projectId: 'project-alpha',
      intentRevision: 1,
      status: 'ownership_sync_required',
      root: toPortableContentContainerReference({
        providerInstanceRef: 'opencontent-test',
        containerId: 'owner-sync-team-root-guid'
      }),
      contentOwnerUserId: 'user-owner',
      members: [{
        contentUserId: 'user-member-a',
        status: 'pending',
        reasonCode: 'owner_sync_required'
      }, {
        contentUserId: 'user-member-b',
        status: 'pending',
        reasonCode: 'owner_sync_required'
      }]
    })
    expect(createTeam).not.toHaveBeenCalled()
    expect(transferTeamOwner).not.toHaveBeenCalled()
  })

  it('does not retry or rediscover after an unknown CreateTeam outcome', async () => {
    const listTeams = vi.fn().mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 0,
      teams: []
    })
    const createTeam = vi.fn().mockRejectedValue(
      new OpenContentConnectorError('outcome_unknown', 'uncertain CreateTeam result')
    )
    const teams = teamAdministrationFixture({ listTeams, createTeam })
    const provisioning = createOpenContentProjectProvisioning({
      connection: {
        useTeamAdministration: async (_context, operation) => operation({
          administration: teams,
          externalIdentityId: ownerIdentityId
        })
      },
      identities: {
        resolveContentUserIdentity: async ({ contentUserId }) => identityFor(contentUserId)
      }
    })

    await expect(provisioning.provisionProject({
      intent,
      context: {
        principal,
        providerInstanceRef: 'opencontent-test',
        assertPrincipalCurrent: vi.fn()
      }
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(createTeam).toHaveBeenCalledOnce()
    expect(listTeams).toHaveBeenCalledOnce()
  })

  it('reports a missing non-current member identity binding as pending for Cloud resolution', async () => {
    const listTeams = vi.fn()
    const teams = teamAdministrationFixture({ listTeams })
    const provisioning = createOpenContentProjectProvisioning({
      connection: {
        useTeamAdministration: async (_context, operation) => operation({
          administration: teams,
          externalIdentityId: ownerIdentityId
        })
      },
      identities: createCurrentPrincipalOpenContentIdentityBinding()
    })
    const port = provisioning.bindProjectProvisioningPort({
      principal,
      providerInstanceRef: 'opencontent-test',
      assertPrincipalCurrent: vi.fn()
    })

    await expect(port.provisionProjectContentSpace({
      ...intent,
      contentOwnerUserId: principal.subject,
      contentMemberUserIds: ['cloud-user-without-binding']
    })).resolves.toEqual({
      projectId: intent.projectId,
      intentRevision: intent.intentRevision,
      status: 'pending',
      contentOwnerUserId: principal.subject,
      members: [{
        contentUserId: 'cloud-user-without-binding',
        status: 'pending',
        reasonCode: 'identity_binding_missing'
      }]
    })
    expect(listTeams).not.toHaveBeenCalled()
  })
})

function teamFixture(name: string) {
  return Object.freeze({
    teamId,
    folderId,
    name,
    ownerIdentityId,
    status: 1,
    permission: 15,
    teamType: 2,
    isStuck: false
  })
}

function identityFor(contentUserId: string) {
  if (contentUserId === 'user-owner') return ownerIdentityId
  if (contentUserId === 'user-member-a') return memberAIdentityId
  if (contentUserId === 'user-member-b') return memberBIdentityId
  throw new Error(`Unexpected fixture content user ${contentUserId}`)
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
