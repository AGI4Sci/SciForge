import { createHash, randomBytes } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DOMAIN_FILE_TRANSFER_LIMITS,
  DomainFileTransferError,
  domainFileTransferHandleSchema,
  domainFileTransferLabelSchema,
  domainWorkspaceRelativePathSchema,
  type DomainFileTransferHandle,
  type DomainMainDownloadDestination,
  type DomainMainFileTransferHost,
  type DomainMainUploadSource,
  type DomainRendererDownloadSelection,
  type DomainRendererUploadSelection
} from '@sciforge/domain-sdk/file-transfer'
import {
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget
} from '@sciforge/domain-sdk/node/workspace-paths'
import {
  assertActiveHostResourceGrantInvocationLease,
  boundedHostResourceGrantOwnerId,
  defineHostResourceGrantCaller,
  requireActiveAgentWorkspaceResourceGrantCaller,
  requireActiveHostResourceGrantInvocationLease,
  type HostResourceGrantCaller,
  type HostResourceGrantInvocationLease,
  type HostResourceGrantInvocationProvider
} from './host-resource-grants'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { samePrincipalSnapshot } from '@sciforge/domain-sdk/principal'

const DEFAULT_HANDLE_TTL_MS = 5 * 60_000
const DEFAULT_MAX_GRANTS = 256
const DEFAULT_MAX_TEMPORARY_BYTES = 2 * DOMAIN_FILE_TRANSFER_LIMITS.maxBytes

type UploadGrant = Readonly<{
  ownerId: string
  caller: HostResourceGrantCaller
  kind: 'upload'
  stagedDirectory: string
  stagedDirectorySnapshot: UploadStagedDirectorySnapshot
  stagedPath: string
  label: string
  size: number
  sha256: string
  fingerprint: FileFingerprint
  expiresAt: number
}>

type DownloadGrant = Readonly<{
  ownerId: string
  caller: HostResourceGrantCaller
  kind: 'download'
  path: string
  parent: DownloadParentSnapshot
  label: string
  expiresAt: number
}>

type TransferGrant = UploadGrant | DownloadGrant

type GrantAbortBinding = Readonly<{
  signal: AbortSignal
  listener: () => void
}>

type FileFingerprint = Readonly<{
  device: bigint
  inode: bigint
  mode: bigint
  links: bigint
  size: bigint
  modifiedNanoseconds: bigint
  changedNanoseconds: bigint
}>

type FileIdentity = Readonly<{
  device: bigint
  inode: bigint
}>

type UploadStagedDirectorySnapshot = Readonly<{
  canonicalPath: string
  identity: FileIdentity
}>

type UploadStagedDirectoryReservation = Readonly<{
  size: number
  snapshot: UploadStagedDirectorySnapshot
}>

type DownloadParentSnapshot = Readonly<{
  canonicalPath: string
  identity: FileIdentity
  workspaceRoot?: string
}>

type DownloadTemporarySnapshot = Readonly<{
  path: string
  parent: DownloadParentSnapshot
  identity: FileIdentity
}>

type DownloadTemporaryReservation = Readonly<{
  size: number
  snapshot?: DownloadTemporarySnapshot
}>

type InvocationAssertion = () => void

export type HostFileTransferServiceOptions = Readonly<{
  /** The Host Principal Context must perform this live authorization check. */
  isPrincipalCurrent: (principal: PrincipalSnapshot) => boolean
  temporaryRoot?: string
  now?: () => Date
  handleTtlMs?: number
  maxGrants?: number
  /** Aggregate reservation across upload snapshots and active partial downloads. */
  maxTemporaryBytes?: number
  reportCleanupError?: (error: unknown) => void
  /** Host-private test/platform seam; it must atomically publish without overwrite. */
  publishCompletedDownload?: (temporaryPath: string, destinationPath: string) => Promise<void>
  /** Host-private test/platform seam; it must open a read-only no-follow descriptor. */
  openUploadFile?: (path: string) => Promise<FileHandle>
  /** Host-private test/platform seam; it must create a private exclusive-write descriptor. */
  openDownloadTemporaryFile?: (path: string) => Promise<FileHandle>
  /** Host-private test/platform seam; it must return the canonical existing parent. */
  resolveDownloadParent?: (path: string) => Promise<string>
}>

/**
 * Host-owned file grants. Paths and partial files remain in main; domain and
 * renderer callers receive only opaque, caller-and-Principal-bound handles.
 */
