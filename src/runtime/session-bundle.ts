import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GatewayRequest } from './runtime-types.js';
import { isRecord } from './gateway-utils.js';

export const SESSION_BUNDLE_SCHEMA_VERSION = 'sciforge.session-bundle.v1' as const;

export interface SessionBundleMetadata {
  sessionId: string;
  scenarioId?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SessionBundleChecklistPhase = 'pack' | 'restore' | 'audit';
export type SessionBundleChecklistStatus = 'pass' | 'warn' | 'fail';

export interface SessionBundleChecklistItem {
  id: string;
  phase: SessionBundleChecklistPhase;
  label: string;
  required: boolean;
  refs: string[];
  status?: SessionBundleChecklistStatus;
  detail?: string;
}

export interface SessionBundleAuditReport {
  schemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  bundleRel: string;
  generatedAt: string;
  ready: boolean;
  summary: {
    passed: number;
    warned: number;
    failed: number;
  };
  checklist: SessionBundleChecklistItem[];
}

export function sessionBundleRelForRequest(request: GatewayRequest, now = new Date()) {
  const sessionId = stringField(request.uiState?.sessionId) || 'sessionless';
  const scenarioId = stringField(request.scenarioPackageRef?.id)
    || stringField(request.uiState?.activeScenarioId)
    || request.skillDomain;
  const createdAt = stringField(request.uiState?.sessionCreatedAt) || now.toISOString();
  return sessionBundleRel({
    sessionId,
    scenarioId,
    createdAt,
  });
}

export function sessionBundleRel(metadata: SessionBundleMetadata) {
  const date = datePrefix(metadata.createdAt);
  const scenario = safeSegment(metadata.scenarioId || 'scenario');
  const session = safeSegment(metadata.sessionId || 'sessionless');
  return `.sciforge/sessions/${date}_${scenario}_${session}`;
}

export function sessionBundleResourceRel(bundleRel: string | undefined, bucket: string, filename: string) {
  const cleanBundle = bundleRel?.replace(/\/+$/, '');
  return cleanBundle
    ? `${cleanBundle}/${safeSegment(bucket)}/${safeSegment(filename)}`
    : `.sciforge/${safeSegment(bucket)}/${safeSegment(filename)}`;
}

export async function ensureSessionBundle(workspace: string, bundleRel: string, metadata: SessionBundleMetadata) {
  const root = join(workspace, bundleRel);
  await Promise.all([
    mkdir(join(root, 'records'), { recursive: true }),
    mkdir(join(root, 'records', 'task-attempts'), { recursive: true }),
    mkdir(join(root, 'tasks'), { recursive: true }),
    mkdir(join(root, 'task-inputs'), { recursive: true }),
    mkdir(join(root, 'task-results'), { recursive: true }),
    mkdir(join(root, 'logs'), { recursive: true }),
    mkdir(join(root, 'artifacts'), { recursive: true }),
    mkdir(join(root, 'verifications'), { recursive: true }),
    mkdir(join(root, 'handoffs'), { recursive: true }),
    mkdir(join(root, 'debug'), { recursive: true }),
    mkdir(join(root, 'versions'), { recursive: true }),
    mkdir(join(root, 'data'), { recursive: true }),
    mkdir(join(root, 'exports'), { recursive: true }),
  ]);
  await writeSessionBundleManifest(workspace, bundleRel, metadata);
}

export async function auditSessionBundle(workspace: string, bundleRel: string, now = new Date()): Promise<SessionBundleAuditReport> {
  const checklist = await Promise.all(sessionBundleChecklistTemplate(bundleRel).map(async (item) => ({
    ...item,
    ...await checklistStatus(workspace, item),
  })));
  const failed = checklist.filter((item) => item.status === 'fail').length;
  const warned = checklist.filter((item) => item.status === 'warn').length;
  const passed = checklist.filter((item) => item.status === 'pass').length;
  return {
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    bundleRel,
    generatedAt: now.toISOString(),
    ready: failed === 0,
    summary: { passed, warned, failed },
    checklist,
  };
}

export async function writeSessionBundleAudit(
  workspace: string,
  bundleRel: string,
  now = new Date(),
): Promise<{ report: SessionBundleAuditReport; auditRef: string }> {
  const report = await auditSessionBundle(workspace, bundleRel, now);
  const auditRef = `${bundleRel.replace(/\/+$/, '')}/records/session-bundle-audit.json`;
  await mkdir(join(workspace, bundleRel, 'records'), { recursive: true });
  await writeFile(join(workspace, auditRef), JSON.stringify(report, null, 2));
  return { report, auditRef };
}

async function writeSessionBundleManifest(workspace: string, bundleRel: string, metadata: SessionBundleMetadata) {
  const manifestPath = join(workspace, bundleRel, 'manifest.json');
  const previous = await readJsonIfPresent(manifestPath);
  const now = new Date().toISOString();
  const manifest = {
    ...(isRecord(previous) ? previous : {}),
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    sessionId: metadata.sessionId,
    scenarioId: metadata.scenarioId,
    title: metadata.title,
    createdAt: metadata.createdAt ?? (isRecord(previous) ? stringField(previous.createdAt) : undefined) ?? now,
    updatedAt: metadata.updatedAt ?? now,
    restore: {
      workspaceStateRef: '.sciforge/workspace-state.json',
      sessionRef: `${bundleRel}/records/session.json`,
      messagesRef: `${bundleRel}/records/messages.json`,
      runsRef: `${bundleRel}/records/runs.json`,
      executionUnitsRef: `${bundleRel}/records/execution-units.json`,
      taskAttemptsRoot: `${bundleRel}/records/task-attempts/`,
      resourcesRoot: bundleRel,
    },
    migrationChecklist: sessionBundleChecklistTemplate(bundleRel).map(({ status, detail, ...item }) => item),
    layout: {
      records: 'records/',
      taskCode: 'tasks/',
      taskInputs: 'task-inputs/',
      taskResults: 'task-results/',
      logs: 'logs/',
      artifacts: 'artifacts/',
      verifications: 'verifications/',
      handoffs: 'handoffs/',
      debug: 'debug/',
      versions: 'versions/',
      data: 'data/',
      exports: 'exports/',
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function sessionBundleChecklistTemplate(bundleRel: string): SessionBundleChecklistItem[] {
  const root = bundleRel.replace(/\/+$/, '');
  return [
    {
      id: 'pack.manifest',
      phase: 'pack',
      label: 'Bundle manifest declares schema, layout, restore refs, and checklist.',
      required: true,
      refs: [`${root}/manifest.json`],
    },
    {
      id: 'pack.session-records',
      phase: 'pack',
      label: 'Portable session records are split for direct inspection and import.',
      required: true,
      refs: [
        `${root}/records/session.json`,
        `${root}/records/messages.json`,
        `${root}/records/runs.json`,
        `${root}/records/execution-units.json`,
      ],
    },
    {
      id: 'pack.generated-work',
      phase: 'pack',
      label: 'Generated task code, inputs, outputs, logs, artifacts, data, and exports stay under the bundle root.',
      required: true,
      refs: [
        `${root}/tasks/`,
        `${root}/task-inputs/`,
        `${root}/task-results/`,
        `${root}/logs/`,
        `${root}/artifacts/`,
        `${root}/data/`,
        `${root}/exports/`,
      ],
    },
    {
      id: 'restore.entrypoints',
      phase: 'restore',
      label: 'Restore entry points include session, messages, runs, execution units, and task-attempt ledger.',
      required: true,
      refs: [
        `${root}/records/session.json`,
        `${root}/records/messages.json`,
        `${root}/records/runs.json`,
        `${root}/records/execution-units.json`,
        `${root}/records/task-attempts/`,
      ],
    },
    {
      id: 'restore.handoff-context',
      phase: 'restore',
      label: 'Handoff, verification, debug, and version records are colocated for continuation or repair.',
      required: false,
      refs: [
        `${root}/handoffs/`,
        `${root}/verifications/`,
        `${root}/debug/`,
        `${root}/versions/`,
      ],
    },
    {
      id: 'audit.replay-evidence',
      phase: 'audit',
      label: 'Audit evidence includes runtime events, attempts, verification refs, and readable README.',
      required: false,
      refs: [
        `${root}/records/runtime-events.ndjson`,
        `${root}/records/task-attempts/`,
        `${root}/verifications/`,
        `${root}/README.md`,
      ],
    },
  ];
}

async function checklistStatus(workspace: string, item: SessionBundleChecklistItem) {
  const results = await Promise.all(item.refs.map((ref) => refExists(workspace, ref)));
  const present = results.filter(Boolean).length;
  if (present === item.refs.length) {
    return { status: 'pass' as const, detail: `found ${present}/${item.refs.length} refs` };
  }
  if (present > 0 || !item.required) {
    return { status: 'warn' as const, detail: `found ${present}/${item.refs.length} refs` };
  }
  return { status: 'fail' as const, detail: `found ${present}/${item.refs.length} refs` };
}

async function refExists(workspace: string, ref: string) {
  const absolute = join(workspace, ref.replace(/\/+$/, ''));
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) {
      return ref.endsWith('/') ? true : (await readdir(absolute)).length > 0;
    }
    return info.isFile();
  } catch {
    return false;
  }
}

async function readJsonIfPresent(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function datePrefix(value: string | undefined) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'item';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
