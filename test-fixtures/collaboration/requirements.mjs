import { createHash } from 'node:crypto'

// Shared test setup uses the same Owner save/confirm and membership commands as production.
export function requirementsContent(tasks, inputReferences = []) {
  return {
    goalsDeliverables: 'Produce the bounded, reviewable deliverables for this fixture.',
    inputsBoundaries: 'Use only the exact authorized inputs; preserve the declared dependencies.',
    inputReferences,
    workModules: tasks.map(({ planItemId, title, objective, dependencyPlanItemIds, requiredCapabilityTags }) => ({
      planItemId, title, objective, dependencyPlanItemIds,
      ...(requiredCapabilityTags?.length ? { requiredCapabilityTags } : {})
    })),
    acceptanceCriteria: [
      ...tasks.flatMap(({ planItemId, completionCriteria }) => (completionCriteria ?? ['Deliver the reviewable output.'])
        .map(criteria => ({ target: planItemId, criteria, evidenceMethod: 'Review the exact sealed Delivery.' }))),
      { target: '$project', criteria: 'All modules are adopted.', evidenceMethod: 'Owner review.' }
    ]
  }
}

export async function saveRequirementsFixture(service, repository, owner, projectId, content, key) {
  const project = await repository.getProject(projectId)
  return service.saveProjectRequirementsDraft(owner, {
    protocolVersion: '1.0', type: 'project.requirements.draft.save',
    requestId: `req_${key}_save`, idempotencyKey: `idem_${key}_save`,
    projectId, expectedProjectRevision: project.revision, expectedRequirementsRevision: 0,
    ...content
  })
}

export async function confirmRequirementsFixture(service, repository, owner, projectId, draft, workerUserIds, key) {
  let project = await repository.getProject(projectId)
  const confirmed = await service.confirmProjectRequirements(owner, {
    protocolVersion: '1.0', type: 'project.requirements.confirm',
    requestId: `req_${key}_confirm`, idempotencyKey: `idem_${key}_confirm`,
    projectId, requirementsDocumentId: draft.requirementsDocumentId,
    expectedProjectRevision: project.revision, expectedRequirementsRevision: draft.revision,
    contentDigest: draft.contentDigest
  })
  for (const userId of [...new Set(workerUserIds)].filter(id => id !== owner.userId)) {
    if (await repository.getProjectMember(projectId, userId)) continue
    project = await repository.getProject(projectId)
    await service.addProjectMembership(owner, {
      protocolVersion: '1.0', type: 'project.membership.add',
      requestId: `req_${key}_invite_${userId}`, idempotencyKey: `idem_${key}_invite_${userId}`,
      projectId, expectedProjectRevision: project.revision, userId
    })
  }
  return confirmed
}

export async function requirementsHttpFixture({ postCommand, baseUrl, ownerToken, project, tasks, workerUserIds, key, inputReferences = [] }) {
  const envelope = (type, suffix) => { const id = createHash('sha256').update(`${key}:${suffix}`).digest('hex').slice(0, 32); return { protocolVersion: '1.0', type, requestId: `req_${id}`, idempotencyKey: `idem_${id}` } }
  const saved = await postCommand(baseUrl, ownerToken, {
    ...envelope('project.requirements.draft.save', 'requirements'),
    projectId: project.projectId, expectedProjectRevision: project.revision,
    expectedRequirementsRevision: 0, ...requirementsContent(tasks, inputReferences)
  })
  const confirmed = (await postCommand(baseUrl, ownerToken, {
    ...envelope('project.requirements.confirm', 'confirm'),
    projectId: project.projectId, requirementsDocumentId: saved.entity.requirementsDocumentId,
    expectedProjectRevision: project.revision + 1, expectedRequirementsRevision: saved.entity.revision,
    contentDigest: saved.entity.contentDigest
  })).entity
  let revision = project.revision + 2
  for (const userId of [...new Set(workerUserIds)]) {
    await postCommand(baseUrl, ownerToken, {
      ...envelope('project.membership.add', `invite_${userId}`),
      projectId: project.projectId, expectedProjectRevision: revision++, userId
    })
  }
  return confirmed
}