export class HostFileTransferService {
  readonly #grants = new Map<DomainFileTransferHandle, TransferGrant>()
  readonly #grantAbortBindings = new Map<DomainFileTransferHandle, GrantAbortBinding>()
  readonly #activeCleanup = new Map<() => Promise<void>, string>()
  readonly #pendingRegistrationOperations = new Set<Promise<unknown>>()
  readonly #callerRevocationEpochs = new Map<string, number>()
  readonly #stagedUploads = new Map<string, UploadStagedDirectoryReservation>()
  readonly #orphanedUploadStagedDirectories = new Set<string>()
  readonly #temporaryDownloads = new Map<string, DownloadTemporaryReservation>()
  readonly #orphanedDownloadTemporaryPaths = new Set<string>()
  readonly #cleanupOperations = new Map<string, Promise<void>>()
  readonly #isPrincipalCurrent: (principal: PrincipalSnapshot) => boolean
  readonly #temporaryRoot: string
  readonly #now: () => Date
  readonly #handleTtlMs: number
  readonly #maxGrants: number
  readonly #maxTemporaryBytes: number
  readonly #reportCleanupError: (error: unknown) => void
  readonly #publishCompletedDownload: (
    temporaryPath: string,
    destinationPath: string
  ) => Promise<void>
  readonly #openUploadFile: (path: string) => Promise<FileHandle>
  readonly #openDownloadTemporaryFile: (path: string) => Promise<FileHandle>
  readonly #resolveDownloadParent: (path: string) => Promise<string>
  #pendingRegistrations = 0
  #activeSessions = 0
  #reservedTemporaryBytes = 0
  #disposed = false
  #disposePromise: Promise<void> | undefined

  constructor(options: HostFileTransferServiceOptions) {
    if (typeof options.isPrincipalCurrent !== 'function') {
      throw new TypeError('Host file transfers require a live Principal verifier.')
    }
    this.#isPrincipalCurrent = options.isPrincipalCurrent
    this.#temporaryRoot = options.temporaryRoot ?? tmpdir()
    this.#now = options.now ?? (() => new Date())
    this.#handleTtlMs = boundedPositiveInteger(
      options.handleTtlMs ?? DEFAULT_HANDLE_TTL_MS,
      DEFAULT_HANDLE_TTL_MS,
      'The file transfer grant lifetime is invalid.'
    )
    this.#maxGrants = boundedPositiveInteger(
      options.maxGrants ?? DEFAULT_MAX_GRANTS,
      65_536,
      'The file transfer grant capacity is invalid.'
    )
    this.#maxTemporaryBytes = boundedPositiveInteger(
      options.maxTemporaryBytes ?? DEFAULT_MAX_TEMPORARY_BYTES,
      Number.MAX_SAFE_INTEGER,
      'The aggregate file transfer byte capacity is invalid.'
    )
    this.#reportCleanupError = options.reportCleanupError ?? (() => undefined)
    this.#publishCompletedDownload = options.publishCompletedDownload ?? link
    this.#openUploadFile = options.openUploadFile ?? openNoFollow
    this.#openDownloadTemporaryFile = options.openDownloadTemporaryFile ?? openPrivateDownload
    this.#resolveDownloadParent = options.resolveDownloadParent ?? realpath
    if (!isAbsolute(this.#temporaryRoot)) {
      throw new TypeError('The file transfer temporary root must be absolute.')
    }
  }

  /**
   * Mints one package-scoped facade. Caller and Principal are always derived
   * from the active Broker invocation and never accepted from package input.
   */
  forOwner(
    ownerId: string,
    currentInvocation: HostResourceGrantInvocationProvider
  ): DomainMainFileTransferHost {
    const owner = boundedHostResourceGrantOwnerId(ownerId)
    const activeLease = () => {
      try {
        return requireActiveHostResourceGrantInvocationLease(currentInvocation)
      } catch {
        throw new DomainFileTransferError(
          'principal_changed',
          'An active capability invocation with a current Principal is required.'
        )
      }
    }
    return Object.freeze({
      openUploadSource: async (input) => {
        const lease = activeLease()
        return this.#openUploadSourceForCaller({
          ...input,
          ownerId: owner,
          caller: lease,
          assertInvocationCurrent: invocationAssertion(currentInvocation, lease)
        })
      },
      openDownloadDestination: async (input) => {
        const lease = activeLease()
        return this.#openDownloadDestinationForCaller({
          ...input,
          ownerId: owner,
          caller: lease,
          assertInvocationCurrent: invocationAssertion(currentInvocation, lease)
        })
      },
      openWorkspaceUploadSource: async (input) => {
        const context = activeAgentWorkspaceContext(currentInvocation, 'upload-source')
        const assertInvocationCurrent = invocationAssertion(currentInvocation, context)
        const relativePath = parseWorkspaceRelativePath(input.relativePath)
        let sourcePath: string
        try {
          assertInvocationCurrent()
          sourcePath = await resolveOpenTargetPath(relativePath, context.workspaceId, {
            allowBasenameFallback: false
          })
          assertInvocationCurrent()
        } catch (error) {
          if (error instanceof DomainFileTransferError) throw error
          throw new DomainFileTransferError(
            'source_unavailable',
            'The Agent upload source is unavailable inside the active Workspace.',
            { cause: error }
          )
        }
        const selection = await this.#trackRegistration(this.#registerUpload({
          ownerId: owner,
          caller: context,
          path: sourcePath,
          maxBytes: input.maxBytes,
          signal: input.signal,
          assertInvocationCurrent
        }))
        if (selection.cancelled) {
          throw new DomainFileTransferError('cancelled', 'The Agent upload was cancelled.')
        }
        return this.#openUploadSourceForCaller({
          ownerId: owner,
          caller: context,
          handle: selection.handle,
          maxBytes: input.maxBytes,
          signal: input.signal,
          assertInvocationCurrent
        })
      },
      openWorkspaceDownloadDestination: async (input) => {
        const context = activeAgentWorkspaceContext(currentInvocation, 'download-destination')
        const assertInvocationCurrent = invocationAssertion(currentInvocation, context)
        const relativePath = parseWorkspaceRelativePath(input.relativePath)
        let destinationTarget: Awaited<ReturnType<typeof resolveSafeWorkspaceWriteTarget>>
        try {
          assertInvocationCurrent()
          destinationTarget = await resolveSafeWorkspaceWriteTarget(
            relativePath,
            context.workspaceId,
            { createParentDirectories: false, targetKind: 'file' }
          )
          assertInvocationCurrent()
        } catch (error) {
          if (error instanceof DomainFileTransferError) throw error
          throw new DomainFileTransferError(
            'destination_unavailable',
            'The Agent download destination is unavailable inside the active Workspace.',
            { cause: error }
          )
        }
        const selection = await this.#trackRegistration(this.#registerDownload({
          ownerId: owner,
          caller: context,
          path: destinationTarget.path,
          signal: input.signal,
          assertInvocationCurrent,
          workspaceBoundary: Object.freeze({
            parentPath: destinationTarget.parentPath,
            workspaceRoot: destinationTarget.workspaceRoot
          })
        }))
        if (selection.cancelled) {
          throw new DomainFileTransferError('cancelled', 'The Agent download was cancelled.')
        }
        return this.#openDownloadDestinationForCaller({
          ownerId: owner,
          caller: context,
          handle: selection.handle,
          maxBytes: input.maxBytes,
          signal: input.signal,
          assertInvocationCurrent
        })
      }
    })
  }

  registerUpload(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    path: string
    maxBytes: number
    signal?: AbortSignal
  }>): Promise<DomainRendererUploadSelection> {
    this.#assertAvailable()
    return this.#trackRegistration(this.#registerUpload(input))
  }

  async #registerUpload(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    path: string
    maxBytes: number
    signal?: AbortSignal
    assertInvocationCurrent?: InvocationAssertion
  }>): Promise<DomainRendererUploadSelection> {
    const ownerId = boundedHostResourceGrantOwnerId(input.ownerId)
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    this.#assertCurrent(caller)
    const sourcePath = boundedAbsolutePath(input.path)
    const maxBytes = boundedMaxBytes(input.maxBytes)
    this.#reserveGrantSlot()
    const assertAuthorized = () => {
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      input.assertInvocationCurrent?.()
    }

    let stagedDirectory: string | undefined
    let stagedDirectorySnapshot: UploadStagedDirectorySnapshot | undefined
    let untrackedStagedDirectory: string | undefined
    let untrackedByteReservation = 0
    try {
      assertAuthorized()
      const source = await this.#openUploadFile(sourcePath)
      let snapshot: Readonly<{
        stagedPath: string
        label: string
        size: number
        sha256: string
        fingerprint: FileFingerprint
      }> | undefined
      let sourceCaptureError: unknown
      try {
        assertAuthorized()
        const before = await readRegularFileFingerprint(source, maxBytes)
        assertAuthorized()
        const size = Number(before.size)
        this.#reserveTemporaryBytes(size)
        untrackedByteReservation = size
        untrackedStagedDirectory = await mkdtemp(
          join(this.#temporaryRoot, 'sciforge-upload-')
        )
        assertAuthorized()
        stagedDirectorySnapshot = await captureUploadStagedDirectorySnapshot(
          untrackedStagedDirectory
        )
        stagedDirectory = stagedDirectorySnapshot.canonicalPath
        this.#stagedUploads.set(stagedDirectory, Object.freeze({
          size,
          snapshot: stagedDirectorySnapshot
        }))
        untrackedStagedDirectory = undefined
        untrackedByteReservation = 0
        await chmod(stagedDirectory, 0o700)
        assertAuthorized()
        await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
        const stagedPath = join(stagedDirectory, 'source.bin')
        const stagedWriter = await open(
          stagedPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600
        )
        let copiedDigest: string
        let stagedWriterError: unknown
        try {
          assertAuthorized()
          await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
          copiedDigest = await copyFileHandle(
            source,
            stagedWriter,
            size,
            assertAuthorized
          )
          await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
          assertAuthorized()
        } catch (error) {
          stagedWriterError = error
          throw error
        } finally {
          await closeFilePreservingPrimaryError(
            stagedWriter,
            stagedWriterError,
            this.#reportCleanupError
          )
        }
        assertAuthorized()
        await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
        const stagedReader = await openNoFollow(stagedPath)
        let stagedFingerprint: FileFingerprint
        let stagedDigest: string
        let stagedReaderError: unknown
        try {
          assertAuthorized()
          await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
          const stagedBefore = await readRegularFileFingerprint(stagedReader, maxBytes)
          assertAuthorized()
          stagedDigest = await digestFileHandle(stagedReader, size, assertAuthorized)
          const stagedAfter = await readRegularFileFingerprint(stagedReader, maxBytes)
          assertAuthorized()
          await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
          if (
            copiedDigest !== stagedDigest ||
            !sameFileFingerprint(stagedBefore, stagedAfter)
          ) {
            throw new DomainFileTransferError(
              'source_changed',
              'The Host-owned upload snapshot changed while it was verified.'
            )
          }
          stagedFingerprint = stagedAfter
        } catch (error) {
          stagedReaderError = error
          throw error
        } finally {
          await closeFilePreservingPrimaryError(
            stagedReader,
            stagedReaderError,
            this.#reportCleanupError
          )
        }
        assertAuthorized()
        await assertUploadStagedDirectoryCurrent(stagedDirectorySnapshot)
        const after = fileFingerprint(await source.stat({ bigint: true }))
        assertAuthorized()
        if (
          Number(after.size) !== size ||
          !sameFileFingerprint(before, after) ||
          stagedFingerprint.size !== before.size
        ) {
          throw new DomainFileTransferError(
            'source_changed',
            'The selected upload source changed while the Host captured it.'
          )
        }
        snapshot = Object.freeze({
          stagedPath,
          label: boundedLabel(basename(sourcePath)),
          size,
          sha256: stagedDigest,
          fingerprint: stagedFingerprint
        })
      } catch (error) {
        sourceCaptureError = error
        throw error
      } finally {
        await closeFilePreservingPrimaryError(
          source,
          sourceCaptureError,
          this.#reportCleanupError
        )
      }
      if (!snapshot || !stagedDirectory || !stagedDirectorySnapshot) {
        throw new DomainFileTransferError(
          'source_unavailable',
          'The Host did not capture an upload snapshot.'
        )
      }
      // Never issue before every source descriptor operation has completed.
      // dispose() flips availability and waits this tracked registration.
      this.#assertAvailable()
      assertAuthorized()
      const handle = this.#issue(Object.freeze({
        ownerId,
        caller,
        kind: 'upload' as const,
        stagedDirectory,
        stagedDirectorySnapshot,
        stagedPath: snapshot.stagedPath,
        label: snapshot.label,
        size: snapshot.size,
        sha256: snapshot.sha256,
        fingerprint: snapshot.fingerprint,
        expiresAt: this.#now().getTime() + this.#handleTtlMs
      }), input.signal)
      stagedDirectory = undefined
      return Object.freeze({
        cancelled: false as const,
        handle,
        name: snapshot.label,
        size: snapshot.size
      })
    } catch (error) {
      if (error instanceof DomainFileTransferError) throw error
      if (isAbortError(error) || input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The upload selection was cancelled.')
      }
      throw new DomainFileTransferError(
        'source_unavailable',
        'The Host could not capture a bounded regular upload source.'
      )
    } finally {
      this.#pendingRegistrations -= 1
      if (stagedDirectory) await this.#removeStagedDirectory(stagedDirectory)
      if (untrackedStagedDirectory) {
        await rm(untrackedStagedDirectory, { recursive: true, force: true })
      }
      if (untrackedByteReservation > 0) {
        this.#releaseTemporaryBytes(untrackedByteReservation)
      }
    }
  }

  registerDownload(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    path: string
    signal?: AbortSignal
  }>): Promise<DomainRendererDownloadSelection> {
    this.#assertAvailable()
    return this.#trackRegistration(this.#registerDownload(input))
  }

  async #registerDownload(input: Readonly<{
    ownerId: string
    caller: HostResourceGrantCaller
    path: string
    signal?: AbortSignal
    assertInvocationCurrent?: InvocationAssertion
    workspaceBoundary?: Readonly<{
      parentPath: string
      workspaceRoot: string
    }>
  }>): Promise<DomainRendererDownloadSelection> {
    const ownerId = boundedHostResourceGrantOwnerId(input.ownerId)
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    this.#assertCurrent(caller)
    const selectedPath = boundedAbsolutePath(input.path)
    this.#reserveGrantSlot()
    const assertAuthorized = () => {
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      input.assertInvocationCurrent?.()
    }
    try {
      assertAuthorized()
      const parentInput = input.workspaceBoundary?.parentPath ?? dirname(selectedPath)
      const resolvedParent = await this.#resolveDownloadParent(parentInput)
      assertAuthorized()
      const parent = await captureDownloadParentSnapshot(
        resolvedParent,
        input.workspaceBoundary?.parentPath,
        input.workspaceBoundary?.workspaceRoot
      )
      assertAuthorized()
      const destinationPath = join(parent.canonicalPath, basename(selectedPath))
      const label = boundedLabel(basename(destinationPath))
      await assertDestinationAbsent(destinationPath)
      assertAuthorized()
      await assertDownloadParentCurrent(parent)
      this.#assertAvailable()
      assertAuthorized()
      const handle = this.#issue(Object.freeze({
        ownerId,
        caller,
        kind: 'download' as const,
        path: destinationPath,
        parent,
        label,
        expiresAt: this.#now().getTime() + this.#handleTtlMs
      }), input.signal)
      return Object.freeze({ cancelled: false as const, handle, label })
    } catch (error) {
      if (error instanceof DomainFileTransferError) throw error
      if (isAbortError(error) || input.signal?.aborted) {
        throw new DomainFileTransferError(
          'cancelled',
          'The download destination selection was cancelled.'
        )
      }
      throw new DomainFileTransferError(
        'destination_unavailable',
        'The Host-selected download destination is unavailable.'
      )
    } finally {
      this.#pendingRegistrations -= 1
    }
  }

  async #openUploadSourceForCaller(input: Readonly<{
    ownerId: string
    handle: DomainFileTransferHandle
    caller: HostResourceGrantCaller
    maxBytes: number
    signal?: AbortSignal
    assertInvocationCurrent: InvocationAssertion
  }>): Promise<DomainMainUploadSource> {
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    const maxBytes = boundedMaxBytes(input.maxBytes)
    const assertAuthorized = () => {
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The upload was cancelled.')
      }
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      input.assertInvocationCurrent()
    }
    const grant = await this.#take(input.handle, input.ownerId, caller, 'upload')
    let sessionReleased = false
    const releaseSession = () => {
      if (sessionReleased) return
      sessionReleased = true
      this.#activeSessions -= 1
    }
    if (grant.size > maxBytes) {
      await this.#removeStagedDirectory(grant.stagedDirectory)
      releaseSession()
      throw new DomainFileTransferError(
        'bound_exceeded',
        'The upload source exceeds the operation bound.'
      )
    }
    try {
      assertAuthorized()
    } catch (error) {
      await this.#removeStagedDirectory(grant.stagedDirectory)
      releaseSession()
      throw error
    }

    let file: FileHandle | undefined
    try {
      assertAuthorized()
      await assertUploadStagedDirectoryCurrent(grant.stagedDirectorySnapshot)
      assertAuthorized()
      file = await this.#openUploadFile(grant.stagedPath)
      assertAuthorized()
      await assertUploadStagedDirectoryCurrent(grant.stagedDirectorySnapshot)
      assertAuthorized()
      await assertRegularFileFingerprint(file, grant.fingerprint)
      assertAuthorized()
    } catch (error) {
      if (file) {
        try {
          await file.close()
        } catch (closeError) {
          this.#reportCleanupError(closeError)
        }
      }
      await this.#removeStagedDirectory(grant.stagedDirectory)
      releaseSession()
      if (error instanceof DomainFileTransferError) throw error
      throw new DomainFileTransferError(
        'source_unavailable',
        'The Host-owned upload snapshot is unavailable.'
      )
    }
    if (!file) {
      await this.#removeStagedDirectory(grant.stagedDirectory)
      releaseSession()
      throw new DomainFileTransferError(
        'source_unavailable',
        'The Host-owned upload snapshot is unavailable.'
      )
    }
    const openedFile = file

    let closed = false
    let cancelled = false
    let abortListener: (() => void) | undefined
    let cleanupPromise: Promise<void> | undefined
    const cleanup = (): Promise<void> => {
      if (cleanupPromise) return cleanupPromise
      closed = true
      if (abortListener) input.signal?.removeEventListener('abort', abortListener)
      cleanupPromise = (async () => {
        let closeError: unknown
        try {
          await openedFile.close()
        } catch (error) {
          closeError = error
        }
        try {
          await this.#removeStagedDirectory(grant.stagedDirectory)
        } finally {
          releaseSession()
          this.#activeCleanup.delete(cleanup)
        }
        if (closeError) {
          this.#reportCleanupError(closeError)
          throw new DomainFileTransferError(
            'source_unavailable',
            'The Host-owned upload snapshot could not be closed.'
          )
        }
      })()
      return cleanupPromise
    }
    this.#activeCleanup.set(cleanup, caller.callerId)
    if (input.signal) {
      abortListener = () => {
        cancelled = true
        void cleanup().catch(this.#reportCleanupError)
      }
      input.signal.addEventListener('abort', abortListener, { once: true })
      if (input.signal.aborted) abortListener()
    }

    return Object.freeze({
      name: grant.label,
      size: grant.size,
      sha256: grant.sha256,
      read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) => {
        if (cancelled) {
          throw new DomainFileTransferError('cancelled', 'The upload read was cancelled.')
        }
        if (closed) {
          throw new DomainFileTransferError('already_settled', 'The upload source is closed.')
        }
        if (
          !Number.isSafeInteger(offset) || offset < 0 ||
          !Number.isSafeInteger(length) || length < 1 ||
          length > DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes ||
          offset + length > grant.size
        ) {
          throw new DomainFileTransferError('invalid_request', 'The upload read range is invalid.')
        }
        const bytes = new Uint8Array(length)
        let bytesRead: number
        try {
          assertAuthorized()
          await assertUploadStagedDirectoryCurrent(grant.stagedDirectorySnapshot)
          assertAuthorized()
          await assertRegularFileFingerprint(openedFile, grant.fingerprint)
          assertAuthorized()
          bytesRead = (await openedFile.read(bytes, 0, length, offset)).bytesRead
          assertAuthorized()
          await assertRegularFileFingerprint(openedFile, grant.fingerprint)
          assertAuthorized()
          await assertUploadStagedDirectoryCurrent(grant.stagedDirectorySnapshot)
          assertAuthorized()
          if (bytesRead !== length) {
            throw new DomainFileTransferError(
              'source_changed',
              'The Host-owned upload snapshot changed during the operation.'
            )
          }
        } catch (error) {
          let failure: DomainFileTransferError
          if (cancelled || input.signal?.aborted) {
            failure = new DomainFileTransferError(
              'cancelled',
              'The upload read was cancelled.'
            )
          } else if (closed) {
            failure = new DomainFileTransferError(
              'already_settled',
              'The upload source is closed.'
            )
          } else if (error instanceof DomainFileTransferError) {
            failure = error
          } else {
            failure = new DomainFileTransferError(
              'source_unavailable',
              'The Host-owned upload snapshot could not be read.'
            )
          }
          await cleanup().catch(this.#reportCleanupError)
          throw failure
        }
        return bytes
      },
      close: cleanup
    })
  }

  async #openDownloadDestinationForCaller(input: Readonly<{
    ownerId: string
    handle: DomainFileTransferHandle
    caller: HostResourceGrantCaller
    maxBytes: number
    signal?: AbortSignal
    assertInvocationCurrent: InvocationAssertion
  }>): Promise<DomainMainDownloadDestination> {
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    const maxBytes = boundedMaxBytes(input.maxBytes)
    const assertLeaseAuthorized = () => {
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
      }
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      input.assertInvocationCurrent()
    }
    this.#reserveTemporaryBytes(maxBytes)
    let temporaryBytesReserved = true
    const releaseTemporaryReservation = () => {
      if (!temporaryBytesReserved) return
      temporaryBytesReserved = false
      this.#releaseTemporaryBytes(maxBytes)
    }
    let grant: DownloadGrant
    try {
      grant = await this.#take(input.handle, input.ownerId, caller, 'download')
      assertLeaseAuthorized()
    } catch (error) {
      releaseTemporaryReservation()
      throw error
    }
    let sessionReleased = false
    const releaseSession = () => {
      if (sessionReleased) return
      sessionReleased = true
      this.#activeSessions -= 1
    }
    try {
      assertLeaseAuthorized()
      await assertDownloadParentCurrent(grant.parent)
      assertLeaseAuthorized()
    } catch (error) {
      releaseSession()
      releaseTemporaryReservation()
      throw error
    }

    let temporaryPath: string
    try {
      temporaryPath = await createUniqueDestinationTemporaryPath(grant.path, grant.parent)
      assertLeaseAuthorized()
    } catch (error) {
      releaseSession()
      releaseTemporaryReservation()
      throw error
    }
    let file: FileHandle | undefined
    let temporarySnapshot: DownloadTemporarySnapshot | undefined
    try {
      await assertDownloadParentCurrent(grant.parent)
      assertLeaseAuthorized()
      file = await this.#openDownloadTemporaryFile(temporaryPath)
      this.#temporaryDownloads.set(temporaryPath, Object.freeze({ size: maxBytes }))
      temporaryBytesReserved = false
      const identity = await readRegularFileIdentity(file)
      temporarySnapshot = Object.freeze({
        path: temporaryPath,
        parent: grant.parent,
        identity
      })
      this.#temporaryDownloads.set(temporaryPath, Object.freeze({
        size: maxBytes,
        snapshot: temporarySnapshot
      }))
      assertLeaseAuthorized()
      await assertDownloadTemporaryCurrent(temporarySnapshot)
      assertLeaseAuthorized()
    } catch (error) {
      if (typeof file !== 'undefined') {
        await file.close().catch(this.#reportCleanupError)
      }
      if (this.#temporaryDownloads.has(temporaryPath)) {
        await this.#removeDownloadTemporaryFile(temporaryPath)
      }
      releaseSession()
      releaseTemporaryReservation()
      if (error instanceof DomainFileTransferError) throw error
      throw new DomainFileTransferError(
        'destination_unavailable',
        'The Host could not create a private partial download.'
      )
    }
    if (!file || !temporarySnapshot) {
      releaseSession()
      releaseTemporaryReservation()
      throw new DomainFileTransferError(
        'destination_unavailable',
        'The Host did not create a private partial download.'
      )
    }
    const openedFile = file
    const openedTemporarySnapshot = temporarySnapshot
    try {
      assertLeaseAuthorized()
    } catch (error) {
      let closeError: unknown
      try {
        await openedFile.close()
      } catch (caught) {
        closeError = caught
      }
      try {
        await this.#removeDownloadTemporaryFile(temporaryPath)
      } finally {
        releaseSession()
        releaseTemporaryReservation()
      }
      if (closeError) this.#reportCleanupError(closeError)
      throw error
    }

    let bytesWritten = 0
    let state: 'open' | 'committing' | 'committed' | 'aborted' | 'cancelled' = 'open'
    let abortRequest: 'aborted' | 'cancelled' | undefined
    let fileClosed = false
    let abortListener: (() => void) | undefined
    let cleanupPromise: Promise<void> | undefined
    let operationTail = Promise.resolve()
    let shutdown: () => Promise<void>
    const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
      const result = operationTail.then(operation)
      operationTail = result.then(() => undefined, () => undefined)
      return result
    }
    const closeFile = async () => {
      if (fileClosed) return
      fileClosed = true
      await openedFile.close()
    }
    const removePartial = () => this.#removeDownloadTemporaryFile(temporaryPath)
    const cleanup = (): Promise<void> => {
      cleanupPromise ??= (async () => {
        if (abortListener) input.signal?.removeEventListener('abort', abortListener)
        let closeError: unknown
        try {
          await closeFile()
        } catch (error) {
          closeError = error
          this.#reportCleanupError(error)
        } finally {
          try {
            await removePartial()
          } finally {
            releaseSession()
            releaseTemporaryReservation()
            this.#activeCleanup.delete(shutdown)
          }
        }
        if (closeError) {
          throw new DomainFileTransferError(
            'destination_unavailable',
            'The Host could not close the private partial download.'
          )
        }
      })()
      return cleanupPromise
    }
    const assertAuthorized = () => {
      if (abortRequest === 'cancelled' || input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
      }
      if (abortRequest === 'aborted') {
        throw new DomainFileTransferError('cancelled', 'The download was aborted.')
      }
      assertLeaseAuthorized()
    }
    const settleFailedOperation = async (error: unknown): Promise<never> => {
      state = abortRequest === 'cancelled' || input.signal?.aborted
        ? 'cancelled'
        : 'aborted'
      await cleanup().catch(() => undefined)
      throw error
    }
    const requestSettlement = (kind: 'aborted' | 'cancelled'): Promise<void> => {
      if (state === 'committed' || state === 'aborted' || state === 'cancelled') {
        return cleanupPromise ?? (state === 'committed' ? operationTail : Promise.resolve())
      }
      if (kind === 'cancelled' || abortRequest === undefined) abortRequest = kind
      return enqueue(async () => {
        if (state === 'committed') return
        state = abortRequest === 'cancelled' ? 'cancelled' : 'aborted'
        await cleanup()
      })
    }
    shutdown = () => requestSettlement('aborted')
    this.#activeCleanup.set(shutdown, caller.callerId)
    if (input.signal) {
      abortListener = () => {
        void requestSettlement('cancelled').catch(this.#reportCleanupError)
      }
      input.signal.addEventListener('abort', abortListener, { once: true })
      if (input.signal.aborted) abortListener()
    }

    return Object.freeze({
      label: grant.label,
      write: (chunk: Uint8Array) => {
        if (
          !(chunk instanceof Uint8Array) || chunk.byteLength < 1 ||
          chunk.byteLength > DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes
        ) {
          return Promise.reject(new DomainFileTransferError(
            'bound_exceeded',
            'The download chunk exceeds the destination bound.'
          ))
        }
        // Prevent a package from mutating queued bytes after validation.
        const bytes = new Uint8Array(chunk)
        return enqueue(async () => {
          if (state === 'cancelled') {
            throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
          }
          if (state !== 'open') {
            throw new DomainFileTransferError(
              'already_settled',
              'The download is already settling or settled.'
            )
          }
          try {
            assertAuthorized()
            await assertDownloadTemporaryCurrent(openedTemporarySnapshot)
            assertAuthorized()
            if (bytesWritten + bytes.byteLength > maxBytes) {
              throw new DomainFileTransferError(
                'bound_exceeded',
                'The download chunk exceeds the destination bound.'
              )
            }
            let offset = 0
            while (offset < bytes.byteLength) {
              assertAuthorized()
              const result = await openedFile.write(
                bytes,
                offset,
                bytes.byteLength - offset,
                bytesWritten + offset
              )
              assertAuthorized()
              if (result.bytesWritten < 1) {
                throw new DomainFileTransferError(
                  'destination_unavailable',
                  'The Host could not finish writing the private partial download.'
                )
              }
              offset += result.bytesWritten
            }
            await assertDownloadTemporaryCurrent(openedTemporarySnapshot)
            assertAuthorized()
            bytesWritten += bytes.byteLength
          } catch (error) {
            return settleFailedOperation(
              error instanceof DomainFileTransferError
                ? error
                : new DomainFileTransferError(
                  'destination_unavailable',
                  'The Host could not write the private partial download.'
                )
            )
          }
        })
      },
      commit: () => enqueue(async () => {
        if (state === 'cancelled') {
          throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
        }
        if (state !== 'open') {
          throw new DomainFileTransferError(
            'already_settled',
            'The download is already settling or settled.'
          )
        }
        state = 'committing'
        try {
          assertAuthorized()
          await assertDownloadTemporaryCurrent(openedTemporarySnapshot)
          assertAuthorized()
          await openedFile.sync()
          // Cancellation or Principal changes during a blocked fsync prevent
          // publication. Closing the temporary file is not publication.
          assertAuthorized()
          await assertDownloadTemporaryCurrent(openedTemporarySnapshot)
          assertAuthorized()
          await closeFile()
          assertAuthorized()
          await assertDownloadTemporaryCurrent(openedTemporarySnapshot)
          // This is the final synchronous authorization point immediately
          // before starting the atomic no-overwrite link operation.
          assertAuthorized()
          await this.#publishCompletedDownload(temporaryPath, grant.path)
          // The OS operation may have published before an asynchronous
          // cancellation or Principal change became observable. Preserve the
          // published file, but fail closed so the domain reports an unknown
          // operation outcome rather than claiming success or retrying.
          assertAuthorized()
          await assertPublishedDownloadCurrent(openedTemporarySnapshot, grant.path)
          assertAuthorized()
          state = 'committed'
          if (abortListener) input.signal?.removeEventListener('abort', abortListener)
          await removePartial()
          releaseSession()
          releaseTemporaryReservation()
          this.#activeCleanup.delete(shutdown)
        } catch (error) {
          state = abortRequest === 'cancelled' || input.signal?.aborted
            ? 'cancelled'
            : 'aborted'
          await cleanup().catch(() => undefined)
          if (isNodeError(error, 'EEXIST')) {
            throw new DomainFileTransferError(
              'destination_conflict',
              'The Host-selected destination already exists; it was not overwritten.'
            )
          }
          if (error instanceof DomainFileTransferError) throw error
          throw new DomainFileTransferError(
            'destination_unavailable',
            'The Host could not atomically publish the completed download.'
          )
        }
      }),
      abort: () => requestSettlement('aborted')
    })
  }

  async revokeCaller(callerId: string): Promise<void> {
    const normalized = callerId.trim()
    if (!normalized) return
    this.#callerRevocationEpochs.set(
      normalized,
      this.#callerRevocationEpoch(normalized) + 1
    )
    const cleanups: Promise<void>[] = []
    for (const [handle, grant] of this.#grants) {
      if (grant.caller.callerId !== normalized) continue
      this.#grants.delete(handle)
      this.#detachGrantAbort(handle)
      if (grant.kind === 'upload') {
        cleanups.push(this.#removeStagedDirectory(grant.stagedDirectory))
      }
    }
    for (const [cleanup, activeCallerId] of this.#activeCleanup) {
      if (activeCallerId === normalized) cleanups.push(cleanup())
    }
    const results = await Promise.allSettled(cleanups)
    for (const result of results) {
      if (result.status === 'rejected') this.#reportCleanupError(result.reason)
    }
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#performDispose()
    return this.#disposePromise
  }

  async #performDispose(): Promise<void> {
    this.#disposed = true
    await Promise.allSettled([...this.#pendingRegistrationOperations])
    const cleanups: Promise<void>[] = []
    for (const [handle, grant] of this.#grants) {
      this.#detachGrantAbort(handle)
      if (grant.kind === 'upload') {
        cleanups.push(this.#removeStagedDirectory(grant.stagedDirectory))
      }
    }
    this.#grants.clear()
    for (const handle of this.#grantAbortBindings.keys()) this.#detachGrantAbort(handle)
    cleanups.push(...[...this.#activeCleanup.keys()].map((cleanup) => cleanup()))
    const results = await Promise.allSettled(cleanups)
    for (const result of results) {
      if (result.status === 'rejected') this.#reportCleanupError(result.reason)
    }
    await this.#drainCleanupOperations()
    if (this.#stagedUploads.size > 0) {
      await Promise.all(
        [...this.#stagedUploads.keys()].map((path) => this.#removeStagedDirectory(path))
      )
      await this.#drainCleanupOperations()
    }
    if (this.#temporaryDownloads.size > 0) {
      await Promise.all(
        [...this.#temporaryDownloads.keys()].map((path) =>
          this.#removeDownloadTemporaryFile(path)
        )
      )
      await this.#drainCleanupOperations()
    }
  }

  /** Host maintenance hook for eagerly removing expired staged snapshots. */
  async sweepExpired(): Promise<void> {
    this.#assertAvailable()
    this.#sweep()
    await Promise.all(
      [
        ...[...this.#orphanedUploadStagedDirectories].map((path) =>
          this.#removeStagedDirectory(path)
        ),
        ...[...this.#orphanedDownloadTemporaryPaths].map((path) =>
          this.#removeDownloadTemporaryFile(path)
        )
      ]
    )
    await this.#drainCleanupOperations()
  }

  #assertAvailable(): void {
    if (this.#disposed) {
      throw new DomainFileTransferError('grant_unavailable', 'File transfers are unavailable.')
    }
  }

  #assertCurrent(caller: HostResourceGrantCaller): void {
    let current = false
    try {
      current = this.#isPrincipalCurrent(caller.principal)
    } catch {
      throw new DomainFileTransferError(
        'principal_changed',
        'The current Principal could not be reauthorized.'
      )
    }
    if (!current) {
      throw new DomainFileTransferError(
        'principal_changed',
        'The current Principal no longer matches the file transfer grant.'
      )
    }
  }

  #callerRevocationEpoch(callerId: string): number {
    return this.#callerRevocationEpochs.get(callerId) ?? 0
  }

  #assertCallerEpoch(callerId: string, expected: number): void {
    if (this.#callerRevocationEpoch(callerId) !== expected) {
      throw new DomainFileTransferError(
        'grant_unavailable',
        'The Host file-transfer caller lease was revoked.'
      )
    }
  }

  #reserveGrantSlot(): void {
    this.#sweep()
    if (
      this.#grants.size + this.#pendingRegistrations + this.#activeSessions >=
      this.#maxGrants
    ) {
      throw new DomainFileTransferError(
        'capacity_exceeded',
        'The bounded Host file transfer grant table is full.'
      )
    }
    this.#pendingRegistrations += 1
  }

  #trackRegistration<Result>(operation: Promise<Result>): Promise<Result> {
    this.#pendingRegistrationOperations.add(operation)
    void operation.finally(() => {
      this.#pendingRegistrationOperations.delete(operation)
    }).catch(() => undefined)
    return operation
  }

  #reserveTemporaryBytes(bytes: number): void {
    if (this.#reservedTemporaryBytes + bytes > this.#maxTemporaryBytes) {
      throw new DomainFileTransferError(
        'capacity_exceeded',
        'The bounded Host temporary file byte budget is full.'
      )
    }
    this.#reservedTemporaryBytes += bytes
  }

  #releaseTemporaryBytes(bytes: number): void {
    this.#reservedTemporaryBytes = Math.max(0, this.#reservedTemporaryBytes - bytes)
  }

  #issue(grant: TransferGrant, signal?: AbortSignal): DomainFileTransferHandle {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const handle = domainFileTransferHandleSchema.parse(
        `xfer_${randomBytes(24).toString('base64url')}`
      )
      if (!this.#grants.has(handle)) {
        this.#grants.set(handle, grant)
        if (signal) {
          const listener = () => this.#cancelOutstandingGrant(handle, grant)
          this.#grantAbortBindings.set(handle, Object.freeze({ signal, listener }))
          signal.addEventListener('abort', listener, { once: true })
          // AbortSignal does not replay an already-fired event to a newly
          // attached listener. Close the issue/listen race explicitly.
          if (signal.aborted) listener()
        }
        return handle
      }
    }
    throw new DomainFileTransferError(
      'capacity_exceeded',
      'The Host could not allocate a unique file transfer handle.'
    )
  }

  async #take<Kind extends TransferGrant['kind']>(
    rawHandle: string,
    ownerId: string,
    caller: HostResourceGrantCaller,
    kind: Kind
  ): Promise<Extract<TransferGrant, { kind: Kind }>> {
    this.#assertAvailable()
    const parsed = domainFileTransferHandleSchema.safeParse(rawHandle)
    if (!parsed.success) {
      throw new DomainFileTransferError('invalid_request', 'The file transfer handle is invalid.')
    }
    const grant = this.#grants.get(parsed.data)
    if (!grant) {
      throw new DomainFileTransferError(
        'grant_unavailable',
        'The Host-owned file transfer handle is unavailable.'
      )
    }
    if (grant.expiresAt <= this.#now().getTime()) {
      this.#grants.delete(parsed.data)
      this.#detachGrantAbort(parsed.data)
      if (grant.kind === 'upload') {
        await this.#removeStagedDirectory(grant.stagedDirectory)
      }
      throw new DomainFileTransferError(
        'grant_unavailable',
        'The Host-owned file transfer handle is unavailable.'
      )
    }
    // A guessed opaque handle cannot be used to consume another owner or
    // caller's grant. Only the exact bound lease may claim it.
    if (
      grant.kind !== kind || grant.ownerId !== ownerId ||
      grant.caller.callerId !== caller.callerId
    ) {
      throw new DomainFileTransferError(
        'grant_unavailable',
        'The Host-owned file transfer handle is unavailable.'
      )
    }
    if (!samePrincipalSnapshot(grant.caller.principal, caller.principal)) {
      this.#grants.delete(parsed.data)
      this.#detachGrantAbort(parsed.data)
      if (grant.kind === 'upload') {
        await this.#removeStagedDirectory(grant.stagedDirectory)
      }
      throw new DomainFileTransferError(
        'principal_changed',
        'The current Principal no longer matches the file transfer grant.'
      )
    }
    this.#grants.delete(parsed.data)
    this.#detachGrantAbort(parsed.data)
    this.#activeSessions += 1
    return grant as Extract<TransferGrant, { kind: Kind }>
  }

  #sweep(): void {
    const now = this.#now().getTime()
    for (const [handle, grant] of this.#grants) {
      if (grant.expiresAt > now) continue
      this.#grants.delete(handle)
      this.#detachGrantAbort(handle)
      if (grant.kind === 'upload') {
        void this.#removeStagedDirectory(grant.stagedDirectory)
      }
    }
  }

  #cancelOutstandingGrant(
    handle: DomainFileTransferHandle,
    expectedGrant: TransferGrant
  ): void {
    if (this.#grants.get(handle) !== expectedGrant) return
    this.#grants.delete(handle)
    this.#detachGrantAbort(handle)
    if (expectedGrant.kind === 'upload') {
      void this.#removeStagedDirectory(expectedGrant.stagedDirectory)
    }
  }

  #detachGrantAbort(handle: DomainFileTransferHandle): void {
    const binding = this.#grantAbortBindings.get(handle)
    if (!binding) return
    this.#grantAbortBindings.delete(handle)
    binding.signal.removeEventListener('abort', binding.listener)
  }

  #removeStagedDirectory(path: string): Promise<void> {
    const existing = this.#cleanupOperations.get(path)
    if (existing) return existing
    const operation = (async () => {
      const reservation = this.#stagedUploads.get(path)
      if (!reservation) return
      try {
        await assertUploadStagedDirectoryCurrent(reservation.snapshot)
        await rm(path, { recursive: true, force: false })
        await assertPathMissing(path)
      } catch (error) {
        this.#orphanedUploadStagedDirectories.add(path)
        this.#reportCleanupError(error)
        return
      }
      this.#orphanedUploadStagedDirectories.delete(path)
      this.#stagedUploads.delete(path)
      this.#releaseTemporaryBytes(reservation.size)
    })()
    this.#cleanupOperations.set(path, operation)
    void operation.finally(() => {
      this.#cleanupOperations.delete(path)
    }).catch(() => undefined)
    return operation
  }

  #removeDownloadTemporaryFile(path: string): Promise<void> {
    const existing = this.#cleanupOperations.get(path)
    if (existing) return existing
    const operation = (async () => {
      const reservation = this.#temporaryDownloads.get(path)
      if (!reservation) return
      if (!reservation.snapshot) {
        this.#orphanedDownloadTemporaryPaths.add(path)
        this.#reportCleanupError(new DomainFileTransferError(
          'destination_unavailable',
          'The private partial download identity could not be established.'
        ))
        return
      }
      try {
        const status = await downloadTemporaryPathStatus(reservation.snapshot)
        if (status !== 'current') {
          throw new DomainFileTransferError(
            'destination_unavailable',
            'The private partial download disappeared before guarded cleanup.'
          )
        }
        await unlink(path)
        await assertDownloadParentCurrent(reservation.snapshot.parent)
      } catch (error) {
        this.#orphanedDownloadTemporaryPaths.add(path)
        this.#reportCleanupError(error)
        return
      }
      this.#orphanedDownloadTemporaryPaths.delete(path)
      this.#temporaryDownloads.delete(path)
      this.#releaseTemporaryBytes(reservation.size)
    })()
    this.#cleanupOperations.set(path, operation)
    void operation.finally(() => {
      this.#cleanupOperations.delete(path)
    }).catch(() => undefined)
    return operation
  }

  async #drainCleanupOperations(): Promise<void> {
    while (this.#cleanupOperations.size > 0) {
      await Promise.allSettled([...this.#cleanupOperations.values()])
    }
  }
}

