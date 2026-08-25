import { describe, expect, it } from 'vitest'

import * as administration from './administration-contract.js'
import { toPortableContentContainerReference } from './contract.js'
import { contentSpaceSearchUsersResultSchema } from './extended-operations-contract.js'

describe('Content Space administration contract', () => {
  it('keeps the Agent create input authority- and invocation-free because Broker context supplies both', () => {
    expect(administration.CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION).toBe('3.0.0')
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

  it('publishes exact ordinary Agent contracts for the provisioning batch', () => {
    expect([
      administration.CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT,
      administration.CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT,
      administration.CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT,
      administration.CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT
    ].map(({ actionId, effect }) => ({ actionId, effect }))).toEqual([
      {
        actionId: 'content-space.authorize-provider-administration',
        effect: 'external-write'
      },
      {
        actionId: 'content-space.agent-admin-create-space',
        effect: 'external-write'
      },
      {
        actionId: 'content-space.agent-admin-list-members',
        effect: 'read'
      },
      {
        actionId: 'content-space.agent-admin-add-member',
        effect: 'external-write'
      }
    ])
    expect(administration.contentSpaceAgentAdministrationListMembersInputSchema.parse({
      page: { limit: 20 }
    })).toEqual({ page: { limit: 20 } })
    expect(() => administration.contentSpaceAgentAdministrationListMembersInputSchema.parse({
      root: toPortableContentContainerReference({
        providerInstanceRef: 'provider-instance-a',
        containerId: 'root-a'
      }),
      page: { limit: 20 }
    })).toThrow()
  })

  it('strictly rejects retired CAS, revision, and role fields', () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const member = directoryUser('provider-user-a')
    const inputCases = [
      [administration.contentSpaceAdministrationUpdateSpaceInputSchema,
        { root, label: 'Renamed Team' }, { expectedRevision: 'revision-1' }],
      [administration.contentSpaceAdministrationPinSpaceInputSchema,
        { root }, { expectedRevision: 'revision-1' }],
      [administration.contentSpaceAdministrationUnpinSpaceInputSchema,
        { root }, { expectedRevision: 'revision-1' }],
      [administration.contentSpaceAdministrationAddMemberInputSchema,
        { root, member }, { expectedRevision: 'revision-1' }],
      [administration.contentSpaceAdministrationRemoveMemberInputSchema,
        { root, member }, { expectedRevision: 'revision-1' }]
    ] as const
    const outputCases = [
      [administration.contentSpaceAdministrationSpaceSummarySchema,
        { root, label: 'Research Team', contentOwnerUserId: 'user-owner', pinned: false },
        { revision: 'revision-1' }],
      [administration.contentSpaceAdministrationRootOpenResultSchema,
        { root }, { revision: 'revision-1' }],
      [administration.contentSpaceAdministrationMemberSummarySchema,
        { member }, { revision: 'revision-1' }],
      [administration.contentSpaceAdministrationMemberSummarySchema,
        { member }, { role: 'internal' }],
      [administration.contentSpaceAdministrationAddMemberReceiptSchema,
        { root, member }, { revision: 'revision-1' }],
      [administration.contentSpaceAdministrationRemoveMemberReceiptSchema,
        { root, member, removed: true }, { revision: 'revision-1' }]
    ] as const

    for (const [schema, current, retired] of [...inputCases, ...outputCases]) {
      expect(schema.safeParse(current).success).toBe(true)
      expect(schema.safeParse({ ...current, ...retired }).success).toBe(false)
    }
  })

  it('validates exact per-operation administration readiness without implicit promotion', () => {
    expect(administration.CONTENT_SPACE_ADMINISTRATION_OPERATIONS).toEqual([
      'list-spaces',
      'create-space',
      'observe-space',
      'update-space',
      'pin-space',
      'unpin-space',
      'open-root',
      'list-members',
      'add-member',
      'remove-member'
    ])
    expect(Object.keys(administration).filter((name) =>
      name.toLowerCase().includes('provision')
    )).toEqual([])
    const exactStates = administration.CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => ({
      operation,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
    }))
    expect(administration.contentSpaceAdministrationOperationStateListSchema.parse(exactStates))
      .toHaveLength(10)
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
      exactStates.map((state) => state.operation === 'remove-member'
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
        pinned: false
      }]
    })
    expect(() => administration.contentSpaceAdministrationSpacePageSchema.parse({
      items: [{
        root,
        label: 'Research space',
        contentOwnerUserId: 'user-owner',
        pinned: false,
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
      label: 'Renamed research space'
    })).resolves.toMatchObject({ label: 'Renamed research space' })
    await expect(port.pinSpace({ root })).resolves.toMatchObject({ pinned: true })
    await expect(port.unpinSpace({ root })).resolves.toMatchObject({ pinned: false })
    await expect(port.openRoot({ root })).resolves.toEqual({ root })
    expect(() => administration.contentSpaceAdministrationUpdateSpaceInputSchema.parse({
      root
    })).toThrow()
    expect(() => administration.contentSpaceAdministrationUpdateSpaceInputSchema.parse({
      root,
      label: 'Renamed research space',
      contentOwnerUserId: 'user-new-owner'
    })).toThrow()
  })

  it('lists, adds, and removes members by Provider directory user identity only', async () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const memberA = directoryUser('provider-user-a')
    const memberB = directoryUser('provider-user-b')
    const port = administrationPortFixture(root)

    await expect(port.listMembers({ root, page: { limit: 25 } })).resolves.toEqual({
      root,
      items: [{ member: memberA }]
    })
    await expect(port.addMember({
      root,
      member: memberB
    })).resolves.toEqual({ root, member: memberB })
    await expect(port.removeMember({
      root,
      member: memberA
    })).resolves.toEqual({
      root,
      member: memberA,
      removed: true
    })
    expect(() => administration.contentSpaceAdministrationAddMemberInputSchema.parse({
      root,
      member: directoryUser('provider-user-c'),
      providerMemberId: 'provider-member-c'
    })).toThrow()
    expect(() => administration.contentSpaceAdministrationMemberSummarySchema.parse({
      member: memberA,
      role: 'internal'
    })).toThrow()
  })

  it('round-trips a searched Provider directory user through member administration', () => {
    const root = toPortableContentContainerReference({
      providerInstanceRef: 'provider-instance-a',
      containerId: 'shared-root-a'
    })
    const searched = contentSpaceSearchUsersResultSchema.parse({
      ok: true,
      value: {
        items: [{
          reference: {
            providerInstanceRef: 'provider-instance-a',
            kind: 'user',
            principalId: 'provider-user-b'
          },
          displayName: 'Researcher B',
          accountName: 'researcher-b'
        }]
      }
    })
    if (!searched.ok) throw new Error('Expected a successful directory search fixture.')
    const member = searched.value.items[0]?.reference
    if (!member) throw new Error('Expected one searched directory user.')
    const addInput: administration.ContentSpaceAdministrationAddMemberInput = {
      root,
      member
    }

    expect(administration.contentSpaceAdministrationAddMemberInputSchema.parse(addInput))
      .toEqual(addInput)
    expect(administration.contentSpaceAdministrationMemberPageSchema.parse({
      root,
      items: [{ member }]
    }).items[0]?.member).toEqual(member)
    expect(administration.contentSpaceAdministrationRemoveMemberInputSchema.parse({
      root,
      member
    }).member).toEqual(member)
    expect(administration.contentSpaceAdministrationAddMemberReceiptSchema.parse({
      root,
      member
    }).member).toEqual(member)
    expect(administration.contentSpaceAdministrationRemoveMemberReceiptSchema.parse({
      root,
      member,
      removed: true
    }).member).toEqual(member)
    expect(administration.contentSpaceAdministrationAddMemberInputSchema.safeParse({
      root,
      contentUserId: 'user-member-b'
    }).success).toBe(false)
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
        root, label: 'Renamed Team'
      }],
      [administration.contentSpaceAdministrationPinSpaceInputSchema, {
        root
      }],
      [administration.contentSpaceAdministrationUnpinSpaceInputSchema, {
        root
      }],
      [administration.contentSpaceAdministrationAddMemberInputSchema, {
        root, member: directoryUser('provider-user')
      }],
      [administration.contentSpaceAdministrationRemoveMemberInputSchema, {
        root, member: directoryUser('provider-user')
      }]
    ] as const

    for (const [schema, input] of cases) {
      expect(schema.safeParse(input).success).toBe(true)
      expect(schema.safeParse({ ...input, ...legacyKey }).success).toBe(false)
    }
  })

  it('does not expose a provider role model for shared-container members', () => {
    expect(Object.keys(administration).filter((name) =>
      name.toLowerCase().includes('memberrole')
    )).toEqual([])
    for (const role of ['owner', 'manager', 'internal', 'external', 'member'] as const) {
      expect(administration.contentSpaceAdministrationMemberSummarySchema.safeParse({
        member: directoryUser(`provider-user-${role}`),
        role
      }).success).toBe(false)
    }
  })

})

function administrationPortFixture(
  root: ReturnType<typeof toPortableContentContainerReference>
): administration.ContentSpaceAdministrationPort {
  const summary = {
    root,
    label: 'Research space',
    contentOwnerUserId: 'user-owner',
    pinned: false
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
      root
    }),
    listMembers: async () => administration.contentSpaceAdministrationMemberPageSchema.parse({
      root,
      items: [{
        member: directoryUser('provider-user-a')
      }]
    }),
    addMember: async (input) => administration.contentSpaceAdministrationAddMemberReceiptSchema
      .parse({
        root,
        member: input.member
      }),
    removeMember: async (input) => administration.contentSpaceAdministrationRemoveMemberReceiptSchema
      .parse({
        root,
        member: input.member,
        removed: true
      })
  })
}

function directoryUser(principalId: string) {
  return Object.freeze({
    providerInstanceRef: 'provider-instance-a',
    kind: 'user' as const,
    principalId
  })
}
