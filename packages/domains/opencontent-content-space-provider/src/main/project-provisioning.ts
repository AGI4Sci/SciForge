import { createHash } from 'node:crypto'

import {
  PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
  defineProjectContentSpaceProvisioningPort,
  projectContentSpaceProvisioningIntentSchema,
  projectContentSpaceProvisioningReportSchema,
  type ProjectContentSpaceProvisioningIntent,
  type ProjectContentSpaceProvisioningPort,
  type ProjectContentSpaceProvisioningReport
} from '@sciforge/domain-content-space/administration-contract'
import { toPortableContentContainerReference } from '@sciforge/domain-content-space/contract'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  OpenContentConnectorError,
  type OpenContentExternalBindingAttestation
} from '@sciforge/domain-opencontent-connector/contract'
import {
  OPENCONTENT_TEAM_MUTATION_SIZE_MAX,
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  openContentIdentityIdSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentFolderId,
  type OpenContentIdentityId,
  type OpenContentTeam,
  type OpenContentTeamId,
  type OpenContentTeamRoot,
  type OpenContentTeamUser
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import {
  OpenContentIdentityBindingError,
  type OpenContentIdentityBindingPort
} from './identity-binding.js'

const MAX_PAGES = 10_000
const MAX_TEAM_NAME_LENGTH = 240
const TEAM_NAME_PREFIX = 'SciForge-MVP'

class OwnerSynchronizationRequiredError extends OpenContentConnectorError {
  readonly root: ReturnType<typeof toPortableContentContainerReference>

  constructor(root: ReturnType<typeof toPortableContentContainerReference>) {
    super('unauthorized', 'The current OpenContent Team owner does not match the Project owner.')
    this.name = 'OwnerSynchronizationRequiredError'
    this.root = root
  }
}

export type OpenContentProjectProvisioningContext = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  expectedBindingAttestation?: OpenContentExternalBindingAttestation
  signal?: AbortSignal
  assertPrincipalCurrent(): void | Promise<void>
}>

export type OpenContentProjectConnectionPort = Readonly<{
  useTeamAdministration<T>(
    context: OpenContentProjectProvisioningContext,
    operation: (connection: Readonly<{
      externalIdentityId: OpenContentIdentityId
      administration: OpenContentBoundTeamAdministration
    }>) => T | Promise<T>
  ): Promise<T>
}>

export type OpenContentProjectIdentityPort = Pick<
OpenContentIdentityBindingPort,
'resolveContentUserIdentity'
>

class ProjectIdentityBindingsMissingError extends Error {
  readonly contentUserIds: ReadonlySet<string>

  constructor(contentUserIds: readonly string[]) {
    super('One or more Project members have no verified OpenContent identity binding.')
    this.name = 'ProjectIdentityBindingsMissingError'
    this.contentUserIds = new Set(contentUserIds)
  }
}

export type OpenContentProjectProvisioningReceipt = Readonly<{
  report: ProjectContentSpaceProvisioningReport
  team: Readonly<{
    teamId: OpenContentTeamId
    folderId: OpenContentFolderId
    name: string
    ownerIdentityId: OpenContentIdentityId
    created: boolean
  }>
  root: OpenContentTeamRoot
  reconciliation: Readonly<{
    addedIdentityIds: readonly OpenContentIdentityId[]
    removedIdentityIds: readonly OpenContentIdentityId[]
  }>
}>

export type OpenContentProjectProvisioning = Readonly<{
  provisionProject(input: Readonly<{
    intent: ProjectContentSpaceProvisioningIntent
    context: OpenContentProjectProvisioningContext
  }>): Promise<OpenContentProjectProvisioningReceipt>
  bindProjectProvisioningPort(
    context: OpenContentProjectProvisioningContext
  ): ProjectContentSpaceProvisioningPort
}>

export function deterministicOpenContentProjectTeamName(
  rawIntent: ProjectContentSpaceProvisioningIntent
): string {
  const intent = projectContentSpaceProvisioningIntentSchema.parse(rawIntent)
  const suffix = createHash('sha256').update(intent.projectId, 'utf8').digest('hex').slice(0, 16)
  const label = intent.projectLabel
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'project'
  const availableLabelLength = MAX_TEAM_NAME_LENGTH - TEAM_NAME_PREFIX.length - suffix.length - 2
  const boundedLabel = [...label].slice(0, availableLabelLength).join('').replace(/-+$/gu, '') || 'project'
  return `${TEAM_NAME_PREFIX}-${boundedLabel}-${suffix}`
}

