import { describe, expect, it } from 'vitest'

import {
  bindTaskFileDeclaration,
  portableContentSpaceLocatorSchema,
  taskFileDependencyInputSchema,
  taskFileDeclarationFromIntent,
  taskFileDeclarationSchema,
  taskFileDestinationNameSchema,
  taskExecutionFileIntentSchema,
  taskFileIntentSchema
} from './content-space-task-io.js'
import { projectContentSpaceBindingSchema } from './project-content.js'
import { restRequestSchema } from './protocol.js'
import { TEST_HASH, TEST_IDS, TEST_TIMESTAMP } from './testing.js'

const rootLocator = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: 'provider.instance.alpha',
  identity: { directoryId: 'shared-root-alpha' }
}
const fileLocator = {
  contractVersion: 1 as const,
  kind: 'content-space.file-reference' as const,
  authority: 'provider.instance.alpha',
  identity: { fileId: 'file-one' }
}

const fileDeclaration = {
  schemaVersion: 2 as const,
  inputs: [{
    kind: 'content-space.input-file' as const,
    locator: fileLocator,
    destinationName: 'input.csv',
    expectedSemanticRevision: null,
    expectedMediaType: 'text/csv'
  }],
  dependencyInputs: [],
  output: {
    kind: 'content-space.output-new' as const,
    target: 'project-binding-root' as const,
    mode: 'upload-new' as const,
    fileName: 'analysis.md',
    mediaType: 'text/markdown',
    maxBytes: 1_000_000
  }
}
const fileIntent = bindTaskFileDeclaration(fileDeclaration, 3)

