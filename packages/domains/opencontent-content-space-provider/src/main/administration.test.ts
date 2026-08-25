import { describe, expect, it, vi } from 'vitest'

import {
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION
} from '@sciforge/domain-content-space/administration-contract'
import {
  ContentSpaceOperationError,
  toPortableContentContainerReference
} from '@sciforge/domain-content-space/contract'
import type { ContentSpaceProviderOperationContext } from '@sciforge/domain-content-space/contract'
import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type { OpenContentContentSpaceFacade } from '@sciforge/domain-opencontent-connector/main-contract'
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

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'test-opencontent-provider'
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
  it('declares exactly the ten supported administration operations PoC-only', async () => {
    const useTeamAdministration = vi.fn(async () => {
      throw new Error('Readiness description must not open an OpenContent administration session.')
    }) as unknown as OpenContentContentSpaceFacade['useTeamAdministration'] &
      ReturnType<typeof vi.fn>
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(useTeamAdministration)
    })

    const states = await feature.describeOperations(context)

    expect(states.map(({ operation }) => operation))
      .toEqual(CONTENT_SPACE_ADMINISTRATION_OPERATIONS)
    expect(new Set(states.map(({ operation }) => operation)).size).toBe(states.length)
    expect(states).toHaveLength(10)
    expect(states.every(({ readiness, reasonCode }) => (
      readiness === 'poc_only' && reasonCode === 'verification_profile_required'
    ))).toBe(true)
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

  it('binds only the supported Principal-scoped administration port', async () => {
    const harness = teamHarness()
    const useTeamAdministration = teamSession(harness.administration)
    const feature = createOpenContentAdministrationFeature({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      facade: facadeFixture(useTeamAdministration)
    })

    const binding = await feature.bind(context)

    expect(binding.administration.contractVersion)
      .toBe(CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION)
    expect(Object.keys(binding)).toEqual(['administration'])
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
      facade: facadeFixture(useTeamAdministration)
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
        pinned: false
      }]
    })
    const root = listed.items[0]!.root
    await administration.observeSpace({ root })
    await expect(administration.openRoot({ root })).resolves.toEqual({ root })

    const edited = await administration.updateSpace({
      root,
      label: 'Renamed Team'
    })
    expect(edited.label).toBe('Renamed Team')
    expect(harness.editTeam).toHaveBeenCalledWith({
      teamId,
      folderId,
      name: 'Renamed Team'
    })
    const pinned = await administration.pinSpace({ root })
    expect(pinned.pinned).toBe(true)
    const unpinned = await administration.unpinSpace({ root })
    expect(unpinned.pinned).toBe(false)
    expect(harness.stickTeam).toHaveBeenCalledOnce()
    expect(harness.unstickTeam).toHaveBeenCalledOnce()
  })

  it.each([
    ['a non-Team-2 row', { teamType: 3 }],
    ['a row owned by another external identity', { ownerIdentityId: externalIdentityId }]
  ] as const)('does not expose %s through listSpaces', async (_label, drift) => {
    const harness = teamHarness()
    harness.listTeams.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 1,
      teams: [{ ...teamValue('Unowned Team', false, ownerIdentityId), ...drift }]
    })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.listSpaces({ page: { limit: 20 } })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.resolveTeamRoot).not.toHaveBeenCalled()
  })

  it('does not open a Team root from an incomplete Team snapshot', async () => {
    const harness = teamHarness()
    harness.listTeams.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 2,
      teams: [teamValue('Research Team', false, ownerIdentityId)]
    })
    const administration = (await createFeature(harness).bind(context)).administration
    const root = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!.root

    await expect(administration.openRoot({ root })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
  })

  it('updates a Team without simulating Supplier CAS through a local revision comparison', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const root = toPortableContentContainerReference({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: rootGuid
    })

    await expect(administration.updateSpace({
      root,
      label: 'Renamed Without CAS'
    })).resolves.toMatchObject({ root, label: 'Renamed Without CAS' })
    expect(harness.editTeam).toHaveBeenCalledOnce()
  })

  it.each([
    ['a non-Team-2 root', { teamType: 3 }],
    ['a root owned by another external identity', { ownerIdentityId: externalIdentityId }]
  ] as const)('rejects every administration mutation against %s before dispatch', async (
    _label,
    drift
  ) => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: rootGuid
    })
    for (const operation of ['update', 'pin', 'unpin', 'add', 'remove'] as const) {
      const harness = teamHarness({ users: [ownerIdentityId, memberIdentityId] })
      if (operation === 'unpin') {
        await harness.stickTeam({ teamId })
        harness.stickTeam.mockClear()
      }
      const listed = await harness.observeTeam({ teamId })
      harness.listTeams.mockResolvedValue({
        pageNumber: 1,
        pageSize: 100,
        totalCount: 1,
        teams: [{ ...listed, ...drift }]
      })
      const administration = (await createFeature(harness).bind(context)).administration
      const result = operation === 'update'
        ? administration.updateSpace({ root, label: 'Rejected mutation' })
        : operation === 'pin'
          ? administration.pinSpace({ root })
          : operation === 'unpin'
            ? administration.unpinSpace({ root })
            : operation === 'add'
              ? administration.addMember({ root, member: directoryMember(managerIdentityId) })
              : administration.removeMember({ root, member: directoryMember(memberIdentityId) })

      await expect(result).rejects.toMatchObject({
        detail: { code: 'provider_contract_violation', retry: 'never' }
      })
      expect(harness.editTeam).not.toHaveBeenCalled()
      expect(harness.stickTeam).not.toHaveBeenCalled()
      expect(harness.unstickTeam).not.toHaveBeenCalled()
      expect(harness.addTeamUsers).not.toHaveBeenCalled()
      expect(harness.removeTeamUsers).not.toHaveBeenCalled()
    }
  })

  it('reports outcome unknown when Team authority drifts after every dispatched mutation', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: rootGuid
    })
    for (const operation of ['update', 'pin', 'unpin', 'add', 'remove'] as const) {
      const harness = teamHarness({ users: [ownerIdentityId, memberIdentityId] })
      if (operation === 'unpin') {
        await harness.stickTeam({ teamId })
        harness.stickTeam.mockClear()
      }
      const observe = harness.observeTeam.getMockImplementation()
      if (!observe) throw new Error('The Team observe fixture is unavailable.')
      let observation = 0
      harness.observeTeam.mockImplementation(async (input) => {
        const team = await observe(input)
        observation += 1
        return observation === 1 ? team : { ...team, teamType: 3 }
      })
      const administration = (await createFeature(harness).bind(context)).administration
      const result = operation === 'update'
        ? administration.updateSpace({ root, label: 'Authority drift' })
        : operation === 'pin'
          ? administration.pinSpace({ root })
          : operation === 'unpin'
            ? administration.unpinSpace({ root })
            : operation === 'add'
              ? administration.addMember({ root, member: directoryMember(managerIdentityId) })
              : administration.removeMember({ root, member: directoryMember(memberIdentityId) })

      await expect(result).rejects.toMatchObject({
        detail: { code: 'outcome_unknown', retry: 'never' }
      })
      const expectedWrite = {
        update: harness.editTeam,
        pin: harness.stickTeam,
        unpin: harness.unstickTeam,
        add: harness.addTeamUsers,
        remove: harness.removeTeamUsers
      }[operation]
      expect(expectedWrite).toHaveBeenCalledOnce()
    }
  })

  it.each([
    ['team id', { teamId: openContentTeamIdSchema.parse(9000020) }],
    ['folder id', { folderId: openContentFolderIdSchema.parse(9002214) }],
    ['Team type', { teamType: 3 }],
    ['owner', { ownerIdentityId: externalIdentityId }]
  ] as const)('keeps the post-update %s bound to the pre-write Team', async (_label, drift) => {
    const harness = teamHarness()
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    let observation = 0
    harness.observeTeam.mockImplementation(async (input) => {
      const team = await observe(input)
      observation += 1
      return observation === 1 ? team : { ...team, ...drift }
    })
    const administration = (await createFeature(harness).bind(context)).administration
    const root = toPortableContentContainerReference({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      containerId: rootGuid
    })

    await expect(administration.updateSpace({
      root,
      label: 'Post-write drift'
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.editTeam).toHaveBeenCalledOnce()
  })

  it('reports an unknown update outcome when the post-write Team readback fails', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    let observeCount = 0
    harness.observeTeam.mockImplementation(async (input) => {
      observeCount += 1
      if (observeCount === 1) return observe(input)
      throw new OpenContentConnectorError(
        'provider_contract_violation',
        'Synthetic post-update readback drift.'
      )
    })

    await expect(administration.updateSpace({
      root: space.root,
      label: 'Updated Team'
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.editTeam).toHaveBeenCalledOnce()
  })

  it('reports an unknown pin outcome when the post-write Team readback fails', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    let observeCount = 0
    harness.observeTeam.mockImplementation(async (input) => {
      observeCount += 1
      if (observeCount === 1) return observe(input)
      throw new OpenContentConnectorError(
        'provider_unavailable',
        'Synthetic post-pin readback failure.'
      )
    })

    await expect(administration.pinSpace({ root: space.root })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.stickTeam).toHaveBeenCalledOnce()
  })

  it('reports an unknown unpin outcome when the post-write Team readback fails', async () => {
    const harness = teamHarness()
    await harness.stickTeam({ teamId })
    harness.stickTeam.mockClear()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    let observeCount = 0
    harness.observeTeam.mockImplementation(async (input) => {
      observeCount += 1
      if (observeCount === 1) return observe(input)
      throw new OpenContentConnectorError(
        'cancelled',
        'Synthetic post-unpin readback cancellation.'
      )
    })

    await expect(administration.unpinSpace({ root: space.root })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.unstickTeam).toHaveBeenCalledOnce()
  })

  it('preserves a read failure classification when updateSpace dispatches no write', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    harness.observeTeam
      .mockImplementationOnce(observe)
      .mockRejectedValueOnce(new OpenContentConnectorError(
        'provider_unavailable',
        'Synthetic no-op update read failure.'
      ))

    await expect(administration.updateSpace({
      root: space.root,
      label: space.label
    })).rejects.toMatchObject({
      detail: { code: 'provider_unavailable', retry: 'safe-with-same-invocation' }
    })
    expect(harness.editTeam).not.toHaveBeenCalled()
  })

  it('preserves a read failure classification when pinSpace dispatches no write', async () => {
    const harness = teamHarness()
    await harness.stickTeam({ teamId })
    harness.stickTeam.mockClear()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    harness.observeTeam
      .mockImplementationOnce(observe)
      .mockRejectedValueOnce(new OpenContentConnectorError(
        'provider_unavailable',
        'Synthetic no-op pin read failure.'
      ))

    await expect(administration.pinSpace({ root: space.root })).rejects.toMatchObject({
      detail: { code: 'provider_unavailable', retry: 'safe-with-same-invocation' }
    })
    expect(harness.stickTeam).not.toHaveBeenCalled()
  })

  it('preserves a read failure classification when unpinSpace dispatches no write', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const observe = harness.observeTeam.getMockImplementation()
    if (!observe) throw new Error('The Team observe fixture is unavailable.')
    harness.observeTeam
      .mockImplementationOnce(observe)
      .mockRejectedValueOnce(new OpenContentConnectorError(
        'provider_unavailable',
        'Synthetic no-op unpin read failure.'
      ))

    await expect(administration.unpinSpace({ root: space.root })).rejects.toMatchObject({
      detail: { code: 'provider_unavailable', retry: 'safe-with-same-invocation' }
    })
    expect(harness.unstickTeam).not.toHaveBeenCalled()
  })

  it('keeps the observed owner unchanged through the administration update path', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    await expect(administration.updateSpace({
      root: space.root,
      label: 'Renamed Without Owner Transfer'
    })).resolves.toMatchObject({
      label: 'Renamed Without Owner Transfer',
      contentOwnerUserId: 'content-owner'
    })
  })

  it('creates a previously absent Team for the verified current Principal and reads it back', async () => {
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
  })

  it('rejects an incomplete Team snapshot before dispatching CreateTeam', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    harness.listTeams.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 1,
      teams: []
    })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Unproven Research Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.createTeam).not.toHaveBeenCalled()
  })

  it('rejects Team pagination total drift before dispatching CreateTeam', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...teamValue(`Other Team ${index}`, false, ownerIdentityId),
      teamId: openContentTeamIdSchema.parse(1_000 + index),
      folderId: openContentFolderIdSchema.parse(2_000 + index)
    }))
    harness.listTeams.mockImplementation(async ({ pageNumber, pageSize }) => pageNumber === 1
      ? {
          pageNumber,
          pageSize,
          totalCount: 101,
          teams: firstPage,
          nextPage: 2
        }
      : {
          pageNumber,
          pageSize,
          totalCount: 102,
          teams: [{
            ...teamValue('Drifting Team', false, ownerIdentityId),
            teamId: openContentTeamIdSchema.parse(3_000),
            folderId: openContentFolderIdSchema.parse(4_000)
          }]
        })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Unproven Research Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.createTeam).not.toHaveBeenCalled()
  })

  it('rejects duplicate Team identities before dispatching CreateTeam', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    const duplicate = teamValue('Other Team', false, ownerIdentityId)
    harness.listTeams.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 2,
      teams: [duplicate, duplicate]
    })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Unproven Research Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.createTeam).not.toHaveBeenCalled()
  })

  it('reports an unknown create outcome when the post-write Team snapshot is incomplete', async () => {
    const harness = teamHarness({ initiallyEmpty: true })
    let teamRead = 0
    harness.listTeams.mockImplementation(async ({ pageNumber, pageSize }) => {
      teamRead += 1
      return {
        pageNumber,
        pageSize,
        totalCount: teamRead === 1 ? 0 : 1,
        teams: []
      }
    })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Unproven Created Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.createTeam).toHaveBeenCalledOnce()
  })

  it('returns a conflict without adopting an existing same-label Team as a new root', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Research Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'conflict', retry: 'after-human-action' }
    })
    expect(harness.createTeam).not.toHaveBeenCalled()
    expect(harness.observeTeam).not.toHaveBeenCalled()
    expect(harness.resolveTeamRoot).not.toHaveBeenCalled()
  })

  it('does not retry or reconcile an uncertain CreateTeam result by its label', async () => {
    const harness = teamHarness({ initiallyEmpty: true, createOutcomeUnknown: true })
    const administration = (await createFeature(harness).bind(context)).administration

    await expect(administration.createSpace({
      label: 'Uncertain Research Team',
      contentOwnerUserId: principal.subject
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.createTeam).toHaveBeenCalledOnce()
    expect(harness.listTeams).toHaveBeenCalledOnce()
    expect(harness.observeTeam).not.toHaveBeenCalled()
    expect(harness.resolveTeamRoot).not.toHaveBeenCalled()
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
      member
    })).resolves.toEqual({ root: space.root, member })

    const listed = await administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })
    const listedMember = listed.items.find((item) => item.member.principalId === member.principalId)
    expect(listedMember).toEqual({ member })

    await expect(administration.removeMember({
      root: space.root,
      member: listedMember!.member
    })).resolves.toMatchObject({ member, removed: true })
    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })).resolves.not.toMatchObject({
      items: [expect.objectContaining({ member })]
    })
  })

  it('rejects an incomplete member snapshot before dispatching an add', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    harness.listTeamUsers.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 2,
      users: [{ identityId: ownerIdentityId, userType: 1 }]
    })

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.addTeamUsers).not.toHaveBeenCalled()
  })

  it('rejects member pagination total drift before dispatching an add', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const firstPage = [
      { identityId: ownerIdentityId, userType: 1 as const },
      ...Array.from({ length: 99 }, (_, index) => ({
        identityId: openContentIdentityIdSchema.parse(1_000 + index),
        userType: 3 as const
      }))
    ]
    harness.listTeamUsers.mockImplementation(async ({ pageNumber, pageSize }) => pageNumber === 1
      ? {
          pageNumber,
          pageSize,
          totalCount: 101,
          users: firstPage,
          nextPage: 2
        }
      : {
          pageNumber,
          pageSize,
          totalCount: 102,
          users: [{ identityId: openContentIdentityIdSchema.parse(2_000), userType: 3 }]
        })

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.addTeamUsers).not.toHaveBeenCalled()
  })

  it('rejects duplicate member identities before dispatching an add', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    harness.listTeamUsers.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 2,
      users: [
        { identityId: ownerIdentityId, userType: 1 },
        { identityId: ownerIdentityId, userType: 1 }
      ]
    })

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.addTeamUsers).not.toHaveBeenCalled()
  })

  it('rejects an incomplete member snapshot before dispatching a remove', async () => {
    const harness = teamHarness({ users: [ownerIdentityId, memberIdentityId] })
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    harness.listTeamUsers.mockResolvedValue({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 3,
      users: [
        { identityId: ownerIdentityId, userType: 1 },
        { identityId: memberIdentityId, userType: 3 }
      ]
    })

    await expect(administration.removeMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.removeTeamUsers).not.toHaveBeenCalled()
  })

  it('rejects member pagination total drift before dispatching a remove', async () => {
    const harness = teamHarness({ users: [ownerIdentityId, memberIdentityId] })
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const firstPage = [
      { identityId: ownerIdentityId, userType: 1 as const },
      { identityId: memberIdentityId, userType: 3 as const },
      ...Array.from({ length: 98 }, (_, index) => ({
        identityId: openContentIdentityIdSchema.parse(1_000 + index),
        userType: 3 as const
      }))
    ]
    harness.listTeamUsers.mockImplementation(async ({ pageNumber, pageSize }) => pageNumber === 1
      ? {
          pageNumber,
          pageSize,
          totalCount: 101,
          users: firstPage,
          nextPage: 2
        }
      : {
          pageNumber,
          pageSize,
          totalCount: 102,
          users: [{ identityId: openContentIdentityIdSchema.parse(2_000), userType: 3 }]
        })

    await expect(administration.removeMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(harness.removeTeamUsers).not.toHaveBeenCalled()
  })

  it('reports an unknown add outcome without another write when member pagination drifts', async () => {
    const harness = teamHarness()
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const fullFirstPage = [
      { identityId: ownerIdentityId, userType: 1 as const },
      { identityId: memberIdentityId, userType: 3 as const },
      ...Array.from({ length: 98 }, (_, index) => ({
        identityId: openContentIdentityIdSchema.parse(1_000 + index),
        userType: 3 as const
      }))
    ]
    let memberRead = 0
    harness.listTeamUsers.mockImplementation(async ({ pageNumber, pageSize }) => {
      memberRead += 1
      if (memberRead === 1) {
        return {
          pageNumber,
          pageSize,
          totalCount: 1,
          users: [{ identityId: ownerIdentityId, userType: 1 }]
        }
      }
      if (pageNumber === 1) {
        return {
          pageNumber,
          pageSize,
          totalCount: 101,
          users: fullFirstPage,
          nextPage: 2
        }
      }
      return {
        pageNumber,
        pageSize,
        totalCount: 102,
        users: [
          { identityId: openContentIdentityIdSchema.parse(2_000), userType: 3 },
          { identityId: openContentIdentityIdSchema.parse(2_001), userType: 3 }
        ]
      }
    })

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.addTeamUsers).toHaveBeenCalledOnce()
  })

  it('reports an unknown remove outcome without another write when member pagination drifts', async () => {
    const harness = teamHarness({ users: [ownerIdentityId, memberIdentityId] })
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!
    const fullFirstPage = [
      { identityId: ownerIdentityId, userType: 1 as const },
      ...Array.from({ length: 99 }, (_, index) => ({
        identityId: openContentIdentityIdSchema.parse(1_000 + index),
        userType: 3 as const
      }))
    ]
    let memberRead = 0
    harness.listTeamUsers.mockImplementation(async ({ pageNumber, pageSize }) => {
      memberRead += 1
      if (memberRead === 1) {
        return {
          pageNumber,
          pageSize,
          totalCount: 2,
          users: [
            { identityId: ownerIdentityId, userType: 1 },
            { identityId: memberIdentityId, userType: 3 }
          ]
        }
      }
      if (pageNumber === 1) {
        return {
          pageNumber,
          pageSize,
          totalCount: 101,
          users: fullFirstPage,
          nextPage: 2
        }
      }
      return {
        pageNumber,
        pageSize,
        totalCount: 102,
        users: [
          { identityId: openContentIdentityIdSchema.parse(2_000), userType: 3 },
          { identityId: openContentIdentityIdSchema.parse(2_001), userType: 3 }
        ]
      }
    })

    await expect(administration.removeMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).rejects.toMatchObject({
      detail: { code: 'outcome_unknown', retry: 'never' }
    })
    expect(harness.removeTeamUsers).toHaveBeenCalledOnce()
  })

  it('paginates members in provider batches and verifies add and remove writes', async () => {
    const harness = teamHarness({
      users: [ownerIdentityId, ...Array.from({ length: 100 }, (_, index) => (
        openContentIdentityIdSchema.parse(100 + index)
      ))]
    })
    const administration = (await createFeature(harness).bind(context)).administration
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
      member: directoryMember(memberIdentityId)
    })).resolves.toEqual({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })
    expect(harness.addTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [memberIdentityId]
    })
    await expect(administration.removeMember({
      root: space.root,
      member: directoryMember(memberIdentityId)
    })).resolves.toMatchObject({ member: directoryMember(memberIdentityId), removed: true })
    expect(harness.removeTeamUsers).toHaveBeenCalledWith({
      teamId,
      identityIds: [memberIdentityId]
    })
  })

  it('projects every valid OpenContent member without exposing its Provider role', async () => {
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
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 20 }
    })).resolves.toEqual({
      root: space.root,
      items: [
        { member: directoryMember(ownerIdentityId) },
        { member: directoryMember(managerIdentityId) },
        { member: directoryMember(memberIdentityId) },
        { member: directoryMember(externalIdentityId) }
      ]
    })
  })

  it('treats an existing valid member as present without changing its Provider role', async () => {
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
    const administration = (await createFeature(harness).bind(context)).administration
    const space = (await administration.listSpaces({ page: { limit: 20 } })).items[0]!

    await expect(administration.addMember({
      root: space.root,
      member: directoryMember(managerIdentityId)
    })).resolves.toEqual({
      root: space.root,
      member: directoryMember(managerIdentityId)
    })
    expect(harness.addTeamUsers).not.toHaveBeenCalled()
  })
})

function createFeature(
  harness: ReturnType<typeof teamHarness>
) {
  return createOpenContentAdministrationFeature({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    facade: facadeFixture(teamSession(harness.administration))
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
    useHierarchyProofSession: vi.fn(),
    listRootFolders: vi.fn(),
    listFolderEntries: vi.fn(),
    observeEntry: vi.fn(),
    createFolder: vi.fn(),
    uploadNewFile: vi.fn(),
    authorizeDownload: vi.fn()
  }
}

function teamHarness(options: Readonly<{
  initiallyEmpty?: boolean
  createOutcomeUnknown?: boolean
  users?: readonly OpenContentIdentityId[]
}> = {}) {
  const currentOwnerIdentityId = ownerIdentityId
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
    if (options.createOutcomeUnknown) {
      throw new OpenContentConnectorError('outcome_unknown', 'uncertain CreateTeam result')
    }
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
    resolveTeamRoot
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
    resolveTeamRoot
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
