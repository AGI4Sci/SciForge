import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleQueryRequest,
  type ModuleReadRequest,
  type ModuleResultEnvelope,
} from '@sciforge-ui/runtime-contract/modules';
import type {
  GuiContextLevel,
  GuiProtocolController,
  GuiSearchKind,
} from '../../ui/src/app/guiProtocol.js';

export const GUI_MODULE_ID = 'gui' as const;
const GUI_REF_PREFIX = 'gui:';

export function guiResourceRef(path: string): string {
  return `${GUI_REF_PREFIX}${normalizeGuiPath(path)}`;
}

export function pathFromGuiResourceRef(ref: string): string {
  if (!ref.startsWith(GUI_REF_PREFIX)) throw new Error(`Unsupported GUI ref: ${ref}`);
  return normalizeGuiPath(ref.slice(GUI_REF_PREFIX.length));
}

export function createGuiModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: GUI_MODULE_ID,
    title: 'GUI',
    summary: 'Presentation-only GUI module for semantic resources, hot-region context, and GUI-local intents.',
    resources: [
      {
        kind: 'gui-resource',
        refPrefix: GUI_REF_PREFIX,
        queryable: true,
        readable: true,
        summary: 'Semantic read-only GUI resource tree under /gui.',
      },
      {
        kind: 'hot-region',
        refPrefix: `${GUI_REF_PREFIX}/gui/hot-region`,
        queryable: true,
        readable: true,
        summary: 'Current focus and terminal-equivalent GUI actions.',
      },
    ],
    intents: [
      { name: 'present', sideEffect: 'local', summary: 'Negotiate and render a GUI-local presentation intent.' },
      { name: 'ask_user', sideEffect: 'local', summary: 'Ask for confirmation, input, or choice with terminal-equivalent command text.' },
      { name: 'notify', sideEffect: 'local', summary: 'Show a GUI-local notification.' },
      { name: 'set_status', sideEffect: 'local', summary: 'Set presentation-only status text.' },
      { name: 'apply_batch', sideEffect: 'local', summary: 'Apply a bounded batch of GUI-local presentation intents.' },
      { name: 'watch', sideEffect: 'none', returnsOperation: true, summary: 'Read semantic revision changes for a GUI resource.' },
    ],
    facets: {
      refs: true,
      events: true,
      subscription: true,
      batch: true,
    },
    limits: {
      maxInlineBytes: 64_000,
      expectedLatencyMs: 100,
    },
  });
}

export function createGuiModuleHandler(controller: GuiProtocolController) {
  return {
    describe: createGuiModuleDescription,
    query: (request: ModuleQueryRequest) => queryGuiModule(controller, request),
    read: (request: ModuleReadRequest) => readGuiModule(controller, request),
    invoke: (request: ModuleInvokeRequest) => invokeGuiModule(controller, request),
  };
}

export function queryGuiModule(
  controller: GuiProtocolController,
  request: ModuleQueryRequest,
): ModuleResultEnvelope {
  const path = stringFromFilters(request.filters, 'path');
  const scope = request.scope ?? stringFromFilters(request.filters, 'scope') ?? '/gui';
  const limit = Math.max(1, Math.min(100, request.limit ?? 25));
  if (path) {
    const entries = controller.list({ path: normalizeGuiPath(path) }).slice(0, limit).map((entry) => ({
      ...entry,
      ref: guiResourceRef(entry.path),
    }));
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: true,
      value: {
        kind: 'list',
        entries,
      },
      refs: entries.map((entry) => entry.ref),
    });
  }

  const query = request.query?.trim();
  if (!query) {
    const context = controller.getContext({ level: 'hot-region' });
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: true,
      value: {
        kind: 'context',
        context,
        ref: guiResourceRef('/gui/hot-region.json'),
      },
      refs: [guiResourceRef('/gui/hot-region.json')],
    });
  }

  const matches = controller.search({
    query,
    scope,
    kinds: guiSearchKinds(request.kind, request.filters),
  }).slice(0, limit).map((match) => ({
    ...match,
    ref: guiResourceRef(match.path),
  }));
  return moduleResult({
    moduleId: GUI_MODULE_ID,
    ok: true,
    value: {
      kind: 'search',
      matches,
    },
    refs: matches.map((match) => match.ref),
  });
}

