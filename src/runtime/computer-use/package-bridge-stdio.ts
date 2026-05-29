import type { Writable } from 'node:stream';

const HOST_PORT_RESULT_SCHEMA = 'sciforge.computer-use.host-port-result.v1';

export type HostPortCall = {
  type: 'hostPortCall';
  id: string;
  port: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
};

type HostPortResultWritableChild = {
  stdin?: Writable | null;
};

export function hostPortResultLine(
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
) {
  return `${JSON.stringify({
    schemaVersion: HOST_PORT_RESULT_SCHEMA,
    type: 'hostPortResult',
    id,
    ok,
    result,
    error,
  })}\n`;
}

export function writeHostPortResult(
  child: HostPortResultWritableChild,
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
) {
  const stdin = child.stdin;
  if (!stdin) return;
  if (stdin.destroyed || stdin.writableEnded) return;
  try {
    stdin.write(hostPortResultLine(id, ok, result, error));
  } catch {
    // The package process may already be closing after an abort.
  }
}

export function isClosedPipeError(error: unknown) {
  if (!isRecord(error)) return false;
  return error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
