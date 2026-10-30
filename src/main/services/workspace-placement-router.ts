import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_LIMITS,
  workspaceLocatorSchema,
  type WorkspaceHostEvent,
  type WorkspaceHostPayload,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'
import type {
  VersionControlDiffInput,
  VersionControlStatusOutput,
  VersionControlTextOutput
} from '@sciforge/domain-sdk/version-control'
import {
  resolveOpenTargetPath
} from '@sciforge/domain-sdk/node/workspace-paths'
import type {
  GitBranchesResult
} from '../../shared/git-branches'
import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryTarget,
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  WorkspaceClipboardPastePayload,
  WorkspaceClipboardPasteResult,
  WorkspaceEntryCopyPayload,
  WorkspaceEntryCopyResult,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceEntryImportPayload,
  WorkspaceEntryImportResult,
  WorkspaceEntryMovePayload,
  WorkspaceEntryMoveResult,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspaceFileChangePayload,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileRangeReadPayload,
  WorkspaceFileRangeReadResult,
  WorkspaceFileReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspaceImageReadResult,
  WorkspacePdfRenameSuggestionPayload,
  WorkspacePdfRenameSuggestionResult,
  WorkspaceTextSearchPayload,
  WorkspaceTextSearchResult
} from '../../shared/workspace-file'
import type {
  ControlledProcessCreateInput,
  ControlledProcessCreateResult,
  ControlledProcessReadInput,
  ControlledProcessReadResult,
  ControlledProcessService
} from '../processes/controlled-process-service'
import { WorkspaceHostControlledProcessService } from '../processes/workspace-host-controlled-process-service'
import type {
  WorkspaceHostSessionManager
} from '../workspace-host/session-manager'
import {
  copyWorkspaceEntry,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  importWorkspaceEntries,
  listWorkspaceDirectory,
  moveWorkspaceEntry,
  pasteWorkspaceClipboard,
  readWorkspaceFile,
  readWorkspaceImage,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  saveWorkspaceClipboardImage,
  writeWorkspaceFile
} from './workspace-files'
import { suggestWorkspacePdfName } from './pdf-auto-rename-service'
import {
  createAndSwitchGitBranch,
  getGitBranches,
  switchGitBranch
} from './git-service'
import {
  requireWorkspaceLocatorRoot,
  workspaceHostDisplayPath,
  workspaceHostWirePath
} from './workspace-host-path'
import { WorkspaceHostServiceAdapter } from './workspace-host-service-adapter'

const execFileAsync = promisify(execFile)
const REMOTE_TEXT_PREVIEW_BYTES = 1_500_000
const REMOTE_IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon']
])

type WorkspaceHostPortResolver = Pick<WorkspaceHostSessionManager, 'portFor'>

export type WorkspacePlacementRouterOptions = Readonly<{
  sessionManager: WorkspaceHostPortResolver
  localControlledProcesses: ControlledProcessService
}>

type LocalWatchRecord = Readonly<{
  kind: 'local'
  watcher: FSWatcher
}>

type RemoteWatchRecord = Readonly<{
  kind: 'workspace-host'
  adapter: WorkspaceHostServiceAdapter
  remoteWatchId: string
  unsubscribe: () => void
}>

type WatchRecord = LocalWatchRecord | RemoteWatchRecord

type ProcessBackend =
  | Readonly<{ kind: 'local'; service: ControlledProcessService }>
  | Readonly<{ kind: 'workspace-host'; service: WorkspaceHostControlledProcessService }>

type RoutedProcess = Readonly<{
  ownerId: string
  backend: ProcessBackend
}>

export class WorkspacePlacementRouter {
  readonly #sessions: WorkspaceHostPortResolver
  readonly #localProcesses: ControlledProcessService
  readonly #remoteProcesses = new Map<string, WorkspaceHostControlledProcessService>()
  readonly #processBackends = new Map<string, RoutedProcess>()
  readonly #watches = new Map<string, WatchRecord>()

