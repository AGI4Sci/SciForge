import {
  useCallback,
  type ReactElement
} from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation,
  WorkspacePreviewModality
} from '@shared/workspace-preview'
import { openSafeExternalUrl } from '../lib/open-external'
import {
  BioimagingWorkspaceViewer
} from './BioimagingWorkspaceViewer'
import {
  DeckWorkspaceViewer
} from './DeckWorkspaceViewer'
import {
  DocumentAnnotationPanelController
} from './DocumentAnnotationPanelController'
import type {
  DocumentAnnotationQuestionBridge
} from './DocumentAnnotationPanelController'
import {
  DocxWorkspaceViewer
} from './DocxWorkspaceViewer'
import {
  HtmlWorkspaceViewer,
  htmlPreviewUrlStateFromActionResult
} from './HtmlWorkspaceViewer'
import {
  ImageWorkspaceViewer
} from './ImageWorkspaceViewer'
import {
  MarkdownWorkspaceViewer,
  type MarkdownWorkspaceViewerApplyEditHandler,
  type MarkdownWorkspaceViewerProps
} from './MarkdownWorkspaceViewer'
import {
  PdfWorkspaceViewer
} from './PdfWorkspaceViewer'
import {
  MolecularWorkspaceViewer
} from './MolecularWorkspaceViewer'
import {
  OmicsWorkspaceViewer
} from './OmicsWorkspaceViewer'
import {
  SequenceWorkspaceViewer
} from './SequenceWorkspaceViewer'
import {
  SpectraWorkspaceViewer
} from './SpectraWorkspaceViewer'
import {
  TabularWorkspaceViewer
} from './TabularWorkspaceViewer'
import {
  TextWorkspaceViewer
} from './TextWorkspaceViewer'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'

export type WorkspacePreviewPluginOutletRouteReason =
  | 'deferred-non-life-science'
  | 'empty'
  | 'registered-plugin'
  | 'unregistered-format'

export type WorkspacePreviewPluginOutletProps = {
  context: WorkspacePreviewPanelShellContext
  routeReason: WorkspacePreviewPluginOutletRouteReason
  routePluginId?: string
  routeModality?: WorkspacePreviewModality
  renderers?: readonly WorkspacePreviewPluginRendererContribution[]
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  visualContextComponentId?: string
}

export type WorkspacePreviewPluginRendererInput = {
  context: WorkspacePreviewPanelShellContext
  routeReason: WorkspacePreviewPluginOutletRouteReason
  observation: WorkspaceObservation | null
  asset: WorkspacePreviewPanelShellContext['asset']
  transport: WorkspacePreviewPanelShellContext['transport']
  pluginId?: string
  modality?: WorkspacePreviewModality
  applyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
  annotationQuestionBridge?: DocumentAnnotationQuestionBridge
  visualContextComponentId?: string
}

export type WorkspacePreviewPluginRendererContribution = {
  id: string
  matches: (input: Omit<WorkspacePreviewPluginRendererInput, 'applyEdit'>) => boolean
  render: (input: WorkspacePreviewPluginRendererInput) => ReactElement
}

export async function applyWorkspacePreviewOutletEdit(
  context: WorkspacePreviewPanelShellContext,
  operation: WorkspacePreviewEditOperation
): Promise<void> {
  const result = await context.host.applyEdit(operation)
  if (result.ok) {
    await context.host.observe(result.session.id)
    return
  }
  throw new Error(result.message)
}

