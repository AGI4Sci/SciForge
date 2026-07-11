import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'

import { GitHubRestIssueAdapter } from './adapters/github-issues.js'
import { S3ImmutableAssetPublisher } from './publishers/s3-assets.js'
import { FeedbackGatewayService } from './service.js'
import { FileFeedbackIdempotencyStore } from './stores/file-idempotency.js'

export type FeedbackGatewayEnvironmentConfig = {
  host: string
  port: number
  authToken?: string
  maxBodyBytes: number
  githubToken: string
  githubApiBaseUrl: string
  allowedRepositories: string[]
  githubRecoveryPages: number
  idempotencyDirectory: string
  s3: {
    bucket: string
    region: string
    endpoint?: string
    accessKeyId?: string
    secretAccessKey?: string
    forcePathStyle: boolean
    publicBaseUrl: string
    keyPrefix: string
  }
}

function optional(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]?.trim()
  return value || undefined
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = optional(environment, key)
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function integer(environment: NodeJS.ProcessEnv, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = optional(environment, key)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function boolean(environment: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = optional(environment, key)
  if (!raw) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`${key} must be true or false.`)
}

export function feedbackGatewayConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): FeedbackGatewayEnvironmentConfig {
  const accessKeyId = optional(environment, 'SCIFORGE_FEEDBACK_S3_ACCESS_KEY_ID')
  const secretAccessKey = optional(environment, 'SCIFORGE_FEEDBACK_S3_SECRET_ACCESS_KEY')
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('SCIFORGE_FEEDBACK_S3_ACCESS_KEY_ID and SCIFORGE_FEEDBACK_S3_SECRET_ACCESS_KEY must be configured together.')
  }
  const allowedRepositories = required(environment, 'SCIFORGE_FEEDBACK_ALLOWED_REPOSITORIES')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (allowedRepositories.some((value) => !/^[^/\s]+\/[^/\s]+$/.test(value))) {
    throw new Error('SCIFORGE_FEEDBACK_ALLOWED_REPOSITORIES must contain comma-separated owner/name values.')
  }

  return {
    host: optional(environment, 'SCIFORGE_FEEDBACK_HOST') ?? '127.0.0.1',
    port: integer(environment, 'SCIFORGE_FEEDBACK_PORT', 8787, 1, 65_535),
    ...(optional(environment, 'SCIFORGE_FEEDBACK_GATEWAY_TOKEN')
      ? { authToken: optional(environment, 'SCIFORGE_FEEDBACK_GATEWAY_TOKEN') }
      : {}),
    maxBodyBytes: integer(
      environment,
      'SCIFORGE_FEEDBACK_MAX_BODY_BYTES',
      75 * 1024 * 1024,
      1_024,
      100 * 1024 * 1024
    ),
    githubToken: required(environment, 'SCIFORGE_FEEDBACK_GITHUB_TOKEN'),
    githubApiBaseUrl: optional(environment, 'SCIFORGE_FEEDBACK_GITHUB_API_URL') ?? 'https://api.github.com',
    allowedRepositories,
    githubRecoveryPages: integer(environment, 'SCIFORGE_FEEDBACK_GITHUB_RECOVERY_PAGES', 3, 0, 10),
    idempotencyDirectory: optional(environment, 'SCIFORGE_FEEDBACK_IDEMPOTENCY_DIR') ?? './data/idempotency',
    s3: {
      bucket: required(environment, 'SCIFORGE_FEEDBACK_S3_BUCKET'),
      region: optional(environment, 'SCIFORGE_FEEDBACK_S3_REGION') ?? 'auto',
      ...(optional(environment, 'SCIFORGE_FEEDBACK_S3_ENDPOINT')
        ? { endpoint: optional(environment, 'SCIFORGE_FEEDBACK_S3_ENDPOINT') }
        : {}),
      ...(accessKeyId ? { accessKeyId } : {}),
      ...(secretAccessKey ? { secretAccessKey } : {}),
      forcePathStyle: boolean(environment, 'SCIFORGE_FEEDBACK_S3_FORCE_PATH_STYLE', false),
      publicBaseUrl: required(environment, 'SCIFORGE_FEEDBACK_ASSET_PUBLIC_BASE_URL'),
      keyPrefix: optional(environment, 'SCIFORGE_FEEDBACK_S3_KEY_PREFIX') ?? 'feedback'
    }
  }
}

export function createConfiguredFeedbackGateway(config: FeedbackGatewayEnvironmentConfig): FeedbackGatewayService {
  const s3Config: S3ClientConfig = {
    region: config.s3.region,
    forcePathStyle: config.s3.forcePathStyle,
    ...(config.s3.endpoint ? { endpoint: config.s3.endpoint } : {}),
    ...(config.s3.accessKeyId && config.s3.secretAccessKey
      ? { credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey } }
      : {})
  }
  return new FeedbackGatewayService({
    assets: new S3ImmutableAssetPublisher({
      client: new S3Client(s3Config),
      bucket: config.s3.bucket,
      publicBaseUrl: config.s3.publicBaseUrl,
      keyPrefix: config.s3.keyPrefix
    }),
    github: new GitHubRestIssueAdapter({
      token: async () => config.githubToken,
      allowedRepositories: config.allowedRepositories,
      apiBaseUrl: config.githubApiBaseUrl,
      recoveryPages: config.githubRecoveryPages
    }),
    idempotency: new FileFeedbackIdempotencyStore(config.idempotencyDirectory)
  })
}