  constructor(options: WorkspacePlacementRouterOptions) {
    this.#sessions = options.sessionManager
    this.#localProcesses = options.localControlledProcesses
  }

  async listDirectory(input: WorkspaceDirectoryTarget): Promise<WorkspaceDirectoryListResult> {
    if (!input.workspaceLocator) return listWorkspaceDirectory(input)
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const path = workspaceHostWirePath(input.workspaceLocator, input.path)
      const result = await adapter.listDirectory({ path, limit: 10_000 })
      if (result.nextCursor) {
        return { ok: false, message: 'Remote directory contains more than 10000 entries.' }
      }
      return {
        ok: true,
        root: workspaceHostDisplayPath(input.workspaceLocator, path),
        entries: result.entries
          .filter((entry) => entry.name !== '.DS_Store')
          .map((entry) => ({
            name: entry.name,
            path: workspaceHostDisplayPath(input.workspaceLocator!, entry.path),
            type: entry.kind === 'directory' ? ('directory' as const) : ('file' as const),
            ext: entry.kind === 'directory' ? '' : extname(entry.name)
          }))
          .sort((left, right) => (
            left.type === right.type
              ? left.name.localeCompare(right.name)
              : left.type === 'directory' ? -1 : 1
          ))
      }
    } catch (error) {
      return failure(error)
    }
  }

  async resolveFile(input: WorkspaceFileTarget): Promise<WorkspaceFileResolveResult> {
    if (!input.workspaceLocator) return resolveWorkspaceFile(input)
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const path = workspaceHostWirePath(input.workspaceLocator, input.path)
      const result = await adapter.stat({ path })
      return {
        ok: true,
        path: workspaceHostDisplayPath(input.workspaceLocator, result.entry.path),
        kind: result.entry.kind === 'directory' ? 'directory' : 'file'
      }
    } catch (error) {
      return failure(error)
    }
  }

  async readFile(input: WorkspaceFileTarget): Promise<WorkspaceFileReadResult> {
    if (!input.workspaceLocator) return readWorkspaceFile(input)
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const path = workspaceHostWirePath(input.workspaceLocator, input.path)
      const { entry } = await adapter.stat({ path })
      if (entry.kind === 'directory') return { ok: false, message: 'Cannot preview a directory.' }
      const extension = extname(entry.name).toLowerCase()
      if (extension === '.docx') {
        return { ok: false, message: 'Remote DOCX text editing is not supported.' }
      }
      const maxBytes = extension === '.pdf'
        ? WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes
        : REMOTE_TEXT_PREVIEW_BYTES
      const read = await adapter.readFile({ path, maxBytes })
      const bytes = decodeWorkspaceHostBytes(read.contentBase64, read.bytesRead)
      const displayPath = workspaceHostDisplayPath(input.workspaceLocator, path)
      const position = {
        ...(input.line ? { line: input.line } : {}),
        ...(input.column ? { column: input.column } : {})
      }
      if (extension === '.pdf') {
        if (read.truncated) {
          return { ok: false, message: 'This remote PDF exceeds the inline preview limit.' }
        }
        return {
          ok: true,
          kind: 'pdf',
          path: displayPath,
          content: '',
          dataBase64: read.contentBase64,
          mimeType: 'application/pdf',
          size: entry.size,
          truncated: false,
          mtimeMs: entry.mtimeMs,
          revision: read.revision,
          ...position
        }
      }
      return {
        ok: true,
        kind: 'text',
        path: displayPath,
        content: bytes.toString('utf8'),
        mimeType: textMimeType(extension),
        size: entry.size,
        truncated: read.truncated,
        revision: read.revision,
        ...position
      }
    } catch (error) {
      return failure(error)
    }
  }

  async readImage(input: WorkspaceFileTarget): Promise<WorkspaceImageReadResult> {
    if (!input.workspaceLocator) return readWorkspaceImage(input)
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const path = workspaceHostWirePath(input.workspaceLocator, input.path)
      const { entry } = await adapter.stat({ path })
      if (entry.kind === 'directory') return { ok: false, message: 'Cannot preview a directory.' }
      const mimeType = REMOTE_IMAGE_MIME_TYPES.get(extname(entry.name).toLowerCase())
      if (!mimeType) return { ok: false, message: 'This remote image type is not supported.' }
      const read = await adapter.readFile({
        path,
        maxBytes: WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes
      })
      decodeWorkspaceHostBytes(read.contentBase64, read.bytesRead)
      if (read.truncated) {
        return { ok: false, message: 'This remote image exceeds the inline preview limit.' }
      }
      return {
        ok: true,
        path: workspaceHostDisplayPath(input.workspaceLocator, path),
        dataUrl: `data:${mimeType};base64,${read.contentBase64}`,
        mimeType,
        size: entry.size,
        revision: read.revision
      }
    } catch (error) {
      return failure(error)
    }
  }

  async readRange(input: WorkspaceFileRangeReadPayload): Promise<WorkspaceFileRangeReadResult> {
    if (!input.workspaceLocator) {
      try {
        const target = await resolveOpenTargetPath(input.path, input.workspaceRoot, {
          allowBasenameFallback: false
        })
        const handle = await open(target, 'r')
        try {
          const buffer = Buffer.alloc(input.length)
          const { bytesRead } = await handle.read(buffer, 0, input.length, input.offset)
          const info = await handle.stat()
          return {
            ok: true,
            path: target,
            offset: input.offset,
            dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
            bytesRead,
            truncated: input.offset + bytesRead < info.size,
            revision: `${info.size}:${info.mtimeMs}`
          }
        } finally {
          await handle.close()
        }
      } catch (error) {
        return failure(error)
      }
    }
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const path = workspaceHostWirePath(input.workspaceLocator, input.path)
      const result = await adapter.readFileRange({
        path,
        offset: input.offset,
        length: input.length
      })
      decodeWorkspaceHostBytes(result.contentBase64, result.bytesRead)
      return {
        ok: true,
        path: workspaceHostDisplayPath(input.workspaceLocator, path),
        offset: input.offset,
        dataBase64: result.contentBase64,
        bytesRead: result.bytesRead,
        truncated: result.truncated,
        revision: result.revision
      }
    } catch (error) {
      return failure(error)
    }
  }

  async writeFile(input: WorkspaceFileWritePayload): Promise<WorkspaceFileWriteResult> {
    if (!input.workspaceLocator) return writeWorkspaceFile(input)
    try {
      const locator = requireWorkspaceLocatorRoot(input.workspaceLocator, input.workspaceRoot)
      const adapter = this.#adapter(locator)
      const path = workspaceHostWirePath(locator, input.path)
      const contentBase64 = input.contentBase64
        ?? Buffer.from(input.content ?? '', 'utf8').toString('base64')
      if (!input.expectedRevision) {
        return {
          ok: false,
          message: 'Remote file writes require the revision returned by the latest read.'
        }
      }
      const written = await adapter.writeFile({
        path,
        contentBase64,
        expectedRevision: input.expectedRevision,
        create: false
      })
      return {
        ok: true,
        path: workspaceHostDisplayPath(locator, path),
        savedAt: new Date().toISOString(),
        revision: written.revision
      }
    } catch (error) {
      return failure(error)
    }
  }

  async searchText(input: WorkspaceTextSearchPayload): Promise<WorkspaceTextSearchResult> {
    if (!input.workspaceLocator) return localTextSearch(input)
    try {
      const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
      const result = await adapter.searchText({
        query: input.query,
        path: workspaceHostWirePath(input.workspaceLocator, input.path),
        ...(input.glob ? { glob: input.glob } : {}),
        caseSensitive: input.caseSensitive ?? false,
        maxResults: input.maxResults ?? 1_000
      })
      return {
        ok: true,
        matches: result.matches.map((match) => ({
          ...match,
          path: workspaceHostDisplayPath(input.workspaceLocator!, match.path)
        })),
        truncated: result.truncated
      }
    } catch (error) {
      return failure(error)
    }
  }

  async versionControlStatus(
    locator: WorkspaceLocator
  ): Promise<VersionControlStatusOutput> {
    return this.#adapter(locator).versionControlStatus()
  }

  async versionControlDiff(
    locator: WorkspaceLocator,
    input: VersionControlDiffInput
  ): Promise<VersionControlTextOutput> {
    const paths = input.paths?.map((path) => workspaceHostWirePath(locator, path))
    return this.#adapter(locator).versionControlDiff({
      ...input,
      ...(paths ? { paths } : {})
    })
  }

  getGitBranches(workspaceRoot: string, locator?: WorkspaceLocator): Promise<GitBranchesResult> {
    if (!locator) return getGitBranches(workspaceRoot)
    return Promise.resolve(unsupportedGitResult(
      'Remote branch enumeration is not supported by the Workspace Host contract.'
    ))
  }

  switchGitBranch(
    workspaceRoot: string,
    branch: string,
    locator?: WorkspaceLocator
  ): Promise<GitBranchesResult> {
    if (!locator) return switchGitBranch(workspaceRoot, branch)
    return Promise.resolve(unsupportedGitResult(
      'Remote branch switching is not supported by the Workspace Host contract.'
    ))
  }

  createAndSwitchGitBranch(
    workspaceRoot: string,
    branch: string,
    locator?: WorkspaceLocator
  ): Promise<GitBranchesResult> {
    if (!locator) return createAndSwitchGitBranch(workspaceRoot, branch)
    return Promise.resolve(unsupportedGitResult(
      'Remote branch creation is not supported by the Workspace Host contract.'
    ))
  }

  createFile(input: WorkspaceFileCreatePayload): Promise<WorkspaceFileCreateResult> {
    if (!input.workspaceLocator) return createWorkspaceFile(input)
    return Promise.resolve(unsupportedMutation('Creating remote files'))
  }

  createDirectory(
    input: WorkspaceDirectoryCreatePayload
  ): Promise<WorkspaceDirectoryCreateResult> {
    if (!input.workspaceLocator) return createWorkspaceDirectory(input)
    return Promise.resolve(unsupportedMutation('Creating remote directories'))
  }

  saveClipboardImage(
    input: WorkspaceClipboardImageSavePayload
  ): Promise<WorkspaceClipboardImageSaveResult> {
    if (!input.workspaceLocator) return saveWorkspaceClipboardImage(input)
    return Promise.resolve(unsupportedMutation('Saving clipboard images in remote workspaces'))
  }

  pasteClipboard(
    input: WorkspaceClipboardPastePayload
  ): Promise<WorkspaceClipboardPasteResult> {
    if (!input.workspaceLocator) return pasteWorkspaceClipboard(input)
    return Promise.resolve(unsupportedMutation('Pasting clipboard content into remote workspaces'))
  }

  suggestPdfName(
    input: WorkspacePdfRenameSuggestionPayload
  ): Promise<WorkspacePdfRenameSuggestionResult> {
    if (!input.workspaceLocator) return suggestWorkspacePdfName(input)
    return Promise.resolve(unsupportedMutation('Renaming remote PDF files'))
  }

  renameEntry(input: WorkspaceEntryRenamePayload): Promise<WorkspaceEntryRenameResult> {
    if (!input.workspaceLocator) return renameWorkspaceEntry(input)
    return Promise.resolve(unsupportedMutation('Renaming remote entries'))
  }

  copyEntry(input: WorkspaceEntryCopyPayload): Promise<WorkspaceEntryCopyResult> {
    if (!input.workspaceLocator) return copyWorkspaceEntry(input)
    return Promise.resolve(unsupportedMutation('Copying remote entries'))
  }

  importEntries(input: WorkspaceEntryImportPayload): Promise<WorkspaceEntryImportResult> {
    if (!input.workspaceLocator) return importWorkspaceEntries(input)
    return Promise.resolve(unsupportedMutation('Importing entries into a remote workspace'))
  }

  moveEntry(input: WorkspaceEntryMovePayload): Promise<WorkspaceEntryMoveResult> {
    if (!input.workspaceLocator) return moveWorkspaceEntry(input)
    return Promise.resolve(unsupportedMutation('Moving remote entries'))
  }

  deleteEntry(input: WorkspaceEntryDeletePayload): Promise<WorkspaceEntryDeleteResult> {
    if (!input.workspaceLocator) return deleteWorkspaceEntry(input)
    return Promise.resolve(unsupportedMutation('Deleting remote entries'))
  }

  async watchFile(
    input: WorkspaceFileWatchPayload,
    listener: (change: WorkspaceFileChangePayload) => void
  ): Promise<WorkspaceFileWatchResult> {
    const startedAt = new Date().toISOString()
    const initial = await this.readFile(input)
    if (!initial.ok) {
      const image = await this.readImage(input)
      if (!image.ok) return initial
      return this.#startWatch(input, listener, {
        path: image.path,
        content: '',
        dataBase64: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
        mimeType: image.mimeType,
        size: image.size,
        truncated: false,
        revision: image.revision,
        startedAt
      })
    }
    return this.#startWatch(input, listener, {
      path: initial.path,
      kind: initial.kind,
      content: initial.content,
      ...('dataBase64' in initial ? { dataBase64: initial.dataBase64 } : {}),
      mimeType: initial.mimeType,
      size: initial.size,
      truncated: initial.truncated,
      revision: initial.revision,
      ...('mtimeMs' in initial ? { mtimeMs: initial.mtimeMs } : {}),
      startedAt
    })
  }

  async unwatchFile(watchId: string): Promise<boolean> {
    const record = this.#watches.get(watchId)
    if (!record) return false
    if (record.kind === 'local') {
      record.watcher.close()
    } else {
      await record.adapter.unwatchFile({ watchId: record.remoteWatchId })
      record.unsubscribe()
    }
    this.#watches.delete(watchId)
    return true
  }

  async create(input: ControlledProcessCreateInput): Promise<ControlledProcessCreateResult> {
    const backend = input.workspaceLocator
      ? this.#remoteProcessBackend(input.workspaceLocator, input.workspaceRoot)
      : { kind: 'local' as const, service: this.#localProcesses }
    const created = await backend.service.create(input)
    this.#processBackends.set(created.resourceId, {
      ownerId: input.ownerId.trim(),
      backend
    })
    return created
  }

  read(input: ControlledProcessReadInput): Promise<ControlledProcessReadResult> {
    return Promise.resolve(this.#processBackend(input.resourceId).service.read(input))
  }

  async write(ownerId: string, resourceId: string, data: string): Promise<number> {
    return await this.#processBackend(resourceId).service.write(ownerId, resourceId, data)
  }

  async resize(
    ownerId: string,
    resourceId: string,
    columns: number,
    rows: number
  ): Promise<void> {
    await this.#processBackend(resourceId).service.resize(ownerId, resourceId, columns, rows)
  }

  async dispose(ownerId: string, resourceId: string): Promise<boolean> {
    const backend = this.#processBackends.get(resourceId)
    if (!backend) return false
    const disposed = await backend.backend.service.dispose(ownerId, resourceId)
    if (disposed) this.#processBackends.delete(resourceId)
    return disposed
  }

  has(ownerId: string, resourceId: string): boolean {
    const backend = this.#processBackends.get(resourceId)
    return Boolean(backend?.backend.service.has(ownerId, resourceId))
  }

  async disposeOwner(ownerId: string): Promise<void> {
    await Promise.all([...this.#processBackends.entries()].map(async ([resourceId, process]) => {
      if (process.ownerId !== ownerId) return
      await this.dispose(ownerId, resourceId)
    }))
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.#watches.keys()].map((watchId) =>
      this.unwatchFile(watchId).catch(() => false)
    ))
    await Promise.all([...this.#processBackends.entries()].map(async ([resourceId, process]) => {
      await this.dispose(process.ownerId, resourceId).catch(() => false)
    }))
    this.#localProcesses.disposeAll()
    await Promise.all([...this.#remoteProcesses.values()].map((service) => service.disposeAll()))
    this.#processBackends.clear()
  }

  #adapter(locator: WorkspaceLocator, workspaceRoot?: string): WorkspaceHostServiceAdapter {
    const parsed = requireWorkspaceLocatorRoot(locator, workspaceRoot)
    return new WorkspaceHostServiceAdapter({
      locator: parsed,
      client: this.#sessions.portFor(parsed)
    })
  }

  async #startWatch(
    input: WorkspaceFileWatchPayload,
    listener: (change: WorkspaceFileChangePayload) => void,
    initial: Omit<Extract<WorkspaceFileWatchResult, { ok: true }>, 'ok' | 'watchId'>
  ): Promise<WorkspaceFileWatchResult> {
    const watchId = randomUUID()
    if (!input.workspaceLocator) {
      try {
        const watcher = watch(initial.path, { persistent: false }, () => {
          void this.#publishWatchRefresh(watchId, input, listener)
        })
        this.#watches.set(watchId, { kind: 'local', watcher })
      } catch (error) {
        return failure(error)
      }
    } else {
      try {
        const adapter = this.#adapter(input.workspaceLocator, input.workspaceRoot)
        let remoteWatchId: string | undefined
        const pendingEvents: WorkspaceHostEvent[] = []
        const acceptEvent = (event: WorkspaceHostEvent): void => {
          if (event.kind !== WORKSPACE_HOST_EVENT_KINDS.fileChanged) return
          if (!remoteWatchId) {
            if (pendingEvents.length < 100) pendingEvents.push(event)
            return
          }
          if (eventWatchId(event.payload) !== remoteWatchId) return
          void this.#publishWatchRefresh(watchId, input, listener)
        }
        const port = this.#sessions.portFor(input.workspaceLocator)
        const unsubscribe = port.subscribe(acceptEvent)
        try {
          const started = await adapter.watchFile({
            path: workspaceHostWirePath(input.workspaceLocator, input.path),
            recursive: false
          })
          remoteWatchId = started.watchId
          this.#watches.set(watchId, {
            kind: 'workspace-host',
            adapter,
            remoteWatchId,
            unsubscribe
          })
          for (const event of pendingEvents.splice(0)) acceptEvent(event)
        } catch (error) {
          unsubscribe()
          throw error
        }
      } catch (error) {
        return failure(error)
      }
    }
    return { ok: true, watchId, ...initial }
  }

  async #publishWatchRefresh(
    watchId: string,
    input: WorkspaceFileWatchPayload,
    listener: (change: WorkspaceFileChangePayload) => void
  ): Promise<void> {
    if (!this.#watches.has(watchId)) return
    const changedAt = new Date().toISOString()
    const result = await this.readFile(input)
    if (!result.ok) {
      listener({
        ok: false,
        watchId,
        workspaceRoot: input.workspaceRoot,
        path: input.path,
        message: result.message,
        changedAt
      })
      return
    }
    listener({
      ok: true,
      watchId,
      workspaceRoot: input.workspaceRoot,
      kind: result.kind,
      path: result.path,
      content: result.content,
      ...('dataBase64' in result ? { dataBase64: result.dataBase64 } : {}),
      mimeType: result.mimeType,
      size: result.size,
      truncated: result.truncated,
      revision: result.revision,
      ...('mtimeMs' in result ? { mtimeMs: result.mtimeMs } : {}),
      changedAt
    })
  }

  #remoteProcessBackend(
    locator: WorkspaceLocator,
    workspaceRoot: string
  ): Extract<ProcessBackend, { kind: 'workspace-host' }> {
    const parsed = requireWorkspaceLocatorRoot(locator, workspaceRoot)
    const key = `${parsed.hostSessionId}\0${parsed.path}`
    let service = this.#remoteProcesses.get(key)
    if (!service) {
      service = new WorkspaceHostControlledProcessService({
        locator: parsed,
        client: this.#sessions.portFor(parsed)
      })
      this.#remoteProcesses.set(key, service)
    }
    return { kind: 'workspace-host', service }
  }

  #processBackend(resourceId: string): ProcessBackend {
    const process = this.#processBackends.get(resourceId)
    if (!process) throw new Error('Controlled process session is unavailable to this caller.')
    return process.backend
  }
}