async function openNoFollow(path: string): Promise<FileHandle> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('The upload source path is not a regular non-link file.')
  }
  const flags = process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW
  const file = await open(path, flags)
  try {
    const descriptor = await file.stat({ bigint: true })
    const after = await lstat(path, { bigint: true })
    if (
      !descriptor.isFile() || !after.isFile() || after.isSymbolicLink() ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(descriptor)) ||
      !sameFileIdentity(fileIdentity(before), fileIdentity(after))
    ) {
      throw new Error('The upload source path changed while it was opened.')
    }
    return file
  } catch (error) {
    await file.close().catch(() => undefined)
    throw error
  }
}

async function openPrivateDownload(path: string): Promise<FileHandle> {
  return open(path, 'wx', 0o600)
}

async function closeFilePreservingPrimaryError(
  file: FileHandle,
  primaryError: unknown,
  reportCleanupError: (error: unknown) => void
): Promise<void> {
  try {
    await file.close()
  } catch (error) {
    if (primaryError === undefined) throw error
    reportCleanupError(error)
  }
}

async function readRegularFileFingerprint(
  file: FileHandle,
  maxBytes: number
): Promise<FileFingerprint> {
  const info = await file.stat({ bigint: true })
  if (!info.isFile() || info.size > BigInt(maxBytes)) {
    throw new DomainFileTransferError(
      'bound_exceeded',
      'The selected upload source is not a bounded regular file.'
    )
  }
  return fileFingerprint(info)
}

