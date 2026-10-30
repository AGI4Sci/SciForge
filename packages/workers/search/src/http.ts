export async function fetchText(
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
  headers: Record<string, string>
): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs, signal, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}
