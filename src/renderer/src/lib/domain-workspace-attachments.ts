import type {
  DomainRendererWorkspaceAttachment,
  DomainRendererWorkspaceAttachmentImportInput
} from '@sciforge/domain-sdk/host'
import type { AgentRuntimeThreadStatus, AgentRuntimeThreadStatusInput } from '../../../shared/agent-runtime-contract'
import { importComposerWorkspaceAttachment, type ComposerWorkspaceAttachmentImportOptions } from './composer-workspace-attachment'
import { subscribeSessionRightPanelDisposals, subscribeSessionRightPanelRekeys } from './session-right-panel-lifecycle'

type ImportOptions = Pick<ComposerWorkspaceAttachmentImportOptions, 'getPathForFile' | 'writeWorkspaceFile'> & Readonly<{
  readThread: (input: AgentRuntimeThreadStatusInput) => Promise<Pick<AgentRuntimeThreadStatus, 'id' | 'runtimeId' | 'workspace' | 'workspaceLocator' | 'archived'> | undefined>
}>

/** Resolve from the exact owned Session, never from the active Session or a caller-supplied root. */
export async function importDomainWorkspaceAttachments(
  input: DomainRendererWorkspaceAttachmentImportInput,
  options: ImportOptions
): Promise<readonly DomainRendererWorkspaceAttachment[]> {
  const runtimeId = input.runtimeId.trim() as AgentRuntimeThreadStatusInput['runtimeId']
  const threadId = input.threadId.trim()
  const readThread = async () => {
    const thread = await options.readThread({ runtimeId, threadId })
    return thread?.id === threadId && thread.runtimeId === runtimeId && !thread.archived ? thread : undefined
  }
  const thread = runtimeId && threadId ? await readThread() : undefined
  const workspaceRoot = thread?.workspace?.trim()
  if (!workspaceRoot || thread?.workspaceLocator) {
    throw new Error('The exact local Session workspace is unavailable.')
  }
  let disposed = false
  const unsubscribeDispose = subscribeSessionRightPanelDisposals(id => { if (id === threadId) disposed = true })
  const unsubscribeRekey = subscribeSessionRightPanelRekeys(id => { if (id === threadId) disposed = true })
  const assertAvailable = async () => {
    const current = await readThread()
    if (disposed || current?.workspace?.trim() !== workspaceRoot || current?.workspaceLocator) {
      throw new Error('The Session workspace changed before the attachment could be imported.')
    }
  }
  try {
    const imported: DomainRendererWorkspaceAttachment[] = []
    for (const file of input.files) {
      await assertAvailable()
      const reference = await importComposerWorkspaceAttachment({ file }, {
        workspaceRoot, threadId,
        getPathForFile: options.getPathForFile,
        writeWorkspaceFile: async (payload) => {
          await assertAvailable()
          return options.writeWorkspaceFile(payload)
        },
        assertAvailable: () => {
          if (disposed) throw new Error('The Session workspace changed before the attachment could be imported.')
        }
      })
      await assertAvailable()
      imported.push({
        relativePath: reference.relativePath,
        name: reference.name,
        mediaType: reference.mimeType ?? 'application/octet-stream',
        byteCount: file.size
      })
    }
    return imported
  } finally {
    unsubscribeDispose()
    unsubscribeRekey()
  }
}

export async function importSessionWorkspaceAttachments(
  input: DomainRendererWorkspaceAttachmentImportInput
): Promise<readonly DomainRendererWorkspaceAttachment[]> {
  return importDomainWorkspaceAttachments(input, {
    readThread: (request) => window.sciforge.agentRuntime.readThreadStatus(request),
    getPathForFile: window.sciforge.getPathForFile,
    writeWorkspaceFile: window.sciforge.writeWorkspaceFile
  })
}
