import type { ProjectMemoryRef, ProjectMemoryRefKind } from '../project-session-memory.js';
import {
  PROJECT_MEMORY_REF_KINDS,
  projectMemoryRefRetention,
} from '../project-session-memory.js';
import { appendConversationEvent, createConversationEventLog, validateConversationEvent } from './event-log';
import { projectConversation } from './projection';
import { createInMemoryRefStore, type RefStoreBody, type RefStoreEntry, type RefStoreFilter, type RefStorePage } from './ref-store';
import { replayConversationState } from './state-machine';
import type { ConversationEvent, ConversationEventLog, ConversationProjection } from './types';

export type WorkspaceEvent = ConversationEvent;
export type WorkspaceRefContent = RefStoreBody;

export interface WorkspaceAppendOptions {
  expectedProjectionVersion?: number;
}

export interface WorkspaceAppendResult {
  eventId: string;
  projection: ConversationProjection;
  projectionVersion: number;
}

export type AppendResult = WorkspaceAppendResult;

export interface WorkspaceAppendCommit {
  sessionId: string;
  eventId: string;
  projectionVersion: number;
  ledgerLength: number;
}

export interface WorkspaceRefMeta {
  ref?: string;
  kind: ProjectMemoryRefKind;
  mime?: string;
  preview?: string;
  producerRunId?: string;
  readable?: boolean;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface WorkspaceRefDescriptor extends Omit<ProjectMemoryRef, 'preview'> {
  createdAt: string;
  updatedAt: string;
  preview?: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  tombstoned?: boolean;
}

export interface WorkspaceRefPage {
  descriptors: WorkspaceRefDescriptor[];
  nextCursor?: string;
}

export type WorkspaceStorageAdapterKind = 'in-memory' | 'filesystem' | 'sqlite';

export interface WorkspaceStorageAdapter {
  contractVersion: 'sciforge.workspace-storage-adapter.v1';
  kind: WorkspaceStorageAdapterKind;
  synchronousWrites: true;
  appendLedgerEvent(
    sessionId: string,
    event: WorkspaceEvent,
    expectedProjectionVersion?: number,
  ): WorkspaceAppendCommit;
  loadLedger(sessionId: string): ConversationEventLog | undefined;
  loadProjection(sessionId: string): ConversationProjection | undefined;
  saveProjection(sessionId: string, projection: ConversationProjection, expectedVersion?: number): void;
  putRef(content: WorkspaceRefContent, meta: WorkspaceRefMeta): ProjectMemoryRef;
  getRef(ref: ProjectMemoryRef | string): RefStoreEntry | undefined;
  listRefs(page?: RefStorePage, filter?: RefStoreFilter): WorkspaceRefPage;
  markRefTombstoned(refId: string, reason: string): void;
}

export type StorageAdapter = WorkspaceStorageAdapter;

export interface WorkspaceKernel {
  appendEvent(event: WorkspaceEvent, options?: WorkspaceAppendOptions): WorkspaceAppendResult;
  restoreProjection(sessionId: string): ConversationProjection;
  replayProjection(sessionId: string, options?: { untilEventId?: string }): ConversationProjection;
  registerRef(content: WorkspaceRefContent, meta: WorkspaceRefMeta): ProjectMemoryRef;
  readRef(ref: ProjectMemoryRef | string): RefStoreEntry | undefined;
  listRefs(page?: RefStorePage, filter?: RefStoreFilter): WorkspaceRefPage;
}

export function createWorkspaceKernel(input: {
  sessionId: string;
  storage?: WorkspaceStorageAdapter;
}): WorkspaceKernel {
  const sessionId = requireSessionId(input.sessionId);
  const storage = input.storage ?? createInMemoryWorkspaceStorageAdapter();
  assertWorkspaceStorageAdapter(storage);

  return {
    appendEvent(event: WorkspaceEvent, options: WorkspaceAppendOptions = {}): WorkspaceAppendResult {
      const rejected = validateConversationEvent(event);
      if (rejected) {
        throw new WorkspaceKernelError(rejected.code, rejected.message);
      }
      const savedProjection = storage.loadProjection(sessionId);
      const saveExpectedVersion = savedProjection ? projectionVersionOf(savedProjection) : undefined;
      const commit = storage.appendLedgerEvent(sessionId, clone(event), options.expectedProjectionVersion);
      const ledger = storage.loadLedger(sessionId);
      if (!ledger) {
        throw new WorkspaceKernelError('ledger-unavailable', `Workspace ledger ${sessionId} was not available after append.`);
      }
      const projection = materializeProjection(ledger, commit.projectionVersion);
      storage.saveProjection(sessionId, projection, saveExpectedVersion);
      return {
        eventId: commit.eventId,
        projection,
        projectionVersion: commit.projectionVersion,
      };
    },

    restoreProjection(targetSessionId: string): ConversationProjection {
      const restoredSessionId = requireSessionId(targetSessionId);
      const existing = storage.loadProjection(restoredSessionId);
      if (existing) return existing;
      const ledger = storage.loadLedger(restoredSessionId) ?? createConversationEventLog(restoredSessionId);
      const projection = materializeProjection(ledger, ledger.events.length);
      storage.saveProjection(restoredSessionId, projection);
      return projection;
    },

    replayProjection(targetSessionId: string, options: { untilEventId?: string } = {}): ConversationProjection {
      const restoredSessionId = requireSessionId(targetSessionId);
      const ledger = storage.loadLedger(restoredSessionId) ?? createConversationEventLog(restoredSessionId);
      if (!options.untilEventId) return materializeProjection(ledger, ledger.events.length);
      const eventIndex = ledger.events.findIndex((event) => event.id === options.untilEventId);
      if (eventIndex < 0) {
        throw new WorkspaceKernelError('event-not-found', `Workspace event ${options.untilEventId} was not found.`);
      }
      return materializeProjection({
        ...ledger,
        events: ledger.events.slice(0, eventIndex + 1),
      }, eventIndex + 1);
    },

    registerRef(content: WorkspaceRefContent, meta: WorkspaceRefMeta): ProjectMemoryRef {
      assertNoRetentionOverride(meta);
      return storage.putRef(content, meta);
    },

    readRef(ref: ProjectMemoryRef | string): RefStoreEntry | undefined {
      return storage.getRef(ref);
    },

    listRefs(page?: RefStorePage, filter?: RefStoreFilter): WorkspaceRefPage {
      return storage.listRefs(page, filter);
    },
  };
}

export function createInMemoryWorkspaceStorageAdapter(
  now: () => string = () => new Date().toISOString(),
): WorkspaceStorageAdapter {
  const ledgers = new Map<string, ConversationEventLog>();
  const projections = new Map<string, ConversationProjection>();
  const tombstones = new Map<string, { reason: string; tombstonedAt: string }>();
  const refStore = createInMemoryRefStore(now);

  return {
    contractVersion: 'sciforge.workspace-storage-adapter.v1',
    kind: 'in-memory',
    synchronousWrites: true,

    appendLedgerEvent(
      sessionId: string,
      event: WorkspaceEvent,
      expectedProjectionVersion?: number,
    ): WorkspaceAppendCommit {
      const normalizedSessionId = requireSessionId(sessionId);
      const current = ledgers.get(normalizedSessionId) ?? createConversationEventLog(normalizedSessionId);
      const currentVersion = projectionVersionOf(projections.get(normalizedSessionId)) || current.events.length;
      if (expectedProjectionVersion !== undefined && expectedProjectionVersion !== currentVersion) {
        throw new WorkspaceKernelError(
          'projection-version-conflict',
          `Expected projectionVersion ${expectedProjectionVersion} but current projectionVersion is ${currentVersion}.`,
        );
      }
      if (current.events.some((existing) => existing.id === event.id)) {
        throw new WorkspaceKernelError('duplicate-event-id', `Workspace ledger already contains event ${event.id}.`);
      }
      const appended = appendConversationEvent(current, event);
      if (appended.rejected) {
        throw new WorkspaceKernelError(appended.rejected.code, appended.rejected.message);
      }
      ledgers.set(normalizedSessionId, clone(appended.log));
      return {
        sessionId: normalizedSessionId,
        eventId: event.id,
        projectionVersion: currentVersion + 1,
        ledgerLength: appended.log.events.length,
      };
    },

    loadLedger(sessionId: string): ConversationEventLog | undefined {
      const ledger = ledgers.get(sessionId);
      return ledger ? clone(ledger) : undefined;
    },

    loadProjection(sessionId: string): ConversationProjection | undefined {
      const projection = projections.get(sessionId);
      return projection ? clone(projection) : undefined;
    },

    saveProjection(sessionId: string, projection: ConversationProjection, expectedVersion?: number): void {
      const currentVersion = projectionVersionOf(projections.get(sessionId));
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw new WorkspaceKernelError(
          'projection-version-conflict',
          `Expected projectionVersion ${expectedVersion} before save but current projectionVersion is ${currentVersion}.`,
        );
      }
      projections.set(sessionId, clone(projection));
    },

    putRef(content: WorkspaceRefContent, meta: WorkspaceRefMeta): ProjectMemoryRef {
      assertNoRetentionOverride(meta);
      const descriptor = refStore.registerRef({
        ref: meta.ref,
        body: content,
        mime: meta.mime,
        label: meta.preview,
        kind: meta.kind,
        tags: meta.tags,
        source: meta.source,
        metadata: {
          ...(meta.metadata ?? {}),
          producerRunId: meta.producerRunId,
          readable: meta.readable,
          retention: projectMemoryRefRetention(meta.kind),
        },
        createdAt: meta.createdAt,
      });
      return projectMemoryRefFromDescriptor(descriptor, meta.kind, meta.producerRunId, meta.readable);
    },

    getRef(ref: ProjectMemoryRef | string): RefStoreEntry | undefined {
      const refId = typeof ref === 'string' ? ref : ref.ref;
      if (tombstones.has(refId)) return undefined;
      return refStore.readRef(refId);
    },

    listRefs(page?: RefStorePage, filter?: RefStoreFilter): WorkspaceRefPage {
      const result = refStore.listRefs(page, filter);
      return {
        descriptors: result.descriptors.map((descriptor) => {
          const kind = canonicalRefKind(descriptor.kind);
          const metadata = descriptor.metadata ?? {};
          return {
            ref: descriptor.ref,
            kind,
            digest: descriptor.digest,
            sizeBytes: descriptor.sizeBytes,
            mime: descriptor.mime,
            producerRunId: typeof metadata.producerRunId === 'string' ? metadata.producerRunId : undefined,
            preview: descriptor.label,
            readable: typeof metadata.readable === 'boolean' ? metadata.readable : undefined,
            retention: projectMemoryRefRetention(kind),
            createdAt: descriptor.createdAt,
            updatedAt: descriptor.updatedAt,
            tags: descriptor.tags,
            source: descriptor.source,
            metadata: descriptor.metadata,
            tombstoned: tombstones.has(descriptor.ref) ? true : undefined,
          };
        }),
        nextCursor: result.nextCursor,
      };
    },

    markRefTombstoned(refId: string, reason: string): void {
      if (!refId.trim()) {
        throw new WorkspaceKernelError('invalid-ref-id', 'Ref tombstone requires a non-empty ref id.');
      }
      tombstones.set(refId, { reason, tombstonedAt: now() });
    },
  };
}

