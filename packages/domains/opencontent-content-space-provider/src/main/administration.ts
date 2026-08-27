import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  contentSpaceAdministrationAddMemberReceiptSchema,
  contentSpaceAdministrationMemberReferenceSchema,
  contentSpaceAdministrationMemberPageSchema,
  contentSpaceAdministrationMemberSummarySchema,
  contentSpaceAdministrationOperationStateListSchema,
  contentSpaceAdministrationRemoveMemberReceiptSchema,
  contentSpaceAdministrationRootOpenResultSchema,
  contentSpaceAdministrationSpacePageSchema,
  contentSpaceAdministrationSpaceSummarySchema,
  defineContentSpaceAdministrationPort,
  type ContentSpaceAdministrationPort
} from '@sciforge/domain-content-space/administration-contract'
import {
  ContentSpaceOperationError,
  contentSpacePageRequestSchema,
  parsePortableContentContainerReference,
  toPortableContentContainerReference,
  type ContentSpaceProviderOperationContext
} from '@sciforge/domain-content-space/contract'
import type {
  ContentSpaceAdministrationFeature,
  ContentSpaceProviderAdministrationBinding
} from '@sciforge/domain-content-space/provider-features'
import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type { OpenContentContentSpaceFacade } from '@sciforge/domain-opencontent-connector/main-contract'
import {
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId,
  type OpenContentTeam,
  type OpenContentTeamRoot,
  type OpenContentTeamUser
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  OpenContentIdentityBindingError,
  createCurrentPrincipalOpenContentIdentityBinding
} from './identity-binding.js'
import { parseOpenContentDirectoryIdentity } from './directory-principal.js'
import { toOpenContentExpectedBinding } from './external-binding.js'
import {
  listCompleteOpenContentTeams,
  listCompleteOpenContentTeamUsers
} from './team-pagination.js'
import {
  assertOpenContentTeamAdministrationAuthority,
  assertOpenContentTeamObservation,
  findOpenContentTeamByRoot,
  resolveOpenContentTeamRoot
} from './team-resolution.js'
import { observeAfterOpenContentTeamMutation } from './team-mutation.js'

const MAX_PAGES = 10_000
const TEAM_CURSOR = /^oct_(\d+)_(\d+)$/u
const MEMBER_CURSOR = /^ocm_(\d+)_(\d+)$/u
const OPENCONTENT_ADMINISTRATION_OPERATION_STATES =
  contentSpaceAdministrationOperationStateListSchema.parse(
    CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => ({
      operation,
      readiness: 'poc_only' as const,
      reasonCode: 'runtime_authorization_required' as const
    }))
  )

type ProviderCursor = Readonly<{ pageNumber: number; offset: number }>
type BoundSession = Readonly<{
  externalIdentityId: OpenContentIdentityId
  administration: OpenContentBoundTeamAdministration
}>

export function createOpenContentAdministrationFeature(options: Readonly<{
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
}>): ContentSpaceAdministrationFeature {
  return Object.freeze({
    describeOperations: (context) => {
      assertProviderInstance(context.providerInstanceRef, options.providerInstanceRef)
      return OPENCONTENT_ADMINISTRATION_OPERATION_STATES
    },
    bind: (context): ContentSpaceProviderAdministrationBinding => {
      assertProviderInstance(context.providerInstanceRef, options.providerInstanceRef)
      return Object.freeze({
        administration: createBoundAdministrationPort({
          context,
          providerInstanceRef: options.providerInstanceRef,
          facade: options.facade
        })
      })
    }
  })
}