async function assertRegularFileFingerprint(
  file: FileHandle,
  expected: FileFingerprint
): Promise<void> {
  try {
    const info = await file.stat({ bigint: true })
    if (!info.isFile() || !sameFileFingerprint(fileFingerprint(info), expected)) {
      throw new DomainFileTransferError(
        'source_changed',
        'The Host-owned upload snapshot is no longer valid.'
      )
    }
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'source_changed',
      'The Host-owned upload snapshot is no longer valid.'
    )
  }
}

async function copyFileHandle(
  source: FileHandle,
  destination: FileHandle,
  size: number,
  assertAuthorized: InvocationAssertion
): Promise<string> {
  const digest = createHash('sha256')
  const buffer = Buffer.alloc(Math.min(
    DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes,
    Math.max(size, 1)
  ))
  let offset = 0
  while (offset < size) {
    assertAuthorized()
    const length = Math.min(buffer.byteLength, size - offset)
    const result = await source.read(buffer, 0, length, offset)
    assertAuthorized()
    if (result.bytesRead !== length) {
      throw new DomainFileTransferError(
        'source_changed',
        'The selected upload source changed while the Host captured it.'
      )
    }
    digest.update(buffer.subarray(0, result.bytesRead))
    let written = 0
    while (written < result.bytesRead) {
      assertAuthorized()
      const write = await destination.write(
        buffer,
        written,
        result.bytesRead - written,
        offset + written
      )
      assertAuthorized()
      if (write.bytesWritten < 1) {
        throw new DomainFileTransferError(
          'source_unavailable',
          'The Host could not capture the selected upload source.'
        )
      }
      written += write.bytesWritten
    }
    offset += result.bytesRead
  }
  return digest.digest('hex')
}

