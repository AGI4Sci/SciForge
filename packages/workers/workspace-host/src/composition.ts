import type {
  WorkspaceHostContributionCohort
} from '@sciforge/domain-sdk/workspace-host'
import type {
  DomainWorkspaceServerHost
} from '@sciforge/domain-sdk/workspace-server'

import {
  createInstalledWorkspaceServerDomainEntries
} from './generated/installed-domain-workspace-server.js'

export function createWorkspaceHostDomainComposition(
  host: DomainWorkspaceServerHost
) {
  const entries = createInstalledWorkspaceServerDomainEntries(host)
  const contributions = entries.flatMap((entry) => entry.contributions.map((contribution) => ({
    packageName: entry.definition.packageName,
    moduleId: entry.definition.module.id,
    moduleVersion: entry.definition.module.version,
    id: contribution.id,
    kind: contribution.kind,
    value: contribution.value,
    ...(contribution.contract === undefined ? {} : { contract: contribution.contract }),
    ...(contribution.onDispose ? { onDispose: contribution.onDispose } : {})
  })))
  const cohorts: WorkspaceHostContributionCohort[] = entries.map((entry) => ({
    packageName: entry.definition.packageName,
    moduleId: entry.definition.module.id,
    moduleVersion: entry.definition.module.version
  }))
  return Object.freeze({
    entries,
    contributions: Object.freeze(contributions),
    cohorts: Object.freeze(cohorts),
    dispose() {
      for (const contribution of contributions) contribution.onDispose?.()
    }
  })
}