export class WorkspaceKernelError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceKernelError';
  }
}

function materializeProjection(log: ConversationEventLog, projectionVersion = log.events.length): ConversationProjection {
  return {
    ...projectConversation(log, replayConversationState(log)),
    projectionVersion,
  };
}

function projectMemoryRefFromDescriptor(
  descriptor: { ref: string; digest: string; sizeBytes: number; mime?: string; label?: string },
  kind: ProjectMemoryRefKind,
  producerRunId?: string,
  readable?: boolean,
): ProjectMemoryRef {
  return {
    ref: descriptor.ref,
    kind,
    digest: descriptor.digest,
    sizeBytes: descriptor.sizeBytes,
    mime: descriptor.mime,
    producerRunId,
    preview: descriptor.label,
    readable,
    retention: projectMemoryRefRetention(kind),
  };
}

function canonicalRefKind(kind: string | undefined): ProjectMemoryRefKind {
  return PROJECT_MEMORY_REF_KINDS.includes(kind as ProjectMemoryRefKind)
    ? kind as ProjectMemoryRefKind
    : 'artifact';
}

function projectionVersionOf(projection: ConversationProjection | undefined): number {
  return typeof projection?.projectionVersion === 'number' ? projection.projectionVersion : 0;
}

function requireSessionId(sessionId: string): string {
  if (!sessionId.trim()) throw new WorkspaceKernelError('invalid-session-id', 'WorkspaceKernel requires a non-empty sessionId.');
  return sessionId;
}

