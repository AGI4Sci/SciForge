import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { VISION_TOOL_ID } from '../vision-sense/computer-use-trace-output.js';
import type { HostPortCall } from './package-bridge-stdio.js';

export function emitPackageBridgeEventPort(
  call: HostPortCall,
  context: { callbacks: WorkspaceRuntimeCallbacks },
) {
  const event = recordArg(call, 0);
  emitWorkspaceRuntimeEvent(context.callbacks, {
    type: stringAt(event, 'type') ?? 'computer-use.package.event',
    source: 'computer-use-package-bridge',
    toolName: VISION_TOOL_ID,
    status: stringAt(event, 'status') ?? 'running',
    message: stringAt(event, 'reason') ?? stringAt(event, 'task') ?? stringAt(event, 'type'),
    detail: JSON.stringify(event),
  });
  return { ok: true };
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}
