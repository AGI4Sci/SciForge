import { createHash } from 'node:crypto';

import type { ConversationRef } from './types';

export type RefStoreBody = string | Uint8Array;

export interface RefStoreDescriptor extends ConversationRef {
  ref: string;
  digest: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  kind?: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterRefInput {
  ref?: string;
  body: RefStoreBody;
  mime?: string;
  label?: string;
  kind?: string;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface RefStoreEntry {
  descriptor: RefStoreDescriptor;
  body: RefStoreBody;
}

export interface RefStorePage {
  limit?: number;
  cursor?: string;
}

export interface RefStoreFilter {
  refPrefix?: string;
  mime?: string;
  kind?: string;
  tag?: string;
  tags?: string[];
}

export interface RefStoreListResult {
  descriptors: RefStoreDescriptor[];
  nextCursor?: string;
}

export interface RefStore {
  registerRef(input: RegisterRefInput): RefStoreDescriptor;
  readRef(ref: string): RefStoreEntry | undefined;
  listRefs(page?: RefStorePage, filter?: RefStoreFilter): RefStoreListResult;
}

export const REF_STORE_DEFAULT_PAGE_LIMIT = 50;
export const REF_STORE_MAX_PAGE_LIMIT = 200;

export function createInMemoryRefStore(now: () => string = () => new Date().toISOString()): RefStore {
  const refs = new Map<string, RefStoreEntry>();

  return {
    registerRef(input: RegisterRefInput): RefStoreDescriptor {
      const bytes = bodyBytes(input.body);
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const ref = input.ref ?? `ref:${digest}`;
      if (!ref.trim()) {
        throw new Error('RefStore.registerRef requires a non-empty ref.');
      }
      if (refs.has(ref)) {
        throw new Error(`RefStore already contains ref ${ref}.`);
      }

      const timestamp = input.createdAt ?? now();
      const descriptor: RefStoreDescriptor = {
        ref,
        digest,
        sizeBytes: bytes.byteLength,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.mime ? { mime: input.mime } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.tags ? { tags: [...input.tags] } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
      };

      refs.set(ref, {
        descriptor: cloneDescriptor(descriptor),
        body: cloneBody(input.body),
      });
      return cloneDescriptor(descriptor);
    },

    readRef(ref: string): RefStoreEntry | undefined {
      const entry = refs.get(ref);
      if (!entry) return undefined;
      return {
        descriptor: cloneDescriptor(entry.descriptor),
        body: cloneBody(entry.body),
      };
    },

    listRefs(page: RefStorePage = {}, filter: RefStoreFilter = {}): RefStoreListResult {
      const limit = normalizeLimit(page.limit);
      const start = normalizeCursor(page.cursor);
      const filtered = Array.from(refs.values())
        .map((entry) => entry.descriptor)
        .filter((descriptor) => matchesFilter(descriptor, filter));
      const descriptors = filtered.slice(start, start + limit).map(cloneDescriptor);
      const nextOffset = start + descriptors.length;
      return {
        descriptors,
        ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
      };
    },
  };
}

function matchesFilter(descriptor: RefStoreDescriptor, filter: RefStoreFilter): boolean {
  if (filter.refPrefix && !descriptor.ref.startsWith(filter.refPrefix)) return false;
  if (filter.mime && descriptor.mime !== filter.mime) return false;
  if (filter.kind && descriptor.kind !== filter.kind) return false;
  if (filter.tag && !descriptor.tags?.includes(filter.tag)) return false;
  if (filter.tags?.length) {
    const descriptorTags = new Set(descriptor.tags ?? []);
    if (!filter.tags.every((tag) => descriptorTags.has(tag))) return false;
  }
  return true;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return REF_STORE_DEFAULT_PAGE_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return REF_STORE_DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(limit), REF_STORE_MAX_PAGE_LIMIT);
}

function normalizeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function bodyBytes(body: RefStoreBody): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return body;
}

function cloneBody(body: RefStoreBody): RefStoreBody {
  if (typeof body === 'string') return body;
  return new Uint8Array(body);
}

function cloneDescriptor(descriptor: RefStoreDescriptor): RefStoreDescriptor {
  return {
    ...descriptor,
    ...(descriptor.tags ? { tags: [...descriptor.tags] } : {}),
    ...(descriptor.metadata ? { metadata: { ...descriptor.metadata } } : {}),
  };
}
