import { describe, expect, it } from 'vitest'

import { feedbackGatewayConfigFromEnv } from './config.js'

function environment(): NodeJS.ProcessEnv {
  return {
    SCIFORGE_FEEDBACK_GITHUB_TOKEN: 'github-token',
    SCIFORGE_FEEDBACK_ALLOWED_REPOSITORIES: 'XingYu-Zhong/SciForge',
    SCIFORGE_FEEDBACK_S3_BUCKET: 'feedback-assets',
    SCIFORGE_FEEDBACK_ASSET_PUBLIC_BASE_URL: 'https://assets.sciforge.test/'
  }
}

describe('feedbackGatewayConfigFromEnv', () => {
  it('loads a minimal production configuration with safe defaults', () => {
    expect(feedbackGatewayConfigFromEnv(environment())).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      allowedRepositories: ['XingYu-Zhong/SciForge'],
      githubRecoveryPages: 3,
      s3: {
        bucket: 'feedback-assets',
        region: 'auto',
        forcePathStyle: false,
        keyPrefix: 'feedback'
      }
    })
  })

  it('requires paired explicit S3 credentials', () => {
    expect(() => feedbackGatewayConfigFromEnv({
      ...environment(),
      SCIFORGE_FEEDBACK_S3_ACCESS_KEY_ID: 'only-one-half'
    })).toThrow('must be configured together')
  })

  it('rejects malformed repository allowlist entries', () => {
    expect(() => feedbackGatewayConfigFromEnv({
      ...environment(),
      SCIFORGE_FEEDBACK_ALLOWED_REPOSITORIES: 'not-a-repository'
    })).toThrow('owner/name')
  })
})
