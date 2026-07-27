import {
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewFileState,
  type WorkspacePreviewModality,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewHostState } from './host'
import {
  createExportWorkspacePreviewAction,
  createSetSelectionWorkspacePreviewAction,
  createUiWorkspacePreviewAction
} from './action-runner'
import {
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry,
  type WorkspacePreviewActionContribution,
  type WorkspacePreviewChromeActionSource,
  type WorkspacePreviewInspectorRow,
  type WorkspacePreviewInspectorSection,
  type WorkspacePreviewToolbarAction
} from './registry'

export type {
  WorkspacePreviewChromeActionSource,
  WorkspacePreviewInspectorRow,
  WorkspacePreviewInspectorSection,
  WorkspacePreviewToolbarAction
} from './registry'

export type WorkspacePreviewBreadcrumbItem = {
  label: string
  path: string
  current: boolean
}

export type WorkspacePreviewChromeTitle = {
  text: string
  subtitle?: string
}

export type WorkspacePreviewChromeStatus =
  | {
      kind: 'ready'
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'error'
      variant: 'unsupported' | 'host'
      title: string
      message: string
    }

export type WorkspacePreviewInspectorSummaryItem = {
  id: string
  label: string
  value: string
}

export type WorkspacePreviewInspectorModel = {
  summary: WorkspacePreviewInspectorSummaryItem[]
  sections: WorkspacePreviewInspectorSection[]
}

export type WorkspacePreviewChromeModel = {
  status: WorkspacePreviewChromeStatus
  title: WorkspacePreviewChromeTitle
  breadcrumb: WorkspacePreviewBreadcrumbItem[]
  toolbar: {
    actions: WorkspacePreviewToolbarAction[]
  }
  inspector: WorkspacePreviewInspectorModel
}

export type WorkspacePreviewChromeInput = {
  state: Readonly<WorkspacePreviewHostState>
  registry: RendererWorkspacePreviewRegistry
  requestedPath?: string
  mimeType?: string
}

type ChromeFileSnapshot = {
  path?: string
  workspaceRoot?: string
  relativePath?: string
  mimeType?: string
  size?: number
  mtimeMs?: number
}

const CORE_ACTIONS = new Map<string, WorkspacePreviewActionContribution>([
  createUiWorkspacePreviewAction({ id: 'workspace.preview', label: 'Preview', run: (context) => context.refresh() }),
  createUiWorkspacePreviewAction({ id: 'workspace.edit', label: 'Edit', requiresExplicitUi: true }),
  createUiWorkspacePreviewAction({
    id: 'workspace.inspect',
    label: 'Inspect',
    run: (context) => context.toggleInspector?.()
  }),
  createSetSelectionWorkspacePreviewAction(),
  createUiWorkspacePreviewAction({ id: 'annotation.upsert', label: 'Annotate', requiresExplicitUi: true })
].map((action) => [action.id, action]))

export function buildWorkspacePreviewChromeModel(input: WorkspacePreviewChromeInput): WorkspacePreviewChromeModel {
  const registry = input.registry
  const descriptor = resolveChromeDescriptor(input, registry)
  const status = buildChromeStatus(input, registry)
  const file = getFileSnapshot(input.state, input.requestedPath)
  const title = buildTitle(input.state, descriptor, file)

  return {
    status,
    title,
    breadcrumb: buildBreadcrumb(displayPath(file)),
    toolbar: {
      actions: buildToolbarActions({
        manifest: descriptor?.manifest,
        pluginId: descriptor?.manifest.id,
        observation: input.state.observation,
        registry,
        enabled: status.kind !== 'error' && Boolean(input.state.session)
      })
    },
    inspector: buildInspectorModel(input.state, descriptor, file)
  }
}

