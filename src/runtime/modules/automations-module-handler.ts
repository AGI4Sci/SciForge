import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleQueryRequest,
  type ModuleReadRequest,
  type ModuleResultEnvelope,
} from '../../../packages/contracts/runtime/modules.js';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';

export type AutomationStatus = 'ready' | 'paused' | 'running' | 'successful' | 'failed';
export type AutomationRunStatus = 'queued' | 'successful' | 'failed';
export type AutomationTriggerType = 'manual' | 'schedule' | 'workspace-event';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  label: string;
  schedule?: string;
}

export interface AutomationRecord {
  schemaVersion: 1;
  id: string;
  ref: string;
  name: string;
  author: string;
  enabled: boolean;
  status: AutomationStatus;
  repositoryRef: string;
  repositoryLabel: string;
  trigger: AutomationTrigger;
  instructions: string;
  tools: string[];
  createdAt: string;
  updatedAt: string;
  runs: AutomationRunRecord[];
}

export interface AutomationRunRecord {
  id: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt?: string;
  operationRef: string;
  summary: string;
}

export interface AutomationsModuleStore {
  schemaVersion: 1;
  records: AutomationRecord[];
}

export interface AutomationsModuleHandlerOptions {
  workspacePath?: string;
  now?: () => Date;
}

const AUTOMATIONS_MODULE_ID = 'automations';
const AUTOMATIONS_STORE_RELATIVE_PATH = '.sciforge/automations.json';
const MAX_RECORDS = 500;
const MAX_RUNS_PER_RECORD = 40;
const MAX_INLINE_TEXT = 12_000;
const DEFAULT_TOOLS = ['Memories'];

