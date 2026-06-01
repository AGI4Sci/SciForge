import type { ScenarioId } from '../../data';
import type { WorkspaceTerminalSession } from '../../api/workspaceClient';
import type { SettingsSectionId } from '../appShell/settingsPageModel';
import type { CommandTextUIAction, OpenDebugAuditUIAction } from '../uiActionBoundary';
import type { ResultsRendererViewModel } from '../results-renderer-view-model';
import type { ObjectAction, ObjectReference, PreviewDescriptor, RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import type { WorkspaceFileViewerOpenFileTab } from '../../../../../packages/presentation/components';
import { PrimaryResultAdapter } from './primaryResultAdapter';
import { browserAddressForFocusedObjectReference } from './browserPaneModel';
import { RightPaneBrowserTool } from './browserPaneHostAdapter';
import { RightPaneObjectFocusSurface } from './objectFocusAdapter';
import { ResultPaneWorkspaceFileViewer, RightPaneFilesTool } from './filesPaneHostAdapter';
import type { WorkspaceFileEditorState } from './filesPaneModel';
import { RightPaneTerminalTool as RightPaneTerminalLiveTool } from './terminalPaneHostAdapter';
import { RightPaneReferencesTool } from './referencesPaneHostAdapter';
import { RightPaneVirtualScreenTool } from './screenPaneHostAdapter';
import type { ResultFocusMode, ResultPaneTab } from './ResultShell';
import { resultText, type ResultLocale } from './resultLocale';

export interface RightPaneActiveSurfaceProps {
  hasOpenRightPaneTabs: boolean;
  resultTab: ResultPaneTab;
  activeResultTabId: string;
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  workspaceFileConfig: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  focusMode: ResultFocusMode;
  executionFocus: boolean;
  model: ResultsRendererViewModel;
  locale?: ResultLocale;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences: ObjectReference[];
  objectActionError: string;
  objectActionNotice: string;
  workspaceFileEditor: WorkspaceFileEditorState | null;
  activeFilesWorkspaceFileEditor: WorkspaceFileEditorState | null;
  workspaceFileOpenTabs: WorkspaceFileViewerOpenFileTab[];
  browserAddressDraft?: string;
  terminalSession?: WorkspaceTerminalSession;
  onBrowserAddressDraftChange: (nextAddress: string) => void;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
  onObjectAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClearFocusedObject: () => void;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  onObjectReferenceFocus: (reference: ObjectReference | undefined) => void;
  onWorkspaceFileEditorChange: (next: WorkspaceFileEditorState | null) => void;
  onCloseWorkspaceFileEditor: () => void;
  onConfigChange?: (patch: Partial<SciForgeConfig>) => void;
  onOpenSettings?: (section?: SettingsSectionId) => void;
  onTerminalSessionChange: (nextSession: WorkspaceTerminalSession | undefined) => void;
  onSelectOpenFile: (path: string) => void;
  onCloseOpenFile: (path: string) => void;
  onOpenFileEditor: (nextEditor: WorkspaceFileEditorState) => void;
  onCloseFileView: () => void;
  onActiveFileEditorChange: (nextEditor: WorkspaceFileEditorState | null) => void;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  onWorkbenchToolSelect: (tab: ResultPaneTab) => void;
}

export function RightPaneActiveSurface({
  hasOpenRightPaneTabs,
  resultTab,
  activeResultTabId,
  scenarioId,
  config,
  workspaceFileConfig,
  session,
  activeRun,
  focusMode,
  executionFocus,
  model,
  locale,
  focusedObjectReference,
  pinnedObjectReferences,
  objectActionError,
  objectActionNotice,
  workspaceFileEditor,
  activeFilesWorkspaceFileEditor,
  workspaceFileOpenTabs,
  browserAddressDraft,
  terminalSession,
  onBrowserAddressDraftChange,
  onCommandRequest,
  onObjectAction,
  onClearFocusedObject,
  onPreviewPackageRequest,
  onObjectReferenceFocus,
  onWorkspaceFileEditorChange,
  onCloseWorkspaceFileEditor,
  onConfigChange,
  onOpenSettings,
  onTerminalSessionChange,
  onSelectOpenFile,
  onCloseOpenFile,
  onOpenFileEditor,
  onCloseFileView,
  onActiveFileEditorChange,
  onArtifactHandoff,
  onInspectArtifact,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
  onWorkbenchToolSelect,
}: RightPaneActiveSurfaceProps) {
  if (!hasOpenRightPaneTabs) return <RightPaneEmptyWorkspace locale={locale} />;

  return (
    <>
      {resultTab !== 'files' && workspaceFileEditor ? (
        <ResultPaneWorkspaceFileViewer
          state={workspaceFileEditor}
          config={workspaceFileConfig}
          locale={locale}
          onChange={onWorkspaceFileEditorChange}
          onClose={onCloseWorkspaceFileEditor}
        />
      ) : null}
      <RightPaneObjectFocusSurface
        reference={focusedObjectReference}
        pinnedReferences={pinnedObjectReferences}
        session={session}
        config={config}
        locale={locale}
        error={objectActionError}
        notice={objectActionNotice}
        previewDisabled={Boolean(workspaceFileEditor)}
        suppressReferenceUi={executionFocus}
        onAction={onObjectAction}
        onClear={onClearFocusedObject}
        onPreviewPackageRequest={onPreviewPackageRequest}
        onObjectReferenceFocus={onObjectReferenceFocus}
      />
      {renderRightPaneActiveTool({
        resultTab,
        activeResultTabId,
        scenarioId,
        config,
        workspaceFileConfig,
        session,
        activeRun,
        focusMode,
        model,
        locale,
        focusedObjectReference,
        activeFilesWorkspaceFileEditor,
        workspaceFileOpenTabs,
        browserAddressDraft,
        terminalSession,
        onBrowserAddressDraftChange,
        onCommandRequest,
        onConfigChange,
        onOpenSettings,
        onTerminalSessionChange,
        onSelectOpenFile,
        onCloseOpenFile,
        onOpenFileEditor,
        onCloseFileView,
        onActiveFileEditorChange,
        onArtifactHandoff,
        onInspectArtifact,
        onObjectReferenceFocus,
        onDismissResultSlotPresentation,
        onCommandTextAction,
        onOpenDebugAuditAction,
        onWorkbenchToolSelect,
        onObjectAction,
        pinnedObjectReferences,
      })}
    </>
  );
}

function renderRightPaneActiveTool({
  resultTab,
  activeResultTabId,
  scenarioId,
  config,
  workspaceFileConfig,
  session,
  activeRun,
  focusMode,
  model,
  locale,
  focusedObjectReference,
  activeFilesWorkspaceFileEditor,
  workspaceFileOpenTabs,
  browserAddressDraft,
  terminalSession,
  onBrowserAddressDraftChange,
  onCommandRequest,
  onConfigChange,
  onOpenSettings,
  onTerminalSessionChange,
  onSelectOpenFile,
  onCloseOpenFile,
  onOpenFileEditor,
  onCloseFileView,
  onActiveFileEditorChange,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
  onWorkbenchToolSelect,
  onObjectAction,
  pinnedObjectReferences,
}: Omit<RightPaneActiveSurfaceProps, 'hasOpenRightPaneTabs' | 'executionFocus' | 'objectActionError' | 'objectActionNotice' | 'workspaceFileEditor' | 'onClearFocusedObject' | 'onWorkspaceFileEditorChange' | 'onCloseWorkspaceFileEditor'>) {
  if (resultTab === 'browser') {
    return (
      <RightPaneBrowserTool
        key={activeResultTabId}
        tabId={activeResultTabId}
        config={config}
        session={session}
        locale={locale}
        focusedObjectReference={focusedObjectReference}
        addressDraft={browserAddressForFocusedObjectReference(focusedObjectReference, session) ?? browserAddressDraft ?? 'about:blank'}
        onAddressDraftChange={onBrowserAddressDraftChange}
        onCommandRequest={onCommandRequest}
        onConfigChange={onConfigChange}
        onOpenSettings={onOpenSettings}
      />
    );
  }
  if (resultTab === 'screen') {
    return (
      <RightPaneVirtualScreenTool
        key={activeResultTabId}
        config={config}
        session={session}
        activeRun={activeRun}
        locale={locale}
        onCommandRequest={onCommandRequest}
      />
    );
  }
  if (resultTab === 'terminal') {
    return (
      <RightPaneTerminalLiveTool
        key={activeResultTabId}
        config={config}
        session={session}
        activeRun={activeRun}
        focusedObjectReference={focusedObjectReference}
        terminalSession={terminalSession}
        locale={locale}
        onConfigChange={onConfigChange}
        onOpenSettings={onOpenSettings}
        onTerminalSessionChange={onTerminalSessionChange}
      />
    );
  }
  if (resultTab === 'files') {
    return (
      <RightPaneFilesTool
        key={activeResultTabId}
        config={workspaceFileConfig}
        locale={locale}
        state={activeFilesWorkspaceFileEditor}
        openFileTabs={workspaceFileOpenTabs}
        onSelectOpenFile={onSelectOpenFile}
        onCloseOpenFile={onCloseOpenFile}
        onOpenFileEditor={onOpenFileEditor}
        onCloseFileView={onCloseFileView}
        onChange={onActiveFileEditorChange}
      />
    );
  }
  if (resultTab === 'primary') {
    return (
      <PrimaryResultAdapter
        key={activeResultTabId}
        scenarioId={scenarioId}
        config={config}
        session={session}
        activeRun={activeRun}
        focusMode={focusMode}
        model={model}
        locale={locale}
        onArtifactHandoff={onArtifactHandoff}
        onInspectArtifact={onInspectArtifact}
        onObjectReferenceFocus={onObjectReferenceFocus}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        onCommandTextAction={onCommandTextAction}
        onOpenDebugAuditAction={onOpenDebugAuditAction}
        onWorkbenchToolSelect={onWorkbenchToolSelect}
      />
    );
  }
  if (resultTab === 'evidence') {
    return (
      <RightPaneReferencesTool
        key={activeResultTabId}
        session={session}
        activeRun={activeRun}
        viewPlan={model.viewPlan}
        pinnedReferences={pinnedObjectReferences}
        locale={locale}
        onAction={onObjectAction}
      />
    );
  }
  return null;
}

export function RightPaneEmptyWorkspace({ locale }: { locale?: ResultLocale }) {
  return (
    <div className="right-pane-empty-workspace" data-testid="right-pane-empty-workspace">
      <strong>{resultText(locale, { 'zh-CN': '没有打开的页面', 'en-US': 'No pages open' })}</strong>
      <span>{resultText(locale, { 'zh-CN': '使用顶部 New 打开 Results、Browser、Screen、Terminal、Files 或 References。', 'en-US': 'Use New above to open Results, Browser, Screen, Terminal, Files, or References.' })}</span>
    </div>
  );
}
