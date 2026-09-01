import type {
  ProjectCoordinatorSessionBinding,
  ProjectCoordinatorSessionProjection
} from '../contract.js'

export function projectCoordinatorSessionBindingForOrdinarySession(
  projection: ProjectCoordinatorSessionProjection,
  runtimeIdInput: string | null | undefined,
  threadIdInput: string | null | undefined
): ProjectCoordinatorSessionBinding | null {
  const runtimeId = runtimeIdInput?.trim()
  const threadId = threadIdInput?.trim()
  if (!runtimeId || !threadId) return null
  return projection.bindings.find((binding) => (
    binding.runtimeId === runtimeId && binding.threadId === threadId
  )) ?? null
}
