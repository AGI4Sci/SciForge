/**
 * One executable-capability rule shared by every Task authority path:
 * requirements completion, Worker selection, the Owner's manual assignment,
 * and the Worker Device preflight. A Task may only require tags that the
 * exact runtime provides; topical labels are never executable requirements.
 */
export function unmetCapabilityTags(
  requiredCapabilityTags: readonly string[],
  availableCapabilityTags: readonly string[]
): readonly string[] {
  return [...new Set(requiredCapabilityTags.filter((tag) => (
    !availableCapabilityTags.includes(tag)
  )))]
}

export function capabilityRequirementsSatisfied(
  requiredCapabilityTags: readonly string[],
  availableCapabilityTags: readonly string[]
): boolean {
  return unmetCapabilityTags(requiredCapabilityTags, availableCapabilityTags).length === 0
}
