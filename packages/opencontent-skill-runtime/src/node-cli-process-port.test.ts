import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  OPENCONTENT_CLI_ADMITTED_COMMANDS,
  OPENCONTENT_CLI_COMMANDS,
  OPENCONTENT_CLI_MAX_STDERR_BYTES,
  OPENCONTENT_CLI_MAX_STDOUT_BYTES,
  OPENCONTENT_CLI_RUNNER_PROTOCOL,
  type OpenContentCliInvocation,
  type OpenContentCliProcessRequest
} from './cli-runner.js'
import {
  docflowTransportResultSchema,
} from './docflow-native-document-adapter.js'
import {
  OpenContentCliProcessError,
  type NodeOpenContentCliProcessPortOptions
} from './node-cli-process-port.js'
import * as publicNodeCliProcessPort from './node-cli-process-port.js'
import {
  createNodeOpenContentCliProcessPortInternal,
  type NodeOpenContentCliProcessPortInternalOptions
} from './node-cli-process-port.internal.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

function createNodeOpenContentCliProcessPort(
  options: NodeOpenContentCliProcessPortOptions,
  internal: Partial<Pick<
    NodeOpenContentCliProcessPortInternalOptions,
    'afterSnapshotRead' | 'trustedSnapshotIntegrity'
  >> = {}
) {
  let trustedSnapshotIntegrity = internal.trustedSnapshotIntegrity
  if (trustedSnapshotIntegrity === undefined) {
    try {
      trustedSnapshotIntegrity = fixtureSnapshotIntegrity(options.trustedEntrypoint)
    } catch {
      trustedSnapshotIntegrity = []
    }
  }
  return createNodeOpenContentCliProcessPortInternal({
    ...options,
    trustedSnapshotIntegrity,
    ...(internal.afterSnapshotRead === undefined
      ? {}
      : { afterSnapshotRead: internal.afterSnapshotRead })
  })
}