async function digestFileHandle(
  file: FileHandle,
  size: number,
  assertAuthorized: InvocationAssertion
): Promise<string> {
  const digest = createHash('sha256')
  const buffer = Buffer.alloc(Math.min(
    DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes,
    Math.max(size, 1)
  ))
  let offset = 0
  while (offset < size) {
    assertAuthorized()
    const length = Math.min(buffer.byteLength, size - offset)
    const result = await file.read(buffer, 0, length, offset)
    assertAuthorized()
    if (result.bytesRead !== length) {
      throw new DomainFileTransferError(
        'source_changed',
        'The Host-owned upload snapshot changed while it was verified.'
      )
    }
    digest.update(buffer.subarray(0, result.bytesRead))
    offset += result.bytesRead
  }
  return digest.digest('hex')
}

function fileFingerprint(info: Awaited<ReturnType<FileHandle['stat']>> & {
  dev: bigint
  ino: bigint
  mode: bigint
  nlink: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
}): FileFingerprint {
  return Object.freeze({
    device: info.dev,
    inode: info.ino,
    mode: info.mode,
    links: info.nlink,
    size: info.size,
    modifiedNanoseconds: info.mtimeNs,
    changedNanoseconds: info.ctimeNs
  })
}

function sameFileFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.links === right.links &&
    left.size === right.size &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.changedNanoseconds === right.changedNanoseconds
}