function createBoundAdministrationPort(options: Readonly<{
  context: ContentSpaceProviderOperationContext
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
}>): ContentSpaceAdministrationPort {
  const identities = createCurrentPrincipalOpenContentIdentityBinding()
  const withSession = async <Value>(
    operation: (session: BoundSession) => Value | Promise<Value>
  ): Promise<Value> => {
    try {
      assertProviderInstance(options.context.providerInstanceRef, options.providerInstanceRef)
      return await options.facade.useTeamAdministration({
        principal: options.context.principal,
        providerInstanceRef: options.context.providerInstanceRef,
        ...toOpenContentExpectedBinding(options.context),
        signal: options.context.signal,
        assertPrincipalCurrent: options.context.assertPrincipalCurrent
      }, operation)
    } catch (error) {
      throw mapAdministrationError(error)
    }
  }

  const observe = async (
    session: BoundSession,
    rawRoot: unknown
  ): Promise<Readonly<{ team: OpenContentTeam; root: OpenContentTeamRoot }>> => {
    const expectedRoot = parseRoot(rawRoot, options.providerInstanceRef)
    const match = await findOpenContentTeamByRoot(
      session.administration,
      expectedRoot.containerId,
      session.externalIdentityId,
      options.context.signal
    )
    if (!match) throw operationError('invalid_reference', 'The Team root does not exist.', 'never')
    const team = await session.administration.observeTeam(withSignal(options.context, {
      teamId: match.team.teamId
    }))
    assertOpenContentTeamObservation(team, match.team)
    return Object.freeze({ team, root: match.root })
  }

  const summary = async (
    session: BoundSession,
    team: OpenContentTeam,
    knownRoot?: OpenContentTeamRoot
  ) => {
    assertOpenContentTeamAdministrationAuthority(team, session.externalIdentityId)
    const root = knownRoot ?? await resolveOpenContentTeamRoot(
      session.administration,
      team,
      session.externalIdentityId,
      options.context.signal
    )
    const contentOwnerUserId = await identities.resolveExternalIdentityContentUser({
      externalIdentityId: team.ownerIdentityId,
      ...identityContext(options.context, session.externalIdentityId)
    })
    return contentSpaceAdministrationSpaceSummarySchema.parse({
      root: toPortableContentContainerReference({
        providerInstanceRef: options.providerInstanceRef,
        containerId: root.folderGuid
      }),
      label: team.name,
      contentOwnerUserId,
      pinned: team.isStuck
    })
  }

  return defineContentSpaceAdministrationPort({
    contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
    listSpaces: async ({ page: rawPage }) => withSession(async (session) => {
      const page = contentSpacePageRequestSchema.parse(rawPage)
      let cursor = parseCursor(rawPage.cursor, TEAM_CURSOR)
      const items = []
      let nextCursor: ProviderCursor | undefined
      for (let pages = 0; pages < MAX_PAGES && items.length < page.limit; pages += 1) {
        const providerPage = await session.administration.listTeams(withSignal(options.context, {
          pageNumber: cursor.pageNumber,
          pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
          teamType: 2 as const
        }))
        providerPage.teams.forEach((team) => {
          assertOpenContentTeamAdministrationAuthority(team, session.externalIdentityId)
        })
        if (cursor.offset > providerPage.teams.length) throw connectorError('provider_contract_violation')
        const available = providerPage.teams.slice(cursor.offset)
        const selected = available.slice(0, page.limit - items.length)
        for (const team of selected) items.push(await summary(session, team))
        const consumed = cursor.offset + selected.length
        if (consumed < providerPage.teams.length) {
          nextCursor = { pageNumber: cursor.pageNumber, offset: consumed }
          break
        }
        if (providerPage.nextPage === undefined) {
          nextCursor = undefined
          break
        }
        if (providerPage.nextPage !== cursor.pageNumber + 1) {
          throw connectorError('provider_contract_violation')
        }
        nextCursor = { pageNumber: providerPage.nextPage, offset: 0 }
        cursor = nextCursor
      }
      if (items.length < page.limit && nextCursor !== undefined) {
        throw connectorError('bounds_exceeded')
      }
      return contentSpaceAdministrationSpacePageSchema.parse({
        items,
        ...(nextCursor === undefined ? {} : { nextCursor: formatCursor('oct', nextCursor) })
      })
    }),
    createSpace: async (input) => withSession(async (session) => {
      const ownerIdentityId = await identities.resolveContentUserIdentity({
        contentUserId: input.contentOwnerUserId,
        ...identityContext(options.context, session.externalIdentityId)
      })
      if (ownerIdentityId !== session.externalIdentityId) {
        throw operationError(
          'blocked_by_contract',
          'Stage 1 creates an OpenContent Team only with the verified current Principal as owner.',
          'after-human-action'
        )
      }
      const existingMatches = await findTeamsByName(
        session.administration,
        input.label,
        session.externalIdentityId,
        options.context
      )
      if (existingMatches.length > 0) throw connectorError('conflict')
      await session.administration.createTeam(withSignal(options.context, { name: input.label }))
      return observeAfterOpenContentTeamMutation(async () => {
        const matches = await findTeamsByName(
          session.administration,
          input.label,
          session.externalIdentityId,
          options.context
        )
        if (matches.length !== 1) throw connectorError('outcome_unknown')
        const listed = matches[0]
        if (!listed) throw connectorError('outcome_unknown')
        const team = await session.administration.observeTeam(withSignal(options.context, {
          teamId: listed.teamId
        }))
        assertOpenContentTeamObservation(team, listed)
        if (team.ownerIdentityId !== ownerIdentityId) throw connectorError('outcome_unknown')
        return summary(session, team)
      })
    }),
    observeSpace: async ({ root }) => withSession(async (session) => {
      const observed = await observe(session, root)
      return summary(session, observed.team, observed.root)
    }),
    updateSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      if (input.label !== observed.team.name) {
        await session.administration.editTeam(withSignal(options.context, {
          teamId: observed.team.teamId,
          folderId: observed.team.folderId,
          name: input.label
        }))
        return observeAfterOpenContentTeamMutation(async () => {
          const team = await session.administration.observeTeam(withSignal(options.context, {
            teamId: observed.team.teamId
          }))
          assertOpenContentTeamObservation(team, observed.team)
          if (team.name !== input.label) throw connectorError('outcome_unknown')
          return summary(session, team, observed.root)
        })
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      assertOpenContentTeamObservation(team, observed.team)
      if (team.name !== input.label) {
        throw connectorError('outcome_unknown')
      }
      return summary(session, team, observed.root)
    }),
    pinSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      if (!observed.team.isStuck) {
        await session.administration.stickTeam(withSignal(options.context, {
          teamId: observed.team.teamId
        }))
        return observeAfterOpenContentTeamMutation(async () => {
          const team = await session.administration.observeTeam(withSignal(options.context, {
            teamId: observed.team.teamId
          }))
          assertOpenContentTeamObservation(team, observed.team)
          if (!team.isStuck) throw connectorError('outcome_unknown')
          return summary(session, team, observed.root)
        })
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      assertOpenContentTeamObservation(team, observed.team)
      if (!team.isStuck) throw connectorError('outcome_unknown')
      return summary(session, team, observed.root)
    }),
    unpinSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      if (observed.team.isStuck) {
        await session.administration.unstickTeam(withSignal(options.context, {
          teamId: observed.team.teamId
        }))
        return observeAfterOpenContentTeamMutation(async () => {
          const team = await session.administration.observeTeam(withSignal(options.context, {
            teamId: observed.team.teamId
          }))
          assertOpenContentTeamObservation(team, observed.team)
          if (team.isStuck) throw connectorError('outcome_unknown')
          return summary(session, team, observed.root)
        })
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      assertOpenContentTeamObservation(team, observed.team)
      if (team.isStuck) throw connectorError('outcome_unknown')
      return summary(session, team, observed.root)
    }),
    openRoot: async ({ root }) => withSession(async (session) => {
      const observed = await observe(session, root)
      return contentSpaceAdministrationRootOpenResultSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        })
      })
    }),
    listMembers: async ({ root, page: rawPage }) => withSession(async (session) => {
      const page = contentSpacePageRequestSchema.parse(rawPage)
      const observed = await observe(session, root)
      let cursor = parseCursor(rawPage.cursor, MEMBER_CURSOR)
      const items = []
      let nextCursor: ProviderCursor | undefined
      for (let pages = 0; pages < MAX_PAGES && items.length < page.limit; pages += 1) {
        const providerPage = await session.administration.listTeamUsers(withSignal(options.context, {
          teamId: observed.team.teamId,
          pageNumber: cursor.pageNumber,
          pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX
        }))
        if (cursor.offset > providerPage.users.length) throw connectorError('provider_contract_violation')
        const available = providerPage.users.slice(cursor.offset)
        const selected = available.slice(0, page.limit - items.length)
        for (const user of selected) {
          items.push(memberSummary(
            options.providerInstanceRef,
            user
          ))
        }
        const consumed = cursor.offset + selected.length
        if (consumed < providerPage.users.length) {
          nextCursor = { pageNumber: cursor.pageNumber, offset: consumed }
          break
        }
        if (providerPage.nextPage === undefined) {
          nextCursor = undefined
          break
        }
        if (providerPage.nextPage !== cursor.pageNumber + 1) {
          throw connectorError('provider_contract_violation')
        }
        nextCursor = { pageNumber: providerPage.nextPage, offset: 0 }
        cursor = nextCursor
      }
      if (items.length < page.limit && nextCursor !== undefined) {
        throw connectorError('bounds_exceeded')
      }
      return contentSpaceAdministrationMemberPageSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        }),
        items,
        ...(nextCursor === undefined ? {} : { nextCursor: formatCursor('ocm', nextCursor) })
      })
    }),
    addMember: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      const identityId = parseDirectoryMemberIdentity(
        input.member,
        options.providerInstanceRef
      )
      let users = await listCompleteOpenContentTeamUsers(session.administration, {
        teamId: observed.team.teamId,
        ...(options.context.signal === undefined ? {} : { signal: options.context.signal })
      })
      let addedUser = users.find((user) => user.identityId === identityId)
      if (!addedUser) {
        await session.administration.addTeamUsers(withSignal(options.context, {
          teamId: observed.team.teamId,
          identityIds: [identityId]
        }))
        addedUser = await observeAfterOpenContentTeamMutation(async () => {
          const team = await session.administration.observeTeam(withSignal(options.context, {
            teamId: observed.team.teamId
          }))
          assertOpenContentTeamObservation(team, observed.team)
          users = await listCompleteOpenContentTeamUsers(session.administration, {
            teamId: observed.team.teamId,
            ...(options.context.signal === undefined ? {} : { signal: options.context.signal })
          })
          const reconciled = users.find((user) => user.identityId === identityId)
          if (!reconciled) {
            throw connectorError('outcome_unknown')
          }
          return reconciled
        })
      }
      return contentSpaceAdministrationAddMemberReceiptSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        }),
        member: input.member
      })
    }),
    removeMember: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      const identityId = parseDirectoryMemberIdentity(
        input.member,
        options.providerInstanceRef
      )
      if (identityId === observed.team.ownerIdentityId) {
        throw operationError(
          'blocked_by_contract',
          'The OpenContent Team owner cannot be removed as a member.',
          'after-human-action'
        )
      }
      let users = await listCompleteOpenContentTeamUsers(session.administration, {
        teamId: observed.team.teamId,
        ...(options.context.signal === undefined ? {} : { signal: options.context.signal })
      })
      if (users.some((user) => user.identityId === identityId)) {
        await session.administration.removeTeamUsers(withSignal(options.context, {
          teamId: observed.team.teamId,
          identityIds: [identityId]
        }))
        await observeAfterOpenContentTeamMutation(async () => {
          const team = await session.administration.observeTeam(withSignal(options.context, {
            teamId: observed.team.teamId
          }))
          assertOpenContentTeamObservation(team, observed.team)
          users = await listCompleteOpenContentTeamUsers(session.administration, {
            teamId: observed.team.teamId,
            ...(options.context.signal === undefined ? {} : { signal: options.context.signal })
          })
          if (users.some((user) => user.identityId === identityId)) {
            throw connectorError('outcome_unknown')
          }
        })
      }
      return contentSpaceAdministrationRemoveMemberReceiptSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        }),
        member: input.member,
        removed: true
      })
    })
  })
}