describe('Project Content Space and Task file I/O contracts', () => {
  it('keeps Task file destinations portable and collision-free', () => {
    for (const destinationName of [
      'CON',
      'nul.txt',
      'report?.md',
      'report:.md',
      'trailing.',
      'σ.txt',
      'ς.txt',
      'ß.txt'
    ]) {
      expect(taskFileDestinationNameSchema.safeParse(destinationName).success).toBe(false)
    }
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [fileIntent.inputs[0], {
        ...fileIntent.inputs[0],
        locator: { ...fileLocator, identity: { fileId: 'file-two' } },
        destinationName: 'INPUT.csv'
      }]
    }).success).toBe(false)
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [{ ...fileIntent.inputs[0], destinationName: 'résumé.md' }, {
        ...fileIntent.inputs[0],
        locator: { ...fileLocator, identity: { fileId: 'file-two' } },
        destinationName: 'résumé.md'
      }]
    }).success).toBe(false)
  })

  it('keeps a new Task output distinct from every input on portable filesystems', () => {
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      output: { ...fileDeclaration.output, fileName: 'INPUT.csv' }
    }).success).toBe(false)
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      output: { ...fileIntent.output, fileName: 'INPUT.csv' }
    }).success).toBe(false)
    expect(taskExecutionFileIntentSchema.safeParse({
      schemaVersion: 1,
      type: 'task_execution_file_intent',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision: 4,
      bindingRevision: 3,
      declarationDigest: TEST_HASH,
      inputs: [{ resourceRefId: TEST_IDS.resourceRefId, destinationName: 'input.csv' }],
      output: {
        rootResourceRefId: 'rrf_OutputRoot001',
        fileName: 'INPUT.csv',
        mediaType: 'text/markdown',
        maxBytes: 1_000_000
      }
    }).success).toBe(false)
  })

  it('treats a portable envelope only as a bounded locator', () => {
    expect(portableContentSpaceLocatorSchema.parse(rootLocator)).toEqual(rootLocator)
    expect(portableContentSpaceLocatorSchema.safeParse({
      ...rootLocator,
      authorization: 'guessed'
    }).success).toBe(false)
  })

  it('separates the Plan declaration from Cloud Task and execution binding', () => {
    expect(taskFileDeclarationSchema.parse(fileDeclaration)).toEqual(fileDeclaration)
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      schemaVersion: 1
    }).success).toBe(false)
    expect(taskFileDeclarationSchema.safeParse(fileIntent).success).toBe(false)
    expect(taskFileIntentSchema.parse(fileIntent)).toEqual(fileIntent)
    expect(taskFileDeclarationFromIntent(fileIntent)).toEqual(fileDeclaration)
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId
    }).success).toBe(false)

    expect(taskExecutionFileIntentSchema.safeParse({
      schemaVersion: 1,
      type: 'task_execution_file_intent',
      projectId: TEST_IDS.projectId,
      taskId: TEST_IDS.taskId,
      executionId: TEST_IDS.executionId,
      assignmentTaskRevision: 4,
      bindingRevision: 3,
      declarationDigest: TEST_HASH,
      inputs: [{ resourceRefId: TEST_IDS.resourceRefId, destinationName: 'input.csv' }],
      output: {
        rootResourceRefId: 'rrf_OutputRoot001',
        fileName: 'analysis.md',
        mediaType: 'text/markdown',
        maxBytes: 1_000_000
      }
    }).success).toBe(true)
  })

  it('binds mixed static and dependency inputs in the exact declared order', () => {
    const declaration = {
      ...fileDeclaration,
      dependencyInputs: [{
        planItemId: 'item_source_one',
        outputIndex: 0,
        destinationName: 'source-one.md'
      }, {
        planItemId: 'item_source_two',
        outputIndex: 99,
        destinationName: 'source-two.md'
      }]
    }
    const resolvedDependencyInputs = [{
      kind: 'content-space.input-file' as const,
      locator: {
        ...fileLocator,
        identity: { fileId: 'cloud-source-one' }
      },
      destinationName: 'source-one.md',
      expectedSemanticRevision: null,
      expectedMediaType: null
    }, {
      kind: 'content-space.input-file' as const,
      locator: {
        ...fileLocator,
        identity: { fileId: 'cloud-source-two' }
      },
      destinationName: 'source-two.md',
      expectedSemanticRevision: null,
      expectedMediaType: null
    }]

    expect(bindTaskFileDeclaration(declaration, 7, resolvedDependencyInputs)).toEqual({
      schemaVersion: 1,
      inputs: [...declaration.inputs, ...resolvedDependencyInputs],
      output: declaration.output,
      bindingRevision: 7
    })
    expect(() => bindTaskFileDeclaration(
      declaration,
      7,
      [...resolvedDependencyInputs].reverse()
    )).toThrow(/declared destination order/u)
  })

  it('bounds dependency selectors and rejects ambiguous declaration input roles', () => {
    const selector = {
      planItemId: 'item_source_one',
      outputIndex: 0,
      destinationName: 'source-one.md'
    }
    expect(taskFileDependencyInputSchema.safeParse(selector).success).toBe(true)
    expect(taskFileDependencyInputSchema.safeParse({ ...selector, outputIndex: 99 }).success).toBe(true)
    for (const outputIndex of [-1, 0.5, 100]) {
      expect(taskFileDependencyInputSchema.safeParse({ ...selector, outputIndex }).success).toBe(false)
    }

    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      dependencyInputs: [selector, {
        ...selector,
        destinationName: 'same-output-again.md'
      }]
    }).success).toBe(false)
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      dependencyInputs: [selector, {
        ...selector,
        outputIndex: 1,
        destinationName: 'source-one-second-output.md'
      }]
    }).success).toBe(true)
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      dependencyInputs: [{
        ...selector,
        destinationName: fileDeclaration.inputs[0]!.destinationName
      }]
    }).success).toBe(false)

    const staticInputs = Array.from({ length: 100 }, (_, index) => ({
      ...fileDeclaration.inputs[0]!,
      locator: {
        ...fileDeclaration.inputs[0]!.locator,
        identity: { fileId: `static-file-${index}` }
      },
      destinationName: `static-${index}.csv`
    }))
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      inputs: staticInputs.slice(0, 99),
      dependencyInputs: [selector]
    }).success).toBe(true)
    expect(taskFileDeclarationSchema.safeParse({
      ...fileDeclaration,
      inputs: staticInputs,
      dependencyInputs: [selector]
    }).success).toBe(false)
  })

  it('uses task.offer.create as the only initial Task dispatch path', () => {
    const request = {
      protocolVersion: '1.0' as const,
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_task_offer_create_01',
      type: 'task.offer.create' as const,
      projectId: TEST_IDS.projectId,
      expectedProjectRevision: 3,
      expectedCoordinatorAuthorityEpoch: 2,
      expectedExecutionAuthorityEpoch: 1,
      projectPlanId: 'pln_ProjectPlan01',
      expectedPlanRevision: 1,
      planItemId: 'item_analysis01',
      offerExpiresAt: '2026-08-15T09:00:00.000Z'
    }
    expect(restRequestSchema.safeParse(request).success).toBe(true)
    expect(restRequestSchema.safeParse({ ...request, title: 'Duplicated plan title' }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...request, fileIntent }).success).toBe(false)
    expect(restRequestSchema.safeParse({ ...request, type: 'task.create' }).success).toBe(false)
  })

  it('rejects duplicate locators, unsafe destinations, and legacy generic transitions', () => {
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [fileIntent.inputs[0], { ...fileIntent.inputs[0], destinationName: 'other.csv' }]
    }).success).toBe(false)
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [{ ...fileIntent.inputs[0], destinationName: '../escape' }]
    }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0', requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_task_transition_01', type: 'task.transition',
      taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      expectedRevision: 1, status: 'running'
    }).success).toBe(false)
  })

  it('stores binding metadata without Provider authorization proof or scopes', () => {
    const binding = projectContentSpaceBindingSchema.parse({
      schemaVersion: 1,
      type: 'project_content_space_binding',
      projectContentBindingId: 'pcb_Binding000001',
      projectId: TEST_IDS.projectId,
      contentOwnerUserId: TEST_IDS.userId,
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        providerInstanceRef: 'provider-instance-alpha'
      },
      rootLocator,
      rootLocatorDigest: TEST_HASH,
      provisioningIntentId: 'pci_Provision00001',
      provisioningRevision: 3,
      attestationId: 'pca_Attest0000001',
      attestationDigest: TEST_HASH,
      status: 'active',
      statusReason: null,
      activatedAt: TEST_TIMESTAMP,
      degradedAt: null,
      closedAt: null,
      revision: 3,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
    expect(JSON.stringify(binding)).not.toMatch(/authorization|credential|scope|token/iu)
    expect(projectContentSpaceBindingSchema.safeParse({ ...binding, authorizationProof: 'legacy-proof' }).success).toBe(false)
    expect(projectContentSpaceBindingSchema.safeParse({
      ...binding,
      status: 'closed',
      statusReason: 'project_archived',
      degradedAt: TEST_TIMESTAMP,
      closedAt: '2026-08-15T08:02:00.000Z'
    }).success).toBe(true)
  })

  it('represents pre-Provider provisioning without claiming that a root already exists', () => {
    const provisioning = projectContentSpaceBindingSchema.parse({
      schemaVersion: 1,
      type: 'project_content_space_binding',
      projectContentBindingId: 'pcb_Provisioning001',
      projectId: TEST_IDS.projectId,
      contentOwnerUserId: TEST_IDS.userId,
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        providerInstanceRef: 'provider-instance-alpha'
      },
      rootLocator: null,
      rootLocatorDigest: null,
      provisioningIntentId: 'pci_Provision00001',
      provisioningRevision: 1,
      attestationId: null,
      attestationDigest: null,
      status: 'provisioning',
      statusReason: 'provisioning_incomplete',
      activatedAt: null,
      degradedAt: null,
      closedAt: null,
      revision: 1,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })

    expect(provisioning.rootLocator).toBeNull()
    expect(provisioning.attestationId).toBeNull()
  })
})
