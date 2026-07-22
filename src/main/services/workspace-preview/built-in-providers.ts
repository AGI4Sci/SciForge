import { createWorkspaceTabularService } from '@sciforge/workspace-tabular/service'
import type { WorkspaceTabularPreviewResult } from '@sciforge/workspace-tabular/contract'
import { createWorkspaceDeckService } from '@sciforge/workspace-deck/service'
import type { WorkspaceDeckPreviewResult } from '@sciforge/workspace-deck/contract'
import {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID
} from '../../../shared/workspace-preview'
import {
  type WorkspacePreviewProviderApplyEditInput,
  type WorkspacePreviewProviderApplyEditResult,
  type WorkspacePreviewProviderExportInput,
  type WorkspacePreviewProviderExportResult,
  type WorkspacePreviewProviderFileValidationInput,
  type WorkspacePreviewProviderFileValidationResult,
  type WorkspacePreviewProviderActionInput,
  type WorkspacePreviewProviderActionResult,
  type WorkspacePreviewProviderObservationInput,
  type WorkspacePreviewProviderObservationResult,
  type WorkspacePreviewProvider,
  type WorkspacePreviewProviderRegistrationInput
} from './provider-registry'

export const BUILT_IN_WORKSPACE_PREVIEW_PROVIDER_OWNER_ID = 'sciforge.workspace-preview'

export type BuiltInWorkspaceTabularPreviewResult = WorkspaceTabularPreviewResult
export type BuiltInWorkspaceDeckPreviewResult = WorkspaceDeckPreviewResult

