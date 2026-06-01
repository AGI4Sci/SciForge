import { useState } from 'react';
import type { ObjectAction, ObjectReference, RuntimeArtifact, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  performObjectReferenceAction,
  type ObjectReferenceActionResult,
} from '../results-renderer-object-actions';
import {
  createCommandTextUIAction,
  type CommandTextUIAction,
} from '../uiActionBoundary';
import type { ResultPaneTab } from './ResultShell';

export interface UseRightPaneActionControllerOptions {
  config: SciForgeConfig;
  session: SciForgeSession;
  onFocusedObjectChange: (reference: ObjectReference | undefined) => void;
  onActiveRunChange: (runId: string | undefined) => void;
  onResultTabActivate: (tab: ResultPaneTab) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
}

export interface RightPaneActionController {
  inspectedArtifact?: RuntimeArtifact;
  pinnedObjectReferences: ObjectReference[];
  objectActionError: string;
  objectActionNotice: string;
  setObjectActionError: (message: string) => void;
  requestCommandText: (commandText: string, label?: string, targetRef?: string) => void;
  handleObjectAction: (reference: ObjectReference, action: ObjectAction) => Promise<void>;
  inspectArtifact: (artifact: RuntimeArtifact) => void;
  closeInspectedArtifact: () => void;
}

export interface CreateRightPaneCommandTextActionInput {
  session: SciForgeSession;
  commandText: string;
  label?: string;
  targetRef?: string;
  id?: string;
  createdAt?: string;
}

export interface ApplyRightPaneObjectActionResultHandlers {
  onFocusedObjectChange: (reference: ObjectReference | undefined) => void;
  onActiveRunChange: (runId: string | undefined) => void;
  onResultTabActivate: (tab: ResultPaneTab) => void;
  setInspectedArtifact: (artifact: RuntimeArtifact) => void;
  setPinnedObjectReferences: (references: ObjectReference[]) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  setObjectActionNotice: (message: string) => void;
  setObjectActionError: (message: string) => void;
}

export function rightPaneActionId(prefix: string, suffix = Math.random().toString(36).slice(2, 10)) {
  return `${prefix}-${suffix}`;
}

export function createRightPaneCommandTextAction({
  session,
  commandText,
  label,
  targetRef,
  id = rightPaneActionId('command-right-pane'),
  createdAt = new Date().toISOString(),
}: CreateRightPaneCommandTextActionInput): CommandTextUIAction | undefined {
  if (!commandText.trim()) return undefined;
  return createCommandTextUIAction({
    session,
    id,
    createdAt,
    source: 'open',
    commandText,
    label,
    targetRef,
  });
}

export function applyRightPaneObjectActionResult(
  result: ObjectReferenceActionResult,
  handlers: ApplyRightPaneObjectActionResultHandlers,
) {
  if (result.focusReference) handlers.onFocusedObjectChange(result.focusReference);
  if (result.activeRunId) handlers.onActiveRunChange(result.activeRunId);
  if (result.resultTab) handlers.onResultTabActivate(result.resultTab);
  if (result.inspectedArtifact) handlers.setInspectedArtifact(result.inspectedArtifact);
  if (result.pinnedObjectReferences) handlers.setPinnedObjectReferences(result.pinnedObjectReferences);
  if (result.commandTextAction) handlers.onCommandTextAction?.(result.commandTextAction);
  if (result.notice) handlers.setObjectActionNotice(result.notice);
  if (result.error) handlers.setObjectActionError(result.error);
}

export function useRightPaneActionController({
  config,
  session,
  onFocusedObjectChange,
  onActiveRunChange,
  onResultTabActivate,
  onCommandTextAction,
}: UseRightPaneActionControllerOptions): RightPaneActionController {
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const [pinnedObjectReferences, setPinnedObjectReferences] = useState<ObjectReference[]>([]);
  const [objectActionError, setObjectActionError] = useState('');
  const [objectActionNotice, setObjectActionNotice] = useState('');

  function requestCommandText(commandText: string, label?: string, targetRef?: string) {
    const action = createRightPaneCommandTextAction({ session, commandText, label, targetRef });
    if (action) onCommandTextAction?.(action);
  }

  async function handleObjectAction(reference: ObjectReference, action: ObjectAction) {
    setObjectActionError('');
    setObjectActionNotice('');
    const result = await performObjectReferenceAction({
      action,
      config,
      pinnedObjectReferences,
      reference,
      session,
    });
    applyRightPaneObjectActionResult(result, {
      onFocusedObjectChange,
      onActiveRunChange,
      onResultTabActivate,
      setInspectedArtifact,
      setPinnedObjectReferences,
      onCommandTextAction,
      setObjectActionNotice,
      setObjectActionError,
    });
  }

  return {
    inspectedArtifact,
    pinnedObjectReferences,
    objectActionError,
    objectActionNotice,
    setObjectActionError,
    requestCommandText,
    handleObjectAction,
    inspectArtifact: setInspectedArtifact,
    closeInspectedArtifact: () => setInspectedArtifact(undefined),
  };
}
