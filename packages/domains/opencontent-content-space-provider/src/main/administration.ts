import { createHash } from 'node:crypto'

import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  contentSpaceAdministrationMemberPageSchema,
  contentSpaceAdministrationMemberSummarySchema,
  contentSpaceAdministrationOperationStateListSchema,
  contentSpaceAdministrationRemoveMemberReceiptSchema,
  contentSpaceAdministrationRootOpenResultSchema,
  contentSpaceAdministrationSpacePageSchema,
  contentSpaceAdministrationSpaceSummarySchema,
  defineContentSpaceAdministrationPort,
  type ContentSpaceAdministrationMemberRole,
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
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'
import {
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId,
  type OpenContentTeam,
  type OpenContentTeamId,
  type OpenContentTeamRoot,
  type OpenContentTeamUser
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  OpenContentIdentityBindingError,
  createCurrentPrincipalOpenContentIdentityBinding,
  type OpenContentIdentityBindingPort
} from './identity-binding.js'
import { createOpenContentProjectProvisioning } from './project-provisioning.js'

const MAX_PAGES = 10_000
const TEAM_CURSOR = /^oct_(\d+)_(\d+)$/u
const MEMBER_CURSOR = /^ocm_(\d+)_(\d+)$/u
const OPENCONTENT_ADMINISTRATION_OPERATION_STATES =
  contentSpaceAdministrationOperationStateListSchema.parse(
    CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => ({
      operation,
      readiness: 'production_ready' as const,
      reasonCode: 'available' as const
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
  identities?: OpenContentIdentityBindingPort
}>): ContentSpaceAdministrationFeature {
  const identities = options.identities ?? createCurrentPrincipalOpenContentIdentityBinding()
  const provisioning = createOpenContentProjectProvisioning({
    connection: options.facade,
    identities
  })
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
          facade: options.facade,
          identities
        }),
        projectProvisioning: provisioning.bindProjectProvisioningPort({
          principal: context.principal,
          providerInstanceRef: context.providerInstanceRef,
          signal: context.signal,
          assertPrincipalCurrent: context.assertPrincipalCurrent
        })
      })
    }
  })
}

