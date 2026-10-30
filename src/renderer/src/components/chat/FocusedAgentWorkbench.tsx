import { type ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { AgentRuntimeChild } from '@shared/agent-runtime-contract'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  AgentProviderCapabilities,
  AttachmentReference,
  RuntimeConnectionStatus
} from '../../agent/types'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { prepareImageAttachmentUpload } from '../../lib/image-attachment-upload'
import type { SideConversation } from '../../store/chat-store-types'
import type { ComposerFileReference, ComposerImageAttachmentInput } from './FloatingComposer'
import {
  FocusedChildAgentWorkbench,
  type ChildComposerDraft
} from './ChildAgentsPanel'

const emptyDraft = (): ChildComposerDraft => ({
  attachments: [],
  fileReferences: [],
  uploadBusy: false,
  uploadError: null
})

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clipboardImageFile(image: { name: string; mimeType: string; dataBase64: string }): File {
  const binary = atob(image.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], image.name || 'image', { type: image.mimeType })
}

function mergeFileReference(
  references: readonly ComposerFileReference[],
  reference: ComposerFileReference
): ComposerFileReference[] {
  const identity = `${reference.workspaceRoot ?? ''}\u0000${reference.relativePath}`
  return [
    ...references.filter((current) =>
      `${current.workspaceRoot ?? ''}\u0000${current.relativePath}` !== identity
    ),
    reference
  ]
}

export type FocusedAgentWorkbenchProps = {
  child: AgentRuntimeChild | null
  side: SideConversation | null
  loading?: boolean
  workspaceRoot?: string
  runtimeConnection: RuntimeConnectionStatus
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
}

/**
 * Store-connected full workbench for the child currently promoted into the
 * center focus area. The component stays mounted while the root is focused so
 * per-child attachment and file-reference drafts survive focus navigation.
 */
