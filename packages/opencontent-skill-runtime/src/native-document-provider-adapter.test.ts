import { describe, expect, it, vi } from 'vitest'

import type {
  ContentSpaceNativeDocumentExecutor
} from '@sciforge/domain-content-space/provider-features'

import {
  DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
  docflowCommandInvocationSchema,
  type DocflowCommandInvocation,
  type DocflowNativeDocumentAdapter,
  type DocflowNativeDocumentReceipt
} from './docflow-native-document-adapter.js'
import {
  createNativeDocumentProviderAdapter,
  mapNativeDocumentExportFormat
} from './native-document-provider-adapter.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const INVOCATION_ID = 'invocation_native_provider_0001'
const BASE_HASH = 'a'.repeat(64)
const NEXT_HASH = 'b'.repeat(64)
const ROOT = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'container-one'
})
const FILE = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  fileId: 'document-one'
})
const DOCUMENT = Object.freeze({
  resourceType: 'native_document' as const,
  reference: FILE
})
const PRINCIPAL = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'native-document-provider-adapter-test',
  identityVersion: 1
})
const ADAPTER_OWNER = Object.freeze({
  role: 'adapter-owner' as const,
  moduleId: 'sciforge.opencontent-content-space-provider' as const,
  moduleVersion: '1.0.0'
})

type FeatureInput = Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0]

function featureInput(
  operation: FeatureInput['operation'],
  request: unknown,
  options: Readonly<{
    source?: FeatureInput['source']
    destination?: FeatureInput['destination']
    invocationId?: string
  }> = {}
): FeatureInput {
  const read = operation === 'read' || operation === 'probe' || operation === 'plan' ||
    operation === 'comment-list' || operation === 'comment-get'
  const context = {
    principal: PRINCIPAL,
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    invocationId: options.invocationId ?? INVOCATION_ID,
    deadlineAt: '2026-08-20T12:00:00+08:00',
    assertPrincipalCurrent: () => undefined,
    ...(read ? {} : { signal: new AbortController().signal })
  }
  return {
    effect: read
      ? 'read'
      : operation === 'image-download' || operation === 'export'
        ? 'workspace-write'
        : operation === 'comment-delete'
          ? 'destructive'
          : 'external-write',
    context,
    target: {
      kind: 'content',
      root: ROOT,
      primary: operation === 'create' || operation === 'import' ? ROOT : FILE,
      authorized: [operation === 'create' || operation === 'import' ? ROOT : FILE]
    },
    operation,
    request,
    ...(options.source ? { source: options.source } : {}),
    ...(options.destination ? { destination: options.destination } : {})
  } as FeatureInput
}

function failureReceipt(invocation: DocflowCommandInvocation): DocflowNativeDocumentReceipt {
  return {
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'failed',
    error: {
      code: 'provider_unavailable',
      message: 'fixture provider unavailable',
      retry: 'never'
    }
  }
}

function successReceipt(
  invocation: DocflowCommandInvocation,
  input: Readonly<{
    json: Extract<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>['json']
    delivery?: readonly [ReturnType<typeof delivery>]
    managed?: readonly {
      role: 'probe-template' | 'edit-plan'
      token: string
      name: string
      mediaType: 'application/json'
    }[]
  }>
): DocflowNativeDocumentReceipt {
  return {
    protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
    invocationId: invocation.invocationId,
    command: invocation.command,
    attemptCount: 1,
    outcome: 'succeeded',
    json: input.json,
    structuredDeliveryItems: input.delivery ?? [],
    managedDataFiles: input.managed ?? []
  }
}

function delivery(fileId: string = FILE.fileId, name = 'Document.mdoc') {
  return {
    protocol: 'docflowCard:v1' as const,
    outcome: 'succeeded' as const,
    businessIdentity: fileId,
    payload: {
      projectId: fileId,
      name,
      accessUrl: `https://provider.invalid/preview/${fileId}`,
      updateTime: '2026-08-20T10:00:00+08:00'
    }
  }
}

function source(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    read: vi.fn(async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
      bytes.slice(offset, offset + length))
  }
}

function canonicalPlanningReceipt(
  invocation: DocflowCommandInvocation,
  probeToken: string,
  planToken: string
): DocflowNativeDocumentReceipt | undefined {
  if (invocation.command === 'docflow-probe') {
    return successReceipt(invocation, {
      json: {
        success: true,
        documentHash: BASE_HASH,
        capabilities: { supported: true },
        selection: {
          editTarget: { targetText: 'Old text', occurrence: 1 },
          range: { start: 0, end: 8, unit: 'utf16' },
          oldText: 'Old text'
        }
      },
      managed: [{
        role: 'probe-template',
        token: probeToken,
        name: 'probe-template.json',
        mediaType: 'application/json'
      }]
    })
  }
  if (invocation.command === 'docflow-plan') {
    return successReceipt(invocation, {
      json: {
        success: true,
        canApply: true,
        baseDocumentHash: BASE_HASH
      },
      managed: [{
        role: 'edit-plan',
        token: planToken,
        name: 'edit-plan.json',
        mediaType: 'application/json'
      }]
    })
  }
  return undefined
}