export const DEFAULT_WORKSPACE_PREVIEW_PLUGIN_RENDERERS: readonly WorkspacePreviewPluginRendererContribution[] = [
  {
    id: 'tabular',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'tabular' ||
      modality === 'tabular' ||
      Boolean(observation?.tables?.length),
    render: ({ observation, applyEdit }) => (
      <TabularWorkspaceViewer
        observation={observation}
        className="h-full min-h-0 pr-20"
        onApplyEdit={applyEdit}
      />
    )
  },
  {
    id: 'text',
    matches: ({ pluginId, modality }) =>
      pluginId === 'text' ||
      modality === 'text',
    render: ({ observation, applyEdit }) => (
      <TextWorkspaceViewer
        observation={observation}
        className="h-full min-h-0"
        onApplyEdit={applyEdit}
      />
    )
  },
  {
    id: 'markdown',
    matches: ({ pluginId, observation }) =>
      pluginId === 'markdown' ||
      Boolean(observation && (
        observation.view.pluginId === 'markdown' ||
        /\.(?:md|mdx|markdown)$/i.test(observation.file.path) ||
        observation.file.mimeType === 'text/markdown' ||
        observation.file.mimeType === 'text/x-markdown'
      )),
    render: ({ context, observation, applyEdit }) => (
      <MarkdownWorkspaceViewerHost
        context={context}
        observation={observation}
        applyEdit={applyEdit}
      />
    )
  },
  {
    id: 'html',
    matches: ({ pluginId, observation }) =>
      pluginId === 'html' ||
      Boolean(observation && (
        observation.view.pluginId === 'html' ||
        /\.(?:html|htm)$/i.test(observation.file.path) ||
        observation.file.mimeType === 'text/html'
      )),
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
    id: 'image',
    matches: ({ pluginId, modality, observation }) =>
      pluginId === 'image' ||
      modality === 'image' ||
      Boolean(observation?.file.mimeType?.startsWith('image/')),
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
    id: 'pdf',
    matches: ({ pluginId, observation }) =>
      pluginId === 'pdf' ||
      Boolean(observation && (
        observation.view.pluginId === 'pdf' ||
        /\.pdf$/i.test(observation.file.path) ||
        observation.file.mimeType === 'application/pdf' ||
        observation.file.mimeType === 'application/x-pdf'
      )),
    render: ({ context, observation, asset, transport, annotationQuestionBridge, visualContextComponentId }) => (
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
          />
        )}
      />
    )
  },
  {
    id: 'docx',
    matches: ({ pluginId, observation }) =>
      pluginId === 'docx' ||
      Boolean(observation && (
        observation.view.pluginId === 'docx' ||
        /\.docx$/i.test(observation.file.path) ||
        observation.file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )),
    render: ({ context, observation, annotationQuestionBridge }) => (
      <DocumentAnnotationPanelController
        context={context}
        observation={observation}
        documentKind="docx"
        questionBridge={annotationQuestionBridge}
        className="h-full min-h-0"
        renderDocument={({ docx }) => (
          <DocxWorkspaceViewer
            observation={observation}
            className="h-full min-h-0"
            onApplyEdit={docx.onApplyEdit}
            annotationOverlays={docx.annotationOverlays}
            activeAnnotationId={docx.activeAnnotationId}
            onAnnotationSelect={docx.onAnnotationSelect}
            onOpenAnnotations={docx.onOpenAnnotations}
          />
        )}
      />
    )
  },
  {
    id: 'deck',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'deck' ||
      modality === 'deck' ||
      Boolean(observation?.slides?.length),
    render: ({ observation, applyEdit }) => (
      <DeckWorkspaceViewer
        observation={observation}
        className="h-full min-h-0 pr-20"
        onApplyEdit={applyEdit}
      />
    )
  },
  {
    id: 'molecular',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'molecular' ||
      modality === 'molecular' ||
      Boolean(observation?.molecular),
    render: ({ context, observation, asset, transport, applyEdit }) => (
      <MolecularWorkspaceViewer
        observation={observation}
        asset={asset}
        assetStatus={context.assetStatus}
        assetError={context.assetError}
        sourceUrl={transport.sourceUrl}
        readRange={(range) => transport.readRange(range)}
        onApplyEdit={applyEdit}
        className="h-full min-h-0 pr-20"
      />
    )
  },
  {
    id: 'sequence',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'sequence-genomics' ||
      modality === 'sequence' ||
      Boolean(observation?.sequence),
    render: ({ observation, applyEdit }) => (
      <SequenceWorkspaceViewer
        observation={observation}
        onSetSelection={applyEdit}
        className="h-full min-h-0 pr-20"
      />
    )
  },
  {
    id: 'omics',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'omics-matrix' ||
      modality === 'omics' ||
      Boolean(observation?.omics),
    render: ({ observation }) => (
      <OmicsWorkspaceViewer
        observation={observation}
        className="h-full min-h-0 pr-20"
      />
    )
  },
  {
    id: 'bioimaging',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'bioimaging' ||
      modality === 'bioimaging' ||
      Boolean(observation?.bioimaging),
    render: ({ observation, transport }) => (
      <BioimagingWorkspaceViewer
        observation={observation}
        transport={transport}
        className="h-full min-h-0 pr-20"
      />
    )
  },
  {
    id: 'spectra',
    matches: ({ observation, pluginId, modality }) =>
      pluginId === 'proteomics-spectra' ||
      modality === 'spectra' ||
      Boolean(observation?.spectra),
    render: ({ observation }) => (
      <SpectraWorkspaceViewer
        observation={observation}
        className="h-full min-h-0 pr-20"
      />
    )
  }
]

