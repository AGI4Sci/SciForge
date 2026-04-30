import type { WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from './runtime-types.js';

export function emitWorkspaceRuntimeEvent(callbacks: WorkspaceRuntimeCallbacks | undefined, event: WorkspaceRuntimeEvent) {
  try {
    callbacks?.onEvent?.(event);
  } catch {
    // Runtime execution should not fail because a stream consumer disconnected.
  }
}

export function throwIfRuntimeAborted(callbacks?: WorkspaceRuntimeCallbacks) {
  if (callbacks?.signal?.aborted) {
    throw new Error('BioAgent run cancelled by user before the workspace task satisfied the request.');
  }
}