export function buildToolbarActions(input: {
  manifest?: WorkspacePreviewPluginManifest | null
  pluginId?: string
  observation?: WorkspaceObservation | null
  registry: RendererWorkspacePreviewRegistry
  enabled?: boolean
}): WorkspacePreviewToolbarAction[] {
  const actions = new Map<string, WorkspacePreviewToolbarAction>()
  const enabled = input.enabled ?? true
  const reason = enabled ? undefined : 'Open a preview session to use this action.'

  const addAction = (action: WorkspacePreviewToolbarAction): void => {
    const existing = actions.get(action.id)
    if (!existing) {
      actions.set(action.id, action)
      return
    }

    actions.set(action.id, {
      ...existing,
      source: existing.source === action.source ? existing.source : 'manifest+observation',
      enabled: existing.enabled || action.enabled,
      reason: existing.enabled || action.enabled ? undefined : existing.reason ?? action.reason,
      format: existing.format ?? action.format
    })
  }

  const capabilities = input.manifest?.capabilities
  if (capabilities?.preview) addAction(createAction(CORE_ACTIONS.get('workspace.preview')!, 'manifest', enabled, reason))
  if (capabilities?.edit) addAction(createAction(CORE_ACTIONS.get('workspace.edit')!, 'manifest', enabled, reason))
  if (capabilities?.inspect) addAction(createAction(CORE_ACTIONS.get('workspace.inspect')!, 'manifest', enabled, reason))
  if (capabilities?.structuredSelection) {
    addAction(createAction(CORE_ACTIONS.get('workspace.setSelection')!, 'manifest', enabled, reason))
  }
  if (capabilities?.annotations) addAction(createAction(CORE_ACTIONS.get('annotation.upsert')!, 'manifest', enabled, reason))

  for (const format of capabilities?.export ?? []) {
    addAction(createAction(createExportWorkspacePreviewAction(format), 'manifest', enabled, reason, format))
  }

  for (const actionId of input.observation?.actions ?? []) {
    const contribution = CORE_ACTIONS.get(actionId) ?? (
      input.pluginId ? input.registry.getAction(input.pluginId, actionId) : null
    )
    if (contribution) addAction(createAction(contribution, 'observation', enabled, reason))
  }

  return [...actions.values()]
}

export function buildInspectorModel(
  state: Readonly<WorkspacePreviewHostState>,
  descriptor: RendererWorkspacePreviewPluginDescriptor | null | undefined = state.descriptor,
  file: ChromeFileSnapshot = getFileSnapshot(state)
): WorkspacePreviewInspectorModel {
  const observation = state.observation
  const session = state.session
  const sections: WorkspacePreviewInspectorSection[] = []
  const summary: WorkspacePreviewInspectorSummaryItem[] = []
  const pluginName = descriptor?.manifest.displayName ?? observation?.view.pluginId ?? session?.pluginId
  const modality = observation?.view.modality ?? session?.modality ?? descriptor?.manifest.modality
  const mode = observation?.view.mode ?? session?.mode

  if (pluginName) summary.push({ id: 'plugin', label: 'Plugin', value: pluginName })
  if (modality) summary.push({ id: 'modality', label: 'Modality', value: formatModality(modality) })
  if (mode) summary.push({ id: 'mode', label: 'Mode', value: titleCase(mode) })

  const fileSection = buildFileSection(file, pluginName, modality, mode)
  if (fileSection) sections.push(fileSection)
  if (state.asset) sections.push(buildAssetTransportSection(state.asset))

  const selection = observation?.selection ?? session?.selection
  const contribution = descriptor?.contribution
  if (selection && contribution?.selectionKind === selection.kind && contribution.inspectSelection) {
    sections.push(contribution.inspectSelection(selection))
  }
  if (observation) sections.push(...(contribution?.inspectObservation?.(observation) ?? []))
  if (observation?.annotations?.length) sections.push(buildAnnotationsSection(observation.annotations))

  return {
    summary,
    sections
  }
}

function resolveChromeDescriptor(
  input: WorkspacePreviewChromeInput,
  registry: RendererWorkspacePreviewRegistry
): RendererWorkspacePreviewPluginDescriptor | null {
  const state = input.state
  const pluginId = state.observation?.view.pluginId ?? state.session?.pluginId
  if (state.descriptor) return state.descriptor
  if (pluginId) return registry.get(pluginId)
  if (!input.requestedPath) return null
  return registry.resolve({
    path: input.requestedPath,
    mimeType: input.mimeType
  })
}

function buildChromeStatus(
  input: WorkspacePreviewChromeInput,
  registry: RendererWorkspacePreviewRegistry
): WorkspacePreviewChromeStatus {
  const state = input.state
  if (state.error) {
    return {
      kind: 'error',
      variant: 'host',
      title: 'Workspace preview error',
      message: state.error
    }
  }

  if (state.session || state.file || state.observation || state.descriptor) return { kind: 'ready' }

  if (input.requestedPath) {
    const descriptor = registry.resolve({
      path: input.requestedPath,
      mimeType: input.mimeType
    })
    if (!descriptor) {
      return {
        kind: 'error',
        variant: 'unsupported',
        title: 'Unsupported preview',
        message: `No renderer preview plugin is registered for ${input.requestedPath}.`
      }
    }

    return {
      kind: 'empty',
      title: 'Preview not opened',
      message: `Open ${input.requestedPath} to start a workspace preview session.`
    }
  }

  return {
    kind: 'empty',
    title: 'No preview selected',
    message: 'Select a workspace file to preview it here.'
  }
}

