import { z } from 'zod'

export const FEEDBACK_SCHEMA_VERSION = 1

const optionalText = (max: number) => z.string().trim().max(max).optional()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const feedbackDisclosureChoicesSchema = z.object({
  annotatedScreenshots: z.boolean(),
  applicationEnvironment: z.boolean(),
  logs: z.boolean(),
  conversationExcerpt: z.boolean(),
  workspacePaths: z.boolean(),
  fileMetadata: z.boolean()
}).strict()

export const screenshotAssetRefSchema = z.object({
  digest: sha256Schema,
  mimeType: z.literal('image/png'),
  byteLength: z.number().int().positive().max(25 * 1024 * 1024),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000)
}).strict()

export const productFeedbackScreenshotSchema = z.object({
  kind: z.enum(['full_window', 'focused']),
  asset: screenshotAssetRefSchema,
  dataBase64: z.string().max(35 * 1024 * 1024).optional()
}).strict()

export const productFeedbackPacketSchema = z.object({
  schemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
  idempotencyKey: z.string().trim().min(16).max(256),
  threadId: z.string().trim().min(1).max(256),
  repository: z.object({
    owner: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(128)
  }).strict(),
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(100_000),
  disclosure: feedbackDisclosureChoicesSchema,
  screenshots: z.array(productFeedbackScreenshotSchema).max(2).optional(),
  environment: z.record(z.string().max(128), z.string().max(4_096)).optional(),
  logs: z.string().max(200_000).optional(),
  conversationExcerpt: z.string().max(100_000).optional(),
  workspacePaths: z.array(z.string().max(4_096)).max(64).optional(),
  fileMetadata: z.array(z.record(z.string().max(128), z.string().max(4_096))).max(128).optional()
}).strict().superRefine((value, context) => {
  const disclosedFields: Array<[keyof z.infer<typeof feedbackDisclosureChoicesSchema>, unknown]> = [
    ['annotatedScreenshots', value.screenshots],
    ['applicationEnvironment', value.environment],
    ['logs', value.logs],
    ['conversationExcerpt', value.conversationExcerpt],
    ['workspacePaths', value.workspacePaths],
    ['fileMetadata', value.fileMetadata]
  ]
  for (const [choice, field] of disclosedFields) {
    if (!value.disclosure[choice] && field !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `${choice} data was supplied without disclosure approval.`
      })
    }
  }
})

export type ProductFeedbackPacket = z.infer<typeof productFeedbackPacketSchema>

export const feedbackGatewayResultSchema = z.object({
  schemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
  idempotencyKey: z.string().trim().min(16).max(256),
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().url().max(2_048),
  author: optionalText(256),
  assetUrls: z.array(z.string().url().max(2_048)).max(16),
  createdAt: z.string().trim().min(1).max(64)
}).strict()

export type FeedbackGatewayResult = z.infer<typeof feedbackGatewayResultSchema>

export const storedFeedbackSubmissionSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(256),
  requestDigest: sha256Schema,
  result: feedbackGatewayResultSchema
}).strict()

export type StoredFeedbackSubmission = z.infer<typeof storedFeedbackSubmissionSchema>
