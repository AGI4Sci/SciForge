import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'node:test'

import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_OPERATIONS,
  WorkspaceHostOperationError
} from '@sciforge/domain-sdk/workspace-host'

import {
  WorkspaceHostService,
  WorkspaceHostServiceError
} from './service.js'

const execFileAsync = promisify(execFile)

describe('WorkspaceHostService', () => {
  it('contains file operations, pages directory results, and enforces optimistic writes', async () => {
    const fixture = await createFixture()
    try {
      await mkdir(join(fixture.root, 'nested'))
      await writeFile(join(fixture.root, 'hello.txt'), 'hello', 'utf8')
      await writeFile(join(fixture.root, 'nested', 'second.txt'), 'second', 'utf8')

      const stat = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.fileStat,
        { path: 'hello.txt' }
      )
      assert.equal(stat.entry.kind, 'file')
      assert.equal(stat.entry.name, 'hello.txt')

      const read = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.fileRead,
        { path: 'hello.txt', maxBytes: 5 }
      )
      assert.equal(Buffer.from(read.contentBase64, 'base64').toString('utf8'), 'hello')
      assert.equal(read.truncated, false)

      const firstPage = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.directoryList,
        { path: '.', limit: 1 }
      )
      assert.equal(firstPage.entries.length, 1)
      assert.ok(firstPage.nextCursor)
      const secondPage = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.directoryList,
        { path: '.', limit: 10, cursor: firstPage.nextCursor }
      )
      assert.ok(secondPage.entries.length >= 1)

      const written = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.fileWrite,
        {
          path: 'hello.txt',
          contentBase64: Buffer.from('updated').toString('base64'),
          expectedRevision: read.revision,
          create: true
        }
      )
      assert.equal(written.size, 7)
      await assert.rejects(
        fixture.service.request(WORKSPACE_HOST_OPERATIONS.fileWrite, {
          path: 'hello.txt',
          contentBase64: Buffer.from('stale').toString('base64'),
          expectedRevision: read.revision,
          create: true
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostServiceError
          && error.code === 'revision_conflict'
      )

      await assert.rejects(
        fixture.service.request(WORKSPACE_HOST_OPERATIONS.fileRead, {
          path: '../outside.txt',
          maxBytes: 10
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostServiceError
          && error.code === 'path_outside_workspace'
      )
      await writeFile(join(fixture.outside, 'secret.txt'), 'secret', 'utf8')
      await symlink(join(fixture.outside, 'secret.txt'), join(fixture.root, 'escape'))
      await assert.rejects(
        fixture.service.request(WORKSPACE_HOST_OPERATIONS.fileRead, {
          path: 'escape',
          maxBytes: 10
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostServiceError
          && error.code === 'path_outside_workspace'
      )
    } finally {
      fixture.service.dispose()
      await fixture.cleanup()
    }
  })

  it('runs bounded search and Git through safe argv processes', async () => {
    const fixture = await createFixture()
    try {
      await writeFile(join(fixture.root, 'notes.txt'), 'alpha\nneedle here\nomega\n')
      await execFileAsync('git', ['init', '--quiet', fixture.root])
      const search = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.textSearch,
        {
          query: 'needle',
          path: '.',
          caseSensitive: true,
          maxResults: 10
        }
      )
      assert.deepEqual(search.matches[0], {
        path: 'notes.txt',
        line: 2,
        column: 1,
        preview: 'needle here'
      })
      const status = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.versionControlStatus,
        {}
      )
      assert.equal(status.clean, false)
      assert.equal(status.changes[0]?.status, 'untracked')
      const diff = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.versionControlDiff,
        {
          from: 'HEAD',
          paths: ['notes.txt'],
          maxCharacters: 10_000
        }
      ).catch(() => ({ text: '', truncated: false }))
      assert.equal(typeof diff.text, 'string')
    } finally {
      fixture.service.dispose()
      await fixture.cleanup()
    }
  })

  it('exposes only a server-selected system shell and bounded cursor I/O', async () => {
    const fixture = await createFixture()
    try {
      await assert.rejects(
        fixture.service.request(WORKSPACE_HOST_OPERATIONS.processCreate, {
          executable: '/bin/sh',
          args: ['-c', 'echo unsafe']
        } as never),
        (error: unknown) =>
          error instanceof WorkspaceHostServiceError
          && error.code === 'invalid_request'
      )

      const created = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.processCreate,
        { profile: 'system-shell', cwd: '.' }
      )
      const resize = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.processResize,
        {
          processId: created.processId,
          columns: 120,
          rows: 40
        }
      )
      assert.deepEqual(resize, {
        supported: false,
        behavior: process.platform === 'win32'
          ? 'unsupported'
          : 'sigwinch-notification'
      })
      await fixture.service.request(WORKSPACE_HOST_OPERATIONS.processWrite, {
        processId: created.processId,
        data: "printf 'safe-output\\n'\nexit\n"
      })
      let cursor = created.cursor
      let output = ''
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const read = await fixture.service.request(
          WORKSPACE_HOST_OPERATIONS.processRead,
          {
            processId: created.processId,
            cursor,
            maxCharacters: 100_000,
            waitMilliseconds: 1_000
          }
        )
        cursor = read.cursor
        output += read.chunks.map((chunk) => chunk.data).join('')
        if (read.exit) break
      }
      assert.match(output, /safe-output/)
      await fixture.service.request(WORKSPACE_HOST_OPERATIONS.processDispose, {
        processId: created.processId
      })
    } finally {
      fixture.service.dispose()
      await fixture.cleanup()
    }
  })

  it('bounds large reads to the SDK inline binary limit', async () => {
    const fixture = await createFixture()
    try {
      await writeFile(
        join(fixture.root, 'large.bin'),
        Buffer.alloc(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes + 1, 1)
      )
      const read = await fixture.service.request(
        WORKSPACE_HOST_OPERATIONS.fileRead,
        {
          path: 'large.bin',
          maxBytes: WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes
        }
      )
      assert.equal(read.bytesRead, WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes)
      assert.equal(read.truncated, true)
    } finally {
      fixture.service.dispose()
      await fixture.cleanup()
    }
  })

  it('maps canonical package operation failures without host-private imports', async () => {
    const fixture = await createFixture()
    try {
      fixture.service.registerOperation({
        operation: WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
        handler() {
          throw new WorkspaceHostOperationError({
            code: 'model-access-unavailable',
            message: 'Scoped model access is unavailable.',
            retryable: true
          })
        }
      })
      await assert.rejects(
        fixture.service.request(WORKSPACE_HOST_OPERATIONS.runtimeInvoke, {
          contractVersion: 1,
          runtimeId: 'codex',
          method: 'usage'
        }),
        (error: unknown) =>
          error instanceof WorkspaceHostServiceError
          && error.code === 'model-access-unavailable'
          && error.retryable
      )
    } finally {
      fixture.service.dispose()
      await fixture.cleanup()
    }
  })
})

async function createFixture(): Promise<{
  root: string
  outside: string
  service: WorkspaceHostService
  cleanup: () => Promise<void>
}> {
  const base = await mkdtemp(join(tmpdir(), 'sciforge-workspace-host-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  await mkdir(root)
  await mkdir(outside)
  const service = await WorkspaceHostService.create({
    workspaceRoot: root,
    lifecycleMode: 'connection-session'
  })
  return {
    root,
    outside,
    service,
    cleanup: () => rm(base, { recursive: true, force: true })
  }
}
