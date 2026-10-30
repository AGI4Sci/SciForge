import type { WorkerDeliveryView } from '../../../worker-delivery.js'

/** Renderer presentation only; Cloud delivery and file authority stay unchanged. */
export type DeliveryDraftFile = Readonly<{
  id: string
  name: string
  relativePath: string
  mediaType: string
  byteCount: number
  source: 'member' | 'attachment' | 'ai' | 'unknown'
  /** Present only for an explicit import through the standard attachment writer. */
  imported?: boolean
  unavailable?: boolean
}>

export type DeliveryDraftSnapshot = Readonly<{
  revision: number
  summary: string
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles?: readonly DeliveryDraftFile[]
  submitter: string
  submittedAt: string
  adopted?: boolean
}>

export type DeliveryDraftData = Readonly<{
  revision: number
  summary: string
  state: 'generating' | 'ready' | 'modifying' | 'changed' | 'failed' | 'submitting' | 'submitted' | 'adopted'
  /** An approved submission may be retried, but its frozen input cannot be edited. */
  editLocked?: boolean
  submissionProgress?: WorkerDeliveryView['submissionProgress']
  submitError?: string
  materialError?: string
  saveState?: 'saved' | 'saving' | 'error'
  declaredFiles: readonly DeliveryDraftFile[]
  additionalFiles?: readonly DeliveryDraftFile[]
  source?: Readonly<{ round: number; finishedAt: string; revision?: number }>
  aiSummary?: string
  failureReason?: string
  submitter?: string
  submittedAt?: string | null
  revisionRequest?: Readonly<{ author: string; at: string; instruction: string }>
  history?: readonly DeliveryDraftSnapshot[]
}>

/** Presence exposes available attachment selection; Slice A supplies no such capability. */
export type DeliveryMaterialSelection = Readonly<{
  files: readonly DeliveryDraftFile[]
  onList?(input: Readonly<{ query?: string; cursor?: string }>): Promise<Readonly<{ files: readonly DeliveryDraftFile[]; nextCursor: string | null; truncated?: boolean }>>
  onUpload?(files: readonly File[], onImported: (file: DeliveryDraftFile) => void): Promise<readonly DeliveryDraftFile[]>
}>
