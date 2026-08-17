import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { createWriteStream } from 'node:fs'
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
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import {
  DOMAIN_FILE_TRANSFER_LIMITS,
  DomainFileTransferError,
  domainFileTransferHandleSchema,
  domainFileTransferLabelSchema,
  type DomainFileTransferHandle,
  type DomainMainDownloadDestination,
  type DomainMainFileTransferHost,
  type DomainMainUploadSource,
  type DomainRendererDownloadSelection,
  type DomainRendererUploadSelection
} from '@sciforge/domain-sdk/file-transfer'
import {
  boundedHostResourceGrantOwnerId,
  defineHostResourceGrantCaller,
  requireActiveHostResourceGrantCaller,
  type HostResourceGrantCaller,
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
  stagedPath: string
  label: string
  size: number
  expiresAt: number
}>

type DownloadGrant = Readonly<{
  ownerId: string
  caller: HostResourceGrantCaller
  kind: 'download'
  path: string
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
  readonly #stagedUploadSizes = new Map<string, number>()
  readonly #orphanedUploadStagedDirectories = new Set<string>()
  readonly #temporaryDownloadSizes = new Map<string, number>()
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
    const activeCaller = () => {
      try {
        return requireActiveHostResourceGrantCaller(currentInvocation)
      } catch {
        throw new DomainFileTransferError(
          'principal_changed',
          'An active capability invocation with a current Principal is required.'
        )
      }
    }
    return Object.freeze({
      openUploadSource: async (input) => this.#openUploadSourceForCaller({
        ...input,
        ownerId: owner,
        caller: activeCaller()
      }),
      openDownloadDestination: async (input) => this.#openDownloadDestinationForCaller({
        ...input,
        ownerId: owner,
        caller: activeCaller()
      })
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
  }>): Promise<DomainRendererUploadSelection> {
    const ownerId = boundedHostResourceGrantOwnerId(input.ownerId)
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    this.#assertCurrent(caller)
    const sourcePath = boundedAbsolutePath(input.path)
    const maxBytes = boundedMaxBytes(input.maxBytes)
    this.#reserveGrantSlot()

    let stagedDirectory: string | undefined
    let untrackedByteReservation = 0
    try {
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      const source = await this.#openUploadFile(sourcePath)
      let snapshot: Readonly<{
        stagedPath: string
        label: string
        size: number
      }> | undefined
      try {
        const before = await readRegularFileFingerprint(source, maxBytes)
        const size = Number(before.size)
        this.#reserveTemporaryBytes(size)
        untrackedByteReservation = size
        stagedDirectory = await mkdtemp(join(this.#temporaryRoot, 'sciforge-upload-'))
        this.#stagedUploadSizes.set(stagedDirectory, size)
        untrackedByteReservation = 0
        await chmod(stagedDirectory, 0o700)
        const stagedPath = join(stagedDirectory, 'source.bin')
        let bytesCopied = 0
        const service = this
        const boundChunks = async function* (
          chunks: AsyncIterable<Uint8Array | string>
        ): AsyncGenerator<Uint8Array> {
          for await (const chunk of chunks) {
            input.signal?.throwIfAborted()
            service.#assertAvailable()
            service.#assertCallerEpoch(caller.callerId, callerEpoch)
            const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
            bytesCopied += bytes.byteLength
            if (bytesCopied > maxBytes || bytesCopied > size) {
              throw new DomainFileTransferError(
                'source_changed',
                'The selected upload source changed while the Host captured it.'
              )
            }
            yield bytes
          }
        }
        await pipeline(
          source.createReadStream({ autoClose: false }),
          boundChunks,
          createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 }),
          { signal: input.signal }
        )
        const after = fileFingerprint(await source.stat({ bigint: true }))
        this.#assertCallerEpoch(caller.callerId, callerEpoch)
        if (
          bytesCopied !== size ||
          !sameFileFingerprint(before, after)
        ) {
          throw new DomainFileTransferError(
            'source_changed',
            'The selected upload source changed while the Host captured it.'
          )
        }
        snapshot = Object.freeze({
          stagedPath,
          label: boundedLabel(basename(sourcePath)),
          size
        })
      } finally {
        await source.close()
      }
      if (!snapshot || !stagedDirectory) {
        throw new DomainFileTransferError(
          'source_unavailable',
          'The Host did not capture an upload snapshot.'
        )
      }
      // Never issue before every source descriptor operation has completed.
      // dispose() flips availability and waits this tracked registration.
      this.#assertAvailable()
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      const handle = this.#issue(Object.freeze({
        ownerId,
        caller,
        kind: 'upload' as const,
        stagedDirectory,
        stagedPath: snapshot.stagedPath,
        label: snapshot.label,
        size: snapshot.size,
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
  }>): Promise<DomainRendererDownloadSelection> {
    const ownerId = boundedHostResourceGrantOwnerId(input.ownerId)
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    this.#assertCurrent(caller)
    const selectedPath = boundedAbsolutePath(input.path)
    this.#reserveGrantSlot()
    try {
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      const parent = await this.#resolveDownloadParent(dirname(selectedPath))
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      const destinationPath = join(parent, basename(selectedPath))
      const label = boundedLabel(basename(destinationPath))
      await assertDestinationAbsent(destinationPath)
      this.#assertAvailable()
      input.signal?.throwIfAborted()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      const handle = this.#issue(Object.freeze({
        ownerId,
        caller,
        kind: 'download' as const,
        path: destinationPath,
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
  }>): Promise<DomainMainUploadSource> {
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    const maxBytes = boundedMaxBytes(input.maxBytes)
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
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The upload was cancelled.')
      }
    } catch (error) {
      await this.#removeStagedDirectory(grant.stagedDirectory)
      releaseSession()
      throw error
    }

    let file: FileHandle | undefined
    try {
      file = await this.#openUploadFile(grant.stagedPath)
      const info = await file.stat()
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The upload was cancelled.')
      }
      if (!info.isFile() || info.size !== grant.size) {
        throw new DomainFileTransferError(
          'source_changed',
          'The Host-owned upload snapshot is no longer valid.'
        )
      }
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
      read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) => {
        if (cancelled) {
          throw new DomainFileTransferError('cancelled', 'The upload read was cancelled.')
        }
        if (closed) {
          throw new DomainFileTransferError('already_settled', 'The upload source is closed.')
        }
        this.#assertCallerEpoch(caller.callerId, callerEpoch)
        this.#assertCurrent(caller)
        if (input.signal?.aborted) {
          throw new DomainFileTransferError('cancelled', 'The upload read was cancelled.')
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
          bytesRead = (await openedFile.read(bytes, 0, length, offset)).bytesRead
        } catch {
          this.#assertCallerEpoch(caller.callerId, callerEpoch)
          if (cancelled || input.signal?.aborted) {
            throw new DomainFileTransferError(
              'cancelled',
              'The upload read was cancelled.'
            )
          }
          if (closed) {
            throw new DomainFileTransferError(
              'already_settled',
              'The upload source is closed.'
            )
          }
          throw new DomainFileTransferError(
            'source_unavailable',
            'The Host-owned upload snapshot could not be read.'
          )
        }
        this.#assertCallerEpoch(caller.callerId, callerEpoch)
        this.#assertCurrent(caller)
        if (cancelled || input.signal?.aborted) {
          throw new DomainFileTransferError('cancelled', 'The upload read was cancelled.')
        }
        if (closed) {
          throw new DomainFileTransferError('already_settled', 'The upload source is closed.')
        }
        if (bytesRead !== length) {
          throw new DomainFileTransferError(
            'source_changed',
            'The Host-owned upload snapshot changed during the operation.'
          )
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
  }>): Promise<DomainMainDownloadDestination> {
    const caller = defineHostResourceGrantCaller(input.caller)
    const callerEpoch = this.#callerRevocationEpoch(caller.callerId)
    const maxBytes = boundedMaxBytes(input.maxBytes)
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
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
      }
    } catch (error) {
      releaseSession()
      releaseTemporaryReservation()
      throw error
    }

    let temporaryPath: string
    try {
      temporaryPath = await createUniqueDestinationTemporaryPath(grant.path)
    } catch (error) {
      releaseSession()
      releaseTemporaryReservation()
      throw error
    }
    let file: FileHandle
    try {
      file = await this.#openDownloadTemporaryFile(temporaryPath)
    } catch {
      releaseSession()
      releaseTemporaryReservation()
      throw new DomainFileTransferError(
        'destination_unavailable',
        'The Host could not create a private partial download.'
      )
    }
    this.#temporaryDownloadSizes.set(temporaryPath, maxBytes)
    temporaryBytesReserved = false
    try {
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
      if (input.signal?.aborted) {
        throw new DomainFileTransferError('cancelled', 'The download was cancelled.')
      }
    } catch (error) {
      let closeError: unknown
      try {
        await file.close()
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
      await file.close()
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
      this.#assertCallerEpoch(caller.callerId, callerEpoch)
      this.#assertCurrent(caller)
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
            if (bytesWritten + bytes.byteLength > maxBytes) {
              throw new DomainFileTransferError(
                'bound_exceeded',
                'The download chunk exceeds the destination bound.'
              )
            }
            let offset = 0
            while (offset < bytes.byteLength) {
              const result = await file.write(
                bytes,
                offset,
                bytes.byteLength - offset,
                bytesWritten + offset
              )
              if (result.bytesWritten < 1) {
                throw new DomainFileTransferError(
                  'destination_unavailable',
                  'The Host could not finish writing the private partial download.'
                )
              }
              offset += result.bytesWritten
            }
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
          await file.sync()
          // Cancellation or Principal changes during a blocked fsync prevent
          // publication. Closing the temporary file is not publication.
          assertAuthorized()
          await closeFile()
          // This is the final synchronous authorization point immediately
          // before starting the atomic no-overwrite link operation.
          assertAuthorized()
          await this.#publishCompletedDownload(temporaryPath, grant.path)
          // The OS operation may have published before an asynchronous
          // cancellation or Principal change became observable. Preserve the
          // published file, but fail closed so the domain reports an unknown
          // operation outcome rather than claiming success or retrying.
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
    if (this.#stagedUploadSizes.size > 0) {
      await Promise.all(
        [...this.#stagedUploadSizes.keys()].map((path) => this.#removeStagedDirectory(path))
      )
      await this.#drainCleanupOperations()
    }
    if (this.#temporaryDownloadSizes.size > 0) {
      await Promise.all(
        [...this.#temporaryDownloadSizes.keys()].map((path) =>
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
      try {
        await rm(path, { recursive: true, force: true })
        const size = this.#stagedUploadSizes.get(path)
        if (size !== undefined) {
          this.#stagedUploadSizes.delete(path)
          this.#releaseTemporaryBytes(size)
        }
      } catch (error) {
        this.#orphanedUploadStagedDirectories.add(path)
        this.#reportCleanupError(error)
        return
      }
      this.#orphanedUploadStagedDirectories.delete(path)
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
      try {
        await unlink(path)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) {
          this.#orphanedDownloadTemporaryPaths.add(path)
          this.#reportCleanupError(error)
          return
        }
      }
      this.#orphanedDownloadTemporaryPaths.delete(path)
      const size = this.#temporaryDownloadSizes.get(path)
      if (size !== undefined) {
        this.#temporaryDownloadSizes.delete(path)
        this.#releaseTemporaryBytes(size)
      }
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
  return open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
}

async function openPrivateDownload(path: string): Promise<FileHandle> {
  return open(path, 'wx', 0o600)
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

async function createUniqueDestinationTemporaryPath(destinationPath: string): Promise<string> {
  const parent = dirname(destinationPath)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const path = join(parent, `.sciforge-download-${randomBytes(18).toString('hex')}.tmp`)
    try {
      await lstat(path)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return path
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