function getFileSnapshot(
  state: Readonly<WorkspacePreviewHostState>,
  requestedPath?: string
): ChromeFileSnapshot {
  const observationFile = state.observation?.file
  const fileState: WorkspacePreviewFileState | null = state.file
  const session: WorkspacePreviewSession | null = state.session

  return {
    path: observationFile?.path ?? fileState?.path ?? session?.path ?? requestedPath,
    workspaceRoot: observationFile?.workspaceRoot ?? fileState?.workspaceRoot ?? session?.workspaceRoot,
    relativePath: fileState?.relativePath,
    mimeType: observationFile?.mimeType ?? fileState?.mimeType,
    size: observationFile?.size ?? fileState?.size,
    mtimeMs: observationFile?.mtimeMs ?? fileState?.mtimeMs ?? session?.mtimeMs
  }
}

function buildTitle(
  state: Readonly<WorkspacePreviewHostState>,
  descriptor: RendererWorkspacePreviewPluginDescriptor | null,
  file: ChromeFileSnapshot
): WorkspacePreviewChromeTitle {
  const title = state.observation?.view.title?.trim() || basename(displayPath(file)) || 'Workspace preview'
  const pluginName = descriptor?.manifest.displayName
  const modality = state.observation?.view.modality ?? state.session?.modality ?? descriptor?.manifest.modality
  const mode = state.observation?.view.mode ?? state.session?.mode
  const subtitleParts = [pluginName, modality ? formatModality(modality) : undefined, mode ? titleCase(mode) : undefined]
    .filter((part): part is string => Boolean(part && part !== title))

  return {
    text: title,
    subtitle: subtitleParts.length ? subtitleParts.join(' / ') : undefined
  }
}

function buildBreadcrumb(path: string): WorkspacePreviewBreadcrumbItem[] {
  const segments = normalizePath(path).split('/').filter(Boolean)
  let currentPath = ''

  return segments.map((segment, index) => {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment
    return {
      label: segment,
      path: currentPath,
      current: index === segments.length - 1
    }
  })
}

function buildFileSection(
  file: ChromeFileSnapshot,
  pluginName?: string,
  modality?: WorkspacePreviewModality,
  mode?: WorkspacePreviewSession['mode']
): WorkspacePreviewInspectorSection | null {
  const rows = compactRows([
    file.path ? row('path', 'Path', displayPath(file)) : null,
    pluginName ? row('plugin', 'Plugin', pluginName) : null,
    modality ? row('modality', 'Modality', formatModality(modality)) : null,
    mode ? row('mode', 'Mode', titleCase(mode)) : null,
    file.mimeType ? row('mime', 'MIME type', file.mimeType) : null,
    typeof file.size === 'number' ? row('size', 'Size', formatBytes(file.size)) : null,
    typeof file.mtimeMs === 'number' ? row('modified', 'Modified', formatTimestamp(file.mtimeMs)) : null
  ])

  if (!rows.length) return null
  return {
    id: 'file',
    title: 'File',
    rows
  }
}

function buildAssetTransportSection(
  asset: WorkspacePreviewAssetTransportDescriptor
): WorkspacePreviewInspectorSection {
  const strategyRows = asset.strategies.map((strategy) =>
    row(
      `strategy-${strategy.kind}`,
      titleCase(strategy.kind),
      titleCase(strategy.status),
      compactStrings([
        strategy.reason,
        strategy.maxChunkBytes ? `max ${formatBytes(strategy.maxChunkBytes)}` : undefined
      ]).join(' | ') || undefined
    )
  )

  return {
    id: 'asset-transport',
    title: 'Asset Transport',
    summary: compactStrings([
      `primary ${asset.primary}`,
      asset.eagerRead.allowed ? 'eager read allowed' : 'eager read disabled',
      asset.range.available ? 'byte range available' : 'byte range unavailable'
    ]).join(', '),
    rows: [
      row('primary', 'Primary', titleCase(asset.primary)),
      row(
        'eager-read',
        'Eager read',
        asset.eagerRead.allowed ? 'Allowed' : 'Disabled',
        asset.eagerRead.reason
      ),
      row(
        'range',
        'Byte range',
        asset.range.available ? 'Available' : 'Unavailable',
        `size ${formatBytes(asset.range.size)} | chunk ${formatBytes(asset.range.recommendedChunkBytes)} / max ${formatBytes(asset.range.maxChunkBytes)}`
      ),
      ...strategyRows
    ]
  }
}

function selectionSection(
  selection: WorkspaceStructuredSelection,
  summary: string,
  rows: Array<WorkspacePreviewInspectorRow | null>
): WorkspacePreviewInspectorSection {
  return {
    id: 'selection',
    title: 'Selection',
    summary,
    rows: compactRows([
      row('kind', 'Kind', formatModality(selection.kind as WorkspacePreviewModality)),
      ...rows
    ])
  }
}

export function buildTextSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'text' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, `Text ${formatCount(selection.ranges.length, 'range')}`, [
    row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range'))
  ])
}