async function findTeamsByName(
  administration: OpenContentBoundTeamAdministration,
  name: string,
  currentOwnerIdentityId: OpenContentIdentityId,
  context: ContentSpaceProviderOperationContext
): Promise<readonly OpenContentTeam[]> {
  const teams = await listCompleteOpenContentTeams(administration, {
    teamType: 2,
    keyword: name,
    ...(context.signal === undefined ? {} : { signal: context.signal })
  })
  teams.forEach((team) => {
    assertOpenContentTeamAdministrationAuthority(team, currentOwnerIdentityId)
  })
  return Object.freeze(teams.filter((team) => team.name === name))
}

function memberSummary(
  providerInstanceRef: string,
  user: OpenContentTeamUser
) {
  return contentSpaceAdministrationMemberSummarySchema.parse({
    member: {
      providerInstanceRef,
      kind: 'user',
      principalId: String(user.identityId)
    }
  })
}

function parseDirectoryMemberIdentity(
  rawMember: unknown,
  providerInstanceRef: string
): OpenContentIdentityId {
  const member = contentSpaceAdministrationMemberReferenceSchema.safeParse(rawMember)
  if (!member.success || member.data.providerInstanceRef !== providerInstanceRef) {
    throw operationError(
      'invalid_reference',
      'The OpenContent directory member reference is invalid.',
      'never'
    )
  }
  const identityId = parseOpenContentDirectoryIdentity(member.data.principalId)
  if (identityId === undefined) {
    throw operationError(
      'invalid_reference',
      'The OpenContent directory member reference is unavailable.',
      'never'
    )
  }
  return identityId
}