export function createOpenContentProjectProvisioning(options: Readonly<{
  connection: OpenContentProjectConnectionPort
  identities: OpenContentProjectIdentityPort
}>): OpenContentProjectProvisioning {
  const provisionProject: OpenContentProjectProvisioning['provisionProject'] = async ({
    intent: rawIntent,
    context
  }) => {
    const intent = projectContentSpaceProvisioningIntentSchema.parse(rawIntent)
    await context.assertPrincipalCurrent()
    return options.connection.useTeamAdministration(context, async (rawConnection) => {
      const connection = Object.freeze({
        externalIdentityId: parseProviderIdentity(rawConnection.externalIdentityId),
        administration: rawConnection.administration
      })
      const identityByContentUser = await resolveProjectIdentities(
        options.identities,
        intent,
        context,
        connection.externalIdentityId
      )
      const expectedOwnerIdentityId = identityByContentUser.get(intent.contentOwnerUserId)
      if (
        expectedOwnerIdentityId === undefined ||
        expectedOwnerIdentityId !== connection.externalIdentityId
      ) throw connectorError('unauthorized')

      const name = deterministicOpenContentProjectTeamName(intent)
      let matches = await findDeterministicTeams(
        connection.administration,
        name,
        context
      )
      let created = false
      if (matches.length === 0) {
        await context.assertPrincipalCurrent()
        await connection.administration.createTeam(withSignal(context, {
          name
        }))
        created = true
        matches = await findDeterministicTeams(
          connection.administration,
          name,
          context
        )
        if (matches.length === 0) throw connectorError('outcome_unknown')
      }
      if (matches.length !== 1) throw connectorError('provider_contract_violation')
      const listedTeam = matches[0]
      if (!listedTeam) throw connectorError('provider_contract_violation')

      const team = await connection.administration.observeTeam(withSignal(context, {
        teamId: listedTeam.teamId
      }))
      if (
        team.teamId !== listedTeam.teamId ||
        team.folderId !== listedTeam.folderId ||
        team.name !== name
      ) throw connectorError('provider_contract_violation')
      if (team.ownerIdentityId !== expectedOwnerIdentityId) {
        const root = await connection.administration.resolveTeamRoot(withSignal(context, {
          teamId: team.teamId,
          folderId: team.folderId
        }))
        throw new OwnerSynchronizationRequiredError(toPortableContentContainerReference({
          providerInstanceRef: context.providerInstanceRef,
          containerId: root.folderGuid
        }))
      }

      const desiredMemberIdentityIds = intent.contentMemberUserIds.map((contentUserId) => {
        const identityId = identityByContentUser.get(contentUserId)
        if (identityId === undefined) throw connectorError('provider_contract_violation')
        return identityId
      })
      const initialUsers = await listAllTeamUsers(
        connection.administration,
        team.teamId,
        context
      )
      const currentIdentityIds = new Set(initialUsers.map((user) => user.identityId))
      const desiredIdentityIds = new Set(desiredMemberIdentityIds)
      const addedIdentityIds = sortedIdentityIds(
        desiredMemberIdentityIds.filter((identityId) => !currentIdentityIds.has(identityId))
      )
      const removedIdentityIds = sortedIdentityIds(
        initialUsers
          .map((user) => user.identityId)
          .filter((identityId) => (
            identityId !== expectedOwnerIdentityId && !desiredIdentityIds.has(identityId)
          ))
      )

      for (const identityIds of chunksOf(
        addedIdentityIds,
        OPENCONTENT_TEAM_MUTATION_SIZE_MAX
      )) {
        await context.assertPrincipalCurrent()
        await connection.administration.addTeamUsers(withSignal(context, {
          teamId: team.teamId,
          identityIds
        }))
      }
      for (const identityIds of chunksOf(
        removedIdentityIds,
        OPENCONTENT_TEAM_MUTATION_SIZE_MAX
      )) {
        await context.assertPrincipalCurrent()
        await connection.administration.removeTeamUsers(withSignal(context, {
          teamId: team.teamId,
          identityIds
        }))
      }

      if (addedIdentityIds.length > 0 || removedIdentityIds.length > 0) {
        const reconciledUsers = await listAllTeamUsers(
          connection.administration,
          team.teamId,
          context
        )
        assertMembershipReconciled(
          reconciledUsers,
          desiredIdentityIds,
          expectedOwnerIdentityId
        )
      } else {
        assertMembershipReconciled(
          initialUsers,
          desiredIdentityIds,
          expectedOwnerIdentityId
        )
      }

      const root = await connection.administration.resolveTeamRoot(withSignal(context, {
        teamId: team.teamId,
        folderId: team.folderId
      }))
      const portableRoot = toPortableContentContainerReference({
        providerInstanceRef: context.providerInstanceRef,
        containerId: root.folderGuid
      })
      const report = projectContentSpaceProvisioningReportSchema.parse({
        projectId: intent.projectId,
        intentRevision: intent.intentRevision,
        status: 'ready',
        root: portableRoot,
        contentOwnerUserId: intent.contentOwnerUserId,
        members: intent.contentMemberUserIds.map((contentUserId) => ({
          contentUserId,
          status: 'ready'
        }))
      })
      return Object.freeze({
        report,
        team: Object.freeze({
          teamId: team.teamId,
          folderId: team.folderId,
          name: team.name,
          ownerIdentityId: team.ownerIdentityId,
          created
        }),
        root,
        reconciliation: Object.freeze({
          addedIdentityIds: Object.freeze(addedIdentityIds),
          removedIdentityIds: Object.freeze(removedIdentityIds)
        })
      })
    })
  }

  return Object.freeze({
    provisionProject,
    bindProjectProvisioningPort: (context) => defineProjectContentSpaceProvisioningPort({
      contractVersion: PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION,
      provisionProjectContentSpace: async (intent) => {
        try {
          return (await provisionProject({ intent, context })).report
        } catch (error) {
          if (error instanceof ProjectIdentityBindingsMissingError) {
            return projectContentSpaceProvisioningReportSchema.parse({
              projectId: intent.projectId,
              intentRevision: intent.intentRevision,
              status: 'pending',
              contentOwnerUserId: intent.contentOwnerUserId,
              members: intent.contentMemberUserIds.map((contentUserId) => ({
                contentUserId,
                status: 'pending',
                reasonCode: error.contentUserIds.has(contentUserId)
                  ? 'identity_binding_missing'
                  : 'identity_binding_pending'
              }))
            })
          }
          if (error instanceof OwnerSynchronizationRequiredError) {
            return projectContentSpaceProvisioningReportSchema.parse({
              projectId: intent.projectId,
              intentRevision: intent.intentRevision,
              status: 'ownership_sync_required',
              root: error.root,
              contentOwnerUserId: intent.contentOwnerUserId,
              members: intent.contentMemberUserIds.map((contentUserId) => ({
                contentUserId,
                status: 'pending',
                reasonCode: 'owner_sync_required'
              }))
            })
          }
          if (!(error instanceof OpenContentConnectorError) || error.code !== 'outcome_unknown') {
            throw error
          }
          return projectContentSpaceProvisioningReportSchema.parse({
            projectId: intent.projectId,
            intentRevision: intent.intentRevision,
            status: 'outcome_unknown',
            contentOwnerUserId: intent.contentOwnerUserId,
            members: intent.contentMemberUserIds.map((contentUserId) => ({
              contentUserId,
              status: 'failed',
              reasonCode: 'outcome_unknown'
            }))
          })
        }
      }
    })
  })
}

