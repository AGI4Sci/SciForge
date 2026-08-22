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
      'docflow-probe',
      'docflow-plan',
      'docflow-image-upload',
      'docflow-image-download',
      'docflow-comment-list',
      'docflow-comment-get',
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
    await expect(adapter.execute({
      invocationId: 'invocation_docflow_adapter_edit',
      command: 'docflow-edit',
      args: { fileId: 'file_a', baseHash: 'a'.repeat(64) },
      dataFiles: [{
        role: 'edit-plan',
        encoding: 'managed',
        token: `ocdf_${'p'.repeat(32)}`
      }]
    })).rejects.toThrow()
    for (const command of [
      'docflow-update',
      'docflow-insert',
      'docflow-undo',
      'docflow-redo',
      'docflow-import',
      'docflow-comment-create',
      'docflow-comment-reply',
      'docflow-comment-solve',
      'docflow-comment-reopen',
      'docflow-comment-delete'
    ]) {
      await expect(adapter.execute({
        invocationId: `invocation_blocked_${command}`,
        command,
        args: {},
        dataFiles: []
      })).rejects.toThrow()
    }
    await expect(adapter.execute({
      invocationId: 'invocation_blocked_docflow_import',
      command: 'docflow-import',
      args: { folderId: 'container_a' },
      dataFiles: [{
        role: 'source',
        encoding: 'base64',
        name: 'draft.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: 'BAUG'
      }]
    } as never)).rejects.toThrow()
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
      protocolVersion: '1.0' as const,
      kind: 'docflowCard' as const,
      version: 'v1' as const,
      outcome: 'succeeded' as const,
      businessIdentity: 'file_a',
      payload: {
        projectId: 'file_a',
        versionId: 'version_a',
        name: 'Document.mdoc',
        versionName: '',
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
