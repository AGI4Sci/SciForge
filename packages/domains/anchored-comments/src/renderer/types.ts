import {
  DEFAULT_FEEDBACK_DISCLOSURE_CHOICES,
  type FeedbackDisclosureChoices
} from '../contract'

export type AnchoredCommentKind = 'research' | 'product_feedback'

export type AnchoredCommentStatus =
  | 'open'
  | 'attached'
  | 'ai_responded'
  | 'awaiting_verification'
  | 'resolved'
  | 'needs_retargeting'

export type FeedbackSubmissionStatus = 'local' | 'submitting' | 'submitted' | 'failed'

export type CommentTargetBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type CommentTargetInspection = {
  targetRef: string
  label: string
  route: string
  bounds: CommentTargetBounds
  componentId?: string
  elementId?: string
  resourceType?: string
  resourceId?: string
  selection?: string
}

export type AnchoredCommentThreadView = {
  id: string
  kind: AnchoredCommentKind
  target: CommentTargetInspection
  comment: string
  createdAt: string
  status: AnchoredCommentStatus
  feedbackStatus: FeedbackSubmissionStatus
  fullScreenshotUrl?: string
  focusedScreenshotUrl?: string
  githubIssue?: {
    number: number
    url: string
  }
  error?: string
}

export type ProductFeedbackDisclosure = FeedbackDisclosureChoices

export const DEFAULT_PRODUCT_FEEDBACK_DISCLOSURE: Readonly<ProductFeedbackDisclosure> =
  DEFAULT_FEEDBACK_DISCLOSURE_CHOICES
