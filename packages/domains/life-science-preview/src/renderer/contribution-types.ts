import type { ReactElement } from 'react'
import type {
  RendererWorkspacePreviewPluginSlotContribution,
  WorkspaceObservation,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewEditOperation,
  WorkspacePreviewPluginManifest,
  WorkspacePreviewSession,
  WorkspaceStructuredSelection
} from '@sciforge/domain-sdk/workspace-preview'
import type { WorkspacePreviewAssetTransportClient } from './transport'

export type WorkspacePreviewInspectorRow = Readonly<{
  id: string
  label: string
  value: string
  description?: string
}>

export type WorkspacePreviewInspectorSection = Readonly<{
  id: string
  title: string
  summary?: string
  rows: readonly WorkspacePreviewInspectorRow[]
}>

type WorkspacePreviewActionHost = Readonly<{
  invokeAction: (
    sessionId: string,
    action: Readonly<{ actionId: string; input: Record<string, unknown> }>
  ) => Promise<
    | Readonly<{ ok: true; result: unknown }>
    | Readonly<{ ok: false; message: string }>
  >
  setSelection: (
    selection: WorkspaceStructuredSelection,
    options: Readonly<{ sessionId: string; path: string }>
  ) => Promise<
    | Readonly<{ ok: true } & Record<string, unknown>>
    | Readonly<{ ok: false; message: string }>
  >
}>

export type WorkspacePreviewContributionContext = Readonly<{
  state: Readonly<{
    session: WorkspacePreviewSession | null
    observation: WorkspaceObservation | null
  }>
  assetStatus: 'idle' | 'loading' | 'ready' | 'error'
  assetError: string | null
  host: WorkspacePreviewActionHost
}>

export type WorkspacePreviewActionContribution = Readonly<{
  id: string
  label: string
  requiresExplicitUi?: boolean
  run: (context: WorkspacePreviewContributionContext) => Promise<Record<string, unknown>>
}>

export type WorkspacePreviewPluginRendererInput = Readonly<{
  context: WorkspacePreviewContributionContext
  observation: WorkspaceObservation | null
  asset: WorkspacePreviewAssetTransportDescriptor | null
  transport: WorkspacePreviewAssetTransportClient
  applyEdit: (operation: WorkspacePreviewEditOperation) => Promise<void>
}>

export type LifeScienceRendererWorkspacePreviewContribution =
  RendererWorkspacePreviewPluginSlotContribution<
    (input: WorkspacePreviewPluginRendererInput) => ReactElement,
    WorkspacePreviewActionContribution,
    (observation: WorkspaceObservation) => readonly WorkspacePreviewInspectorSection[],
    WorkspaceStructuredSelection['kind'],
    (selection: WorkspaceStructuredSelection) => WorkspacePreviewInspectorSection
  >

export type LifeScienceRendererContributionValue =
  | LifeScienceRendererWorkspacePreviewContribution
  | Readonly<{ activate: () => void | (() => void) }>

export type ManifestById = Readonly<Record<string, WorkspacePreviewPluginManifest>>