export function createAutomationsModuleHandler(options: AutomationsModuleHandlerOptions = {}) {
  const workspaceRoot = normalizeWorkspaceRootPath(options.workspacePath || process.cwd());
  const now = options.now ?? (() => new Date());
  const storePath = join(workspaceRoot, AUTOMATIONS_STORE_RELATIVE_PATH);

  return {
    describe: automationsDescription,
    async query(request: ModuleQueryRequest) {
      try {
        const store = await readStore(storePath);
        const needle = publicLine(request.query ?? '', 80).toLowerCase();
        const status = stringField(request.filters?.status);
        const records = store.records
          .filter((record) => !needle || automationSearchText(record).toLowerCase().includes(needle))
          .filter((record) => !status || record.status === status)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, clampLimit(request.limit));
        return ok({
          items: records.map(publicAutomationRecord),
          total: store.records.length,
          metrics: automationMetrics(store.records),
          ref: 'automation:',
        }, records.map((record) => record.ref));
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
    async read(request: ModuleReadRequest) {
      try {
        const id = automationIdFromRef(request.ref);
        if (!id) return fail('invalid_automation_ref');
        const store = await readStore(storePath);
        const record = store.records.find((item) => item.id === id);
        if (!record) return fail('automation_not_found');
        return ok(publicAutomationRecord(record), [record.ref]);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
    async invoke(request: ModuleInvokeRequest) {
      if (!request.approvalToken) return fail(`approval_required:${request.intent}`);
      try {
        const store = await readStore(storePath);
        const at = now().toISOString();
        const input = request.input ?? {};
        const next = invokeStore(store, request.intent, input, at, request.idempotencyKey);
        if (!next.ok) return fail(next.error);
        await writeStore(storePath, next.store);
        return ok(next.value, next.refs, next.operationRef);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  };
}

function automationsDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: AUTOMATIONS_MODULE_ID,
    title: 'Automations',
    summary: 'Workspace automation records with query/read and approval-gated create, update, enable, delete, and run intents.',
    resources: [{
      kind: 'automation',
      refPrefix: 'automation:',
      queryable: true,
      readable: true,
      summary: 'Workspace automation definitions and bounded run history.',
    }],
    intents: [
      { name: 'create', sideEffect: 'workspace', requiresApproval: true, returnsOperation: true },
      { name: 'update', sideEffect: 'workspace', requiresApproval: true, returnsOperation: true },
      { name: 'set-enabled', sideEffect: 'workspace', requiresApproval: true, returnsOperation: true },
      { name: 'delete', sideEffect: 'workspace', requiresApproval: true, returnsOperation: true },
      { name: 'run-now', sideEffect: 'workspace', requiresApproval: true, returnsOperation: true },
    ],
    facets: { refs: true, approval: true },
    limits: { maxInlineBytes: MAX_INLINE_TEXT, expectedLatencyMs: 100 },
  });
}

function invokeStore(
  store: AutomationsModuleStore,
  intent: string,
  input: Record<string, unknown>,
  nowIso: string,
  idempotencyKey?: string,
): {
  ok: true;
  store: AutomationsModuleStore;
  value: unknown;
  refs: string[];
  operationRef: string;
} | { ok: false; error: string } {
  if (intent === 'create') {
    const id = safeId(stringField(input.id) || idempotencyKey || `automation-${Date.parse(nowIso).toString(36)}`);
    if (!id) return { ok: false, error: 'invalid_automation_id' };
    if (store.records.some((record) => record.id === id)) return { ok: false, error: 'automation_already_exists' };
    const record = normalizeAutomationInput(input, nowIso, { id });
    const nextStore = { ...store, records: [record, ...store.records].slice(0, MAX_RECORDS) };
    return operation('create', nextStore, publicAutomationRecord(record), [record.ref], record.id);
  }

  const id = automationIdFromRef(stringField(input.ref) || stringField(input.id) || '');
  if (!id) return { ok: false, error: 'missing_automation_ref' };
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) return { ok: false, error: 'automation_not_found' };
  const current = store.records[index]!;

  if (intent === 'delete') {
    const nextStore = { ...store, records: store.records.filter((record) => record.id !== id) };
    return operation('delete', nextStore, { deletedRef: current.ref }, [current.ref], id);
  }

  if (intent === 'set-enabled') {
    const enabled = input.enabled === true;
    const record = {
      ...current,
      enabled,
      status: enabled ? 'ready' as const : 'paused' as const,
      updatedAt: nowIso,
    };
    const nextStore = replaceRecord(store, record);
    return operation('set-enabled', nextStore, publicAutomationRecord(record), [record.ref], id);
  }

  if (intent === 'run-now') {
    const run: AutomationRunRecord = {
      id: safeId(`run-${Date.parse(nowIso).toString(36)}`),
      status: 'queued',
      startedAt: nowIso,
      operationRef: `automations:operation:run-now:${encodeURIComponent(id)}`,
      summary: 'Queued by Agent Host automation intent.',
    };
    const record = {
      ...current,
      status: 'running' as const,
      updatedAt: nowIso,
      runs: [run, ...current.runs].slice(0, MAX_RUNS_PER_RECORD),
    };
    const nextStore = replaceRecord(store, record);
    return operation('run-now', nextStore, publicAutomationRecord(record), [record.ref, run.operationRef], id);
  }

  if (intent === 'update') {
    const record = normalizeAutomationInput({ ...current, ...input }, nowIso, {
      id: current.id,
      createdAt: current.createdAt,
      runs: current.runs,
    });
    const nextStore = replaceRecord(store, record);
    return operation('update', nextStore, publicAutomationRecord(record), [record.ref], id);
  }

  return { ok: false, error: `unsupported_intent:${intent}` };
}

function normalizeAutomationInput(
  input: Record<string, unknown>,
  nowIso: string,
  options: { id: string; createdAt?: string; runs?: AutomationRunRecord[] },
): AutomationRecord {
  const enabled = input.enabled !== false;
  const trigger = normalizeTrigger(input.trigger);
  const tools = normalizeTools(input.tools);
  return {
    schemaVersion: 1,
    id: options.id,
    ref: `automation:${options.id}`,
    name: publicLine(stringField(input.name) || 'New Automation', 80),
    author: publicLine(stringField(input.author) || 'You', 40),
    enabled,
    status: enabled ? normalizeStatus(input.status, 'ready') : 'paused',
    repositoryRef: publicRef(stringField(input.repositoryRef) || 'workspace:current'),
    repositoryLabel: publicLine(stringField(input.repositoryLabel) || 'No Repository', 64),
    trigger,
    instructions: publicMultiline(stringField(input.instructions) || ''),
    tools,
    createdAt: options.createdAt || stringField(input.createdAt) || nowIso,
    updatedAt: nowIso,
    runs: normalizeRuns(options.runs ?? input.runs),
  };
}

async function readStore(path: string): Promise<AutomationsModuleStore> {
  try {
    return normalizeStore(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { schemaVersion: 1, records: [] };
    throw error;
  }
}

async function writeStore(path: string, store: AutomationsModuleStore) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, 'utf8');
}

function normalizeStore(value: unknown): AutomationsModuleStore {
  if (!value || typeof value !== 'object') return { schemaVersion: 1, records: [] };
  const raw = value as { records?: unknown };
  return {
    schemaVersion: 1,
    records: Array.isArray(raw.records)
      ? raw.records.flatMap((record) => normalizeStoredRecord(record)).slice(0, MAX_RECORDS)
      : [],
  };
}

function normalizeStoredRecord(value: unknown): AutomationRecord[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  const id = safeId(stringField(raw.id) || automationIdFromRef(stringField(raw.ref) || ''));
  if (!id) return [];
  const createdAt = stringField(raw.createdAt) || new Date(0).toISOString();
  const updatedAt = stringField(raw.updatedAt) || createdAt;
  return [normalizeAutomationInput(raw, updatedAt, {
    id,
    createdAt,
    runs: normalizeRuns(raw.runs),
  })];
}

function normalizeRuns(value: unknown): AutomationRunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AutomationRunRecord[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = safeId(stringField(raw.id) || '');
    const startedAt = stringField(raw.startedAt);
    if (!id || !startedAt) return [];
    const status = raw.status === 'successful' || raw.status === 'failed' ? raw.status : 'queued';
    return [{
      id,
      status,
      startedAt,
      completedAt: stringField(raw.completedAt),
      operationRef: publicRef(stringField(raw.operationRef) || `automations:operation:run:${encodeURIComponent(id)}`),
      summary: publicLine(stringField(raw.summary) || status, 120),
    }];
  }).slice(0, MAX_RUNS_PER_RECORD);
}

