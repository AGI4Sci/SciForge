import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;
  readonly code = 'request_body_too_large';

  constructor(readonly limitBytes: number) {
    super('Request body is too large.');
  }
}

export async function readIncomingMessageBody(
  request: IncomingMessage,
  limitBytes: number,
): Promise<string> {
  return (await readIncomingMessageBodyBytes(request, limitBytes)).toString('utf8');
}

export async function readIncomingMessageBodyBytes(
  request: IncomingMessage,
  limitBytes: number,
): Promise<Buffer> {
  assertPositiveLimit(limitBytes);
  const declaredLength = contentLength(request.headers);
  if (declaredLength !== null && declaredLength > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limitBytes) {
      throw new RequestBodyTooLargeError(limitBytes);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function contentLength(headers: IncomingHttpHeaders): number | null {
  const raw = headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function assertPositiveLimit(limitBytes: number): void {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new Error('Request body limit must be a positive integer.');
  }
}
