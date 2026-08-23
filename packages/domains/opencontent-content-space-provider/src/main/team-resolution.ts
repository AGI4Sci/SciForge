import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type {
  OpenContentBoundTeamAdministration,
  OpenContentIdentityId,
  OpenContentTeam,
  OpenContentTeamRoot
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import { listCompleteOpenContentTeams } from './team-pagination.js'

export async function findOpenContentTeamByRoot(
  administration: OpenContentBoundTeamAdministration,
  folderGuid: string,
  currentOwnerIdentityId: OpenContentIdentityId,
  signal?: AbortSignal
): Promise<Readonly<{ team: OpenContentTeam; root: OpenContentTeamRoot }> | undefined> {
  let match: Readonly<{ team: OpenContentTeam; root: OpenContentTeamRoot }> | undefined
  const teams = await listCompleteOpenContentTeams(administration, {
    teamType: 2,
    ...(signal === undefined ? {} : { signal })
  })
  for (const team of teams) {
    const root = await resolveOpenContentTeamRoot(
      administration,
      team,
      currentOwnerIdentityId,
      signal
    )
    if (root.folderGuid !== folderGuid) continue
    if (match !== undefined) {
      throw contractViolation('OpenContent returned duplicate Teams for one root.')
    }
    match = Object.freeze({ team, root })
  }
  return match
}

export async function resolveOpenContentTeamRoot(
  administration: OpenContentBoundTeamAdministration,
  team: OpenContentTeam,
  currentOwnerIdentityId: OpenContentIdentityId,
  signal?: AbortSignal
): Promise<OpenContentTeamRoot> {
  assertOpenContentTeamAdministrationAuthority(team, currentOwnerIdentityId)
  const root = await administration.resolveTeamRoot({
    teamId: team.teamId,
    folderId: team.folderId,
    ...(signal === undefined ? {} : { signal })
  })
  if (root.teamId !== team.teamId || root.folderId !== team.folderId) {
    throw contractViolation('OpenContent Team root did not match the listed Team.')
  }
  return root
}

export function assertOpenContentTeamAdministrationAuthority(
  team: OpenContentTeam,
  currentOwnerIdentityId: OpenContentIdentityId
): void {
  if (team.teamType !== 2 || team.ownerIdentityId !== currentOwnerIdentityId) {
    throw contractViolation('OpenContent returned a Team outside the current owner authority.')
  }
}

export function assertOpenContentTeamObservation(
  observed: OpenContentTeam,
  expected: OpenContentTeam
): void {
  if (
    observed.teamId !== expected.teamId ||
    observed.folderId !== expected.folderId ||
    observed.teamType !== expected.teamType ||
    observed.ownerIdentityId !== expected.ownerIdentityId
  ) {
    throw contractViolation('OpenContent Team authority drifted from its listed snapshot.')
  }
}

function contractViolation(message: string): OpenContentConnectorError {
  return new OpenContentConnectorError('provider_contract_violation', message)
}