export function readGuiModule(
  controller: GuiProtocolController,
  request: ModuleReadRequest,
): ModuleResultEnvelope {
  const path = pathFromGuiResourceRef(request.ref);
  const content = controller.read({ path, maxBytes: request.maxBytes });
  const meta = request.includeMeta ? controller.stat({ path }) : undefined;
  return moduleResult({
    moduleId: GUI_MODULE_ID,
    ok: true,
    value: {
      ref: guiResourceRef(content.path),
      ...content,
      meta,
    },
    refs: [guiResourceRef(content.path)],
  });
}

export function invokeGuiModule(
  controller: GuiProtocolController,
  request: ModuleInvokeRequest,
): ModuleResultEnvelope {
  try {
    const value = invokeGuiIntent(controller, request.intent, recordInput(request.input));
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: true,
      value,
      refs: refsForGuiIntentValue(value),
      operationRef: request.intent === 'watch' && isRecord(value) ? stringField(value.cursor) : undefined,
    });
  } catch (error) {
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function callGuiAliasThroughModule(
  controller: GuiProtocolController,
  name: string,
  args: Record<string, unknown>,
): ModuleResultEnvelope {
  if (name === 'gui.get_context') {
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: true,
      value: controller.getContext({
        level: stringField(args.level) as GuiContextLevel | undefined,
        regionId: stringField(args.regionId),
      }),
    });
  }
  if (name === 'gui.list') {
    return queryGuiModule(controller, {
      moduleId: GUI_MODULE_ID,
      filters: { path: requiredString(args.path, 'path') },
    });
  }
  if (name === 'gui.read') {
    return readGuiModule(controller, {
      moduleId: GUI_MODULE_ID,
      ref: guiResourceRef(requiredString(args.path, 'path')),
      maxBytes: numberField(args.maxBytes),
    });
  }
  if (name === 'gui.search') {
    return queryGuiModule(controller, {
      moduleId: GUI_MODULE_ID,
      query: requiredString(args.query, 'query'),
      scope: stringField(args.scope),
      filters: {
        kinds: Array.isArray(args.kinds) ? args.kinds : undefined,
      },
    });
  }
  if (name === 'gui.stat') {
    const path = requiredString(args.path, 'path');
    return moduleResult({
      moduleId: GUI_MODULE_ID,
      ok: true,
      value: controller.stat({ path }),
      refs: [guiResourceRef(path)],
    });
  }
  if (name === 'gui.watch') {
    return invokeGuiModule(controller, {
      moduleId: GUI_MODULE_ID,
      intent: 'watch',
      input: args,
    });
  }
  const intent = name.startsWith('gui.') ? name.slice('gui.'.length) : name;
  return invokeGuiModule(controller, {
    moduleId: GUI_MODULE_ID,
    intent,
    input: args,
  });
}

function invokeGuiIntent(
  controller: GuiProtocolController,
  intent: string,
  input: Record<string, unknown>,
): unknown {
  if (intent === 'present') return controller.present(input as never);
  if (intent === 'ask_user') return controller.askUser(input as never);
  if (intent === 'notify') return controller.notify(input as never);
  if (intent === 'set_status') return controller.setStatus(input as never);
  if (intent === 'apply_batch') return controller.applyBatch(input as never);
  if (intent === 'watch') {
    return controller.watch({
      path: requiredString(input.path, 'path'),
      events: Array.isArray(input.events) ? input.events.filter((item): item is never => typeof item === 'string') : undefined,
      sinceRevision: numberField(input.sinceRevision),
    });
  }
  throw new Error(`unsupported_intent:${intent}`);
}

function refsForGuiIntentValue(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  const refs = new Set<string>();
  if (typeof value.path === 'string') refs.add(guiResourceRef(value.path));
  const hotRegion = isRecord(value.currentHotRegion) ? value.currentHotRegion : undefined;
  for (const ref of stringArray(hotRegion?.selectedRefs) ?? []) refs.add(ref);
  const primaryRef = stringField(hotRegion?.primaryRef);
  if (primaryRef) refs.add(primaryRef);
  return refs.size ? [...refs] : undefined;
}

function guiSearchKinds(kind: string | undefined, filters: Record<string, unknown> | undefined): GuiSearchKind[] | undefined {
  const rawKinds = Array.isArray(filters?.kinds) ? filters?.kinds : kind ? [kind] : undefined;
  if (!rawKinds) return undefined;
  return rawKinds.filter((item): item is GuiSearchKind => typeof item === 'string') as GuiSearchKind[];
}

function stringFromFilters(filters: Record<string, unknown> | undefined, key: string): string | undefined {
  return stringField(filters?.[key]);
}

function recordInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return input ?? {};
}

function normalizeGuiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error('GUI path must be non-empty.');
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+/g, '/');
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`gui.${name} must be a non-empty string`);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
