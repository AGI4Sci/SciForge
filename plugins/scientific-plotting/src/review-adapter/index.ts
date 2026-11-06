import {
  ARTIFACT_VERSION_COMMIT_CONTRACT,
  ARTIFACT_VERSION_READ_CONTRACT,
  artifactVersionCommitResultV1Schema,
  artifactVersionReadResultV1Schema
} from '@sciforge/domain-artifact-versions/contract'
import type { ScientificPlottingCapabilitiesPort } from '../ports/capabilities.js'
import { createVisualReviewOperations, type VisualReviewOperations } from '../review/operations.js'

export { registerVisualReviewTools, visualReviewTools, EXPECTED_REVIEW_HOST_GRANTS } from './tools.js'
export type { DshToolDefinition } from './tools.js'

/**
 * Called by the unified plotting entrypoint with its admitted artifact invoker.
 * There is no second apply(), plugin identity, host channel, or service provider.
 * Missing artifacts keep version-bound open and acceptance fail-closed.
 */
export function createReviewOperations(
  capabilities?: ScientificPlottingCapabilitiesPort
): VisualReviewOperations {
  return createVisualReviewOperations(capabilities ? {
    artifacts: {
      commit: async (input, workspaceRoot) => artifactVersionCommitResultV1Schema.parse(
        await capabilities.invoke(ARTIFACT_VERSION_COMMIT_CONTRACT, input, {
          workspaceId: workspaceRoot,
          idempotencyKey: input.idempotencyKey
        })
      ),
      read: async (input, workspaceRoot) => artifactVersionReadResultV1Schema.parse(
        await capabilities.invoke(ARTIFACT_VERSION_READ_CONTRACT, input, {
          workspaceId: workspaceRoot
        })
      )
    }
  } : {})
}
