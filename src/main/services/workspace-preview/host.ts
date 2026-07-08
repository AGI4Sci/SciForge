import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, open, readFile, stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import {
  WORKSPACE_TABULAR_MAX_TEXT_CHARS,
  applyWorkspaceTabularDelimitedEdit,
  type WorkspaceTabularDelimiter,
  type WorkspaceTabularDelimitedEditOperation
} from '../../../../packages/workers/workspace-tabular/src/index.js'
import {
  updateWorkspaceDeckPptxTextElement
} from '../../../../packages/workers/workspace-deck/src/index.js'
import {
  createPdfAnchor,
  sanitizePdfAnnotationText,
  stablePdfAnnotationSidecar,
  type PdfAnchor,
  type PdfAnnotation,
  type PdfAnnotationKind,
  type PdfAnnotationSidecar,
  type PdfAnnotationThread
} from '../../../shared/pdf-annotations'
import {
  loadPdfAnnotationSidecar,
  savePdfAnnotationSidecar
} from '../pdf-annotation-sidecar-service'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS,
  WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS,
  WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS,
  WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS,
  WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
  extensionFromPreviewPath,
  fileNameFromPreviewPath,
  workspacePreviewAssetTransportDescriptorSchema,
  workspacePreviewByteRangeSchema,
  workspacePreviewEditDiffSummarySchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPluginActionResultSchema,
  workspaceObservationSchema,
  workspacePreviewSessionSchema,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewByteRange,
  type WorkspacePreviewEditDiffSummary,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewExportTarget,
  type WorkspacePreviewPluginActionInput,
  type WorkspacePreviewPluginActionResult,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession
} from '../../../shared/workspace-preview'
import {
  canonicalPath,
  expandHomePath,
  normalizePathSeparators,
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget
} from '../workspace-paths'
import type { WorkspaceFileWatchPayload } from '../../../shared/workspace-file'
import { readWorkspaceFile, writeWorkspaceDocxText, writeWorkspaceFile } from '../workspace-files'
import {
  createWorkspacePreviewRegistry,
  type WorkspacePreviewRegistry,
  type WorkspacePreviewRoute
} from './registry'
import {
  createWorkspacePreviewWorkerClient,
  type WorkspacePreviewWorkerClient
} from './worker-client'

export type WorkspacePreviewOpenInput = {
  path: string
  workspaceRoot: string
  mimeType?: string
  mode?: WorkspacePreviewSession['mode']
  now?: string
}

export type WorkspacePreviewOpenResult =
  | {
      ok: true
      session: WorkspacePreviewSession
      manifest: WorkspacePreviewPluginManifest
      route: Extract<WorkspacePreviewRoute, { status: 'matched' | 'fallback' }>['status']
      file: WorkspacePreviewFileState
    }
  | { ok: false; message: string }

export type WorkspacePreviewObserveResult =
  | {
      ok: true
      observation: WorkspaceObservation
    }
  | { ok: false; message: string }

export type WorkspacePreviewReadRangeResult =
  | {
      ok: true
      sessionId: string
      path: string
      offset: number
      length: number
      size: number
      dataBase64: string
      mimeType?: string
    }
  | { ok: false; message: string }

export type WorkspacePreviewDescribeAssetResult =
  | {
      ok: true
      descriptor: WorkspacePreviewAssetTransportDescriptor
    }
  | { ok: false; message: string }

export type WorkspacePreviewApplyEditResult =
  | {
      ok: true
      session: WorkspacePreviewSession
      operationKind: WorkspacePreviewEditOperation['kind']
      appliedAt: string
      audit: {
        pluginId: string
        path: string
        operationKind: WorkspacePreviewEditOperation['kind']
        effect: 'file-write' | 'session-update' | 'sidecar-write'
      }
      diffSummary?: WorkspacePreviewEditDiffSummary
    }
  | { ok: false; message: string }

export type WorkspacePreviewExportResult =
  | {
      ok: true
      sessionId: string
      path: string
      target: WorkspacePreviewExportTarget
      exportedAt: string
      audit: {
        pluginId: string
        sourcePath: string
        targetKind: WorkspacePreviewExportTarget['kind']
        format: string
        effect: 'source-copy'
      }
    }
  | { ok: false; message: string }

export type WorkspacePreviewInvokeActionResult =
  | WorkspacePreviewPluginActionResult
  | { ok: false; message: string }

export type WorkspacePreviewWatchSnapshot = {
  ok: true
  workspaceRoot: string
  path: string
  content: string
  size: number
  truncated: boolean
  mtimeMs: number
}

export type WorkspacePreviewWatchSnapshotResult =
  | WorkspacePreviewWatchSnapshot
  | { ok: false; message: string }

export type WorkspacePreviewWatchStartResult =
  | (WorkspacePreviewWatchSnapshot & { startedAt: string })
  | { ok: false; message: string }

export type WorkspacePreviewHostOptions = {
  registry?: WorkspacePreviewRegistry
  createSessionId?: () => string
  workerClient?: WorkspacePreviewWorkerClient
}

type WorkspacePreviewSessionRecord = {
  session: WorkspacePreviewSession
  manifest: WorkspacePreviewPluginManifest
  file: WorkspacePreviewFileState
  route: 'matched' | 'fallback'
}

type WorkspacePreviewTabularEditOperation =
  | Extract<WorkspacePreviewEditOperation, { kind: 'tabular.updateCell' }>
  | Extract<WorkspacePreviewEditOperation, { kind: 'tabular.insertRows' }>
  | Extract<WorkspacePreviewEditOperation, { kind: 'tabular.insertColumns' }>
  | Extract<WorkspacePreviewEditOperation, { kind: 'tabular.deleteRows' }>
  | Extract<WorkspacePreviewEditOperation, { kind: 'tabular.deleteColumns' }>

type WorkspacePreviewDeckTextEditOperation =
  Extract<WorkspacePreviewEditOperation, { kind: 'deck.updateTextElement' }>

type WorkspacePreviewDocumentParagraphEditOperation =
  Extract<WorkspacePreviewEditOperation, { kind: 'document.updateParagraph' }>

type WorkspacePreviewAnnotationUpsertOperation =
  Extract<WorkspacePreviewEditOperation, { kind: 'annotation.upsert' }>

const WORKSPACE_PREVIEW_TEXT_OBSERVATION_BYTES = WORKSPACE_PREVIEW_MAX_VISIBLE_TEXT_CHARS

export class WorkspacePreviewHost {
  private readonly registry: WorkspacePreviewRegistry
  private readonly createSessionId: () => string
  private readonly workerClient: WorkspacePreviewWorkerClient
  private readonly sessions = new Map<string, WorkspacePreviewSessionRecord>()

  constructor(options: WorkspacePreviewHostOptions = {}) {
    this.registry = options.registry ?? createWorkspacePreviewRegistry()
    this.createSessionId = options.createSessionId ?? (() => `preview-${randomUUID()}`)
    this.workerClient = options.workerClient ?? createWorkspacePreviewWorkerClient()
  }

  listPlugins(): WorkspacePreviewPluginManifest[] {
    return this.registry.list()
  }

  getSession(sessionId: string): WorkspacePreviewSession | null {
    return this.sessions.get(sessionId)?.session ?? null
  }

