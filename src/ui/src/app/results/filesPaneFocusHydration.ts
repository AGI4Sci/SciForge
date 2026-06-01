import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { normalizeWorkspaceRootPath } from '../../config';
import type { ObjectReference, SciForgeConfig, SciForgeSession } from '../../domain';
import { pathForObjectReference } from '../../../../../packages/support/object-references';
import { canHydrateWorkspaceObjectPath } from './workspaceObjectPreviewModel';
import {
  focusedWorkspaceRootForReference,
  readFocusedWorkspaceFile,
} from './filesPaneFocus';
import {
  setWorkspaceFileEditorForTab,
  workspaceFileEditorMatchesPath,
  workspaceFileFocusRequestKey,
  workspaceFileViewerDraftForFile,
  type WorkspaceFileEditorState,
  type WorkspaceFileEditorsByTabId,
} from './filesPaneModel';

export interface FocusedWorkspaceFileConfigInput {
  config: SciForgeConfig;
  activeFilesWorkspaceFileEditor: WorkspaceFileEditorState | null;
  workspaceFileEditor: WorkspaceFileEditorState | null;
  focusedWorkspaceFileRequestKey: string;
  focusedWorkspaceRoot: string;
}

export interface FocusedWorkspaceFileHydrationInput {
  config: SciForgeConfig;
  activeFilesWorkspaceFileEditor: WorkspaceFileEditorState | null;
  workspaceFileEditor: WorkspaceFileEditorState | null;
  focusedWorkspaceFileRequestKey?: string;
  focusedWorkspaceRoot?: string;
  session: SciForgeSession;
  focusedObjectReference?: ObjectReference;
  executionFocus: boolean;
  resultTab: string;
  activeResultTabId: string;
  onWorkspaceFileEditorChange: (next: WorkspaceFileEditorState | null) => void;
  setWorkspaceFileEditorsByTabId: Dispatch<SetStateAction<WorkspaceFileEditorsByTabId>>;
  onError: (message: string) => void;
}

export function focusedWorkspaceFilePathForReference(
  reference: ObjectReference | undefined,
  session: SciForgeSession,
) {
  if (!reference || reference.kind !== 'file') return '';
  const path = pathForObjectReference(reference, session)?.trim() ?? '';
  if (!path || !canHydrateWorkspaceObjectPath(path)) return '';
  return path;
}

export function focusedWorkspaceFileConfigForState({
  config,
  activeFilesWorkspaceFileEditor,
  workspaceFileEditor,
  focusedWorkspaceFileRequestKey,
  focusedWorkspaceRoot,
}: FocusedWorkspaceFileConfigInput): SciForgeConfig {
  const editor = activeFilesWorkspaceFileEditor ?? workspaceFileEditor;
  const editorRoot = activeFilesWorkspaceFileEditor?.workspacePath
    || (editor?.focusRequestKey === focusedWorkspaceFileRequestKey
      ? editor?.workspacePath
      : undefined);
  const root = normalizeWorkspaceRootPath(editorRoot || focusedWorkspaceRoot);
  return root && root !== normalizeWorkspaceRootPath(config.workspacePath)
    ? { ...config, workspacePath: root }
    : config;
}

export function shouldHydrateFocusedWorkspaceFile({
  executionFocus,
  focusedWorkspaceFilePath,
  currentEditor,
  focusedWorkspaceFileRequestKey,
  workspaceFileConfig,
}: {
  executionFocus: boolean;
  focusedWorkspaceFilePath: string;
  currentEditor: WorkspaceFileEditorState | null | undefined;
  focusedWorkspaceFileRequestKey: string;
  workspaceFileConfig: SciForgeConfig;
}) {
  if (executionFocus || !focusedWorkspaceFilePath) return false;
  if (currentEditor?.focusRequestKey === focusedWorkspaceFileRequestKey) return false;
  if (workspaceFileEditorMatchesPath(currentEditor?.file.path, focusedWorkspaceFilePath, workspaceFileConfig.workspacePath)) return false;
  return true;
}

export function useFocusedWorkspaceFileHydration({
  config,
  session,
  focusedObjectReference,
  executionFocus,
  resultTab,
  activeResultTabId,
  activeFilesWorkspaceFileEditor,
  workspaceFileEditor,
  focusedWorkspaceFileRequestKey: injectedRequestKey,
  focusedWorkspaceRoot: injectedWorkspaceRoot,
  onWorkspaceFileEditorChange,
  setWorkspaceFileEditorsByTabId,
  onError,
}: FocusedWorkspaceFileHydrationInput) {
  const focusedWorkspaceFilePath = useMemo(
    () => focusedWorkspaceFilePathForReference(focusedObjectReference, session),
    [focusedObjectReference, session],
  );
  const focusedWorkspaceFileRequestKey = useMemo(
    () => injectedRequestKey || workspaceFileFocusRequestKey(focusedObjectReference, focusedWorkspaceFilePath),
    [focusedObjectReference, focusedWorkspaceFilePath, injectedRequestKey],
  );
  const focusedWorkspaceRoot = useMemo(
    () => injectedWorkspaceRoot || focusedWorkspaceRootForReference(focusedObjectReference, session, config.workspacePath),
    [config.workspacePath, focusedObjectReference, injectedWorkspaceRoot, session],
  );
  const workspaceFileConfig = useMemo(
    () => focusedWorkspaceFileConfigForState({
      config,
      activeFilesWorkspaceFileEditor,
      workspaceFileEditor,
      focusedWorkspaceFileRequestKey,
      focusedWorkspaceRoot,
    }),
    [activeFilesWorkspaceFileEditor, config, focusedWorkspaceFileRequestKey, focusedWorkspaceRoot, workspaceFileEditor],
  );

  useEffect(() => {
    const currentEditor = resultTab === 'files' ? activeFilesWorkspaceFileEditor : workspaceFileEditor;
    if (!shouldHydrateFocusedWorkspaceFile({
      executionFocus,
      focusedWorkspaceFilePath,
      currentEditor,
      focusedWorkspaceFileRequestKey,
      workspaceFileConfig,
    })) return undefined;
    let cancelled = false;
    onError('');
    void readFocusedWorkspaceFile({
      path: focusedWorkspaceFilePath,
      config: workspaceFileConfig,
      reference: focusedObjectReference,
    })
      .then(({ file, workspacePath }) => {
        if (cancelled) return;
        const nextEditor = {
          file,
          draft: workspaceFileViewerDraftForFile(file),
          workspacePath,
          focusRequestKey: focusedWorkspaceFileRequestKey,
          editMode: false,
        };
        if (resultTab === 'files') {
          setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, activeResultTabId, nextEditor));
        } else {
          onWorkspaceFileEditorChange(nextEditor);
        }
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeFilesWorkspaceFileEditor,
    activeResultTabId,
    executionFocus,
    focusedWorkspaceFilePath,
    focusedWorkspaceFileRequestKey,
    focusedObjectReference,
    onError,
    onWorkspaceFileEditorChange,
    resultTab,
    setWorkspaceFileEditorsByTabId,
    workspaceFileConfig,
    workspaceFileEditor,
  ]);

  return {
    focusedWorkspaceFilePath,
    focusedWorkspaceFileRequestKey,
    focusedWorkspaceRoot,
    workspaceFileConfig,
  };
}