export type WorkspacePreviewBuiltInHostProviderAdapters = Readonly<{
  validateTextFile(input: WorkspacePreviewProviderFileValidationInput): Promise<WorkspacePreviewProviderFileValidationResult>
  observeSourceText(
    input: WorkspacePreviewProviderObservationInput,
    hostActions: readonly string[]
  ): Promise<WorkspacePreviewProviderObservationResult>
  observeDocx(input: WorkspacePreviewProviderObservationInput): Promise<WorkspacePreviewProviderObservationResult>
  applyTextEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyTabularEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyDeckEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyDocumentEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationUpsert(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationThreadUpdate(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationThreadDelete(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  exportSource(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  exportAnnotationSidecar(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  exportAnnotatedPdf(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  invokeHtmlPreview(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult>
  invokeMarkdownImage(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult>
}>

export type WorkspacePreviewBuiltInProviderAdapters = Readonly<{
  host?: WorkspacePreviewBuiltInHostProviderAdapters
  observeTabular: (
    input: WorkspacePreviewProviderObservationInput,
    service: ReturnType<typeof createWorkspaceTabularService>
  ) => Promise<WorkspacePreviewProviderObservationResult>
  invokeTabularAction: (
    input: WorkspacePreviewProviderActionInput,
    service: ReturnType<typeof createWorkspaceTabularService>
  ) => Promise<WorkspacePreviewProviderActionResult>
  observeDeck: (
    input: WorkspacePreviewProviderObservationInput,
    service: ReturnType<typeof createWorkspaceDeckService>
  ) => Promise<WorkspacePreviewProviderObservationResult>
  invokeDeckAction: (
    input: WorkspacePreviewProviderActionInput,
    service: ReturnType<typeof createWorkspaceDeckService>
  ) => Promise<WorkspacePreviewProviderActionResult>
}>

type EditHandler = NonNullable<WorkspacePreviewProvider['applyEdit']>
type ExportHandler = NonNullable<WorkspacePreviewProvider['exportPreview']>

export function createBuiltInWorkspacePreviewProviderRegistrations(
  adapters: WorkspacePreviewBuiltInProviderAdapters
): readonly WorkspacePreviewProviderRegistrationInput[] {
  const ownerId = BUILT_IN_WORKSPACE_PREVIEW_PROVIDER_OWNER_ID
  const host = adapters.host
  const textEdit = host && whenEdit((kind) => kind === 'text.replaceRange', host.applyTextEdit)
  const tabularEdit = host && whenEdit((kind) => kind.startsWith('tabular.'), host.applyTabularEdit)
  const deckEdit = host && whenEdit((kind) => kind === 'deck.updateTextElement', host.applyDeckEdit)
  const documentEdit = host && whenEdit((kind) => kind === 'document.updateParagraph', host.applyDocumentEdit)
  const annotationUpsert = host && whenEdit((kind) => kind === 'annotation.upsert', host.applyAnnotationUpsert)
  const annotationThreadUpdate = host && whenEdit(
    (kind) => kind === 'annotation.thread.update',
    host.applyAnnotationThreadUpdate
  )
  const annotationThreadDelete = host && whenEdit(
    (kind) => kind === 'annotation.thread.delete',
    host.applyAnnotationThreadDelete
  )
  const annotationEdits = compactHandlers(annotationUpsert, annotationThreadUpdate, annotationThreadDelete)
  const sourceExport: ExportHandler | undefined = host && ((input) => host.exportSource(input))
  const annotationExport: ExportHandler | undefined = host && ((input) => input.target.format === 'sidecar'
    ? host.exportAnnotationSidecar(input)
    : host.exportSource(input))
  const pdfExport: ExportHandler | undefined = host && ((input) => {
    if (input.target.format === 'sidecar') return host.exportAnnotationSidecar(input)
    if (input.target.format === 'annotated-pdf') return host.exportAnnotatedPdf(input)
    return host.exportSource(input)
  })

  const registrations: readonly WorkspacePreviewProviderRegistrationInput[] = [
    registration(ownerId, 0, {
      pluginId: TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
      observe: (input) => adapters.observeTabular(input, createWorkspaceTabularService()),
      invokeAction: (input) => adapters.invokeTabularAction(input, createWorkspaceTabularService()),
      ...hostOperations({
        applyEdit: chainEdits(tabularEdit),
        exportPreview: sourceExport
      })
    }),
    registration(ownerId, 1, {
      pluginId: DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
      observe: (input) => adapters.observeDeck(input, createWorkspaceDeckService()),
      invokeAction: (input) => adapters.invokeDeckAction(input, createWorkspaceDeckService()),
      ...hostOperations({
        applyEdit: chainEdits(deckEdit, ...annotationEdits),
        exportPreview: sourceExport
      })
    }),
    registration(ownerId, 2, {
      pluginId: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, []),
            applyEdit: chainEdits(textEdit),
            exportPreview: sourceExport
          }
        : {})
    }),
    registration(ownerId, 3, {
      pluginId: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, ['markdown.readImage']),
            applyEdit: chainEdits(textEdit, ...annotationEdits),
            exportPreview: annotationExport,
            invokeHostAction: (input: WorkspacePreviewProviderActionInput) => input.action.actionId === 'markdown.readImage'
              ? host.invokeMarkdownImage(input)
              : Promise.resolve(null)
          }
        : {})
    }),
    registration(ownerId, 4, {
      pluginId: HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, ['html.previewUrl']),
            applyEdit: chainEdits(textEdit),
            exportPreview: sourceExport,
            invokeHostAction: (input: WorkspacePreviewProviderActionInput) => input.action.actionId === 'html.previewUrl'
              ? host.invokeHtmlPreview(input)
              : Promise.resolve(null)
          }
        : {})
    }),
    registration(ownerId, 5, {
      pluginId: PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...hostOperations({
        applyEdit: chainEdits(...annotationEdits),
        exportPreview: pdfExport
      })
    }),
    registration(ownerId, 6, {
      pluginId: DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host ? { observe: host.observeDocx } : {}),
      ...hostOperations({
        applyEdit: chainEdits(documentEdit, ...annotationEdits),
        exportPreview: annotationExport
      })
    }),
    registration(ownerId, 7, {
      pluginId: IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...hostOperations({ exportPreview: sourceExport })
    })
  ]
  return registrations
}

function registration(
  ownerId: string,
  order: number,
  provider: WorkspacePreviewProvider
): WorkspacePreviewProviderRegistrationInput {
  return { ownerId, order, provider }
}

function hostOperations(input: Readonly<{
  applyEdit?: EditHandler
  exportPreview?: ExportHandler
}>): Pick<WorkspacePreviewProvider, 'applyEdit' | 'exportPreview'> {
  return {
    ...(input.applyEdit ? { applyEdit: input.applyEdit } : {}),
    ...(input.exportPreview ? { exportPreview: input.exportPreview } : {})
  }
}

function whenEdit(
  matches: (kind: WorkspacePreviewProviderApplyEditInput['operation']['kind']) => boolean,
  handler: (input: WorkspacePreviewProviderApplyEditInput) => Promise<WorkspacePreviewProviderApplyEditResult>
): EditHandler {
  return (input) => matches(input.operation.kind) ? handler(input) : Promise.resolve(null)
}

function compactHandlers(...handlers: readonly (EditHandler | undefined)[]): readonly EditHandler[] {
  return handlers.filter((handler): handler is EditHandler => Boolean(handler))
}

function chainEdits(...handlers: readonly (EditHandler | undefined)[]): EditHandler | undefined {
  const available = compactHandlers(...handlers)
  if (!available.length) return undefined
  return async (input) => {
    for (const handler of available) {
      const result = await handler(input)
      if (result) return result
    }
    return null
  }
}
