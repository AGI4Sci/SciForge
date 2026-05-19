export type GuiContextLevel = 'shell' | 'hot-region' | 'region-detail' | 'debug';
export type GuiLayoutMode = 'desktop' | 'tablet' | 'mobile';
export type GuiInteractionMode = 'idle' | 'reading' | 'editing' | 'selecting' | 'dragging' | 'modal';
export type GuiLastChangeOrigin = 'user' | 'agent' | 'system';
export type GuiResourceKind = 'directory' | 'file';
export type GuiSearchKind = 'ref' | 'title' | 'visible-text' | 'action' | 'status';
export type GuiIntentReason =
  | 'state-conflict'
  | 'user-editing'
  | 'user-dragging'
  | 'modal-open'
  | 'panel-occupied'
  | 'unsupported-renderer'
  | 'stale-precondition';

export interface GuiAction {
  label: string;
  commandText: string;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface GuiShellContext {
  schemaVersion: 'sciforge.gui-context.v1';
  revision: number;
  focusedPanel: string;
  layoutMode: GuiLayoutMode;
  pendingModal?: { id: string; kind: 'confirmation' | 'input' | 'choice' };
  availableGuiTools: string[];
}

export interface GuiHotRegionContext extends GuiShellContext {
  hotRegion: {
    panel: string;
    viewId?: string;
    primaryRef?: string;
    selectedRefs: string[];
    interactionMode: GuiInteractionMode;
    lastChangeOrigin: GuiLastChangeOrigin;
    lastChangeAt: string;
    availableActions: GuiAction[];
  };
}

export interface GuiRegionDetail {
  regionId: string;
  viewId?: string;
  visibleRefs: string[];
  selectionSummary?: string;
  rendererState?: unknown;
  affordances: GuiAction[];
  summary?: string;
  title?: string;
}

export interface GuiResourceListEntry {
  name: string;
  path: string;
  kind: GuiResourceKind;
  disclosure: GuiContextLevel;
}

export interface GuiResourceReadResult {
  path: string;
  mimeType: 'application/json' | 'text/markdown';
  revision: number;
  content: string;
  truncated: boolean;
}

export interface GuiResourceSearchResult {
  path: string;
  kind: GuiSearchKind;
  text: string;
  ref?: string;
  action?: GuiAction;
  score: number;
}

export interface GuiResourceStatResult {
  path: string;
  kind: GuiResourceKind;
  revision: number;
  updatedAt: string;
  sizeBytes: number;
  disclosure: GuiContextLevel;
  readonly: true;
}

export type GuiSuggestion =
  | { action: 'retry-with-context'; level: GuiContextLevel; regionId?: string }
  | { action: 'defer'; until: 'editing-complete' | 'modal-dismissed' | 'user-idle' }
  | { action: 'present'; target: { panel: 'new-tab' | 'side-panel' | string }; hint?: string }
  | { action: 'notify-only' };

export interface GuiPrecondition {
  expectedRevision?: number;
  ifFocusedPanel?: string;
  ifSelectedRef?: string;
  avoidIfUserEditing?: boolean;
  avoidIfUserDragging?: boolean;
  requireNoModal?: boolean;
  maxSnapshotAgeMs?: number;
}

export interface GuiToolResult {
  ok: boolean;
  appliedRevision: number | null;
  placement?: { panel: string; viewId?: string };
  deferred: boolean;
  reason: GuiIntentReason | null;
  currentRevision: number;
  currentHotRegion: GuiHotRegionContext['hotRegion'];
  suggestions: GuiSuggestion[];
}

export type GuiPresentInput = {
  intent: 'show-result' | 'show-artifact' | 'show-diff' | 'show-debug' | 'show-progress-detail' | 'focus-existing';
  ref?: string;
  content?: { kind: 'markdown' | 'table' | 'diff' | 'image' | 'json'; value: unknown };
  title?: string;
  hint?: 'markdown' | 'table' | 'diff' | 'image' | 'notebook' | 'auto';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  target?: { panel?: string; viewId?: string };
  precondition?: GuiPrecondition;
  actions?: GuiAction[];
};

export type GuiNotifyInput = {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  precondition?: GuiPrecondition;
};

export type GuiSetStatusInput = {
  text: string;
  tone?: 'neutral' | 'running' | 'success' | 'warning' | 'error';
  precondition?: GuiPrecondition;
};

export type GuiAskUserInput = {
  kind: 'confirmation' | 'input' | 'choice';
  title: string;
  message?: string;
  precondition?: GuiPrecondition;
  submitCommandTemplate?: string;
  choices?: Array<{ label: string; commandText: string; style?: 'primary' | 'secondary' | 'danger' }>;
};

export type GuiApplyBatchOperation =
  | { tool: 'present'; args: GuiPresentInput }
  | { tool: 'notify'; args: GuiNotifyInput }
  | { tool: 'set_status'; args: GuiSetStatusInput };

export type GuiApplyBatchInput = {
  precondition?: GuiPrecondition;
  atomicity: 'all-or-nothing' | 'best-effort';
  ops: GuiApplyBatchOperation[];
};

export interface GuiBatchOperationResult {
  index: number;
  tool: GuiApplyBatchOperation['tool'];
  ok: boolean;
  reason: GuiIntentReason | null;
  placement?: GuiToolResult['placement'];
}

export type GuiApplyBatchResult = GuiToolResult & {
  operationResults: GuiBatchOperationResult[];
};

export interface GuiWatchResult {
  path: string;
  revision: number;
  disclosure: GuiContextLevel;
  cursor: string;
  semanticOnly: true;
  includesRawDom: false;
  events: Array<{
    kind: 'changed' | 'removed' | 'permission-changed';
    path: string;
    revision: number;
    updatedAt: string;
    disclosure: GuiContextLevel;
  }>;
}

export interface GuiIntentLogEntry {
  id: string;
  tool: 'gui.present' | 'gui.ask_user' | 'gui.notify' | 'gui.set_status' | 'gui.apply_batch';
  createdAt: string;
  revision: number;
  summary: string;
  applied: boolean;
  deferred: boolean;
  reason: GuiIntentReason | null;
  placement?: { panel: string; viewId?: string };
}

export interface GuiProtocolSnapshotInput {
  revision?: number;
  focusedPanel?: string;
  layoutMode?: GuiLayoutMode;
  pendingModal?: GuiShellContext['pendingModal'];
  hotRegion?: Partial<GuiHotRegionContext['hotRegion']>;
  regions?: GuiRegionDetail[];
  updatedAt?: string;
  status?: { text: string; tone?: GuiSetStatusInput['tone'] };
  intentLog?: GuiIntentLogEntry[];
}

export interface GuiProtocolController {
  getContext(input?: { level?: GuiContextLevel; regionId?: string }): GuiShellContext | GuiHotRegionContext | GuiRegionDetail | { shell: GuiShellContext; hotRegion: GuiHotRegionContext['hotRegion']; regions: GuiRegionDetail[]; intentLog: GuiIntentLogEntry[] };
  snapshot(): GuiProtocolSnapshotInput;
  list(input: { path: string }): GuiResourceListEntry[];
  read(input: { path: string; maxBytes?: number }): GuiResourceReadResult;
  search(input: { query: string; scope?: string; kinds?: GuiSearchKind[] }): GuiResourceSearchResult[];
  stat(input: { path: string }): GuiResourceStatResult;
  watch(input: { path: string; events?: Array<'changed' | 'removed' | 'permission-changed'>; sinceRevision?: number }): GuiWatchResult;
  present(input: GuiPresentInput): GuiToolResult;
  askUser(input: GuiAskUserInput): GuiToolResult;
  notify(input: GuiNotifyInput): GuiToolResult;
  setStatus(input: GuiSetStatusInput): GuiToolResult;
  applyBatch(input: GuiApplyBatchInput): GuiApplyBatchResult;
}

type ResourceNode = {
  path: string;
  kind: GuiResourceKind;
  disclosure: GuiContextLevel;
  updatedAt: string;
  read: () => { mimeType: GuiResourceReadResult['mimeType']; content: string };
};

const AVAILABLE_GUI_TOOLS = [
  'gui.present',
  'gui.ask_user',
  'gui.notify',
  'gui.set_status',
  'gui.apply_batch',
  'gui.get_context',
  'gui.list',
  'gui.read',
  'gui.search',
  'gui.stat',
  'gui.watch',
] as const;

export function createGuiProtocolController(input: GuiProtocolSnapshotInput = {}): GuiProtocolController {
  let revision = input.revision ?? 1;
  let updatedAt = input.updatedAt ?? new Date(0).toISOString();
  let focusedPanel = input.focusedPanel ?? input.hotRegion?.panel ?? 'chat';
  let layoutMode = input.layoutMode ?? 'desktop';
  let pendingModal = input.pendingModal;
  let status = input.status;
  let intentLog = [...(input.intentLog ?? [])];
  let regions = normalizeRegions(input.regions);
  let hotRegion = normalizeHotRegion(input.hotRegion, focusedPanel, updatedAt, regions);

  const controller: GuiProtocolController = {
    getContext(contextInput = {}) {
      const level = contextInput.level ?? 'hot-region';
      if (level === 'shell') return shellContext();
      if (level === 'region-detail') {
        const region = contextInput.regionId ? regions.find((item) => item.regionId === contextInput.regionId) : regions.find((item) => item.regionId === hotRegion.panel);
        if (!region) throw new Error(`Unknown GUI region ${contextInput.regionId ?? hotRegion.panel}`);
        return cloneJson(region);
      }
      if (level === 'debug') {
        return {
          shell: shellContext(),
          hotRegion: cloneJson(hotRegion),
          regions: cloneJson(regions),
          intentLog: cloneJson(intentLog),
        };
      }
      return hotRegionContext();
    },
    snapshot() {
      return withoutUndefined({
        revision,
        focusedPanel,
        layoutMode,
        pendingModal,
        hotRegion: cloneJson(hotRegion),
        regions: cloneJson(regions),
        updatedAt,
        status,
        intentLog: cloneJson(intentLog),
      });
    },
    list({ path }) {
      const normalized = normalizePath(path);
      const nodes = resourceNodes();
      const directory = nodes.get(normalized);
      if (!directory || directory.kind !== 'directory') throw new Error(`GUI resource path is not a directory: ${path}`);
      const prefix = normalized === '/gui' ? '/gui/' : `${normalized}/`;
      return [...nodes.values()]
        .filter((node) => node.path.startsWith(prefix) && node.path !== normalized)
        .filter((node) => !node.path.slice(prefix.length).includes('/'))
        .map((node) => ({
          name: node.path.slice(prefix.length),
          path: node.path,
          kind: node.kind,
          disclosure: node.disclosure,
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
    },
    read({ path, maxBytes }) {
      const normalized = normalizePath(path);
      const node = resourceNodes().get(normalized);
      if (!node || node.kind !== 'file') throw new Error(`Unknown GUI resource file: ${path}`);
      const { mimeType, content } = node.read();
      const bounded = maxBytes !== undefined && content.length > maxBytes
        ? content.slice(0, Math.max(0, maxBytes))
        : content;
      return {
        path: normalized,
        mimeType,
        revision,
        content: bounded,
        truncated: bounded.length !== content.length,
      };
    },
    search({ query, scope = '/gui', kinds }) {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return [];
      const kindSet = kinds?.length ? new Set(kinds) : undefined;
      const normalizedScope = normalizePath(scope);
      return searchIndex()
        .filter((item) => item.path === normalizedScope || item.path.startsWith(`${normalizedScope.replace(/\/$/, '')}/`))
        .filter((item) => !kindSet || kindSet.has(item.kind))
        .map((item) => ({ item, score: searchScore(item, normalizedQuery) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path))
        .map(({ item, score }) => ({ ...item, score }));
    },
    stat({ path }) {
      const normalized = normalizePath(path);
      const node = resourceNodes().get(normalized);
      if (!node) throw new Error(`Unknown GUI resource path: ${path}`);
      const content = node.kind === 'file' ? node.read().content : JSON.stringify(controller.list({ path: normalized }));
      return {
        path: normalized,
        kind: node.kind,
        revision,
        updatedAt: node.updatedAt,
        sizeBytes: utf8Bytes(content),
        disclosure: node.disclosure,
        readonly: true,
      };
    },
    watch({ path, events, sinceRevision }) {
      const normalized = normalizePath(path);
      const node = resourceNodes().get(normalized);
      if (!node) throw new Error(`Unknown GUI resource path: ${path}`);
      const eventKinds = new Set(events?.length ? events : ['changed']);
      const changed = sinceRevision === undefined || sinceRevision < revision;
      return {
        path: normalized,
        revision,
        disclosure: node.disclosure,
        cursor: `${revision}:${normalized}`,
        semanticOnly: true,
        includesRawDom: false,
        events: changed && eventKinds.has('changed')
          ? [{ kind: 'changed', path: normalized, revision, updatedAt: node.updatedAt, disclosure: node.disclosure }]
          : [],
      };
    },
    present(intent) {
      return applyIntent('gui.present', summarizePresent(intent), intent.precondition, () => {
        const unsupported = unsupportedRendererReason(intent);
        if (unsupported) return unsupported;
        return { placement: applyPresentMutation(intent) };
      });
    },
    askUser(intent) {
      return applyIntent('gui.ask_user', summarizeAskUser(intent), intent.precondition, () => {
        const choices = normalizeGuiActions(intent.choices ?? []);
        const submitCommandTemplate = normalizeCommandTemplate(intent.submitCommandTemplate);
        if ((intent.kind === 'confirmation' || intent.kind === 'choice') && choices.length === 0) {
          return { reason: 'state-conflict', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
        }
        const modalId = `gui-ask-${revision + 1}`;
        pendingModal = { id: modalId, kind: intent.kind };
        focusedPanel = 'modal';
        hotRegion = {
          ...hotRegion,
          panel: 'modal',
          viewId: modalId,
          interactionMode: 'modal',
          lastChangeOrigin: 'agent',
          lastChangeAt: updatedAt,
          availableActions: choices,
        };
        regions = upsertRegion(regions, {
          regionId: 'modal',
          viewId: modalId,
          visibleRefs: hotRegion.selectedRefs,
          selectionSummary: intent.title,
          summary: [intent.title, intent.message].filter(Boolean).join('\n\n'),
          title: intent.title,
          rendererState: withoutUndefined({ kind: intent.kind, submitCommandTemplate }),
          affordances: choices,
        });
        return { placement: { panel: 'modal', viewId: modalId } };
      });
    },
    notify(intent) {
      return applyIntent('gui.notify', `${intent.level}: ${intent.message}`, intent.precondition, () => {
        applyNotifyMutation(intent);
        return {};
      });
    },
    setStatus(intent) {
      return applyIntent('gui.set_status', intent.text, intent.precondition, () => {
        applySetStatusMutation(intent);
        return {};
      });
    },
    applyBatch(intent) {
      const operationResults: GuiBatchOperationResult[] = [];
      const result = applyIntent('gui.apply_batch', summarizeBatch(intent), intent.precondition, () => {
        const evaluations = intent.ops.map((op, index) => evaluateBatchOperation(op, index));
        if (intent.atomicity === 'all-or-nothing') {
          const failed = evaluations.find((item) => item.reason);
          if (failed) {
            operationResults.push(...evaluations.map((item) => ({
              index: item.index,
              tool: item.tool,
              ok: false,
              reason: item.reason ?? 'state-conflict',
              placement: item.placement,
            })));
            return { reason: failed.reason ?? 'state-conflict', suggestions: failed.suggestions };
          }
        }

        for (const evaluation of evaluations) {
          if (evaluation.reason) {
            operationResults.push({ index: evaluation.index, tool: evaluation.tool, ok: false, reason: evaluation.reason });
            continue;
          }
          const placement = evaluation.apply();
          operationResults.push({ index: evaluation.index, tool: evaluation.tool, ok: true, reason: null, placement });
        }

        const applied = operationResults.filter((item) => item.ok);
        if (!applied.length) {
          const first = operationResults[0];
          return { reason: first?.reason ?? 'state-conflict', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
        }
        return { placement: applied.findLast((item) => item.placement)?.placement };
      });
      return { ...result, operationResults };
    },
  };

  function shellContext(): GuiShellContext {
    return withoutUndefined({
      schemaVersion: 'sciforge.gui-context.v1' as const,
      revision,
      focusedPanel,
      layoutMode,
      pendingModal,
      availableGuiTools: [...AVAILABLE_GUI_TOOLS],
    });
  }

  function hotRegionContext(): GuiHotRegionContext {
    return {
      ...shellContext(),
      hotRegion: cloneJson(hotRegion),
    };
  }

  function resourceNodes(): Map<string, ResourceNode> {
    const nodes = new Map<string, ResourceNode>();
    const add = (node: ResourceNode) => nodes.set(node.path, node);
    add(directory('/gui', 'shell', updatedAt));
    add(file('/gui/shell.json', 'shell', updatedAt, () => json(shellContext())));
    add(file('/gui/hot-region.json', 'hot-region', updatedAt, () => json(hotRegionContext())));
    add(file('/gui/intent-log.json', 'hot-region', updatedAt, () => json({
      schemaVersion: 'sciforge.gui-intent-log.v1',
      revision,
      status,
      entries: intentLog,
    })));
    add(directory('/gui/regions', 'region-detail', updatedAt));
    for (const region of regions) {
      const base = `/gui/regions/${resourceSegment(region.regionId)}`;
      add(directory(base, 'region-detail', updatedAt));
      add(file(`${base}/summary.md`, 'region-detail', updatedAt, () => markdown(regionSummaryMarkdown(region))));
      add(file(`${base}/refs.json`, 'region-detail', updatedAt, () => json({ regionId: region.regionId, refs: region.visibleRefs })));
      add(file(`${base}/actions.json`, 'region-detail', updatedAt, () => json({ regionId: region.regionId, actions: region.affordances })));
      add(file(`${base}/viewport.json`, 'debug', updatedAt, () => json({ regionId: region.regionId, rendererState: region.rendererState })));
    }
    add(directory('/gui/debug', 'debug', updatedAt));
    add(file('/gui/debug/intent-log.json', 'debug', updatedAt, () => json({ revision, entries: intentLog })));
    return nodes;
  }

  function searchIndex(): Array<Omit<GuiResourceSearchResult, 'score'>> {
    const shell = shellContext();
    const hot = hotRegionContext();
    const items: Array<Omit<GuiResourceSearchResult, 'score'>> = [
      { path: '/gui/shell.json', kind: 'status', text: `focused panel ${shell.focusedPanel} layout ${shell.layoutMode}` },
      { path: '/gui/hot-region.json', kind: 'status', text: `interaction ${hot.hotRegion.interactionMode} origin ${hot.hotRegion.lastChangeOrigin}` },
      ...hot.hotRegion.selectedRefs.map((ref) => ({ path: '/gui/hot-region.json', kind: 'ref' as const, text: ref, ref })),
      ...hot.hotRegion.availableActions.map((action) => ({ path: '/gui/hot-region.json', kind: 'action' as const, text: `${action.label} ${action.commandText}`, action })),
      ...intentLog.map((entry) => ({ path: '/gui/intent-log.json', kind: 'status' as const, text: `${entry.tool} ${entry.summary} ${entry.reason ?? ''}` })),
    ];
    for (const region of regions) {
      const base = `/gui/regions/${resourceSegment(region.regionId)}`;
      if (region.title) items.push({ path: `${base}/summary.md`, kind: 'title', text: region.title });
      if (region.summary) items.push({ path: `${base}/summary.md`, kind: 'visible-text', text: region.summary });
      for (const ref of region.visibleRefs) items.push({ path: `${base}/refs.json`, kind: 'ref', text: ref, ref });
      for (const action of region.affordances) items.push({ path: `${base}/actions.json`, kind: 'action', text: `${action.label} ${action.commandText}`, action });
    }
    return items;
  }

  function applyIntent(
    tool: GuiIntentLogEntry['tool'],
    summary: string,
    precondition: GuiPrecondition | undefined,
    apply: () => { placement?: GuiToolResult['placement']; reason?: GuiIntentReason; suggestions?: GuiSuggestion[] },
  ): GuiToolResult {
    const blocked = preconditionResult(precondition);
    if (blocked) return recordIntent(tool, summary, false, blocked.reason, blocked.suggestions, undefined);
    const application = apply();
    if (application.reason) return recordIntent(tool, summary, false, application.reason, application.suggestions ?? suggestionsForReason(application.reason), undefined);
    revision += 1;
    updatedAt = new Date().toISOString();
    hotRegion = { ...hotRegion, lastChangeAt: updatedAt };
    return recordIntent(tool, summary, true, null, [], application.placement);
  }

  function recordIntent(
    tool: GuiIntentLogEntry['tool'],
    summary: string,
    applied: boolean,
    reason: GuiIntentReason | null,
    suggestions: GuiSuggestion[],
    placement: GuiToolResult['placement'],
  ): GuiToolResult {
    const deferred = !applied && Boolean(reason === 'user-editing' || reason === 'user-dragging' || reason === 'modal-open' || reason === 'panel-occupied');
    const entry: GuiIntentLogEntry = withoutUndefined({
      id: `${tool}:${intentLog.length + 1}`,
      tool,
      createdAt: new Date().toISOString(),
      revision,
      summary,
      applied,
      deferred,
      reason,
      placement,
    });
    intentLog = [...intentLog, entry].slice(-100);
    return {
      ok: applied,
      appliedRevision: applied ? revision : null,
      placement,
      deferred,
      reason,
      currentRevision: revision,
      currentHotRegion: cloneJson(hotRegion),
      suggestions,
    };
  }

  function applyPresentMutation(intent: GuiPresentInput): GuiToolResult['placement'] {
    const panel = intent.target?.panel ?? placementPanelForPresent(intent);
    const placement = { panel, viewId: intent.target?.viewId ?? intent.ref };
    focusedPanel = panel;
    hotRegion = {
      ...hotRegion,
      panel,
      viewId: placement.viewId,
      primaryRef: intent.ref ?? hotRegion.primaryRef,
      selectedRefs: intent.ref ? uniqueStrings([intent.ref, ...hotRegion.selectedRefs]) : hotRegion.selectedRefs,
      interactionMode: 'reading',
      lastChangeOrigin: 'agent',
      lastChangeAt: updatedAt,
      availableActions: intent.actions ? normalizeGuiActions(intent.actions) : hotRegion.availableActions,
    };
    regions = upsertRegion(regions, {
      regionId: panel,
      viewId: placement.viewId,
      visibleRefs: hotRegion.selectedRefs,
      selectionSummary: intent.title ?? intent.ref,
      summary: presentRegionSummary(intent),
      title: intent.title ?? intent.ref,
      rendererState: { intent: intent.intent, hint: intent.hint ?? intent.content?.kind ?? 'auto' },
      affordances: normalizeGuiActions(intent.actions ?? []),
    });
    return placement;
  }

  function applyNotifyMutation(intent: GuiNotifyInput): void {
    status = { text: intent.message, tone: intent.level === 'info' ? 'neutral' : intent.level };
  }

  function applySetStatusMutation(intent: GuiSetStatusInput): void {
    status = { text: intent.text, tone: intent.tone ?? 'neutral' };
  }

  function evaluateBatchOperation(op: GuiApplyBatchOperation, index: number): {
    index: number;
    tool: GuiApplyBatchOperation['tool'];
    reason: GuiIntentReason | null;
    suggestions: GuiSuggestion[];
    placement?: GuiToolResult['placement'];
    apply: () => GuiToolResult['placement'] | undefined;
  } {
    const blocked = preconditionResult(op.args.precondition);
    if (blocked) {
      return { index, tool: op.tool, reason: blocked.reason, suggestions: blocked.suggestions, apply: () => undefined };
    }
    if (op.tool === 'present') {
      const unsupported = unsupportedRendererReason(op.args);
      if (unsupported) return { index, tool: op.tool, reason: unsupported.reason, suggestions: unsupported.suggestions, apply: () => undefined };
      return { index, tool: op.tool, reason: null, suggestions: [], apply: () => applyPresentMutation(op.args) };
    }
    if (op.tool === 'notify') {
      return { index, tool: op.tool, reason: null, suggestions: [], apply: () => {
        applyNotifyMutation(op.args);
        return undefined;
      } };
    }
    return { index, tool: op.tool, reason: null, suggestions: [], apply: () => {
      applySetStatusMutation(op.args);
      return undefined;
    } };
  }

  function preconditionResult(precondition: GuiPrecondition | undefined): { reason: GuiIntentReason; suggestions: GuiSuggestion[] } | undefined {
    if (!precondition) return undefined;
    if (precondition.expectedRevision !== undefined && precondition.expectedRevision !== revision) {
      return { reason: 'stale-precondition', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
    }
    if (precondition.ifFocusedPanel && precondition.ifFocusedPanel !== focusedPanel) {
      return { reason: 'state-conflict', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
    }
    if (precondition.ifSelectedRef && !hotRegion.selectedRefs.includes(precondition.ifSelectedRef)) {
      return { reason: 'state-conflict', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
    }
    if (precondition.requireNoModal && pendingModal) {
      return { reason: 'modal-open', suggestions: [{ action: 'defer', until: 'modal-dismissed' }] };
    }
    if (precondition.avoidIfUserEditing && hotRegion.interactionMode === 'editing') {
      return { reason: 'user-editing', suggestions: [{ action: 'defer', until: 'editing-complete' }, { action: 'notify-only' }] };
    }
    if (precondition.avoidIfUserDragging && hotRegion.interactionMode === 'dragging') {
      return { reason: 'user-dragging', suggestions: [{ action: 'defer', until: 'user-idle' }] };
    }
    if (precondition.maxSnapshotAgeMs !== undefined) {
      const age = Date.now() - Date.parse(hotRegion.lastChangeAt);
      if (Number.isFinite(age) && age > precondition.maxSnapshotAgeMs) {
        return { reason: 'stale-precondition', suggestions: [{ action: 'retry-with-context', level: 'hot-region' }] };
      }
    }
    return undefined;
  }

  return controller;
}

function normalizeRegions(regions: GuiRegionDetail[] | undefined): GuiRegionDetail[] {
  if (regions?.length) {
    return regions.map((region) => ({
      ...region,
      visibleRefs: uniqueStrings(region.visibleRefs ?? []),
      affordances: normalizeGuiActions(region.affordances ?? []),
    }));
  }
  return [{
    regionId: 'chat',
    visibleRefs: [],
    affordances: [],
    summary: 'Main chat region is visible.',
  }];
}

function normalizeHotRegion(
  input: Partial<GuiHotRegionContext['hotRegion']> | undefined,
  fallbackPanel: string,
  updatedAt: string,
  regions: GuiRegionDetail[],
): GuiHotRegionContext['hotRegion'] {
  const region = regions.find((item) => item.regionId === (input?.panel ?? fallbackPanel)) ?? regions[0];
  return {
    panel: input?.panel ?? region?.regionId ?? fallbackPanel,
    viewId: input?.viewId ?? region?.viewId,
    primaryRef: input?.primaryRef ?? region?.visibleRefs[0],
    selectedRefs: uniqueStrings(input?.selectedRefs ?? region?.visibleRefs ?? []),
    interactionMode: input?.interactionMode ?? 'idle',
    lastChangeOrigin: input?.lastChangeOrigin ?? 'system',
    lastChangeAt: input?.lastChangeAt ?? updatedAt,
    availableActions: normalizeGuiActions(input?.availableActions ?? region?.affordances ?? []),
  };
}

function normalizeGuiActions(actions: GuiAction[]): GuiAction[] {
  return actions
    .map((action) => ({
      ...action,
      label: action.label.trim(),
      commandText: action.commandText.replace(/\s+/g, ' ').trim(),
    }))
    .filter((action) => action.label.length > 0 && isTerminalEquivalentCommandText(action.commandText));
}

function normalizeCommandTemplate(template: string | undefined): string | undefined {
  if (!template) return undefined;
  const normalized = template.replace(/\s+/g, ' ').trim();
  return isTerminalEquivalentCommandText(normalized) ? normalized : undefined;
}

function isTerminalEquivalentCommandText(commandText: string) {
  return commandText.length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(commandText);
}

function directory(path: string, disclosure: GuiContextLevel, updatedAt: string): ResourceNode {
  return {
    path,
    kind: 'directory',
    disclosure,
    updatedAt,
    read: () => ({ mimeType: 'application/json', content: '[]' }),
  };
}

function file(path: string, disclosure: GuiContextLevel, updatedAt: string, read: ResourceNode['read']): ResourceNode {
  return {
    path,
    kind: 'file',
    disclosure,
    updatedAt,
    read,
  };
}

function json(value: unknown) {
  return { mimeType: 'application/json' as const, content: JSON.stringify(value, null, 2) };
}

function markdown(content: string) {
  return { mimeType: 'text/markdown' as const, content };
}

function regionSummaryMarkdown(region: GuiRegionDetail) {
  return [
    `# ${region.title ?? region.regionId}`,
    '',
    region.summary ?? region.selectionSummary ?? 'No visible summary is available.',
    '',
    region.visibleRefs.length ? `Visible refs: ${region.visibleRefs.join(', ')}` : 'Visible refs: none',
  ].join('\n');
}

function normalizePath(path: string) {
  const trimmed = path.trim() || '/gui';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function resourceSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'region';
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function searchScore(item: Omit<GuiResourceSearchResult, 'score'>, query: string) {
  const text = [item.text, item.ref, item.action?.label, item.action?.commandText].filter(Boolean).join('\n').toLowerCase();
  if (text === query) return 100;
  if (text.includes(query)) return item.kind === 'ref' ? 80 : item.kind === 'action' ? 70 : 50;
  return query.split(/\s+/).filter((part) => part && text.includes(part)).length * 10;
}

function unsupportedRendererReason(input: GuiPresentInput): { reason: GuiIntentReason; suggestions: GuiSuggestion[] } | undefined {
  const renderer = input.hint ?? input.content?.kind;
  if (renderer && !['markdown', 'table', 'diff', 'image', 'json', 'auto', 'notebook'].includes(renderer)) {
    return { reason: 'unsupported-renderer', suggestions: [{ action: 'notify-only' }] };
  }
  return undefined;
}

function placementPanelForPresent(input: GuiPresentInput) {
  if (input.intent === 'show-debug' || input.intent === 'show-progress-detail') return 'audit';
  if (input.intent === 'show-diff') return 'diff';
  if (input.intent === 'show-artifact') return 'results';
  return 'chat';
}

function presentRegionSummary(input: GuiPresentInput) {
  if (typeof input.content?.value === 'string') return input.content.value.slice(0, 2000);
  if (input.ref) return `Presented ${input.ref}.`;
  return `Presentation intent ${input.intent} applied.`;
}

function summarizePresent(input: GuiPresentInput) {
  return [input.intent, input.ref, input.title].filter(Boolean).join(' ') || input.intent;
}

function summarizeAskUser(input: GuiAskUserInput) {
  return [input.kind, input.title].filter(Boolean).join(' ');
}

function summarizeBatch(input: GuiApplyBatchInput) {
  return `${input.atomicity} ${input.ops.length} GUI operation(s)`;
}

function suggestionsForReason(reason: GuiIntentReason): GuiSuggestion[] {
  if (reason === 'unsupported-renderer') return [{ action: 'notify-only' }];
  if (reason === 'modal-open') return [{ action: 'defer', until: 'modal-dismissed' }];
  if (reason === 'user-editing') return [{ action: 'defer', until: 'editing-complete' }];
  if (reason === 'user-dragging') return [{ action: 'defer', until: 'user-idle' }];
  return [{ action: 'retry-with-context', level: 'hot-region' }];
}

function upsertRegion(regions: GuiRegionDetail[], next: GuiRegionDetail) {
  const without = regions.filter((region) => region.regionId !== next.regionId);
  return [...without, next];
}
