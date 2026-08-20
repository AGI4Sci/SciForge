import { describe, expect, it, vi } from 'vitest'

import {
  DOCFLOW_NATIVE_DOCUMENT_COMMANDS,
  createDocflowNativeDocumentAdapter,
  type DocflowCommandTransport
} from './docflow-native-document-adapter.js'

describe('DocFlow native document adapter', () => {
  it('admits only the fixed DocFlow command surface before reaching the transport', async () => {
    expect(DOCFLOW_NATIVE_DOCUMENT_COMMANDS).toEqual([
      'docflow-create',
      'docflow-read',
      'docflow-update',
      'docflow-insert',
      'docflow-probe',
      'docflow-plan',
      'docflow-edit',
      'docflow-undo',
      'docflow-redo',
      'docflow-image-upload',
      'docflow-image-download',
      'docflow-comment-create',
      'docflow-comment-list',
      'docflow-comment-get',
      'docflow-comment-reply',
      'docflow-comment-solve',
      'docflow-comment-reopen',
      'docflow-comment-delete',
      'docflow-import',
      'docflow-export'
    ])

    const transport: DocflowCommandTransport = { invoke: vi.fn() }
    const adapter = createDocflowNativeDocumentAdapter(transport)

    await expect(adapter.execute({
      invocationId: 'invocation_docflow_adapter_a',
      command: 'node',
      args: { script: 'arbitrary.js' },
      dataFiles: [],
      argv: ['--eval'],
      env: { SYSTEM_USER_TOKEN: 'caller-controlled' }
    })).rejects.toThrow()
    await expect(adapter.execute({
      invocationId: 'invocation_docflow_adapter_b',
      command: 'docflow-read',
      args: { fileId: 'file_a', script: 'arbitrary.js' },
      dataFiles: []
    })).rejects.toThrow()
    await expect(adapter.execute({
      invocationId: 'invocation_docflow_adapter_c',
      command: 'docflow-create',
      args: { title: 'Unsafe path' },
      dataFiles: [{
        role: 'content',
        encoding: 'utf8',
        name: 'document.html',
        mediaType: 'text/html',
        content: '<docflow-html><article /></docflow-html>',
        path: '/tmp/caller-controlled.html'
      }]
    })).rejects.toThrow()
    expect(transport.invoke).not.toHaveBeenCalled()
  })

  it('passes document content only as a typed data file and returns a typed delivery receipt', async () => {
    const invocation = {
      invocationId: 'invocation_docflow_create_a',
      command: 'docflow-create' as const,
      args: {
        title: 'Document',
        folderId: 'container_a',
        references: []
      },
      dataFiles: [{
        role: 'content' as const,
        encoding: 'utf8' as const,
        name: 'document.html',
        mediaType: 'text/html',
        content: '<docflow-html><article><p>Body</p></article></docflow-html>'
      }]
    }
    const structuredDelivery = {
      protocol: 'docflowCard:v1' as const,
      outcome: 'succeeded' as const,
      businessIdentity: 'file_a',
      payload: {
        projectId: 'file_a',
        name: 'Document.mdoc',
        accessUrl: 'https://provider.invalid/preview/file_a',
        updateTime: '2026-08-20T10:00:00+08:00'
      }
    }
    const invoke = vi.fn().mockResolvedValue({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-create',
      ok: true,
      json: {
        success: true,
        operation: 'create',
        fileId: 'file_a',
        fileName: 'Document.mdoc',
        versionId: 'version_a'
      },
      structuredDeliveryItems: [structuredDelivery],
      managedDataFiles: []
    })
    const adapter = createDocflowNativeDocumentAdapter({ invoke })

    await expect(adapter.execute(invocation)).resolves.toEqual({
      protocol: 'docflowNativeDocumentReceipt:v1',
      invocationId: invocation.invocationId,
      command: invocation.command,
      attemptCount: 1,
      outcome: 'succeeded',
      json: {
        success: true,
        operation: 'create',
        fileId: 'file_a',
        fileName: 'Document.mdoc',
        versionId: 'version_a'
      },
      structuredDeliveryItems: [structuredDelivery],
      managedDataFiles: []
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(invocation)
    expect(JSON.stringify(invoke.mock.calls[0]?.[0])).not.toMatch(/filePath|argv|env|token/iu)
  })

  it('returns a non-retryable conflict for a document hash mismatch without replaying', async () => {
    const expectedHash = 'a'.repeat(64)
    const actualHash = 'b'.repeat(64)
    const invocation = {
      invocationId: 'invocation_docflow_edit_conflict',
      command: 'docflow-edit' as const,
      args: { fileId: 'file_a', baseHash: expectedHash },
      dataFiles: [{
        role: 'edit-plan' as const,
        encoding: 'managed' as const,
        token: `ocdf_${'p'.repeat(32)}`
      }]
    }
    const invoke = vi.fn().mockResolvedValue({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-edit',
      ok: false,
      error: {
        code: 'DOCFLOW_DOCUMENT_HASH_MISMATCH',
        message: 'The document hash no longer matches the plan.',
        stage: 'validation',
        dispatched: false,
        expectedHash,
        actualHash
      }
    })
    const adapter = createDocflowNativeDocumentAdapter({ invoke })

    await expect(adapter.execute(invocation)).resolves.toMatchObject({
      protocol: 'docflowNativeDocumentReceipt:v1',
      invocationId: invocation.invocationId,
      command: invocation.command,
      attemptCount: 1,
      outcome: 'conflict',
      error: {
        code: 'conflict',
        reason: 'hash_mismatch',
        retry: 'never',
        expectedHash,
        actualHash
      }
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('returns outcome_unknown for an uncertain comment commit without replaying', async () => {
    const invocation = {
      invocationId: 'invocation_docflow_comment_unknown',
      command: 'docflow-comment-create' as const,
      args: {
        fileId: 'file_a',
        target: { kind: 'text' as const, targetText: 'Review target' },
        body: 'Please review.'
      },
      dataFiles: []
    }
    const invoke = vi.fn().mockResolvedValue({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-comment-create',
      ok: false,
      error: {
        code: 'DOCFLOW_COMMENT_COMMIT_UNKNOWN',
        message: 'The comment request was sent but its outcome is unknown.',
        stage: 'write',
        dispatched: true
      }
    })
    const adapter = createDocflowNativeDocumentAdapter({ invoke })

    await expect(adapter.execute(invocation)).resolves.toMatchObject({
      invocationId: invocation.invocationId,
      command: invocation.command,
      attemptCount: 1,
      outcome: 'outcome_unknown',
      error: {
        code: 'outcome_unknown',
        stage: 'comment_commit',
        retry: 'never'
      }
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('carries export and image-download destinations only as runner-managed streams', async () => {
    const write = vi.fn(async (_chunk: Uint8Array) => undefined)
    const invoke = vi.fn().mockResolvedValue({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-export',
      ok: true,
      json: {
        success: true,
        fileId: 'file_a',
        format: 'md',
        name: 'file_a.md',
        mediaType: 'text/markdown',
        bytesWritten: 12
      },
      structuredDeliveryItems: [],
      managedDataFiles: []
    })
    const adapter = createDocflowNativeDocumentAdapter({ invoke })
    const invocation = {
      invocationId: 'invocation_docflow_export_stream',
      command: 'docflow-export' as const,
      args: { fileId: 'file_a', format: 'md' as const },
      dataFiles: [{
        role: 'destination' as const,
        encoding: 'managed-stream' as const,
        name: 'file_a.md',
        write
      }]
    }

    await expect(adapter.execute(invocation)).resolves.toMatchObject({
      outcome: 'succeeded',
      command: 'docflow-export'
    })
    expect(invoke).toHaveBeenCalledWith(invocation)
    expect(invoke.mock.calls[0]?.[0]).not.toHaveProperty('args.destinationHandle')

    await expect(adapter.execute({
      ...invocation,
      invocationId: 'invocation_docflow_export_rejected',
      args: {
        ...invocation.args,
        destinationHandle: 'xfer_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }
    })).rejects.toThrow()
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