function fileIdentity(info: Readonly<{ dev: bigint; ino: bigint }>): FileIdentity {
  return Object.freeze({ device: info.dev, inode: info.ino })
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

async function captureUploadStagedDirectorySnapshot(
  path: string
): Promise<UploadStagedDirectorySnapshot> {
  try {
    const canonicalPath = await realpath(path)
    const info = await lstat(canonicalPath, { bigint: true })
    const confirmedPath = await realpath(path)
    if (
      !info.isDirectory() || info.isSymbolicLink() ||
      confirmedPath !== canonicalPath
    ) {
      throw new Error('The upload staging directory is not stable.')
    }
    return Object.freeze({ canonicalPath, identity: fileIdentity(info) })
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'source_unavailable',
      'The Host-owned upload staging directory is unavailable.'
    )
  }
}

async function assertUploadStagedDirectoryCurrent(
  snapshot: UploadStagedDirectorySnapshot
): Promise<void> {
  try {
    const canonicalPath = await realpath(snapshot.canonicalPath)
    const info = await lstat(snapshot.canonicalPath, { bigint: true })
    const confirmedPath = await realpath(snapshot.canonicalPath)
    if (
      canonicalPath !== snapshot.canonicalPath ||
      confirmedPath !== snapshot.canonicalPath ||
      !info.isDirectory() || info.isSymbolicLink() ||
      !sameFileIdentity(snapshot.identity, fileIdentity(info))
    ) {
      throw new Error('The upload staging directory changed during the transfer.')
    }
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'source_changed',
      'The Host-owned upload staging directory changed during the transfer.'
    )
  }
}