async function resolveProjectIdentities(
  identities: OpenContentProjectIdentityPort,
  intent: ProjectContentSpaceProvisioningIntent,
  context: OpenContentProjectProvisioningContext,
  currentExternalIdentityId: OpenContentIdentityId
): Promise<ReadonlyMap<string, OpenContentIdentityId>> {
  const contentUserIds = [intent.contentOwnerUserId, ...intent.contentMemberUserIds]
  const pairs: [string, OpenContentIdentityId][] = []
  const missingContentUserIds: string[] = []
  for (const contentUserId of contentUserIds) {
    try {
      const identityId = parseProviderIdentity(await identities.resolveContentUserIdentity({
        contentUserId,
        principal: context.principal,
        providerInstanceRef: context.providerInstanceRef,
        currentExternalIdentityId,
        ...(context.signal === undefined ? {} : { signal: context.signal })
      }))
      pairs.push([contentUserId, identityId])
    } catch (error) {
      if (!(error instanceof OpenContentIdentityBindingError)) throw error
      missingContentUserIds.push(contentUserId)
    }
  }
  if (missingContentUserIds.length > 0) {
    throw new ProjectIdentityBindingsMissingError(missingContentUserIds)
  }
  const byContentUser = new Map(pairs)
  if (byContentUser.size !== contentUserIds.length) throw connectorError('invalid_input')
  const byProviderIdentity = new Set(pairs.map(([, identityId]) => identityId))
  if (byProviderIdentity.size !== pairs.length) throw connectorError('conflict')
  return byContentUser
}

