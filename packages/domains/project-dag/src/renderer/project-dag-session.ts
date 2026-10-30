/**
 * Returns the canonical Project/Evidence Session identity used by runtime
 * contracts. Workbench sessions expose the thread id separately from the
 * runtime id; callers must not send a workspace-wide sentinel or a bare
 * thread id to Project updates.
 */
export function projectDagCanonicalSessionId(
  sessionId: string,
  runtimeId?: string
): string | null {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return null
  const normalizedRuntimeId = runtimeId?.trim()
  // A colon in a bare thread id is valid opaque data, not proof that the
  // caller supplied the canonical runtime/thread pair. Without the runtime
  // owner we cannot safely derive Project/Evidence scope.
  if (!normalizedRuntimeId) return null
  // The Host exposes the runtime and thread components separately. A colon in
  // either opaque component is valid data, so a renderer cannot infer whether
  // an incoming string is already canonical without risking the wrong Session.
  // Always compose the identity from the structured fields instead.
  return `${normalizedRuntimeId}:${normalizedSessionId}`
}
