import type { AgentProvider } from './types'
import { AgentRuntimeProvider } from './agent-runtime-provider'

let cachedProvider: AgentProvider | null = null

class RegistryAgentProvider implements AgentProvider {
  readonly displayName = 'Agent Runtime'

  private readonly neutral = new AgentRuntimeProvider()

  get id(): AgentProvider['id'] {
    return this.neutral.id
  }

  getCapabilities(): ReturnType<AgentProvider['getCapabilities']> {
    return this.neutral.getCapabilities()
  }

  rememberThreadRuntime(...args: Parameters<NonNullable<AgentProvider['rememberThreadRuntime']>>): void {
    this.neutral.rememberThreadRuntime(...args)
  }

  connect(): ReturnType<AgentProvider['connect']> {
    return this.neutral.connect()
  }

  listThreads(...args: Parameters<AgentProvider['listThreads']>): ReturnType<AgentProvider['listThreads']> {
    return this.neutral.listThreads(...args)
  }

  createThread(...args: Parameters<AgentProvider['createThread']>): ReturnType<AgentProvider['createThread']> {
    return this.neutral.createThread(...args)
  }

  getThreadDetail(...args: Parameters<AgentProvider['getThreadDetail']>): ReturnType<AgentProvider['getThreadDetail']> {
    return this.neutral.getThreadDetail(...args)
  }

  getThreadSidebarProbe(
    ...args: Parameters<NonNullable<AgentProvider['getThreadSidebarProbe']>>
  ): ReturnType<NonNullable<AgentProvider['getThreadSidebarProbe']>> {
    return this.neutral.getThreadSidebarProbe(...args)
  }

  sendUserMessage(...args: Parameters<AgentProvider['sendUserMessage']>): ReturnType<AgentProvider['sendUserMessage']> {
    return this.neutral.sendUserMessage(...args)
  }

  reviewThread(
    ...args: Parameters<NonNullable<AgentProvider['reviewThread']>>
  ): ReturnType<NonNullable<AgentProvider['reviewThread']>> {
    return this.neutral.reviewThread(...args)
  }

  getRuntimeInfo(): ReturnType<NonNullable<AgentProvider['getRuntimeInfo']>> {
    return this.neutral.getRuntimeInfo()
  }

  getToolDiagnostics(): ReturnType<NonNullable<AgentProvider['getToolDiagnostics']>> {
    return this.neutral.getToolDiagnostics()
  }

  listSkills(): ReturnType<NonNullable<AgentProvider['listSkills']>> {
    return this.neutral.listSkills()
  }

  uploadAttachment(
    ...args: Parameters<NonNullable<AgentProvider['uploadAttachment']>>
  ): ReturnType<NonNullable<AgentProvider['uploadAttachment']>> {
    return this.neutral.uploadAttachment(...args)
  }

  getAttachmentContent(
    ...args: Parameters<NonNullable<AgentProvider['getAttachmentContent']>>
  ): ReturnType<NonNullable<AgentProvider['getAttachmentContent']>> {
    return this.neutral.getAttachmentContent(...args)
  }

  runCodeNavigation(
    ...args: Parameters<NonNullable<AgentProvider['runCodeNavigation']>>
  ): ReturnType<NonNullable<AgentProvider['runCodeNavigation']>> {
    return this.neutral.runCodeNavigation(...args)
  }

  getContextState(
    ...args: Parameters<NonNullable<AgentProvider['getContextState']>>
  ): ReturnType<NonNullable<AgentProvider['getContextState']>> {
    return this.neutral.getContextState(...args)
  }

  listThreadChildren(
    ...args: Parameters<NonNullable<AgentProvider['listThreadChildren']>>
  ): ReturnType<NonNullable<AgentProvider['listThreadChildren']>> {
    return this.neutral.listThreadChildren(...args)
  }

