import { useMemo } from 'react';
import type { ScenarioId } from '../data';
import { ResultShell, type ResultFocusMode, type ResultPaneTab } from './results/ResultShell';
import { resultLocale } from './results/resultLocale';
export { handoffAutoRunPrompt, previewPackageAutoRunPrompt } from './results/autoRunPrompts';
import {
  createResultsRendererViewModel,
} from './results-renderer-view-model';
export { selectDefaultResultItems, type HandoffAutoRunRequest } from './results/viewPlanResolver';
export { coerceReportPayload } from './results/reportContent';
import { type SciForgeConfig, type SciForgeSession, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type UIManifestSlot } from '../domain';
export {
  backendRepairStates,
  contractValidationFailures,
  runAuditRefs,
  runPresentationState,
  runRecoverActions,
  shouldDefaultOpenRunAuditDetails,
  shouldOpenRunAuditDetails,
} from './results-renderer-execution-model';
import {
  renderRegisteredWorkbenchSlot,
  type WorkbenchSlotRenderProps,
} from './results-renderer-registry-slot';
import {
  type CommandTextUIAction,
  type OpenDebugAuditUIAction,
} from './uiActionBoundary';
import type { SettingsSectionId } from './appShell/settingsPageModel';
export {
  requestOpenDebugAuditThroughUserActionApi,
  requestRecoverCommandTextAction,
} from './results/primaryAuditAdapter';
import type { WorkspaceFileEditorState } from './results/filesPaneModel';
import { useFocusedWorkspaceFileHydration } from './results/filesPaneFocusHydration';
import { RightPaneActiveSurface } from './results/rightPaneSurfaceAdapter';
import { useRightPaneTabController } from './results/rightPaneTabController';
import { useRightPaneWorkspaceFileController } from './results/rightPaneWorkspaceFileController';
import { useRightPaneActionController } from './results/rightPaneActionController';
import { useRightPaneTerminalController } from './results/rightPaneTerminalController';
import { RightPaneArtifactInspectorDrawer } from './results/rightPaneArtifactInspectorAdapter';
import { useRightPaneLifecycleController } from './results/rightPaneLifecycleController';

export { renderRegisteredWorkbenchSlot };
export type { WorkbenchSlotRenderProps };
export type { WorkspaceFileEditorState } from './results/filesPaneModel';

