import { uiComponentManifests } from './manifest-registry';
import { uiComponentCompatibilityAliases } from './component-compatibility.js';
import type { UIComponentCompatibilityAlias } from './component-compatibility.js';
import type { UIComponentManifest } from './types';

export type { PresentationDedupeScope, UIComponentManifest, UIComponentWorkbenchDemo } from './types';
export type { UIComponentRenderer, UIComponentRendererProps } from './types';
export {
  defaultWorkbenchRecommendationInput,
  defaultWorkbenchDemoContext,
  normalizeWorkbenchFixtureArtifact,
  shouldBuildWorkbenchFigureQA,
  workbenchComponentFixtures,
  workbenchComponentRecommendationBoost,
  workbenchDemoVariants,
  workbenchExecutionSafetyLabel,
  workbenchListEmptyLabels,
  workbenchModuleDisplayLabels,
  workbenchSafetySummary,
  type WorkbenchDemoVariant,
} from './workbench-policy';
export { renderPackageWorkbenchPreview } from './workbench-renderers';
export {
  renderBrowserWorkbench,
  browserWorkbenchDefaultCommands,
  browserWorkbenchStateFromPayload,
  normalizeBrowserWorkbenchUrl,
} from './browser-workbench/render';
export type {
  BrowserWorkbenchAnnotationRequest,
  BrowserWorkbenchCommand,
  BrowserWorkbenchDefaultCommandOptions,
  BrowserWorkbenchEmbedPolicy,
  BrowserWorkbenchPayload,
  BrowserWorkbenchState,
  BrowserWorkbenchStateStatus,
} from './browser-workbench/render';
export {
  COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE,
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
  COMPUTER_USE_CONFIRMATION_RESULT_SCHEMA_VERSION,
  GUI_TERMINAL_EQUIVALENT_TEXT_SCHEMA_VERSION,
  computerUseControlPlaneCommand,
  computerUseControlPlaneConfirmationResult,
  computerUseControlPlaneDisplayedRefs,
  hasComputerUseControlPlanePresentation,
  normalizeComputerUseControlPlanePayload,
  type ComputerUseApprovalMode,
  type ComputerUseConfirmationDecision,
  type ComputerUseConfirmationResult,
  type ComputerUseControlPlaneAction,
  type ComputerUseControlPlanePayload,
  type ComputerUseControlPlaneStatus,
  type ComputerUseTerminalEquivalentText,
} from './computer-use-control-plane/contract';
export { renderComputerUseControlPlane, type ComputerUseControlPlaneCallbacks } from './computer-use-control-plane/render';
export { renderReportViewer, coerceReportPayload as coerceReportViewerPayload } from './report-viewer/render';
export { renderPaperCardList, paperCardListPresentationPolicy, type PaperCardPresentation } from './paper-card-list/render';
export { renderRecordTable } from './record-table/render';
export { renderGraphViewer } from './graph-viewer/render';
export { renderPointSetViewer } from './point-set-viewer/render';
export { renderMatrixViewer } from './matrix-viewer/render';
export { renderStructureViewer } from './structure-viewer/render';
export { renderTerminalSessionViewer } from './terminal-session-viewer/render';
export type {
  HostOwnedTerminalSession,
  TerminalCapabilities,
  TerminalMode,
  TerminalSessionAdapter,
  TerminalSessionPayload,
  TerminalSessionStatus,
} from './terminal-session-viewer/render';
export {
  IMAGE_EVIDENCE_VIEWER_ARTIFACT_TYPE,
  IMAGE_EVIDENCE_VIEWER_COMPONENT_ID,
  IMAGE_EVIDENCE_VIEWER_SCHEMA_VERSION,
} from './image-evidence-viewer/manifest';
export {
  IMAGE_EVIDENCE_SOURCE_KINDS,
  renderImageEvidenceViewer,
  type ImageEvidenceBounds,
  type ImageEvidencePayload,
  type ImageEvidenceSourceKind,
  type ImageEvidenceStatus,
} from './image-evidence-viewer/render';
export {
  WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES,
  WORKSPACE_FILE_VIEWER_DEFAULT_TREE_PAGE_SIZE,
  renderWorkspaceFileViewer,
  sortWorkspaceFileViewerEntries,
  WorkspaceFileViewer,
  workspaceFileViewerBasename,
  workspaceFileViewerParentPath,
  type WorkspaceFileViewerEntry,
  type WorkspaceFileViewerFile,
  type WorkspaceFileViewerOpenFileTab,
  type WorkspaceFileViewerFolderContinuation,
  type WorkspaceFileViewerFolderContinuationRequest,
  type WorkspaceFileViewerProps,
  type WorkspaceFileViewerViewMode,
} from './workspace-file-viewer/render';

export { interactiveViewManifests, uiComponentManifests } from './manifest-registry';
export {
  interactiveViewCompatibilityAliases,
  normalizeUIComponentId,
  uiComponentAliasTargetMap,
  uiComponentCompatibilityAliases,
} from './component-compatibility.js';

function compatibilityAliasManifest(
  alias: UIComponentCompatibilityAlias,
  manifests: UIComponentManifest[],
): UIComponentManifest {
  const target = manifests.find((module) => module.componentId === alias.activeComponentId)
    ?? manifests.find((module) => module.componentId === alias.routeComponentId);
  return {
    ...(target ?? manifests.find((module) => module.componentId === 'unknown-artifact-inspector') ?? manifests[0]),
    packageName: target?.packageName ?? `@sciforge-ui/${alias.legacyComponentId}`,
    moduleId: alias.legacyComponentId,
    title: target ? `${target.title} (${alias.legacyComponentId})` : alias.legacyComponentId,
    description: target ? `${alias.note} Routed to ${alias.routeComponentId}.` : alias.note,
    componentId: alias.legacyComponentId,
    acceptsArtifactTypes: target?.acceptsArtifactTypes ?? [],
    outputArtifactTypes: target?.outputArtifactTypes ?? [],
    fallbackModuleIds: Array.from(new Set([
      ...(target?.fallbackModuleIds ?? []),
      ...(alias.legacyComponentId === 'volcano-plot' ? ['generic-data-table'] : []),
    ])),
    docs: {
      readmePath: target?.docs.readmePath ?? 'packages/presentation/components/README.md',
      agentSummary: `${alias.legacyComponentId} is a compatibility alias for ${alias.routeComponentId}.`,
    },
  };
}

export function buildUIComponentRuntimeRegistry(
  manifests: UIComponentManifest[] = uiComponentManifests,
  aliases: readonly UIComponentCompatibilityAlias[] = uiComponentCompatibilityAliases,
): UIComponentManifest[] {
  return Array.from(
    new Map(
      [
        ...manifests,
        ...aliases.map((alias) => compatibilityAliasManifest(alias, manifests)),
      ].map((module) => [`${module.moduleId}@${module.version}:${module.componentId}`, module]),
    ).values(),
  );
}

export const uiComponentRuntimeRegistry: UIComponentManifest[] = buildUIComponentRuntimeRegistry();

export function buildUIComponentArtifactTypeIndex(manifests: UIComponentManifest[] = uiComponentManifests): Record<string, string[]> {
  const artifactTypes = manifests.reduce<Record<string, string[]>>((acc, module) => {
    const current = acc[module.componentId] ?? [];
    acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
    return acc;
  }, {});
  for (const alias of uiComponentCompatibilityAliases) {
    artifactTypes[alias.legacyComponentId] = artifactTypes[alias.activeComponentId] ?? artifactTypes[alias.routeComponentId] ?? [];
  }
  return artifactTypes;
}
