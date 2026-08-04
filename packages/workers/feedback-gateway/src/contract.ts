import { z } from 'zod'
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  feedbackGatewayResultSchema,
  productFeedbackPacketSchema,
  type FeedbackGatewayResult,
  type ProductFeedbackPacket
} from '@sciforge/domain-anchored-comments/contract'

export const FEEDBACK_SCHEMA_VERSION = ANCHORED_COMMENT_SCHEMA_VERSION

export {
  feedbackGatewayResultSchema,
  productFeedbackPacketSchema
}
export type {
  FeedbackGatewayResult,
  ProductFeedbackPacket
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const storedFeedbackSubmissionSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(256),
  requestDigest: sha256Schema,
  result: feedbackGatewayResultSchema
}).strict()

export type StoredFeedbackSubmission = z.infer<typeof storedFeedbackSubmissionSchema>
