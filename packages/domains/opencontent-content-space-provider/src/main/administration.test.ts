import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION
} from '@sciforge/domain-content-space/administration-contract'
import { ContentSpaceOperationError } from '@sciforge/domain-content-space/contract'
import type { ContentSpaceProviderOperationContext } from '@sciforge/domain-content-space/contract'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'
import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  createOpenContentAdministrationFeature
} from './administration.js'
import type { OpenContentIdentityBindingPort } from './identity-binding.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'content-owner',
  assurance: 'local-selection' as const,
  deviceId: 'test-device',
  identityVersion: 1
})
const context: ContentSpaceProviderOperationContext = Object.freeze({
  principal,
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  assertPrincipalCurrent: vi.fn()
})
const teamId = openContentTeamIdSchema.parse(9000019)
const folderId = openContentFolderIdSchema.parse(9002213)
const ownerIdentityId = openContentIdentityIdSchema.parse(42)
const memberIdentityId = openContentIdentityIdSchema.parse(43)
const managerIdentityId = openContentIdentityIdSchema.parse(44)
const externalIdentityId = openContentIdentityIdSchema.parse(45)
const rootGuid = '11111111-2222-4333-8444-555555555555'
const externalBinding = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})

describe('OpenContent provider-neutral administration adapter', () => {
  it('declares ten unverified operations PoC-only and Project provisioning blocked', async () => {
    const useTeamAdministration = vi.fn(async () => {
      throw new Error('Readiness description must not open an OpenContent administration session.')
    }) as unknown as OpenContentContentSpaceFacade['useTeamAdministration'] &
      ReturnType<typeof vi.fn>
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(useTeamAdministration),
      identities: identityBindings()
    })

    const states = await feature.describeOperations(context)

    expect(states.map(({ operation }) => operation))
      .toEqual(CONTENT_SPACE_ADMINISTRATION_OPERATIONS)
    expect(new Set(states.map(({ operation }) => operation)).size).toBe(states.length)
    expect(states).toHaveLength(11)
    expect(states.filter(({ operation }) => operation !== 'provision-project'))
      .toHaveLength(10)
    expect(states.filter(({ operation }) => operation !== 'provision-project')
      .every(({ readiness, reasonCode }) => (
        readiness === 'poc_only' && reasonCode === 'verification_profile_required'
      ))).toBe(true)
    expect(states).toContainEqual({
      operation: 'provision-project',
      readiness: 'blocked_by_contract',
      reasonCode: 'provider_contract_missing'
    })
    expect(states.some(({ readiness }) => readiness === 'production_ready')).toBe(false)
    expect(states.some(({ operation }) => operation.includes('delete'))).toBe(false)
    expect(useTeamAdministration).not.toHaveBeenCalled()

    const wrongInstance = (() => {
      try {
        feature.describeOperations({
          ...context,
          providerInstanceRef: 'other-provider-instance'
        })
      } catch (error) {
        return error
      }
      return undefined
    })()
    expect(wrongInstance).toBeInstanceOf(ContentSpaceOperationError)
    expect(wrongInstance).toMatchObject({ detail: { code: 'invalid_input' } })
    expect(useTeamAdministration).not.toHaveBeenCalled()
  })

  it('binds administration and Project provisioning to the same Principal-scoped facade', async () => {
    const harness = teamHarness()
    const useTeamAdministration = teamSession(harness.administration)
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(useTeamAdministration),
      identities: identityBindings()
    })

    const binding = await feature.bind(context)

    expect(binding.administration.contractVersion)
      .toBe(CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION)
    expect(binding.projectProvisioning?.contractVersion)
      .toBe(PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION)
    await binding.administration.listSpaces({ page: { limit: 20 } })
    expect(useTeamAdministration).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        assertPrincipalCurrent: context.assertPrincipalCurrent
      }),
      expect.any(Function)
    )
  })

  it('forwards the exact Content Space binding expectation when a bound Team port opens a session', async () => {
    const harness = teamHarness()
    const useTeamAdministration = teamSession(harness.administration)
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(useTeamAdministration),
      identities: identityBindings()
    })
    const boundContext = Object.freeze({ ...context, expectedExternalBinding: externalBinding })
    const binding = await feature.bind(boundContext)

    await binding.administration.listSpaces({ page: { limit: 20 } })

    expect(useTeamAdministration).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        expectedBindingAttestation: externalBinding,
        assertPrincipalCurrent: context.assertPrincipalCurrent
      }),
      expect.any(Function)
    )
  })

  it('lists, observes, opens, edits, pins, and unpins a Team by its portable root', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration

    const listed = await administration.listSpaces({ page: { limit: 20 } })
    expect(listed).toEqual({
      items: [{
        root: expect.any(Object),
        label: 'Research Team',
        contentOwnerUserId: 'content-owner',
        pinned: false,
        revision: expect.stringMatching(/^oc_[a-f0-9]{32}$/u)
      }]
    })
    const root = listed.items[0]!.root
    const observed = await administration.observeSpace({ root })
    await expect(administration.openRoot({ root })).resolves.toEqual({
      root,
      revision: observed.revision
    })

    const edited = await administration.updateSpace({
      root,
      expectedRevision: observed.revision,
      label: 'Renamed Team'
    })
    expect(edited.label).toBe('Renamed Team')
    expect(harness.editTeam).toHaveBeenCalledWith({
      teamId,
      folderId,
      name: 'Renamed Team'
    })
    const pinned = await administration.pinSpace({
      root,
      expectedRevision: edited.revision
    })
    expect(pinned.pinned).toBe(true)
    const unpinned = await administration.unpinSpace({
      root,
      expectedRevision: pinned.revision
    })
    expect(unpinned.pinned).toBe(false)
    expect(harness.stickTeam).toHaveBeenCalledOnce()
    expect(harness.unstickTeam).toHaveBeenCalledOnce()
  })

  it('returns a conflict before an update when the expected Team revision is stale', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const root = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!.root

    await expect(administration.updateSpace({
      root,
      expectedRevision: 'oc_00000000000000000000000000000000',
      label: 'Must not write'
    })).rejects.toMatchObject({
      detail: { code: 'conflict', retry: 'after-human-action' }
    })
    expect(harness.editTeam).not.toHaveBeenCalled()
  })

  it('never transfers ownership through the administration update path', async () => {
    const harness = teamHarness()
    const identities = identityBindings(new Map([
      ['content-owner', ownerIdentityId],
      ['content-new-owner', memberIdentityId]
    ]))
    const administration = (await createFeature(harness, identities).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    const updateSpace = administration.updateSpace as (input: unknown) => ReturnType<
      typeof administration.updateSpace
    >
    await expect(updateSpace({
      root: space.root,
      expectedRevision: space.revision,
      label: 'Renamed Without Owner Transfer',
      contentOwnerUserId: 'content-new-owner'
    })).resolves.toMatchObject({
      label: 'Renamed Without Owner Transfer',
      contentOwnerUserId: 'content-owner'
    })
    expect(harness.transferTeamOwner).not.toHaveBeenCalled()
  })

  it('creates once only for the verified current Principal owner and reads the Team back', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'New Research Team',
      contentOwnerUserId: principal.subject
    })).resolves.toMatchObject({
      label: 'New Research Team',
      contentOwnerUserId: principal.subject,
      pinned: false
    })
    expect(harness.createTeam).toHaveBeenCalledOnce()
    expect(harness.createTeam).toHaveBeenCalledWith({ name: 'New Research Team' })

    await administration.createSpace({
      label: 'New Research Team',
      contentOwnerUserId: principal.subject
    })
    expect(harness.createTeam).toHaveBeenCalledOnce()
  })

  it('never guesses a non-current owner identity or dispatches CreateTeam for it', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(teamSession(harness.administration))
    })
    const administration = (await feature.bind(context)).administration

    const error = await administration.createSpace({
      label: 'Foreign Team',
      contentOwnerUserId: 'unbound-cloud-user'
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ContentSpaceOperationError)
    expect(error).toMatchObject({
      detail: { code: 'unauthorized', retry: 'after-human-action' }
    })
    expect(harness.createTeam).not.toHaveBeenCalled()
  })

  it('adds, lists, and removes a non-current Provider directory user without a Host identity mapping', async () => {
    const harness = teamHarness()
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(teamSession(harness.administration))
    })
    const administration = (await feature.bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const member = Object.freeze({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: String(memberIdentityId)
    })

    await expect(administration.addMember({
      root: space.root,
      member,
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member, role: 'internal' })

    const listed = await administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })
    const listedMember = listed.items.find((item) => item.member.principalId === member.principalId)
    expect(listedMember).toMatchObject({ member, role: 'internal' })

    await expect(administration.removeMember({
      root: space.root,
      member: listedMember!.member,
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member, removed: true })
    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })).resolves.not.toMatchObject({
      items: [expect.objectContaining({ member })]
    })
  })

  it('paginates members in provider batches and verifies add and remove writes', async () => {
    const harness = teamHarness({
      users: [ownerIdentityId, ...Array.from({ length: 100 }, (_, index) => (
        openContentIdentityIdSchema.parse(100 + index)
      ))]
    })
    const bindings = identityBindings(new Map([
      ['content-owner', ownerIdentityId],
      ['content-member', memberIdentityId],
      ...Array.from({ length: 100 }, (_, index) => [
        `existing-${index}`,
        openContentIdentityIdSchema.parse(100 + index)
      ] as const)
    ]))
    const administration = (await createFeature(harness, bindings).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    const first = await administration.listMembers({ root: space.root, page: { limit: 100 } })
    expect(first.items).toHaveLength(100)
    expect(first.nextCursor).toBeDefined()
    const second = await administration.listMembers({
      root: space.root,
      page: { limit: 100, cursor: first.nextCursor }
    })
    expect(second.items).toHaveLength(1)
    expect(harness.listTeamUsers).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: 100
    }))

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(memberIdentityId),
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member: directoryMember(memberIdentityId), role: 'internal' })
    expect(harness.addTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [memberIdentityId]
    })
    await expect(administration.removeMember({
      root: space.root,
      member: directoryMember(memberIdentityId),
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member: directoryMember(memberIdentityId), removed: true })
    expect(harness.removeTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [memberIdentityId]
    })
  })

  it('preserves OpenContent owner, manager, internal, and external Team identities', async () => {
    const harness = teamHarness()
    harness.listTeamUsers.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 4,
      users: [
        { identityId: ownerIdentityId, userType: 3 },
        { identityId: managerIdentityId, userType: 2 },
        { identityId: memberIdentityId, userType: 3 },
        { identityId: externalIdentityId, userType: 4 }
      ]
    })
    const identities = identityBindings(new Map([
      ['content-owner', ownerIdentityId],
      ['content-manager', managerIdentityId],
      ['content-internal', memberIdentityId],
      ['content-external', externalIdentityId]
    ]))
    const administration = (await createFeature(harness, identities).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })).resolves.toMatchObject({
      items: [
        { member: directoryMember(ownerIdentityId), role: 'owner' },
        { member: directoryMember(managerIdentityId), role: 'manager' },
        { member: directoryMember(memberIdentityId), role: 'internal' },
        { member: directoryMember(externalIdentityId), role: 'external' }
      ]
    })
  })

  it('does not silently reinterpret an existing manager as an internal addMember result', async () => {
    const harness = teamHarness()
    harness.listTeamUsers.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 2,
      users: [
        { identityId: ownerIdentityId, userType: 1 },
        { identityId: managerIdentityId, userType: 2 }
      ]
    })
    const identities = identityBindings(new Map([
      ['content-owner', ownerIdentityId],
      ['content-manager', managerIdentityId]
    ]))
    const administration = (await createFeature(harness, identities).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(managerIdentityId),
      expectedRevision: space.revision
    })).rejects.toMatchObject({
      detail: { code: 'conflict', retry: 'after-human-action' }
    })
    expect(harness.addTeamUsers).not.toHaveBeenCalled()
  })
})

