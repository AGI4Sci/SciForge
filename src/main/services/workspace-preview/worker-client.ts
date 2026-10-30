import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  type BuiltInWorkspaceDeckPreviewResult,
  type BuiltInWorkspaceTabularPreviewResult,
  type WorkspacePreviewBuiltInHostProviderAdapters,
  type WorkspacePreviewBuiltInProviderAdapters
} from './built-in-providers'
import {
  WorkspacePreviewProviderRegistry,
  type WorkspacePreviewProviderActionInput,
  type WorkspacePreviewProviderActionResult,
  type WorkspacePreviewProviderArtifactInput,
  type WorkspacePreviewProviderArtifactResult,
  type WorkspacePreviewProviderObservationInput,
  type WorkspacePreviewProviderObservationResult,
  type WorkspacePreviewProviderApplyEditInput,
  type WorkspacePreviewProviderApplyEditResult,
  type WorkspacePreviewProviderExportInput,
  type WorkspacePreviewProviderExportResult,
  type WorkspacePreviewProviderFileValidationInput,
  type WorkspacePreviewProviderFileValidationResult
} from './provider-registry'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS,
  extensionFromPreviewPath,
  fileNameFromPreviewPath,
  workspaceObservationSchema,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginActionInput,
  type WorkspacePreviewPluginManifest
} from '../../../shared/workspace-preview'
import {
  createComposedWorkspacePreviewRuntime,
  type ComposedWorkspacePreviewRuntime,
  type WorkspacePreviewPluginRegistrationInput
} from './composition'

export const WORKSPACE_PREVIEW_WORKER_TEXT_BYTES = 2_000_000
export const WORKSPACE_PREVIEW_WORKER_BINARY_BYTES = 4 * 1024 * 1024

export type WorkspacePreviewWorkerClientOptions = {
  maxTextBytes?: number
  maxBinaryBytes?: number
  providerRegistry: WorkspacePreviewProviderRegistry
}

export type WorkspacePreviewHostRuntime = ComposedWorkspacePreviewRuntime & Readonly<{
  workerClient: WorkspacePreviewWorkerClient
}>

type BuiltInProviderServices = {
  tabular: Parameters<WorkspacePreviewBuiltInProviderAdapters['observeTabular']>[1]
  deck: Parameters<WorkspacePreviewBuiltInProviderAdapters['observeDeck']>[1]
}

type ObservationBuildInput = WorkspacePreviewProviderObservationInput & {
  visibleText?: string
  selection?: WorkspaceObservation['selection']
  outline?: WorkspaceObservation['outline']
  tables?: WorkspaceObservation['tables']
  tabular?: WorkspaceObservation['tabular']
  slides?: WorkspaceObservation['slides']
  annotations?: WorkspaceObservation['annotations']
  pluginMetadata?: WorkspaceObservation['pluginMetadata']
  deck?: WorkspaceObservation['deck']
  actions?: string[]
  readOnly?: boolean
}

type WorkerObservationLike = Partial<WorkspaceObservation> | undefined

export class WorkspacePreviewWorkerClient {
  private readonly maxTextBytes: number
  private readonly maxBinaryBytes: number
  private providerRegistry: WorkspacePreviewProviderRegistry

  constructor(options: WorkspacePreviewWorkerClientOptions) {
    this.maxTextBytes = options.maxTextBytes ?? WORKSPACE_PREVIEW_WORKER_TEXT_BYTES
    this.maxBinaryBytes = options.maxBinaryBytes ?? WORKSPACE_PREVIEW_WORKER_BINARY_BYTES
    this.providerRegistry = options.providerRegistry
  }

