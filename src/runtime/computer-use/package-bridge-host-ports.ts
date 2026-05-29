import type { WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import type { HostPortCall } from './package-bridge-stdio.js';

export const packageBridgeHostPortNames = [
  'capture',
  'plan',
  'locate',
  'execute',
  'verify',
  'writeTrace',
  'emitEvent',
] as const;

export type PackageBridgeHostPortName = (typeof packageBridgeHostPortNames)[number];

export type PackageBridgeHostPortHandler = (call: HostPortCall) => Promise<unknown> | unknown;

export type PackageBridgeHostPortHandlers = {
  [Name in PackageBridgeHostPortName]: PackageBridgeHostPortHandler;
};

export async function dispatchPackageBridgeHostPortCall(
  call: HostPortCall,
  options: {
    callbacks: WorkspaceRuntimeCallbacks;
    handlers: PackageBridgeHostPortHandlers;
  },
): Promise<unknown> {
  if (options.callbacks.signal?.aborted) {
    throw new Error('Computer Use host port call aborted by workspace runtime signal.');
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
