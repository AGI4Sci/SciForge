import type { CollaborationOfferAvailability } from '../../contract.js'

export type ProjectStatus = 'draft' | 'active' | 'paused' | 'completed'
export type BoardColumnId = 'intake' | 'ready' | 'in-progress' | 'review' | 'completed'

export type TaskCardModel = Readonly<{
  id: string
  reference: string
  moduleType: string
  title: string
  description?: string
  question?: string
  assignee: string | null
  date: string
  status: BoardColumnId
  priority?: 'high' | 'urgent'
  stateLabel?: string
  blockedByLabel?: string
  unread?: boolean
  offerId?: string
  offerAvailability?: CollaborationOfferAvailability
  /** The Owner's assignment step for this card, mirroring the Cloud offer rules. */
  assignment?: TaskAssignmentModel
  executionId?: string | null
  canReturnExecution?: boolean
  executionFailure?: Readonly<{ code: string; reexecutionInputId?: string }>
  humanRequestId?: string
  projectId?: string
  assigneeUserId?: string | null
  offerExpiresAt?: string
  /** Owner-facing assignment candidates that satisfy this module's executable tags. */
  assignableWorkerUserIds?: readonly string[]
}>

export type TaskAssignmentModel =
  | Readonly<{ kind: 'first'; requirementsDocumentId: string; planItemId: string; taskId: string }>
  | Readonly<{ kind: 'withdraw'; taskOfferId: string; workerUserId: string; workerName: string; expiresAt: string }>
  | Readonly<{ kind: 'reassign'; previousTaskOfferId: string; reason: string }>

export type ProjectModel = Readonly<{
  id: string
  initials: string
  name: string
  status: ProjectStatus
  pendingCount?: number
  owned: boolean
}>

export type WorkspaceStructureModel = Readonly<{
  currentProject: Readonly<{
    initials: string
    name: string
    memberCount: number
    status: ProjectStatus
    description: string
    requirementsRevision: number
    ownerName: string
    ownerUserId?: string
    headerAction?: '编辑需求' | '确认需求' | '结项'
  }>
  projects: readonly ProjectModel[]
  cards: readonly TaskCardModel[]
  selectedCard: TaskCardModel
  selectedProjectId?: string | null
  members?: readonly WorkspaceMemberViewModel[]
}>

export type WorkspaceMemberViewModel = Readonly<{
  id: string
  userId: string
  name: string
  role: string
  state: string
  email?: string
}>