async function findDeterministicTeams(
  teams: OpenContentBoundTeamAdministration,
  name: string,
  context: OpenContentProjectProvisioningContext
): Promise<readonly OpenContentTeam[]> {
  const allTeams: OpenContentTeam[] = []
  const seenTeamIds = new Set<OpenContentTeamId>()
  let pageNumber = 1
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await teams.listTeams(withSignal(context, {
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
      teamType: 2 as const,
      keyword: name
    }))
    for (const team of page.teams) {
      if (seenTeamIds.has(team.teamId)) throw connectorError('provider_contract_violation')
      seenTeamIds.add(team.teamId)
      allTeams.push(team)
    }
    if (page.nextPage === undefined) {
      return Object.freeze(allTeams.filter((team) => team.name === name))
    }
    if (page.nextPage !== pageNumber + 1) throw connectorError('provider_contract_violation')
    pageNumber = page.nextPage
  }
  throw connectorError('bounds_exceeded')
}

async function listAllTeamUsers(
  teams: OpenContentBoundTeamAdministration,
  teamId: OpenContentTeamId,
  context: OpenContentProjectProvisioningContext
): Promise<readonly OpenContentTeamUser[]> {
  const users: OpenContentTeamUser[] = []
  const seenIdentityIds = new Set<OpenContentIdentityId>()
  let pageNumber = 1
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await teams.listTeamUsers(withSignal(context, {
      teamId,
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX
    }))
    for (const user of page.users) {
      if (seenIdentityIds.has(user.identityId)) {
        throw connectorError('provider_contract_violation')
      }
      seenIdentityIds.add(user.identityId)
      users.push(user)
    }
    if (page.nextPage === undefined) return Object.freeze(users)
    if (page.nextPage !== pageNumber + 1) throw connectorError('provider_contract_violation')
    pageNumber = page.nextPage
  }
  throw connectorError('bounds_exceeded')
}

function assertMembershipReconciled(
  users: readonly OpenContentTeamUser[],
  desiredMemberIdentityIds: ReadonlySet<OpenContentIdentityId>,
  ownerIdentityId: OpenContentIdentityId
): void {
  const actual = new Set(users.map((user) => user.identityId))
  if (
    [...desiredMemberIdentityIds].some((identityId) => !actual.has(identityId)) ||
    [...actual].some((identityId) => (
      identityId !== ownerIdentityId && !desiredMemberIdentityIds.has(identityId)
    ))
  ) throw connectorError('outcome_unknown')
}

function sortedIdentityIds(
  identityIds: readonly OpenContentIdentityId[]
): OpenContentIdentityId[] {
  return [...new Set(identityIds)].sort((left, right) => left - right)
}

function chunksOf<Value>(values: readonly Value[], size: number): readonly Value[][] {
  const chunks: Value[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size))
  }
  return chunks
}

function withSignal<Input extends object>(
  context: OpenContentProjectProvisioningContext,
  input: Input
): Input & Readonly<{ signal?: AbortSignal }> {
  return {
    ...input,
    ...(context.signal === undefined ? {} : { signal: context.signal })
  }
}

function parseProviderIdentity(value: unknown): OpenContentIdentityId {
  const parsed = openContentIdentityIdSchema.safeParse(value)
  if (!parsed.success) throw connectorError('provider_contract_violation')
  return parsed.data
}

function connectorError(
  code: ConstructorParameters<typeof OpenContentConnectorError>[0]
): OpenContentConnectorError {
  const messages = {
    invalid_input: 'Project Content Space provisioning input is invalid.',
    unauthorized: 'The current OpenContent connection is not the Project content owner.',
    reauthentication_required: 'The OpenContent connection must be authenticated again.',
    provider_unavailable: 'OpenContent Project provisioning is unavailable.',
    rate_limited: 'OpenContent rate-limited Project provisioning.',
    provider_contract_violation: 'OpenContent returned an unsupported Project provisioning response.',
    conflict: 'Project content identities or deterministic Teams conflict.',
    outcome_unknown: 'The OpenContent Project provisioning outcome cannot be proven.',
    bounds_exceeded: 'OpenContent Project provisioning exceeded a pagination bound.',
    cancelled: 'OpenContent Project provisioning was cancelled.'
  } as const
  return new OpenContentConnectorError(code, messages[code])
}
