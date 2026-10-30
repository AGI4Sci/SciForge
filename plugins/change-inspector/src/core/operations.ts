import {
  changeInspectorListChangesInputSchema,
  changeInspectorOpenInputSchema,
  changeInspectorOpenSessionResultSchema,
  type ChangeInspectorOpenSessionResult
} from '../contract.js'
import {
  changeInspectorResourceId,
  type ChangeInspectorService
} from './service.js'

export type ChangeInspectorOperationResult = Readonly<{
  output: ChangeInspectorOpenSessionResult
}>

/**
 * Capability orchestration equivalent to the static `open-session` handler,
 * minus the Broker resource issuance (G3: the host thin layer wraps this
 * result into the observed resource). The workspace root arrives as an
 * explicit argument because the host does not forward caller identity into
 * tool arguments yet (G1).
 */
export async function listChanges(service: ChangeInspectorService, rawInput: unknown, workspaceRoot: string) {
  const input = changeInspectorListChangesInputSchema.parse(rawInput)
  const root = workspaceRoot.trim()
  if (!root) throw new Error('Change Inspector requires an active workspace.')
  return { output: await service.listChanges(input, root) }
}

export async function openSession(
  service: ChangeInspectorService,
  rawInput: unknown,
  workspaceRoot: string
): Promise<ChangeInspectorOperationResult> {
  const input = changeInspectorOpenInputSchema.parse(rawInput)
  const root = workspaceRoot.trim()
  if (!root) throw new Error('Change Inspector requires an active workspace.')
  const resourceId = changeInspectorResourceId(input)
  const snapshot = await service.snapshot(input, root)
  return {
    output: changeInspectorOpenSessionResultSchema.parse({
      sessionId: input.sessionId,
      resourceId,
      snapshot
    })
  }
}
