import { join } from 'node:path';

import type { ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { workspaceRel } from './utils.js';
import {
  type ComputerUseTuiHostAction,
  computerUseResultToTuiHostActions,
} from './host-adapter.js';
import { tuiHostRunTaskChainPath } from './package-bridge-evidence.js';

export type PackageBridgePresentationState = {
  runDir: string;
};

export function attachPackageResultHostActions(
  payload: ToolPayload,
  packageResult: Record<string, unknown>,
  callbacks: WorkspaceRuntimeCallbacks,
  context?: {
    workspace: string;
    state: PackageBridgePresentationState;
    toolName: string;
  },
): ComputerUseTuiHostAction[] {
  const tuiHostActions = computerUseResultToTuiHostActions({
    ...packageResult,
    message: payload.message,
    executionUnits: payload.executionUnits,
    workEvidence: payload.workEvidence,
    artifacts: payload.artifacts,
    packageBridge: context ? packageBridgePresentationRefs(context.workspace, context.state, packageResult) : undefined,
  });
  if (!tuiHostActions.length) return [];
  payload.objectReferences = [
    ...(payload.objectReferences ?? []),
    {
      id: 'ref:computer-use-tui-host-actions',
      type: 'computer-use-tui-host-actions',
      data: {
        schemaVersion: 'sciforge.computer-use.tui-host-actions.bundle.v1',
        actions: tuiHostActions,
      },
    },
  ];
  payload.logs = [
    ...(payload.logs ?? []),
    {
      kind: 'computer-use-tui-host-actions',
      ref: 'audit:computer-use-tui-host-actions',
      actions: tuiHostActions,
    },
  ];
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'computer-use.tui-host-actions',
    source: 'computer-use-package-bridge',
    toolName: context?.toolName,
    status: 'done',
    message: 'Computer Use package result mapped to TUI Host gui.present/gui.ask_user action metadata.',
    detail: JSON.stringify({ actions: tuiHostActions }),
  });
  return tuiHostActions;
}

export function packageBridgePresentationRefs(
  workspace: string,
  state: PackageBridgePresentationState,
  packageResult: Record<string, unknown>,
) {
  const status = typeof packageResult.status === 'string' ? packageResult.status : undefined;
  const blocked = status !== 'completed';
  const ref = (filename: string) => workspaceRel(workspace, join(state.runDir, filename));
  return {
    tuiHostRunTaskChainRef: workspaceRel(workspace, tuiHostRunTaskChainPath(state.runDir)),
    directoryListingRef: ref('directory-listing.json'),
    blockedManifestRef: blocked ? ref('blocked-manifest.json') : undefined,
    repairHintRef: blocked ? ref('repair-hint.json') : undefined,
    continuationRequestRef: blocked ? ref('continuation-request.json') : undefined,
  };
}
