import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
      resourcesRoot: bundleRel,
    },
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