function createFeature(
  harness: ReturnType<typeof teamHarness>,
  identities = identityBindings()
) {
  return createOpenContentAdministrationFeature({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    facade: facadeFixture(teamSession(harness.administration)),
    identities
  })
}

function teamSession(administration: OpenContentBoundTeamAdministration) {
  const implementation: OpenContentContentSpaceFacade['useTeamAdministration'] =
    async (_input, operation) => operation({ externalIdentityId: ownerIdentityId, administration })
  return vi.fn(implementation) as unknown as
  OpenContentContentSpaceFacade['useTeamAdministration'] & ReturnType<typeof vi.fn>
}

function facadeFixture(
  useTeamAdministration: OpenContentContentSpaceFacade['useTeamAdministration']
): OpenContentContentSpaceFacade {
  return {
    attestExternalBinding: async (input) => Object.freeze({
      providerInstanceRef: input.providerInstanceRef,
      principal: input.principal,
      externalSubject: 'a'.repeat(64),
      bindingRevision: 'b'.repeat(64)
    }),
    useTeamAdministration,
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    downloadFile: vi.fn()
  }
}

function identityBindings(
  initial = new Map<string, OpenContentIdentityId>([['content-owner', ownerIdentityId]])
): OpenContentIdentityBindingPort {
  const reverse = new Map([...initial].map(([contentUserId, identityId]) => (
    [identityId, contentUserId] as const
  )))
  return {
    resolveContentUserIdentity: async ({ contentUserId }) => {
      const identityId = initial.get(contentUserId)
      if (identityId === undefined) throw new Error(`Missing fixture ${contentUserId}`)
      return identityId
    },
    resolveExternalIdentityContentUser: async ({ externalIdentityId }) => {
      const contentUserId = reverse.get(externalIdentityId)
      if (contentUserId === undefined) throw new Error(`Missing fixture ${externalIdentityId}`)
      return contentUserId
    }
  }
}

