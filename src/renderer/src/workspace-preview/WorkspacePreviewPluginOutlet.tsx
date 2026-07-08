import type { ReactElement } from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation,
  WorkspacePreviewModality
} from '@shared/workspace-preview'
import {
  BioimagingWorkspaceViewer
} from './BioimagingWorkspaceViewer'
import {
  DeckWorkspaceViewer
} from './DeckWorkspaceViewer'
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
  | 'life-science'
  | 'deferred-non-life-science'
  | 'text-first-party'
  | 'tabular-first-party'
  | 'deck-first-party'

export type WorkspacePreviewPluginOutletProps = {
  context: WorkspacePreviewPanelShellContext
  routeReason: WorkspacePreviewPluginOutletRouteReason
  renderers?: readonly WorkspacePreviewPluginRendererContribution[]
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
  }
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
    matches: ({ pluginId, modality, routeReason }) =>
      routeReason === 'text-first-party' &&
      (pluginId === 'text' || modality === 'text'),
    render: ({ observation, applyEdit }) => (
      <TextWorkspaceViewer
        observation={observation}
        className="h-full min-h-0"
        onApplyEdit={applyEdit}
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
    render: ({ observation }) => (
      <BioimagingWorkspaceViewer
        observation={observation}
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

export function resolveWorkspacePreviewPluginRendererContribution(
  context: WorkspacePreviewPanelShellContext,
  routeReason: WorkspacePreviewPluginOutletRouteReason,
  renderers: readonly WorkspacePreviewPluginRendererContribution[] = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_RENDERERS
): WorkspacePreviewPluginRendererContribution | null {
  const observation = context.state.observation
  const pluginId = observation?.view.pluginId ??
    context.state.descriptor?.manifest.id ??
    context.state.session?.pluginId
  const modality = observation?.view.modality ??
    context.state.descriptor?.manifest.modality ??
    context.state.session?.modality
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
  renderers = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_RENDERERS
}: WorkspacePreviewPluginOutletProps): ReactElement {
  const observation = context.state.observation
  const pluginId = observation?.view.pluginId ??
    context.state.descriptor?.manifest.id ??
    context.state.session?.pluginId
  const modality = observation?.view.modality ??
    context.state.descriptor?.manifest.modality ??
    context.state.session?.modality
  const applyEdit = (operation: WorkspacePreviewEditOperation): Promise<void> =>
    applyWorkspacePreviewOutletEdit(context, operation)
  const renderer = resolveWorkspacePreviewPluginRendererContribution(context, routeReason, renderers)

  if (renderer) {
    return renderer.render({
      context,
      routeReason,
      observation,
      asset: context.asset,
      transport: context.transport,
      pluginId,
      modality,
      applyEdit
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
  const actions = observation?.actions ?? []
  const rows = [
    ['Modality', formatLabel(modality)],
    ['Mode', observation?.view.mode ?? session?.mode ?? 'preview'],
    ['Asset', context.asset?.primary ?? context.assetStatus],
    ['Selection', observation?.selection ? formatLabel(observation.selection.kind) : 'None'],
    ['Actions', actions.length ? actions.join(', ') : 'None']
  ]

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4 pr-20 text-sm text-ds-text"
      data-workspace-preview-plugin-summary
      data-route-reason={routeReason}
    >
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {context.assetError ? <p className="mt-1 text-xs text-ds-danger">{context.assetError}</p> : null}
      </header>
      <dl className="grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <dt className="text-ds-muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {observation?.visibleText ? (
        <pre className="min-h-0 overflow-auto whitespace-pre-wrap rounded-md bg-ds-panel p-3 text-xs">
          {observation.visibleText}
        </pre>
      ) : null}
    </section>
  )
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
