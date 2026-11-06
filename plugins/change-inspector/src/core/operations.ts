import { changeInspectorListChangesInputSchema, changeInspectorListChangesOutputSchema, changeInspectorOpenInputSchema, changeInspectorOpenSessionResultSchema, type ChangeInspectorListChangesOutput, type ChangeInspectorOpenSessionResult } from '../contract.js'
import { changeInspectorResourceId, type ChangeInspectorService } from './service.js'

export async function openSession(service: ChangeInspectorService, rawInput: unknown): Promise<Readonly<{ output: ChangeInspectorOpenSessionResult }>> {
  const input = changeInspectorOpenInputSchema.parse(rawInput ?? {})
  const snapshot = await service.snapshot(input)
  return { output: changeInspectorOpenSessionResultSchema.parse({
    sessionId: snapshot.sessionId,
    resourceId: changeInspectorResourceId({ ...input, sessionId: snapshot.sessionId }),
    snapshot
  }) }
}

export async function listChanges(service: ChangeInspectorService, rawInput: unknown): Promise<Readonly<{ output: ChangeInspectorListChangesOutput }>> {
  const input = changeInspectorListChangesInputSchema.parse(rawInput ?? {})
  return { output: changeInspectorListChangesOutputSchema.parse(await service.listChanges(input)) }
}
