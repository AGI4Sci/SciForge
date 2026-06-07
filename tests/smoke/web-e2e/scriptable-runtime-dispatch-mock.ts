import { startScriptableBackendMock } from './scriptable-backend-mock.js';
import type {
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerMockOptions,
  ScriptableAgentServerToolPayload,
} from './types.js';

export type ScriptableRuntimeDispatchMockHandle = ScriptableAgentServerMockHandle;
export type ScriptableRuntimeDispatchMockOptions = ScriptableAgentServerMockOptions;
export type ScriptableRuntimeDispatchToolPayload = ScriptableAgentServerToolPayload;

export const RUNTIME_DISPATCH_RUN_STREAM_PATH = '/api/runtime-dispatch/runs/stream';

export function startScriptableRuntimeDispatchMock(
  options: ScriptableRuntimeDispatchMockOptions = {},
): Promise<ScriptableRuntimeDispatchMockHandle> {
  return startScriptableBackendMock(options);
}
