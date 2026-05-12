import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from './runtime-types';
import { sessionBundleResourceRel } from './session-bundle.js';
import { isRecord } from './gateway-utils.js';

export const RUNTIME_EVENT_RECORDER_SCHEMA_VERSION = 'sciforge.runtime-event-recorder.v1' as const;

export interface RuntimeEventRecorderOptions {
  workspacePath: string;
  sessionBundleRef?: string;
  sessionId?: string;
  runId?: string;
  now?: () => Date;
  recordRel?: string;
}

export interface RuntimeEventRecorder {
  callbacks: WorkspaceRuntimeCallbacks;
  runtimeEventsRef: string;
  flush(): Promise<void>;
}

export function createRuntimeEventRecorder(
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: RuntimeEventRecorderOptions,
): RuntimeEventRecorder {
  const workspace = resolve(options.workspacePath || process.cwd());
  const runtimeEventsRef = options.recordRel ?? sessionBundleResourceRel(options.sessionBundleRef, 'records', 'runtime-events.ndjson');
  const path = workspacePathForRef(workspace, runtimeEventsRef);
  const buffer: WorkspaceRuntimeEvent[] = [];
  const now = options.now ?? (() => new Date());
  let pending = Promise.resolve();

  async function append(event: WorkspaceRuntimeEvent): Promise<void> {
    const normalized = normalizeRuntimeEventForRecord(event, {
      index: buffer.length,
      now,
      runId: options.runId,
      sessionId: options.sessionId,
      sessionBundleRef: options.sessionBundleRef,
    });
    buffer.push(normalized);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(normalized)}\n`, 'utf8');
  }

  return {
    runtimeEventsRef,
    callbacks: {
      ...callbacks,
      onEvent(event) {
        callbacks.onEvent?.(event);
        pending = pending.then(() => append(event));
      },
    },
    async flush() {
      await pending;
      await mkdir(dirname(path), { recursive: true });
      if (!buffer.length) {
        await writeFile(path, '', { flag: 'a' });
      }
    },
  };
}

export function normalizeRuntimeEventForRecord(
  event: WorkspaceRuntimeEvent,
  options: {
    index?: number;
    now?: () => Date;
    runId?: string;
    sessionId?: string;
    sessionBundleRef?: string;
  } = {},
): WorkspaceRuntimeEvent {
  const raw = isRecord(event.raw) ? event.raw : {};
  const timestamp = stringField(raw.timestamp) ?? options.now?.().toISOString() ?? new Date().toISOString();
  const type = event.type || 'runtime-event';
  return {
    ...event,
    raw: {
      ...raw,
      id: stringField(raw.id) ?? `${safeSegment(type)}-${Math.max(0, options.index ?? 0)}`,
      timestamp,
      runId: stringField(raw.runId) ?? options.runId,
      sessionId: stringField(raw.sessionId) ?? options.sessionId,
      sessionBundleRef: stringField(raw.sessionBundleRef) ?? options.sessionBundleRef,
      recorderSchemaVersion: RUNTIME_EVENT_RECORDER_SCHEMA_VERSION,
    },
  };
}

function workspacePathForRef(workspace: string, ref: string): string {
  const clean = ref.replace(/^file:/, '').replace(/^\/+/, '');
  return join(workspace, clean);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'event';
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
