import type { IncomingMessage } from 'node:http';

type HeaderValue = number | string | readonly string[];

interface WorkspaceCorsResponse {
  end(): unknown;
  setHeader(name: string, value: HeaderValue): unknown;
  writeHead(statusCode: number): unknown;
}

export function workspaceRequestUrl(req: Pick<IncomingMessage, 'headers' | 'url'>) {
  return new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
}

export function handleWorkspaceCors(
  req: Pick<IncomingMessage, 'method'>,
  res: WorkspaceCorsResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method !== 'OPTIONS') return false;
  res.writeHead(204);
  res.end();
  return true;
}
