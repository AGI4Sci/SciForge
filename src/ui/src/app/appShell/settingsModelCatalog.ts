import type { SciForgeConfig } from '../../domain';

export type ModelCatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  models: string[];
  source?: string;
  error?: string;
};

type ModelCatalogPayload = {
  data?: unknown;
  models?: unknown;
};

export function modelCatalogUrl(_config: SciForgeConfig) {
  return '/api/sciforge/provider-models';
}

export async function refreshModelCatalog(
  config: SciForgeConfig,
  setModelCatalog: (state: ModelCatalogState) => void,
  signal?: AbortSignal,
) {
  const source = modelCatalogUrl(config);
  setModelCatalog({ status: 'loading', models: [], source });
  const timeout = new AbortController();
  const timeoutId = window.setTimeout(() => timeout.abort(), 8000);
  try {
    const response = await fetch(source, {
      headers: { Accept: 'application/json' },
      signal: mergeAbortSignals(signal, timeout.signal),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as ModelCatalogPayload;
    const models = extractModelIds(payload);
    setModelCatalog({ status: models.length ? 'ready' : 'empty', models, source });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setModelCatalog({
      status: 'error',
      models: [],
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function extractModelIds(payload: ModelCatalogPayload) {
  const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const ids = raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string') return entry.id;
      return '';
    })
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

export function modelCatalogPlaceholder(state: ModelCatalogState) {
  if (state.status === 'loading') return '正在查询当前 provider...';
  if (state.status === 'empty') return '当前 provider 未返回模型';
  if (state.status === 'error') return '模型列表查询失败';
  return '选择当前 provider 的模型';
}

export function modelCatalogStatusText(state: ModelCatalogState) {
  if (state.status === 'loading') return `正在从 ${state.source ?? 'provider'} 查询模型列表。`;
  if (state.status === 'ready') return `已发现 ${state.models.length} 个模型；选择后会写入 Model。`;
  if (state.status === 'empty') return '当前 provider 没有返回可选模型；仍可手动填写 Model。';
  if (state.status === 'error') return `查询失败：${state.error ?? 'unknown error'}；仍可手动填写 Model。`;
  return '打开设置后会通过本地 SciForge proxy 查询当前 provider 的模型列表。';
}
