import type { ServerResponse } from 'node:http';
import { writeStreamEnvelope } from './http.js';

export interface DetachedStreamResponse {
  readonly signal: AbortSignal;
  readonly clientConnected: boolean;
  abort(reason?: unknown): void;
  write(body: unknown): boolean;
  end(): void;
}

export function createDetachedStreamResponse(res: ServerResponse): DetachedStreamResponse {
  const controller = new AbortController();
  let clientConnected = true;

  res.on('close', () => {
    clientConnected = false;
  });

  return {
    get signal() {
      return controller.signal;
    },
    get clientConnected() {
      return clientConnected;
    },
    abort(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    write(body: unknown) {
      if (!clientConnected || res.destroyed || res.writableEnded) return false;
      try {
        writeStreamEnvelope(res, body);
        return true;
      } catch {
        clientConnected = false;
        return false;
      }
    },
    end() {
      if (res.destroyed || res.writableEnded) return;
      try {
        res.end();
      } catch {
        clientConnected = false;
      }
    },
  };
}