function MarkdownWorkspaceViewerHost({
  context,
  observation,
  applyEdit
}: {
  context: WorkspacePreviewPanelShellContext
  observation: WorkspaceObservation | null
  applyEdit: MarkdownWorkspaceViewerApplyEditHandler
}): ReactElement {
  const host = context.host
  const sessionId = context.state.session?.id
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

  return (
    <MarkdownWorkspaceViewer
      observation={observation}
      className="h-full min-h-0"
      onApplyEdit={applyEdit}
      loadWorkspaceImage={loadWorkspaceImage}
    />
  )
}

export function resolveWorkspacePreviewPluginRendererContribution(
  context: WorkspacePreviewPanelShellContext,
  routeReason: WorkspacePreviewPluginOutletRouteReason,
  renderers: readonly WorkspacePreviewPluginRendererContribution[] = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_RENDERERS,
  routePluginId?: string,
  routeModality?: WorkspacePreviewModality
): WorkspacePreviewPluginRendererContribution | null {
  const observation = context.state.observation
  const pluginId = observation?.view.pluginId ??
    context.state.descriptor?.manifest.id ??
    context.state.session?.pluginId ??
    routePluginId
  const modality = observation?.view.modality ??
    context.state.descriptor?.manifest.modality ??
    context.state.session?.modality ??
    routeModality
  const input = {
    context,
    routeReason,
    observation,
    asset: context.asset,
    transport: context.transport,
    pluginId,
    modality
  }

  return renderers.find((renderer) => renderer.matches(input)) ?? null
}

export function WorkspacePreviewPluginOutlet({
  context,
  routeReason,
  routePluginId,
  routeModality,
  renderers = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_RENDERERS,
  annotationQuestionBridge,
  visualContextComponentId
}: WorkspacePreviewPluginOutletProps): ReactElement {
  const observation = context.state.observation
  const pluginId = observation?.view.pluginId ??
    context.state.descriptor?.manifest.id ??
    context.state.session?.pluginId ??
    routePluginId
  const modality = observation?.view.modality ??
    context.state.descriptor?.manifest.modality ??
    context.state.session?.modality ??
    routeModality
  const applyEdit = (operation: WorkspacePreviewEditOperation): Promise<void> =>
    applyWorkspacePreviewOutletEdit(context, operation)
  const renderer = resolveWorkspacePreviewPluginRendererContribution(
    context,
    routeReason,
    renderers,
    routePluginId,
    routeModality
  )

  if (renderer) {
    return renderer.render({
      context,
      routeReason,
      observation,
      asset: context.asset,
      transport: context.transport,
      pluginId,
      modality,
      applyEdit,
      annotationQuestionBridge,
      visualContextComponentId
    })
  }

  return (
    <WorkspacePreviewPluginSummaryBody
      context={context}
      observation={observation}
      routeReason={routeReason}
    />
  )
}

function WorkspacePreviewPluginSummaryBody({
  context,
  observation,
  routeReason
}: {
  context: WorkspacePreviewPanelShellContext
  observation: WorkspaceObservation | null
  routeReason: WorkspacePreviewPluginOutletRouteReason
}): ReactElement {
  const session = context.state.session
  const title = observation?.view.title ?? session?.path ?? 'Workspace preview'
  const modality = observation?.view.modality ?? session?.modality ?? 'unknown'
  const message = fallbackMessageForRoute(routeReason, modality, context.assetError)

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 pr-20 text-sm text-ds-text"
      data-workspace-preview-plugin-summary
      data-route-reason={routeReason}
    >
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-ds-muted">{message}</p>
      </header>
      <p className="max-w-xl text-xs text-ds-muted">
        Use Inspect for plugin details, asset transport state, and agent-readable observation metadata.
      </p>
    </section>
  )
}

function fallbackMessageForRoute(
  routeReason: WorkspacePreviewPluginOutletRouteReason,
  modality: string,
  assetError: string | null
): string {
  if (assetError) return assetError
  if (routeReason === 'deferred-non-life-science') {
    return 'This scientific format is recognized, but an inline viewer has not been enabled for this workspace yet.'
  }
  if (routeReason === 'unregistered-format') {
    return 'No inline workspace preview plugin is registered for this file type.'
  }
  return `${formatLabel(modality)} preview is not available in the main viewer yet.`
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
