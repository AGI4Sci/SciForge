import { translateWorkspace } from './workspace/workspace-i18n.js'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { COLLABORATION_MAIN_AREA_CONTRIBUTION } from '../definition.js'

/** Keep task navigation on the exact Session resolved by collaboration.task.session.open. */
export async function openCollaborationTaskSession(
  workbench: DomainRendererWorkbenchHost | undefined,
  binding: Readonly<{ runtimeId: string; threadId: string }>,
  task: Readonly<{ projectId: string; taskId: string; taskReference: string }>
): Promise<boolean> {
  if (!workbench?.openSession || !binding.runtimeId.trim() || !binding.threadId.trim()) return false
  return workbench.openSession({
    runtimeId: binding.runtimeId,
    threadId: binding.threadId,
    focusComposer: true,
    returnTo: {
      contributionId: COLLABORATION_MAIN_AREA_CONTRIBUTION.id,
      label: translateWorkspace('协作任务 {{reference}} · 返回交付草稿', { reference: task.taskReference }),
      activation: { revision: 1, payload: { projectId: task.projectId, taskId: task.taskId } }
    }
  })
}
