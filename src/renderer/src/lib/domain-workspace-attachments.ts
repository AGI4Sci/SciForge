import type {
  DomainRendererWorkspaceAttachment,
  DomainRendererWorkspaceAttachmentImportInput
} from '@sciforge/domain-sdk/host'
import type { NormalizedThread } from '../agent/types'
import { importComposerWorkspaceAttachment, type ComposerWorkspaceAttachmentImportOptions } from './composer-workspace-attachment'
import { subscribeSessionRightPanelDisposals, subscribeSessionRightPanelRekeys } from './session-right-panel-lifecycle'

type ImportOptions = Pick<ComposerWorkspaceAttachmentImportOptions, 'getPathForFile' | 'writeWorkspaceFile'> & Readonly<{
  getThreads: () => readonly Pick<NormalizedThread, 'id' | 'runtimeId' | 'workspace' | 'workspaceLocator' | 'archived'>[]
}>

/** Resolve from the exact owned Session, never from the active Session or a caller-supplied root. */
export async function importDomainWorkspaceAttachments(
  input: DomainRendererWorkspaceAttachmentImportInput,
  options: ImportOptions
): Promise<readonly DomainRendererWorkspaceAttachment[]> {
  const runtimeId = input.runtimeId.trim()
  const threadId = input.threadId.trim()
  const findThread = () => options.getThreads().find(thread =>
    thread.id === threadId && thread.runtimeId === runtimeId && !thread.archived)
  const thread = runtimeId && threadId ? findThread() : undefined
  const workspaceRoot = thread?.workspace?.trim()
  if (!workspaceRoot || thread?.workspaceLocator) {
    throw new Error('The exact local Session workspace is unavailable.')
  }
  let disposed = false
  const unsubscribeDispose = subscribeSessionRightPanelDisposals(id => { if (id === threadId) disposed = true })
  const unsubscribeRekey = subscribeSessionRightPanelRekeys(id => { if (id === threadId) disposed = true })
  const assertAvailable = () => {
    const current = findThread()
    if (disposed || current?.workspace?.trim() !== workspaceRoot || current?.workspaceLocator) {
      throw new Error('The Session workspace changed before the attachment could be imported.')
    }
  }
  try {
    const imported: DomainRendererWorkspaceAttachment[] = []
    for (const file of input.files) {
      assertAvailable()
      const reference = await importComposerWorkspaceAttachment({ file }, {
        workspaceRoot, threadId,
        getPathForFile: options.getPathForFile,
        writeWorkspaceFile: options.writeWorkspaceFile,
        assertAvailable
      })
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
  // The generated domain composition can initialize before the chat store.
  const { useChatStore } = await import('../store/chat-store')
  return importDomainWorkspaceAttachments(input, {
    getThreads: () => useChatStore.getState().threads,
    getPathForFile: window.sciforge.getPathForFile,
    writeWorkspaceFile: window.sciforge.writeWorkspaceFile
  })
}