describe('Node OpenContent CLI process port', () => {
  it('keeps internal factories and trust overrides outside the public package entrypoint', () => {
    const noInternalOptions: Record<Extract<
      keyof NodeOpenContentCliProcessPortOptions,
      'afterSnapshotRead' | 'trustedSnapshotIntegrity'
    >, never> = {}
    expect(noInternalOptions).toEqual({})
    expect(publicNodeCliProcessPort).not.toHaveProperty(
      'createNodeOpenContentCliProcessPortInternal'
    )
  })

  it('does not read or forward hidden JavaScript trust overrides', async () => {
    const fixture = await createFixture()
    const accessed = new Set<PropertyKey>()
    const options = new Proxy({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      afterSnapshotRead: () => {
        throw new Error('hidden hook must not run')
      },
      trustedSnapshotIntegrity: fixtureSnapshotIntegrity(fixture.entrypoint)
    }, {
      get(target, property, receiver) {
        accessed.add(property)
        return Reflect.get(target, property, receiver)
      }
    })

    publicNodeCliProcessPort.createNodeOpenContentCliProcessPort(options)

    expect(accessed).not.toContain('afterSnapshotRead')
    expect(accessed).not.toContain('trustedSnapshotIntegrity')
  })

  it('keeps the 86-command snapshot inventory separate from the admitted adapter union', async () => {
    expect(OPENCONTENT_CLI_COMMANDS).toHaveLength(86)
    expect(OPENCONTENT_CLI_ADMITTED_COMMANDS).toHaveLength(61)
    for (const excluded of [
      'docflow-last-delivery',
      'docflow-failure-list',
      'docflow-failure-get',
      'docflow-failure-prune',
      'docflow-failure-recovery',
      'docflow-update',
      'docflow-insert',
      'docflow-edit',
      'docflow-undo',
      'docflow-redo',
      'docflow-import',
      'docflow-comment-create',
      'docflow-comment-reply',
      'docflow-comment-solve',
      'docflow-comment-reopen',
      'docflow-comment-delete',
      'team-create',
      'create-folder'
    ]) {
      expect(OPENCONTENT_CLI_ADMITTED_COMMANDS).not.toContain(excluded)
    }

    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    await expect(port.run(request({
      invocationId: 'invocation_excluded_a',
      command: 'docflow-last-delivery',
      args: {},
      dataFiles: []
    } as never, fixture.entrypoint))).rejects.toThrow()
    for (const command of [
      'docflow-update',
      'docflow-insert',
      'docflow-edit',
      'docflow-undo',
      'docflow-redo',
      'docflow-import',
      'docflow-comment-create',
      'docflow-comment-reply',
      'docflow-comment-solve',
      'docflow-comment-reopen',
      'docflow-comment-delete'
    ]) {
      await expect(port.run(request({
        invocationId: `invocation_blocked_${command}`,
        command,
        args: {},
        dataFiles: []
      } as never, fixture.entrypoint))).rejects.toThrow()
    }
    await expect(port.run(request({
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
    } as never, fixture.entrypoint))).rejects.toThrow()
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('executes an extended command once with fixed argv, minimal env, and a private snapshot', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_file_info_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(result).toMatchObject({
      protocol: 'opencontent-cli-result:v1',
      invocationId: 'invocation_file_info_a',
      command: 'file-info',
      attemptCount: 1,
      outcome: 'succeeded',
      json: {
        command: 'file-info',
        jsonFlag: true,
        singleJsonArg: true,
        cwdIsPrivate: true,
        siteMatches: true,
        tokenMatches: true,
        args: { fileId: 'file-a' }
      }
    })
    expect(result.json.envKeys).toEqual(expect.arrayContaining([
      'OPENCONTENT_SITE',
      'SYSTEM_USER_TOKEN'
    ]))
    expect(result.json.envKeys).not.toEqual(expect.arrayContaining(['HOME', 'PATH']))
    expect(result.json.envKeys.every((key: string) => [
      'OPENCONTENT_SITE',
      'SYSTEM_USER_TOKEN',
      '__CF_USER_TEXT_ENCODING'
    ].includes(key))).toBe(true)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
    expect(await readdir(fixture.root)).toEqual([
      'cli',
      'package.json',
      'runtime-patches',
      'scripts'
    ])
  })

  it('copies only the fixed structural-probe helper into the private runtime', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_structural_probe_helper_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(result.json.structuralProbeHelper).toEqual({
      exists: true,
      relativePath: 'scripts/docflow-probe-compact.cjs'
    })
    expect(result.json.runtimeScripts).toEqual(['docflow-probe-compact.cjs'])
    expect(JSON.stringify(result)).not.toContain(fixture.root)
    expect(JSON.stringify(result)).not.toContain(fixture.invocationsRoot)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('fails closed before startup when the structural-probe helper is absent', async () => {
    const fixture = await createFixture()
    await rm(join(fixture.root, 'scripts', 'docflow-probe-compact.cjs'))

    expect(() => createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })).toThrow('OpenContent structural DocFlow probe helper is unavailable.')
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('materializes inline DocFlow content without exposing a local path', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_doc_create_a',
      command: 'docflow-create',
      args: { title: 'A document', references: [] },
      dataFiles: [{
        role: 'content',
        encoding: 'utf8',
        name: 'document.html',
        mediaType: 'text/html',
        content: '<article><p>Hello</p></article>'
      }]
    }, fixture.entrypoint)) as Record<string, any>

    expect(result.protocol).toBe('docflow-command-result:v1')
    expect(result.json).toMatchObject({
      success: true,
      operation: 'create',
      fileId: 'document-a'
    })
    expect(JSON.stringify(result)).not.toContain(fixture.invocationsRoot)
    expect(result.structuredDeliveryItems).toHaveLength(1)
    expect(docflowTransportResultSchema.safeParse(result).success).toBe(true)
    expect(result.structuredDeliveryItems[0].payload.accessUrl).toBe(
      'https://redacted-provider.invalid/'
    )
    expect(JSON.stringify(result)).not.toContain('https://provider.invalid')
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('streams extended uploads into a runner-owned source file', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const bytes = Buffer.from('managed upload body')
    const result = await port.run(request({
      invocationId: 'invocation_upload_a',
      command: 'upload',
      args: { folderId: 'folder-a' },
      dataFiles: [{
        role: 'source',
        encoding: 'managed-stream',
        name: 'source.txt',
        size: bytes.byteLength,
        read: async ({ offset, length }) => bytes.subarray(offset, offset + length)
      }]
    }, fixture.entrypoint)) as Record<string, any>

    expect(result.json).toMatchObject({
      uploaded: 'managed upload body',
      size: bytes.byteLength
    })
    expect(JSON.stringify(result)).not.toContain('filePath')
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('rejects a Principal change during managed-source materialization before child dispatch', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const safePrincipalError = Object.assign(
      new Error('The Host Principal is no longer current for this OpenContent session.'),
      { code: 'unauthorized' as const }
    )
    let principalCurrent = true
    const assertPrincipalCurrent = vi.fn(async () => {
      if (!principalCurrent) throw safePrincipalError
    })
    const bytes = Buffer.from('managed upload body')

    const operation = port.run(request({
      invocationId: 'invocation_upload_principal_drift_a',
      command: 'upload',
      args: { folderId: 'folder-a' },
      dataFiles: [{
        role: 'source',
        encoding: 'managed-stream',
        name: 'source.txt',
        size: bytes.byteLength,
        read: async ({ offset, length }) => {
          principalCurrent = false
          return bytes.subarray(offset, offset + length)
        }
      }]
    }, fixture.entrypoint, undefined, assertPrincipalCurrent))

    await expect(operation).rejects.toBe(safePrincipalError)
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('captures a CLI download and streams it to the managed destination', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const chunks: Uint8Array[] = []
    const result = await port.run(request({
      invocationId: 'invocation_download_a',
      command: 'download',
      args: { fileIds: 'file-a', ispdfdownload: true },
      dataFiles: [{
        role: 'destination',
        encoding: 'managed-stream',
        name: 'export.pdf',
        write: async (chunk) => { chunks.push(Uint8Array.from(chunk)) }
      }]
    }, fixture.entrypoint)) as Record<string, any>

    expect(Buffer.concat(chunks).toString('utf8')).toBe('downloaded artifact')
    expect(result.json).toMatchObject({
      bytesWritten: 19,
      name: 'export.pdf',
      mediaType: 'application/pdf'
    })
    expect(result.json.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(result)).not.toContain('outputPath')
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('uses a one-use probe token for a read-only plan without retaining an executable plan', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const probe = await port.run(request({
      invocationId: 'invocation_doc_probe_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>
    const probeToken = probe.managedDataFiles[0].token as string
    expect(probeToken).toMatch(/^ocdf_[A-Za-z0-9_-]{32,128}$/u)
    expect(probe.json.probe).toMatchObject({
      documentHash: 'a'.repeat(64),
      capabilities: { supported: true }
    })
    expect(JSON.stringify(probe)).not.toContain('editPlanTemplateFile')

    const planInvocation = {
      invocationId: 'invocation_doc_plan_a',
      command: 'docflow-plan' as const,
      args: { fileId: 'file-a', baseHash: 'a'.repeat(64) },
      dataFiles: [
        { role: 'probe-template' as const, encoding: 'managed' as const, token: probeToken },
        {
          role: 'operations' as const,
          encoding: 'json' as const,
          name: 'operations.json',
          mediaType: 'application/json' as const,
          content: { operations: [{ op: 'replaceText' }] }
        }
      ]
    }
    const plan = await port.run(request(planInvocation, fixture.entrypoint)) as Record<string, any>
    expect(plan.managedDataFiles).toEqual([])
    expect(JSON.stringify(plan)).not.toContain('planFile')

    await expect(port.run(request(planInvocation, fixture.entrypoint)))
      .rejects.toMatchObject({ code: 'invalid-input', dispatched: false })

    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('captures the pinned nested probe template as a one-use managed token', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })

    const result = await port.run(request({
      invocationId: 'invocation_pinned_nested_probe_a',
      command: 'docflow-probe',
      args: {
        fileId: 'pinned-probe-shape',
        target: { text: 'Body' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(result.managedDataFiles).toEqual([
      expect.objectContaining({
        role: 'probe-template',
        name: 'probe-template.json',
        mediaType: 'application/json'
      })
    ])
    expect(result.managedDataFiles[0].token).toMatch(/^ocdf_[A-Za-z0-9_-]{32,128}$/u)
    expect(JSON.stringify(result)).not.toContain('editPlanTemplateFile')
    expect(JSON.stringify(result)).not.toContain(fixture.invocationsRoot)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it.each([
    'truncated-probe',
    'incomplete-probe',
    'legacy-alias-probe',
    'non-object-probe'
  ] as const)('rejects %s before retaining its managed template', async (invalidFileId) => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: { maxEntries: 1, maxBytes: 16 * 1024 * 1024 }
    })

    await expect(port.run(request({
      invocationId: `invocation_${invalidFileId}_a`,
      command: 'docflow-probe',
      args: {
        fileId: invalidFileId,
        target: { text: 'Body' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })

    await expect(port.run(request({
      invocationId: `invocation_probe_after_${invalidFileId}_a`,
      command: 'docflow-probe',
      args: {
        fileId: 'valid-after-truncated-probe',
        target: { text: 'Body' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint))).resolves.toMatchObject({
      managedDataFiles: [expect.objectContaining({ role: 'probe-template' })]
    })
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('accepts the pinned nested read-only plan report and validates its managed plan file', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const probe = await port.run(request({
      invocationId: 'invocation_pinned_plan_probe_a',
      command: 'docflow-probe',
      args: {
        fileId: 'pinned-plan-shape',
        target: { text: 'Body' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    const result = await port.run(request({
      invocationId: 'invocation_pinned_nested_plan_a',
      command: 'docflow-plan',
      args: { fileId: 'pinned-plan-shape', baseHash: 'a'.repeat(64) },
      dataFiles: [
        {
          role: 'probe-template',
          encoding: 'managed',
          token: probe.managedDataFiles[0].token
        },
        {
          role: 'operations',
          encoding: 'json',
          name: 'operations.json',
          mediaType: 'application/json',
          content: { operations: [{ op: 'replaceText' }] }
        }
      ]
    }, fixture.entrypoint)) as Record<string, any>

    expect(result).toMatchObject({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-plan',
      ok: true,
      json: {
        report: {
          readOnly: true,
          canApply: true,
          baseDocumentHash: 'a'.repeat(64),
          resultDocumentHash: 'b'.repeat(64)
        }
      }
    })
    expect(JSON.stringify(result)).not.toContain('planFile')
    expect(JSON.stringify(result)).not.toContain(fixture.invocationsRoot)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it.each([
    'plan-count-drift',
    'plan-legacy-alias'
  ] as const)('rejects the unpinned %s result', async (invalidFileId) => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const probe = await port.run(request({
      invocationId: `invocation_${invalidFileId}_probe_a`,
      command: 'docflow-probe',
      args: {
        fileId: invalidFileId,
        target: { text: 'Body' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    await expect(port.run(request({
      invocationId: `invocation_${invalidFileId}_a`,
      command: 'docflow-plan',
      args: { fileId: invalidFileId, baseHash: 'a'.repeat(64) },
      dataFiles: [
        {
          role: 'probe-template',
          encoding: 'managed',
          token: probe.managedDataFiles[0].token
        },
        {
          role: 'operations',
          encoding: 'json',
          name: 'operations.json',
          mediaType: 'application/json',
          content: { operations: [{ op: 'replaceText' }] }
        }
      ]
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('fails closed at the managed-token entry cap without retaining the rejected capture', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: {
        maxEntries: 1,
        maxBytes: 64 * 1024 * 1024
      }
    })
    const firstProbe = await port.run(request({
      invocationId: 'invocation_managed_entry_cap_first_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>
    const firstToken = firstProbe.managedDataFiles[0].token as string

    let failure: unknown
    try {
      await port.run(request({
        invocationId: 'invocation_managed_entry_cap_rejected_a',
        command: 'docflow-probe',
        args: {
          fileId: 'file-b',
          target: { text: 'World' },
          view: 'target',
          operation: 'replaceText',
          include: ['nodes', 'text']
        },
        dataFiles: []
      }, fixture.entrypoint))
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })
    const serialized = serializeFailure(failure)
    expect(serialized).not.toContain(firstToken)
    expect(serialized).not.toContain(fixture.invocationsRoot)
    expect(serialized).not.toContain('ocdf_')

    const plan = await port.run(request({
      invocationId: 'invocation_managed_entry_cap_recovery_a',
      command: 'docflow-plan',
      args: { fileId: 'file-a', baseHash: 'a'.repeat(64) },
      dataFiles: [
        { role: 'probe-template', encoding: 'managed', token: firstToken },
        {
          role: 'operations',
          encoding: 'json',
          name: 'operations.json',
          mediaType: 'application/json',
          content: { operations: [{ op: 'replaceText' }] }
        }
      ]
    }, fixture.entrypoint)) as Record<string, any>

    expect(plan.managedDataFiles).toEqual([])
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('releases expired managed-token capacity immediately before a new capture', async () => {
    const fixture = await createFixture()
    let clock = Date.now()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: {
        maxEntries: 1,
        maxBytes: 64 * 1024 * 1024
      },
      now: () => clock
    })
    const deadlineAt = new Date(clock + 60 * 60 * 1_000).toISOString()
    await port.run(request({
      invocationId: 'invocation_managed_expiry_first_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint, deadlineAt))

    const replacement = await port.run(request({
      invocationId: 'invocation_managed_expiry_replacement_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-b',
        target: { text: 'World' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint, deadlineAt, () => {
      clock += 11 * 60 * 1_000
    })) as Record<string, any>

    expect(replacement.managedDataFiles).toHaveLength(1)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('fails closed at the managed-token byte cap without retaining rejected bytes', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: {
        maxEntries: 2_048,
        maxBytes: 128
      }
    })

    let failure: unknown
    try {
      await port.run(request({
        invocationId: 'invocation_managed_byte_cap_rejected_a',
        command: 'docflow-probe',
        args: {
          fileId: 'managed-byte-cap',
          target: { text: 'Hello' },
          view: 'target',
          operation: 'replaceText',
          include: ['nodes', 'text']
        },
        dataFiles: []
      }, fixture.entrypoint))
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })
    const serialized = serializeFailure(failure)
    expect(serialized).not.toContain(fixture.invocationsRoot)
    expect(serialized).not.toContain('ocdf_')

    const accepted = await port.run(request({
      invocationId: 'invocation_managed_byte_cap_recovery_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(accepted.managedDataFiles).toHaveLength(1)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('releases managed-token entry and byte capacity on dispose', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: {
        maxEntries: 1,
        maxBytes: 64
      }
    })
    await port.run(request({
      invocationId: 'invocation_managed_dispose_first_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint))

    port.dispose()

    const replacement = await port.run(request({
      invocationId: 'invocation_managed_dispose_replacement_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-b',
        target: { text: 'World' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(replacement.managedDataFiles).toHaveLength(1)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('releases byte capacity as each one-use managed token is consumed', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: {
        maxEntries: 2_048,
        maxBytes: 300
      }
    })
    const probe = await port.run(request({
      invocationId: 'invocation_managed_consume_probe_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-a',
        target: { text: 'Hello' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>
    const probeToken = probe.managedDataFiles[0].token as string
    const plan = await port.run(request({
      invocationId: 'invocation_managed_consume_plan_a',
      command: 'docflow-plan',
      args: { fileId: 'file-a', baseHash: 'a'.repeat(64) },
      dataFiles: [
        { role: 'probe-template', encoding: 'managed', token: probeToken },
        {
          role: 'operations',
          encoding: 'json',
          name: 'operations.json',
          mediaType: 'application/json',
          content: { operations: [{ op: 'replaceText' }] }
        }
      ]
    }, fixture.entrypoint)) as Record<string, any>
    expect(plan.managedDataFiles).toEqual([])

    const nextProbe = await port.run(request({
      invocationId: 'invocation_managed_consume_next_probe_a',
      command: 'docflow-probe',
      args: {
        fileId: 'file-b',
        target: { text: 'World' },
        view: 'target',
        operation: 'replaceText',
        include: ['nodes', 'text']
      },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>

    expect(nextProbe.managedDataFiles).toHaveLength(1)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it.each([
    { maxEntries: 2_049, maxBytes: 64 * 1024 * 1024 },
    { maxEntries: 2_048, maxBytes: (64 * 1024 * 1024) + 1 }
  ])('does not allow trusted setup to raise the fixed managed-token ceilings', async (limits) => {
    const fixture = await createFixture()

    expect(() => createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      managedTokenLimits: limits
    })).toThrow(expect.objectContaining({
      code: 'blocked-by-contract',
      dispatched: false
    }))
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('kills a timed-out read once and reports no retryable state', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const startedAt = Date.now()
    const operation = port.run(request({
      invocationId: 'invocation_timeout_a',
      command: 'file-info',
      args: { mode: 'hang' },
      dataFiles: []
    }, fixture.entrypoint, new Date(Date.now() + 100).toISOString()))

    await expect(operation).rejects.toMatchObject({
      code: 'cancelled',
      retry: 'never',
      attemptCount: 1,
      dispatched: true
    })
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('bounds stdout and maps uncertain mutation parsing to outcome-unknown', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    await expect(port.run(request({
      invocationId: 'invocation_large_read_a',
      command: 'file-info',
      args: { mode: 'large-output' },
      dataFiles: []
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'provider-contract-violation',
      stdoutTruncated: true,
      retry: 'never'
    })

    await expect(port.run(request({
      invocationId: 'invocation_bad_write_a',
      command: 'meta-edit',
      args: { mode: 'bad-json' },
      dataFiles: []
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'outcome-unknown',
      retry: 'never',
      attemptCount: 1,
      dispatched: true
    })
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('maps a DocFlow business failure without reporting false success', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_business_failure_a',
      command: 'docflow-read',
      args: { fileId: 'business-failure' },
      dataFiles: []
    }, fixture.entrypoint)) as Record<string, any>
    expect(result).toEqual({
      protocol: 'docflow-command-result:v1',
      command: 'docflow-read',
      ok: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed.',
        stage: 'read',
        dispatched: true
      }
    })
  })

  it('redacts the provider site when a child embeds it in a returned business error', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_business_failure_site_a',
      command: 'docflow-read',
      args: { fileId: 'business-failure-site' },
      dataFiles: []
    }, fixture.entrypoint))
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('https://provider.invalid')
    expect(serialized).toContain('[redacted-provider-site]/auth')
  })

  it('redacts a child echo of connection material from every returned field', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_secret_echo_a',
      command: 'file-info',
      args: { mode: 'echo-secret' },
      dataFiles: []
    }, fixture.entrypoint))
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('fixture-token')
    expect(serialized).not.toContain('https://provider.invalid')
    expect(serialized).toContain('[redacted-provider-site]/document-a')
    expect(serialized).toContain('[redacted]')
  })

  it('redacts both provider site and managed paths when a child combines them', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_site_and_path_echo_a',
      command: 'file-info',
      args: { mode: 'echo-site-and-path' },
      dataFiles: []
    }, fixture.entrypoint))
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('https://provider.invalid')
    expect(serialized).not.toContain(fixture.invocationsRoot)
    expect(serialized).not.toContain('sciforge-opencontent-')
    expect(serialized).toContain('[managed-local-data]')
  })

  it.each([
    { keyKind: 'token', forbidden: 'fixture-token' },
    { keyKind: 'site', forbidden: 'https://provider.invalid' },
    { keyKind: 'invocation-root', forbidden: 'sciforge-opencontent-' }
  ])('fails closed when a nested child object key contains $keyKind', async ({
    keyKind,
    forbidden
  }) => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    let failure: unknown
    try {
      await port.run(request({
        invocationId: `invocation_${keyKind.replace('-', '_')}_key_echo_a`,
        command: 'file-info',
        args: { mode: 'echo-sensitive-key', keyKind },
        dataFiles: []
      }, fixture.entrypoint))
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })
    expect(serializeFailure(failure)).not.toContain(forbidden)
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it.each(['known-path', 'combined'])(
    'fails closed without losing outcome-unknown semantics for a mutation key containing %s',
    async (keyKind) => {
      const fixture = await createFixture()
      const port = createNodeOpenContentCliProcessPort({
        trustedEntrypoint: fixture.entrypoint,
        temporaryRoot: fixture.invocationsRoot
      })
      const bytes = Buffer.from('managed upload body')
      let failure: unknown
      try {
        await port.run(request({
          invocationId: `invocation_upload_${keyKind.replace('-', '_')}_key_a`,
          command: 'upload',
          args: { folderId: 'folder-a', mode: 'echo-upload-sensitive-key', keyKind },
          dataFiles: [{
            role: 'source',
            encoding: 'managed-stream',
            name: 'source.txt',
            size: bytes.byteLength,
            read: async ({ offset, length }) => bytes.subarray(offset, offset + length)
          }]
        }, fixture.entrypoint))
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 'outcome-unknown',
        dispatched: true
      })
      const serialized = serializeFailure(failure)
      expect(serialized).not.toContain('fixture-token')
      expect(serialized).not.toContain('https://provider.invalid')
      expect(serialized).not.toContain('sciforge-opencontent-')
      expect(serialized).not.toContain(fixture.invocationsRoot)
      expect(await readdir(fixture.invocationsRoot)).toEqual([])
    }
  )

  it('scrubs URL-encoded connection, runner-path, and cache material from nested output', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const specialToken = 'fixture token/+=value'
    const formEncodedToken = encodeURIComponent(specialToken).replaceAll('%20', '+')
    const result = await port.run(request({
      invocationId: 'invocation_encoded_sensitive_values_a',
      command: 'file-info',
      args: { mode: 'echo-encoded-sensitive-values' },
      dataFiles: []
    }, fixture.entrypoint, undefined, undefined, {
      site: 'https://provider.invalid',
      systemUserToken: specialToken
    }))
    const serialized = JSON.stringify(result)

    for (const forbidden of [
      specialToken,
      encodeURIComponent(specialToken),
      formEncodedToken,
      'https://provider.invalid',
      encodeURIComponent('https://provider.invalid'),
      process.execPath,
      encodeURIComponent(process.execPath),
      fixture.invocationsRoot,
      encodeURIComponent(fixture.invocationsRoot),
      '.token_cache.json',
      '.auth_public_key_cache.json',
      'tokenCacheFile',
      'authPublicKeyCacheFile'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('scrubs an encoded provider site from a DocFlow business error', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const result = await port.run(request({
      invocationId: 'invocation_encoded_business_failure_a',
      command: 'docflow-read',
      args: { fileId: 'business-failure-encoded' },
      dataFiles: []
    }, fixture.entrypoint))
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('https://provider.invalid')
    expect(serialized).not.toContain(encodeURIComponent('https://provider.invalid'))
  })

  it('fails closed when a nested child object key URL-encodes sensitive material', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    let failure: unknown
    try {
      await port.run(request({
        invocationId: 'invocation_encoded_sensitive_key_a',
        command: 'file-info',
        args: { mode: 'echo-encoded-sensitive-key' },
        dataFiles: []
      }, fixture.entrypoint))
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      code: 'provider-contract-violation',
      dispatched: true
    })
    const serialized = serializeFailure(failure)
    expect(serialized).not.toContain(encodeURIComponent('https://provider.invalid'))
    expect(serialized).not.toContain(encodeURIComponent(fixture.invocationsRoot))
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it.each([
    { command: 'file-info' as const, expectedCode: 'provider-contract-violation' },
    { command: 'rename' as const, expectedCode: 'outcome-unknown' }
  ])('fails with $expectedCode when $command invocation cleanup fails', async ({
    command,
    expectedCode
  }) => {
    const fixture = await createFixture()
    let cleanupAttempts = 0
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot,
      removeInvocationRoot: async (path) => {
        cleanupAttempts += 1
        throw new Error(`must not escape: ${path}`)
      }
    })

    let failure: unknown
    try {
      await port.run(request({
        invocationId: 'invocation_cleanup_failure_a',
        command,
        args: { fileId: 'file-a' },
        dataFiles: []
      }, fixture.entrypoint))
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: expectedCode,
      dispatched: true
    })
    const serialized = serializeFailure(failure)
    expect(serialized).not.toContain('must not escape')
    expect(serialized).not.toContain(fixture.invocationsRoot)
    expect(cleanupAttempts).toBe(3)
  })

  it('fails closed on request-contract drift and snapshot auth-guard drift', async () => {
    const fixture = await createFixture()
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })
    const driftedRequest = {
      ...request({
        invocationId: 'invocation_contract_drift_a',
        command: 'file-info',
        args: { fileId: 'file-a' },
        dataFiles: []
      }, fixture.entrypoint),
      protocol: 'caller-controlled:v1'
    }
    await expect(port.run(driftedRequest as never)).rejects.toMatchObject({
      code: 'blocked-by-contract',
      dispatched: false
    })

    const driftedFixture = await createFixture()
    const source = await readFile(driftedFixture.entrypoint, 'utf8')
    await writeFile(
      driftedFixture.entrypoint,
      source.replace('TEST_AUTH_RETRY_ENABLED', 'UNRECOGNIZED_RETRY_POLICY')
    )
    const driftedPort = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: driftedFixture.entrypoint,
      temporaryRoot: driftedFixture.invocationsRoot
    })
    await expect(driftedPort.run(request({
      invocationId: 'invocation_auth_guard_drift_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, driftedFixture.entrypoint))).rejects.toMatchObject({
      code: 'blocked-by-contract',
      dispatched: false
    })

    const duplicatedFixture = await createFixture()
    const duplicatedSource = await readFile(duplicatedFixture.entrypoint, 'utf8')
    await writeFile(
      duplicatedFixture.entrypoint,
      duplicatedSource.replace(
        '/* TEST_AUTH_RETRY_ENABLED */',
        '/* TEST_AUTH_RETRY_ENABLED *//* TEST_AUTH_RETRY_ENABLED */'
      )
    )
    const duplicatedPort = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: duplicatedFixture.entrypoint,
      temporaryRoot: duplicatedFixture.invocationsRoot
    })
    await expect(duplicatedPort.run(request({
      invocationId: 'invocation_duplicate_auth_guard_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, duplicatedFixture.entrypoint))).rejects.toMatchObject({
      code: 'blocked-by-contract',
      dispatched: false
    })
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
    expect(await readdir(driftedFixture.invocationsRoot)).toEqual([])
    expect(await readdir(duplicatedFixture.invocationsRoot)).toEqual([])
  })

  it('rejects drift in every trusted runtime file before child dispatch', async () => {
    const cases = [
      'cli/bin/oc.js',
      'cli/docflow/docflow-node.cjs',
      'scripts/docflow-probe-compact.cjs',
      'package.json',
      'runtime-patches/cli-auth-retry-single-attempt.v1.json'
    ]
    for (const [index, relativePath] of cases.entries()) {
      const fixture = await createFixture()
      const trustedSnapshotIntegrity = fixtureSnapshotIntegrity(fixture.entrypoint)
      const principalCheck = vi.fn()
      const port = createNodeOpenContentCliProcessPort({
        trustedEntrypoint: fixture.entrypoint,
        temporaryRoot: fixture.invocationsRoot
      }, { trustedSnapshotIntegrity })
      const path = join(fixture.root, ...relativePath.split('/'))
      const bytes = await readFile(path)
      const changed = Buffer.from(bytes)
      changed[index % changed.byteLength] ^= 1
      await writeFile(path, changed)

      const failure = await port.run(request({
        invocationId: `invocation_snapshot_byte_drift_${index}`,
        command: 'file-info',
        args: { fileId: 'file-a' },
        dataFiles: []
      }, fixture.entrypoint, undefined, principalCheck)).catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: 'blocked-by-contract',
        dispatched: false,
        message: 'The pinned OpenContent CLI snapshot integrity check failed.'
      })
      expect(serializeFailure(failure)).not.toContain(relativePath)
      expect(principalCheck).not.toHaveBeenCalled()
      expect(await readdir(fixture.invocationsRoot)).toEqual([])
    }
  })

  it('materializes the same verified bytes when the source path changes after reading', async () => {
    const fixture = await createFixture()
    const trustedSnapshotIntegrity = fixtureSnapshotIntegrity(fixture.entrypoint)
    const afterSnapshotRead = vi.fn(async () => {
      await writeFile(fixture.entrypoint, 'throw new Error("swapped source must not execute")\n')
    })
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    }, { trustedSnapshotIntegrity, afterSnapshotRead })

    await expect(port.run(request({
      invocationId: 'invocation_snapshot_post_read_swap_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, fixture.entrypoint))).resolves.toMatchObject({ outcome: 'succeeded' })
    expect(afterSnapshotRead).toHaveBeenCalledOnce()

    await expect(port.run(request({
      invocationId: 'invocation_snapshot_post_read_swap_b',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'blocked-by-contract',
      dispatched: false
    })
    expect(afterSnapshotRead).toHaveBeenCalledOnce()
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

  it('rejects unrecognized fields in the fixed private source-patch descriptor', async () => {
    const fixture = await createFixture()
    const patchPath = join(
      fixture.root,
      'runtime-patches',
      'cli-auth-retry-single-attempt.v1.json'
    )
    const sourcePatch = JSON.parse(await readFile(patchPath, 'utf8')) as Record<string, unknown>
    await writeFile(patchPath, JSON.stringify({ ...sourcePatch, callerPatch: 'not-admitted' }))
    const port = createNodeOpenContentCliProcessPort({
      trustedEntrypoint: fixture.entrypoint,
      temporaryRoot: fixture.invocationsRoot
    })

    await expect(port.run(request({
      invocationId: 'invocation_unrecognized_patch_field_a',
      command: 'file-info',
      args: { fileId: 'file-a' },
      dataFiles: []
    }, fixture.entrypoint))).rejects.toMatchObject({
      code: 'blocked-by-contract',
      dispatched: false
    })
    expect(await readdir(fixture.invocationsRoot)).toEqual([])
  })

})

function request(
  invocation: OpenContentCliInvocation,
  entrypoint: string,
  deadlineAt = new Date(Date.now() + 10_000).toISOString(),
  assertPrincipalCurrent: OpenContentCliProcessRequest['assertPrincipalCurrent'] = () => undefined,
  connectionMaterial: OpenContentCliProcessRequest['connectionMaterial'] = {
    site: 'https://provider.invalid',
    systemUserToken: 'fixture-token'
  }
): OpenContentCliProcessRequest {
  return {
    protocol: OPENCONTENT_CLI_RUNNER_PROTOCOL,
    entrypoint,
    invocation,
    connectionMaterial,
    deadlineAt,
    signal: new AbortController().signal,
    assertPrincipalCurrent,
    limits: {
      stdoutBytes: OPENCONTENT_CLI_MAX_STDOUT_BYTES,
      stderrBytes: OPENCONTENT_CLI_MAX_STDERR_BYTES
    }
  }
}

function serializeFailure(failure: unknown): string {
  if (failure instanceof Error) {
    return JSON.stringify({
      ...failure,
      name: failure.name,
      message: failure.message
    })
  }
  return JSON.stringify(failure)
}

async function createFixture(): Promise<Readonly<{
  root: string
  entrypoint: string
  invocationsRoot: string
}>> {
  const container = await mkdtemp(join(tmpdir(), 'sciforge-oc-port-test-'))
  roots.push(container)
  const root = join(container, 'snapshot')
  const bin = join(root, 'cli', 'bin')
  const docflow = join(root, 'cli', 'docflow')
  const scripts = join(root, 'scripts')
  const runtimePatches = join(root, 'runtime-patches')
  const invocationsRoot = join(container, 'invocations')
  await mkdir(bin, { recursive: true })
  await mkdir(docflow, { recursive: true })
  await mkdir(scripts, { recursive: true })
  await mkdir(runtimePatches, { recursive: true })
  await mkdir(invocationsRoot)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'opencontent-cli-test-fixture',
    private: true,
    type: 'commonjs'
  }))
  await writeFile(join(docflow, 'docflow-node.cjs'), 'process.stdout.write("{}")\n')
  await writeFile(
    join(scripts, 'docflow-probe-compact.cjs'),
    'process.stdout.write(JSON.stringify({ success: true }))\n'
  )
  await writeFile(join(scripts, 'not-allowlisted.cjs'), 'throw new Error("must not copy")\n')
  await writeFile(
    join(runtimePatches, 'cli-auth-retry-single-attempt.v1.json'),
    JSON.stringify({
      protocol: 'sciforge-opencontent-cli-source-patch:v1',
      target: 'cli/bin/oc.js',
      needle: '/* TEST_AUTH_RETRY_ENABLED */',
      replacement: '/* TEST_SINGLE_ATTEMPT */'
    })
  )
  const entrypoint = join(bin, 'oc.js')
  await writeFile(entrypoint, FIXTURE_CLI)
  return Object.freeze({ root, entrypoint, invocationsRoot })
}

function fixtureSnapshotIntegrity(entrypoint: string) {
  const root = resolve(dirname(entrypoint), '..', '..')
  const files = [
    ['cli-entrypoint', 'cli/bin/oc.js'],
    ['docflow-entrypoint', 'cli/docflow/docflow-node.cjs'],
    ['docflow-probe-helper', 'scripts/docflow-probe-compact.cjs'],
    ['package-manifest', 'package.json'],
    ['cli-single-attempt-patch', 'runtime-patches/cli-auth-retry-single-attempt.v1.json']
  ] as const
  return files.map(([role, relativePath]) => {
    const bytes = readFileSync(join(root, ...relativePath.split('/')))
    return Object.freeze({
      role,
      relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength
    })
  })
}

const FIXTURE_CLI = String.raw`
'use strict'
/* TEST_AUTH_RETRY_ENABLED */
const fs = require('node:fs')
const path = require('node:path')

const argv = process.argv.slice(2)
const command = argv[1]
const params = JSON.parse(argv[2])
const send = (value) => process.stdout.write(JSON.stringify(value))

if (params.mode === 'hang') {
  setTimeout(() => send({ late: true }), 5_000)
} else if (params.mode === 'large-output') {
  send({ payload: 'x'.repeat(5 * 1024 * 1024) })
} else if (params.mode === 'bad-json') {
  process.stdout.write('{not-json')
} else if (params.mode === 'business-failure-site' || params.fileId === 'business-failure-site') {
  send({
    success: false,
    code: 'AUTH_FAILED',
    message: 'Authentication failed at ' + process.env.OPENCONTENT_SITE + '/auth.'
  })
} else if (params.mode === 'business-failure-encoded' || params.fileId === 'business-failure-encoded') {
  send({
    success: false,
    code: 'AUTH_FAILED',
    message: 'Authentication failed at ' + encodeURIComponent(process.env.OPENCONTENT_SITE) + '/auth.'
  })
} else if (params.mode === 'business-failure' || params.fileId === 'business-failure') {
  send({ success: false, code: 'AUTH_FAILED', message: 'Authentication failed.' })
} else if (params.mode === 'echo-secret') {
  process.stderr.write(process.env.SYSTEM_USER_TOKEN)
  send({
    token: process.env.SYSTEM_USER_TOKEN,
    nested: { value: process.env.SYSTEM_USER_TOKEN },
    site: process.env.OPENCONTENT_SITE,
    accessUrl: process.env.OPENCONTENT_SITE + '/document-a'
  })
} else if (params.mode === 'echo-site-and-path') {
  send({ diagnostic: process.env.OPENCONTENT_SITE + '/debug?cwd=' + process.cwd() })
} else if (params.mode === 'echo-sensitive-key') {
  const sensitiveKey = {
    token: process.env.SYSTEM_USER_TOKEN,
    site: process.env.OPENCONTENT_SITE,
    'invocation-root': process.cwd()
  }[params.keyKind]
  send({ nested: [{ ['child-key:' + sensitiveKey]: 'must fail closed' }] })
} else if (params.mode === 'echo-encoded-sensitive-key') {
  const sensitiveKey = encodeURIComponent([
    process.env.SYSTEM_USER_TOKEN,
    process.env.OPENCONTENT_SITE,
    process.cwd(),
    process.execPath,
    '.token_cache.json',
    'authPublicKeyCacheFile'
  ].join('|'))
  send({ nested: [{ ['child-key:' + sensitiveKey]: 'must fail closed' }] })
} else if (params.mode === 'echo-encoded-sensitive-values') {
  send({
    nested: [{
      token: encodeURIComponent(process.env.SYSTEM_USER_TOKEN).replaceAll('%20', '+'),
      site: encodeURIComponent(process.env.OPENCONTENT_SITE),
      rawTemporaryRoot: path.dirname(process.cwd()),
      invocationRoot: encodeURIComponent(process.cwd()),
      rawExecutable: process.execPath,
      executable: encodeURIComponent(process.execPath),
      cacheFiles: [
        '.token_cache.json',
        '.auth_public_key_cache.json',
        'tokenCacheFile',
        'authPublicKeyCacheFile'
      ]
    }]
  })
} else if (command === 'upload' && params.mode === 'echo-upload-sensitive-key') {
  const sensitiveKey = params.keyKind === 'known-path'
    ? params.filePaths
    : [
        process.env.SYSTEM_USER_TOKEN,
        process.env.OPENCONTENT_SITE,
        process.cwd(),
        params.filePaths
      ].join('|')
  send({ nested: [{ ['child-key:' + sensitiveKey]: 'must fail closed' }] })
} else if (command === 'file-info') {
  const runtimeRoot = path.resolve(__dirname, '..', '..')
  const scriptsRoot = path.join(runtimeRoot, 'scripts')
  const structuralProbeHelper = path.join(scriptsRoot, 'docflow-probe-compact.cjs')
  send({
    command,
    jsonFlag: argv[0] === '--json',
    singleJsonArg: argv.length === 3 && argv[2].startsWith('{'),
    cwdIsPrivate: path.basename(process.cwd()).startsWith('sciforge-opencontent-'),
    envKeys: Object.keys(process.env).sort(),
    siteMatches: process.env.OPENCONTENT_SITE === 'https://provider.invalid',
    tokenMatches: process.env.SYSTEM_USER_TOKEN === 'fixture-token',
    structuralProbeHelper: {
      exists: fs.existsSync(structuralProbeHelper),
      relativePath: path.relative(runtimeRoot, structuralProbeHelper)
    },
    runtimeScripts: fs.existsSync(scriptsRoot) ? fs.readdirSync(scriptsRoot).sort() : [],
    args: params
  })
} else if (command === 'docflow-create') {
  const content = fs.readFileSync(params.filePath, 'utf8')
  send({
    success: params.title === 'A document' && content === '<article><p>Hello</p></article>',
    operation: 'create',
    fileId: 'document-a',
    structuredDeliveryItems: [{
      protocolVersion: '1.0',
      kind: 'docflowCard',
      version: 'v1',
      businessIdentity: 'document-a',
      outcome: 'succeeded',
      payload: {
        projectId: 'document-a',
        versionId: 'version-a',
        name: 'A document.mdoc',
        versionName: '',
        accessUrl: 'https://provider.invalid/document-a',
        updateTime: '2026-08-20T00:00:00.000Z'
      }
    }]
  })
} else if (command === 'upload') {
  const content = fs.readFileSync(params.filePaths)
  send({ uploaded: content.toString('utf8'), size: content.byteLength, fileId: 'uploaded-a' })
} else if (command === 'download' || command === 'docflow-export' || command === 'docflow-image-download') {
  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true })
  fs.writeFileSync(params.outputPath, 'downloaded artifact')
  send({ filePath: params.outputPath, contentType: 'application/octet-stream' })
} else if (command === 'docflow-probe') {
  const output = path.resolve(__dirname, '..', '..', 'outputs', 'probe-template.json')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify({
    schemaVersion: 1,
    operationId: 'operation-a',
    ...(params.fileId === 'managed-byte-cap' ? { padding: 'x'.repeat(256) } : {})
  }))
  send({
    success: true,
    operation: 'probe',
    view: 'target',
    fileId: params.fileId,
    ...(params.fileId === 'legacy-alias-probe'
      ? { documentHash: '${'a'.repeat(64)}' }
      : {}),
    probe: {
      schemaVersion: 1,
      fileId: params.fileId,
      documentHash: '${'a'.repeat(64)}',
      matches: params.fileId === 'non-object-probe'
        ? ['invalid-selection']
        : [{ editTarget: { nodeId: 'node-a' } }],
      capabilities: { requestedOperation: params.operation, supported: true },
      editPlanTemplateFile: output
    },
    truncation: {
      total: params.fileId === 'incomplete-probe' ? 2 : 1,
      returned: 1,
      truncated: params.fileId === 'truncated-probe'
    }
  })
} else if (command === 'docflow-plan') {
  const template = JSON.parse(fs.readFileSync(params.templateFile, 'utf8'))
  const operations = JSON.parse(fs.readFileSync(params.operationsFile, 'utf8'))
  fs.writeFileSync(params.planFile, JSON.stringify({ ...template, ...operations }))
  send({
    success: true,
    operation: 'plan',
    fileId: params.fileId,
    ...(params.fileId === 'plan-legacy-alias' ? { canApply: true } : {}),
    operationId: 'operation-a',
    operationCount: params.fileId === 'plan-count-drift'
      ? operations.operations.length + 1
      : operations.operations.length,
    planFile: params.planFile,
    report: {
      readOnly: true,
      canApply: true,
      baseDocumentHash: '${'a'.repeat(64)}',
      resultDocumentHash: '${'b'.repeat(64)}'
    }
  })
} else {
  send({ command, args: params })
}
`
