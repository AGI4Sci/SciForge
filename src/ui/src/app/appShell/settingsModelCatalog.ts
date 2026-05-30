import type { SciForgeConfig } from '../../domain';
import { localeText, type SupportedLocale } from '../../i18n';

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

export function modelCatalogPlaceholder(state: ModelCatalogState, locale?: SupportedLocale) {
  if (state.status === 'loading') return localeText(locale, {
    'zh-CN': '正在加载模型...',
    'en-US': 'Loading models...',
  });
  if (state.status === 'empty') return localeText(locale, {
    'zh-CN': '未返回模型',
    'en-US': 'No models returned',
  });
  if (state.status === 'error') return localeText(locale, {
    'zh-CN': '无法加载模型',
    'en-US': 'Could not load models',
  });
  return localeText(locale, {
    'zh-CN': '选择模型',
    'en-US': 'Choose a model',
  });
}

export function modelCatalogStatusText(state: ModelCatalogState, locale?: SupportedLocale) {
  if (state.status === 'loading') return localeText(locale, {
    'zh-CN': `正在从 ${state.source ?? 'provider'} 加载模型。`,
    'en-US': `Loading models from ${state.source ?? 'provider'}.`,
  });
  if (state.status === 'ready') return localeText(locale, {
    'zh-CN': `找到 ${state.models.length} 个模型。选择后会写入 Model。`,
    'en-US': `${state.models.length} model${state.models.length === 1 ? '' : 's'} found. Selecting one writes it to Model.`,
  });
  if (state.status === 'empty') return localeText(locale, {
    'zh-CN': '没有可选择的模型。你仍然可以手动填写 Model。',
    'en-US': 'No selectable models were returned. You can still type a Model manually.',
  });
  if (state.status === 'error') return localeText(locale, {
    'zh-CN': `模型查询失败：${state.error ?? '未知错误'}。你仍然可以手动填写 Model。`,
    'en-US': `Model lookup failed: ${state.error ?? 'unknown error'}. You can still type a Model manually.`,
  });
  return localeText(locale, {
    'zh-CN': '打开设置后查询当前配置的模型端点。',
    'en-US': 'Open settings to query the configured model endpoint.',
  });
}
