import type {
  DashboardTaskCard,
  DeliveryOutputDescriptor,
  DeliveryDriveView,
  DeliveryManifest,
  ObjectReference
} from '@sciforge/collaboration-contracts'
import type { ProjectCoordinatorProject } from '../../../coordinator/contract.js'

export type DeliveryFileDescriptor = Readonly<{
  projectId: string
  deliveryManifestId: string
  objectId: string
  sha256: string
  objectRevision: number
  name: string
  mediaType: string
  byteCount: number
  submitter: string | null
  submittedAt: string | null
}>

/** One row the page can render; a sealed Delivery row also carries its read descriptor. */
export type DeliveryFileEntry = Readonly<{
  key: string
  name: string
  mediaType: string
  byteCount: number
  revision: number
  submitter: string | null
  submittedAt: string | null
  relativePath?: string
  role?: DeliveryOutputDescriptor['role']
  source?: DeliveryOutputDescriptor['source']
  /** Null when no sealed Delivery grants an authorized byte read for this object. */
  descriptor: DeliveryFileDescriptor | null
}>

export type DeliveryFileGroup = Readonly<{
  id: 'shared' | 'delivery' | 'result'
  title: string
  empty: string
  files: readonly DeliveryFileEntry[]
}>

function memberName(
  members: readonly Readonly<{ userId: string; displayName: string }>[],
  userId: string | null | undefined
): string | null {
  if (!userId) return null
  return members.find((member) => member.userId === userId)?.displayName ?? null
}

/** Files a sealed Delivery actually delivered, never its internal bundle object. */
function deliveredObjects(manifest: DeliveryManifest): readonly ObjectReference[] {
  const outputObjectIds = manifest.outputObjectIds
  return outputObjectIds
    ? outputObjectIds.flatMap((id) => { const object = manifest.objects.find((entry) => entry.objectId === id); return object ? [object] : [] })
    : manifest.objects.filter((object) => object.objectId !== manifest.bundleObjectId)
}


export function deliveryManifestEntries(
  manifest: DeliveryManifest,
  context: Readonly<{
    members: readonly Readonly<{ userId: string; displayName: string }>[]
    executions?: readonly Readonly<{ executionId: string; assigneeUserId: string }>[]
    fallbackSubmitter?: string | null
  }>
): readonly DeliveryFileEntry[] {
  const objects = deliveredObjects(manifest)
  const executionUserId = context.executions?.find((execution) => execution.executionId === manifest.executionId)?.assigneeUserId
  const submitter = memberName(context.members, executionUserId) ?? context.fallbackSubmitter ?? null
  return objects.map((object, index) => {
    const output = manifest.outputs?.find((entry) => entry.objectId === object.objectId)
    const name = output?.fileName ?? (objects.length > 1 ? `历史交付文件 ${index + 1}` : '历史交付文件')
    return {
      key: `${manifest.deliveryManifestId}:${object.objectId}`,
      name,
      ...(output ? { relativePath: output.relativePath, role: output.role, source: output.source } : {}),
      mediaType: object.mediaType,
      byteCount: object.byteCount,
      revision: manifest.resultRevision ?? object.revision,
      submitter,
      submittedAt: manifest.sealedAt,
      descriptor: {
        projectId: manifest.projectId,
        deliveryManifestId: manifest.deliveryManifestId,
        objectId: object.objectId,
        sha256: object.sha256,
        objectRevision: object.revision,
        name,
        mediaType: object.mediaType,
        byteCount: object.byteCount,
        submitter,
        submittedAt: manifest.sealedAt
      }
    }
  })
}

function sharedMaterialEntry(
  object: ObjectReference,
  members: readonly Readonly<{ userId: string; displayName: string }>[]
): DeliveryFileEntry {
  return {
    key: `material:${object.objectId}`,
    name: '共享资料',
    mediaType: object.mediaType,
    byteCount: object.byteCount,
    revision: object.revision,
    submitter: memberName(members, object.ownerUserId),
    submittedAt: null,
    descriptor: null
  }
}

export function deliveryFileGroups(input: Readonly<{
  drive: DeliveryDriveView | null
  project: ProjectCoordinatorProject | null
  dashboards: readonly Readonly<{ projectId: string; tasks: readonly DashboardTaskCard[] }>[]
}>): readonly DeliveryFileGroup[] {
  const members = input.project?.memberUsers ?? []
  const tasks = input.project?.tasks ?? []
  const dashboardTasks = input.dashboards.flatMap((dashboard) => dashboard.tasks)
  return [
    {
      id: 'shared',
      title: '共享资料',
      empty: '负责人上传的共享资料会出现在这里。',
      files: (input.drive?.sharedMaterials ?? []).map((object) => sharedMaterialEntry(object, members))
    },
    {
      id: 'delivery',
      title: '任务交付',
      empty: '成员提交的交付文件会出现在这里。',
      files: (input.drive?.taskDeliveries ?? []).flatMap((manifest) => {
        const taskView = tasks.find(({ task }) => task.taskId === manifest.taskId)
        const dashboardTask = dashboardTasks.find((task) => task.taskId === manifest.taskId)
        return deliveryManifestEntries(manifest, {
          members,
          executions: taskView?.executions,
          fallbackSubmitter: dashboardTask?.assigneeDisplayName ?? null
        })
      })
    },
    {
      id: 'result',
      title: '项目成果',
      empty: '采纳后的成果会汇总在这里。',
      files: []
    }
  ]
}
