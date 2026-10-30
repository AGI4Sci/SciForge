import { hash as sha256 } from 'fast-sha256'

import {
  planItemIdSchema,
  projectPlanIdSchema,
  taskIdSchema,
  type TaskId
} from './core.js'
import { projectRequirementsDocumentIdSchema } from './project-requirements.js'

/** Canonical Cloud Task identity for one immutable Project Plan item. */
export function canonicalTaskIdForPlanItem(
  projectPlanId: string,
  planItemId: string
): TaskId {
  const facts = {
    planItemId: planItemIdSchema.parse(planItemId),
    projectPlanId: projectPlanIdSchema.parse(projectPlanId)
  }
  const digest = [...sha256(new TextEncoder().encode(JSON.stringify(facts)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return taskIdSchema.parse(`tsk_${digest.slice(0, 32)}`)
}

/**
 * Canonical Cloud Task identity for one work module of a confirmed
 * requirements document row (design §9.22.2): the requirementsBaselineId is
 * the confirmed row's own requirementsDocumentId.
 */
export function canonicalTaskIdForRequirementsModule(
  requirementsDocumentId: string,
  planItemId: string
): TaskId {
  const facts = {
    planItemId: planItemIdSchema.parse(planItemId),
    requirementsDocumentId: projectRequirementsDocumentIdSchema.parse(requirementsDocumentId)
  }
  const digest = [...sha256(new TextEncoder().encode(JSON.stringify(facts)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return taskIdSchema.parse(`tsk_${digest.slice(0, 32)}`)
}