function createBoundAdministrationPort(options: Readonly<{
  context: ContentSpaceProviderOperationContext
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
  identities: OpenContentIdentityBindingPort
}>): ContentSpaceAdministrationPort {
  const withSession = async <Value>(
    operation: (session: BoundSession) => Value | Promise<Value>
  ): Promise<Value> => {
    try {
      assertProviderInstance(options.context.providerInstanceRef, options.providerInstanceRef)
      return await options.facade.useTeamAdministration({
        principal: options.context.principal,
        providerInstanceRef: options.context.providerInstanceRef,
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
    const match = await findTeamByRoot(
      session.administration,
      expectedRoot.containerId,
      options.context
    )
    const team = await session.administration.observeTeam(withSignal(options.context, {
      teamId: match.team.teamId
    }))
    assertObservedTeam(team, match.team)
    return Object.freeze({ team, root: match.root })
  }

  const summary = async (
    session: BoundSession,
    team: OpenContentTeam,
    knownRoot?: OpenContentTeamRoot
  ) => {
    const root = knownRoot ?? await resolveRoot(session.administration, team, options.context)
    const contentOwnerUserId = await options.identities.resolveExternalIdentityContentUser({
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
      pinned: team.isStuck,
      revision: teamRevision(team)
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
      const ownerIdentityId = await options.identities.resolveContentUserIdentity({
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
      let matches = await findTeamsByName(
        session.administration,
        input.label,
        options.context
      )
      if (matches.length > 1) throw connectorError('conflict')
      if (matches.length === 0) {
        await session.administration.createTeam(withSignal(options.context, { name: input.label }))
        matches = await findTeamsByName(session.administration, input.label, options.context)
        if (matches.length === 0) throw connectorError('outcome_unknown')
        if (matches.length > 1) throw connectorError('conflict')
      }
      const listed = matches[0]
      if (!listed) throw connectorError('provider_contract_violation')
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: listed.teamId
      }))
      assertObservedTeam(team, listed)
      if (team.ownerIdentityId !== ownerIdentityId) {
        throw operationError(
          'unauthorized',
          'The existing OpenContent Team owner does not match the requested owner.',
          'after-human-action'
        )
      }
      return summary(session, team)
    }),
    observeSpace: async ({ root }) => withSession(async (session) => {
      const observed = await observe(session, root)
      return summary(session, observed.team, observed.root)
    }),
    updateSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      assertExpectedRevision(observed.team, input.expectedRevision)
      if (input.label !== observed.team.name) {
        await session.administration.editTeam(withSignal(options.context, {
          teamId: observed.team.teamId,
          folderId: observed.team.folderId,
          name: input.label
        }))
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      if (team.name !== input.label) {
        throw connectorError('outcome_unknown')
      }
      return summary(session, team, observed.root)
    }),
    pinSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      assertExpectedRevision(observed.team, input.expectedRevision)
      if (!observed.team.isStuck) {
        await session.administration.stickTeam(withSignal(options.context, {
          teamId: observed.team.teamId
        }))
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      if (!team.isStuck) throw connectorError('outcome_unknown')
      return summary(session, team, observed.root)
    }),
    unpinSpace: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      assertExpectedRevision(observed.team, input.expectedRevision)
      if (observed.team.isStuck) {
        await session.administration.unstickTeam(withSignal(options.context, {
          teamId: observed.team.teamId
        }))
      }
      const team = await session.administration.observeTeam(withSignal(options.context, {
        teamId: observed.team.teamId
      }))
      if (team.isStuck) throw connectorError('outcome_unknown')
      return summary(session, team, observed.root)
    }),
    openRoot: async ({ root }) => withSession(async (session) => {
      const observed = await observe(session, root)
      return contentSpaceAdministrationRootOpenResultSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        }),
        revision: teamRevision(observed.team)
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
          items.push(await memberSummary(
            options.identities,
            options.context,
            session,
            observed.team,
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
      assertExpectedRevision(observed.team, input.expectedRevision)
      const identityId = await options.identities.resolveContentUserIdentity({
        contentUserId: input.contentUserId,
        ...identityContext(options.context, session.externalIdentityId)
      })
      let users = await listAllUsers(
        session.administration,
        observed.team.teamId,
        options.context
      )
      let addedUser = users.find((user) => user.identityId === identityId)
      if (addedUser && teamMemberRole(observed.team, addedUser) !== 'internal') {
        throw operationError(
          'conflict',
          'The OpenContent Team member already has a different role.',
          'after-human-action'
        )
      }
      if (!addedUser) {
        await session.administration.addTeamUsers(withSignal(options.context, {
          teamId: observed.team.teamId,
          identityIds: [identityId]
        }))
        users = await listAllUsers(
          session.administration,
          observed.team.teamId,
          options.context
        )
        addedUser = users.find((user) => user.identityId === identityId)
        if (!addedUser) throw connectorError('outcome_unknown')
        if (teamMemberRole(observed.team, addedUser) !== 'internal') {
          throw connectorError('provider_contract_violation')
        }
      }
      return contentSpaceAdministrationMemberSummarySchema.parse({
        contentUserId: input.contentUserId,
        role: 'internal',
        revision: teamRevision(observed.team)
      })
    }),
    removeMember: async (input) => withSession(async (session) => {
      const observed = await observe(session, input.root)
      assertExpectedRevision(observed.team, input.expectedRevision)
      const identityId = await options.identities.resolveContentUserIdentity({
        contentUserId: input.contentUserId,
        ...identityContext(options.context, session.externalIdentityId)
      })
      if (identityId === observed.team.ownerIdentityId) {
        throw operationError(
          'blocked_by_contract',
          'The OpenContent Team owner cannot be removed as a member.',
          'after-human-action'
        )
      }
      let users = await listAllUsers(
        session.administration,
        observed.team.teamId,
        options.context
      )
      if (users.some((user) => user.identityId === identityId)) {
        await session.administration.removeTeamUsers(withSignal(options.context, {
          teamId: observed.team.teamId,
          identityIds: [identityId]
        }))
        users = await listAllUsers(
          session.administration,
          observed.team.teamId,
          options.context
        )
        if (users.some((user) => user.identityId === identityId)) {
          throw connectorError('outcome_unknown')
        }
      }
      return contentSpaceAdministrationRemoveMemberReceiptSchema.parse({
        root: toPortableContentContainerReference({
          providerInstanceRef: options.providerInstanceRef,
          containerId: observed.root.folderGuid
        }),
        contentUserId: input.contentUserId,
        removed: true,
        revision: teamRevision(observed.team)
      })
    })
  })
}