function identityContext(
  context: ContentSpaceProviderOperationContext,
  currentExternalIdentityId: OpenContentIdentityId
) {
  return {
    principal: context.principal,
    providerInstanceRef: context.providerInstanceRef,
    currentExternalIdentityId,
    ...(context.signal === undefined ? {} : { signal: context.signal })
  }
}

function parseRoot(rawRoot: unknown, providerInstanceRef: string) {
  let root
  try {
    root = parsePortableContentContainerReference(rawRoot)
  } catch {
    throw operationError('invalid_reference', 'The Team root reference is invalid.', 'never')
  }
  assertProviderInstance(root.providerInstanceRef, providerInstanceRef)
  return root
}

function parseCursor(rawCursor: string | undefined, pattern: RegExp): ProviderCursor {
  if (rawCursor === undefined) return { pageNumber: 1, offset: 0 }
  const match = pattern.exec(rawCursor)
  if (!match) throw operationError('invalid_input', 'The administration cursor is invalid.', 'never')
  const pageNumber = Number(match[1])
  const offset = Number(match[2])
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 100_000 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset >= OPENCONTENT_TEAM_PAGE_SIZE_MAX) {
    throw operationError('invalid_input', 'The administration cursor is invalid.', 'never')
  }
  return { pageNumber, offset }
}