export function FocusedAgentWorkbench({
  child,
  side,
  loading = false,
  workspaceRoot,
  runtimeConnection,
  composerPickList,
  composerModelGroups,
  activeAgentRuntime,
  runtimeCapabilities
}: FocusedAgentWorkbenchProps): ReactElement | null {
  const { t } = useTranslation('common')
  const actions = useChatStore(
    useShallow((state) => ({
      setSideInput: state.setSideInput,
      sendSideMessage: state.sendSideMessage,
      removeSideQueuedMessage: state.removeSideQueuedMessage,
      interruptSide: state.interruptSide,
      setSideModel: state.setSideModel,
      setSideReasoningEffort: state.setSideReasoningEffort
    }))
  )
  const [drafts, setDrafts] = useState<Record<string, ChildComposerDraft>>({})
  const threadId = side?.threadId ?? child?.openAsThreadRef?.threadId ?? null
  const draft = threadId ? drafts[threadId] ?? emptyDraft() : emptyDraft()

  const patchDraft = (
    targetThreadId: string,
    patch: (current: ChildComposerDraft) => ChildComposerDraft
  ): void => {
    setDrafts((current) => ({
      ...current,
      [targetThreadId]: patch(current[targetThreadId] ?? emptyDraft())
    }))
  }

  const pickAttachments = async (
    targetThreadId: string,
    inputs: ComposerImageAttachmentInput[]
  ): Promise<void> => {
    if (inputs.length === 0) return
    const provider = getProvider()
    patchDraft(targetThreadId, (current) => ({ ...current, uploadBusy: true, uploadError: null }))
    try {
      const runtimeInfo = await provider.getRuntimeInfo?.()
      const capabilities = runtimeInfo?.capabilities.attachments
      if (!capabilities || typeof provider.uploadAttachment !== 'function') {
        throw new Error(t('composerAttachmentUnavailable'))
      }
      const uploaded: AttachmentReference[] = []
      for (const input of inputs) {
        if (!input.file.type.startsWith('image/')) continue
        const prepared = await prepareImageAttachmentUpload(input.file, capabilities)
        const attachment = await provider.uploadAttachment({
          name: input.file.name || 'image',
          mimeType: prepared.mimeType,
          dataBase64: prepared.dataBase64,
          textFallback: prepared.textFallback,
          ...(input.path ? { localFilePath: input.path } : {}),
          threadId: targetThreadId,
          ...(workspaceRoot ? { workspace: workspaceRoot } : {})
        })
        uploaded.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          width: attachment.width,
          height: attachment.height,
          previewUrl: `data:${prepared.mimeType};base64,${prepared.dataBase64}`,
          ...(attachment.localFilePath ? { absolutePath: attachment.localFilePath } : {})
        })
      }
      patchDraft(targetThreadId, (current) => {
        const byId = new Map(current.attachments.map((attachment) => [attachment.id, attachment]))
        for (const attachment of uploaded) byId.set(attachment.id, attachment)
        return { ...current, attachments: [...byId.values()], uploadError: null }
      })
    } catch (error) {
      patchDraft(targetThreadId, (current) => ({ ...current, uploadError: messageFromError(error) }))
    } finally {
      patchDraft(targetThreadId, (current) => ({ ...current, uploadBusy: false }))
    }
  }

  if (!child) return null

  return (
    <FocusedChildAgentWorkbench
      child={child}
      side={side}
      loading={loading}
      runtimeConnection={runtimeConnection}
      composerPickList={composerPickList}
      composerModelGroups={composerModelGroups}
      activeAgentRuntime={activeAgentRuntime}
      runtimeCapabilities={runtimeCapabilities}
      composerDraft={draft}
      workspaceRoot={workspaceRoot}
      onInputChange={(targetThreadId, value) => actions.setSideInput(targetThreadId, value)}
      onSend={(targetThreadId, text, payload) => {
        void actions.sendSideMessage(targetThreadId, text, payload).then((sent) => {
          if (!sent) return
          patchDraft(targetThreadId, (current) => ({
            ...current,
            attachments: [],
            fileReferences: [],
            uploadError: null
          }))
        })
      }}
      onPickAttachments={(targetThreadId, attachments) => {
        void pickAttachments(targetThreadId, attachments)
      }}
      onPasteClipboardImage={(targetThreadId, options) => {
        void (async () => {
          if (typeof window.sciforge?.readClipboardImage !== 'function') {
            patchDraft(targetThreadId, (current) => ({
              ...current,
              uploadError: t('composerAttachmentUnavailable')
            }))
            return
          }
          const image = await window.sciforge.readClipboardImage()
          if (!image.ok) {
            if (options?.silentNoImage) return
            patchDraft(targetThreadId, (current) => ({ ...current, uploadError: image.message }))
            return
          }
          await pickAttachments(targetThreadId, [{ file: clipboardImageFile(image) }])
        })()
      }}
      onRemoveAttachment={(targetThreadId, attachmentId) => {
        patchDraft(targetThreadId, (current) => ({
          ...current,
          attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId)
        }))
      }}
      onAddFileReference={(targetThreadId, reference) => {
        patchDraft(targetThreadId, (current) => ({
          ...current,
          fileReferences: mergeFileReference(current.fileReferences, reference)
        }))
      }}
      onRemoveFileReference={(targetThreadId, relativePath, referenceWorkspaceRoot) => {
        patchDraft(targetThreadId, (current) => ({
          ...current,
          fileReferences: current.fileReferences.filter((reference) =>
            reference.relativePath !== relativePath ||
            (referenceWorkspaceRoot !== undefined && reference.workspaceRoot !== referenceWorkspaceRoot)
          )
        }))
      }}
      onRemoveQueuedMessage={(targetThreadId, messageId) =>
        actions.removeSideQueuedMessage(targetThreadId, messageId)}
      onInterrupt={(targetThreadId) => {
        void actions.interruptSide(targetThreadId)
      }}
      onModelChange={(targetThreadId, model) => actions.setSideModel(targetThreadId, model)}
      onReasoningEffortChange={(targetThreadId, effort) =>
        actions.setSideReasoningEffort(targetThreadId, effort)}
      t={t}
    />
  )
}