function normalizeTrigger(value: unknown): AutomationTrigger {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type: AutomationTriggerType = record.type === 'schedule' || record.type === 'workspace-event' ? record.type : 'manual';
  const schedule = publicLine(stringField(record.schedule) || '', 80);
  const label = publicLine(stringField(record.label) || triggerLabel(type, schedule), 80);
  return {
    type,
    label,
    ...(schedule ? { schedule } : {}),
  };
}

function triggerLabel(type: AutomationTriggerType, schedule: string) {
  if (type === 'schedule') return schedule || 'Scheduled';
  if (type === 'workspace-event') return 'Workspace event';
  return 'Manual';
}

function normalizeTools(value: unknown): string[] {
  const tools = Array.isArray(value) ? value : DEFAULT_TOOLS;
  const clean = Array.from(new Set(tools.flatMap((item) => {
    const line = publicLine(String(item ?? ''), 40);
    return line ? [line] : [];
  })));
  return clean.length ? clean.slice(0, 12) : [...DEFAULT_TOOLS];
}

function normalizeStatus(value: unknown, fallback: AutomationStatus): AutomationStatus {
  return value === 'paused'
    || value === 'running'
    || value === 'successful'
    || value === 'failed'
    || value === 'ready'
    ? value
    : fallback;
}

function publicAutomationRecord(record: AutomationRecord): AutomationRecord {
  return {
    ...record,
    name: publicLine(record.name, 80),
    author: publicLine(record.author, 40),
    repositoryRef: publicRef(record.repositoryRef),
    repositoryLabel: publicLine(record.repositoryLabel, 64),
    instructions: publicMultiline(record.instructions),
    trigger: normalizeTrigger(record.trigger),
    tools: normalizeTools(record.tools),
    runs: normalizeRuns(record.runs),
  };
}

function automationMetrics(records: AutomationRecord[]) {
  return {
    total: records.length,
    successful7d: records.filter((record) => record.status === 'successful').length,
    failed7d: records.filter((record) => record.status === 'failed').length,
    enabled: records.filter((record) => record.enabled).length,
  };
}

function automationSearchText(record: AutomationRecord) {
  return [
    record.name,
    record.author,
    record.status,
    record.repositoryLabel,
    record.trigger.label,
    record.tools.join(' '),
  ].join(' ');
}

function replaceRecord(store: AutomationsModuleStore, record: AutomationRecord): AutomationsModuleStore {
  return {
    ...store,
    records: store.records.map((item) => item.id === record.id ? record : item),
  };
}

function operation(
  intent: string,
  store: AutomationsModuleStore,
  value: unknown,
  refs: string[],
  id: string,
) {
  return {
    ok: true as const,
    store,
    value,
    refs,
    operationRef: `automations:operation:${intent}:${encodeURIComponent(id)}`,
  };
}

function ok<T>(value: T, refs: string[] = [], operationRef?: string): ModuleResultEnvelope<T> {
  return moduleResult({
    moduleId: AUTOMATIONS_MODULE_ID,
    ok: true,
    value,
    refs: uniqueStrings(refs.map(publicRef)),
    operationRef: operationRef ? publicRef(operationRef) : undefined,
  });
}

function fail(error: string): ModuleResultEnvelope {
  return moduleResult({
    moduleId: AUTOMATIONS_MODULE_ID,
    ok: false,
    error: scrubAutomationText(error),
  });
}

function automationIdFromRef(ref: string) {
  return safeId(ref.trim().replace(/^automation:/i, '').replace(/^automations?:\/\//i, ''));
}

function safeId(value: string) {
  return value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
}

function publicRef(value: string) {
  const clean = scrubAutomationText(value.trim());
  if (!clean) return '';
  if (/^(automation|automations:operation|workspace|project|gui):/i.test(clean)) return clean.slice(0, 160);
  return 'automation:ref';
}

function publicLine(value: string, maxLength: number) {
  const clean = scrubAutomationText(value).replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 1))}…` : clean;
}

function publicMultiline(value: string) {
  return scrubAutomationText(value)
    .split(/\r?\n/)
    .map((line) => publicLine(line, 180))
    .join('\n')
    .slice(0, 4000);
}

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(Number.isInteger(limit) && limit ? limit : 100, 500));
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function scrubAutomationText(value: string) {
  return value
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(
      /\b(api[_-]?key|authorization|credential|password|secret|token)\b(\s*[:=]\s*)(["']?)[^"',}\]\s]+/gi,
      (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[redacted]`,
    )
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\bfile:\/\/\/[^\s"'<>\\)]+/gi, '[redacted-local-path]')
    .replace(/(^|[\s"'([{<])((?:\/(?:Applications|Users|home|private|var|tmp|etc|opt)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/g, '$1[redacted-local-path]');
}