function decodeWorkspaceHostBytes(contentBase64: string, expectedBytes: number): Buffer {
  const bytes = Buffer.from(contentBase64, 'base64')
  if (bytes.byteLength !== expectedBytes || bytes.toString('base64') !== contentBase64) {
    throw new Error('Workspace Host returned inconsistent file bytes.')
  }
  return bytes
}

function textMimeType(extension: string): string {
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8'
  if (extension === '.md' || extension === '.markdown') return 'text/markdown; charset=utf-8'
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8'
  if (extension === '.ts' || extension === '.tsx') return 'text/typescript; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

function failure(error: unknown): { ok: false; message: string } {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  }
}

function unsupportedMutation<T>(action: string): T {
  return {
    ok: false,
    message: `${action} is not supported by the Workspace Host contract.`
  } as T
}

function unsupportedGitResult(message: string): GitBranchesResult {
  return { ok: false, reason: 'error', message }
}


function eventWatchId(payload: WorkspaceHostPayload): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return typeof payload.watchId === 'string' ? payload.watchId : undefined
}

async function localTextSearch(
  input: WorkspaceTextSearchPayload
): Promise<WorkspaceTextSearchResult> {
  try {
    const target = await resolveOpenTargetPath(input.path ?? '.', input.workspaceRoot, {
      allowBasenameFallback: false
    })
    if (!(await stat(target)).isDirectory()) {
      return { ok: false, message: 'Workspace search target must be a directory.' }
    }
    const args = [
      '--json',
      '--line-number',
      '--column',
      '--color=never',
      ...(input.caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
      ...(input.glob ? ['--glob', input.glob] : []),
      '--',
      input.query,
      target
    ]
    const { stdout } = await execFileAsync('rg', args, {
      cwd: input.workspaceRoot,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024
    }).catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code
      if (code === 1) return { stdout: '', stderr: '' }
      throw error
    })
    const matches: Extract<WorkspaceTextSearchResult, { ok: true }>['matches'] = []
    const maxResults = input.maxResults ?? 1_000
    for (const line of String(stdout).split('\n')) {
      if (!line || matches.length >= maxResults) break
      const match = parseLocalSearchMatch(line)
      if (match) matches.push(match)
    }
    return {
      ok: true,
      matches,
      truncated: matches.length >= maxResults
    }
  } catch (error) {
    return failure(error)
  }
}

function parseLocalSearchMatch(
  line: string
): Extract<WorkspaceTextSearchResult, { ok: true }>['matches'][number] | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || value.type !== 'match' || !isRecord(value.data)) return undefined
  const path = textValue(value.data.path)
  const lines = textValue(value.data.lines)
  const lineNumber = value.data.line_number
  const submatches = value.data.submatches
  if (!path || !lines || typeof lineNumber !== 'number' || !Array.isArray(submatches)) {
    return undefined
  }
  const first = submatches[0]
  return {
    path,
    line: lineNumber,
    column: isRecord(first) && typeof first.start === 'number' ? first.start + 1 : 1,
    preview: lines.replace(/\r?\n$/u, '').slice(0, 20_000)
  }
}

function textValue(value: unknown): string | undefined {
  return isRecord(value) && typeof value.text === 'string' ? value.text : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
