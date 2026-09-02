import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DomainFileTransferError
} from '@sciforge/domain-sdk/file-transfer'
import { samePrincipalSnapshot, type PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { HostFileTransferService } from './file-transfer'
import type {
  HostResourceGrantCaller,
  HostResourceGrantInvocation
} from './host-resource-grants'

const principalV1 = Object.freeze({
  authority: 'sciforge.local-identity',
  subject: 'person-1',
  assurance: 'local-selection' as const,
  deviceId: 'installation-1',
  identityVersion: 1
})

const principalV2 = Object.freeze({ ...principalV1, identityVersion: 2 })
const systemWorkspaceTransferGrant = 'fixture.system-workspace-transfer'
const systemWorkspaceTransferAuthorization = Object.freeze({
  requiredSystemCapabilityGrant: systemWorkspaceTransferGrant
})
const systemPrincipalSnapshotDigest = createHash('sha256').update(
  '{"assurance":"local-selection","authority":"sciforge.local-identity",' +
  '"deviceId":"installation-1","identityVersion":1,"subject":"person-1"}'
).digest('hex')
const systemExecutionContextDigest = createHash('sha256').update(
  '{"contractVersion":1,"executionId":"execution-1",' +
  '"projectId":"project-1","taskId":"task-1"}'
).digest('hex')

describe('Host-owned file transfers', () => {
  it('snapshots upload bytes and binds the opaque handle to owner, caller, and Principal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, 'captured bytes')
      const selection = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 1024
      })
      expect(selection).not.toHaveProperty('path')
      await writeFile(sourcePath, 'replacement bytes')

      const source = await port.openUploadSource({
        handle: requireUploadHandle(selection),
        maxBytes: 1024
      })
      expect(source).not.toHaveProperty('path')
      expect(source.sha256).toBe(
        createHash('sha256').update('captured bytes').digest('hex')
      )
      expect(Buffer.from(await source.read({ offset: 0, length: source.size })).toString())
        .toBe('captured bytes')
      await source.close()

      const otherOwnerSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 1024
      })
      const otherOwner = service.forOwner('domain.other', () => invocation)
      await expect(otherOwner.openUploadSource({
        handle: requireUploadHandle(otherOwnerSelection),
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      const afterWrongOwner = await port.openUploadSource({
        handle: requireUploadHandle(otherOwnerSelection),
        maxBytes: 1024
      })
      await afterWrongOwner.close()

      const wrongCallerSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 1024
      })
      invocation = invocationFor(grantCaller('window:8', principalV1))
      await expect(port.openUploadSource({
        handle: requireUploadHandle(wrongCallerSelection),
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      invocation = invocationFor(caller)
      const afterWrongCaller = await port.openUploadSource({
        handle: requireUploadHandle(wrongCallerSelection),
        maxBytes: 1024
      })
      await afterWrongCaller.close()

      const wrongKindSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 1024
      })
      await expect(port.openDownloadDestination({
        handle: requireUploadHandle(wrongKindSelection),
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      const afterWrongKind = await port.openUploadSource({
        handle: requireUploadHandle(wrongKindSelection),
        maxBytes: 1024
      })
      await afterWrongKind.close()

      const principalSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 1024
      })
      currentPrincipal = principalV2
      invocation = invocationFor(grantCaller('window:7', principalV2))
      await expect(port.openUploadSource({
        handle: requireUploadHandle(principalSelection),
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
      currentPrincipal = principalV1
      invocation = invocationFor(caller)
      await expect(port.openUploadSource({
        handle: requireUploadHandle(principalSelection),
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reauthorizes the live Principal during reads and requires an active invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, 'bytes')
      const selection = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(selection), maxBytes: 1024
      })
      currentPrincipal = principalV2
      await expect(source.read({ offset: 0, length: 1 }))
        .rejects.toMatchObject({ code: 'principal_changed' })
      await source.close()

      currentPrincipal = principalV1
      const second = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      invocation = undefined
      await expect(port.openUploadSource({
        handle: requireUploadHandle(second), maxBytes: 1024
      })).rejects.toThrow('active capability invocation')
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes a complete download atomically and returns a typed no-overwrite conflict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const invocation = invocationFor(caller)
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const destinationPath = join(root, 'download.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      expect(selection).not.toHaveProperty('path')
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('complete bytes'))
      await destination.commit()
      expect(await readFile(destinationPath, 'utf8')).toBe('complete bytes')

      const conflictPath = join(root, 'conflict.bin')
      const conflictSelection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: conflictPath
      })
      const conflict = await port.openDownloadDestination({
        handle: requireDownloadHandle(conflictSelection), maxBytes: 1024
      })
      await conflict.write(new TextEncoder().encode('must not replace'))
      await writeFile(conflictPath, 'winner')
      await expect(conflict.commit()).rejects.toSatisfy(
        (error: unknown) => error instanceof DomainFileTransferError &&
          error.code === 'destination_conflict'
      )
      expect(await readFile(conflictPath, 'utf8')).toBe('winner')
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to publish or clean up a replaced private download file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const destinationPath = join(root, 'download.bin')
    let replacementPath: string | undefined
    try {
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('private bytes'))
      const partialName = (await readdir(root))
        .find((name) => name.startsWith('.sciforge-download-'))
      expect(partialName).toBeDefined()
      replacementPath = join(root, partialName!)
      await rm(replacementPath, { force: true })
      await writeFile(replacementPath, 'attacker replacement')

      await expect(destination.commit())
        .rejects.toMatchObject({ code: 'destination_unavailable' })
      await expect(readFile(destinationPath))
        .rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(replacementPath, 'utf8'))
        .resolves.toBe('attacker replacement')
      await destination.abort()

      await rm(replacementPath, { force: true })
      replacementPath = undefined
      await service.sweepExpired()
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)
    } finally {
      if (replacementPath) await rm(replacementPath, { force: true })
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans a private download created while cancellation finishes its open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const controller = new AbortController()
    let cancelFirstOpen = true
    const service = new HostFileTransferService({
      temporaryRoot: root,
      maxTemporaryBytes: 5,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      openDownloadTemporaryFile: async (path) => {
        const file = await open(path, 'wx', 0o600)
        if (cancelFirstOpen) {
          cancelFirstOpen = false
          controller.abort()
        }
        return file
      }
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const first = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'first.bin')
      })
      await expect(port.openDownloadDestination({
        handle: requireDownloadHandle(first),
        maxBytes: 5,
        signal: controller.signal
      })).rejects.toMatchObject({ code: 'cancelled' })
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)

      const second = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'second.bin')
      })
      const reusable = await port.openDownloadDestination({
        handle: requireDownloadHandle(second),
        maxBytes: 5
      })
      await reusable.abort()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent writes before commit publishes the destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const destinationPath = join(root, 'ordered.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 1024
      })

      const firstWrite = destination.write(new TextEncoder().encode('first-'))
      const secondWrite = destination.write(new TextEncoder().encode('second'))
      const commit = destination.commit()
      await Promise.all([firstWrite, secondWrite, commit])

      expect(await readFile(destinationPath, 'utf8')).toBe('first-second')
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('sanitizes low-level destination write failures at the domain boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const prototype = await fileHandlePrototype(root)
    const write = vi.spyOn(prototype, 'write')
      .mockRejectedValueOnce(new Error(`private Host path: ${root}/partial`))
    try {
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'sanitized.bin')
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 1024
      })

      await expect(destination.write(new TextEncoder().encode('bytes')))
        .rejects.toSatisfy((error: unknown) =>
          error instanceof DomainFileTransferError &&
          error.code === 'destination_unavailable' &&
          !error.message.includes(root) &&
          error.cause === undefined
        )
      await destination.abort()
      await expect(readFile(join(root, 'sanitized.bin')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      write.mockRestore()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('sanitizes low-level close failures at both public transfer boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const reported: unknown[] = []
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      reportCleanupError: (error) => reported.push(error),
      openUploadFile: async (path) => {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        if (basename(path) === 'source.bin') {
          replaceCloseWithFailure(file, `private upload path: ${root}/staged`)
        }
        return file
      },
      openDownloadTemporaryFile: async (path) => {
        const file = await open(path, 'wx', 0o600)
        replaceCloseWithFailure(file, `private download path: ${root}/partial`)
        return file
      }
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'close-source.bin')
    await writeFile(sourcePath, 'bytes')
    try {
      const upload = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(upload), maxBytes: 5
      })
      await expect(source.close()).rejects.toSatisfy((error: unknown) =>
        error instanceof DomainFileTransferError &&
        error.code === 'source_unavailable' &&
        !error.message.includes(root) &&
        error.cause === undefined
      )

      const download = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'close-destination.bin')
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(download), maxBytes: 5
      })
      await expect(destination.abort()).rejects.toSatisfy((error: unknown) =>
        error instanceof DomainFileTransferError &&
        error.code === 'destination_unavailable' &&
        !error.message.includes(root) &&
        error.cause === undefined
      )
      expect(reported).toHaveLength(2)
      expect((await readdir(root)).some((name) =>
        name.startsWith('sciforge-upload-') || name.startsWith('.sciforge-download-')
      )).toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not publish when cancellation arrives during a blocked file sync', async () => {
    await expectBlockedCommitNotPublished('cancelled')
  })

  it('does not publish when the Principal changes during a blocked file sync', async () => {
    await expectBlockedCommitNotPublished('principal_changed')
  })

  it('does not publish when the exact invocation changes during a blocked file sync', async () => {
    await expectBlockedCommitNotPublished('invocation_replaced')
  })

  it('preserves a destination published while cancellation races the atomic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const entered = deferred()
    const release = deferred()
    const controller = new AbortController()
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      publishCompletedDownload: async (temporaryPath, destinationPath) => {
        entered.resolve()
        await release.promise
        await link(temporaryPath, destinationPath)
      }
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const destinationPath = join(root, 'link-race.bin')
    try {
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection),
        maxBytes: 1024,
        signal: controller.signal
      })
      await destination.write(new TextEncoder().encode('published but uncertain'))
      const commit = destination.commit()
      await entered.promise
      controller.abort()
      release.resolve()

      await expect(commit).rejects.toMatchObject({ code: 'cancelled' })
      expect(await readFile(destinationPath, 'utf8')).toBe('published but uncertain')
      await destination.abort()
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)
    } finally {
      release.resolve()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes partial destinations after cancellation or Principal change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    const invocation = invocationFor(caller)
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const destinationPath = join(root, 'download.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      const controller = new AbortController()
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection),
        maxBytes: 1024,
        signal: controller.signal
      })
      await destination.write(new TextEncoder().encode('partial'))
      controller.abort()
      await expect(destination.commit()).rejects.toMatchObject({ code: 'cancelled' })
      await destination.abort()
      await expect(readFile(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })

      const changedPath = join(root, 'changed.bin')
      const changedSelection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: changedPath
      })
      const changed = await port.openDownloadDestination({
        handle: requireDownloadHandle(changedSelection), maxBytes: 1024
      })
      await changed.write(new TextEncoder().encode('partial'))
      currentPrincipal = principalV2
      await expect(changed.commit()).rejects.toMatchObject({ code: 'principal_changed' })
      await changed.abort()
      await expect(readFile(changedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('closes the selected source and issues no grant when stat or close fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let failure: 'stat' | 'close' | undefined = 'stat'
    let closeCalls = 0
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1,
      openUploadFile: async (path) => {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        const selectedFailure = failure
        const originalClose = file.close.bind(file)
        Object.defineProperty(file, 'close', {
          configurable: true,
          enumerable: true,
          value: async () => {
            closeCalls += 1
            await originalClose()
            if (selectedFailure === 'close') throw new Error('close failed')
          }
        })
        if (selectedFailure === 'stat') {
          Object.defineProperty(file, 'stat', {
            configurable: true,
            value: async () => {
              throw new Error('stat failed')
            }
          })
        }
        return file
      }
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, 'bounded bytes')
    try {
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
      expect(closeCalls).toBe(1)

      failure = 'close'
      const closeCallsBeforeFailure = closeCalls
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
      expect(closeCalls).toBeGreaterThan(closeCallsBeforeFailure)

      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
      failure = undefined
      const valid = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(valid), maxBytes: 1024
      })
      await source.close()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on symlink selection and an in-flight source fingerprint change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const caller = grantCaller('window:7', principalV1)
    const sourcePath = join(root, 'selected.bin')
    const symlinkPath = join(root, 'selected-link.bin')
    await writeFile(sourcePath, 'bounded bytes')
    await symlink(sourcePath, symlinkPath)
    const ordinary = createService(root, () => principalV1)
    try {
      await expect(ordinary.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: symlinkPath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
    } finally {
      await ordinary.dispose()
    }

    let statCalls = 0
    const changed = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      openUploadFile: async (path) => {
        const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        const originalStat = file.stat.bind(file)
        Object.defineProperty(file, 'stat', {
          configurable: true,
          value: async (options: Readonly<{ bigint?: boolean }>) => {
            const info = await originalStat(options as { bigint: true })
            statCalls += 1
            return statCalls === 2
              ? { ...info, modifiedNanoseconds: info.mtimeNs + 1n, mtimeNs: info.mtimeNs + 1n }
              : info
          }
        })
        return file
      }
    })
    try {
      await expect(changed.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_changed' })
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
    } finally {
      await changed.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects replaced or mutated staged upload snapshots and releases their byte budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, '12345')
    try {
      const replacedSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const replacedDirectory = (await readdir(root))
        .find((name) => name.startsWith('sciforge-upload-'))
      expect(replacedDirectory).toBeDefined()
      const replacedPath = join(root, replacedDirectory!, 'source.bin')
      await rm(replacedPath, { force: true })
      await writeFile(replacedPath, 'abcde')

      await expect(port.openUploadSource({
        handle: requireUploadHandle(replacedSelection),
        maxBytes: 5
      })).rejects.toMatchObject({ code: 'source_changed' })
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)

      const mutatedSelection = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const mutatedDirectory = (await readdir(root))
        .find((name) => name.startsWith('sciforge-upload-'))
      expect(mutatedDirectory).toBeDefined()
      const mutatedPath = join(root, mutatedDirectory!, 'source.bin')
      const source = await port.openUploadSource({
        handle: requireUploadHandle(mutatedSelection),
        maxBytes: 5
      })
      await writeFile(mutatedPath, 'vwxyz')
      await utimes(mutatedPath, new Date(946_684_800_000), new Date(946_684_800_000))

      await expect(source.read({ offset: 0, length: 5 }))
        .rejects.toMatchObject({ code: 'source_changed' })
      await source.close()
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)

      const reusable = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const reopened = await port.openUploadSource({
        handle: requireUploadHandle(reusable),
        maxBytes: 5
      })
      await reopened.close()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds the staged snapshot digest to the bytes copied from the selected source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, '12345')
    const prototype = await fileHandlePrototype(root)
    const originalStat = prototype.stat
    let mutated = false
    const stat = vi.spyOn(prototype, 'stat')
      .mockImplementation(async function (
        this: TestFileHandlePrototype,
        options?: Readonly<{ bigint?: boolean }>
      ) {
        if (!mutated) {
          const stagedDirectory = (await readdir(root))
            .find((name) => name.startsWith('sciforge-upload-'))
          if (stagedDirectory) {
            mutated = true
            const stagedPath = join(root, stagedDirectory, 'source.bin')
            await writeFile(stagedPath, 'abcde')
            await utimes(
              stagedPath,
              new Date(946_684_800_000),
              new Date(946_684_800_000)
            )
          }
        }
        return originalStat.call(this, options)
      })
    try {
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })).rejects.toMatchObject({ code: 'source_changed' })
      expect(mutated).toBe(true)
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)

      const reusable = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(reusable),
        maxBytes: 5
      })
      await source.close()
    } finally {
      stat.mockRestore()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rechecks the staged fingerprint after every blocked upload read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, '12345')
    const entered = deferred()
    const release = deferred()
    let read: Readonly<{ mockRestore: () => void }> | undefined
    try {
      const selection = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const stagedDirectory = (await readdir(root))
        .find((name) => name.startsWith('sciforge-upload-'))
      expect(stagedDirectory).toBeDefined()
      const stagedPath = join(root, stagedDirectory!, 'source.bin')
      const source = await port.openUploadSource({
        handle: requireUploadHandle(selection),
        maxBytes: 5
      })
      const prototype = await fileHandlePrototype(root)
      const originalRead = prototype.read
      read = vi.spyOn(prototype, 'read')
        .mockImplementationOnce(async function (
          this: TestFileHandlePrototype,
          buffer: Uint8Array,
          offset: number,
          length: number,
          position: number
        ) {
          const result = await originalRead.call(this, buffer, offset, length, position)
          entered.resolve()
          await release.promise
          return result
        })

      const pendingRead = source.read({ offset: 0, length: 5 })
      await entered.promise
      await writeFile(stagedPath, 'vwxyz')
      await utimes(stagedPath, new Date(946_684_800_000), new Date(946_684_800_000))
      release.resolve()

      await expect(pendingRead).rejects.toMatchObject({ code: 'source_changed' })
      await source.close()
      read.mockRestore()
      read = undefined
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)

      const reusable = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const reopened = await port.openUploadSource({
        handle: requireUploadHandle(reusable),
        maxBytes: 5
      })
      await reopened.close()
    } finally {
      release.resolve()
      read?.mockRestore()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains staged byte reservations when the staging directory identity changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, '12345')
    let stageRelocated = false
    let stagedDirectoryPath: string | undefined
    const relocatedDirectory = join(root, 'relocated-stage')
    try {
      const selection = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const stagedDirectory = (await readdir(root))
        .find((name) => name.startsWith('sciforge-upload-'))
      expect(stagedDirectory).toBeDefined()
      stagedDirectoryPath = join(root, stagedDirectory!)
      await rename(stagedDirectoryPath, relocatedDirectory)
      stageRelocated = true
      await symlink(
        relocatedDirectory,
        stagedDirectoryPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      await expect(port.openUploadSource({
        handle: requireUploadHandle(selection),
        maxBytes: 5
      })).rejects.toMatchObject({ code: 'source_changed' })
      await expect(readFile(join(relocatedDirectory, 'source.bin'), 'utf8'))
        .resolves.toBe('12345')
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })

      await rm(stagedDirectoryPath, { recursive: true, force: true })
      await rename(relocatedDirectory, stagedDirectoryPath)
      stageRelocated = false
      await service.sweepExpired()
      const reusable = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const reopened = await port.openUploadSource({
        handle: requireUploadHandle(reusable),
        maxBytes: 5
      })
      await reopened.close()
    } finally {
      if (stageRelocated && stagedDirectoryPath) {
        await rm(stagedDirectoryPath, { recursive: true, force: true })
        await rename(relocatedDirectory, stagedDirectoryPath).catch(() => undefined)
      }
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for a pending registration during dispose and never issues afterward', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, 'bounded bytes')
    const prototype = await fileHandlePrototype(root)
    const entered = deferred()
    const release = deferred()
    const originalStat = prototype.stat
    const stat = vi.spyOn(prototype, 'stat')
      .mockImplementationOnce(async function (
        this: TestFileHandlePrototype,
        options?: Readonly<{ bigint?: boolean }>
      ) {
        entered.resolve()
        await release.promise
        return originalStat.call(this, options)
      })
    try {
      const registration = service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      await entered.promise
      let disposed = false
      const disposePromise = service.dispose()
      const disposal = disposePromise.then(() => {
        disposed = true
      })
      expect(service.dispose()).toBe(disposePromise)
      await Promise.resolve()
      expect(disposed).toBe(false)

      release.resolve()
      await expect(registration).rejects.toMatchObject({ code: 'grant_unavailable' })
      await disposal
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
    } finally {
      release.resolve()
      stat.mockRestore()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('revokes pending and active caller leases without poisoning a later caller epoch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, 'bounded bytes')
    const prototype = await fileHandlePrototype(root)
    const entered = deferred()
    const release = deferred()
    const originalStat = prototype.stat
    const stat = vi.spyOn(prototype, 'stat')
      .mockImplementationOnce(async function (
        this: TestFileHandlePrototype,
        options?: Readonly<{ bigint?: boolean }>
      ) {
        entered.resolve()
        await release.promise
        return originalStat.call(this, options)
      })
    try {
      const pending = service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      await entered.promise
      await service.revokeCaller(caller.callerId)
      release.resolve()
      await expect(pending).rejects.toMatchObject({ code: 'grant_unavailable' })
      stat.mockRestore()

      const later = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 1024
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(later), maxBytes: 1024
      })
      await service.revokeCaller(caller.callerId)
      await expect(source.read({ offset: 0, length: 1 }))
        .rejects.toMatchObject({ code: 'already_settled' })

      const downloadPath = join(root, 'revoked-download.bin')
      const downloadSelection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: downloadPath
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(downloadSelection), maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('must not publish'))
      await service.revokeCaller(caller.callerId)
      await expect(destination.commit()).rejects.toMatchObject({ code: 'already_settled' })
      await expect(readFile(downloadPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      release.resolve()
      vi.restoreAllMocks()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not issue a download grant when cancellation arrives during parent resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const entered = deferred()
    const release = deferred()
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1,
      resolveDownloadParent: async (path) => {
        entered.resolve()
        await release.promise
        return path
      }
    })
    const caller = grantCaller('window:7', principalV1)
    const controller = new AbortController()
    try {
      const registration = service.registerDownload({
        ownerId: 'domain.workspace-files',
        caller,
        path: join(root, 'cancelled.bin'),
        signal: controller.signal
      })
      await entered.promise
      controller.abort()
      release.resolve()
      await expect(registration).rejects.toMatchObject({ code: 'cancelled' })

      await expect(service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'valid.bin')
      })).resolves.toMatchObject({ cancelled: false })
    } finally {
      release.resolve()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retires an issued upload grant when picker cancellation wins before delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1,
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const controller = new AbortController()
    const firstPath = join(root, 'first-upload.bin')
    const secondPath = join(root, 'second-upload.bin')
    await writeFile(firstPath, '12345')
    await writeFile(secondPath, 'abcde')
    try {
      const registration = service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: firstPath,
        maxBytes: 5,
        signal: controller.signal
      })
      const cancelledBeforeDelivery = registration.then((selection) => {
        controller.abort()
        return selection
      })
      const selection = await cancelledBeforeDelivery
      await service.sweepExpired()

      await expect(port.openUploadSource({
        handle: requireUploadHandle(selection), maxBytes: 5
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)

      const replacement = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: secondPath, maxBytes: 5
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(replacement), maxBytes: 5
      })
      await source.close()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retires an issued download grant when picker cancellation wins before delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const controller = new AbortController()
    try {
      const registration = service.registerDownload({
        ownerId: 'domain.workspace-files',
        caller,
        path: join(root, 'cancelled-download.bin'),
        signal: controller.signal
      })
      const cancelledBeforeDelivery = registration.then((selection) => {
        controller.abort()
        return selection
      })
      const selection = await cancelledBeforeDelivery

      await expect(port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 5
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      const replacement = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'replacement.bin')
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(replacement), maxBytes: 5
      })
      await destination.abort()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('detaches picker cancellation after the exact grant is consumed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    const sourcePath = join(root, 'consumed-upload.bin')
    const destinationPath = join(root, 'consumed-download.bin')
    await writeFile(sourcePath, 'kept')
    try {
      const uploadController = new AbortController()
      const upload = await service.registerUpload({
        ownerId: 'domain.workspace-files',
        caller,
        path: sourcePath,
        maxBytes: 4,
        signal: uploadController.signal
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(upload), maxBytes: 4
      })
      uploadController.abort()
      expect(Buffer.from(await source.read({ offset: 0, length: 4 })).toString()).toBe('kept')
      await source.close()

      const downloadController = new AbortController()
      const download = await service.registerDownload({
        ownerId: 'domain.workspace-files',
        caller,
        path: destinationPath,
        signal: downloadController.signal
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(download), maxBytes: 4
      })
      downloadController.abort()
      await destination.write(new TextEncoder().encode('kept'))
      await destination.commit()
      expect(await readFile(destinationPath, 'utf8')).toBe('kept')
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bounds aggregate temporary bytes across upload snapshots and partial downloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, '12345')
      const upload = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 5
      })
      const download = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'download.bin')
      })
      await expect(port.openDownloadDestination({
        handle: requireDownloadHandle(download), maxBytes: 1
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })

      const source = await port.openUploadSource({
        handle: requireUploadHandle(upload), maxBytes: 5
      })
      await source.close()
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(download), maxBytes: 1
      })
      await destination.abort()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails bounded upload and download overflows without leaving partial files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const sourcePath = join(root, 'too-large.bin')
      await writeFile(sourcePath, '12345')
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: sourcePath, maxBytes: 4
      })).rejects.toMatchObject({ code: 'bound_exceeded' })

      const destinationPath = join(root, 'bounded.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: destinationPath
      })
      const destination = await port.openDownloadDestination({
        handle: requireDownloadHandle(selection), maxBytes: 4
      })
      await expect(destination.write(new TextEncoder().encode('12345')))
        .rejects.toMatchObject({ code: 'bound_exceeded' })
      await destination.abort()
      await expect(readFile(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
        .toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('eagerly removes expired upload snapshots and releases their byte budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let now = new Date('2026-08-16T10:00:00.000Z')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      now: () => now,
      handleTtlMs: 1_000,
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const fullPath = join(root, 'full.bin')
      const smallPath = join(root, 'small.bin')
      await writeFile(fullPath, '12345')
      await writeFile(smallPath, '1')
      const expired = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: fullPath, maxBytes: 5
      })
      await expect(service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: smallPath, maxBytes: 1
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })

      now = new Date('2026-08-16T10:00:02.000Z')
      await service.sweepExpired()
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
      const afterSweep = await service.registerUpload({
        ownerId: 'domain.workspace-files', caller, path: smallPath, maxBytes: 1
      })
      await expect(port.openUploadSource({
        handle: requireUploadHandle(expired), maxBytes: 5
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(afterSweep), maxBytes: 1
      })
      await source.close()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bounds grant capacity and expires unused single-use handles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    let now = new Date('2026-08-16T10:00:00.000Z')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      now: () => now,
      handleTtlMs: 1_000,
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const first = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'one.bin')
      })
      await expect(service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'two.bin')
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })
      now = new Date('2026-08-16T10:00:02.000Z')
      await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'two.bin')
      })
      await expect(port.openDownloadDestination({
        handle: requireDownloadHandle(first), maxBytes: 1024
      })).rejects.toMatchObject({ code: 'grant_unavailable' })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('counts active partial transfers against the bounded capacity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.workspace-files', invocationProviderFor(caller))
    try {
      const first = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'one.bin')
      })
      const active = await port.openDownloadDestination({
        handle: requireDownloadHandle(first), maxBytes: 1024
      })
      await expect(service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'two.bin')
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })
      await active.abort()
      const afterAbort = await service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'two.bin')
      })
      const committed = await port.openDownloadDestination({
        handle: requireDownloadHandle(afterAbort), maxBytes: 1024
      })
      await committed.write(new TextEncoder().encode('complete'))
      await committed.commit()
      await expect(service.registerDownload({
        ownerId: 'domain.workspace-files', caller, path: join(root, 'three.bin')
      })).resolves.toMatchObject({ cancelled: false })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens an Agent upload source for an exact Broker-authorized resource write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'README.md'), '# delegated upload\n')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocation: HostResourceGrantInvocation = Object.freeze({
      caller: Object.freeze({
        ...caller,
        audience: 'agent',
        workspaceId: workspace
      }),
      actionId: 'workspace-files.agent-upload-new',
      invocationId: 'workspace-files-upload-readme-1',
      effect: 'external-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      autonomousWrite: 'resource-authorized',
      authorizedResource: Object.freeze({
        resourceRef: 'res_workspace_folder',
        resourceKind: 'workspace-files.container',
        workspaceId: workspace,
        semanticRevision: '1'
      })
    })
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const source = await port.openWorkspaceUploadSource({
        relativePath: 'README.md',
        maxBytes: 1024
      })
      expect(source.sha256).toBe(
        createHash('sha256').update('# delegated upload\n').digest('hex')
      )
      expect(Buffer.from(await source.read({ offset: 0, length: source.size })).toString())
        .toBe('# delegated upload\n')
      await source.close()
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails a blocked upload read when the exact invocation object is replaced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'README.md'), '# exact lease\n')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    let invocation = workspaceTransferInvocation(caller, workspace, 'upload-source')
    const port = service.forOwner('domain.workspace-files', () => invocation)
    const entered = deferred()
    const release = deferred()
    let read: Readonly<{ mockRestore: () => void }> | undefined
    try {
      const source = await port.openWorkspaceUploadSource({
        relativePath: 'README.md',
        maxBytes: 1024
      })
      const prototype = await fileHandlePrototype(root)
      const originalRead = prototype.read
      read = vi.spyOn(prototype, 'read')
        .mockImplementationOnce(async function (
          this: TestFileHandlePrototype,
          buffer: Uint8Array,
          offset: number,
          length: number,
          position: number
        ) {
          entered.resolve()
          await release.promise
          return originalRead.call(this, buffer, offset, length, position)
        })

      const pendingRead = source.read({ offset: 0, length: source.size })
      await entered.promise
      invocation = workspaceTransferInvocation(caller, workspace, 'upload-source')
      release.resolve()

      await expect(pendingRead).rejects.toMatchObject({ code: 'grant_unavailable' })
      await source.close()
      expect((await readdir(temporary))
        .some((name) => name.startsWith('sciforge-upload-'))).toBe(false)
    } finally {
      release.resolve()
      read?.mockRestore()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('opens an Agent download destination for an exact Broker-authorized Workspace write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocation: HostResourceGrantInvocation = Object.freeze({
      caller: Object.freeze({
        ...caller,
        audience: 'agent',
        workspaceId: workspace
      }),
      actionId: 'workspace-files.agent-download',
      invocationId: 'workspace-files-download-readme-1',
      effect: 'workspace-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      authorizedResource: Object.freeze({
        resourceRef: 'res_workspace_file',
        resourceKind: 'workspace-files.file',
        workspaceId: workspace,
        semanticRevision: '1'
      })
    })
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'README.downloaded.md',
        maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('# delegated download\n'))
      await destination.commit()
      await expect(readFile(join(workspace, 'README.downloaded.md'), 'utf8'))
        .resolves.toBe('# delegated download\n')
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps an opened destination bound to the exact resource revision lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const template = workspaceTransferInvocation(
      caller,
      workspace,
      'download-destination',
      '1'
    )
    const authorizedResource = { ...template.authorizedResource! }
    const exactInvocation: HostResourceGrantInvocation = {
      ...template,
      caller: { ...template.caller },
      authorizedResource
    }
    let invocation: HostResourceGrantInvocation | undefined = exactInvocation
    const port = service.forOwner('domain.workspace-files', () => invocation)
    const targetPath = join(workspace, 'revision-bound.bin')
    try {
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'revision-bound.bin',
        maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('revision one'))
      authorizedResource.semanticRevision = '2'

      await expect(destination.commit())
        .rejects.toMatchObject({ code: 'grant_unavailable' })
      await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
      invocation = undefined
      await destination.abort()
      expect((await readdir(workspace))
        .some((name) => name.startsWith('.sciforge-download-'))).toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when a Workspace destination parent is swapped for a link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const selectedParent = join(workspace, 'selected')
    const outside = join(root, 'outside')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(selectedParent, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    const relocatedParent = join(outside, 'relocated-selected')
    const relocatedTarget = join(relocatedParent, 'escaped.bin')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocation = workspaceTransferInvocation(
      caller,
      workspace,
      'download-destination'
    )
    const port = service.forOwner('domain.workspace-files', () => invocation)
    let parentRelocated = false
    try {
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'selected/escaped.bin',
        maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('must remain bounded'))
      await rename(selectedParent, relocatedParent)
      parentRelocated = true
      await symlink(
        relocatedParent,
        selectedParent,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      await expect(destination.commit())
        .rejects.toMatchObject({ code: 'destination_unavailable' })
      await expect(readFile(relocatedTarget)).rejects.toMatchObject({ code: 'ENOENT' })
      await destination.abort()

      await rm(selectedParent, { recursive: true, force: true })
      await rename(relocatedParent, selectedParent)
      parentRelocated = false
      await service.sweepExpired()
      expect((await readdir(selectedParent))
        .some((name) => name.startsWith('.sciforge-download-'))).toBe(false)
    } finally {
      if (parentRelocated) {
        await rm(selectedParent, { recursive: true, force: true })
        await rename(relocatedParent, selectedParent).catch(() => undefined)
      }
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not re-legitimize a Workspace parent swapped during destination registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const selectedParent = join(workspace, 'selected')
    const outside = join(root, 'outside')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(selectedParent, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    const entered = deferred()
    const release = deferred()
    const relocatedParent = join(outside, 'relocated-selected')
    const service = new HostFileTransferService({
      temporaryRoot: temporary,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      resolveDownloadParent: async (path) => {
        entered.resolve()
        await release.promise
        return realpath(path)
      }
    })
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocation = workspaceTransferInvocation(
      caller,
      workspace,
      'download-destination'
    )
    const port = service.forOwner('domain.workspace-files', () => invocation)
    let parentRelocated = false
    try {
      const destination = port.openWorkspaceDownloadDestination({
        relativePath: 'selected/escaped.bin',
        maxBytes: 1024
      })
      await entered.promise
      await rename(selectedParent, relocatedParent)
      parentRelocated = true
      await symlink(
        relocatedParent,
        selectedParent,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      release.resolve()

      await expect(destination).rejects.toMatchObject({ code: 'destination_unavailable' })
      await expect(readFile(join(relocatedParent, 'escaped.bin')))
        .rejects.toMatchObject({ code: 'ENOENT' })

      await rm(selectedParent, { recursive: true, force: true })
      await rename(relocatedParent, selectedParent)
      parentRelocated = false
    } finally {
      release.resolve()
      if (parentRelocated) {
        await rm(selectedParent, { recursive: true, force: true })
        await rename(relocatedParent, selectedParent).catch(() => undefined)
      }
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a missing delegated Agent resource lease as an authorization failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'README.md'), '# must remain unread\n')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocation: HostResourceGrantInvocation = Object.freeze({
      caller: Object.freeze({
        ...caller,
        audience: 'agent',
        workspaceId: workspace
      }),
      actionId: 'workspace-files.agent-upload-new',
      invocationId: 'workspace-files-upload-without-resource-1',
      effect: 'external-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      autonomousWrite: 'resource-authorized'
    })
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'README.md',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps delegated Agent transfer authority bound to its direction and Workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const otherWorkspace = join(root, 'other-workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(otherWorkspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'README.md'), '# bounded authority\n')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const invocationForDirection = (
      direction: 'upload-source' | 'download-destination',
      resourceWorkspace = workspace
    ): HostResourceGrantInvocation => Object.freeze({
      caller: Object.freeze({
        ...caller,
        audience: 'agent',
        workspaceId: workspace
      }),
      actionId: direction === 'upload-source'
        ? 'workspace-files.agent-upload-new'
        : 'workspace-files.agent-download',
      invocationId: `workspace-files-${direction}-bounded-1`,
      effect: direction === 'upload-source' ? 'external-write' : 'workspace-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      ...(direction === 'upload-source'
        ? { autonomousWrite: 'resource-authorized' }
        : {}),
      authorizedResource: Object.freeze({
        resourceRef: 'res_workspace_entry',
        resourceKind: 'workspace-files.entry',
        workspaceId: resourceWorkspace,
        semanticRevision: '1'
      })
    })
    let invocation = invocationForDirection('upload-source')
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: 'README.downloaded.md',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
      invocation = invocationForDirection('download-destination')
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'README.md',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
      invocation = invocationForDirection('upload-source', otherWorkspace)
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'README.md',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('mints one-shot Agent transfers only from the active Workspace relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(join(root, 'temporary'), { recursive: true })
    ])
    const service = createService(join(root, 'temporary'), () => principalV1)
    const caller = grantCaller('agent:thread-1', principalV1)
    const authorizedResource = Object.freeze({
      resourceRef: 'res_workspace_entry',
      resourceKind: 'workspace-files.entry',
      workspaceId: workspace,
      semanticRevision: '1'
    })
    const transferInvocation = (
      direction: 'upload-source' | 'download-destination'
    ): HostResourceGrantInvocation => Object.freeze({
      caller: Object.freeze({
        ...caller,
        audience: 'agent',
        workspaceId: workspace
      }),
      actionId: direction === 'upload-source'
        ? 'workspace-files.agent-upload-new'
        : 'workspace-files.agent-download',
      invocationId: direction === 'upload-source'
        ? 'workspace-files-workspace-upload-1'
        : 'workspace-files-workspace-download-1',
      effect: direction === 'upload-source' ? 'external-write' : 'workspace-write',
      approval: 'none',
      approved: true,
      scope: 'resource',
      ...(direction === 'upload-source'
        ? { autonomousWrite: 'resource-authorized' }
        : {}),
      authorizedResource
    })
    let invocation: HostResourceGrantInvocation | undefined = transferInvocation('upload-source')
    const port = service.forOwner('domain.workspace-files', () => invocation)
    try {
      await Promise.all([
        writeFile(join(workspace, 'upload.txt'), 'workspace bytes'),
        writeFile(join(workspace, 'too-large.bin'), Buffer.alloc(1_025)),
        writeFile(join(outside, 'secret.txt'), 'outside bytes')
      ])
      const source = await port.openWorkspaceUploadSource({
        relativePath: 'upload.txt',
        maxBytes: 1024
      })
      expect(Buffer.from(await source.read({ offset: 0, length: source.size })).toString())
        .toBe('workspace bytes')
      await source.close()

      await expect(port.openWorkspaceUploadSource({
        relativePath: '../outside/secret.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'invalid_request' })

      await symlink(outside, join(workspace, 'escaped'), 'dir')
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'escaped/secret.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'too-large.bin',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'bound_exceeded' })
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'upload.txt',
        maxBytes: 1024,
        signal: cancelled.signal
      })).rejects.toMatchObject({ code: 'cancelled' })

      invocation = transferInvocation('download-destination')
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'download.txt',
        maxBytes: 1024
      })
      await destination.write(new TextEncoder().encode('downloaded bytes'))
      await destination.commit()
      await expect(readFile(join(workspace, 'download.txt'), 'utf8'))
        .resolves.toBe('downloaded bytes')
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: 'download.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'destination_conflict' })
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: 'escaped/file.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'destination_unavailable' })
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: 'cancelled.txt',
        maxBytes: 1024,
        signal: cancelled.signal
      })).rejects.toMatchObject({ code: 'cancelled' })

      invocation = invocationFor(caller, { audience: 'ui', workspaceId: workspace })
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'upload.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the canonical data plane for Broker-approved system Workspace transfers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'system-upload.txt'), 'system upload bytes')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('runtime:background-1', principalV1)
    let invocation = systemWorkspaceTransferInvocation(caller, workspace, 'upload-source')
    const port = service.forOwner('domain.fixture', () => invocation)
    try {
      const source = await port.openWorkspaceUploadSource({
        relativePath: 'system-upload.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })
      expect(source.size).toBe(Buffer.byteLength('system upload bytes'))
      expect(source.sha256).toBe(
        createHash('sha256').update('system upload bytes').digest('hex')
      )
      expect(Buffer.from(await source.read({ offset: 0, length: source.size })).toString())
        .toBe('system upload bytes')
      await source.close()

      invocation = systemWorkspaceTransferInvocation(
        caller,
        workspace,
        'download-destination'
      )
      const destinationPath = join(workspace, 'system-download.txt')
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'system-download.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })
      await destination.write(new TextEncoder().encode('system download bytes'))
      await destination.commit()
      await expect(readFile(destinationPath, 'utf8')).resolves.toBe('system download bytes')

      const conflictPath = join(workspace, 'system-conflict.txt')
      const conflict = await port.openWorkspaceDownloadDestination({
        relativePath: 'system-conflict.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })
      await conflict.write(new TextEncoder().encode('must not overwrite'))
      await writeFile(conflictPath, 'existing winner')
      await expect(conflict.commit()).rejects.toMatchObject({
        code: 'destination_conflict'
      })
      await expect(readFile(conflictPath, 'utf8')).resolves.toBe('existing winner')
      await conflict.abort()
      expect((await readdir(workspace))
        .some((name) => name.startsWith('.sciforge-download-'))).toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects incomplete or forged system Workspace authority before opening a file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'protected.txt'), 'protected bytes')
    const openUploadFile = vi.fn((path: string) => open(path, constants.O_RDONLY))
    const service = new HostFileTransferService({
      temporaryRoot: temporary,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      openUploadFile
    })
    const caller = grantCaller('runtime:background-1', principalV1)
    const valid = systemWorkspaceTransferInvocation(caller, workspace, 'upload-source')
    const principalMissing: HostResourceGrantInvocation = {
      ...valid,
      caller: {
        callerId: caller.callerId,
        audience: 'system',
        workspaceId: workspace,
        capabilityGrants: [systemWorkspaceTransferGrant],
        principalSnapshotDigest: systemPrincipalSnapshotDigest,
        executionContextDigest: systemExecutionContextDigest
      }
    }
    const stalePrincipal = systemWorkspaceTransferInvocation(
      grantCaller(caller.callerId, principalV2),
      workspace,
      'upload-source'
    )
    const cases: readonly Readonly<{
      name: string
      invocation: HostResourceGrantInvocation
      code: 'grant_unavailable' | 'principal_changed'
    }>[] = [
      {
        name: 'missing exact grant',
        invocation: { ...valid, caller: { ...valid.caller, capabilityGrants: [] } },
        code: 'grant_unavailable'
      },
      {
        name: 'wrong grant',
        invocation: {
          ...valid,
          caller: { ...valid.caller, capabilityGrants: ['fixture.other-grant'] }
        },
        code: 'grant_unavailable'
      },
      {
        name: 'wrong audience',
        invocation: { ...valid, caller: { ...valid.caller, audience: 'agent' } },
        code: 'grant_unavailable'
      },
      {
        name: 'missing Principal digest',
        invocation: {
          ...valid,
          caller: { ...valid.caller, principalSnapshotDigest: undefined }
        },
        code: 'grant_unavailable'
      },
      {
        name: 'missing execution digest',
        invocation: {
          ...valid,
          caller: { ...valid.caller, executionContextDigest: undefined }
        },
        code: 'grant_unavailable'
      },
      {
        name: 'malformed execution digest',
        invocation: {
          ...valid,
          caller: { ...valid.caller, executionContextDigest: 'caller-authored' }
        },
        code: 'grant_unavailable'
      },
      {
        name: 'wrong effect',
        invocation: { ...valid, effect: 'workspace-write' },
        code: 'grant_unavailable'
      },
      {
        name: 'missing invocation ID',
        invocation: { ...valid, invocationId: '' },
        code: 'grant_unavailable'
      },
      {
        name: 'non-canonical invocation ID',
        invocation: { ...valid, invocationId: ' caller-selected ' },
        code: 'grant_unavailable'
      },
      {
        name: 'missing Workspace',
        invocation: { ...valid, caller: { ...valid.caller, workspaceId: '' } },
        code: 'grant_unavailable'
      },
      {
        name: 'wrong scope',
        invocation: { ...valid, scope: 'resource' },
        code: 'grant_unavailable'
      },
      {
        name: 'confirmation approval',
        invocation: { ...valid, approval: 'confirmation' },
        code: 'grant_unavailable'
      },
      {
        name: 'not approved',
        invocation: { ...valid, approved: false },
        code: 'grant_unavailable'
      },
      {
        name: 'non-canonical action ID',
        invocation: { ...valid, actionId: ' fixture.system-upload ' },
        code: 'grant_unavailable'
      },
      {
        name: 'missing invocation Principal',
        invocation: principalMissing,
        code: 'grant_unavailable'
      },
      {
        name: 'stale live Principal',
        invocation: stalePrincipal,
        code: 'principal_changed'
      }
    ]
    let invocation: HostResourceGrantInvocation | undefined = valid
    const port = service.forOwner('domain.fixture', () => invocation)
    try {
      for (const testCase of cases) {
        invocation = testCase.invocation
        await expect(port.openWorkspaceUploadSource({
          relativePath: 'protected.txt',
          maxBytes: 1024,
          systemAuthorization: systemWorkspaceTransferAuthorization
        }), testCase.name).rejects.toMatchObject({ code: testCase.code })
      }
      invocation = valid
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'protected.txt',
        maxBytes: 1024
      })).rejects.toMatchObject({ code: 'principal_changed' })
      expect(openUploadFile).not.toHaveBeenCalled()
      expect(await readdir(temporary)).toEqual([])
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('contains system Workspace transfers across traversal and symlink attempts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(outside, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(outside, 'secret.txt'), 'outside secret')
    await symlink(outside, join(workspace, 'escaped'), 'dir')
    const service = createService(temporary, () => principalV1)
    const caller = grantCaller('runtime:background-1', principalV1)
    let invocation = systemWorkspaceTransferInvocation(caller, workspace, 'upload-source')
    const port = service.forOwner('domain.fixture', () => invocation)
    try {
      await expect(port.openWorkspaceUploadSource({
        relativePath: '../outside/secret.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(port.openWorkspaceUploadSource({
        relativePath: 'escaped/secret.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })).rejects.toMatchObject({ code: 'source_unavailable' })

      invocation = systemWorkspaceTransferInvocation(
        caller,
        workspace,
        'download-destination'
      )
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: '../outside/new.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(port.openWorkspaceDownloadDestination({
        relativePath: 'escaped/new.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })).rejects.toMatchObject({ code: 'destination_unavailable' })
      await expect(readFile(join(outside, 'secret.txt'), 'utf8')).resolves.toBe('outside secret')
      await expect(readFile(join(outside, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(temporary)).toEqual([])
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retires exact system transfer resources after Principal or grant-lease changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
    const workspace = join(root, 'workspace')
    const temporary = join(root, 'temporary')
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(temporary, { recursive: true })
    ])
    await writeFile(join(workspace, 'leased.txt'), 'leased bytes')
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(temporary, () => currentPrincipal)
    const caller = grantCaller('runtime:background-1', principalV1)
    let invocation: HostResourceGrantInvocation = systemWorkspaceTransferInvocation(
      caller,
      workspace,
      'upload-source'
    )
    const port = service.forOwner('domain.fixture', () => invocation)
    try {
      const source = await port.openWorkspaceUploadSource({
        relativePath: 'leased.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })
      expect((await readdir(temporary))
        .some((name) => name.startsWith('sciforge-upload-'))).toBe(true)
      currentPrincipal = principalV2
      await expect(source.read({ offset: 0, length: 1 }))
        .rejects.toMatchObject({ code: 'principal_changed' })
      await source.close()
      expect((await readdir(temporary))
        .some((name) => name.startsWith('sciforge-upload-'))).toBe(false)

      currentPrincipal = principalV1
      const capabilityGrants = [systemWorkspaceTransferGrant]
      const destinationInvocation = systemWorkspaceTransferInvocation(
        caller,
        workspace,
        'download-destination'
      )
      invocation = {
        ...destinationInvocation,
        caller: { ...destinationInvocation.caller, capabilityGrants }
      }
      const targetPath = join(workspace, 'grant-retired.txt')
      const destination = await port.openWorkspaceDownloadDestination({
        relativePath: 'grant-retired.txt',
        maxBytes: 1024,
        systemAuthorization: systemWorkspaceTransferAuthorization
      })
      await destination.write(new TextEncoder().encode('must remain private'))
      capabilityGrants.splice(0)
      await expect(destination.commit())
        .rejects.toMatchObject({ code: 'grant_unavailable' })
      await destination.abort()
      await expect(readFile(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(workspace))
        .some((name) => name.startsWith('.sciforge-download-'))).toBe(false)
    } finally {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

function createService(
  temporaryRoot: string,
  current: () => PrincipalSnapshot | undefined
): HostFileTransferService {
  return new HostFileTransferService({
    temporaryRoot,
    isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, current())
  })
}

function grantCaller(callerId: string, principal: PrincipalSnapshot): HostResourceGrantCaller {
  return Object.freeze({ callerId, principal })
}

function invocationFor(
  caller: HostResourceGrantCaller,
  context: Readonly<{
    audience?: 'ui' | 'agent' | 'system'
    workspaceId?: string
    effect?: HostResourceGrantInvocation['effect']
    approval?: HostResourceGrantInvocation['approval']
    approved?: boolean
  }> = {}
): HostResourceGrantInvocation {
  const { audience, workspaceId, ...invocation } = context
  return Object.freeze({
    caller: Object.freeze({
      ...caller,
      ...(audience ? { audience } : {}),
      ...(workspaceId ? { workspaceId } : {})
    }),
    ...invocation
  })
}

function invocationProviderFor(
  caller: HostResourceGrantCaller
): () => HostResourceGrantInvocation {
  const invocation = invocationFor(caller)
  return () => invocation
}

function workspaceTransferInvocation(
  caller: HostResourceGrantCaller,
  workspaceId: string,
  direction: 'upload-source' | 'download-destination',
  semanticRevision = '1'
): HostResourceGrantInvocation {
  return Object.freeze({
    caller: Object.freeze({
      ...caller,
      audience: 'agent' as const,
      workspaceId
    }),
    actionId: direction === 'upload-source'
      ? 'workspace-files.agent-upload-new'
      : 'workspace-files.agent-download',
    invocationId: `workspace-files-${direction}-${semanticRevision}`,
    effect: direction === 'upload-source' ? 'external-write' : 'workspace-write',
    approval: 'none',
    approved: true,
    scope: 'resource',
    ...(direction === 'upload-source'
      ? { autonomousWrite: 'resource-authorized' as const }
      : {}),
    authorizedResource: Object.freeze({
      resourceRef: 'res_workspace_entry',
      resourceKind: 'workspace-files.entry',
      workspaceId,
      semanticRevision
    })
  })
}

function systemWorkspaceTransferInvocation(
  caller: HostResourceGrantCaller,
  workspaceId: string,
  direction: 'upload-source' | 'download-destination'
): HostResourceGrantInvocation {
  return Object.freeze({
    caller: Object.freeze({
      ...caller,
      audience: 'system' as const,
      workspaceId,
      capabilityGrants: Object.freeze([systemWorkspaceTransferGrant]),
      principalSnapshotDigest: systemPrincipalSnapshotDigest,
      executionContextDigest: systemExecutionContextDigest
    }),
    actionId: direction === 'upload-source'
      ? 'fixture.system-upload'
      : 'fixture.system-download',
    invocationId: direction === 'upload-source'
      ? 'fixture-system-upload-1'
      : 'fixture-system-download-1',
    effect: direction === 'upload-source' ? 'external-write' : 'workspace-write',
    approval: 'none',
    approved: true,
    scope: 'workspace'
  })
}

function requireUploadHandle(
  selection: Awaited<ReturnType<HostFileTransferService['registerUpload']>>
): string {
  if (selection.cancelled) throw new Error('Expected an upload selection.')
  return selection.handle
}

function requireDownloadHandle(
  selection: Awaited<ReturnType<HostFileTransferService['registerDownload']>>
): string {
  if (selection.cancelled) throw new Error('Expected a download selection.')
  return selection.handle
}

type TestFileHandlePrototype = {
  close(this: TestFileHandlePrototype): Promise<void>
  read(
    this: TestFileHandlePrototype,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<Readonly<{ bytesRead: number; buffer: Uint8Array }>>
  write(
    this: TestFileHandlePrototype,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<Readonly<{ bytesWritten: number; buffer: Uint8Array }>>
  stat(
    this: TestFileHandlePrototype,
    options?: Readonly<{ bigint?: boolean }>
  ): Promise<unknown>
  sync(this: TestFileHandlePrototype): Promise<void>
}

async function fileHandlePrototype(root: string): Promise<TestFileHandlePrototype> {
  const probePath = join(root, `.file-handle-probe-${Date.now()}-${Math.random()}`)
  const probe = await open(probePath, 'wx', 0o600)
  const prototype = Object.getPrototypeOf(probe) as TestFileHandlePrototype
  await probe.close()
  await rm(probePath, { force: true })
  return prototype
}

function replaceCloseWithFailure(file: Awaited<ReturnType<typeof open>>, message: string): void {
  const originalClose = file.close.bind(file)
  Object.defineProperty(file, 'close', {
    configurable: true,
    value: async () => {
      await originalClose()
      throw new Error(message)
    }
  })
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void
  const promise = new Promise<void>((accepted) => {
    resolve = accepted
  })
  return Object.freeze({ promise, resolve })
}

async function expectBlockedCommitNotPublished(
  change: 'cancelled' | 'principal_changed' | 'invocation_replaced'
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-file-transfer-'))
  let currentPrincipal: PrincipalSnapshot | undefined = principalV1
  const service = createService(root, () => currentPrincipal)
  const caller = grantCaller('window:7', principalV1)
  let invocation = invocationFor(caller)
  const port = service.forOwner('domain.workspace-files', () => invocation)
  const controller = new AbortController()
  const entered = deferred()
  const release = deferred()
  const destinationPath = join(root, `${change}.bin`)
  let sync: Readonly<{ mockRestore: () => void }> | undefined
  try {
    const prototype = await fileHandlePrototype(root)
    const originalSync = prototype.sync
    sync = vi.spyOn(prototype, 'sync')
      .mockImplementationOnce(async function (this: TestFileHandlePrototype) {
        entered.resolve()
        await release.promise
        await originalSync.call(this)
      })
    const selection = await service.registerDownload({
      ownerId: 'domain.workspace-files', caller, path: destinationPath
    })
    const destination = await port.openDownloadDestination({
      handle: requireDownloadHandle(selection),
      maxBytes: 1024,
      signal: controller.signal
    })
    await destination.write(new TextEncoder().encode('must remain private'))
    const commit = destination.commit()
    await entered.promise
    if (change === 'cancelled') {
      controller.abort()
    } else if (change === 'principal_changed') {
      currentPrincipal = principalV2
    } else {
      invocation = invocationFor(caller)
    }
    release.resolve()

    await expect(commit).rejects.toMatchObject({
      code: change === 'invocation_replaced' ? 'grant_unavailable' : change
    })
    await destination.abort()
    await expect(readFile(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(root)).some((name) => name.startsWith('.sciforge-download-')))
      .toBe(false)
  } finally {
    release.resolve()
    sync?.mockRestore()
    await service.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
