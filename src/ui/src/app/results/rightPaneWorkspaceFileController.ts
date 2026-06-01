import { useMemo, useState } from 'react';
import { normalizeWorkspaceRootPath } from '../../config';
import type { ResultPaneTab, ResultPaneTabInstance } from './ResultShell';
import { baseResultPaneTabId, queueRightPaneFocus, type RightPaneTabLifecycleTransition } from './resultPaneLifecycle';
import { resultText, type ResultLocale } from './resultLocale';
import {
  removeWorkspaceFileEditorForTab,
  planWorkspaceFileTabOpen,
  setWorkspaceFileEditorForTab,
  workspaceFileEditorIsDirty,
  workspaceFileEditorMatchesPath,
  workspaceFileEditorWithEditMode,
  workspaceFileOpenTabsForRightPaneTabs,
  type WorkspaceFileEditorState,
  type WorkspaceFileEditorsByTabId,
} from './filesPaneModel';

export interface UseRightPaneWorkspaceFileControllerOptions {
  locale?: ResultLocale;
  initialWorkspaceFileEditor: WorkspaceFileEditorState | null;
  resultTabs: ResultPaneTabInstance[];
  activeResultTabId: string;
  resultTab: ResultPaneTab;
  onResultTabChange: (tabId: string) => void;
  onNewFilesTab: (onOpened: (nextState: RightPaneTabLifecycleTransition) => void) => void;
}

export function workspaceFileDiscardConfirmationMessage(locale?: ResultLocale) {
  return resultText(locale, {
    'zh-CN': '这个文件有未保存的更改。是否丢弃草稿并关闭？',
    'en-US': 'This file has unsaved changes. Discard the draft and close it?',
  });
}

export function useRightPaneWorkspaceFileController({
  locale,
  initialWorkspaceFileEditor,
  resultTabs,
  activeResultTabId,
  resultTab,
  onResultTabChange,
  onNewFilesTab,
}: UseRightPaneWorkspaceFileControllerOptions) {
  const [workspaceFileEditorsByTabId, setWorkspaceFileEditorsByTabId] = useState<WorkspaceFileEditorsByTabId>(() => (
    initialWorkspaceFileEditor
      ? { [baseResultPaneTabId('files')]: workspaceFileEditorWithEditMode(initialWorkspaceFileEditor, Boolean(initialWorkspaceFileEditor.editMode)) }
      : {}
  ));
  const activeFilesWorkspaceFileEditor = resultTab === 'files'
    ? workspaceFileEditorsByTabId[activeResultTabId] ?? null
    : null;
  const workspaceFileOpenTabs = useMemo(
    () => workspaceFileOpenTabsForRightPaneTabs(resultTabs, workspaceFileEditorsByTabId),
    [resultTabs, workspaceFileEditorsByTabId],
  );

  function confirmDiscardWorkspaceFileEditor(editor: WorkspaceFileEditorState | null | undefined) {
    if (!workspaceFileEditorIsDirty(editor)) return true;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
    return window.confirm(workspaceFileDiscardConfirmationMessage(locale));
  }

  function openWorkspaceFileEditorInRightPane(nextEditor: WorkspaceFileEditorState, workspaceRoot: string | undefined) {
    const plan = planWorkspaceFileTabOpen({
      tabs: resultTabs,
      editorsByTabId: workspaceFileEditorsByTabId,
      activeTabId: activeResultTabId,
      workspaceRoot: normalizeWorkspaceRootPath(nextEditor.workspacePath || workspaceRoot || ''),
      nextEditor,
    });
    if (plan.action === 'focus-existing') {
      onResultTabChange(plan.tabId);
      queueRightPaneFocus({ kind: 'tab', tabId: plan.tabId });
      return;
    }
    if (plan.action === 'reuse-active') {
      setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, plan.tabId, nextEditor));
      onResultTabChange(plan.tabId);
      queueRightPaneFocus({ kind: 'tab', tabId: plan.tabId });
      return;
    }
    onNewFilesTab((nextState) => {
      setWorkspaceFileEditorsByTabId((editors) => setWorkspaceFileEditorForTab(editors, nextState.activeTabId, nextEditor));
    });
  }

  function closeActiveWorkspaceFileView() {
    if (!confirmDiscardWorkspaceFileEditor(activeFilesWorkspaceFileEditor)) return;
    setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, activeResultTabId, null));
  }

  function canCloseWorkspaceFileTab(tabId: string, tab: ResultPaneTabInstance | undefined) {
    return tab?.kind !== 'files' || confirmDiscardWorkspaceFileEditor(workspaceFileEditorsByTabId[tabId]);
  }

  function cleanupClosedWorkspaceFileTab(tabId: string) {
    setWorkspaceFileEditorsByTabId((current) => removeWorkspaceFileEditorForTab(current, tabId));
  }

  function setActiveWorkspaceFileEditor(nextEditor: WorkspaceFileEditorState | null) {
    setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, activeResultTabId, nextEditor));
  }

  function tabIdForWorkspaceFilePath(path: string, workspaceRoot: string | undefined) {
    return resultTabs.find((tab) => (
      tab.kind === 'files'
      && workspaceFileEditorMatchesPath(workspaceFileEditorsByTabId[tab.id]?.file.path, path, workspaceRoot ?? '')
    ))?.id;
  }

  function selectOpenFile(path: string, workspaceRoot: string | undefined) {
    const tabId = tabIdForWorkspaceFilePath(path, workspaceRoot);
    if (tabId) onResultTabChange(tabId);
  }

  function closeOpenFile(path: string, workspaceRoot: string | undefined, onCloseTab: (tabId: string) => void) {
    const tabId = tabIdForWorkspaceFilePath(path, workspaceRoot);
    if (tabId) onCloseTab(tabId);
  }

  return {
    workspaceFileEditorsByTabId,
    setWorkspaceFileEditorsByTabId,
    activeFilesWorkspaceFileEditor,
    workspaceFileOpenTabs,
    openWorkspaceFileEditorInRightPane,
    closeActiveWorkspaceFileView,
    canCloseWorkspaceFileTab,
    cleanupClosedWorkspaceFileTab,
    setActiveWorkspaceFileEditor,
    selectOpenFile,
    closeOpenFile,
  };
}