  readChildTranscript(
    ...args: Parameters<NonNullable<AgentProvider['readChildTranscript']>>
  ): ReturnType<NonNullable<AgentProvider['readChildTranscript']>> {
    return this.neutral.readChildTranscript(...args)
  }

  listGitCheckpoints(
    ...args: Parameters<NonNullable<AgentProvider['listGitCheckpoints']>>
  ): ReturnType<NonNullable<AgentProvider['listGitCheckpoints']>> {
    return this.neutral.listGitCheckpoints(...args)
  }

  createGitCheckpoint(
    ...args: Parameters<NonNullable<AgentProvider['createGitCheckpoint']>>
  ): ReturnType<NonNullable<AgentProvider['createGitCheckpoint']>> {
    return this.neutral.createGitCheckpoint(...args)
  }

  previewGitCheckpoint(
    ...args: Parameters<NonNullable<AgentProvider['previewGitCheckpoint']>>
  ): ReturnType<NonNullable<AgentProvider['previewGitCheckpoint']>> {
    return this.neutral.previewGitCheckpoint(...args)
  }

  restoreGitCheckpoint(
    ...args: Parameters<NonNullable<AgentProvider['restoreGitCheckpoint']>>
  ): ReturnType<NonNullable<AgentProvider['restoreGitCheckpoint']>> {
    return this.neutral.restoreGitCheckpoint(...args)
  }

  createMemory(
    ...args: Parameters<NonNullable<AgentProvider['createMemory']>>
  ): ReturnType<NonNullable<AgentProvider['createMemory']>> {
    return this.neutral.createMemory(...args)
  }

  listMemories(
    ...args: Parameters<NonNullable<AgentProvider['listMemories']>>
  ): ReturnType<NonNullable<AgentProvider['listMemories']>> {
    return this.neutral.listMemories(...args)
  }

  updateMemory(
    ...args: Parameters<NonNullable<AgentProvider['updateMemory']>>
  ): ReturnType<NonNullable<AgentProvider['updateMemory']>> {
    return this.neutral.updateMemory(...args)
  }

  deleteMemory(
    ...args: Parameters<NonNullable<AgentProvider['deleteMemory']>>
  ): ReturnType<NonNullable<AgentProvider['deleteMemory']>> {
    return this.neutral.deleteMemory(...args)
  }

  listWorkspaceReferences(
    ...args: Parameters<NonNullable<AgentProvider['listWorkspaceReferences']>>
  ): ReturnType<NonNullable<AgentProvider['listWorkspaceReferences']>> {
    return this.neutral.listWorkspaceReferences(...args)
  }

  previewWorkspaceReference(
    ...args: Parameters<NonNullable<AgentProvider['previewWorkspaceReference']>>
  ): ReturnType<NonNullable<AgentProvider['previewWorkspaceReference']>> {
    return this.neutral.previewWorkspaceReference(...args)
  }

  steerUserMessage(
    ...args: Parameters<NonNullable<AgentProvider['steerUserMessage']>>
  ): ReturnType<NonNullable<AgentProvider['steerUserMessage']>> {
    return this.neutral.steerUserMessage(...args)
  }

  interruptTurn(...args: Parameters<AgentProvider['interruptTurn']>): ReturnType<AgentProvider['interruptTurn']> {
    return this.neutral.interruptTurn(...args)
  }

  renameThread(...args: Parameters<AgentProvider['renameThread']>): ReturnType<AgentProvider['renameThread']> {
    return this.neutral.renameThread(...args)
  }

  updateThreadRelation(
    ...args: Parameters<NonNullable<AgentProvider['updateThreadRelation']>>
  ): ReturnType<NonNullable<AgentProvider['updateThreadRelation']>> {
    return this.neutral.updateThreadRelation(...args)
  }

  updateThreadWorkspace(
    ...args: Parameters<NonNullable<AgentProvider['updateThreadWorkspace']>>
  ): ReturnType<NonNullable<AgentProvider['updateThreadWorkspace']>> {
    return this.neutral.updateThreadWorkspace(...args)
  }

