import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  projectRequirementsConfirmCommandSchema,
  projectRequirementsCompletionSaveCommandSchema,
  projectRequirementsDraftSaveCommandSchema
} from './cloud-state-protocol.js'
import {
  projectRequirementsDocumentSchema,
  requirementsCompletenessViolation,
  requirementsDocumentPartsSchema
} from './project-requirements.js'
import { projectRequirementsConfirmedPayloadSchema } from './protocol.js'

const moduleOne = {
  planItemId: 'item_qc_thresholds',
  title: 'QC threshold scheme design analysis',
  objective: 'Produce the bounded QC threshold design.',
  dependencyPlanItemIds: []
}
const moduleTwo = {
  planItemId: 'item_ai_annotation',
  title: 'AI cell type annotation design analysis',
  objective: 'Produce the annotation design.',
  dependencyPlanItemIds: ['item_qc_thresholds']
}
const criteria = [
  { target: 'item_qc_thresholds', criteria: 'The threshold table is reviewable.', evidenceMethod: 'Owner reads the table.' },
  { target: 'item_ai_annotation', criteria: 'The marker choice is justified.', evidenceMethod: 'Owner reads the justification.' },
  { target: '$project', criteria: 'One integrated design package exists.', evidenceMethod: 'Owner reviews the package.' }
]
const parts = {
  goalsDeliverables: 'Deliver one QC and annotation design package.',
  inputsBoundaries: 'Design only; no experiment execution.',
  inputReferences: [],
  workModules: [moduleOne, moduleTwo],
  acceptanceCriteria: criteria
}

test('requirements parts accept a complete valid document', () => {
  assert.deepEqual(requirementsDocumentPartsSchema.parse(parts), parts)
  assert.equal(requirementsCompletenessViolation(parts), null)
})

test('requirements validation rejects duplicate modules, missing deps, cycles and uncovered modules', () => {
  assert.throws(() => requirementsDocumentPartsSchema.parse({
    ...parts,
    workModules: [moduleOne, moduleOne]
  }), /unique/u)
  assert.throws(() => requirementsDocumentPartsSchema.parse({
    ...parts,
    workModules: [{ ...moduleTwo, dependencyPlanItemIds: ['item_missing'] }]
  }), /dependencies/u)
  assert.throws(() => requirementsDocumentPartsSchema.parse({
    ...parts,
    workModules: [
      { ...moduleOne, dependencyPlanItemIds: ['item_ai_annotation'] },
      { ...moduleTwo, dependencyPlanItemIds: ['item_qc_thresholds'] }
    ]
  }), /cycles/u)
  assert.equal(requirementsCompletenessViolation({
    ...parts,
    acceptanceCriteria: criteria.filter(({ target }) => target !== 'item_ai_annotation')
  }), 'module_uncovered')
  assert.equal(requirementsCompletenessViolation({
    ...parts,
    acceptanceCriteria: criteria.filter(({ target }) => target !== '$project')
  }), 'project_criterion_missing')
  assert.equal(requirementsCompletenessViolation({
    ...parts,
    acceptanceCriteria: [{ target: 'item_missing', criteria: 'x', evidenceMethod: 'y' }, ...criteria]
  }), 'criterion_target_unknown')
  assert.equal(requirementsCompletenessViolation({ ...parts, goalsDeliverables: ' ' }), 'parts_missing')
})

