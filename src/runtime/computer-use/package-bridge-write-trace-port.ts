import { isRecord } from '../gateway-utils.js';
import type { ComputerUseConfig } from './types.js';
import { promotePackageResultFinalArtifactRefs } from './package-bridge-final-artifacts.js';
import {
  writePackageBridgeTrace,
  type PackageBridgeTraceState,
} from './package-bridge-trace.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import { workspaceRel } from './utils.js';

export async function writePackageBridgeTracePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    state: PackageBridgeTraceState;
  },
) {
  const packageResult = recordArg(call, 0);
  promotePackageResultFinalArtifactRefs(packageResult, context.workspace, context.state);
  return workspaceRel(context.workspace, await writePackageBridgeTrace({
    ...context,
    request: undefined,
    packageResult,
  }));
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
}
