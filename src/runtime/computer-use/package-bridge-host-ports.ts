import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import {
  computerUsePackageStdioHostPortNames,
  isComputerUseForbiddenHostPortName,
  type ComputerUseHostPortHandlers,
  type ComputerUsePackageStdioHostPortName,
} from '../../../packages/actions/computer-use/host-adapter-contract.js';
import type { HostPortCall } from './package-bridge-stdio.js';

export const packageBridgeHostPortNames = computerUsePackageStdioHostPortNames;

export type PackageBridgeHostPortName = ComputerUsePackageStdioHostPortName;

export type PackageBridgeHostPortHandler = (call: HostPortCall) => Promise<unknown> | unknown;

export type PackageBridgeHostPortHandlers = ComputerUseHostPortHandlers<HostPortCall>;

export async function dispatchPackageBridgeHostPortCall(
  call: HostPortCall,
  options: {
    callbacks: WorkspaceRuntimeCallbacks;
    handlers: PackageBridgeHostPortHandlers;
  },
): Promise<unknown> {
  if (options.callbacks.signal?.aborted && call.port !== 'execute') {
    throw new Error('Computer Use host port call aborted by workspace runtime signal.');
  }
  if (isComputerUseForbiddenHostPortName(call.port)) {
    throw new Error(`Forbidden Computer Use host port: ${call.port}. High-risk actions must return approval refs/sidecars for the TUI Host boundary.`);
  }
  const handler = isPackageBridgeHostPortName(call.port)
    ? options.handlers[call.port]
    : undefined;
  if (!handler) {
    throw new Error(`Unsupported Computer Use host port: ${call.port}`);
  }
  return handler(call);
}

function isPackageBridgeHostPortName(port: string): port is PackageBridgeHostPortName {
  return (packageBridgeHostPortNames as readonly string[]).includes(port);
}