  async open(input: WorkspacePreviewOpenInput): Promise<WorkspacePreviewOpenResult> {
    try {
      const targetPath = await resolveOpenTargetPath(input.path, input.workspaceRoot, {
        allowBasenameFallback: false
      })
      const fileInfo = await stat(targetPath)
      if (fileInfo.isDirectory()) {
        return { ok: false, message: 'Cannot preview a directory.' }
      }

      const workspaceRoot = await canonicalPath(expandHomePath(input.workspaceRoot))
      const relativePath = normalizePathSeparators(relative(workspaceRoot, targetPath))
      const route = this.registry.resolve({
        path: targetPath,
        mimeType: input.mimeType,
        fallbackToText: true
      })
      if (route.status === 'unsupported') {
        return { ok: false, message: `No workspace preview plugin is available for ${basename(targetPath)}.` }
      }
      if (route.status === 'deferred') {
        return {
          ok: false,
          message: `Preview support for ${route.extension} is deferred: ${route.reason}`
        }
      }

      const now = input.now ?? new Date().toISOString()
      const file: WorkspacePreviewFileState = {
        workspaceRoot,
        path: targetPath,
        relativePath,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs
      }
      const mode = input.mode ?? 'preview'
      const session: WorkspacePreviewSession = workspacePreviewSessionSchema.parse({
        id: this.createSessionId(),
        pluginId: route.manifest.id,
        workspaceRoot,
        path: targetPath,
        modality: route.manifest.modality,
        mode,
        openedAt: now,
        updatedAt: now,
        mtimeMs: fileInfo.mtimeMs,
        file
      })

      this.sessions.set(session.id, {
        session,
        manifest: route.manifest,
        file,
        route: route.status
      })

      return {
        ok: true,
        session,
        manifest: route.manifest,
        route: route.status,
        file
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async observe(sessionId: string): Promise<WorkspacePreviewObserveResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    if (record.manifest.id === 'text') {
      try {
        return {
          ok: true,
          observation: await this.withHostObservationEnhancements(record, await this.createTextObservation(record))
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }

    const workerObservation = await this.workerClient.observe({
      session: record.session,
      manifest: record.manifest,
      file: record.file
    })
    if (workerObservation.ok) {
      return {
        ok: true,
        observation: await this.withHostObservationEnhancements(record, workerObservation.observation)
      }
    }

    return {
      ok: true,
      observation: await this.withHostObservationEnhancements(record, this.createGenericObservation(record))
    }
  }

  async prepareWatch(
    input: WorkspaceFileWatchPayload,
    now = new Date().toISOString()
  ): Promise<WorkspacePreviewWatchStartResult> {
    const snapshot = await this.createWatchSnapshot(input)
    if (!snapshot.ok) return snapshot
    return {
      ...snapshot,
      startedAt: now
    }
  }

  async createWatchSnapshot(input: WorkspaceFileWatchPayload): Promise<WorkspacePreviewWatchSnapshotResult> {
    try {
      const targetPath = await resolveOpenTargetPath(input.path, input.workspaceRoot, {
        allowBasenameFallback: false
      })
      const fileInfo = await stat(targetPath)
      if (fileInfo.isDirectory()) {
        return { ok: false, message: 'Cannot watch a directory as a workspace preview asset.' }
      }

      const route = this.registry.resolve({
        path: targetPath,
        fallbackToText: true
      })
      if (route.status === 'unsupported') {
        return { ok: false, message: `No workspace preview plugin is available for ${basename(targetPath)}.` }
      }
      if (route.status === 'deferred') {
        return {
          ok: false,
          message: `Preview support for ${route.extension} is deferred: ${route.reason}`
        }
      }

      return {
        ok: true,
        workspaceRoot: await canonicalPath(expandHomePath(input.workspaceRoot)),
        path: targetPath,
        content: '',
        size: fileInfo.size,
        truncated: false,
        mtimeMs: fileInfo.mtimeMs
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private createGenericObservation(record: {
    session: WorkspacePreviewSession
    manifest: WorkspacePreviewPluginManifest
    file: WorkspacePreviewFileState
  }): WorkspaceObservation {
    return workspaceObservationSchema.parse({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: record.file.path,
        workspaceRoot: record.file.workspaceRoot,
        ...(record.file.mimeType ? { mimeType: record.file.mimeType } : {}),
        ...(record.file.size !== undefined ? { size: record.file.size } : {}),
        ...(record.file.mtimeMs !== undefined ? { mtimeMs: record.file.mtimeMs } : {})
      },
      view: {
        pluginId: record.manifest.id,
        modality: record.manifest.modality,
        mode: record.session.mode,
        title: fileNameFromPreviewPath(record.file.relativePath || record.file.path)
      },
      ...(record.session.selection ? { selection: record.session.selection } : {}),
      actions: [
        'observe',
        ...(record.manifest.capabilities.structuredSelection ? ['select'] : []),
        ...(record.manifest.capabilities.edit ? ['applyEdit', 'save'] : []),
        ...(record.manifest.capabilities.export?.length ? ['export'] : [])
      ]
    })
  }

  private async createTextObservation(record: WorkspacePreviewSessionRecord): Promise<WorkspaceObservation> {
    const fileInfo = await stat(record.file.path)
    if (fileInfo.isDirectory()) {
      throw new Error('Cannot observe a directory as text.')
    }

    const length = Math.min(fileInfo.size, WORKSPACE_PREVIEW_TEXT_OBSERVATION_BYTES)
    const buffer = Buffer.alloc(length)
    const handle = await open(record.file.path, 'r')
    let bytesRead = 0
    try {
      const result = await handle.read(buffer, 0, length, 0)
      bytesRead = result.bytesRead
    } finally {
      await handle.close()
    }

    const visibleText = buffer.subarray(0, bytesRead).toString('utf8')
    const truncated = fileInfo.size > bytesRead

    return workspaceObservationSchema.parse({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: record.file.path,
        workspaceRoot: record.file.workspaceRoot,
        ...(record.file.mimeType ? { mimeType: record.file.mimeType } : {}),
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs
      },
      view: {
        pluginId: record.manifest.id,
        modality: 'text',
        mode: record.session.mode,
        title: fileNameFromPreviewPath(record.file.relativePath || record.file.path)
      },
      ...(record.session.selection ? { selection: record.session.selection } : {}),
      visibleText,
      text: {
        lineCount: countTextLines(visibleText),
        characterCount: visibleText.length,
        truncated
      },
      actions: [
        'observe',
        'select',
        'workspace.setSelection',
        'text.replaceRange',
        'applyEdit',
        'save',
        ...(record.manifest.capabilities.export?.length ? ['export'] : [])
      ]
    })
  }

  private async withHostObservationEnhancements(
    record: WorkspacePreviewSessionRecord,
    observation: WorkspaceObservation
  ): Promise<WorkspaceObservation> {
    const withSelection = this.withSessionSelection(record, observation)
    return await this.withSidecarAnnotations(record, withSelection)
  }

  private withSessionSelection(
    record: WorkspacePreviewSessionRecord,
    observation: WorkspaceObservation
  ): WorkspaceObservation {
    if (!record.session.selection) return observation
    return workspaceObservationSchema.parse({
      ...observation,
      selection: record.session.selection
    })
  }

  private async withSidecarAnnotations(
    record: WorkspacePreviewSessionRecord,
    observation: WorkspaceObservation
  ): Promise<WorkspaceObservation> {
    if (!record.manifest.capabilities.annotations || !annotationDocumentKindForPath(record.file.path)) {
      return observation
    }

    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: record.file.path,
      workspaceRoot: record.file.workspaceRoot
    })
    const sidecarAnnotations = loaded.ok
      ? pdfSidecarObservationAnnotations(loaded.sidecar, loaded.warnings)
      : [{
          id: 'annotation-sidecar-warning',
          kind: 'warning',
          summary: clipObservationText(`Annotation sidecar unavailable: ${loaded.message}`)
        }]
    const annotations = mergeObservationAnnotations(observation.annotations, sidecarAnnotations)
    return workspaceObservationSchema.parse({
      ...observation,
      ...(annotations.length ? { annotations } : {}),
      actions: uniqueObservationActions([
        ...observation.actions,
        'annotation.upsert'
      ])
    })
  }

  async readRange(sessionId: string, range: WorkspacePreviewByteRange): Promise<WorkspacePreviewReadRangeResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    try {
      const parsed = workspacePreviewByteRangeSchema.parse(range)
      const fileInfo = await stat(record.file.path)
      if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot read a directory as a preview asset.' }
      const length = Math.min(parsed.length, WORKSPACE_PREVIEW_MAX_RANGE_BYTES)
      const buffer = Buffer.alloc(length)
      const handle = await open(record.file.path, 'r')
      try {
        const { bytesRead } = await handle.read(buffer, 0, length, parsed.offset)
        return {
          ok: true,
          sessionId,
          path: record.file.path,
          offset: parsed.offset,
          length: bytesRead,
          size: fileInfo.size,
          dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
          ...(record.file.mimeType ? { mimeType: record.file.mimeType } : {})
        }
      } finally {
        await handle.close()
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async describeAsset(sessionId: string): Promise<WorkspacePreviewDescribeAssetResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    try {
      const fileInfo = await stat(record.file.path)
      if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot describe a directory as a preview asset.' }
      const file: WorkspacePreviewFileState = {
        ...record.file,
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs
      }
      const descriptor = workspacePreviewAssetTransportDescriptorSchema.parse({
        schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
        sessionId,
        pluginId: record.manifest.id,
        modality: record.manifest.modality,
        file,
        primary: 'byte-range',
        eagerRead: {
          allowed: false,
          reason: 'Workspace preview assets are transported lazily so scientific files do not eager-load into IPC payloads.'
        },
        range: {
          available: true,
          maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
          recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
          size: fileInfo.size
        },
        strategies: buildAssetTransportStrategies(record.manifest),
        ...(fileInfo.size === 0
          ? { warnings: ['The asset is empty; plugins should render an empty-state preview instead of requesting ranges.'] }
          : {})
      })
      this.sessions.set(sessionId, {
        ...record,
        file
      })
      return { ok: true, descriptor }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async applyEdit(
    sessionId: string,
    operation: WorkspacePreviewEditOperation,
    now = new Date().toISOString()
  ): Promise<WorkspacePreviewApplyEditResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    try {
      const parsed = workspacePreviewEditOperationSchema.parse(operation)
      const operationPath = await resolveOpenTargetPath(parsed.path, record.file.workspaceRoot, {
        allowBasenameFallback: false
      })
      const canonicalOperationPath = await canonicalPath(operationPath)
      const canonicalSessionPath = await canonicalPath(record.file.path)
      if (canonicalOperationPath !== canonicalSessionPath) {
        return { ok: false, message: 'Edit operation path must match the open preview session.' }
      }

      if (parsed.kind === 'workspace.setSelection' || parsed.kind === 'molecular.setSelection') {
        const session = workspacePreviewSessionSchema.parse({
          ...record.session,
          selection: parsed.selection,
          updatedAt: now
        })
        this.sessions.set(session.id, { ...record, session })
        return {
          ok: true,
          session,
          operationKind: parsed.kind,
          appliedAt: now,
          audit: {
            pluginId: record.manifest.id,
            path: record.file.path,
            operationKind: parsed.kind,
            effect: 'session-update'
          }
        }
      }

      if (
        parsed.kind === 'tabular.updateCell' ||
        parsed.kind === 'tabular.insertRows' ||
        parsed.kind === 'tabular.insertColumns' ||
        parsed.kind === 'tabular.deleteRows' ||
        parsed.kind === 'tabular.deleteColumns'
      ) {
        return await this.applyTabularDelimitedEdit(record, parsed, now)
      }

      if (parsed.kind === 'deck.updateTextElement') {
        return await this.applyDeckPptxTextElementEdit(record, parsed, now)
      }

      if (parsed.kind === 'document.updateParagraph') {
        return await this.applyDocumentParagraphEdit(record, parsed, now)
      }

      if (parsed.kind === 'annotation.upsert') {
        return await this.applyAnnotationUpsert(record, parsed, now)
      }

      if (parsed.kind !== 'text.replaceRange') {
        return {
          ok: false,
          message: `Workspace preview edit operation ${operation.kind} is not implemented by the generic host yet.`
        }
      }

      const content = await readFile(record.file.path, 'utf8')
      const startOffset = offsetForTextPosition(content, parsed.range.start)
      const endOffset = offsetForTextPosition(content, parsed.range.end)
      if (endOffset < startOffset) {
        return { ok: false, message: 'Edit range end must be after the start.' }
      }
      const nextContent = `${content.slice(0, startOffset)}${parsed.text}${content.slice(endOffset)}`
      const diffSummary = createTextEditDiffSummary({
        path: record.file.path,
        operation: parsed,
        content,
        nextContent,
        startOffset,
        endOffset
      })
      const writeResult = await writeWorkspaceFile({
        workspaceRoot: record.file.workspaceRoot,
        path: record.file.path,
        content: nextContent
      })
      if (!writeResult.ok) return writeResult

      return await this.completeFileWriteEdit(record, parsed.kind, now, diffSummary)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async applyTabularDelimitedEdit(
    record: WorkspacePreviewSessionRecord,
    operation: WorkspacePreviewTabularEditOperation,
    now: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (record.manifest.id !== 'tabular') {
      return { ok: false, message: `Workspace preview edit operation ${operation.kind} requires the tabular plugin.` }
    }
    const delimiter = tabularDelimiterForPath(record.file.path)
    if (!delimiter) {
      return { ok: false, message: 'Tabular file write-back is currently implemented for CSV and TSV files only.' }
    }

    const content = await readFile(record.file.path, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > WORKSPACE_TABULAR_MAX_TEXT_CHARS) {
      return {
        ok: false,
        message: `Tabular file is too large for safe write-back; maximum editable size is ${WORKSPACE_TABULAR_MAX_TEXT_CHARS} bytes.`
      }
    }

    const editResult = applyWorkspaceTabularDelimitedEdit({
      text: content,
      delimiter,
      operation: tabularDelimitedEditOperation(operation)
    })
    const diffSummary = createTabularEditDiffSummary({
      path: record.file.path,
      operation,
      content,
      nextContent: editResult.text
    })
    const writeResult = await writeWorkspaceFile({
      workspaceRoot: record.file.workspaceRoot,
      path: record.file.path,
      content: editResult.text
    })
    if (!writeResult.ok) return writeResult

    return await this.completeFileWriteEdit(record, operation.kind, now, diffSummary)
  }

  private async applyDeckPptxTextElementEdit(
    record: WorkspacePreviewSessionRecord,
    operation: WorkspacePreviewDeckTextEditOperation,
    now: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (record.manifest.id !== 'deck') {
      return { ok: false, message: `Workspace preview edit operation ${operation.kind} requires the deck plugin.` }
    }
    if (extensionFromPreviewPath(record.file.path) !== '.pptx') {
      return { ok: false, message: 'Deck text write-back is currently implemented for PPTX OpenXML files only.' }
    }

    const bytes = await readFile(record.file.path)
    const editResult = await updateWorkspaceDeckPptxTextElement({
      bytes,
      slideId: operation.slideId,
      elementId: operation.elementId,
      text: operation.text
    })
    const diffSummary = createDeckTextElementEditDiffSummary({
      path: record.file.path,
      operation,
      beforeText: editResult.beforeText,
      nextByteLength: editResult.bytes.byteLength,
      previousByteLength: bytes.byteLength
    })
    const writeResult = await writeWorkspaceFile({
      workspaceRoot: record.file.workspaceRoot,
      path: record.file.path,
      contentBase64: Buffer.from(editResult.bytes).toString('base64')
    })
    if (!writeResult.ok) return writeResult

    return await this.completeFileWriteEdit(record, operation.kind, now, diffSummary)
  }

  private async applyDocumentParagraphEdit(
    record: WorkspacePreviewSessionRecord,
    operation: WorkspacePreviewDocumentParagraphEditOperation,
    now: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (extensionFromPreviewPath(record.file.path) !== '.docx') {
      return { ok: false, message: 'Document paragraph write-back is currently implemented for DOCX files only.' }
    }

    const before = await readWorkspaceFile({
      workspaceRoot: record.file.workspaceRoot,
      path: record.file.path
    })
    if (!before.ok) return before
    if (before.kind !== 'docx') {
      return { ok: false, message: 'Document paragraph write-back requires a DOCX preview result.' }
    }

    const paragraph = before.paragraphs.find((candidate) => candidate.index === operation.paragraphIndex)
    if (!paragraph) {
      return { ok: false, message: `DOCX paragraph ${operation.paragraphIndex} was not found.` }
    }

    const writeResult = await writeWorkspaceDocxText({
      workspaceRoot: record.file.workspaceRoot,
      path: record.file.path,
      paragraphs: [{
        index: operation.paragraphIndex,
        text: operation.text
      }]
    })
    if (!writeResult.ok) return writeResult

    const diffSummary = createDocumentParagraphEditDiffSummary({
      path: record.file.path,
      operation,
      beforeText: paragraph.text
    })
    return await this.completeFileWriteEdit(record, operation.kind, now, diffSummary)
  }

  private async applyAnnotationUpsert(
    record: WorkspacePreviewSessionRecord,
    operation: WorkspacePreviewAnnotationUpsertOperation,
    now: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (!record.manifest.capabilities.annotations) {
      return { ok: false, message: `Workspace preview edit operation ${operation.kind} requires annotation support.` }
    }

    const documentKind = annotationDocumentKindForPath(record.file.path)
    if (!documentKind) {
      return { ok: false, message: 'Annotation sidecar write-back is currently implemented for PDF and DOCX files only.' }
    }
    if (operation.target?.documentKind && operation.target.documentKind !== documentKind) {
      return {
        ok: false,
        message: `Annotation target documentKind ${operation.target.documentKind} does not match the open ${documentKind} document.`
      }
    }

    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: record.file.path,
      workspaceRoot: record.file.workspaceRoot
    })
    if (!loaded.ok) return loaded

    const upsert = upsertPdfAnnotationSidecar({
      sidecar: loaded.sidecar,
      operation,
      documentKind,
      now
    })
    const saveResult = await savePdfAnnotationSidecar({
      pdfPath: record.file.path,
      workspaceRoot: record.file.workspaceRoot,
      sidecar: upsert.sidecar
    })
    if (!saveResult.ok) return saveResult

    const diffSummary = createAnnotationUpsertDiffSummary({
      path: record.file.path,
      operation,
      beforeBody: upsert.beforeBody,
      created: upsert.created
    })
    return await this.completeSidecarWriteEdit(record, operation.kind, now, diffSummary)
  }

  private async completeFileWriteEdit(
    record: WorkspacePreviewSessionRecord,
    operationKind: WorkspacePreviewEditOperation['kind'],
    now: string,
    diffSummary?: WorkspacePreviewEditDiffSummary
  ): Promise<WorkspacePreviewApplyEditResult> {
    const fileInfo = await stat(record.file.path)
    const file: WorkspacePreviewFileState = {
      ...record.file,
      size: fileInfo.size,
      mtimeMs: fileInfo.mtimeMs
    }
    const session = workspacePreviewSessionSchema.parse({
      ...record.session,
      updatedAt: now,
      mtimeMs: fileInfo.mtimeMs,
      file
    })
    this.sessions.set(session.id, {
      ...record,
      session,
      file
    })

    return {
      ok: true,
      session,
      operationKind,
      appliedAt: now,
      audit: {
        pluginId: record.manifest.id,
        path: record.file.path,
        operationKind,
        effect: 'file-write'
      },
      ...(diffSummary ? { diffSummary } : {})
    }
  }

  private async completeSidecarWriteEdit(
    record: WorkspacePreviewSessionRecord,
    operationKind: WorkspacePreviewEditOperation['kind'],
    now: string,
    diffSummary?: WorkspacePreviewEditDiffSummary
  ): Promise<WorkspacePreviewApplyEditResult> {
    const fileInfo = await stat(record.file.path)
    const file: WorkspacePreviewFileState = {
      ...record.file,
      size: fileInfo.size,
      mtimeMs: fileInfo.mtimeMs
    }
    const session = workspacePreviewSessionSchema.parse({
      ...record.session,
      updatedAt: now,
      mtimeMs: fileInfo.mtimeMs,
      file
    })
    this.sessions.set(session.id, {
      ...record,
      session,
      file
    })

    return {
      ok: true,
      session,
      operationKind,
      appliedAt: now,
      audit: {
        pluginId: record.manifest.id,
        path: record.file.path,
        operationKind,
        effect: 'sidecar-write'
      },
      ...(diffSummary ? { diffSummary } : {})
    }
  }

  async exportPreview(
    sessionId: string,
    target: WorkspacePreviewExportTarget,
    now = new Date().toISOString()
  ): Promise<WorkspacePreviewExportResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    try {
      const parsed = workspacePreviewExportTargetSchema.parse(target)
      const supportedFormats = new Set(record.manifest.capabilities.export ?? [])
      if (!supportedFormats.has(parsed.format)) {
        return {
          ok: false,
          message: `Workspace preview plugin ${record.manifest.id} does not declare ${parsed.format} export support.`
        }
      }
      if (parsed.kind !== 'workspace-file') {
        return {
          ok: false,
          message: `Workspace preview ${parsed.kind} export requires a renderer/plugin implementation.`
        }
      }
      if (!sourceFormatMatchesExportFormat(record.file.path, parsed.format)) {
        return {
          ok: false,
          message: `Generic workspace-file export can only copy the source ${sourceFormatLabel(record.file.path)} file; ${parsed.format} export requires a plugin implementation.`
        }
      }

      const writeTarget = parsed.path?.trim()
        ? await resolveSafeWorkspaceWriteTarget(parsed.path, record.file.workspaceRoot, {
            createParentDirectories: true,
            targetKind: 'file'
          })
        : await resolveDefaultExportWriteTarget(record, parsed.format)
      await copyFile(record.file.path, writeTarget.path, constants.COPYFILE_EXCL)

      return {
        ok: true,
        sessionId,
        path: writeTarget.path,
        target: parsed,
        exportedAt: now,
        audit: {
          pluginId: record.manifest.id,
          sourcePath: record.file.path,
          targetKind: parsed.kind,
          format: parsed.format,
          effect: 'source-copy'
        }
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async invokeAction(
    sessionId: string,
    action: WorkspacePreviewPluginActionInput,
    now = new Date().toISOString()
  ): Promise<WorkspacePreviewInvokeActionResult> {
    const record = this.sessions.get(sessionId)
    if (!record) return { ok: false, message: 'Workspace preview session was not found.' }

    try {
      const parsed = workspacePreviewPluginActionInputSchema.parse(action)
      const workerResult = await this.workerClient.invokeAction({
        session: record.session,
        manifest: record.manifest,
        file: record.file,
        action: parsed
      })
      if (!workerResult.ok) {
        return { ok: false, message: workerResult.message }
      }

      return workspacePreviewPluginActionResultSchema.parse({
        ok: true,
        sessionId,
        pluginId: record.manifest.id,
        actionId: parsed.actionId,
        invokedAt: now,
        result: workerResult.result,
        audit: {
          pluginId: record.manifest.id,
          path: record.file.path,
          actionId: parsed.actionId,
          effect: 'worker-action'
        }
      })
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

function buildAssetTransportStrategies(
  manifest: WorkspacePreviewPluginManifest
): WorkspacePreviewAssetTransportDescriptor['strategies'] {
  const rangeReason = manifest.modality === 'bioimaging'
    ? 'Use bounded byte ranges for metadata and plugin-owned tile decoders; raw whole-slide payloads stay out of IPC.'
    : 'Use bounded byte ranges for lazy plugin reads; host open and observe avoid eager-loading full asset bytes.'

  return [
    {
      kind: 'byte-range',
      status: 'available',
      reason: rangeReason,
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES
    },
    {
      kind: 'object-url',
      status: 'requires-renderer',
      reason: 'Renderer plugins may compose object URLs from bounded ranges or cache artifacts when a browser decoder needs a URL.'
    },
    {
      kind: 'tile',
      status: 'requires-plugin',
      reason: 'Tile transport requires a format-specific decoder, for example OME-TIFF pyramids or density-map tiles.'
    },
    {
      kind: 'thumbnail',
      status: 'requires-plugin',
      reason: 'Thumbnail transport requires a format-specific renderer or cached preview artifact.'
    },
    {
      kind: 'cache-artifact',
      status: 'deferred',
      reason: 'Persistent cache artifacts are reserved for worker-generated derivatives after the plugin declares invalidation rules.'
    }
  ]
}

function tabularDelimiterForPath(path: string): WorkspaceTabularDelimiter | null {
  const extension = extensionFromPreviewPath(path)
  if (extension === '.csv') return ','
  if (extension === '.tsv') return '\t'
  return null
}

function tabularDelimitedEditOperation(
  operation: WorkspacePreviewTabularEditOperation
): WorkspaceTabularDelimitedEditOperation {
  if (operation.kind === 'tabular.updateCell') {
    return {
      kind: 'updateCell',
      row: operation.row,
      column: operation.column,
      value: operation.value
    }
  }
  if (operation.kind === 'tabular.insertRows') {
    return {
      kind: 'insertRows',
      afterRow: operation.afterRow,
      rows: operation.rows
    }
  }
  if (operation.kind === 'tabular.insertColumns') {
    return {
      kind: 'insertColumns',
      afterColumn: operation.afterColumn,
      columns: operation.columns
    }
  }
  if (operation.kind === 'tabular.deleteRows') {
    return {
      kind: 'deleteRows',
      rows: operation.rows
    }
  }
  return {
    kind: 'deleteColumns',
    columns: operation.columns
  }
}

function createTextEditDiffSummary(input: {
  path: string
  operation: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>
  content: string
  nextContent: string
  startOffset: number
  endOffset: number
}): WorkspacePreviewEditDiffSummary {
  const before = input.content.slice(input.startOffset, input.endOffset)
  const after = input.operation.text
  const beforePreview = boundedDiffText(before)
  const afterPreview = boundedDiffText(after)
  return parseEditDiffSummary({
    summary: `Replaced text range ${formatTextRange(input.operation.range)} with ${formatCount(after.length, 'character')}.`,
    operationKind: input.operation.kind,
    target: {
      path: input.path,
      textRange: input.operation.range
    },
    counts: {
      filesChanged: 1,
      bytesDelta: Buffer.byteLength(input.nextContent, 'utf8') - Buffer.byteLength(input.content, 'utf8'),
      charsInserted: after.length,
      charsDeleted: before.length
    },
    previews: [{
      label: 'Text range',
      before: beforePreview.text,
      after: afterPreview.text,
      truncated: beforePreview.truncated || afterPreview.truncated
    }],
    truncated: beforePreview.truncated || afterPreview.truncated
  })
}

function createDeckTextElementEditDiffSummary(input: {
  path: string
  operation: WorkspacePreviewDeckTextEditOperation
  beforeText: string
  previousByteLength: number
  nextByteLength: number
}): WorkspacePreviewEditDiffSummary {
  const beforePreview = boundedDiffText(input.beforeText)
  const afterPreview = boundedDiffText(input.operation.text)
  return parseEditDiffSummary({
    summary: `Updated deck text element ${input.operation.elementId} on slide ${input.operation.slideId}.`,
    operationKind: input.operation.kind,
    target: {
      path: input.path
    },
    counts: {
      filesChanged: 1,
      bytesDelta: input.nextByteLength - input.previousByteLength,
      charsInserted: input.operation.text.length,
      charsDeleted: input.beforeText.length
    },
    previews: [{
      label: 'Deck text element',
      before: beforePreview.text,
      after: afterPreview.text,
      truncated: beforePreview.truncated || afterPreview.truncated
    }],
    truncated: beforePreview.truncated || afterPreview.truncated
  })
}

function createDocumentParagraphEditDiffSummary(input: {
  path: string
  operation: WorkspacePreviewDocumentParagraphEditOperation
  beforeText: string
}): WorkspacePreviewEditDiffSummary {
  const beforePreview = boundedDiffText(input.beforeText)
  const afterPreview = boundedDiffText(input.operation.text)
  return parseEditDiffSummary({
    summary: `Updated DOCX paragraph ${input.operation.paragraphIndex}.`,
    operationKind: input.operation.kind,
    target: {
      path: input.path
    },
    counts: {
      filesChanged: 1,
      charsInserted: input.operation.text.length,
      charsDeleted: input.beforeText.length
    },
    previews: [{
      label: `DOCX paragraph ${input.operation.paragraphIndex}`,
      before: beforePreview.text,
      after: afterPreview.text,
      truncated: beforePreview.truncated || afterPreview.truncated
    }],
    truncated: beforePreview.truncated || afterPreview.truncated
  })
}

function pdfSidecarObservationAnnotations(
  sidecar: PdfAnnotationSidecar,
  warnings: readonly string[] = []
): NonNullable<WorkspaceObservation['annotations']> {
  const annotations: NonNullable<WorkspaceObservation['annotations']> = sidecar.threads
    .slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    .map((thread) => ({
      id: thread.id,
      kind: thread.kind,
      ...annotationSummaryProperty(pdfAnnotationThreadObservationSummary(sidecar, thread))
    }))
  for (const warning of warnings) {
    annotations.push({
      id: `annotation-sidecar-warning-${annotations.length + 1}`,
      kind: 'warning',
      summary: clipObservationText(warning)
    })
    if (annotations.length >= WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) break
  }
  return annotations
}

function clipObservationText(value: string, maxChars = 1000): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
}

function pdfAnnotationThreadObservationSummary(
  sidecar: PdfAnnotationSidecar,
  thread: PdfAnnotationThread
): string {
  const anchors = sidecar.anchors.filter((anchor) => thread.anchorIds.includes(anchor.id))
  const threadAnnotations = sidecar.annotations
    .filter((annotation) => annotation.threadId === thread.id || thread.annotationIds.includes(annotation.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const quote = anchors
    .map((anchor) => anchor.quote)
    .find((value) => value.trim())
  const preview = threadAnnotations
    .map((annotation) => annotation.body || annotation.sourceText || '')
    .find((value) => value.trim())
  return [
    thread.status,
    pdfAnchorPageRangeSummary(anchors),
    thread.title,
    preview || quote
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => clipObservationText(part, 260))
    .join(' | ')
}

function pdfAnchorPageRangeSummary(anchors: readonly PdfAnchor[]): string {
  const pages = anchors
    .flatMap((anchor) => [anchor.pageStart, anchor.pageEnd])
    .filter((page) => Number.isFinite(page) && page > 0)
  if (!pages.length) return ''
  const start = Math.min(...pages)
  const end = Math.max(...pages)
  return start === end ? `page ${start}` : `pages ${start}-${end}`
}

function annotationSummaryProperty(summary: string): Pick<NonNullable<WorkspaceObservation['annotations']>[number], 'summary'> | Record<string, never> {
  const clipped = clipObservationText(summary)
  return clipped ? { summary: clipped } : {}
}

function mergeObservationAnnotations(
  existing: WorkspaceObservation['annotations'],
  next: WorkspaceObservation['annotations']
): NonNullable<WorkspaceObservation['annotations']> {
  const merged: NonNullable<WorkspaceObservation['annotations']> = []
  const seen = new Set<string>()
  for (const annotation of [...(existing ?? []), ...(next ?? [])]) {
    const key = `${annotation.id}\n${annotation.kind}\n${annotation.summary ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(annotation)
    if (merged.length >= WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) break
  }
  return merged
}

function uniqueObservationActions(actions: readonly string[]): string[] {
  return [...new Set(actions.map((action) => action.trim()).filter(Boolean))].slice(0, 256)
}

function createAnnotationUpsertDiffSummary(input: {
  path: string
  operation: WorkspacePreviewAnnotationUpsertOperation
  beforeBody: string
  created: boolean
}): WorkspacePreviewEditDiffSummary {
  const beforePreview = boundedDiffText(input.beforeBody)
  const afterPreview = boundedDiffText(input.operation.body)
  return parseEditDiffSummary({
    summary: `${input.created ? 'Created' : 'Updated'} ${input.operation.annotationKind} annotation ${input.operation.annotationId}.`,
    operationKind: input.operation.kind,
    target: {
      path: input.path
    },
    counts: {
      filesChanged: 1,
      charsInserted: input.operation.body.length,
      charsDeleted: input.beforeBody.length
    },
    previews: [{
      label: `Annotation ${input.operation.annotationId}`,
      before: beforePreview.text,
      after: afterPreview.text,
      truncated: beforePreview.truncated || afterPreview.truncated
    }],
    truncated: beforePreview.truncated || afterPreview.truncated
  })
}

type AnnotationDocumentKind = 'pdf' | 'docx'
type AnnotationUpsertTarget = NonNullable<WorkspacePreviewAnnotationUpsertOperation['target']>
type AnnotationUpsertAnchorTarget = NonNullable<AnnotationUpsertTarget['anchor']>
type AnnotationUpsertThreadTarget = NonNullable<AnnotationUpsertTarget['thread']>
type AnnotationUpsertAnnotationTarget = NonNullable<AnnotationUpsertTarget['annotation']>

function annotationDocumentKindForPath(path: string): AnnotationDocumentKind | null {
  const extension = extensionFromPreviewPath(path)
  if (extension === '.pdf') return 'pdf'
  if (extension === '.docx') return 'docx'
  return null
}

function upsertPdfAnnotationSidecar(input: {
  sidecar: PdfAnnotationSidecar
  operation: WorkspacePreviewAnnotationUpsertOperation
  documentKind: AnnotationDocumentKind
  now: string
}): { sidecar: PdfAnnotationSidecar; beforeBody: string; created: boolean } {
  const existingAnnotation = input.sidecar.annotations.find((annotation) => annotation.id === input.operation.annotationId)
  if (existingAnnotation) {
    return updateExistingPdfAnnotationSidecar({
      ...input,
      existingAnnotation
    })
  }
  return createPdfAnnotationSidecarEntry(input)
}

function createPdfAnnotationSidecarEntry(input: {
  sidecar: PdfAnnotationSidecar
  operation: WorkspacePreviewAnnotationUpsertOperation
  documentKind: AnnotationDocumentKind
  now: string
}): { sidecar: PdfAnnotationSidecar; beforeBody: string; created: true } {
  const target = input.operation.target
  if (!target?.threadId) {
    throw new Error('annotation.upsert target.threadId is required when creating a new annotation.')
  }
  if (!target.anchor) {
    throw new Error('annotation.upsert target.anchor is required when creating a new annotation.')
  }

  const { anchor, anchors } = upsertPdfAnnotationAnchor({
    sidecar: input.sidecar,
    target: target.anchor,
    documentKind: input.documentKind,
    now: input.now
  })
  const annotation: PdfAnnotation = createPdfAnnotationRecord({
    operation: input.operation,
    threadId: target.threadId,
    anchor,
    now: input.now
  })
  const threads = upsertPdfAnnotationThread({
    threads: input.sidecar.threads,
    threadId: target.threadId,
    annotationId: annotation.id,
    anchorId: anchor.id,
    kind: input.operation.annotationKind as PdfAnnotationKind,
    target: target.thread,
    now: input.now
  })

  return {
    sidecar: commitPdfAnnotationSidecar(input.sidecar, {
      anchors,
      annotations: [...input.sidecar.annotations, annotation],
      threads
    }, input.now),
    beforeBody: '',
    created: true
  }
}

function updateExistingPdfAnnotationSidecar(input: {
  sidecar: PdfAnnotationSidecar
  operation: WorkspacePreviewAnnotationUpsertOperation
  documentKind: AnnotationDocumentKind
  now: string
  existingAnnotation: PdfAnnotation
}): { sidecar: PdfAnnotationSidecar; beforeBody: string; created: false } {
  const target = input.operation.target
  if (target?.threadId && target.threadId !== input.existingAnnotation.threadId) {
    throw new Error('annotation.upsert cannot move an existing annotation to a different thread.')
  }
  let anchors = input.sidecar.anchors
  if (target?.anchor) {
    if (target.anchor.id !== input.existingAnnotation.anchorId) {
      throw new Error('annotation.upsert cannot move an existing annotation to a different anchor.')
    }
    anchors = upsertPdfAnnotationAnchor({
      sidecar: { ...input.sidecar, anchors },
      target: target.anchor,
      documentKind: input.documentKind,
      now: input.now
    }).anchors
  }

  const annotations = input.sidecar.annotations.map((annotation) =>
    annotation.id === input.existingAnnotation.id
      ? applyPdfAnnotationUpdate(annotation, input.operation, input.now)
      : annotation
  )
  let foundThread = false
  const threads = input.sidecar.threads.map((thread) => {
    if (thread.id !== input.existingAnnotation.threadId) return thread
    foundThread = true
    return applyPdfAnnotationThreadTarget({
      ...thread,
      anchorIds: sortedUniqueStrings([...thread.anchorIds, input.existingAnnotation.anchorId]),
      annotationIds: sortedUniqueStrings([...thread.annotationIds, input.existingAnnotation.id]),
      updatedAt: input.now
    }, target?.thread)
  })
  if (!foundThread) {
    throw new Error(`PDF annotation thread not found: ${input.existingAnnotation.threadId}.`)
  }

  return {
    sidecar: commitPdfAnnotationSidecar(input.sidecar, { anchors, annotations, threads }, input.now),
    beforeBody: input.existingAnnotation.body,
    created: false
  }
}

function upsertPdfAnnotationAnchor(input: {
  sidecar: PdfAnnotationSidecar
  target: AnnotationUpsertAnchorTarget
  documentKind: AnnotationDocumentKind
  now: string
}): { anchor: PdfAnchor; anchors: PdfAnchor[] } {
  const existing = input.sidecar.anchors.find((anchor) => anchor.id === input.target.id)
  const rects = input.target.rects ?? existing?.rects ?? []
  const quote = input.target.quote ?? existing?.quote ?? ''
  if (!existing && input.documentKind === 'docx' && !quote.trim()) {
    throw new Error('DOCX annotation targets require a non-empty anchor quote.')
  }
  if (!existing && input.documentKind === 'pdf' && rects.length === 0 && !quote.trim() && input.target.pageStart == null) {
    throw new Error('PDF annotation targets require rects, a quote, or a pageStart.')
  }

  const createdAt = existing?.createdAt ?? input.now
  const anchor = createPdfAnchor({
    id: input.target.id,
    kind: input.target.kind ?? existing?.kind,
    rects,
    quote,
    contextBefore: input.target.contextBefore ?? existing?.contextBefore ?? '',
    contextAfter: input.target.contextAfter ?? existing?.contextAfter ?? '',
    pdfFingerprint: input.sidecar.pdfFingerprint,
    createdAt,
    updatedAt: input.now
  })
  const pageStart = input.target.pageStart ?? existing?.pageStart ?? anchor.pageStart
  const pageEnd = input.target.pageEnd ?? (input.target.pageStart != null ? input.target.pageStart : existing?.pageEnd ?? anchor.pageEnd)
  if (pageEnd < pageStart) {
    throw new Error('Annotation anchor pageEnd must be greater than or equal to pageStart.')
  }
  const nextAnchor: PdfAnchor = {
    ...anchor,
    pageStart,
    pageEnd,
    pdfFingerprint: input.sidecar.pdfFingerprint
  }
  const anchors = existing
    ? input.sidecar.anchors.map((candidate) => candidate.id === nextAnchor.id ? nextAnchor : candidate)
    : [...input.sidecar.anchors, nextAnchor]
  return { anchor: nextAnchor, anchors }
}

function createPdfAnnotationRecord(input: {
  operation: WorkspacePreviewAnnotationUpsertOperation
  threadId: string
  anchor: PdfAnchor
  now: string
}): PdfAnnotation {
  const annotation: PdfAnnotation = {
    id: input.operation.annotationId,
    threadId: input.threadId,
    anchorId: input.anchor.id,
    kind: input.operation.annotationKind as PdfAnnotationKind,
    body: sanitizePdfAnnotationText(input.operation.body),
    createdAt: input.now,
    updatedAt: input.now
  }
  applyPdfAnnotationMetadata(annotation, input.operation.target?.annotation, input.anchor.quote)
  return annotation
}

function applyPdfAnnotationUpdate(
  annotation: PdfAnnotation,
  operation: WorkspacePreviewAnnotationUpsertOperation,
  now: string
): PdfAnnotation {
  const next: PdfAnnotation = {
    ...annotation,
    kind: operation.annotationKind as PdfAnnotationKind,
    body: sanitizePdfAnnotationText(operation.body),
    updatedAt: now
  }
  applyPdfAnnotationMetadata(next, operation.target?.annotation)
  return next
}

function applyPdfAnnotationMetadata(
  annotation: PdfAnnotation,
  target: AnnotationUpsertAnnotationTarget | undefined,
  fallbackSourceText?: string
): void {
  if (!target) {
    const sourceText = cleanAnnotationText(fallbackSourceText, WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
    if (sourceText) annotation.sourceText = sourceText
    return
  }
  applyOptionalAnnotationField(annotation, 'authorId', target.authorId)
  applyOptionalAnnotationField(annotation, 'color', target.color)
  applyOptionalAnnotationField(annotation, 'targetLanguage', target.targetLanguage)
  if (Object.prototype.hasOwnProperty.call(target, 'sourceText')) {
    applyOptionalAnnotationField(annotation, 'sourceText', target.sourceText, WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
  } else {
    const sourceText = cleanAnnotationText(fallbackSourceText, WORKSPACE_PREVIEW_MAX_ANNOTATION_TEXT_CHARS)
    if (sourceText && !annotation.sourceText) annotation.sourceText = sourceText
  }
  applyOptionalAnnotationField(annotation, 'sourceMessageId', target.sourceMessageId)
}

function applyOptionalAnnotationField<TKey extends keyof Pick<
  PdfAnnotation,
  'authorId' | 'color' | 'targetLanguage' | 'sourceText' | 'sourceMessageId'
>>(
  annotation: PdfAnnotation,
  key: TKey,
  value: string | undefined,
  maxChars = WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS
): void {
  if (value === undefined) return
  const cleaned = cleanAnnotationText(value, maxChars)
  if (cleaned) annotation[key] = cleaned
  else delete annotation[key]
}

function upsertPdfAnnotationThread(input: {
  threads: PdfAnnotationThread[]
  threadId: string
  annotationId: string
  anchorId: string
  kind: PdfAnnotationKind
  target: AnnotationUpsertThreadTarget | undefined
  now: string
}): PdfAnnotationThread[] {
  const existing = input.threads.find((thread) => thread.id === input.threadId)
  if (!existing) {
    return [
      ...input.threads,
      applyPdfAnnotationThreadTarget({
        id: input.threadId,
        kind: input.kind,
        anchorIds: [input.anchorId],
        annotationIds: [input.annotationId],
        status: input.target?.status ?? 'open',
        createdAt: input.now,
        updatedAt: input.now
      }, input.target)
    ]
  }

  return input.threads.map((thread) =>
    thread.id === input.threadId
      ? applyPdfAnnotationThreadTarget({
          ...thread,
          anchorIds: sortedUniqueStrings([...thread.anchorIds, input.anchorId]),
          annotationIds: sortedUniqueStrings([...thread.annotationIds, input.annotationId]),
          updatedAt: input.now
        }, input.target)
      : thread
  )
}

function applyPdfAnnotationThreadTarget(
  thread: PdfAnnotationThread,
  target: AnnotationUpsertThreadTarget | undefined
): PdfAnnotationThread {
  if (!target) return thread
  const next: PdfAnnotationThread = {
    ...thread,
    status: target.status ?? thread.status
  }
  applyOptionalThreadField(next, 'title', target.title)
  applyOptionalThreadField(next, 'authorId', target.authorId)
  applyOptionalThreadField(next, 'sourceQuoteId', target.sourceQuoteId)
  applyOptionalThreadField(next, 'sourceMessageId', target.sourceMessageId)
  return next
}

function applyOptionalThreadField<TKey extends keyof Pick<
  PdfAnnotationThread,
  'title' | 'authorId' | 'sourceQuoteId' | 'sourceMessageId'
>>(
  thread: PdfAnnotationThread,
  key: TKey,
  value: string | undefined
): void {
  if (value === undefined) return
  const cleaned = key === 'title'
    ? cleanAnnotationText(value, 512)
    : cleanAnnotationText(value)
  if (cleaned) thread[key] = cleaned
  else delete thread[key]
}

function commitPdfAnnotationSidecar(
  sidecar: PdfAnnotationSidecar,
  changes: Partial<Pick<PdfAnnotationSidecar, 'anchors' | 'annotations' | 'threads'>>,
  updatedAt: string
): PdfAnnotationSidecar {
  return stablePdfAnnotationSidecar({
    ...sidecar,
    ...changes,
    manifest: {
      ...sidecar.manifest,
      updatedAt
    },
    updatedAt
  })
}

function cleanAnnotationText(
  value: string | undefined,
  maxChars = WORKSPACE_PREVIEW_MAX_ANNOTATION_CONTEXT_CHARS
): string | undefined {
  if (value === undefined) return undefined
  const cleaned = sanitizePdfAnnotationText(value, maxChars)
  return cleaned || undefined
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
}

async function resolveDefaultExportWriteTarget(
  record: WorkspacePreviewSessionRecord,
  format: string
): Promise<{ path: string; parentPath: string; workspaceRoot: string }> {
  const normalizedFormat = format.replace(/^\./, '').trim().toLowerCase() || 'export'
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = defaultExportRelativePath(record.file, normalizedFormat, attempt)
    const writeTarget = await resolveSafeWorkspaceWriteTarget(candidate, record.file.workspaceRoot, {
      createParentDirectories: true,
      targetKind: 'file'
    })
    if (!(await fileExists(writeTarget.path))) return writeTarget
  }
  throw new Error('Could not find an available default workspace export path after 100 attempts.')
}

function defaultExportRelativePath(
  file: WorkspacePreviewFileState,
  format: string,
  attempt: number
): string {
  const relativeSourcePath = file.relativePath || basename(file.path)
  const normalizedPath = normalizePathSeparators(relativeSourcePath).replace(/^\/+/, '')
  const slashIndex = normalizedPath.lastIndexOf('/')
  const directory = slashIndex >= 0 ? `${normalizedPath.slice(0, slashIndex)}/` : ''
  const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath
  const extension = extensionFromPreviewPath(fileName)
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName
  const suffix = attempt === 0 ? '' : `-${attempt + 1}`
  return `${directory}${baseName || 'export'}.export${suffix}.${format}`
}

function sourceFormatMatchesExportFormat(path: string, format: string): boolean {
  return sourceFormatLabel(path) === format.replace(/^\./, '').trim().toLowerCase()
}

function sourceFormatLabel(path: string): string {
  return extensionFromPreviewPath(path).replace(/^\./, '').trim().toLowerCase() || 'unknown'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function createTabularEditDiffSummary(input: {
  path: string
  operation: WorkspacePreviewTabularEditOperation
  content: string
  nextContent: string
}): WorkspacePreviewEditDiffSummary {
  const bytesDelta = Buffer.byteLength(input.nextContent, 'utf8') - Buffer.byteLength(input.content, 'utf8')
  const baseCounts = { filesChanged: 1 as const, bytesDelta }
  if (input.operation.kind === 'tabular.updateCell') {
    const valuePreview = boundedDiffText(tabularPreviewValue(input.operation.value))
    return parseEditDiffSummary({
      summary: `Updated cell R${input.operation.row}C${input.operation.column}.`,
      operationKind: input.operation.kind,
      target: {
        path: input.path,
        tabular: {
          cells: [{ row: input.operation.row, column: input.operation.column }]
        }
      },
      counts: {
        ...baseCounts,
        cellsChanged: 1
      },
      previews: [{
        label: `R${input.operation.row}C${input.operation.column}`,
        after: valuePreview.text,
        truncated: valuePreview.truncated
      }],
      truncated: valuePreview.truncated
    })
  }

  if (input.operation.kind === 'tabular.insertRows') {
    const operation = input.operation
    const previews = boundedPreviewList(operation.rows, (row, index) => {
      const rowIndex = operation.afterRow + 1 + index
      const preview = boundedDiffText(row.map(tabularPreviewValue).join('\t'))
      return {
        label: `Inserted row ${rowIndex}`,
        after: preview.text,
        truncated: preview.truncated
      }
    })
    return parseEditDiffSummary({
      summary: `Inserted ${formatCount(operation.rows.length, 'row')} after row ${operation.afterRow}.`,
      operationKind: operation.kind,
      target: {
        path: input.path,
        tabular: {
          rows: boundedNumbers(sequenceNumbers(operation.afterRow + 1, operation.rows.length))
        }
      },
      counts: {
        ...baseCounts,
        rowsInserted: operation.rows.length
      },
      previews: previews.items,
      truncated: previews.truncated
    })
  }

  if (input.operation.kind === 'tabular.insertColumns') {
    const operation = input.operation
    const previews = boundedPreviewList(operation.columns, (column, index) => {
      const columnIndex = operation.afterColumn + 1 + index
      const preview = boundedDiffText(column.map(tabularPreviewValue).join('\t'))
      return {
        label: `Inserted column ${columnIndex}`,
        after: preview.text,
        truncated: preview.truncated
      }
    })
    return parseEditDiffSummary({
      summary: `Inserted ${formatCount(operation.columns.length, 'column')} after column ${operation.afterColumn}.`,
      operationKind: operation.kind,
      target: {
        path: input.path,
        tabular: {
          columns: boundedNumbers(sequenceNumbers(operation.afterColumn + 1, operation.columns.length))
        }
      },
      counts: {
        ...baseCounts,
        columnsInserted: operation.columns.length
      },
      previews: previews.items,
      truncated: previews.truncated
    })
  }

  if (input.operation.kind === 'tabular.deleteRows') {
    return parseEditDiffSummary({
      summary: `Deleted ${formatCount(input.operation.rows.length, 'row')}.`,
      operationKind: input.operation.kind,
      target: {
        path: input.path,
        tabular: {
          rows: boundedNumbers(input.operation.rows)
        }
      },
      counts: {
        ...baseCounts,
        rowsDeleted: input.operation.rows.length
      },
      truncated: input.operation.rows.length > WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS
    })
  }

  return parseEditDiffSummary({
    summary: `Deleted ${formatCount(input.operation.columns.length, 'column')}.`,
    operationKind: input.operation.kind,
    target: {
      path: input.path,
      tabular: {
        columns: boundedNumbers(input.operation.columns)
      }
    },
    counts: {
      ...baseCounts,
      columnsDeleted: input.operation.columns.length
    },
    truncated: input.operation.columns.length > WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS
  })
}

function parseEditDiffSummary(input: {
  summary: string
  operationKind: WorkspacePreviewEditOperation['kind']
  target: WorkspacePreviewEditDiffSummary['target']
  counts: WorkspacePreviewEditDiffSummary['counts']
  previews?: WorkspacePreviewEditDiffSummary['previews']
  truncated: boolean
}): WorkspacePreviewEditDiffSummary {
  return workspacePreviewEditDiffSummarySchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    kind: 'bounded',
    summary: input.summary,
    operationKind: input.operationKind,
    target: input.target,
    counts: input.counts,
    ...(input.previews?.length ? { previews: input.previews } : {}),
    undo: {
      available: false,
      hint: 'Undo is not available for workspace preview edits yet. Use file history or apply a reverse edit if needed.'
    },
    bounded: {
      maxPreviewItems: WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS,
      maxPreviewChars: WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS,
      truncated: input.truncated
    }
  })
}

function boundedPreviewList<TItem>(
  items: readonly TItem[],
  mapItem: (item: TItem, index: number) => NonNullable<WorkspacePreviewEditDiffSummary['previews']>[number]
): {
  items: NonNullable<WorkspacePreviewEditDiffSummary['previews']>
  truncated: boolean
} {
  const bounded = items.slice(0, WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS).map(mapItem)
  return {
    items: bounded,
    truncated: items.length > bounded.length || bounded.some((item) => Boolean(item.truncated))
  }
}

function boundedNumbers(values: readonly number[]): number[] {
  return values.slice(0, WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_ITEMS)
}

function sequenceNumbers(start: number, count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => start + index)
}

function boundedDiffText(value: string): { text: string; truncated: boolean } {
  if (value.length <= WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS) {
    return { text: value, truncated: false }
  }
  return {
    text: `${value.slice(0, WORKSPACE_PREVIEW_MAX_DIFF_SUMMARY_PREVIEW_CHARS - 3)}...`,
    truncated: true
  }
}

function tabularPreviewValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return JSON.stringify(value) ?? ''
}

function formatTextRange(range: Extract<WorkspacePreviewEditOperation, { kind: 'text.replaceRange' }>['range']): string {
  return `L${range.start.line}:C${range.start.column}-L${range.end.line}:C${range.end.column}`
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function countTextLines(value: string): number {
  if (value.length === 0) return 0
  return value.split(/\r\n|\r|\n/u).length
}

function offsetForTextPosition(
  content: string,
  position: { line: number; column: number }
): number {
  let line = 1
  let column = 1
  let index = 0

  while (index < content.length) {
    if (line === position.line && column === position.column) return index
    const char = content[index]
    if (char === '\r') {
      if (content[index + 1] === '\n') index += 1
      line += 1
      column = 1
    } else if (char === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
    index += 1
  }

  if (line === position.line && column === position.column) return content.length
  throw new Error(`Text position ${position.line}:${position.column} is outside the file.`)
}
