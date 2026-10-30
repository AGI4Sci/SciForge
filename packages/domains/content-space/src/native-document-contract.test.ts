import { describe, expect, it } from 'vitest'

import * as contract from './native-document-contract.js'

const document = {
  resourceType: 'native_document' as const,
  reference: {
    providerInstanceRef: 'provider-instance-a',
    fileId: 'document_a'
  }
}

const parent = {
  providerInstanceRef: 'provider-instance-a',
  containerId: 'container_a'
}

const content = {
  encoding: 'json' as const,
  value: { component: 'paragraph', children: [] }
}

describe('native document public contract', () => {
  it('admits only the provider-neutral native_document resource discriminator', () => {
    expect(contract.nativeDocumentReferenceSchema.parse(document)).toEqual(document)
    expect(() => contract.nativeDocumentReferenceSchema.parse({
      ...document,
      resourceType: 'provider_specific_document'
    })).toThrow()
    expect(() => contract.nativeDocumentReferenceSchema.parse({
      ...document,
      internalDocumentId: 'private-id'
    })).toThrow()
  })

  it('defines one closed request union for every native document capability', () => {
    const hash = 'a'.repeat(64)
    const sourceHandle = `xfer_${'s'.repeat(32)}`
    const destinationHandle = `xfer_${'d'.repeat(32)}`
    const selector = { kind: 'text' as const, text: 'target', occurrence: 1 }
    const requests = [
      { operation: 'create', resourceType: 'native_document', parent, title: 'Document', content },
      { operation: 'read', document },
      { operation: 'update', document, baseHash: hash, content },
      { operation: 'insert', document, baseHash: hash, position: 'end', content },
      {
        operation: 'probe',
        document,
        selector,
        requestedCapability: 'replace_text'
      },
      {
        operation: 'plan',
        document,
        probeReceiptId: 'receipt_probe_a',
        baseHash: hash,
        changes: [{ kind: 'replace_text', target: selector, value: 'replacement' }]
      },
      { operation: 'edit', document, planReceiptId: 'receipt_plan_a', baseHash: hash },
      { operation: 'undo', document, baseHash: hash },
      { operation: 'redo', document, baseHash: hash },
      { operation: 'image-upload', document, sourceHandle, mediaType: 'image/png' },
      { operation: 'image-download', document, position: 1, destinationHandle },
      { operation: 'comment-create', document, baseHash: hash, selector, body: 'Review this.' },
      { operation: 'comment-list', document, status: 'all' },
      { operation: 'comment-get', document, commentId: 'comment_a' },
      {
        operation: 'comment-reply',
        document,
        baseHash: hash,
        commentId: 'comment_a',
        body: 'Acknowledged.'
      },
      { operation: 'comment-solve', document, baseHash: hash, commentId: 'comment_a' },
      { operation: 'comment-reopen', document, baseHash: hash, commentId: 'comment_a' },
      { operation: 'comment-delete', document, baseHash: hash, commentId: 'comment_a' },
      { operation: 'import', resourceType: 'native_document', parent, sourceHandle },
      { operation: 'export', document, format: 'pdf', destinationHandle }
    ] as const

    expect(requests.map((request) => (
      contract.nativeDocumentRequestSchema.parse(request).operation
    ))).toEqual(contract.NATIVE_DOCUMENT_OPERATIONS)
    expect(() => contract.nativeDocumentRequestSchema.parse({
      operation: 'execute',
      document,
      command: 'arbitrary-command'
    })).toThrow()
  })

  it('uses Workspace-relative transfer paths for Agent requests and receipts', () => {
    const sourceHandle = `xfer_${'s'.repeat(32)}`
    const destinationHandle = `xfer_${'d'.repeat(32)}`
    const workspaceRelativePath = 'research/assets/figure.png'

    expect(contract.agentNativeDocumentRequestSchema.parse({
      operation: 'image-upload',
      document,
      workspaceRelativePath,
      mediaType: 'image/png'
    })).toMatchObject({ workspaceRelativePath })
    expect(contract.agentNativeDocumentRequestSchema.parse({
      operation: 'image-download',
      document,
      position: 1,
      workspaceRelativePath
    })).toMatchObject({ workspaceRelativePath })
    expect(contract.agentNativeDocumentRequestSchema.parse({
      operation: 'import',
      resourceType: 'native_document',
      parent,
      workspaceRelativePath: 'research/import.mdoc'
    })).toMatchObject({ workspaceRelativePath: 'research/import.mdoc' })
    expect(contract.agentNativeDocumentRequestSchema.parse({
      operation: 'export',
      document,
      format: 'pdf',
      workspaceRelativePath: 'research/export.pdf'
    })).toMatchObject({ workspaceRelativePath: 'research/export.pdf' })

    expect(() => contract.agentNativeDocumentRequestSchema.parse({
      operation: 'image-upload',
      document,
      sourceHandle,
      mediaType: 'image/png'
    })).toThrow()
    expect(() => contract.agentNativeDocumentRequestSchema.parse({
      operation: 'export',
      document,
      format: 'pdf',
      destinationHandle
    })).toThrow()
    expect(() => contract.agentNativeDocumentRequestSchema.parse({
      operation: 'import',
      resourceType: 'native_document',
      parent,
      workspaceRelativePath: '../outside.mdoc'
    })).toThrow()

    const receipt = contract.agentNativeDocumentReceiptSchema.parse({
      contractVersion: contract.NATIVE_DOCUMENT_CONTRACT_VERSION,
      resourceType: 'native_document',
      operation: 'export',
      invocationId: 'invocation_agent_export_a',
      outcome: 'succeeded',
      result: {
        kind: 'artifact',
        workspaceRelativePath: 'research/export.pdf',
        name: 'export.pdf',
        mediaType: 'application/pdf',
        bytesWritten: 128
      }
    })
    expect(receipt).toMatchObject({
      result: { workspaceRelativePath: 'research/export.pdf' }
    })
    expect(JSON.stringify(receipt)).not.toContain('xfer_')
  })

  it('types receipts and makes hash conflicts and unknown outcomes non-retryable', () => {
    const base = {
      contractVersion: contract.NATIVE_DOCUMENT_CONTRACT_VERSION,
      resourceType: 'native_document' as const,
      operation: 'edit' as const,
      invocationId: 'invocation_native_document_a'
    }
    const hashes = {
      expectedHash: 'a'.repeat(64),
      actualHash: 'b'.repeat(64)
    }

    expect(contract.nativeDocumentReceiptSchema.parse({
      ...base,
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: 'hash_mismatch',
        message: 'The document changed after the plan was prepared.',
        retry: 'never',
        ...hashes
      }
    }).outcome).toBe('conflict')
    expect(() => contract.nativeDocumentReceiptSchema.parse({
      ...base,
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: 'hash_mismatch',
        message: 'Unsafe retry.',
        retry: 'safe-with-same-invocation',
        ...hashes
      }
    })).toThrow()

    expect(contract.nativeDocumentReceiptSchema.parse({
      ...base,
      outcome: 'outcome_unknown',
      error: {
        code: 'outcome_unknown',
        stage: 'verify',
        message: 'The write may have committed but could not be verified.',
        retry: 'never'
      }
    }).outcome).toBe('outcome_unknown')
    expect(() => contract.nativeDocumentReceiptSchema.parse({
      ...base,
      outcome: 'outcome_unknown',
      error: {
        code: 'outcome_unknown',
        stage: 'write',
        message: 'Unsafe retry.',
        retry: 'safe-with-same-invocation'
      }
    })).toThrow()
  })
})