async function readRegularFileIdentity(file: FileHandle): Promise<FileIdentity> {
  const info = await file.stat({ bigint: true })
  if (!info.isFile()) {
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The private partial download is not a regular file.'
    )
  }
  return fileIdentity(info)
}

async function captureDownloadParentSnapshot(
  path: string,
  expectedCanonicalPath?: string,
  workspaceRoot?: string
): Promise<DownloadParentSnapshot> {
  try {
    const canonicalPath = await realpath(path)
    if (expectedCanonicalPath && canonicalPath !== expectedCanonicalPath) {
      throw new Error('The destination parent changed during selection.')
    }
    const info = await lstat(canonicalPath, { bigint: true })
    const confirmedPath = await realpath(path)
    if (
      !info.isDirectory() || info.isSymbolicLink() ||
      confirmedPath !== canonicalPath ||
      (workspaceRoot !== undefined && !pathIsWithin(workspaceRoot, canonicalPath))
    ) {
      throw new Error('The destination parent is not a stable directory.')
    }
    return Object.freeze({
      canonicalPath,
      identity: fileIdentity(info),
      ...(workspaceRoot ? { workspaceRoot } : {})
    })
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The Host-selected destination parent is no longer available.'
    )
  }
}

async function assertDownloadParentCurrent(snapshot: DownloadParentSnapshot): Promise<void> {
  try {
    const canonicalPath = await realpath(snapshot.canonicalPath)
    const info = await lstat(snapshot.canonicalPath, { bigint: true })
    const confirmedPath = await realpath(snapshot.canonicalPath)
    if (
      canonicalPath !== snapshot.canonicalPath ||
      confirmedPath !== snapshot.canonicalPath ||
      !info.isDirectory() || info.isSymbolicLink() ||
      !sameFileIdentity(snapshot.identity, fileIdentity(info)) ||
      (snapshot.workspaceRoot !== undefined &&
        !pathIsWithin(snapshot.workspaceRoot, snapshot.canonicalPath))
    ) {
      throw new Error('The destination parent changed during the transfer.')
    }
    if (snapshot.workspaceRoot !== undefined) {
      const currentRoot = await realpath(snapshot.workspaceRoot)
      if (currentRoot !== snapshot.workspaceRoot) {
        throw new Error('The active Workspace root changed during the transfer.')
      }
    }
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The Host-selected destination parent changed during the transfer.'
    )
  }
}