function formatCursor(prefix: 'oct' | 'ocm', cursor: ProviderCursor): string {
  return `${prefix}_${cursor.pageNumber}_${cursor.offset}`
}

function withSignal<Input extends object>(
  context: ContentSpaceProviderOperationContext,
  input: Input
): Input & Readonly<{ signal?: AbortSignal }> {
  return {
    ...input,
    ...(context.signal === undefined ? {} : { signal: context.signal })
  }
}

function assertProviderInstance(actual: string, expected: string): void {
  if (actual !== expected) {
    throw operationError('invalid_input', 'The OpenContent Provider Instance does not match.', 'never')
  }
}

function mapAdministrationError(error: unknown): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof OpenContentIdentityBindingError) {
    return operationError(
      'unauthorized',
      'A verified OpenContent identity binding is required for this member.',
      'after-human-action'
    )
  }
  if (error instanceof OpenContentConnectorError) {
    const mapping = {
      invalid_input: ['invalid_input', 'The OpenContent administration input is invalid.', 'never'],
      unauthorized: ['unauthorized', 'OpenContent denied the administration operation.', 'after-human-action'],
      reauthentication_required: ['unauthorized', 'Reconnect OpenContent before continuing.', 'after-human-action'],
      provider_unavailable: ['provider_unavailable', 'OpenContent administration is unavailable.', 'safe-with-same-invocation'],
      rate_limited: ['rate_limited', 'OpenContent rate-limited the administration operation.', 'after-human-action'],
      provider_contract_violation: ['provider_contract_violation', 'OpenContent returned an unsupported administration response.', 'never'],
      conflict: ['conflict', 'The OpenContent administration operation conflicts with current state.', 'after-human-action'],
      outcome_unknown: ['outcome_unknown', 'The OpenContent administration outcome cannot be proven.', 'never'],
      bounds_exceeded: ['bounds_exceeded', 'OpenContent administration exceeded a pagination bound.', 'never'],
      cancelled: ['cancelled', 'The OpenContent administration operation was cancelled.', 'never']
    } as const
    const [code, message, retry] = mapping[error.code]
    return operationError(code, message, retry)
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return operationError('cancelled', 'The OpenContent administration operation was cancelled.', 'never')
  }
  return operationError(
    'provider_unavailable',
    'OpenContent administration is unavailable.',
    'safe-with-same-invocation'
  )
}

function connectorError(
  code: ConstructorParameters<typeof OpenContentConnectorError>[0]
): OpenContentConnectorError {
  return new OpenContentConnectorError(code, 'OpenContent administration failed.')
}

function operationError(
  code: ConstructorParameters<typeof ContentSpaceOperationError>[0]['code'],
  message: string,
  retry: ConstructorParameters<typeof ContentSpaceOperationError>[0]['retry']
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry })
}
