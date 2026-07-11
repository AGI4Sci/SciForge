import { describe, expect, it } from 'vitest'
import type { ScientificObjectRef } from '@shared/scientific-objects'
import type { BrowserStorageLike } from './browser-storage'
import {
  SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY,
  addScientificObjectAnnotation,
  annotationsForScientificObject,
  deleteScientificObjectAnnotation,
  readScientificObjectAnnotationStore,
  writeScientificObjectAnnotationStore
} from './scientific-object-annotations'

const object: ScientificObjectRef = {
  schemaVersion: 1,
  id: 'molecule-1',
  modality: 'molecular',
  title: 'Protein',
  source: 'workspace',
  path: '/workspace/protein.pdb',
  workspaceRoot: '/workspace',
  mimeType: 'chemical/x-pdb',
  hash: { algorithm: 'sha256', digest: 'a'.repeat(64) }
}

function memoryStorage(): BrowserStorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

describe('scientific object annotation storage', () => {
  it('adds object and selection annotations without mutating the previous store', () => {
    const first = addScientificObjectAnnotation({}, object, 'Whole object note', undefined, {
      id: 'annotation-1',
      now: '2026-07-11T00:00:00.000Z'
    })
    const second = addScientificObjectAnnotation(first, object, 'Chain note', {
      kind: 'molecular',
      chains: ['A']
    }, {
      id: 'annotation-2',
      now: '2026-07-11T00:01:00.000Z'
    })

    expect(first).not.toBe(second)
    expect(annotationsForScientificObject(object, second)).toEqual([
      expect.objectContaining({ id: 'annotation-1', target: { kind: 'object', objectId: 'molecule-1' } }),
      expect.objectContaining({
        id: 'annotation-2',
        target: expect.objectContaining({ kind: 'selection', selection: { kind: 'molecular', chains: ['A'] } })
      })
    ])
  })

  it('persists valid annotations and drops malformed cached entries', () => {
    const storage = memoryStorage()
    const store = addScientificObjectAnnotation({}, object, 'Persisted note', undefined, {
      id: 'annotation-1',
      now: '2026-07-11T00:00:00.000Z'
    })
    writeScientificObjectAnnotationStore(storage, store)
    const encoded = storage.values.get(SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY)
    expect(encoded).toContain('Persisted note')

    const parsed = JSON.parse(encoded ?? '{}') as Record<string, unknown[]>
    const [key] = Object.keys(parsed)
    parsed[key].push({ invalid: true })
    storage.values.set(SCIENTIFIC_OBJECT_ANNOTATIONS_STORAGE_KEY, JSON.stringify(parsed))

    expect(annotationsForScientificObject(object, readScientificObjectAnnotationStore(storage)))
      .toEqual([expect.objectContaining({ id: 'annotation-1' })])
  })

  it('deletes renderer-owned annotations without removing immutable object annotations', () => {
    const store = addScientificObjectAnnotation({}, object, 'Delete me', undefined, {
      id: 'annotation-1',
      now: '2026-07-11T00:00:00.000Z'
    })
    const next = deleteScientificObjectAnnotation(store, object, 'annotation-1')
    expect(annotationsForScientificObject(object, next)).toEqual([])
  })
})
