import { z } from 'zod'

import {
  entityMetadataShape,
  nonEmptyTextSchema,
  planItemIdSchema,
  projectIdSchema,
  revisionSchema,
  sha256Schema,
  timestampSchema,
  userIdSchema
} from './core.js'
import { collaborationObjectLocatorSchema } from './task-object-io.js'

/**
 * One work module of the requirements document. The stable ID is the
 * workItemId of the canonical Task identity
 * (projectId, requirementsBaselineId, workItemId).
 */
export const requirementsWorkModuleSchema = z.object({
  planItemId: planItemIdSchema,
  title: nonEmptyTextSchema.max(500),
  objective: nonEmptyTextSchema.max(4_000),
  dependencyPlanItemIds: z.array(planItemIdSchema).max(100),
  /**
   * Tags the deterministic Worker selection (design §9.22.2) must cover;
   * absent or empty qualifies every eligible Worker.
   */
  requiredCapabilityTags: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u))
    .max(256)
    .optional()
}).strict()
export type RequirementsWorkModule = z.infer<typeof requirementsWorkModuleSchema>

/** One acceptance criterion targeting one module or the whole project. */
export const requirementsAcceptanceCriterionSchema = z.object({
  target: z.union([planItemIdSchema, z.literal('$project')]),
  criteria: nonEmptyTextSchema.max(2_000),
  evidenceMethod: nonEmptyTextSchema.max(2_000)
}).strict()
export type RequirementsAcceptanceCriterion = z.infer<
  typeof requirementsAcceptanceCriterionSchema
>

const uniqueModuleIds = (modules: readonly Readonly<{ planItemId: string }>[]): boolean => (
  new Set(modules.map(({ planItemId }) => planItemId)).size === modules.length
)

export const projectRequirementsDocumentIdSchema = z.string().regex(/^rqd_[A-Za-z0-9]{20,}$/u)

const dependenciesAcyclic = (
  modules: readonly Readonly<{ planItemId: string; dependencyPlanItemIds: readonly string[] }>[]
): boolean => {
  const ids = new Set(modules.map(({ planItemId }) => planItemId))
  const edges = new Map(modules.map(({ planItemId, dependencyPlanItemIds }) => [
    planItemId,
    dependencyPlanItemIds.filter((candidate) => ids.has(candidate))
  ]))
  for (const { dependencyPlanItemIds } of modules) {
    if (dependencyPlanItemIds.some((candidate) => !ids.has(candidate))) return false
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): boolean => {
    if (done.has(id)) return true
    if (visiting.has(id)) return false
    visiting.add(id)
    for (const next of edges.get(id) ?? []) {
      if (!visit(next)) return false
    }
    visiting.delete(id)
    done.add(id)
    return true
  }
  return modules.every(({ planItemId }) => visit(planItemId))
}

export const requirementsWorkModulesSchema = z.array(requirementsWorkModuleSchema)
  .max(100)
  .superRefine((modules, context) => {
    if (!uniqueModuleIds(modules)) {
      context.addIssue({ code: 'custom', message: 'Work module stable IDs must be unique.' })
    }
    if (!dependenciesAcyclic(modules)) {
      context.addIssue({
        code: 'custom',
        message: 'Work module dependencies must reference existing modules without cycles.'
      })
    }
  })
export type RequirementsWorkModules = z.infer<typeof requirementsWorkModulesSchema>

/** Acceptance criteria part; module coverage is validated by the completeness check. */
export const requirementsAcceptanceCriteriaSchema = z.array(requirementsAcceptanceCriterionSchema)
  .max(200)
export type RequirementsAcceptanceCriteria = z.infer<typeof requirementsAcceptanceCriteriaSchema>

