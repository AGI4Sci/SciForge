import { describe, expect, it } from 'vitest'

import * as administration from './administration-contract.js'
import { toPortableContentContainerReference } from './contract.js'

describe('Content Space administration contract', () => {
  it('keeps the Agent create input authority- and invocation-free because Broker context supplies both', () => {
    expect(administration.CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION).toBe('2.0.0')
    const input = { label: 'Research Team' }
    expect(administration.contentSpaceAgentAdministrationCreateSpaceInputSchema.parse(input))
      .toEqual(input)
    expect(() => administration.contentSpaceAgentAdministrationCreateSpaceInputSchema.parse({
      ...input,
      idempotencyKey: 'idem_create_space_0001'
    })).toThrow()
    expect(() => administration.contentSpaceAgentAdministrationCreateSpaceInputSchema.parse({
      ...input,
      contentOwnerUserId: 'caller-selected-owner'
    })).toThrow()
  })

  it('validates exact per-operation administration readiness without implicit promotion', () => {
    expect(administration.CONTENT_SPACE_ADMINISTRATION_OPERATIONS).toHaveLength(11)
    const exactStates = administration.CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => ({
      operation,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
    }))
    expect(administration.contentSpaceAdministrationOperationStateListSchema.parse(exactStates))
      .toHaveLength(11)
    expect(() => administration.contentSpaceAdministrationOperationStateListSchema.parse(
      exactStates.map((state) => state.operation === 'create-space'
        ? {
            ...state,
            readiness: 'poc_only',
            reasonCode: 'available'
          }
        : state)
    )).toThrow()
    expect(() => administration.contentSpaceAdministrationOperationStateListSchema.parse(
      exactStates.map((state) => state.operation === 'provision-project'
        ? {
            operation: 'create-space',
            readiness: 'blocked_by_contract',
            reasonCode: 'provider_contract_missing'
          }
        : state)
    )).toThrow()
    expect(() => administration.contentSpaceAdministrationOperationStateListSchema.parse(
      exactStates.slice(0, -1)
    )).toThrow()
    expect(() => administration.contentSpaceAdministrationOperationStateListSchema.parse([
      ...exactStates.slice(0, -1),
      {
        operation: 'unknown-administration-operation',
        readiness: 'production_ready',
        reasonCode: 'available'
      }
    ])).toThrow()
  })

  it('accepts only a bounded provider-neutral Project provisioning intent', () => {
    const intent = {
      projectId: 'project-alpha',
      projectLabel: 'Alpha research',
      contentOwnerUserId: 'user-owner',
      contentMemberUserIds: ['user-member-a', 'user-member-b'],
      intentRevision: 1,
      idempotencyKey: 'idem_project.alpha.1'
    }

    expect(administration.projectContentSpaceProvisioningIntentSchema.parse(intent))
      .toEqual(intent)
    expect(() => administration.projectContentSpaceProvisioningIntentSchema.parse({
      ...intent,
      contentMemberUserIds: ['user-member-a', 'user-member-a']
    })).toThrow()
    expect(() => administration.projectContentSpaceProvisioningIntentSchema.parse({
      ...intent,
      providerConnection: 'connection-local'
    })).toThrow()
    expect(() => administration.projectContentSpaceProvisioningIntentSchema.parse({
      ...intent,
      coordinatorAgentId: 'agent-coordinator'
    })).toThrow()
  })

  it('reports a ready Project through a portable root and ready member states', () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'project-root-a'
    })
    const report = {
      projectId: 'project-alpha',
      intentRevision: 2,
      status: 'ready' as const,
      root,
      contentOwnerUserId: 'user-owner',
      members: [
        { contentUserId: 'user-member-a', status: 'ready' as const },
        { contentUserId: 'user-member-b', status: 'ready' as const }
      ]
    }

    expect(administration.projectContentSpaceProvisioningReportSchema.parse(report))
      .toEqual(report)
    expect(() => administration.projectContentSpaceProvisioningReportSchema.parse({
      ...report,
      members: [{ contentUserId: 'user-member-a', status: 'pending' }]
    })).toThrow()
    expect(() => administration.projectContentSpaceProvisioningReportSchema.parse({
      ...report,
      providerSpaceId: 'provider-space-a'
    })).toThrow()
  })

  it('lists bounded administration spaces through the public port', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const port = administrationPortFixture(root)

    await expect(port.listSpaces({ page: { limit: 25 } })).resolves.toEqual({
      items: [{
        root,
        label: 'Research space',
        contentOwnerUserId: 'user-owner',
        pinned: false,
        revision: 'revision-1'
      }]
    })
    expect(() => administration.contentSpaceAdministrationSpacePageSchema.parse({
      items: [{
        root,
        label: 'Research space',
        contentOwnerUserId: 'user-owner',
        pinned: false,
        revision: 'revision-1',
        providerSpaceId: 'provider-space-a'
      }]
    })).toThrow()
  })

  it('exposes one bounded lifecycle for creating, observing, updating, pinning, and opening roots', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const port = administrationPortFixture(root)

    await expect(port.createSpace({
      label: 'New research space',
      contentOwnerUserId: 'user-owner'
    })).resolves.toMatchObject({ root, label: 'New research space' })
    await expect(port.observeSpace({ root })).resolves.toMatchObject({ root })
    await expect(port.updateSpace({
      root,
      expectedRevision: 'revision-1',
      label: 'Renamed research space'
    })).resolves.toMatchObject({ label: 'Renamed research space' })
    await expect(port.pinSpace({
      root,
      expectedRevision: 'revision-2'
    })).resolves.toMatchObject({ pinned: true })
    await expect(port.unpinSpace({
      root,
      expectedRevision: 'revision-3'
    })).resolves.toMatchObject({ pinned: false })
    await expect(port.openRoot({ root })).resolves.toEqual({
      root,
      revision: 'revision-4'
    })
    expect(() => administration.contentSpaceAdministrationUpdateSpaceInputSchema.parse({
      root,
      expectedRevision: 'revision-1'
    })).toThrow()
    expect(() => administration.contentSpaceAdministrationUpdateSpaceInputSchema.parse({
      root,
      expectedRevision: 'revision-1',
      label: 'Renamed research space',
      contentOwnerUserId: 'user-new-owner'
    })).toThrow()
  })

  it('lists, adds, and removes members by consumer user identity only', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const port = administrationPortFixture(root)

    await expect(port.listMembers({ root, page: { limit: 25 } })).resolves.toEqual({
      root,
      items: [{ contentUserId: 'user-member-a', role: 'internal', revision: 'member-revision-1' }]
    })
    await expect(port.addMember({
      root,
      contentUserId: 'user-member-b',
      expectedRevision: 'revision-1'
    })).resolves.toMatchObject({ contentUserId: 'user-member-b', role: 'internal' })
    await expect(port.removeMember({
      root,
      contentUserId: 'user-member-a',
      expectedRevision: 'revision-2'
    })).resolves.toEqual({
      root,
      contentUserId: 'user-member-a',
      removed: true,
      revision: 'revision-3'
    })
    expect(() => administration.contentSpaceAdministrationAddMemberInputSchema.parse({
      root,
      contentUserId: 'user-member-c',
      expectedRevision: 'revision-3',
      providerMemberId: 'provider-member-c'
    })).toThrow()
  })

  it('rejects caller-supplied idempotency from every ordinary administration write', () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const legacyKey = { idempotencyKey: 'idem_legacy_business_payload_0001' }
    const cases = [
      [administration.contentSpaceAdministrationCreateSpaceInputSchema, {
        label: 'Research Team', contentOwnerUserId: 'user-owner'
      }],
      [administration.contentSpaceAdministrationUpdateSpaceInputSchema, {
        root, expectedRevision: 'revision-1', label: 'Renamed Team'
      }],
      [administration.contentSpaceAdministrationPinSpaceInputSchema, {
        root, expectedRevision: 'revision-1'
      }],
      [administration.contentSpaceAdministrationUnpinSpaceInputSchema, {
        root, expectedRevision: 'revision-1'
      }],
      [administration.contentSpaceAdministrationAddMemberInputSchema, {
        root, contentUserId: 'user-member', expectedRevision: 'revision-1'
      }],
      [administration.contentSpaceAdministrationRemoveMemberInputSchema, {
        root, contentUserId: 'user-member', expectedRevision: 'revision-1'
      }]
    ] as const

    for (const [schema, input] of cases) {
      expect(schema.safeParse(input).success).toBe(true)
      expect(schema.safeParse({ ...input, ...legacyKey }).success).toBe(false)
    }
  })

  it('keeps all four provider-neutral Team roles and rejects the removed member alias', () => {
    for (const role of ['owner', 'manager', 'internal', 'external'] as const) {
      expect(administration.contentSpaceAdministrationMemberSummarySchema.parse({
        contentUserId: `user-${role}`,
        role,
        revision: `revision-${role}`
      }).role).toBe(role)
    }
    expect(() => administration.contentSpaceAdministrationMemberSummarySchema.parse({
      contentUserId: 'user-old-member',
      role: 'member',
      revision: 'revision-old-member'
    })).toThrow()
  })

  it('exposes Project provisioning as an independent intent-to-report port', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const port = administration.defineProjectContentSpaceProvisioningPort({
      contractVersion: administration.PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
      provisionProjectContentSpace: async (intent) =>
        administration.projectContentSpaceProvisioningReportSchema.parse({
          projectId: intent.projectId,
          intentRevision: intent.intentRevision,
          status: 'ownership_sync_required',
          root,
          contentOwnerUserId: intent.contentOwnerUserId,
          members: intent.contentMemberUserIds.map((contentUserId) => ({
            contentUserId,
            status: 'pending'
          }))
        })
    })

    await expect(port.provisionProjectContentSpace({
      projectId: 'project-alpha',
      projectLabel: 'Alpha research',
      contentOwnerUserId: 'user-owner',
      contentMemberUserIds: ['user-member-a'],
      intentRevision: 3,
      idempotencyKey: 'idem_project.alpha.3'
    })).resolves.toMatchObject({
      projectId: 'project-alpha',
      intentRevision: 3,
      status: 'ownership_sync_required',
      root,
      members: [{ contentUserId: 'user-member-a', status: 'pending' }]
    })
  })

  it.each([
    'pending',
    'failed',
    'ownership_sync_required',
    'broken',
    'outcome_unknown'
  ] as const)('preserves the non-ready Project provisioning state %s', (status) => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    expect(administration.projectContentSpaceProvisioningReportSchema.parse({
      projectId: 'project-alpha',
      intentRevision: 3,
      status,
      ...(status === 'failed' || status === 'outcome_unknown' ? {} : { root }),
      contentOwnerUserId: 'user-owner',
      members: [{ contentUserId: 'user-member-a', status: 'failed' }]
    }).status).toBe(status)
  })

  it.each(['ownership_sync_required', 'broken'] as const)(
    'requires the known portable root when Project provisioning is %s',
    (status) => {
      expect(() => administration.projectContentSpaceProvisioningReportSchema.parse({
        projectId: 'project-alpha',
        intentRevision: 3,
        status,
        contentOwnerUserId: 'user-owner',
        members: []
      })).toThrow()
    }
  )
})

