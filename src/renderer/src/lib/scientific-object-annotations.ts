import {
  scientificObjectAnnotationSchema,
  scientificObjectIdentityKey,
  type ScientificObjectAnnotation,
  type ScientificObjectRef,
  type WorkspaceStructuredSelection
} from '@shared/scientific-objects'
import type { BrowserStorageLike } from './browser-storage'

export const SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY = 'sciforge.scientificObjectAnnotations.v1'
const MAX_STORED_OBJECTS = 256
const MAX_ANNOTATIONS_PER_OBJECT = 1_000

export type ScientificObjectAnnotationStore = Record<string, ScientificObjectAnnotation[]>

export function readScientificObjectAnnotationStore(
  storage: BrowserStorageLike | null
): ScientificObjectAnnotationStore {
  if (!storage) return {}
  try {
    const raw = storage.getItem(SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: ScientificObjectAnnotationStore = {}
    for (const [key, value] of Object.entries(parsed).slice(0, MAX_STORED_OBJECTS)) {
      const [algorithm, digest, workspaceRoot, path] = key.split('\u0000')
      if (
        algorithm !== 'sha256' ||
        digest.length !== 64 ||
        [...digest].some((character) => !'0123456789abcdef'.includes(character)) ||
        !workspaceRoot ||
        !path
      ) continue
      if (!Array.isArray(value)) continue
      const annotations = value
        .slice(0, MAX_ANNOTATIONS_PER_OBJECT)
        .flatMap((candidate) => {
          const annotation = scientificObjectAnnotationSchema.safeParse(candidate)
          return annotation.success ? [annotation.data] : []
        })
      if (annotations.length) result[key] = annotations
    }
    return result
  } catch {
    return {}
  }
}

export function writeScientificObjectAnnotationStore(
  storage: BrowserStorageLike | null,
  store: ScientificObjectAnnotationStore
): void {
  if (!storage) return
  try {
    const bounded = Object.fromEntries(
      Object.entries(store)
        .filter(([, annotations]) => annotations.length > 0)
        .slice(-MAX_STORED_OBJECTS)
        .map(([key, annotations]) => [key, annotations.slice(-MAX_ANNOTATIONS_PER_OBJECT)])
    )
    storage.setItem(SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY, JSON.stringify(bounded))
  } catch {
    // Storage is a best-effort renderer cache; the card remains usable in memory.
  }
}

export function annotationsForScientificObject(
  object: ScientificObjectRef,
  store: ScientificObjectAnnotationStore
): ScientificObjectAnnotation[] {
  const merged = [...(object.annotations ?? []), ...(store[scientificObjectIdentityKey(object)] ?? [])]
  const byId = new Map<string, ScientificObjectAnnotation>()
  for (const annotation of merged) byId.set(annotation.id, annotation)
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function addScientificObjectAnnotation(
  store: ScientificObjectAnnotationStore,
  object: ScientificObjectRef,
  text: string,
  selection?: WorkspaceStructuredSelection,
  options: { id?: string; now?: string } = {}
): ScientificObjectAnnotationStore {
  const normalizedText = text.trim()
  if (!normalizedText) return store
  const now = options.now ?? new Date().toISOString()
  const annotation = scientificObjectAnnotationSchema.parse({
    schemaVersion: 1,
    id: options.id ?? createAnnotationId(),
    target: selection
      ? { kind: 'selection', objectId: object.id, selection }
      : { kind: 'object', objectId: object.id },
    kind: 'note',
    text: normalizedText,
    createdAt: now
  })
  const key = scientificObjectIdentityKey(object)
  return {
    ...store,
    [key]: [...(store[key] ?? []), annotation].slice(-MAX_ANNOTATIONS_PER_OBJECT)
  }
}

export function deleteScientificObjectAnnotation(
  store: ScientificObjectAnnotationStore,
  object: ScientificObjectRef,
  annotationId: string
): ScientificObjectAnnotationStore {
  const key = scientificObjectIdentityKey(object)
  const nextAnnotations = (store[key] ?? []).filter((annotation) => annotation.id !== annotationId)
  if (nextAnnotations.length === (store[key] ?? []).length) return store
  const next = { ...store }
  if (nextAnnotations.length) next[key] = nextAnnotations
  else delete next[key]
  return next
}

function createAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