async function findTeamByRoot(
  administration: OpenContentBoundTeamAdministration,
  folderGuid: string,
  context: ContentSpaceProviderOperationContext
): Promise<Readonly<{ team: OpenContentTeam; root: OpenContentTeamRoot }>> {
  let match: Readonly<{ team: OpenContentTeam; root: OpenContentTeamRoot }> | undefined
  let pageNumber = 1
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await administration.listTeams(withSignal(context, {
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
      teamType: 2 as const
    }))
    for (const team of page.teams) {
      const root = await resolveRoot(administration, team, context)
      if (root.folderGuid !== folderGuid) continue
      if (match !== undefined) throw connectorError('provider_contract_violation')
      match = Object.freeze({ team, root })
    }
    if (page.nextPage === undefined) {
      if (!match) throw operationError('invalid_reference', 'The Team root does not exist.', 'never')
      return match
    }
    if (page.nextPage !== pageNumber + 1) throw connectorError('provider_contract_violation')
    pageNumber = page.nextPage
  }
  throw connectorError('bounds_exceeded')
}

async function findTeamsByName(
  administration: OpenContentBoundTeamAdministration,
  name: string,
  context: ContentSpaceProviderOperationContext
): Promise<readonly OpenContentTeam[]> {
  const matches: OpenContentTeam[] = []
  const seen = new Set<OpenContentTeamId>()
  let pageNumber = 1
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await administration.listTeams(withSignal(context, {
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
      teamType: 2 as const,
      keyword: name
    }))
    for (const team of page.teams) {
      if (seen.has(team.teamId)) throw connectorError('provider_contract_violation')
      seen.add(team.teamId)
      if (team.name === name) matches.push(team)
    }
    if (page.nextPage === undefined) return Object.freeze(matches)
    if (page.nextPage !== pageNumber + 1) throw connectorError('provider_contract_violation')
    pageNumber = page.nextPage
  }
  throw connectorError('bounds_exceeded')
}

async function listAllUsers(
  administration: OpenContentBoundTeamAdministration,
  teamId: OpenContentTeamId,
  context: ContentSpaceProviderOperationContext
): Promise<readonly OpenContentTeamUser[]> {
  const users: OpenContentTeamUser[] = []
  const seen = new Set<OpenContentIdentityId>()
  let pageNumber = 1
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await administration.listTeamUsers(withSignal(context, {
      teamId,
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX
    }))
    for (const user of page.users) {
      if (seen.has(user.identityId)) throw connectorError('provider_contract_violation')
      seen.add(user.identityId)
      users.push(user)
    }
    if (page.nextPage === undefined) return Object.freeze(users)
    if (page.nextPage !== pageNumber + 1) throw connectorError('provider_contract_violation')
    pageNumber = page.nextPage
  }
  throw connectorError('bounds_exceeded')
}

async function resolveRoot(
  administration: OpenContentBoundTeamAdministration,
  team: OpenContentTeam,
  context: ContentSpaceProviderOperationContext
): Promise<OpenContentTeamRoot> {
  const root = await administration.resolveTeamRoot(withSignal(context, {
    teamId: team.teamId,
    folderId: team.folderId
  }))
  if (root.teamId !== team.teamId || root.folderId !== team.folderId) {
    throw connectorError('provider_contract_violation')
  }
  return root
}

async function memberSummary(
  identities: OpenContentIdentityBindingPort,
  context: ContentSpaceProviderOperationContext,
  session: BoundSession,
  team: OpenContentTeam,
  user: OpenContentTeamUser
) {
  const contentUserId = await identities.resolveExternalIdentityContentUser({
    externalIdentityId: user.identityId,
    ...identityContext(context, session.externalIdentityId)
  })
  return contentSpaceAdministrationMemberSummarySchema.parse({
    contentUserId,
    role: teamMemberRole(team, user),
    revision: teamRevision(team)
  })
}

function teamMemberRole(
  team: OpenContentTeam,
  user: OpenContentTeamUser
): ContentSpaceAdministrationMemberRole {
  if (user.identityId === team.ownerIdentityId) return 'owner'
  if (user.userType === 2) return 'manager'
  if (user.userType === 3) return 'internal'
  if (user.userType === 4) return 'external'
  throw connectorError('provider_contract_violation')
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

function assertObservedTeam(observed: OpenContentTeam, listed: OpenContentTeam): void {
  if (observed.teamId !== listed.teamId || observed.folderId !== listed.folderId) {
    throw connectorError('provider_contract_violation')
  }
}

function assertExpectedRevision(team: OpenContentTeam, expectedRevision: string): void {
  if (teamRevision(team) !== expectedRevision) {
    throw operationError(
      'conflict',
      'The OpenContent Team changed after it was observed.',
      'after-human-action'
    )
  }
}

function teamRevision(team: OpenContentTeam): string {
  const digest = createHash('sha256').update(JSON.stringify([
    team.teamId,
    team.folderId,
    team.name,
    team.ownerIdentityId,
    team.status,
    team.permission,
    team.teamType,
    team.isStuck
  ])).digest('hex').slice(0, 32)
  return `oc_${digest}`
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
