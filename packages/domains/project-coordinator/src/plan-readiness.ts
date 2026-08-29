import type {
  ProjectPlanTaskDeclaration,
  ProjectWorkerAvailabilityView,
  TaskAuthorityScope
} from '@sciforge/collaboration-contracts'

import type { ProjectCoordinatorProject } from './contract.js'

export type ProjectCoordinatorPlanningReadinessReason =
  | 'ready'
  | 'project_terminal'
  | 'availability_stale'
  | 'agent_inactive'
  | 'device_inactive'
  | 'agent_offline'
  | 'runtime_unavailable'
  | 'offers_paused'
  | 'membership_inactive'
  | 'task_authority_unavailable'
  | 'capability_unavailable'

export type ProjectCoordinatorPlanningRuntimeReadiness = Readonly<{
  eligible: boolean
  reason: ProjectCoordinatorPlanningReadinessReason
  eligibleTaskScopes: readonly TaskAuthorityScope[]
}>

export type ProjectCoordinatorPlanningTaskReadiness = Readonly<{
  eligible: boolean
  reason: ProjectCoordinatorPlanningReadinessReason
  scope: TaskAuthorityScope
}>

type ProjectCoordinatorTaskRequirements = Readonly<{
  fileIntent: unknown | null
  requiredCapabilityTags: readonly string[]
}>

/**
 * Prospective planning is intentionally distinct from execution eligibility.
 * A draft has no invited Membership or TaskAuthority rows yet; a paused
 * Project uses its explicit project_paused suspension as prospective scope;
 * only an active Project requires currently eligible execution authority.
 */
export function projectCoordinatorPlanningRuntimeReadiness(
  project: ProjectCoordinatorProject,
  view: ProjectWorkerAvailabilityView,
  observedAt: string
): ProjectCoordinatorPlanningRuntimeReadiness {
  const commonFailure = commonRuntimeFailure(view, observedAt)
  if (commonFailure) return unavailable(commonFailure)
  if (['completed', 'cancelled'].includes(project.project.status)) {
    return unavailable('project_terminal')
  }
  if (project.project.status === 'draft') {
    return ready(['text_tasks', 'file_tasks'])
  }
  if (view.membership?.state !== 'active') return unavailable('membership_inactive')
  const authorityState = project.project.status === 'paused'
    ? (scope: TaskAuthorityScope) => view.taskAuthorities.some((authority) => (
        authority.scope === scope &&
        authority.state === 'suspended' &&
        authority.reason === 'project_paused'
      ))
    : (scope: TaskAuthorityScope) => view.taskAuthorities.some((authority) => (
        authority.scope === scope && authority.state === 'eligible'
      ))
  const eligibleTaskScopes: TaskAuthorityScope[] = []
  if (authorityState('text_tasks')) eligibleTaskScopes.push('text_tasks')
  if (authorityState('file_tasks') && currentFileScopeReady(project, view)) {
    eligibleTaskScopes.push('file_tasks')
  }
  return eligibleTaskScopes.length > 0
    ? ready(eligibleTaskScopes)
    : unavailable('task_authority_unavailable')
}

export function projectCoordinatorPlanningTaskReadiness(
  project: ProjectCoordinatorProject,
  view: ProjectWorkerAvailabilityView,
  task: ProjectPlanTaskDeclaration,
  observedAt: string
): ProjectCoordinatorPlanningTaskReadiness {
  return projectCoordinatorTaskRequirementReadiness(project, view, task, observedAt)
}

/** Shared readiness check for both Plan declarations and current Cloud Tasks. */
export function projectCoordinatorTaskRequirementReadiness(
  project: ProjectCoordinatorProject,
  view: ProjectWorkerAvailabilityView,
  task: ProjectCoordinatorTaskRequirements,
  observedAt: string
): ProjectCoordinatorPlanningTaskReadiness {
  const scope = task.fileIntent === null ? 'text_tasks' : 'file_tasks'
  const runtime = projectCoordinatorPlanningRuntimeReadiness(project, view, observedAt)
  if (!runtime.eligible || !runtime.eligibleTaskScopes.includes(scope)) {
    return Object.freeze({
      eligible: false,
      reason: runtime.reason,
      scope
    })
  }
  if (task.requiredCapabilityTags.some((tag) => (
    !view.availability.runtimeCapabilityTags.includes(tag)
  ))) {
    return Object.freeze({ eligible: false, reason: 'capability_unavailable', scope })
  }
  return Object.freeze({ eligible: true, reason: 'ready', scope })
}

function commonRuntimeFailure(
  view: ProjectWorkerAvailabilityView,
  observedAt: string
): Exclude<ProjectCoordinatorPlanningReadinessReason, 'ready'> | null {
  const availability = view.availability
  if (Date.parse(availability.expiresAt) <= Date.parse(observedAt)) return 'availability_stale'
  if (!availability.agentActive) return 'agent_inactive'
  if (!availability.deviceActive) return 'device_inactive'
  if (availability.connectionStatus !== 'online') return 'agent_offline'
  if (availability.runtimeReadiness !== 'ready') return 'runtime_unavailable'
  if (!availability.acceptsNewOffers) return 'offers_paused'
  return null
}

function currentFileScopeReady(
  project: ProjectCoordinatorProject,
  view: ProjectWorkerAvailabilityView
): boolean {
  const binding = project.provisioning.binding
  const readiness = view.contentReadiness
  const principal = view.providerPrincipalFact
  return project.project.contentMode === 'required' &&
    binding?.status === 'active' &&
    binding.rootLocator !== null &&
    binding.rootLocatorDigest !== null &&
    readiness?.state === 'ready' &&
    readiness.bindingRevision === binding.revision &&
    readiness.providerPrincipalFactId !== null &&
    readiness.snapshottedFactRevision !== null &&
    view.providerPrincipalSnapshotStatus === 'match' &&
    principal?.readiness === 'ready'
}

function ready(
  eligibleTaskScopes: readonly TaskAuthorityScope[]
): ProjectCoordinatorPlanningRuntimeReadiness {
  return Object.freeze({ eligible: true, reason: 'ready', eligibleTaskScopes })
}

function unavailable(
  reason: Exclude<ProjectCoordinatorPlanningReadinessReason, 'ready'>
): ProjectCoordinatorPlanningRuntimeReadiness {
  return Object.freeze({ eligible: false, reason, eligibleTaskScopes: [] })
}
