export interface SciForgeClientErrorShape {
  title: string;
  reason: string;
  recoverActions: string[];
  diagnosticRef: string;
  cause?: unknown;
}

export class SciForgeClientError extends Error {
  title: string;
  reason: string;
  recoverActions: string[];
  diagnosticRef: string;

  constructor(shape: SciForgeClientErrorShape) {
    super(formatClientErrorMessage(shape));
    this.name = 'SciForgeClientError';
    this.title = shape.title;
    this.reason = shape.reason;
    this.recoverActions = shape.recoverActions;
    this.diagnosticRef = shape.diagnosticRef;
    this.cause = shape.cause;
  }
}

export function formatClientErrorMessage(shape: SciForgeClientErrorShape) {
  const actions = shape.recoverActions.length ? ` 下一步：${shape.recoverActions.join('；')}` : '';
  return `${shape.title}：${shape.reason}${actions} [${shape.diagnosticRef}]`;
}

export function recoverActionsForService(service: 'workspace' | 'runtime') {
  if (service === 'workspace') {
    return [
      '确认 Workspace Writer URL 正确',
      '启动 npm run workspace:server',
      '检查 workspace path 是否存在且可写',
    ];
  }
  return [
    '确认 runtime backend URL 正确',
    '启动对应 runtime backend 服务',
    '可先使用当前场景 workspace/evolved capability 或 workspace runtime 继续',
  ];
}

export function reasonFromResponseText(text: string, fallback: string) {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (isRecord(json)) {
      const detail = stringField(json.error) || stringField(json.message) || stringField(json.reason);
      if (detail && detail !== 'not found') return detail;
    }
  } catch {
    // Plain text is already a useful server diagnostic.
  }
  if (/^\s*[{[]/.test(trimmed)) return fallback;
  return trimmed.slice(0, 500);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
