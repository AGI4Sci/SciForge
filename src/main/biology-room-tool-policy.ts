const NON_DESTRUCTIVE_BIOLOGY_ROOM_OPERATIONS = new Set([
  'setActiveAsset',
  'setSelection',
  'setViewport',
  'setTrackVisibility',
  'setMolecularView'
])

/**
 * Viewer-only operations can proceed without interrupting an agent turn.
 * Persistent mutations, malformed requests, and operation types introduced by
 * a newer schema fail closed and must pass the approval gate. A dry run cannot
 * mutate room state, so it never needs approval.
 */
export function biologyRoomApplyRequiresApproval(args: Record<string, unknown>): boolean {
  if (args.dryRun === true) return false
  if (!Array.isArray(args.operations) || args.operations.length === 0) return true
  return args.operations.some((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return true
    const type = (operation as { type?: unknown }).type
    return typeof type !== 'string' || !NON_DESTRUCTIVE_BIOLOGY_ROOM_OPERATIONS.has(type)
  })
}