export function ResultsRenderer({
  scenarioId,
  config,
  session,
  defaultSlots,
  onArtifactHandoff,
  collapsed,
  onToggleCollapse,
  activeRunId,
  onActiveRunChange,
  focusedObjectReference,
  onFocusedObjectChange,
  onPreviewPackageRequest,
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
  onConfigChange,
  onOpenSettings,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
  initialFocusMode = 'all',
  initialResultTab = 'primary',
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  defaultSlots: UIManifestSlot[];
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  focusedObjectReference?: ObjectReference;
  onFocusedObjectChange: (reference: ObjectReference | undefined) => void;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  workspaceFileEditor: WorkspaceFileEditorState | null;
  onWorkspaceFileEditorChange: (next: WorkspaceFileEditorState | null) => void;
  onConfigChange?: (patch: Partial<SciForgeConfig>) => void;
  onOpenSettings?: (section?: SettingsSectionId) => void;
  /** Hide a resolved results card from the UI only (artifacts and workspace files stay). */
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  /** Test hook for rendering a non-default focus mode without browser events. */
  initialFocusMode?: ResultFocusMode;
  /** Test hook for rendering a non-default right-pane tab without browser events. */
  initialResultTab?: ResultPaneTab;
}) {
  const locale = resultLocale(config.locale);
  const {
    resultTabs,
    activeResultTabId,
    resultTab,
    focusMode,
    activeBrowserAddress,
    hasOpenRightPaneTabs,
    activateResultTabKind,
    handleResultTabChange,
    handleNewResultTab,
    handleCloseResultTab: closeRightPaneTab,
    handleFocusModeChange,
    setActiveBrowserAddress,
  } = useRightPaneTabController({
    config,
    locale,
    initialFocusMode,
    initialResultTab,
    focusedObjectReference,
  });
  const rightPaneTerminalController = useRightPaneTerminalController({
    config,
    sessionId: session.sessionId,
    activeResultTabId,
  });
  const workspaceFileController = useRightPaneWorkspaceFileController({
    locale,
    initialWorkspaceFileEditor: workspaceFileEditor,
    resultTabs,
    activeResultTabId,
    resultTab,
    onResultTabChange: handleResultTabChange,
    onNewFilesTab: (onOpened) => handleNewResultTab('files', onOpened),
  });
  const rightPaneActionController = useRightPaneActionController({
    config,
    session,
    onFocusedObjectChange,
    onActiveRunChange,
    onResultTabActivate: activateResultTabKind,
    onCommandTextAction,
  });
  const rightPaneLifecycleController = useRightPaneLifecycleController({
    closeRightPaneTab,
    canCloseWorkspaceFileTab: workspaceFileController.canCloseWorkspaceFileTab,
    closeTerminalTab: rightPaneTerminalController.closeTerminalTab,
    cleanupClosedWorkspaceFileTab: workspaceFileController.cleanupClosedWorkspaceFileTab,
  });
  const executionFocus = focusMode === 'execution';
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const rendererModel = useMemo(() => createResultsRendererViewModel({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences: rightPaneActionController.pinnedObjectReferences,
    focusMode,
    locale,
  }), [scenarioId, session, defaultSlots, activeRun, focusedObjectReference, rightPaneActionController.pinnedObjectReferences, focusMode, locale]);
  const { workspaceFileConfig } = useFocusedWorkspaceFileHydration({
    config,
    session,
    focusedObjectReference,
    executionFocus,
    resultTab,
    activeResultTabId,
    activeFilesWorkspaceFileEditor: workspaceFileController.activeFilesWorkspaceFileEditor,
    workspaceFileEditor,
    onWorkspaceFileEditorChange,
    setWorkspaceFileEditorsByTabId: workspaceFileController.setWorkspaceFileEditorsByTabId,
    onError: rightPaneActionController.setObjectActionError,
  });
  return (
    <ResultShell
      collapsed={collapsed}
      activeTabId={activeResultTabId}
      resultTab={resultTab}
      resultTabs={resultTabs}
      focusMode={focusMode}
      activeRun={activeRun}
      scenarioId={scenarioId}
      locale={locale}
      onToggleCollapse={onToggleCollapse}
      onResultTabChange={handleResultTabChange}
      onNewResultTab={handleNewResultTab}
      onCloseResultTab={rightPaneLifecycleController.closeResultTab}
      onFocusModeChange={handleFocusModeChange}
      onActiveRunChange={onActiveRunChange}
      showActiveRunBanner={resultTab === 'primary'}
      drawer={(
        <RightPaneArtifactInspectorDrawer
          scenarioId={scenarioId}
          session={session}
          artifact={rightPaneActionController.inspectedArtifact}
          executionFocus={executionFocus}
          onClose={rightPaneActionController.closeInspectedArtifact}
          onArtifactHandoff={onArtifactHandoff}
        />
      )}
    >
      <RightPaneActiveSurface
        hasOpenRightPaneTabs={hasOpenRightPaneTabs}
        resultTab={resultTab}
        activeResultTabId={activeResultTabId}
        scenarioId={scenarioId}
        config={config}
        workspaceFileConfig={workspaceFileConfig}
        session={session}
        activeRun={activeRun}
        focusMode={focusMode}
        executionFocus={executionFocus}
        model={rendererModel}
        locale={locale}
        focusedObjectReference={focusedObjectReference}
        pinnedObjectReferences={rightPaneActionController.pinnedObjectReferences}
        objectActionError={rightPaneActionController.objectActionError}
        objectActionNotice={rightPaneActionController.objectActionNotice}
        workspaceFileEditor={workspaceFileEditor}
        activeFilesWorkspaceFileEditor={workspaceFileController.activeFilesWorkspaceFileEditor}
        workspaceFileOpenTabs={workspaceFileController.workspaceFileOpenTabs}
        browserAddressDraft={activeBrowserAddress}
        terminalSession={rightPaneTerminalController.activeTerminalSession}
        onBrowserAddressDraftChange={setActiveBrowserAddress}
        onCommandRequest={rightPaneActionController.requestCommandText}
        onObjectAction={rightPaneActionController.handleObjectAction}
        onClearFocusedObject={() => onFocusedObjectChange(undefined)}
        onPreviewPackageRequest={onPreviewPackageRequest}
        onObjectReferenceFocus={onFocusedObjectChange}
        onWorkspaceFileEditorChange={onWorkspaceFileEditorChange}
        onCloseWorkspaceFileEditor={() => {
          onWorkspaceFileEditorChange(null);
          onFocusedObjectChange(undefined);
        }}
        onConfigChange={onConfigChange}
        onOpenSettings={onOpenSettings}
        onTerminalSessionChange={rightPaneTerminalController.setActiveTerminalSession}
        onSelectOpenFile={(path) => workspaceFileController.selectOpenFile(path, workspaceFileConfig.workspacePath)}
        onCloseOpenFile={(path) => workspaceFileController.closeOpenFile(path, workspaceFileConfig.workspacePath, rightPaneLifecycleController.closeResultTab)}
        onOpenFileEditor={(nextEditor) => workspaceFileController.openWorkspaceFileEditorInRightPane(nextEditor, workspaceFileConfig.workspacePath)}
        onCloseFileView={workspaceFileController.closeActiveWorkspaceFileView}
        onActiveFileEditorChange={workspaceFileController.setActiveWorkspaceFileEditor}
        onArtifactHandoff={onArtifactHandoff}
        onInspectArtifact={rightPaneActionController.inspectArtifact}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        onCommandTextAction={onCommandTextAction}
        onOpenDebugAuditAction={onOpenDebugAuditAction}
        onWorkbenchToolSelect={activateResultTabKind}
      />
    </ResultShell>
  );
}
