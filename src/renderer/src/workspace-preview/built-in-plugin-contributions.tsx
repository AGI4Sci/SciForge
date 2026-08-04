import {
  useCallback,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
  markdownWechatCopyResultSchema
} from '@shared/markdown-wechat'
import type {
  WorkspacePreviewPluginManifest,
  WorkspaceObservation,
  WorkspacePreviewEditOperation,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import { DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS } from '@shared/workspace-preview'
import { openSafeExternalUrl } from '../lib/open-external'
import { DeckWorkspaceViewer } from './DeckWorkspaceViewer'
import {
  DocumentAnnotationPanelController
} from './DocumentAnnotationPanelController'
import { DocxWorkspaceViewer } from './DocxWorkspaceViewer'
import {
  HtmlWorkspaceViewer,
  htmlPreviewUrlStateFromActionResult
} from './HtmlWorkspaceViewer'
import { ImageWorkspaceViewer } from './ImageWorkspaceViewer'
import {
  MarkdownWorkspaceViewer,
  type MarkdownWorkspaceViewerApplyEditHandler,
  type MarkdownWorkspaceViewerProps
} from './MarkdownWorkspaceViewer'
import { PdfWorkspaceViewer } from './PdfWorkspaceViewer'
import { TabularWorkspaceViewer } from './TabularWorkspaceViewer'
import { TextWorkspaceViewer } from './TextWorkspaceViewer'
import {
  type RendererWorkspacePreviewPluginContribution,
  type RendererWorkspacePreviewPluginRegistrationInput
} from './registry'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import { createDocumentWorkspacePreviewAnnotationOperation } from './document-annotation-operations'
import { WorkspacePreviewPluginSummaryBody } from './WorkspacePreviewPluginOutlet'
import {
  buildDeckSelectionSection,
  buildDocumentSelectionSection,
  buildSlidesSection,
  buildTablesSection,
  buildTabularSelectionSection,
  buildTextSelectionSection
} from './chrome-model'
import {
  DECK_WORKSPACE_PREVIEW_ACTIONS,
  TABULAR_WORKSPACE_PREVIEW_ACTIONS,
  TEXT_WORKSPACE_PREVIEW_ACTIONS
} from './built-in-plugin-actions'

export const BUILT_IN_WORKSPACE_PREVIEW_OWNER_ID = 'sciforge.workspace-preview'

export function createBuiltInWorkspacePreviewPluginRegistrations():
readonly RendererWorkspacePreviewPluginRegistrationInput[] {
  return createBuiltInWorkspacePreviewPluginContributions().map((contribution) => ({
    ownerId: BUILT_IN_WORKSPACE_PREVIEW_OWNER_ID,
    contribution
  }))
}

function createBuiltInWorkspacePreviewPluginContributions():
readonly RendererWorkspacePreviewPluginContribution[] {
  const manifestsById = new Map(
    DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.map((manifest) => [manifest.id, manifest])
  )
  const manifest = (id: string): WorkspacePreviewPluginManifest => {
    const value = manifestsById.get(id)
    if (!value) throw new Error(`Built-in workspace preview renderer ${id} has no manifest.`)
    manifestsById.delete(id)
    return value
  }
  const contributions: RendererWorkspacePreviewPluginContribution[] = [
    {
      manifest: manifest('tabular'),
      actions: TABULAR_WORKSPACE_PREVIEW_ACTIONS,
      selectionKind: 'tabular',
      inspectSelection: (selection) => buildTabularSelectionSection(
        selection as Extract<WorkspaceStructuredSelection, { kind: 'tabular' }>
      ),
      inspectObservation: (observation) => observation.tables?.length
        ? [buildTablesSection(observation.tables)]
        : [],
      render: ({ observation, applyEdit }) => (
        <TabularWorkspaceViewer
          observation={observation}
          className="h-full min-h-0 pr-20"
          onApplyEdit={applyEdit}
        />
      )
    },
    {
      manifest: manifest('text'),
      actions: TEXT_WORKSPACE_PREVIEW_ACTIONS,
      selectionKind: 'text',
      inspectSelection: (selection) => buildTextSelectionSection(
        selection as Extract<WorkspaceStructuredSelection, { kind: 'text' }>
      ),
      render: ({ observation, contentKey, applyEdit }) => (
        <TextWorkspaceViewer
          observation={observation}
          documentContentKey={contentKey}
          className="h-full min-h-0"
          onApplyEdit={applyEdit}
        />
      )
    },
    {
      manifest: manifest('markdown'),
      actions: TEXT_WORKSPACE_PREVIEW_ACTIONS,
      selectionKind: 'document',
      inspectSelection: (selection) => buildDocumentSelectionSection(
        selection as Extract<WorkspaceStructuredSelection, { kind: 'document' }>
      ),
      render: ({ context, observation, contentKey, annotationQuestionBridge }) => (
        <DocumentAnnotationPanelController
          context={context}
          observation={observation}
          documentKind="markdown"
          questionBridge={annotationQuestionBridge}
          className="h-full min-h-0"
          renderDocument={({ text }) => (
            <MarkdownWorkspaceViewerHost
              context={context}
              observation={observation}
              documentContentKey={contentKey}
              applyEdit={text.onApplyEdit}
              annotationOverlays={text.annotationOverlays}
              activeAnnotationId={text.activeAnnotationId}
              navigationRequest={text.navigationRequest}
              onAnnotationSelect={text.onAnnotationSelect}
              onOpenAnnotations={text.onOpenAnnotations}
            />
          )}
        />
      )
    },
    {
      manifest: manifest('html'),
      actions: TEXT_WORKSPACE_PREVIEW_ACTIONS,
      render: ({ context, observation, applyEdit }) => (
        <HtmlWorkspaceViewer
          observation={observation}
          className="h-full min-h-0"
          onApplyEdit={applyEdit}
          loadPreviewUrl={async () => {
            const sessionId = context.state.session?.id
            if (!sessionId) return { ok: false, message: 'No workspace preview session is active.' }
            return htmlPreviewUrlStateFromActionResult(await context.host.invokeAction(sessionId, {
              actionId: 'html.previewUrl',
              input: {}
            }))
          }}
          onOpenPreviewExternal={async (url) => {
            await openSafeExternalUrl(url)
          }}
        />
      )
    },
    {
      manifest: manifest('image'),
      render: ({ observation, asset, transport }) => (
        <ImageWorkspaceViewer
          observation={observation}
          asset={asset}
          transport={transport}
          className="h-full min-h-0"
        />
      )
    },
    {
      manifest: manifest('pdf'),
      render: ({ context, observation, asset, transport, contentKey, annotationQuestionBridge, visualContextComponentId, onPresentationStateChange }) => (
        <DocumentAnnotationPanelController
          context={context}
          observation={observation}
          documentKind="pdf"
          questionBridge={annotationQuestionBridge}
          className="h-full min-h-0"
          renderDocument={({ pdf }) => (
            <PdfWorkspaceViewer
              observation={observation}
              asset={asset}
              transport={transport}
              documentContentKey={contentKey}
              className="h-full min-h-0"
              onApplyEdit={pdf.onApplyEdit}
              annotationOverlays={pdf.annotationOverlays}
              activeAnnotationId={pdf.activeAnnotationId}
              annotationsOpen={pdf.annotationsOpen}
              jumpToRect={pdf.jumpToRect}
              onSelectionChange={pdf.onSelectionChange}
              onAnnotationSelect={pdf.onAnnotationSelect}
              onOpenAnnotations={pdf.onOpenAnnotations}
              onToggleAnnotations={pdf.onToggleAnnotations}
              visualContextComponentId={visualContextComponentId}
              onPresentationStateChange={onPresentationStateChange}
            />
          )}
        />
      )
    },
    {
      manifest: manifest('docx'),
      render: ({ context, observation, contentKey, annotationQuestionBridge }) => (
        <DocumentAnnotationPanelController
          context={context}
          observation={observation}
          documentKind="docx"
          questionBridge={annotationQuestionBridge}
          className="h-full min-h-0"
          renderDocument={({ text }) => (
            <DocxWorkspaceViewer
              observation={observation}
              documentContentKey={contentKey}
              className="h-full min-h-0"
              onApplyEdit={text.onApplyEdit}
              annotationOverlays={text.annotationOverlays}
              activeAnnotationId={text.activeAnnotationId}
              navigationRequest={text.navigationRequest}
              onAnnotationSelect={text.onAnnotationSelect}
              onOpenAnnotations={text.onOpenAnnotations}
            />
          )}
        />
      )
    },
    {
      manifest: manifest('deck'),
      actions: DECK_WORKSPACE_PREVIEW_ACTIONS,
      selectionKind: 'deck',
      inspectSelection: (selection) => buildDeckSelectionSection(
        selection as Extract<WorkspaceStructuredSelection, { kind: 'deck' }>
      ),
      inspectObservation: (observation) => observation.slides?.length
        ? [buildSlidesSection(observation.slides)]
        : [],
      render: ({ observation, applyEdit }) => (
        <DeckWorkspaceViewer
          observation={observation}
          className="h-full min-h-0 pr-20"
          onApplyEdit={applyEdit}
        />
      )
    }
  ]
  for (const fallbackManifest of manifestsById.values()) {
    contributions.push({
      manifest: fallbackManifest,
      render: ({ context, observation, routeReason }) => (
        <WorkspacePreviewPluginSummaryBody
          context={context}
          observation={observation}
          routeReason={routeReason}
        />
      )
    })
  }
  return contributions
}

function MarkdownWorkspaceViewerHost({
  context,
  observation,
  documentContentKey,
  applyEdit,
  annotationOverlays,
  activeAnnotationId,
  navigationRequest,
  onAnnotationSelect,
  onOpenAnnotations
}: {
  context: WorkspacePreviewPanelShellContext
  observation: WorkspaceObservation | null
  documentContentKey: string
  applyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
  annotationOverlays: NonNullable<MarkdownWorkspaceViewerProps['annotationOverlays']>
  activeAnnotationId: string | null
  navigationRequest: MarkdownWorkspaceViewerProps['navigationRequest']
  onAnnotationSelect: NonNullable<MarkdownWorkspaceViewerProps['onAnnotationSelect']>
  onOpenAnnotations: NonNullable<MarkdownWorkspaceViewerProps['onOpenAnnotations']>
}): ReactElement {
  const { t } = useTranslation('common')
  const host = context.host
  const sessionId = context.state.session?.id
  const copyForWechatAvailable = Boolean(
    sessionId && observation?.actions.includes(MARKDOWN_COPY_FOR_WECHAT_ACTION_ID)
  )
  const loadWorkspaceImage = useCallback<NonNullable<MarkdownWorkspaceViewerProps['loadWorkspaceImage']>>(async ({ path }) => {
    if (!sessionId) return { ok: false, message: 'No workspace preview session is active.' }
    const result = await host.invokeAction(sessionId, {
      actionId: 'markdown.readImage',
      input: { path }
    })
    if (!result.ok) return result
    const payload = result.result
    if (!isRecord(payload) || typeof payload.dataUrl !== 'string') {
      return { ok: false, message: 'Markdown image action did not return a data URL.' }
    }
    return {
      ok: true,
      dataUrl: payload.dataUrl
    }
  }, [host, sessionId])
  const copyForWechat = useCallback<NonNullable<MarkdownWorkspaceViewerProps['onCopyForWechat']>>(async () => {
    if (!sessionId) throw new Error('No workspace preview session is active.')
    const result = await host.invokeAction(sessionId, {
      actionId: MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
      input: {}
    })
    if (!result.ok) throw new Error(result.message)
    const parsed = markdownWechatCopyResultSchema.safeParse(result.result)
    if (!parsed.success) {
      throw new Error('Markdown WeChat copy action returned an invalid result.')
    }
    return parsed.data
  }, [host, sessionId])
  const applyMarkdownEdit = useCallback<MarkdownWorkspaceViewerApplyEditHandler>(async (operation) => {
    await applyEdit(operation)
  }, [applyEdit])
  const applyAnnotation = useCallback<NonNullable<MarkdownWorkspaceViewerProps['onAnnotationAction']>>((action, selection) => {
    const path = observation?.file.path
    if (!path) return
    const operation = createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'markdown',
      path,
      action,
      selection,
      translationBody: t('writeDocxAnnotationTranslatePrompt')
    })
    if (operation) void applyEdit(operation)
  }, [applyEdit, observation?.file.path, t])

  return (
    <MarkdownWorkspaceViewer
      observation={observation}
      documentContentKey={documentContentKey}
      className="h-full min-h-0"
      onApplyEdit={applyMarkdownEdit}
      onCopyForWechat={copyForWechatAvailable ? copyForWechat : undefined}
      loadWorkspaceImage={loadWorkspaceImage}
      onOpenWorkspaceLink={context.openFile}
      annotationOverlays={annotationOverlays}
      activeAnnotationId={activeAnnotationId}
      navigationRequest={navigationRequest}
      onAnnotationAction={applyAnnotation}
      onAnnotationSelect={onAnnotationSelect}
      onOpenAnnotations={onOpenAnnotations}
    />
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