async function downloadTemporaryPathStatus(
  snapshot: DownloadTemporarySnapshot
): Promise<'current' | 'missing'> {
  await assertDownloadParentCurrent(snapshot.parent)
  let info: BigIntStats
  try {
    info = await lstat(snapshot.path, { bigint: true })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      await assertDownloadParentCurrent(snapshot.parent)
      return 'missing'
    }
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The private partial download is unavailable.'
    )
  }
  if (
    !info.isFile() || info.isSymbolicLink() ||
    !sameFileIdentity(snapshot.identity, fileIdentity(info))
  ) {
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The private partial download changed during the transfer.'
    )
  }
  await assertDownloadParentCurrent(snapshot.parent)
  return 'current'
}

async function assertDownloadTemporaryCurrent(
  snapshot: DownloadTemporarySnapshot
): Promise<void> {
  if (await downloadTemporaryPathStatus(snapshot) !== 'current') {
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The private partial download disappeared during the transfer.'
    )
  }
}

async function assertPublishedDownloadCurrent(
  snapshot: DownloadTemporarySnapshot,
  destinationPath: string
): Promise<void> {
  await assertDownloadParentCurrent(snapshot.parent)
  try {
    const info = await lstat(destinationPath, { bigint: true })
    if (
      !info.isFile() || info.isSymbolicLink() ||
      !sameFileIdentity(snapshot.identity, fileIdentity(info))
    ) {
      throw new Error('The published destination does not match the private partial file.')
    }
  } catch (error) {
    if (error instanceof DomainFileTransferError) throw error
    throw new DomainFileTransferError(
      'destination_unavailable',
      'The atomically published destination could not be verified.'
    )
  }
  await assertDownloadParentCurrent(snapshot.parent)
}

function pathIsWithin(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (
    child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
  )
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return
    throw error
  }
  throw new Error('The Host-owned temporary path still exists after cleanup.')
}

async function assertDestinationAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return
    throw error
  }
  throw new DomainFileTransferError(
    'destination_conflict',
    'The Host-selected destination already exists; it will not be overwritten.'
  )
}

async function createUniqueDestinationTemporaryPath(
  destinationPath: string,
  parentSnapshot: DownloadParentSnapshot
): Promise<string> {
  const parent = dirname(destinationPath)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await assertDownloadParentCurrent(parentSnapshot)
    const path = join(parent, `.sciforge-download-${randomBytes(18).toString('hex')}.tmp`)
    try {
      await lstat(path)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        await assertDownloadParentCurrent(parentSnapshot)
        return path
      }
      throw error
    }
  }
  throw new DomainFileTransferError(
    'destination_unavailable',
    'The Host could not allocate a private partial download path.'
  )
}

function boundedAbsolutePath(value: string): string {
  if (
    typeof value !== 'string' || !isAbsolute(value) ||
    value.length < 1 || value.length > 4096
  ) {
    throw new DomainFileTransferError('invalid_request', 'The Host-owned file path is invalid.')
  }
  return value
}

function activeAgentWorkspaceContext(
  currentInvocation: HostResourceGrantInvocationProvider,
  direction: 'upload-source' | 'download-destination'
) {
  try {
    return requireActiveAgentWorkspaceResourceGrantCaller(currentInvocation, direction)
  } catch (error) {
    throw new DomainFileTransferError(
      'principal_changed',
      'Agent Workspace transfers require an active Broker-authorized resource operation.',
      { cause: error }
    )
  }
}

function invocationAssertion(
  currentInvocation: HostResourceGrantInvocationProvider,
  lease: HostResourceGrantInvocationLease
): InvocationAssertion {
  return () => {
    try {
      assertActiveHostResourceGrantInvocationLease(currentInvocation, lease)
    } catch {
      throw new DomainFileTransferError(
        'grant_unavailable',
        'The exact Host capability invocation lease is no longer active.'
      )
    }
  }
}

function parseWorkspaceRelativePath(value: string): string {
  const parsed = domainWorkspaceRelativePathSchema.safeParse(value)
  if (!parsed.success) {
    throw new DomainFileTransferError(
      'invalid_request',
      'The Agent file path must be a safe Workspace-relative path.'
    )
  }
  return parsed.data
}

function boundedLabel(value: string): string {
  const parsed = domainFileTransferLabelSchema.safeParse(value)
  if (!parsed.success) {
    throw new DomainFileTransferError('invalid_request', 'The selected file name is invalid.')
  }
  return parsed.data
}

function boundedMaxBytes(value: number): number {
  if (
    !Number.isSafeInteger(value) || value < 1 ||
    value > DOMAIN_FILE_TRANSFER_LIMITS.maxBytes
  ) {
    throw new DomainFileTransferError('invalid_request', 'The file transfer bound is invalid.')
  }
  return value
}

function boundedPositiveInteger(value: number, maximum: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(message)
  }
  return value
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
