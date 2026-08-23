import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  OPENCONTENT_CLI_MAX_STDERR_BYTES,
  OPENCONTENT_CLI_MAX_STDOUT_BYTES,
  OPENCONTENT_CLI_RUNNER_PROTOCOL,
  createOpenContentCliRunner,
  type OpenContentCliExecutionContext,
  type OpenContentCliProcessRequest,
  type OpenContentCliRunnerBinding
} from './cli-runner.js'

const testAssetRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-cli-runner-assets-'))
for (const relativePath of [
  'package.json',
  'cli/bin/oc.js',
  'cli/docflow/docflow-node.cjs',
  'scripts/docflow-probe-compact.cjs',
  'runtime-patches/cli-auth-retry-single-attempt.v1.json'
]) {
  const target = resolve(testAssetRoot, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, relativePath.endsWith('.json') ? '{}\n' : 'module.exports = {}\n', {
    mode: 0o644
  })
}
afterAll(() => rmSync(testAssetRoot, { recursive: true, force: true }))

function createTestRunner(binding: Omit<OpenContentCliRunnerBinding, 'assets'>) {
  return createOpenContentCliRunner({
    ...binding,
    assets: { mode: 'source', assetRoot: testAssetRoot }
  })
}

function executionContext(
  signal: AbortSignal,
  assertPrincipalCurrent: OpenContentCliExecutionContext['assertPrincipalCurrent'] = vi.fn()
): OpenContentCliExecutionContext {
  return {
    providerInstanceRef: 'provider-instance-a',
    invocationId: 'invocation-runner-a',
    deadlineAt: '2026-08-20T00:05:00.000Z',
    signal,
    assertPrincipalCurrent
  }
}

describe('OpenContent CLI runner seam', () => {
  it('carries the same Principal guard for entry and pre-dispatch revalidation', async () => {
    const assertPrincipalCurrent = vi.fn()
    const run = vi.fn(async (request: OpenContentCliProcessRequest) => {
      await request.assertPrincipalCurrent()
      return { protocol: 'docflow-command-result:v1' }
    })
    const runner = createTestRunner({
      execution: executionContext(new AbortController().signal, assertPrincipalCurrent),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })
    const invocation = {
      invocationId: 'invocation_docflow_read_a',
      command: 'docflow-read' as const,
      args: { fileId: 'file_a' },
      dataFiles: []
    }

    await expect(runner.invoke(invocation)).resolves.toEqual({
      protocol: 'docflow-command-result:v1'
    })
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].assertPrincipalCurrent).toBe(assertPrincipalCurrent)
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      protocol: OPENCONTENT_CLI_RUNNER_PROTOCOL,
      invocation,
      limits: {
        stdoutBytes: OPENCONTENT_CLI_MAX_STDOUT_BYTES,
        stderrBytes: OPENCONTENT_CLI_MAX_STDERR_BYTES
      }
    })
    expect(run.mock.calls[0]?.[0].entrypoint).toMatch(/cli\/bin\/oc\.js$/u)
  })

  it('rejects caller-controlled process fields before reaching the privileged port', async () => {
    const run = vi.fn()
    const runner = createTestRunner({
      execution: executionContext(new AbortController().signal),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })

    await expect(runner.invoke({
      invocationId: 'invocation_docflow_read_b',
      command: 'docflow-read',
      args: { fileId: 'file_a' },
      dataFiles: [],
      executable: '/tmp/untrusted',
      argv: ['--eval'],
      env: { SYSTEM_USER_TOKEN: 'caller-secret' }
    } as never)).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('does not dispatch after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn()
    const runner = createTestRunner({
      execution: executionContext(controller.signal),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })

    await expect(runner.invoke({
      invocationId: 'invocation_docflow_read_c',
      command: 'docflow-read',
      args: { fileId: 'file_a' },
      dataFiles: []
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(run).not.toHaveBeenCalled()
  })

  it('awaits the Host Principal assertion and does not dispatch after it rejects', async () => {
    const run = vi.fn()
    const assertPrincipalCurrent = vi.fn(async () => {
      throw new Error('private Host identity detail')
    })
    const runner = createTestRunner({
      execution: executionContext(
        new AbortController().signal,
        assertPrincipalCurrent
      ),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })

    await expect(runner.invoke({
      invocationId: 'invocation_principal_changed_a',
      command: 'docflow-read',
      args: { fileId: 'file_a' },
      dataFiles: []
    })).rejects.toThrow('private Host identity detail')
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalled()
  })

  it('uses the same fixed process seam for an extended-operation command', async () => {
    const run = vi.fn().mockResolvedValue({ protocol: 'opencontent-cli-result:v1' })
    const runner = createTestRunner({
      execution: executionContext(new AbortController().signal),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })
    const invocation = {
      invocationId: 'invocation_file_info_a',
      command: 'file-info' as const,
      args: { fileId: 'file-a' },
      dataFiles: []
    }

    await expect(runner.invoke(invocation)).resolves.toEqual({
      protocol: 'opencontent-cli-result:v1'
    })
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].invocation).toEqual(invocation)
  })

  it('rejects the retired user-info envelope before the privileged process port', async () => {
    const run = vi.fn()
    const assertPrincipalCurrent = vi.fn()
    const runner = createTestRunner({
      execution: executionContext(
        new AbortController().signal,
        assertPrincipalCurrent
      ),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })

    await expect(runner.invoke({
      invocationId: 'invocation_retired_user_info_runner',
      command: 'user-info',
      args: {},
      dataFiles: []
    } as never)).rejects.toThrow()
    expect(assertPrincipalCurrent).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects snapshot diagnostics and raw HTTP passthrough before the process seam', async () => {
    const run = vi.fn()
    const runner = createTestRunner({
      execution: executionContext(new AbortController().signal),
      connectionMaterial: {
        site: 'https://provider.invalid',
        systemUserToken: 'ephemeral-token'
      },
      processPort: { run }
    })
    for (const command of [
      'docflow-last-delivery',
      'docflow-failure-list',
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
      'POST'
    ]) {
      await expect(runner.invoke({
        invocationId: 'invocation_rejected_command_a',
        command,
        args: {},
        dataFiles: []
      } as never)).rejects.toThrow()
    }
    await expect(runner.invoke({
      invocationId: 'invocation_rejected_docflow_import',
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
    expect(run).not.toHaveBeenCalled()
  })

})
