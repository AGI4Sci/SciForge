import { capabilityRequirementsSatisfied } from '../capability-requirements.js'
import type { ProjectCoordinatorProject } from './contract.js'

/**
 * Deterministic Worker selection for requirements dispatch (design §9.22.2,
 * §9.22 item 7) — never a model call. A Worker User qualifies when one of
 * their Agents has an active membership, an online availability projection
 * with `acceptsNewOffers`, and public capability tags covering every module
 * tag (a module without tags qualifies every eligible Worker). Eligible
 * non-Owners take priority; the Owner is a fallback only when none remain.
 * Within that group, the least loaded candidate wins; `userId` is the stable
 * tiebreak. `excludeUserIds` removes previously failed assignments from the
 * candidate set.
 */
export function selectRequirementsWorker(
  workerGroups: ProjectCoordinatorProject['workerGroups'],
  ownerUserId: string,
  requiredCapabilityTags: readonly string[],
  excludeUserIds: readonly string[] = [],
  pendingOfferCounts: ReadonlyMap<string, number> = new Map()
): string | null {
  const excluded = new Set(excludeUserIds)
  const candidates: Array<Readonly<{ userId: string, activeTaskCount: number }>> = []
  for (const group of workerGroups) {
    if (excluded.has(group.userId)) continue
    const eligibleAgents = group.agents.filter(({ projectAvailability }) => (
      projectAvailability.membership?.state === 'active' &&
      projectAvailability.availability.connectionStatus === 'online' &&
      projectAvailability.availability.acceptsNewOffers &&
      capabilityRequirementsSatisfied(
        requiredCapabilityTags,
        projectAvailability.availability.runtimeCapabilityTags
      )
    ))
    if (eligibleAgents.length === 0) continue
    candidates.push({
      userId: group.userId,
      activeTaskCount: Math.min(
        ...eligibleAgents.map(({ projectAvailability }) => projectAvailability.availability.activeTaskCount)
      ) + (pendingOfferCounts.get(group.userId) ?? 0)
    })
  }
  candidates.sort((left, right) => (
    Number(left.userId === ownerUserId) - Number(right.userId === ownerUserId) ||
    left.activeTaskCount - right.activeTaskCount || compareCodePointOrder(left.userId, right.userId)
  ))
  return candidates[0]?.userId ?? null
}

function compareCodePointOrder(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (character) => character.codePointAt(0)!)
  const rightCodePoints = Array.from(right, (character) => character.codePointAt(0)!)
  const length = Math.min(leftCodePoints.length, rightCodePoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftCodePoints[index]! - rightCodePoints[index]!
    if (difference !== 0) return difference
  }
  return leftCodePoints.length - rightCodePoints.length
}
