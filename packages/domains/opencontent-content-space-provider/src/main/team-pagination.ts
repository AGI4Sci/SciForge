import {
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import {
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId,
  type OpenContentTeam,
  type OpenContentTeamId,
  type OpenContentTeamUser
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

const MAX_COMPLETE_TEAM_PAGES = 10_000

type CompletePage<Item> = Readonly<{
  pageNumber: number
  pageSize: number
  totalCount: number
  items: readonly Item[]
  nextPage?: number
}>

export async function listCompleteOpenContentTeams(
  administration: OpenContentBoundTeamAdministration,
  options: Readonly<{
    signal?: AbortSignal
    teamType?: 0 | 1 | 2 | 3
    keyword?: string
  }> = {}
): Promise<readonly OpenContentTeam[]> {
  return listCompletePages({
    readPage: async (pageNumber) => {
      const page = await administration.listTeams({
        pageNumber,
        pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
        ...(options.teamType === undefined ? {} : { teamType: options.teamType }),
        ...(options.keyword === undefined ? {} : { keyword: options.keyword }),
        ...(options.signal === undefined ? {} : { signal: options.signal })
      })
      return {
        pageNumber: page.pageNumber,
        pageSize: page.pageSize,
        totalCount: page.totalCount,
        items: page.teams,
        ...(page.nextPage === undefined ? {} : { nextPage: page.nextPage })
      }
    },
    identity: (team) => team.teamId
  })
}

export async function listCompleteOpenContentTeamUsers(
  administration: OpenContentBoundTeamAdministration,
  options: Readonly<{
    teamId: OpenContentTeamId
    signal?: AbortSignal
  }>
): Promise<readonly OpenContentTeamUser[]> {
  return listCompletePages({
    readPage: async (pageNumber) => {
      const page = await administration.listTeamUsers({
        teamId: options.teamId,
        pageNumber,
        pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX,
        ...(options.signal === undefined ? {} : { signal: options.signal })
      })
      return {
        pageNumber: page.pageNumber,
        pageSize: page.pageSize,
        totalCount: page.totalCount,
        items: page.users,
        ...(page.nextPage === undefined ? {} : { nextPage: page.nextPage })
      }
    },
    identity: (user) => user.identityId
  })
}

async function listCompletePages<Item, Identity extends OpenContentTeamId | OpenContentIdentityId>(
  input: Readonly<{
    readPage(pageNumber: number): Promise<CompletePage<Item>>
    identity(item: Item): Identity
  }>
): Promise<readonly Item[]> {
  const items: Item[] = []
  const seen = new Set<Identity>()
  let totalCount: number | undefined
  for (let pageNumber = 1; pageNumber <= MAX_COMPLETE_TEAM_PAGES; pageNumber += 1) {
    const page = await input.readPage(pageNumber)
    if (page.pageNumber !== pageNumber || page.pageSize !== OPENCONTENT_TEAM_PAGE_SIZE_MAX) {
      throw contractViolation('OpenContent changed the requested Team page.')
    }
    if (totalCount === undefined) totalCount = page.totalCount
    if (page.totalCount !== totalCount) {
      throw contractViolation('OpenContent changed the Team page total count.')
    }
    const offset = (pageNumber - 1) * OPENCONTENT_TEAM_PAGE_SIZE_MAX
    const expectedCount = Math.min(
      OPENCONTENT_TEAM_PAGE_SIZE_MAX,
      Math.max(totalCount - offset, 0)
    )
    if (page.items.length !== expectedCount) {
      throw contractViolation('OpenContent returned an incomplete Team page.')
    }
    for (const item of page.items) {
      const identity = input.identity(item)
      if (seen.has(identity)) {
        throw contractViolation('OpenContent repeated an identity across Team pages.')
      }
      seen.add(identity)
      items.push(item)
    }
    if (seen.size < totalCount) {
      if (page.items.length !== OPENCONTENT_TEAM_PAGE_SIZE_MAX ||
        page.nextPage !== pageNumber + 1) {
        throw contractViolation('OpenContent did not prove the next complete Team page.')
      }
      continue
    }
    if (seen.size !== totalCount || page.nextPage !== undefined) {
      throw contractViolation('OpenContent did not prove the terminal Team page.')
    }
    return Object.freeze(items)
  }
  throw new OpenContentConnectorError(
    'bounds_exceeded',
    'OpenContent Team pagination exceeded its configured bound.'
  )
}

function contractViolation(message: string): OpenContentConnectorError {
  return new OpenContentConnectorError('provider_contract_violation', message)
}