export function buildTabularSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'tabular' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Tabular',
    formatCount(selection.ranges.length, 'range'),
    selection.cells?.length ? formatCount(selection.cells.length, 'cell') : undefined
  ]).join(', '), [
    selection.sheet ? row('sheet', 'Sheet', selection.sheet) : null,
    row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
    selection.cells?.length ? row('cells', 'Cells', formatCount(selection.cells.length, 'cell')) : null
  ])
}

export function buildDocumentSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'document' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, `Document ${formatCount(selection.anchors.length, 'anchor')}`, [
    row('anchors', 'Anchors', formatCount(selection.anchors.length, 'anchor'))
  ])
}

export function buildDeckSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'deck' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Deck',
    formatCount(selection.slideIds.length, 'slide'),
    selection.elementIds?.length ? formatCount(selection.elementIds.length, 'element') : undefined
  ]).join(', '), [
    row('slides', 'Slides', formatCount(selection.slideIds.length, 'slide')),
    selection.elementIds?.length ? row('elements', 'Elements', formatCount(selection.elementIds.length, 'element')) : null
  ])
}

export function buildTablesSection(
  tables: NonNullable<WorkspaceObservation['tables']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'tables',
    title: 'Tables',
    summary: formatCount(tables.length, 'table'),
    rows: tables.map((table, index) =>
      row(
        table.id || `table-${index}`,
        table.name || table.id || `Table ${index + 1}`,
        formatTableShape(table.rowCount, table.columnCount)
      )
    )
  }
}

export function buildSlidesSection(
  slides: NonNullable<WorkspaceObservation['slides']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'slides',
    title: 'Slides',
    summary: formatCount(slides.length, 'slide'),
    rows: slides.map((slide) => ({
      id: slide.id,
      label: `Slide ${slide.index + 1}`,
      value: slide.title || slide.id,
      description: slide.notes
    }))
  }
}

function buildAnnotationsSection(
  annotations: NonNullable<WorkspaceObservation['annotations']>
): WorkspacePreviewInspectorSection {
  return {
    id: 'annotations',
    title: 'Annotations',
    summary: formatCount(annotations.length, 'annotation'),
    rows: annotations.map((annotation) =>
      row(annotation.id, titleCase(annotation.kind), annotation.summary || annotation.id)
    )
  }
}

function createAction(
  contribution: WorkspacePreviewActionContribution,
  source: WorkspacePreviewChromeActionSource,
  enabled: boolean,
  reason?: string,
  format?: string
): WorkspacePreviewToolbarAction {
  const requiresExplicitUi = contribution.requiresExplicitUi ?? false
  return {
    id: contribution.id,
    label: contribution.label,
    source,
    enabled: enabled && !requiresExplicitUi,
    reason: requiresExplicitUi
      ? 'This action needs a dedicated editor control before it can run.'
      : reason,
    format,
    contribution
  }
}

function displayPath(file: ChromeFileSnapshot): string {
  if (file.relativePath?.trim()) return normalizePath(file.relativePath)
  if (!file.path) return ''
  const path = normalizePath(file.path)
  const workspaceRoot = file.workspaceRoot ? normalizePath(file.workspaceRoot).replace(/\/+$/, '') : ''
  if (workspaceRoot && path === workspaceRoot) return basename(path)
  if (workspaceRoot && path.startsWith(`${workspaceRoot}/`)) return path.slice(workspaceRoot.length + 1)
  return path
}

function formatTableShape(rowCount?: number, columnCount?: number): string {
  const rows = typeof rowCount === 'number' ? formatCount(rowCount, 'row') : 'Unknown rows'
  const columns = typeof columnCount === 'number' ? formatCount(columnCount, 'column') : 'unknown columns'
  return `${rows} x ${columns}`
}

function row(id: string, label: string, value: string, description?: string): WorkspacePreviewInspectorRow {
  return { id, label, value, description }
}

function compactRows(
  rows: Array<WorkspacePreviewInspectorRow | null | undefined>
): WorkspacePreviewInspectorRow[] {
  return rows.filter((item): item is WorkspacePreviewInspectorRow => Boolean(item))
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  for (const unit of units) {
    if (value < 1024) return `${formatDecimal(value)} ${unit}`
    value /= 1024
  }
  return `${formatDecimal(value)} PB`
}

function formatDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, '')
}

function formatTimestamp(mtimeMs: number): string {
  const date = new Date(mtimeMs)
  if (Number.isNaN(date.getTime())) return String(mtimeMs)
  return date.toISOString()
}

function formatModality(modality: WorkspacePreviewModality): string {
  const value = String(modality)
  const leaf = value.split('.').filter(Boolean).at(-1) ?? value
  return titleCase(leaf.replace(/-/g, ' '))
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function basename(path: string): string {
  const segments = normalizePath(path).split('/').filter(Boolean)
  return segments.at(-1) ?? ''
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}