test('requirements document entity enforces the state shape and confirmer retention', () => {
  const base = {
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-10-17T08:00:00.000Z',
    updatedAt: '2026-10-17T08:00:00.000Z',
    type: 'project_requirements_document',
    requirementsDocumentId: 'rqd_0123456789abcdefghij',
    projectId: 'prj_0123456789abcdef0123456789abcdef',
    documentRevision: 1,
    goalsDeliverables: parts.goalsDeliverables,
    inputsBoundaries: parts.inputsBoundaries,
    inputReferences: [],
    workModules: parts.workModules,
    acceptanceCriteria: parts.acceptanceCriteria,
    contentDigest: 'a'.repeat(64)
  }
  assert.equal(projectRequirementsDocumentSchema.safeParse({
    ...base, state: 'draft', confirmedByUserId: null, confirmedAt: null, supersededAt: null
  }).success, true)
  // A superseded row must retain its confirmer (design §9.22.1).
  assert.equal(projectRequirementsDocumentSchema.safeParse({
    ...base,
    state: 'superseded',
    confirmedByUserId: 'usr_0123456789abcdef0123456789abcdef',
    confirmedAt: '2026-10-17T08:00:00.000Z',
    supersededAt: '2026-10-17T09:00:00.000Z'
  }).success, true)
  assert.equal(projectRequirementsDocumentSchema.safeParse({
    ...base, state: 'superseded', confirmedByUserId: null, confirmedAt: null,
    supersededAt: '2026-10-17T09:00:00.000Z'
  }).success, false)
  assert.equal(projectRequirementsDocumentSchema.safeParse({
    ...base, state: 'draft', confirmedByUserId: 'usr_0123456789abcdef0123456789abcdef',
    confirmedAt: '2026-10-17T08:00:00.000Z', supersededAt: null
  }).success, false)
})

test('requirements command schemas bind exact revisions and parts', () => {
  const base = {
    protocolVersion: '1.0',
    requestId: 'req_0123456789abcdef0123456789abcdef',
    idempotencyKey: 'idem_0123456789abcdef0123456789abcdef',
    projectId: 'prj_0123456789abcdef0123456789abcdef'
  }
  const draftSave = projectRequirementsDraftSaveCommandSchema.parse({
    ...base,
    type: 'project.requirements.draft.save',
    expectedProjectRevision: 3,
    expectedRequirementsRevision: 0,
    ...parts
  })
  assert.equal(draftSave.expectedRequirementsRevision, 0)
  const completion = projectRequirementsCompletionSaveCommandSchema.parse({
    ...base,
    type: 'project.requirements.completion.save',
    expectedProjectRevision: 3,
    expectedCoordinatorAuthorityEpoch: 2,
    expectedRequirementsRevision: 1,
    workModules: parts.workModules,
    acceptanceCriteria: parts.acceptanceCriteria
  })
  assert.equal(completion.expectedCoordinatorAuthorityEpoch, 2)
  assert.throws(() => projectRequirementsCompletionSaveCommandSchema.parse({
    ...base,
    type: 'project.requirements.completion.save',
    expectedProjectRevision: 3,
    expectedRequirementsRevision: 1,
    workModules: parts.workModules,
    acceptanceCriteria: parts.acceptanceCriteria
  }), /expectedCoordinatorAuthorityEpoch/u)
  const confirm = projectRequirementsConfirmCommandSchema.parse({
    ...base,
    type: 'project.requirements.confirm',
    requirementsDocumentId: 'rqd_0123456789abcdefghij',
    expectedProjectRevision: 3,
    expectedRequirementsRevision: 1,
    contentDigest: 'a'.repeat(64)
  })
  assert.equal(confirm.contentDigest.length, 64)
  // Owner commands carry no Coordinator authority epoch (design §9.22.1).
  assert.equal('expectedCoordinatorAuthorityEpoch' in draftSave, false)
  assert.equal('expectedCoordinatorAuthorityEpoch' in confirm, false)
})

test('requirements.confirmed is the only dispatch trigger payload shape', () => {
  const payload = projectRequirementsConfirmedPayloadSchema.parse({
    protocolVersion: '1.0',
    type: 'project.requirements.confirmed',
    projectId: 'prj_0123456789abcdef0123456789abcdef',
    requirementsDocumentId: 'rqd_0123456789abcdefghij',
    documentRevision: 1,
    contentDigest: 'a'.repeat(64)
  })
  assert.equal(payload.type, 'project.requirements.confirmed')
})