export const requirementsDocumentPartsSchema = z.object({
  goalsDeliverables: z.string().trim().max(16_000),
  inputsBoundaries: z.string().trim().max(16_000),
  inputReferences: z.array(collaborationObjectLocatorSchema).max(100),
  workModules: requirementsWorkModulesSchema,
  acceptanceCriteria: requirementsAcceptanceCriteriaSchema
}).strict()
export type RequirementsDocumentParts = z.infer<typeof requirementsDocumentPartsSchema>

/**
 * The full confirm-time completeness matrix (design §9.22.1): all four parts
 * present, module references valid, every module covered and at least one
 * project-level criterion. Returns the first violation key or null.
 */
export function requirementsCompletenessViolation(
  parts: RequirementsDocumentParts
): 'parts_missing' | 'module_uncovered' | 'project_criterion_missing' | 'criterion_target_unknown' | null {
  if (
    !parts.goalsDeliverables.trim() ||
    !parts.inputsBoundaries.trim() ||
    parts.workModules.length === 0 ||
    parts.acceptanceCriteria.length === 0
  ) return 'parts_missing'
  const moduleIds = new Set(parts.workModules.map(({ planItemId }) => planItemId))
  if (parts.acceptanceCriteria.some(({ target }) => target !== '$project' && !moduleIds.has(target))) {
    return 'criterion_target_unknown'
  }
  if (parts.workModules.some(({ planItemId }) => (
    !parts.acceptanceCriteria.some(({ target }) => target === planItemId)
  ))) return 'module_uncovered'
  if (!parts.acceptanceCriteria.some(({ target }) => target === '$project')) {
    return 'project_criterion_missing'
  }
  return null
}

export const requirementsDocumentStateSchema = z.enum(['draft', 'confirmed', 'superseded'])
export type RequirementsDocumentState = z.infer<typeof requirementsDocumentStateSchema>

/** The stored versioned requirements document row, projected to project members. */
export const projectRequirementsDocumentSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_requirements_document'),
  requirementsDocumentId: projectRequirementsDocumentIdSchema,
  projectId: projectIdSchema,
  documentRevision: revisionSchema,
  state: requirementsDocumentStateSchema,
  goalsDeliverables: z.string().trim().max(16_000),
  inputsBoundaries: z.string().trim().max(16_000),
  inputReferences: z.array(collaborationObjectLocatorSchema).max(100),
  workModules: requirementsWorkModulesSchema,
  acceptanceCriteria: requirementsAcceptanceCriteriaSchema,
  contentDigest: sha256Schema,
  confirmedByUserId: userIdSchema.nullable(),
  confirmedAt: timestampSchema.nullable(),
  supersededAt: timestampSchema.nullable()
}).strict().superRefine((document, context) => {
  if ((document.confirmedByUserId === null) !== (document.confirmedAt === null)) {
    context.addIssue({
      code: 'custom',
      path: ['confirmedAt'],
      message: 'Confirmation actor and time must be set together.'
    })
  }
  // Only a draft may lack a confirmer; confirmed and superseded rows always
  // retain who confirmed that exact version (design §9.22.1).
  if (document.state !== 'draft' && document.confirmedByUserId === null) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'Confirmed and superseded requirements documents retain the confirming Owner.'
    })
  }
  if (document.state === 'draft' && document.confirmedByUserId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'A draft cannot carry confirmation facts.'
    })
  }
  if ((document.state === 'superseded') !== (document.supersededAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['supersededAt'],
      message: 'Supersession time tracks the superseded state exactly.'
    })
  }
})
export type ProjectRequirementsDocument = z.infer<typeof projectRequirementsDocumentSchema>

/** Bounded invitation projection for an unconfirmed draft; no requirements body is disclosed. */
export const projectRequirementsDocumentSummarySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_requirements_document'),
  requirementsDocumentId: projectRequirementsDocumentIdSchema,
  projectId: projectIdSchema,
  documentRevision: revisionSchema,
  state: z.literal('draft'),
  contentDigest: sha256Schema
}).strict().readonly()
export type ProjectRequirementsDocumentSummary = z.infer<
  typeof projectRequirementsDocumentSummarySchema
>