function assertWorkspaceStorageAdapter(storage: WorkspaceStorageAdapter): void {
  if (storage.contractVersion !== 'sciforge.workspace-storage-adapter.v1') {
    throw new WorkspaceKernelError(
      'storage-adapter-contract-version-required',
      'WorkspaceStorageAdapter must declare contractVersion sciforge.workspace-storage-adapter.v1.',
    );
  }
  if (!['in-memory', 'filesystem', 'sqlite'].includes(storage.kind)) {
    throw new WorkspaceKernelError(
      'storage-adapter-kind-required',
      'WorkspaceStorageAdapter kind must be one of in-memory, filesystem, or sqlite.',
    );
  }
  if (storage.synchronousWrites !== true) {
    throw new WorkspaceKernelError(
      'storage-adapter-sync-write-required',
      'WorkspaceStorageAdapter appendLedgerEvent/saveProjection/putRef must be synchronous-on-write.',
    );
  }
}

function assertNoRetentionOverride(meta: WorkspaceRefMeta): void {
  const explicitRetention = (meta as unknown as Record<string, unknown>).retention
    ?? meta.metadata?.retention;
  if (explicitRetention !== undefined) {
    throw new WorkspaceKernelError(
      'ref-retention-override-forbidden',
      'ProjectMemoryRef retention is derived from RefKindGroup; callers must not override retention per ref.',
    );
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