function administrationPortFixture(
  root: ReturnType<typeof toPortableContentContainerReference>
): administration.ContentSpaceAdministrationPort {
  const summary = {
    root,
    label: 'Research space',
    contentOwnerUserId: 'user-owner',
    pinned: false,
    revision: 'revision-1'
  }
  return administration.defineContentSpaceAdministrationPort({
    contractVersion: administration.CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
    listSpaces: async () => administration.contentSpaceAdministrationSpacePageSchema.parse({
      items: [summary]
    }),
    createSpace: async (input) => administration.contentSpaceAdministrationSpaceSummarySchema
      .parse({ ...summary, label: input.label, contentOwnerUserId: input.contentOwnerUserId }),
    observeSpace: async () => administration.contentSpaceAdministrationSpaceSummarySchema
      .parse(summary),
    updateSpace: async (input) => administration.contentSpaceAdministrationSpaceSummarySchema
      .parse({
        ...summary,
        label: input.label
      }),
    pinSpace: async () => administration.contentSpaceAdministrationSpaceSummarySchema.parse({
      ...summary,
      pinned: true
    }),
    unpinSpace: async () => administration.contentSpaceAdministrationSpaceSummarySchema.parse({
      ...summary,
      pinned: false
    }),
    openRoot: async () => administration.contentSpaceAdministrationRootOpenResultSchema.parse({
      root,
      revision: 'revision-4'
    }),
    listMembers: async () => administration.contentSpaceAdministrationMemberPageSchema.parse({
      root,
      items: [{
        contentUserId: 'user-member-a',
        role: 'internal',
        revision: 'member-revision-1'
      }]
    }),
    addMember: async (input) => administration.contentSpaceAdministrationMemberSummarySchema
      .parse({
        contentUserId: input.contentUserId,
        role: 'internal',
        revision: 'member-revision-2'
      }),
    removeMember: async (input) => administration.contentSpaceAdministrationRemoveMemberReceiptSchema
      .parse({
        root,
        contentUserId: input.contentUserId,
        removed: true,
        revision: 'revision-3'
      })
  })
}
