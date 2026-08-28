import { createHash } from 'node:crypto'

import {
  projectPlanIdSchema,
  taskIdSchema,
  type TaskId
} from './core.js'
import { projectPlanTaskSchema } from './project-review.js'

/**
 * Canonical Cloud Task identity for one immutable Project Plan item.
 *
 * This Node-only entrypoint is shared by the collaboration server and trusted
 * domain main processes. Renderer/browser contracts stay free of Node builtins.
 */
export function canonicalTaskIdForPlanItem(
  projectPlanId: string,
  planItemId: string
): TaskId {
  const facts = {
    planItemId: projectPlanTaskSchema.shape.planItemId.parse(planItemId),
    projectPlanId: projectPlanIdSchema.parse(projectPlanId)
  }
  const digest = createHash('sha256')
    .update(JSON.stringify(facts), 'utf8')
    .digest('hex')
  return taskIdSchema.parse(`tsk_${digest.slice(0, 32)}`)
}
