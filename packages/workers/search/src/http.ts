export async function fetchText(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  headers: Record<string, string>,
  maxBytes?: number
): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs, signal, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (maxBytes == null) return response.text();
  return readBoundedText(response, maxBytes);
}

export async function fetchJson(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  init: RequestInit
): Promise<unknown> {
  const response = await fetchWithTimeout(url, timeoutMs, signal, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  init: RequestInit
): Promise<Response> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    // AbortSignal listeners do not fire retroactively. Re-check after linking
    // the signal so an already-cancelled request never reaches the network.
    throwIfAborted(signal);
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted();
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('response body is not readable');
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (totalBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - totalBytes;
    chunks.push(value.length > remaining ? value.subarray(0, remaining) : value);
    totalBytes += Math.min(value.length, remaining);
    if (value.length > remaining || totalBytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}
