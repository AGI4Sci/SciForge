export type FeedbackCodexPtyClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'stop' };

export function parseFeedbackCodexPtyClientMessage(raw: string): FeedbackCodexPtyClientMessage | undefined {
  const parsed = safeParseJson(raw);
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
  if (parsed.type === 'input') {
    return { type: 'input', data: typeof parsed.data === 'string' ? parsed.data : '' };
  }
  if (parsed.type === 'resize') {
    return {
      type: 'resize',
      cols: ptyDimension(parsed.cols, 110, 40, 240),
      rows: ptyDimension(parsed.rows, 28, 12, 80),
    };
  }
  if (parsed.type === 'stop') return { type: 'stop' };
  return undefined;
}

export function ptyDimension(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
