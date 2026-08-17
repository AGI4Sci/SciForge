import { constants } from 'node:fs'
import {
  link,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
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

describe('Host-owned file transfers', () => {
  it('snapshots upload bytes and binds the opaque handle to owner, caller, and Principal', async () => {
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, 'captured bytes')
      const selection = await service.registerUpload({
        ownerId: 'domain.content-space',
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
      expect(Buffer.from(await source.read({ offset: 0, length: source.size })).toString())
        .toBe('captured bytes')
      await source.close()

      const otherOwnerSelection = await service.registerUpload({
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space',
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    let invocation: HostResourceGrantInvocation | undefined = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, 'bytes')
      const selection = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
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
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const invocation = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    try {
      const destinationPath = join(root, 'download.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: destinationPath
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
        ownerId: 'domain.content-space', caller, path: conflictPath
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

  it('serializes concurrent writes before commit publishes the destination', async () => {
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const destinationPath = join(root, 'ordered.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: destinationPath
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const prototype = await fileHandlePrototype(root)
    const write = vi.spyOn(prototype, 'write')
      .mockRejectedValueOnce(new Error(`private Host path: ${root}/partial`))
    try {
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'sanitized.bin')
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
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
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const sourcePath = join(root, 'close-source.bin')
    await writeFile(sourcePath, 'bytes')
    try {
      const upload = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 5
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
        ownerId: 'domain.content-space', caller, path: join(root, 'close-destination.bin')
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

  it('preserves a destination published while cancellation races the atomic link', async () => {
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
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
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const destinationPath = join(root, 'link-race.bin')
    try {
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: destinationPath
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    let currentPrincipal: PrincipalSnapshot | undefined = principalV1
    const service = createService(root, () => currentPrincipal)
    const caller = grantCaller('window:7', principalV1)
    const invocation = invocationFor(caller)
    const port = service.forOwner('domain.content-space', () => invocation)
    try {
      const destinationPath = join(root, 'download.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: destinationPath
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
        ownerId: 'domain.content-space', caller, path: changedPath
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
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
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const sourcePath = join(root, 'selected.bin')
    await writeFile(sourcePath, 'bounded bytes')
    try {
      await expect(service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
      expect(closeCalls).toBe(1)

      failure = 'close'
      const closeCallsBeforeFailure = closeCalls
      await expect(service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_unavailable' })
      expect(closeCalls).toBeGreaterThan(closeCallsBeforeFailure)

      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
      failure = undefined
      const valid = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const caller = grantCaller('window:7', principalV1)
    const sourcePath = join(root, 'selected.bin')
    const symlinkPath = join(root, 'selected-link.bin')
    await writeFile(sourcePath, 'bounded bytes')
    await symlink(sourcePath, symlinkPath)
    const ordinary = createService(root, () => principalV1)
    try {
      await expect(ordinary.registerUpload({
        ownerId: 'domain.content-space', caller, path: symlinkPath, maxBytes: 1024
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
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
      })).rejects.toMatchObject({ code: 'source_changed' })
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
    } finally {
      await changed.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for a pending registration during dispose and never issues afterward', async () => {
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
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
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
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
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
      })
      await entered.promise
      await service.revokeCaller(caller.callerId)
      release.resolve()
      await expect(pending).rejects.toMatchObject({ code: 'grant_unavailable' })
      stat.mockRestore()

      const later = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 1024
      })
      const source = await port.openUploadSource({
        handle: requireUploadHandle(later), maxBytes: 1024
      })
      await service.revokeCaller(caller.callerId)
      await expect(source.read({ offset: 0, length: 1 }))
        .rejects.toMatchObject({ code: 'already_settled' })

      const downloadPath = join(root, 'revoked-download.bin')
      const downloadSelection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: downloadPath
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
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
        ownerId: 'domain.content-space',
        caller,
        path: join(root, 'cancelled.bin'),
        signal: controller.signal
      })
      await entered.promise
      controller.abort()
      release.resolve()
      await expect(registration).rejects.toMatchObject({ code: 'cancelled' })

      await expect(service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'valid.bin')
      })).resolves.toMatchObject({ cancelled: false })
    } finally {
      release.resolve()
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retires an issued upload grant when picker cancellation wins before delivery', async () => {
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1,
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const controller = new AbortController()
    const firstPath = join(root, 'first-upload.bin')
    const secondPath = join(root, 'second-upload.bin')
    await writeFile(firstPath, '12345')
    await writeFile(secondPath, 'abcde')
    try {
      const registration = service.registerUpload({
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space', caller, path: secondPath, maxBytes: 5
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const controller = new AbortController()
    try {
      const registration = service.registerDownload({
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space', caller, path: join(root, 'replacement.bin')
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    const sourcePath = join(root, 'consumed-upload.bin')
    const destinationPath = join(root, 'consumed-download.bin')
    await writeFile(sourcePath, 'kept')
    try {
      const uploadController = new AbortController()
      const upload = await service.registerUpload({
        ownerId: 'domain.content-space',
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
        ownerId: 'domain.content-space',
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const sourcePath = join(root, 'selected.bin')
      await writeFile(sourcePath, '12345')
      const upload = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 5
      })
      const download = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'download.bin')
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = createService(root, () => principalV1)
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const sourcePath = join(root, 'too-large.bin')
      await writeFile(sourcePath, '12345')
      await expect(service.registerUpload({
        ownerId: 'domain.content-space', caller, path: sourcePath, maxBytes: 4
      })).rejects.toMatchObject({ code: 'bound_exceeded' })

      const destinationPath = join(root, 'bounded.bin')
      const selection = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: destinationPath
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    let now = new Date('2026-08-16T10:00:00.000Z')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      now: () => now,
      handleTtlMs: 1_000,
      maxTemporaryBytes: 5
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const fullPath = join(root, 'full.bin')
      const smallPath = join(root, 'small.bin')
      await writeFile(fullPath, '12345')
      await writeFile(smallPath, '1')
      const expired = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: fullPath, maxBytes: 5
      })
      await expect(service.registerUpload({
        ownerId: 'domain.content-space', caller, path: smallPath, maxBytes: 1
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })

      now = new Date('2026-08-16T10:00:02.000Z')
      await service.sweepExpired()
      expect((await readdir(root)).some((name) => name.startsWith('sciforge-upload-')))
        .toBe(false)
      const afterSweep = await service.registerUpload({
        ownerId: 'domain.content-space', caller, path: smallPath, maxBytes: 1
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    let now = new Date('2026-08-16T10:00:00.000Z')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      now: () => now,
      handleTtlMs: 1_000,
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const first = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'one.bin')
      })
      await expect(service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'two.bin')
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })
      now = new Date('2026-08-16T10:00:02.000Z')
      await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'two.bin')
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
    const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
    const service = new HostFileTransferService({
      temporaryRoot: root,
      isPrincipalCurrent: (principal) => samePrincipalSnapshot(principal, principalV1),
      maxGrants: 1
    })
    const caller = grantCaller('window:7', principalV1)
    const port = service.forOwner('domain.content-space', () => invocationFor(caller))
    try {
      const first = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'one.bin')
      })
      const active = await port.openDownloadDestination({
        handle: requireDownloadHandle(first), maxBytes: 1024
      })
      await expect(service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'two.bin')
      })).rejects.toMatchObject({ code: 'capacity_exceeded' })
      await active.abort()
      const afterAbort = await service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'two.bin')
      })
      const committed = await port.openDownloadDestination({
        handle: requireDownloadHandle(afterAbort), maxBytes: 1024
      })
      await committed.write(new TextEncoder().encode('complete'))
      await committed.commit()
      await expect(service.registerDownload({
        ownerId: 'domain.content-space', caller, path: join(root, 'three.bin')
      })).resolves.toMatchObject({ cancelled: false })
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

function invocationFor(caller: HostResourceGrantCaller): HostResourceGrantInvocation {
  return Object.freeze({ caller: Object.freeze({ ...caller }) })
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
  change: 'cancelled' | 'principal_changed'
): Promise<void> {
  const root = await mkdtemp('/private/tmp/sciforge-file-transfer-')
  let currentPrincipal: PrincipalSnapshot | undefined = principalV1
  const service = createService(root, () => currentPrincipal)
  const caller = grantCaller('window:7', principalV1)
  const port = service.forOwner('domain.content-space', () => invocationFor(caller))
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
      ownerId: 'domain.content-space', caller, path: destinationPath
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
    } else {
      currentPrincipal = principalV2
    }
    release.resolve()

    await expect(commit).rejects.toMatchObject({ code: change })
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