function teamHarness(options: Readonly<{
  initiallyEmpty?: boolean
  users?: readonly OpenContentIdentityId[]
}> = {}) {
  let currentOwnerIdentityId = ownerIdentityId
  let team = options.initiallyEmpty
    ? undefined
    : teamValue('Research Team', false, currentOwnerIdentityId)
  const users = new Set(options.users ?? [ownerIdentityId])
  const listTeams = vi.fn<OpenContentBoundTeamAdministration['listTeams']>(async (input) => ({
    pageNumber: input.pageNumber,
    pageSize: input.pageSize,
    totalCount: team === undefined ? 0 : 1,
    teams: team === undefined ? [] : [team]
  }))
  const createTeam = vi.fn<OpenContentBoundTeamAdministration['createTeam']>(async ({ name }) => {
    team = teamValue(name, false, currentOwnerIdentityId)
  })
  const observeTeam = vi.fn<OpenContentBoundTeamAdministration['observeTeam']>(async () => {
    if (!team) throw new Error('missing fixture Team')
    return team
  })
  const editTeam = vi.fn<OpenContentBoundTeamAdministration['editTeam']>(async ({ name }) => {
    if (!team) throw new Error('missing fixture Team')
    team = teamValue(name, team.isStuck, currentOwnerIdentityId)
  })
  const stickTeam = vi.fn<OpenContentBoundTeamAdministration['stickTeam']>(async () => {
    if (!team) throw new Error('missing fixture Team')
    team = teamValue(team.name, true, currentOwnerIdentityId)
  })
  const unstickTeam = vi.fn<OpenContentBoundTeamAdministration['unstickTeam']>(async () => {
    if (!team) throw new Error('missing fixture Team')
    team = teamValue(team.name, false, currentOwnerIdentityId)
  })
  const listTeamUsers = vi.fn<OpenContentBoundTeamAdministration['listTeamUsers']>(
    async ({ pageNumber, pageSize }) => {
      const values = [...users]
      const offset = (pageNumber - 1) * pageSize
      return {
        pageNumber,
        pageSize,
        totalCount: values.length,
        users: values.slice(offset, offset + pageSize).map((identityId) => ({
          identityId,
          userType: identityId === currentOwnerIdentityId ? 1 as const : 3 as const
        })),
        ...(offset + pageSize < values.length ? { nextPage: pageNumber + 1 } : {})
      }
    }
  )
  const addTeamUsers = vi.fn<OpenContentBoundTeamAdministration['addTeamUsers']>(
    async ({ identityIds }) => { identityIds.forEach((identityId) => users.add(identityId)) }
  )
  const removeTeamUsers = vi.fn<OpenContentBoundTeamAdministration['removeTeamUsers']>(
    async ({ identityIds }) => { identityIds.forEach((identityId) => users.delete(identityId)) }
  )
  const resolveTeamRoot = vi.fn<OpenContentBoundTeamAdministration['resolveTeamRoot']>(
    async () => ({ teamId, folderId, folderGuid: rootGuid })
  )
  const transferTeamOwner = vi.fn<OpenContentBoundTeamAdministration['transferTeamOwner']>(
    async ({ ownerIdentityId: nextOwnerIdentityId }) => {
      if (!team) throw new Error('missing fixture Team')
      currentOwnerIdentityId = nextOwnerIdentityId
      users.add(nextOwnerIdentityId)
      team = teamValue(team.name, team.isStuck, currentOwnerIdentityId)
    }
  )
  const administration: OpenContentBoundTeamAdministration = {
    listTeams,
    createTeam,
    observeTeam,
    editTeam,
    stickTeam,
    unstickTeam,
    listTeamUsers,
    addTeamUsers,
    removeTeamUsers,
    resolveTeamRoot,
    setTeamUserRole: vi.fn(),
    transferTeamOwner
  }
  return {
    administration,
    listTeams,
    createTeam,
    observeTeam,
    editTeam,
    stickTeam,
    unstickTeam,
    listTeamUsers,
    addTeamUsers,
    removeTeamUsers,
    resolveTeamRoot,
    transferTeamOwner
  }
}

function teamValue(
  name: string,
  isStuck: boolean,
  currentOwnerIdentityId: OpenContentIdentityId
) {
  return Object.freeze({
    teamId,
    folderId,
    name,
    ownerIdentityId: currentOwnerIdentityId,
    status: 1,
    permission: 15,
    teamType: 2,
    isStuck
  })
}

function directoryMember(identityId: OpenContentIdentityId) {
  return Object.freeze({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    kind: 'user' as const,
    principalId: String(identityId)
  })
}