  archiveThread(
    ...args: Parameters<NonNullable<AgentProvider['archiveThread']>>
  ): ReturnType<NonNullable<AgentProvider['archiveThread']>> {
    return this.neutral.archiveThread(...args)
  }

  deleteThread(...args: Parameters<AgentProvider['deleteThread']>): ReturnType<AgentProvider['deleteThread']> {
    return this.neutral.deleteThread(...args)
  }

  compactThread(
    ...args: Parameters<NonNullable<AgentProvider['compactThread']>>
  ): ReturnType<NonNullable<AgentProvider['compactThread']>> {
    return this.neutral.compactThread(...args)
  }

  getThreadGoal(
    ...args: Parameters<NonNullable<AgentProvider['getThreadGoal']>>
  ): ReturnType<NonNullable<AgentProvider['getThreadGoal']>> {
    return this.neutral.getThreadGoal(...args)
  }

  setThreadGoal(
    ...args: Parameters<NonNullable<AgentProvider['setThreadGoal']>>
  ): ReturnType<NonNullable<AgentProvider['setThreadGoal']>> {
    return this.neutral.setThreadGoal(...args)
  }

  clearThreadGoal(
    ...args: Parameters<NonNullable<AgentProvider['clearThreadGoal']>>
  ): ReturnType<NonNullable<AgentProvider['clearThreadGoal']>> {
    return this.neutral.clearThreadGoal(...args)
  }

  getThreadTodos(
    ...args: Parameters<NonNullable<AgentProvider['getThreadTodos']>>
  ): ReturnType<NonNullable<AgentProvider['getThreadTodos']>> {
    return this.neutral.getThreadTodos(...args)
  }

  setThreadTodos(
    ...args: Parameters<NonNullable<AgentProvider['setThreadTodos']>>
  ): ReturnType<NonNullable<AgentProvider['setThreadTodos']>> {
    return this.neutral.setThreadTodos(...args)
  }

  clearThreadTodos(
    ...args: Parameters<NonNullable<AgentProvider['clearThreadTodos']>>
  ): ReturnType<NonNullable<AgentProvider['clearThreadTodos']>> {
    return this.neutral.clearThreadTodos(...args)
  }

  forkThread(
    ...args: Parameters<NonNullable<AgentProvider['forkThread']>>
  ): ReturnType<NonNullable<AgentProvider['forkThread']>> {
    return this.neutral.forkThread(...args)
  }

  resumeSession(
    ...args: Parameters<NonNullable<AgentProvider['resumeSession']>>
  ): ReturnType<NonNullable<AgentProvider['resumeSession']>> {
    return this.neutral.resumeSession(...args)
  }

  subscribeThreadEvents(
    ...args: Parameters<AgentProvider['subscribeThreadEvents']>
  ): ReturnType<AgentProvider['subscribeThreadEvents']> {
    return this.neutral.subscribeThreadEvents(...args)
  }

  submitApprovalDecision(
    ...args: Parameters<NonNullable<AgentProvider['submitApprovalDecision']>>
  ): ReturnType<NonNullable<AgentProvider['submitApprovalDecision']>> {
    return this.neutral.submitApprovalDecision(...args)
  }

  submitUserInputResponse(
    ...args: Parameters<NonNullable<AgentProvider['submitUserInputResponse']>>
  ): ReturnType<NonNullable<AgentProvider['submitUserInputResponse']>> {
    return this.neutral.submitUserInputResponse(...args)
  }

  cancelUserInput(
    ...args: Parameters<NonNullable<AgentProvider['cancelUserInput']>>
  ): ReturnType<NonNullable<AgentProvider['cancelUserInput']>> {
    return this.neutral.cancelUserInput(...args)
  }
}

export function getProvider(): AgentProvider {
  if (cachedProvider) return cachedProvider
  cachedProvider = new RegistryAgentProvider()
  return cachedProvider
}

export function resetProviderCacheForTests(): void {
  cachedProvider = null
}