  static compose(options: Readonly<{
    hostAdapters?: WorkspacePreviewBuiltInHostProviderAdapters
    domainPlugins?: readonly WorkspacePreviewPluginRegistrationInput[]
    maxTextBytes?: number
    maxBinaryBytes?: number
  }>): WorkspacePreviewHostRuntime {
    const workerClient = new WorkspacePreviewWorkerClient({
      ...(options.maxTextBytes === undefined ? {} : { maxTextBytes: options.maxTextBytes }),
      ...(options.maxBinaryBytes === undefined ? {} : { maxBinaryBytes: options.maxBinaryBytes }),
      providerRegistry: new WorkspacePreviewProviderRegistry()
    })
    const runtime = createComposedWorkspacePreviewRuntime(
      workerClient.builtInProviderAdapters(options.hostAdapters),
      options.domainPlugins
    )
    workerClient.providerRegistry = runtime.providers
    return Object.freeze({ ...runtime, workerClient })
  }

  private builtInProviderAdapters(
    host: WorkspacePreviewBuiltInHostProviderAdapters | undefined
  ): WorkspacePreviewBuiltInProviderAdapters {
    return {
      ...(host ? { host } : {}),
      observeTabular: (input, service) => this.observeTabular(input, service),
      invokeTabularAction: (input, service) => this.invokeTabularAction(input, service),
      observeDeck: (input, service) => this.observeDeck(input, service),
      invokeDeckAction: (input, service) => this.invokeDeckAction(input, service),
    }
  }

