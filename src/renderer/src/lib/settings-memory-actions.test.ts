import { describe, expect, it, vi } from 'vitest'
import {
  createSettingsMemoryActions,
  type SettingsMemoryNotice,
  type SettingsMemoryRecord,
  type SettingsMemoryRecordUpdater
} from './settings-memory-actions'

function memoryRecord(patch: Partial<SettingsMemoryRecord> = {}): SettingsMemoryRecord {
  return {
    id: 'mem_1',
    content: 'Remember the shared workspace context.',
    scope: 'workspace',
    workspace: '/workspace/project',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...patch
  }
}

describe('createSettingsMemoryActions', () => {
  it('creates trimmed memory records with the current workspace and scope', async () => {
    let records = [memoryRecord({ id: 'mem_2', content: 'stale duplicate' }), memoryRecord()]
    let draftContent = '  Remember CJK 检索 should work.  '
    let notice: SettingsMemoryNotice | null = null
    const createMemory = vi.fn(async (input) => memoryRecord({
      id: 'mem_2',
      content: input.content,
      scope: input.scope ?? 'workspace',
      workspace: input.workspace,
      updatedAt: '2026-06-20T01:00:00.000Z'
    }))

    const actions = createSettingsMemoryActions({
      getProvider: () => ({ createMemory }),
      getState: () => ({
        memoryDraftContent: draftContent,
        memoryDraftScope: 'project',
        memoryEditingContent: '',
        workspaceRoot: '/workspace/project'
      }),
      setMemoryRecords: (next) => {
        records = applyRecordUpdate(records, next)
      },
      setMemoryDraftContent: (value) => {
        draftContent = value
      },
      setMemoryEditingId: vi.fn(),
      setMemoryEditingContent: vi.fn(),
      setNotice: (next) => {
        notice = next
      },
      t: (key) => key
    })

    await actions.createMemoryRecord()

    expect(createMemory).toHaveBeenCalledWith({
      content: 'Remember CJK 检索 should work.',
      scope: 'project',
      workspace: '/workspace/project',
      project: '/workspace/project'
    })
    expect(records.map((record) => record.id)).toEqual(['mem_2', 'mem_1'])
    expect(records[0]?.content).toBe('Remember CJK 检索 should work.')
    expect(draftContent).toBe('')
    expect(notice).toEqual({ tone: 'success', message: 'localRuntimeMemoryCreated' })
  })

  it('edits and saves memory records through the shared update path', async () => {
    let records = [memoryRecord()]
    const state = {
      memoryDraftContent: '',
      memoryDraftScope: 'workspace' as const,
      memoryEditingContent: '',
      workspaceRoot: '/workspace/project'
    }
    let editingId: string | null = null
    let notice: SettingsMemoryNotice | null = null
    const updateMemory = vi.fn(async (memoryId: string, patch: { content?: string }) => memoryRecord({
      id: memoryId,
      content: patch.content ?? 'missing'
    }))

    const actions = createSettingsMemoryActions({
      getProvider: () => ({ updateMemory }),
      getState: () => state,
      setMemoryRecords: (next) => {
        records = applyRecordUpdate(records, next)
      },
      setMemoryDraftContent: vi.fn(),
      setMemoryEditingId: (value) => {
        editingId = value
      },
      setMemoryEditingContent: (value) => {
        state.memoryEditingContent = value
      },
      setNotice: (next) => {
        notice = next
      },
      t: (key) => key
    })

    actions.startEditingMemoryRecord(records[0]!)
    expect(editingId).toBe('mem_1')
    expect(state.memoryEditingContent).toBe('Remember the shared workspace context.')

    state.memoryEditingContent = '  Updated shared memory.  '
    await actions.saveMemoryRecord('mem_1')

    expect(updateMemory).toHaveBeenCalledWith('mem_1', { content: 'Updated shared memory.' })
    expect(records[0]?.content).toBe('Updated shared memory.')
    expect(editingId).toBeNull()
    expect(state.memoryEditingContent).toBe('')
    expect(notice).toEqual({ tone: 'success', message: 'localRuntimeMemoryUpdated' })
  })

  it('disables and deletes memory records through provider operations', async () => {
    let records = [memoryRecord(), memoryRecord({ id: 'mem_2', content: 'keep me' })]
    const disabledAt = '2026-06-20T02:00:00.000Z'
    const updateMemory = vi.fn(async (memoryId: string, patch: { disabled?: boolean }) => memoryRecord({
      id: memoryId,
      disabledAt: patch.disabled ? disabledAt : undefined
    }))
    const deleteMemory = vi.fn(async (memoryId: string) => memoryRecord({ id: memoryId, deletedAt: disabledAt }))
    const actions = createSettingsMemoryActions({
      getProvider: () => ({ updateMemory, deleteMemory }),
      getState: () => ({
        memoryDraftContent: '',
        memoryDraftScope: 'workspace',
        memoryEditingContent: '',
        workspaceRoot: '/workspace/project'
      }),
      setMemoryRecords: (next) => {
        records = applyRecordUpdate(records, next)
      },
      setMemoryDraftContent: vi.fn(),
      setMemoryEditingId: vi.fn(),
      setMemoryEditingContent: vi.fn(),
      setNotice: vi.fn(),
      t: (key) => key
    })

    await actions.disableMemoryRecord('mem_1')
    expect(updateMemory).toHaveBeenCalledWith('mem_1', { disabled: true })
    expect(records.find((record) => record.id === 'mem_1')?.disabledAt).toBe(disabledAt)

    await actions.deleteMemoryRecord('mem_1')
    expect(deleteMemory).toHaveBeenCalledWith('mem_1')
    expect(records.map((record) => record.id)).toEqual(['mem_2'])
  })

  it('surfaces provider errors as inline notices', async () => {
    let notice: SettingsMemoryNotice | null = null
    const actions = createSettingsMemoryActions({
      getProvider: () => ({
        updateMemory: async () => {
          throw new Error('memory store unavailable')
        }
      }),
      getState: () => ({
        memoryDraftContent: '',
        memoryDraftScope: 'workspace',
        memoryEditingContent: '',
        workspaceRoot: '/workspace/project'
      }),
      setMemoryRecords: vi.fn(),
      setMemoryDraftContent: vi.fn(),
      setMemoryEditingId: vi.fn(),
      setMemoryEditingContent: vi.fn(),
      setNotice: (next) => {
        notice = next
      },
      t: (key) => key
    })

    await actions.disableMemoryRecord('mem_1')

    expect(notice).toEqual({ tone: 'error', message: 'memory store unavailable' })
  })
})

function applyRecordUpdate(
  records: SettingsMemoryRecord[],
  next: SettingsMemoryRecordUpdater
): SettingsMemoryRecord[] {
  return typeof next === 'function' ? next(records) : next
}