async function establishEditPlan(
  adapter: ReturnType<typeof createNativeDocumentProviderAdapter>,
  suffix: string
): Promise<string> {
  const selector = { kind: 'text' as const, text: 'Old text', occurrence: 1 }
  const probe = await adapter.execute(featureInput('probe', {
    operation: 'probe',
    document: DOCUMENT,
    selector,
    requestedCapability: 'replace_text'
  }, { invocationId: `invocation_native_probe_${suffix}` }))
  if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
    throw new Error('Expected a successful probe fixture.')
  }
  const plan = await adapter.execute(featureInput('plan', {
    operation: 'plan',
    document: DOCUMENT,
    probeReceiptId: probe.result.probeReceiptId,
    baseHash: BASE_HASH,
    changes: [{
      kind: 'replace_text',
      target: selector,
      value: 'New text'
    }]
  }, { invocationId: `invocation_native_plan_${suffix}` }))
  if (plan.outcome !== 'succeeded' || plan.result.kind !== 'plan') {
    throw new Error('Expected a successful plan fixture.')
  }
  return plan.result.planReceiptId
}

describe('native-document Content Space provider adapter', () => {
  it('maps the direct provider-neutral operations to fixed DocFlow invocations and typed data files', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return failureReceipt(invocation)
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
    const imageSource = source('figure.png', new Uint8Array([1, 2, 3]))
    const importSource = source('draft.docx', new Uint8Array([4, 5, 6]))
    const cases: readonly Readonly<{
      input: FeatureInput
      expected: unknown
    }>[] = [
      {
        input: featureInput('create', {
          operation: 'create',
          resourceType: 'native_document',
          parent: ROOT,
          title: 'Draft',
          content: { encoding: 'json', value: { type: 'doc', children: [] } }
        }),
        expected: {
          command: 'docflow-create',
          args: { title: 'Draft', folderId: ROOT.containerId, references: [] },
          dataFiles: [{
            role: 'content',
            encoding: 'json',
            name: 'document.json',
            mediaType: 'application/json',
            content: { type: 'doc', children: [] }
          }]
        }
      },
      {
        input: featureInput('read', { operation: 'read', document: DOCUMENT }),
        expected: {
          command: 'docflow-read',
          args: { fileId: FILE.fileId },
          dataFiles: []
        }
      },
      {
        input: featureInput('image-upload', {
          operation: 'image-upload',
          document: DOCUMENT,
          mediaType: 'image/png'
        }, { source: imageSource }),
        expected: {
          command: 'docflow-image-upload',
          args: { source: 'data-file' },
          dataFiles: [{
            role: 'image',
            encoding: 'base64',
            name: 'figure.png',
            mediaType: 'image/png',
            content: 'AQID'
          }]
        }
      },
      {
        input: featureInput('comment-list', {
          operation: 'comment-list',
          document: DOCUMENT,
          status: 'open'
        }),
        expected: {
          command: 'docflow-comment-list',
          args: { fileId: FILE.fileId, status: 'open' },
          dataFiles: []
        }
      },
      {
        input: featureInput('comment-get', {
          operation: 'comment-get',
          document: DOCUMENT,
          commentId: 'comment-one'
        }),
        expected: {
          command: 'docflow-comment-get',
          args: { fileId: FILE.fileId, commentId: 'comment-one' },
          dataFiles: []
        }
      },
      {
        input: featureInput('import', {
          operation: 'import',
          resourceType: 'native_document',
          parent: ROOT
        }, { source: importSource }),
        expected: {
          command: 'docflow-import',
          args: { folderId: ROOT.containerId },
          dataFiles: [{
            role: 'source',
            encoding: 'base64',
            name: 'draft.docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            content: 'BAUG'
          }]
        }
      }
    ]

    for (const fixture of cases) {
      execute.mockClear()
      await adapter.execute(fixture.input)
      expect(execute, fixture.input.operation).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0]?.[0], fixture.input.operation).toEqual({
        invocationId: INVOCATION_ID,
        ...fixture.expected as object
      })
    }
  })

  it('normalizes successful receipts for all six direct non-chain operations', async () => {
    const fixtures: readonly Readonly<{
      operation: FeatureInput['operation']
      request: unknown
      source?: ReturnType<typeof source>
      resultKind: string
    }>[] = [
      {
        operation: 'create',
        request: {
          operation: 'create',
          resourceType: 'native_document',
          parent: ROOT,
          title: 'Draft',
          content: { encoding: 'json', value: { type: 'doc' } }
        },
        resultKind: 'document'
      },
      {
        operation: 'read',
        request: { operation: 'read', document: DOCUMENT },
        resultKind: 'content'
      },
      {
        operation: 'image-upload',
        request: { operation: 'image-upload', document: DOCUMENT, mediaType: 'image/png' },
        source: source('figure.png', new Uint8Array([1, 2, 3])),
        resultKind: 'image'
      },
      {
        operation: 'comment-list',
        request: { operation: 'comment-list', document: DOCUMENT, status: 'all' },
        resultKind: 'comments'
      },
      {
        operation: 'comment-get',
        request: { operation: 'comment-get', document: DOCUMENT, commentId: 'comment-one' },
        resultKind: 'comment'
      },
      {
        operation: 'import',
        request: { operation: 'import', resourceType: 'native_document', parent: ROOT },
        source: source('draft.docx', new Uint8Array([4, 5, 6])),
        resultKind: 'document'
      }
    ]

    for (const fixture of fixtures) {
      const execute = vi.fn(async (raw: unknown) => {
        const invocation = docflowCommandInvocationSchema.parse(raw)
        switch (invocation.command) {
          case 'docflow-create':
          case 'docflow-import': {
            const fileId = invocation.command === 'docflow-create'
              ? 'created-document'
              : 'imported-document'
            return successReceipt(invocation, {
              json: {
                success: true,
                fileId,
                documentHash: NEXT_HASH,
                versionId: 'version-one'
              },
              delivery: [delivery(fileId)]
            })
          }
          case 'docflow-read':
            return successReceipt(invocation, {
              json: {
                documentHash: BASE_HASH,
                content: { type: 'doc', children: [] }
              }
            })
          case 'docflow-image-upload':
            return successReceipt(invocation, {
              json: { resourceId: 'image-resource', mediaType: 'image/png' }
            })
          case 'docflow-comment-list':
            return successReceipt(invocation, { json: { comments: [] } })
          case 'docflow-comment-get':
            return successReceipt(invocation, {
              json: {
                comment: {
                  commentId: 'comment-one',
                  body: 'Review.',
                  status: 'open',
                  createdAt: '2026-08-20T10:00:00+08:00'
                }
              }
            })
          default:
            return failureReceipt(invocation)
        }
      })
      const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
      const receipt = await adapter.execute(featureInput(
        fixture.operation,
        fixture.request,
        fixture.source ? { source: fixture.source } : {}
      ))
      expect(receipt, fixture.operation).toMatchObject({
        outcome: 'succeeded',
        result: { kind: fixture.resultKind }
      })
      expect(execute, fixture.operation).toHaveBeenCalledTimes(1)
    }
  })

  it('fails the nine non-atomic direct mutations closed before any DocFlow invocation', async () => {
    const hashBoundCases: readonly Readonly<{
      operation: FeatureInput['operation']
      request: unknown
    }>[] = [
      {
        operation: 'update',
        request: { operation: 'update', document: DOCUMENT, baseHash: BASE_HASH, content: { encoding: 'json', value: { type: 'doc' } } }
      },
      {
        operation: 'insert',
        request: { operation: 'insert', document: DOCUMENT, baseHash: BASE_HASH, position: 'end', content: { encoding: 'json', value: { type: 'paragraph' } } }
      },
      { operation: 'undo', request: { operation: 'undo', document: DOCUMENT, baseHash: BASE_HASH } },
      { operation: 'redo', request: { operation: 'redo', document: DOCUMENT, baseHash: BASE_HASH } },
      {
        operation: 'comment-create',
        request: { operation: 'comment-create', document: DOCUMENT, baseHash: BASE_HASH, selector: { kind: 'text', text: 'Target', occurrence: 1 }, body: 'Review.' }
      },
      { operation: 'comment-reply', request: { operation: 'comment-reply', document: DOCUMENT, baseHash: BASE_HASH, commentId: 'comment-one', body: 'Reply.' } },
      { operation: 'comment-solve', request: { operation: 'comment-solve', document: DOCUMENT, baseHash: BASE_HASH, commentId: 'comment-one' } },
      { operation: 'comment-reopen', request: { operation: 'comment-reopen', document: DOCUMENT, baseHash: BASE_HASH, commentId: 'comment-one' } },
      { operation: 'comment-delete', request: { operation: 'comment-delete', document: DOCUMENT, baseHash: BASE_HASH, commentId: 'comment-one' } }
    ]

    const execute = vi.fn<DocflowNativeDocumentAdapter['execute']>()
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
    for (const fixture of hashBoundCases) {
      const receipt = await adapter.execute(featureInput(fixture.operation, fixture.request))
      expect(receipt, fixture.operation).toMatchObject({
        outcome: 'failed',
        error: {
          code: 'unsupported',
          retry: 'never'
        }
      })
      expect(receipt.outcome === 'failed' ? receipt.error.message : '', fixture.operation)
        .toContain('atomic compare-and-mutate')
      expect(execute, fixture.operation).not.toHaveBeenCalled()
    }
  })

  it('streams image-download and markdown export through runner-owned destinations without Host handles', async () => {
    const bytes = new TextEncoder().encode('managed output')
    const destination = { write: vi.fn(async (_chunk: Uint8Array) => undefined) }
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      const output = invocation.dataFiles[0]
      if (!output || output.role !== 'destination') throw new Error('missing destination')
      await output.write(bytes)
      return successReceipt(invocation, {
        json: invocation.command === 'docflow-export'
          ? {
              success: true,
              name: 'document-one.md',
              mediaType: 'text/markdown',
              bytesWritten: bytes.byteLength,
              sha256: 'c'.repeat(64)
            }
          : {
              success: true,
              name: 'image-1.png',
              mediaType: 'image/png',
              bytesWritten: bytes.byteLength,
              sha256: 'd'.repeat(64)
            }
      })
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const imageReceipt = await adapter.execute(featureInput('image-download', {
      operation: 'image-download',
      document: DOCUMENT,
      position: 1
    }, { destination }))
    expect(imageReceipt).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'artifact',
        name: 'image-1.png',
        mediaType: 'image/png',
        bytesWritten: bytes.byteLength,
        digest: { algorithm: 'sha256', value: 'd'.repeat(64) }
      }
    })
    expect(imageReceipt.outcome === 'succeeded' ? imageReceipt.result : {})
      .not.toHaveProperty('transferHandle')

    const exportReceipt = await adapter.execute(featureInput('export', {
      operation: 'export',
      document: DOCUMENT,
      format: 'markdown'
    }, { destination }))
    expect(mapNativeDocumentExportFormat('markdown')).toBe('md')
    expect(exportReceipt).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'artifact',
        name: 'document-one.md',
        mediaType: 'text/markdown',
        bytesWritten: bytes.byteLength,
        digest: { algorithm: 'sha256', value: 'c'.repeat(64) }
      }
    })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      command: 'docflow-image-download',
      args: { fileId: FILE.fileId, position: 1 },
      dataFiles: [{ role: 'destination', encoding: 'managed-stream', name: 'document-one-image-1.bin' }]
    })
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('args.destinationHandle')
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      command: 'docflow-export',
      args: { fileId: FILE.fileId, format: 'md' },
      dataFiles: [{ role: 'destination', encoding: 'managed-stream', name: 'document-one.md' }]
    })
    expect(execute.mock.calls[1]?.[0]).not.toHaveProperty('args.destinationHandle')
    expect(destination.write).toHaveBeenCalledTimes(2)
  })

  it('executes the canonical probe-plan-edit chain once through runner-managed tokens', async () => {
    const probeToken = `ocdf_${'p'.repeat(32)}`
    const planToken = `ocdf_${'e'.repeat(32)}`
    const selector = { kind: 'text' as const, text: 'Old text', occurrence: 1 }
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      if (invocation.command === 'docflow-probe') {
        return successReceipt(invocation, {
          json: {
            success: true,
            documentHash: BASE_HASH,
            capabilities: { supported: true },
            selection: {
              editTarget: { targetText: 'Old text', occurrence: 1 },
              range: { start: 0, end: 8, unit: 'utf16' },
              oldText: 'Old text'
            }
          },
          managed: [{
            role: 'probe-template',
            token: probeToken,
            name: 'probe-template.json',
            mediaType: 'application/json'
          }]
        })
      }
      if (invocation.command === 'docflow-plan') {
        return successReceipt(invocation, {
          json: {
            success: true,
            canApply: true,
            baseDocumentHash: BASE_HASH
          },
          managed: [{
            role: 'edit-plan',
            token: planToken,
            name: 'edit-plan.json',
            mediaType: 'application/json'
          }]
        })
      }
      if (invocation.command === 'docflow-edit') {
        return successReceipt(invocation, {
          json: {
            success: true,
            fileId: FILE.fileId
          },
          delivery: [delivery()]
        })
      }
      if (invocation.command === 'docflow-read') {
        return successReceipt(invocation, {
          json: {
            documentHash: NEXT_HASH,
            revisionId: 'revision-two',
            content: { type: 'doc', children: [] }
          }
        })
      }
      return failureReceipt(invocation)
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const probe = await adapter.execute(featureInput('probe', {
      operation: 'probe',
      document: DOCUMENT,
      selector,
      requestedCapability: 'replace_text'
    }, { invocationId: 'invocation_native_probe_0001' }))
    expect(probe).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'probe',
        document: DOCUMENT,
        documentHash: BASE_HASH,
        capabilitySupported: true
      }
    })
    if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
      throw new Error('Expected a successful probe fixture.')
    }
    expect(probe.result.probeReceiptId).toMatch(/^probe_[a-f0-9]{48}$/u)

    const plan = await adapter.execute(featureInput('plan', {
      operation: 'plan',
      document: DOCUMENT,
      probeReceiptId: probe.result.probeReceiptId,
      baseHash: BASE_HASH,
      changes: [{
        kind: 'replace_text',
        target: selector,
        value: 'New text'
      }]
    }, { invocationId: 'invocation_native_plan_0001' }))
    expect(plan).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'plan',
        document: DOCUMENT,
        baseHash: BASE_HASH,
        canApply: true,
        changeCount: 1
      }
    })
    if (plan.outcome !== 'succeeded' || plan.result.kind !== 'plan') {
      throw new Error('Expected a successful plan fixture.')
    }
    expect(plan.result.planReceiptId).toMatch(/^plan_[a-f0-9]{48}$/u)
    expect(execute.mock.calls[1]?.[0]).toEqual({
      invocationId: 'invocation_native_plan_0001',
      command: 'docflow-plan',
      args: { fileId: FILE.fileId, baseHash: BASE_HASH },
      dataFiles: [
        { role: 'probe-template', encoding: 'managed', token: probeToken },
        {
          role: 'operations',
          encoding: 'json',
          name: 'operations.json',
          mediaType: 'application/json',
          content: {
            operations: [{
              op: 'replaceText',
              target: { targetText: 'Old text', occurrence: 1 },
              range: { start: 0, end: 8, unit: 'utf16' },
              oldText: 'Old text',
              newText: 'New text'
            }],
            reason: 'SciForge provider-neutral native-document plan.'
          }
        }
      ]
    })

    const driftedReceipt = await adapter.execute(featureInput('edit', {
      operation: 'edit',
      document: DOCUMENT,
      planReceiptId: `${plan.result.planReceiptId}-drift`,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_drift_0001' }))
    expect(driftedReceipt).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })

    const driftedHash = await adapter.execute(featureInput('edit', {
      operation: 'edit',
      document: DOCUMENT,
      planReceiptId: plan.result.planReceiptId,
      baseHash: NEXT_HASH
    }, { invocationId: 'invocation_native_edit_hash_0001' }))
    expect(driftedHash).toMatchObject({
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: 'stale_plan',
        expectedHash: BASE_HASH,
        actualHash: NEXT_HASH,
        retry: 'never'
      }
    })

    const otherFile = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      fileId: 'document-two'
    })
    const otherDocument = Object.freeze({
      resourceType: 'native_document' as const,
      reference: otherFile
    })
    const otherTargetInput = featureInput('edit', {
      operation: 'edit',
      document: otherDocument,
      planReceiptId: plan.result.planReceiptId,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_document_0001' })
    const driftedDocument = await adapter.execute({
      ...otherTargetInput,
      target: {
        ...otherTargetInput.target,
        primary: otherFile,
        authorized: [otherFile]
      }
    })
    expect(driftedDocument).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })

    const otherProvider = 'provider-instance-beta'
    const otherProviderRoot = Object.freeze({
      providerInstanceRef: otherProvider,
      containerId: ROOT.containerId
    })
    const otherProviderFile = Object.freeze({
      providerInstanceRef: otherProvider,
      fileId: FILE.fileId
    })
    const otherProviderDocument = Object.freeze({
      resourceType: 'native_document' as const,
      reference: otherProviderFile
    })
    const otherProviderInput = featureInput('edit', {
      operation: 'edit',
      document: otherProviderDocument,
      planReceiptId: plan.result.planReceiptId,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_provider_0001' })
    const driftedProvider = await adapter.execute({
      ...otherProviderInput,
      context: {
        ...otherProviderInput.context,
        providerInstanceRef: otherProvider
      },
      target: {
        ...otherProviderInput.target,
        root: otherProviderRoot,
        primary: otherProviderFile,
        authorized: [otherProviderFile]
      }
    } as FeatureInput)
    expect(driftedProvider).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(2)

    const edit = await adapter.execute(featureInput('edit', {
      operation: 'edit',
      document: DOCUMENT,
      planReceiptId: plan.result.planReceiptId,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_0001' }))
    expect(edit).toMatchObject({
      outcome: 'succeeded',
      result: {
        kind: 'document',
        document: DOCUMENT,
        documentHash: NEXT_HASH,
        revisionId: 'revision-two'
      }
    })
    expect(execute.mock.calls[2]?.[0]).toEqual({
      invocationId: 'invocation_native_edit_0001',
      command: 'docflow-edit',
      args: { fileId: FILE.fileId, baseHash: BASE_HASH },
      dataFiles: [{ role: 'edit-plan', encoding: 'managed', token: planToken }]
    })
    expect(execute.mock.calls[3]?.[0]).toMatchObject({
      command: 'docflow-read',
      args: { fileId: FILE.fileId },
      dataFiles: []
    })

    const replay = await adapter.execute(featureInput('edit', {
      operation: 'edit',
      document: DOCUMENT,
      planReceiptId: plan.result.planReceiptId,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_replay_0001' }))
    expect(replay).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/(?:\/tmp\/|planFile|templateFile|argv|env|executable)/u)
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('rejects a stale or foreign managed chain before invoking DocFlow', async () => {
    const execute = vi.fn<DocflowNativeDocumentAdapter['execute']>()
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const result = await adapter.execute(featureInput('plan', {
      operation: 'plan',
      document: DOCUMENT,
      probeReceiptId: 'probe_unknown_receipt',
      baseHash: BASE_HASH,
      changes: [{
        kind: 'delete_text',
        target: { kind: 'text', text: 'Old', occurrence: 1 }
      }]
    }))

    expect(result).toMatchObject({
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: 'stale_plan',
        retry: 'never',
        expectedHash: BASE_HASH
      }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('expires probe and plan receipts after the runner-managed ten-minute lifetime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
    try {
      const probeToken = `ocdf_${'p'.repeat(32)}`
      const planToken = `ocdf_${'e'.repeat(32)}`
      const execute = vi.fn(async (raw: unknown) => {
        const invocation = docflowCommandInvocationSchema.parse(raw)
        return canonicalPlanningReceipt(invocation, probeToken, planToken) ?? failureReceipt(invocation)
      })
      const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
      const selector = { kind: 'text' as const, text: 'Old text', occurrence: 1 }
      const probe = await adapter.execute(featureInput('probe', {
        operation: 'probe',
        document: DOCUMENT,
        selector,
        requestedCapability: 'replace_text'
      }, { invocationId: 'invocation_native_probe_expired' }))
      if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
        throw new Error('Expected a successful probe fixture.')
      }

      vi.advanceTimersByTime(10 * 60 * 1_000 + 1)
      const expiredProbe = await adapter.execute(featureInput('plan', {
        operation: 'plan',
        document: DOCUMENT,
        probeReceiptId: probe.result.probeReceiptId,
        baseHash: BASE_HASH,
        changes: [{ kind: 'replace_text', target: selector, value: 'New text' }]
      }, { invocationId: 'invocation_native_plan_expired' }))
      expect(expiredProbe).toMatchObject({
        outcome: 'conflict',
        error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
      })
      expect(execute).toHaveBeenCalledOnce()

      const planReceiptId = await establishEditPlan(adapter, 'expiring-plan')
      expect(execute).toHaveBeenCalledTimes(3)
      vi.advanceTimersByTime(10 * 60 * 1_000 + 1)
      const expiredPlan = await adapter.execute(featureInput('edit', {
        operation: 'edit',
        document: DOCUMENT,
        planReceiptId,
        baseHash: BASE_HASH
      }, { invocationId: 'invocation_native_edit_expired' }))
      expect(expiredPlan).toMatchObject({
        outcome: 'conflict',
        error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
      })
      expect(execute).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('binds managed probe and plan receipts to the exact Principal snapshot', async () => {
    const probeToken = `ocdf_${'p'.repeat(32)}`
    const planToken = `ocdf_${'e'.repeat(32)}`
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return canonicalPlanningReceipt(invocation, probeToken, planToken) ?? failureReceipt(invocation)
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
    const selector = { kind: 'text' as const, text: 'Old text', occurrence: 1 }
    const probe = await adapter.execute(featureInput('probe', {
      operation: 'probe',
      document: DOCUMENT,
      selector,
      requestedCapability: 'replace_text'
    }, { invocationId: 'invocation_native_probe_principal_bound' }))
    if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
      throw new Error('Expected a successful probe fixture.')
    }
    const foreignPlanInput = featureInput('plan', {
      operation: 'plan',
      document: DOCUMENT,
      probeReceiptId: probe.result.probeReceiptId,
      baseHash: BASE_HASH,
      changes: [{ kind: 'replace_text', target: selector, value: 'New text' }]
    }, { invocationId: 'invocation_native_plan_other_principal' })
    const foreignPlan = await adapter.execute({
      ...foreignPlanInput,
      context: {
        ...foreignPlanInput.context,
        principal: { ...PRINCIPAL, identityVersion: PRINCIPAL.identityVersion + 1 }
      }
    } as FeatureInput)
    expect(foreignPlan).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()

    const planReceiptId = await establishEditPlan(adapter, 'principal-bound')
    const input = featureInput('edit', {
      operation: 'edit',
      document: DOCUMENT,
      planReceiptId,
      baseHash: BASE_HASH
    }, { invocationId: 'invocation_native_edit_other_principal' })

    const result = await adapter.execute({
      ...input,
      context: {
        ...input.context,
        principal: { ...PRINCIPAL, identityVersion: PRINCIPAL.identityVersion + 1 }
      }
    } as FeatureInput)
    expect(result).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('bounds pending managed receipts and purges expired entries before dispatch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
    try {
      let tokenIndex = 0
      const execute = vi.fn(async (raw: unknown) => {
        const invocation = docflowCommandInvocationSchema.parse(raw)
        tokenIndex += 1
        return successReceipt(invocation, {
          json: {
            documentHash: BASE_HASH,
            capabilities: { supported: true },
            selection: { editTarget: { targetText: 'Old text', occurrence: 1 } }
          },
          managed: [{
            role: 'probe-template',
            token: `ocdf_${String(tokenIndex).padStart(32, '0')}`,
            name: 'probe-template.json',
            mediaType: 'application/json'
          }]
        })
      })
      const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
      const request = {
        operation: 'probe' as const,
        document: DOCUMENT,
        selector: { kind: 'text' as const, text: 'Old text', occurrence: 1 },
        requestedCapability: 'replace_text' as const
      }
      for (let index = 0; index < 2_048; index += 1) {
        const receipt = await adapter.execute(featureInput('probe', request, {
          invocationId: `invocation_native_capacity_${String(index).padStart(4, '0')}`
        }))
        expect(receipt.outcome).toBe('succeeded')
      }

      const overflow = await adapter.execute(featureInput('probe', request, {
        invocationId: 'invocation_native_capacity_overflow'
      }))
      expect(overflow).toMatchObject({
        outcome: 'failed',
        error: { code: 'provider_unavailable', retry: 'never' }
      })
      expect(execute).toHaveBeenCalledTimes(2_048)

      vi.advanceTimersByTime(10 * 60 * 1_000 + 1)
      const afterPurge = await adapter.execute(featureInput('probe', request, {
        invocationId: 'invocation_native_capacity_after_purge'
      }))
      expect(afterPurge.outcome).toBe('succeeded')
      expect(execute).toHaveBeenCalledTimes(2_049)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('bounds pending plan receipts and purges them before creating another plan', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00.000Z'))
    try {
      let probeIndex = 0
      let planIndex = 0
      const execute = vi.fn(async (raw: unknown) => {
        const invocation = docflowCommandInvocationSchema.parse(raw)
        if (invocation.command === 'docflow-probe') {
          probeIndex += 1
          return canonicalPlanningReceipt(
            invocation,
            `ocdf_p${String(probeIndex).padStart(31, '0')}`,
            `ocdf_e${'0'.repeat(31)}`
          )!
        }
        if (invocation.command === 'docflow-plan') {
          planIndex += 1
          return canonicalPlanningReceipt(
            invocation,
            `ocdf_p${'0'.repeat(31)}`,
            `ocdf_e${String(planIndex).padStart(31, '0')}`
          )!
        }
        return failureReceipt(invocation)
      })
      const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
      for (let index = 0; index < 2_048; index += 1) {
        await establishEditPlan(adapter, `capacity-plan-${String(index).padStart(4, '0')}`)
      }
      expect(execute).toHaveBeenCalledTimes(4_096)

      const selector = { kind: 'text' as const, text: 'Old text', occurrence: 1 }
      const probe = await adapter.execute(featureInput('probe', {
        operation: 'probe',
        document: DOCUMENT,
        selector,
        requestedCapability: 'replace_text'
      }, { invocationId: 'invocation_native_plan_capacity_probe' }))
      if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
        throw new Error('Expected a successful probe fixture.')
      }
      const overflow = await adapter.execute(featureInput('plan', {
        operation: 'plan',
        document: DOCUMENT,
        probeReceiptId: probe.result.probeReceiptId,
        baseHash: BASE_HASH,
        changes: [{ kind: 'replace_text', target: selector, value: 'New text' }]
      }, { invocationId: 'invocation_native_plan_capacity_overflow' }))
      expect(overflow).toMatchObject({
        outcome: 'failed',
        error: { code: 'provider_unavailable', retry: 'never' }
      })
      expect(execute).toHaveBeenCalledTimes(4_097)

      vi.advanceTimersByTime(10 * 60 * 1_000 + 1)
      await establishEditPlan(adapter, 'capacity-plan-after-purge')
      expect(execute).toHaveBeenCalledTimes(4_099)
    } finally {
      vi.useRealTimers()
    }
  }, 30_000)

  it.each([
    ['principal revalidation rejection', 'throw', 'outcome_unknown'],
    ['transport outcome uncertainty', 'outcome-unknown', 'outcome_unknown'],
    ['a proved provider rejection', 'failed', 'failed']
  ] as const)('consumes the edit plan before %s and never replays the write', async (
    _label,
    failure,
    expectedOutcome
  ) => {
    const probeToken = `ocdf_${'p'.repeat(32)}`
    const planToken = `ocdf_${'e'.repeat(32)}`
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      const planning = canonicalPlanningReceipt(invocation, probeToken, planToken)
      if (planning) return planning
      if (invocation.command !== 'docflow-edit') return failureReceipt(invocation)
      if (failure === 'throw') {
        throw Object.assign(new Error('The Principal lease changed before dispatch.'), {
          code: 'unauthorized'
        })
      }
      if (failure === 'failed') return failureReceipt(invocation)
      return {
        protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
        invocationId: invocation.invocationId,
        command: invocation.command,
        attemptCount: 1,
        outcome: 'outcome_unknown',
        error: {
          code: 'outcome_unknown',
          stage: 'write',
          message: 'Dispatch may have reached OpenContent.',
          retry: 'never'
        }
      } satisfies DocflowNativeDocumentReceipt
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
    const planReceiptId = await establishEditPlan(adapter, failure)
    const request = {
      operation: 'edit' as const,
      document: DOCUMENT,
      planReceiptId,
      baseHash: BASE_HASH
    }

    const result = await adapter.execute(featureInput('edit', request, {
      invocationId: `invocation_native_edit_${failure}`
    }))
    expect(result).toMatchObject(expectedOutcome === 'outcome_unknown'
      ? {
          outcome: 'outcome_unknown',
          error: { code: 'outcome_unknown', stage: 'write', retry: 'never' }
        }
      : {
          outcome: 'failed',
          error: { code: 'provider_unavailable', retry: 'never' }
        })
    expect(execute.mock.calls[2]?.[0]).toEqual({
      invocationId: `invocation_native_edit_${failure}`,
      command: 'docflow-edit',
      args: { fileId: FILE.fileId, baseHash: BASE_HASH },
      dataFiles: [{ role: 'edit-plan', encoding: 'managed', token: planToken }]
    })

    const replay = await adapter.execute(featureInput('edit', request, {
      invocationId: `invocation_native_replay_${failure}`
    }))
    expect(replay).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('returns outcome_unknown when a successful write and its single readback still lack a document hash', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return successReceipt(invocation, {
        json: {
          success: true,
          operation: 'create',
          fileId: 'new-document',
          fileName: 'Draft.mdoc',
          versionId: 'version-one'
        },
        delivery: [delivery('new-document', 'Draft.mdoc')]
      })
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const receipt = await adapter.execute(featureInput('create', {
      operation: 'create',
      resourceType: 'native_document',
      parent: ROOT,
      title: 'Draft',
      content: { encoding: 'json', value: { type: 'doc' } }
    }))

    expect(receipt).toMatchObject({
      outcome: 'outcome_unknown',
      error: {
        code: 'outcome_unknown',
        stage: 'verify',
        retry: 'never'
      }
    })
    expect(receipt.outcome === 'outcome_unknown' ? receipt.error.message : '')
      .toContain('documentHash')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('returns outcome_unknown when a succeeded write receipt lacks its strict delivery proof', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return successReceipt(invocation, {
        json: {
          success: true,
          fileId: 'new-document',
          documentHash: NEXT_HASH,
          revisionId: 'revision-one'
        }
      })
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const receipt = await adapter.execute(featureInput('create', {
      operation: 'create',
      resourceType: 'native_document',
      parent: ROOT,
      title: 'Draft',
      content: { encoding: 'json', value: { type: 'doc' } }
    }))

    expect(receipt).toMatchObject({
      outcome: 'outcome_unknown',
      error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it.each([
    ['schema', (_invocation: DocflowCommandInvocation): unknown => ({ outcome: 'succeeded' })],
    ['command binding', (invocation: DocflowCommandInvocation): unknown => ({
      ...successReceipt(invocation, {
        json: {
          fileId: 'new-document',
          documentHash: NEXT_HASH,
          revisionId: 'revision-one'
        },
        delivery: [delivery('new-document')]
      }),
      command: 'docflow-import'
    })]
  ] as const)('returns outcome_unknown when a succeeded write has an incomplete %s proof', async (
    _gap,
    response
  ) => {
    const execute = vi.fn<DocflowNativeDocumentAdapter['execute']>(async (raw: unknown) =>
      response(docflowCommandInvocationSchema.parse(raw)) as DocflowNativeDocumentReceipt)
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const receipt = await adapter.execute(featureInput('create', {
      operation: 'create',
      resourceType: 'native_document',
      parent: ROOT,
      title: 'Draft',
      content: { encoding: 'json', value: { type: 'doc' } }
    }))

    expect(receipt).toMatchObject({
      outcome: 'outcome_unknown',
      error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps post-dispatch proof gaps as contract violations for reads', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return successReceipt(invocation, { json: { documentHash: BASE_HASH } })
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const receipt = await adapter.execute(featureInput('read', {
      operation: 'read',
      document: DOCUMENT
    }))
    expect(receipt).toMatchObject({
      outcome: 'failed',
      error: { code: 'contract_violation', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('returns outcome_unknown when a succeeded write result lacks required fields', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      return successReceipt(invocation, { json: { mediaType: 'image/png' } })
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    const receipt = await adapter.execute(featureInput('image-upload', {
      operation: 'image-upload',
      document: DOCUMENT,
      mediaType: 'image/png'
    }, { source: source('figure.png', new Uint8Array([1])) }))
    expect(receipt).toMatchObject({
      outcome: 'outcome_unknown',
      error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('returns outcome_unknown and consumes the plan when edit readback cannot prove success', async () => {
    const probeToken = `ocdf_${'p'.repeat(32)}`
    const planToken = `ocdf_${'e'.repeat(32)}`
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      const planning = canonicalPlanningReceipt(invocation, probeToken, planToken)
      if (planning) return planning
      if (invocation.command === 'docflow-edit') {
        return successReceipt(invocation, {
          json: { success: true, fileId: FILE.fileId },
          delivery: [delivery()]
        })
      }
      return failureReceipt(invocation)
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })
    const planReceiptId = await establishEditPlan(adapter, 'readback-failure')
    const request = {
      operation: 'edit' as const,
      document: DOCUMENT,
      planReceiptId,
      baseHash: BASE_HASH
    }

    const receipt = await adapter.execute(featureInput('edit', request, {
      invocationId: 'invocation_native_edit_readback_failure'
    }))
    expect(receipt).toMatchObject({
      outcome: 'outcome_unknown',
      error: { code: 'outcome_unknown', stage: 'verify', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(4)

    const replay = await adapter.execute(featureInput('edit', request, {
      invocationId: 'invocation_native_edit_readback_replay'
    }))
    expect(replay).toMatchObject({
      outcome: 'conflict',
      error: { code: 'conflict', reason: 'stale_plan', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('maps conflict and outcome_unknown without replaying', async () => {
    const execute = vi.fn(async (raw: unknown) => {
      const invocation = docflowCommandInvocationSchema.parse(raw)
      if (invocation.command === 'docflow-read') {
        return {
          protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
          invocationId: invocation.invocationId,
          command: invocation.command,
          attemptCount: 1,
          outcome: 'failed',
          error: { code: 'not_found', message: 'Missing.', retry: 'never' }
        } satisfies DocflowNativeDocumentReceipt
      }
      return {
        protocol: DOCFLOW_NATIVE_DOCUMENT_RECEIPT_PROTOCOL,
        invocationId: invocation.invocationId,
        command: invocation.command,
        attemptCount: 1,
        outcome: 'outcome_unknown',
        error: {
          code: 'outcome_unknown',
          stage: 'write',
          message: 'Dispatch completed but the result is unknown.',
          retry: 'never'
        }
      } satisfies DocflowNativeDocumentReceipt
    })
    const adapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow: { execute } })

    await expect(adapter.execute(featureInput('read', {
      operation: 'read',
      document: DOCUMENT
    }))).resolves.toMatchObject({
      outcome: 'failed',
      error: { code: 'not_found', retry: 'never' }
    })
    await expect(adapter.execute(featureInput('image-upload', {
      operation: 'image-upload',
      document: DOCUMENT,
      mediaType: 'image/png'
    }, { source: source('figure.png', new Uint8Array([1])) }))).resolves.toMatchObject({
      outcome: 'outcome_unknown',
      error: { code: 'outcome_unknown', stage: 'write', retry: 'never' }
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('admits only the declared Content Space adapter owner before any DocFlow call', () => {
    const execute = vi.fn<DocflowNativeDocumentAdapter['execute']>()

    expect(() => createNativeDocumentProviderAdapter({
      owner: {
        role: 'transport-owner',
        moduleId: 'sciforge.opencontent-connector',
        moduleVersion: '1.0.0'
      },
      docflow: { execute }
    })).toThrow()
    expect(execute).not.toHaveBeenCalled()
  })
})