  async observe(input: WorkspacePreviewProviderObservationInput): Promise<WorkspacePreviewProviderObservationResult> {
    try {
      const provider = this.providerRegistry.get(input.manifest.id)
      if (!provider?.observe) {
        return {
          ok: false,
          reason: 'unsupported-plugin',
          message: `Workspace preview plugin ${input.manifest.id} does not have a first-party worker observer.`
        }
      }
      return await provider.observe(input)
    } catch (error) {
      return {
        ok: false,
        reason: 'worker-error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validateFile(
    input: WorkspacePreviewProviderFileValidationInput
  ): Promise<WorkspacePreviewProviderFileValidationResult> {
    try {
      const validateFile = this.providerRegistry.get(input.manifest.id)?.validateFile
      return validateFile ? await validateFile(input) : { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async applyEdit(
    input: WorkspacePreviewProviderApplyEditInput
  ): Promise<WorkspacePreviewProviderApplyEditResult> {
    try {
      const applyEdit = this.providerRegistry.get(input.manifest.id)?.applyEdit
      const result = applyEdit ? await applyEdit(input) : null
      return result ?? {
        ok: false,
        message: `Workspace preview edit operation ${input.operation.kind} is not implemented for plugin ${input.manifest.id}.`
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async exportPreview(
    input: WorkspacePreviewProviderExportInput
  ): Promise<WorkspacePreviewProviderExportResult> {
    try {
      const exportPreview = this.providerRegistry.get(input.manifest.id)?.exportPreview
      if (!exportPreview) {
        return {
          ok: false,
          message: `Workspace preview plugin ${input.manifest.id} does not expose first-party host exports.`
        }
      }
      return await exportPreview(input)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async invokeAction(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult> {
    try {
      const provider = this.providerRegistry.get(input.manifest.id)
      const hostResult = provider?.invokeHostAction
        ? await provider.invokeHostAction(input)
        : null
      if (hostResult) return hostResult
      if (!provider?.invokeAction) {
        return {
          ok: false,
          reason: 'unsupported-plugin',
          message: `Workspace preview plugin ${input.manifest.id} does not expose first-party worker actions.`
        }
      }
      return await provider.invokeAction(input)
    } catch (error) {
      return {
        ok: false,
        reason: 'worker-error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async prepareArtifact(input: WorkspacePreviewProviderArtifactInput): Promise<WorkspacePreviewProviderArtifactResult> {
    try {
      if (input.request.kind !== 'tile' && input.request.kind !== 'thumbnail') {
        return {
          ok: false,
          reason: 'unsupported-artifact',
          message: `Workspace preview worker artifacts are not implemented for ${input.request.kind}.`
        }
      }

      const provider = this.providerRegistry.get(input.manifest.id)
      if (!provider?.prepareArtifact) {
        return {
          ok: false,
          reason: 'unsupported-plugin',
          message: `Workspace preview plugin ${input.manifest.id} does not expose first-party worker artifacts.`
        }
      }
      return await provider.prepareArtifact(input)
    } catch (error) {
      return {
        ok: false,
        reason: 'worker-error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async observeTabular(
    input: WorkspacePreviewProviderObservationInput,
    service: BuiltInProviderServices['tabular']
  ): Promise<WorkspacePreviewProviderObservationResult> {
    if (isXlsxTabularFile(input)) {
      const bytes = await this.readBinaryIfWithinLimit(input.file)
      if (!bytes.ok) return bytes

      const result = await service.previewXlsx({
        bytes: bytes.bytes,
        path: input.file.relativePath ?? input.file.path,
        workspaceRoot: input.file.workspaceRoot,
        mimeType: input.file.mimeType,
        size: input.file.size,
        mtimeMs: input.file.mtimeMs
      })
      const workerObservation = result.observation
      const readOnly = true
      return {
        ok: true,
        bytesRead: bytes.bytesRead,
        truncated: false,
        observation: buildObservation({
          ...input,
          visibleText: workerObservation?.visibleText,
          selection: workerObservation?.selection,
          tables: workerObservation?.tables,
          tabular: {
            header: result.header,
            rows: result.previewRows,
            truncatedRows: result.truncatedRows,
            truncatedColumns: result.truncatedColumns
          },
          annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
          actions: tabularObservationActions(workerObservation?.actions, readOnly),
          readOnly
        })
      }
    }

    const text = await this.readTextPrefix(input.file)
    const result = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    const readOnly = isReadOnlyTabularPreviewFormat(result.format)
    return {
      ok: true,
      bytesRead: text.bytesRead,
      truncated: text.truncated,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation?.visibleText,
        selection: workerObservation?.selection,
        tables: workerObservation?.tables,
        tabular: {
          header: result.header,
          rows: result.previewRows,
          truncatedRows: result.truncatedRows,
          truncatedColumns: result.truncatedColumns
        },
        annotations: mergeAnnotations(workerObservation?.annotations, result.warnings),
        actions: tabularObservationActions(workerObservation?.actions, readOnly),
        readOnly
      })
    }
  }

  private async observeDeck(
    input: WorkspacePreviewProviderObservationInput,
    service: BuiltInProviderServices['deck']
  ): Promise<WorkspacePreviewProviderObservationResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (extension !== '.pptx') {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: 'Only PPTX deck worker observation is implemented in the lightweight worker.'
      }
    }
    const bytes = await this.readBinaryIfWithinLimit(input.file)
    if (!bytes.ok) return bytes

    const result = await service.previewPptx({
      bytes: bytes.bytes,
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    const workerObservation = result.observation
    return {
      ok: true,
      bytesRead: bytes.bytesRead,
      truncated: false,
      observation: buildObservation({
        ...input,
        visibleText: workerObservation.visibleText,
        slides: workerObservation.slides,
        deck: buildDeckObservation(result),
        annotations: mergeAnnotations(workerObservation.annotations, result.warnings ?? []),
        actions: workerObservation.actions
      })
    }
  }

  private async invokeTabularAction(
    input: WorkspacePreviewProviderActionInput,
    service: BuiltInProviderServices['tabular']
  ): Promise<WorkspacePreviewProviderActionResult> {
    const previewRead = await this.readTabularPreviewForAction(input, service)
    if (!previewRead.ok) return previewRead

    const { preview, read, readOnly } = previewRead
    if (readOnly && isTabularWriteAction(input.action.actionId)) {
      return {
        ok: false,
        reason: 'unsupported-action',
        message: `${tabularFormatDisplayName(preview.format)} tabular preview is read-only; action ${input.action.actionId} is not available.`
      }
    }

    const rows = preview.previewRows
    const rowValues = rows.map((row) => row.values)

    if (input.action.actionId === 'tabular.preview' || input.action.actionId === 'tabular.inspectColumns') {
      return actionOk({
        ok: true,
        format: preview.format,
        rowCount: preview.rowCount,
        columnCount: preview.columnCount,
        header: preview.header,
        previewRows: preview.previewRows,
        truncatedRows: preview.truncatedRows,
        truncatedColumns: preview.truncatedColumns,
        columns: preview.columns,
        visibleText: preview.observation?.visibleText
      }, read)
    }
    if (input.action.actionId === 'tabular.filterRows' || input.action.actionId === 'tabular.sortRows') {
      return actionOk(service.queryPreviewRows({
        ...input.action.input,
        rows,
        header: preview.header
      } as Parameters<typeof service.queryPreviewRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.selectCells') {
      return actionOk(service.summarizeSelection({
        rows,
        header: preview.header,
        selection: tabularSelectionFromActionInput(input.action.input)
      } as Parameters<typeof service.summarizeSelection>[0]), read)
    }
    if (input.action.actionId === 'tabular.updateCell') {
      return actionOk(service.updateCell({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.updateCell>[0]), read)
    }
    if (input.action.actionId === 'tabular.insertRows') {
      return actionOk(service.insertRows({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.insertRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.insertColumns') {
      return actionOk(service.insertColumns({
        ...input.action.input,
        rows: rowValues
      } as Parameters<typeof service.insertColumns>[0]), read)
    }
    if (input.action.actionId === 'tabular.deleteRows') {
      return actionOk(service.deleteRows({
        rows: rowValues,
        rowIndices: numberArrayFromActionInput(input.action.input, 'rowIndices', 'rows')
      } as Parameters<typeof service.deleteRows>[0]), read)
    }
    if (input.action.actionId === 'tabular.deleteColumns') {
      return actionOk(service.deleteColumns({
        rows: rowValues,
        columnIndices: numberArrayFromActionInput(input.action.input, 'columnIndices', 'columns')
      } as Parameters<typeof service.deleteColumns>[0]), read)
    }
    return unsupportedAction(input)
  }

  private async readTabularPreviewForAction(
    input: WorkspacePreviewProviderActionInput,
    service: BuiltInProviderServices['tabular']
  ): Promise<{
    ok: true
    preview: BuiltInWorkspaceTabularPreviewResult
    read: { bytesRead: number; truncated: boolean }
    readOnly: boolean
  } | Extract<WorkspacePreviewProviderActionResult, { ok: false }>> {
    if (isXlsxTabularFile(input)) {
      const bytes = await this.readBinaryIfWithinLimit(input.file)
      if (!bytes.ok) return bytes
      return {
        ok: true,
        preview: await service.previewXlsx({
          bytes: bytes.bytes,
          path: input.file.relativePath ?? input.file.path,
          workspaceRoot: input.file.workspaceRoot,
          mimeType: input.file.mimeType,
          size: input.file.size,
          mtimeMs: input.file.mtimeMs
        }),
        read: {
          bytesRead: bytes.bytesRead,
          truncated: false
        },
        readOnly: true
      }
    }

    const text = await this.readTextPrefix(input.file)
    const preview = service.preview({
      text: text.text,
      format: 'auto',
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })
    return {
      ok: true,
      preview,
      read: text,
      readOnly: isReadOnlyTabularPreviewFormat(preview.format)
    }
  }

  private async invokeDeckAction(
    input: WorkspacePreviewProviderActionInput,
    service: BuiltInProviderServices['deck']
  ): Promise<WorkspacePreviewProviderActionResult> {
    const extension = extensionFromPreviewPath(input.file.path, input.manifest.extensions)
    if (extension !== '.pptx') {
      return {
        ok: false,
        reason: 'unsupported-format',
        message: 'Only PPTX deck worker actions are implemented in the lightweight worker.'
      }
    }
    const bytes = await this.readBinaryIfWithinLimit(input.file)
    if (!bytes.ok) return bytes

    const preview = await service.previewPptx({
      bytes: bytes.bytes,
      path: input.file.relativePath ?? input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      mimeType: input.file.mimeType,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs
    })

    if (input.action.actionId === 'deck.selectSlide') {
      return actionOk(service.selectSlide(withActionPreview(input.action, preview) as Parameters<typeof service.selectSlide>[0]), {
        bytesRead: bytes.bytesRead,
        truncated: false
      })
    }
    if (input.action.actionId === 'deck.selectText') {
      return actionOk(service.selectText(withActionPreview(input.action, preview) as Parameters<typeof service.selectText>[0]), {
        bytesRead: bytes.bytesRead,
        truncated: false
      })
    }
    return unsupportedAction(input)
  }

  private async readTextPrefix(file: WorkspacePreviewFileState): Promise<{ text: string; bytesRead: number; truncated: boolean }> {
    const binary = await this.readBinaryPrefix(file, this.maxTextBytes)
    return {
      text: Buffer.from(binary.bytes).toString('utf8'),
      bytesRead: binary.bytesRead,
      truncated: binary.truncated
    }
  }

  private async readBinaryIfWithinLimit(
    file: WorkspacePreviewFileState
  ): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer>; bytesRead: number } | Extract<WorkspacePreviewProviderObservationResult, { ok: false }>> {
    const fileInfo = await stat(file.path)
    if (fileInfo.size > this.maxBinaryBytes) {
      return {
        ok: false,
        reason: 'too-large',
        message: `File is ${fileInfo.size} bytes; lightweight worker observation limit is ${this.maxBinaryBytes} bytes.`
      }
    }
    const binary = await this.readBinaryPrefix(file, this.maxBinaryBytes)
    return {
      ok: true,
      bytes: binary.bytes,
      bytesRead: binary.bytesRead
    }
  }

  private async readBinaryPrefix(
    file: WorkspacePreviewFileState,
    maxBytes = this.maxBinaryBytes
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; bytesRead: number; truncated: boolean }> {
    const fileInfo = await stat(file.path)
    const length = Math.min(fileInfo.size, maxBytes)
    const buffer = Buffer.alloc(length)
    const handle = await open(file.path, 'r')
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      const bytes = new Uint8Array(new ArrayBuffer(bytesRead))
      bytes.set(buffer.subarray(0, bytesRead))
      return {
        bytes,
        bytesRead,
        truncated: fileInfo.size > bytesRead
      }
    } finally {
      await handle.close()
    }
  }
}

function actionOk(
  result: unknown,
  read: { bytesRead: number; truncated: boolean }
): Extract<WorkspacePreviewProviderActionResult, { ok: true }> {
  return {
    ok: true,
    result,
    bytesRead: read.bytesRead,
    truncated: read.truncated
  }
}

function withActionPreview<TPreview>(
  action: WorkspacePreviewPluginActionInput,
  preview: TPreview
): Record<string, unknown> & { preview: TPreview } {
  return {
    ...action.input,
    preview
  }
}

function tabularSelectionFromActionInput(input: Record<string, unknown>): unknown {
  return isRecord(input.selection) ? input.selection : input
}

function numberArrayFromActionInput(
  input: Record<string, unknown>,
  primaryKey: string,
  fallbackKey: string
): unknown[] {
  const value = input[primaryKey] ?? input[fallbackKey]
  return Array.isArray(value) ? value : []
}

function tabularObservationActions(actions: string[] | undefined, readOnly: boolean): string[] | undefined {
  if (!readOnly) return actions
  return actions?.filter((actionId) => !isTabularWriteAction(actionId))
}

function isXlsxTabularFile(input: WorkspacePreviewProviderObservationInput): boolean {
  const path = input.file.relativePath ?? input.file.path
  const extension = extensionFromPreviewPath(path, input.manifest.extensions)
  const mimeType = input.file.mimeType?.toLowerCase()
  return extension === '.xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function isReadOnlyTabularPreviewFormat(format: BuiltInWorkspaceTabularPreviewResult['format']): boolean {
  return format === 'xlsx' || format === 'jsonl' || format === 'ndjson'
}

function tabularFormatDisplayName(format: BuiltInWorkspaceTabularPreviewResult['format']): string {
  if (format === 'xlsx') return 'XLSX'
  if (format === 'ndjson') return 'NDJSON'
  return format.toUpperCase()
}

function isTabularWriteAction(actionId: string): boolean {
  return actionId === 'tabular.updateCell' ||
    actionId === 'tabular.insertRows' ||
    actionId === 'tabular.insertColumns' ||
    actionId === 'tabular.deleteRows' ||
    actionId === 'tabular.deleteColumns'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function unsupportedAction(
  input: WorkspacePreviewProviderActionInput
): Extract<WorkspacePreviewProviderActionResult, { ok: false }> {
  return {
    ok: false,
    reason: 'unsupported-action',
    message: `Workspace preview action ${input.action.actionId} is not implemented for plugin ${input.manifest.id}.`
  }
}

function buildObservation(input: ObservationBuildInput): WorkspaceObservation {
  return workspaceObservationSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.file.path,
      workspaceRoot: input.file.workspaceRoot,
      ...(input.file.mimeType ? { mimeType: input.file.mimeType } : {}),
      ...(input.file.size !== undefined ? { size: input.file.size } : {}),
      ...(input.file.mtimeMs !== undefined ? { mtimeMs: input.file.mtimeMs } : {})
    },
    view: {
      pluginId: input.manifest.id,
      modality: input.manifest.modality,
      mode: input.session.mode,
      title: fileNameFromPreviewPath(input.file.relativePath || input.file.path) || basename(input.file.path)
    },
    ...(input.session.selection ?? input.selection ? { selection: input.session.selection ?? input.selection } : {}),
    ...(input.visibleText ? { visibleText: input.visibleText } : {}),
    ...(input.outline ? { outline: input.outline } : {}),
    ...(input.tables ? { tables: input.tables } : {}),
    ...(input.tabular ? { tabular: input.tabular } : {}),
    ...(input.slides ? { slides: input.slides } : {}),
    ...(input.deck ? { deck: input.deck } : {}),
    ...(input.annotations?.length ? { annotations: input.annotations } : {}),
    ...(input.pluginMetadata?.length ? { pluginMetadata: input.pluginMetadata } : {}),
    actions: mergeActions(input.manifest, input.actions, input.readOnly)
  })
}

function buildDeckObservation(
  result: Pick<BuiltInWorkspaceDeckPreviewResult, 'elementCount' | 'elements' | 'truncatedElements' | 'observation'>
): WorkspaceObservation['deck'] | undefined {
  const slidePreviews = result.observation.deck?.slidePreviews?.slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS) ?? []
  if (result.elementCount === 0 && slidePreviews.length === 0) return undefined

  const textElements = result.elements
    .slice(0, WORKSPACE_PREVIEW_MAX_OBSERVATION_ITEMS)
    .map((element) => ({
      slideId: element.slideId,
      elementId: element.id,
      kind: element.kind,
      text: element.text
    }))

  return {
    ...(result.elementCount > 0
      ? {
          textElementCount: result.elementCount,
          truncatedTextElements: result.truncatedElements || textElements.length < result.elementCount,
          textElements
        }
      : {}),
    ...(slidePreviews.length > 0 ? { slidePreviews } : {})
  }
}

function mergeActions(
  manifest: WorkspacePreviewPluginManifest,
  workerActions: string[] | undefined,
  readOnly = false
): string[] {
  return [...new Set([
    'observe',
    ...(manifest.capabilities.structuredSelection ? ['select'] : []),
    ...(manifest.capabilities.edit && !readOnly ? ['applyEdit', 'save'] : []),
    ...(manifest.capabilities.export?.length ? ['export'] : []),
    ...(workerActions ?? [])
  ])].slice(0, 256)
}

function mergeAnnotations(
  workerAnnotations: WorkspaceObservation['annotations'] | undefined,
  warnings: readonly string[] | undefined
): WorkspaceObservation['annotations'] {
  const annotations = [...(workerAnnotations ?? [])]
  const existing = new Set(annotations.map((annotation) => annotation.summary).filter(Boolean))
  for (const warning of warnings ?? []) {
    if (existing.has(warning)) continue
    annotations.push({
      id: `worker-warning-${annotations.length + 1}`,
      kind: 'warning',
      summary: warning
    })
  }
  return annotations.slice(0, 1000)
}
