import { hash as sha256 } from 'fast-sha256'

import {
  projectPlanIdSchema,
  taskIdSchema,
  type TaskId
} from './core.js'
import { projectPlanTaskSchema } from './project-review.js'

/** Canonical Cloud Task identity for one immutable Project Plan item. */
export function canonicalTaskIdForPlanItem(
  projectPlanId: string,
  planItemId: string
): TaskId {
  const facts = {
    planItemId: projectPlanTaskSchema.shape.planItemId.parse(planItemId),
    projectPlanId: projectPlanIdSchema.parse(projectPlanId)
  }
  const digest = [...sha256(new TextEncoder().encode(JSON.stringify(facts)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return taskIdSchema.parse(`tsk_${digest.slice(0, 32)}`)
}
