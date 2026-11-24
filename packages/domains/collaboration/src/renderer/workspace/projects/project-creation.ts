import {
  projectCoordinatorProjectCreateInputSchema,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult
} from '../../../coordinator/contract.js'

export type ProjectCreationRecovery = Extract<ProjectCoordinatorProjectCreateResult, {
  initializationState: 'session_pending'
}>

export type ProjectCreationAttempt = Readonly<{
  principalUserId: string
  input: ProjectCoordinatorProjectCreateInput
}>

/** Keep one input/intent for retry; a different form is an explicitly different intent. */
export function retainProjectCreationAttempt(
  previous: ProjectCreationAttempt | null,
  principalUserId: string,
  input: Omit<ProjectCoordinatorProjectCreateInput, 'createIntentId'>,
  createIntentId: () => string
): ProjectCreationAttempt {
  if (previous && previous.principalUserId !== principalUserId) {
    throw new Error('Clear the previous Project creation attempt before changing Principal.')
  }
  const parsed = projectCoordinatorProjectCreateInputSchema.parse({
    ...input,
    createIntentId: previous?.input.createIntentId ?? createIntentId()
  })
  if (previous && JSON.stringify(parsed) === JSON.stringify(previous.input)) return previous
  return Object.freeze({
    principalUserId,
    input: previous
      ? projectCoordinatorProjectCreateInputSchema.parse({ ...parsed, createIntentId: createIntentId() })
      : parsed
  })
}
