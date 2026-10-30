export type SettingsMemoryActionText = (key: string) => string
export type SettingsMemoryRecord = {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  workspace?: string
  project?: string
  threadMode?: 'agent' | 'plan'
  taskType?: 'agent' | 'plan' | 'plan_draft' | 'plan_refine'
  sourceThreadId?: string
  sourceTurnId?: string
  tags?: string[]
  confidence?: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}
export type SettingsMemoryRecordUpdater =
  | SettingsMemoryRecord[]
  | ((records: SettingsMemoryRecord[]) => SettingsMemoryRecord[])
export type SettingsMemoryProvider = {
  createMemory?(input: {
    content: string
    scope?: SettingsMemoryRecord['scope']
    workspace?: string
    project?: string
    threadMode?: SettingsMemoryRecord['threadMode']
    taskType?: SettingsMemoryRecord['taskType']
    tags?: string[]
    confidence?: number
    disabled?: boolean
  }): Promise<SettingsMemoryRecord>
  updateMemory?(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }
  ): Promise<SettingsMemoryRecord>
  deleteMemory?(memoryId: string): Promise<SettingsMemoryRecord>
}
export type SettingsMemoryNotice = {
  tone: 'info' | 'success' | 'error'
  message: string
}

export type SettingsMemoryActionsState = {
  memoryDraftContent: string
  memoryDraftScope: 'user' | 'workspace' | 'project'
  memoryEditingContent: string
  workspaceRoot: string
}

export type SettingsMemoryActionsDeps = {
  getProvider: () => SettingsMemoryProvider
  getState: () => SettingsMemoryActionsState
  setMemoryRecords: (next: SettingsMemoryRecordUpdater) => void
  setMemoryDraftContent: (value: string) => void
  setMemoryEditingId: (value: string | null) => void
  setMemoryEditingContent: (value: string) => void
  setNotice: (notice: SettingsMemoryNotice | null) => void
  t: SettingsMemoryActionText
}

export type SettingsMemoryActions = {
  createMemoryRecord(): Promise<void>
  disableMemoryRecord(memoryId: string): Promise<void>
  startEditingMemoryRecord(memory: SettingsMemoryRecord): void
  cancelEditingMemoryRecord(): void
  saveMemoryRecord(memoryId: string): Promise<void>
  deleteMemoryRecord(memoryId: string): Promise<void>
}

export function createSettingsMemoryActions(deps: SettingsMemoryActionsDeps): SettingsMemoryActions {
  const setError = (error: unknown): void => {
    deps.setNotice({
      tone: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }

  const replaceMemory = (memoryId: string, memory: SettingsMemoryRecord): void => {
    deps.setMemoryRecords((records) => records.map((record) => record.id === memoryId ? memory : record))
  }

  const cancelEditingMemoryRecord = (): void => {
    deps.setMemoryEditingId(null)
    deps.setMemoryEditingContent('')
  }

  return {
    async createMemoryRecord(): Promise<void> {
      const provider = deps.getProvider()
      const state = deps.getState()
      const content = state.memoryDraftContent.trim()
      if (!content || typeof provider.createMemory !== 'function') return
      try {
        const memory = await provider.createMemory({
          content,
          scope: state.memoryDraftScope,
          workspace: state.workspaceRoot,
          ...(state.memoryDraftScope === 'project' ? { project: state.workspaceRoot } : {})
        })
        deps.setMemoryRecords((records) => [memory, ...records.filter((record) => record.id !== memory.id)])
        deps.setMemoryDraftContent('')
        deps.setNotice({
          tone: 'success',
          message: deps.t('localRuntimeMemoryCreated')
        })
      } catch (error) {
        setError(error)
      }
    },

    async disableMemoryRecord(memoryId: string): Promise<void> {
      const provider = deps.getProvider()
      if (typeof provider.updateMemory !== 'function') return
      try {
        const memory = await provider.updateMemory(memoryId, { disabled: true })
        replaceMemory(memoryId, memory)
      } catch (error) {
        setError(error)
      }
    },

    startEditingMemoryRecord(memory: SettingsMemoryRecord): void {
      deps.setMemoryEditingId(memory.id)
      deps.setMemoryEditingContent(memory.content)
    },

    cancelEditingMemoryRecord,

    async saveMemoryRecord(memoryId: string): Promise<void> {
      const provider = deps.getProvider()
      const content = deps.getState().memoryEditingContent.trim()
      if (!content || typeof provider.updateMemory !== 'function') return
      try {
        const memory = await provider.updateMemory(memoryId, { content })
        replaceMemory(memoryId, memory)
        cancelEditingMemoryRecord()
        deps.setNotice({
          tone: 'success',
          message: deps.t('localRuntimeMemoryUpdated')
        })
      } catch (error) {
        setError(error)
      }
    },

    async deleteMemoryRecord(memoryId: string): Promise<void> {
      const provider = deps.getProvider()
      if (typeof provider.deleteMemory !== 'function') return
      try {
        await provider.deleteMemory(memoryId)
        deps.setMemoryRecords((records) => records.filter((record) => record.id !== memoryId))
      } catch (error) {
        setError(error)
      }
    }
  }
}
