import type { IntegrationReceipt } from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorWorkspace } from '../../coordinator/contract.js'

/** A successful adoption response is authoritative even while a read started
 * before the write is still returning the previous Task facts. Never carry it
 * across a different Principal, execution or sealed result. */
export function reconcileAdoptionReceipts(workspace: ProjectCoordinatorWorkspace, receipts: readonly IntegrationReceipt[]): Readonly<{ workspace: ProjectCoordinatorWorkspace; pending: readonly IntegrationReceipt[] }> {
  const pending: IntegrationReceipt[] = []
  const projects = workspace.projects.map((project) => {
    if (workspace.connection.state !== 'ready' || workspace.connection.userId !== project.project.ownerUserId) return project
    const tasks = project.tasks.map((view) => {
      const manifest = view.delivery?.manifest
      const receipt = receipts.find((item) => item.disposition === 'adopted' && item.projectId === project.project.projectId && item.taskId === view.task.taskId && item.deliveryManifestId === manifest?.deliveryManifestId)
      if (!receipt || !manifest || manifest.executionId !== view.task.currentExecutionId || view.delivery?.revisionRequest) return view
      if (view.delivery?.receipt) return view
      if (view.task.status !== 'awaiting_review') return view
      pending.push(receipt)
      return { ...view, task: { ...view.task, status: 'completed' as const }, delivery: { ...view.delivery!, receipt } }
    })
    return { ...project, tasks }
  })
  // Non-focused Projects contain only membership facts. Keep their receipts
  // until the User revisits, but never expose them to another signed-in User.
  if (workspace.connection.state === 'ready') {
    for (const receipt of receipts) {
      const project = workspace.projects.find((entry) => entry.project.projectId === receipt.projectId)
      if (project?.project.ownerUserId === workspace.connection.userId && workspace.focusedProjectId !== receipt.projectId && !project.tasks.some((view) => view.task.taskId === receipt.taskId)) pending.push(receipt)
    }
  }
  return { workspace: { ...workspace, projects }, pending }
}
