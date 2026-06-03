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
  const normalizedCommandText = rightPaneCommandTextForAction(commandText, id);
  return createCommandTextUIAction({
    session,
    id,
    createdAt,
    source: 'open',
    commandText: normalizedCommandText,
    label,
    targetRef,
  });
}

function rightPaneCommandTextForAction(commandText: string, actionId: string) {
  if (!/^\/computer-use\s+screen\s+attach(?:\s|$)/.test(commandText.trim())) return commandText;
  const scope = safeRightPaneCommandScope(actionId);
  const refs = {
    screenRef: `virtual-app-screen:${scope}/screen-request`,
    activationRef: `computer-use:screen-activation/${scope}/attach-request.json`,
    adapterReadinessRef: `computer-use:screen-activation/${scope}/provider-readiness.json`,
    platformDriverRef: `computer-use:screen-activation/${scope}/platform-driver.json`,
    permissionRef: `computer-use:screen-activation/${scope}/permissions/platform-gates.json`,
    evidenceLedgerRef: `ledger:computer-use/${scope}/screen-activation.json`,
    guiPresentRef: `gui.present:${scope}/screen-pane-activation`,
  };
  let rewritten = [
    ['preflight-ref'],
    ['preflight-ledger-ref'],
    ['preflight-ledger-entry-ref'],
    ['host-readiness-ref'],
  ].reduce((next, [flag]) => removeTerminalFlag(next, flag), commandText);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'screen-ref', refs.screenRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'activation-ref', refs.activationRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'adapter-readiness-ref', refs.adapterReadinessRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'platform-driver-ref', refs.platformDriverRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'permission-ref', refs.permissionRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'evidence-ledger-ref', refs.evidenceLedgerRef);
  rewritten = replaceOrAppendTerminalFlag(rewritten, 'gui-present-ref', refs.guiPresentRef);
  return rewritten;
}

function safeRightPaneCommandScope(actionId: string) {
  const normalized = actionId.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized ? `right-pane-${normalized}` : 'right-pane-command';
}

function replaceOrAppendTerminalFlag(commandText: string, flag: string, value: string) {
  const withoutFlag = removeTerminalFlag(commandText, flag);
  return `${withoutFlag.trim()} --${flag} ${terminalQuote(value)}`;
}

function removeTerminalFlag(commandText: string, flag: string) {
  const flagPattern = escapeRegExp(`--${flag}`);
  return commandText.replace(new RegExp(`\\s+${flagPattern}(?:\\s+(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|\\S+))?`, 'g'), '');
}

function terminalQuote(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
