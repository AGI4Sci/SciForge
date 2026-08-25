#!/usr/bin/env node
import { createCollaborationServerRuntime } from './bootstrap.js'
import { runCollaborationMigrations } from './migrations.js'
import { createPostgresPool } from './postgres.js'
import {
  createInstalledProviderRuntime,
  loadProviderConfiguration
} from './provider-runtime.js'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'Usage: sciforge-collaboration-server [migrate]',
    '',
    'Commands:',
    '  migrate  Apply the collaboration PostgreSQL schema and exit.',
    '',
    'Configuration is read from SCIFORGE_COLLABORATION_* environment variables.',
    'Credentials must be supplied by the deployment secret manager or secret-file references.',
    ''
  ].join('\n'))
  process.exit(0)
}

const databaseUrl = requiredEnvironment('SCIFORGE_COLLABORATION_DATABASE_URL')
const pool = createPostgresPool({ connectionString: databaseUrl,
  maxConnections: integerEnvironment('SCIFORGE_COLLABORATION_DATABASE_POOL_SIZE', 10, 1, 100) })

if (process.argv[2] === 'migrate') {
  await runCollaborationMigrations(pool)
  await pool.end()
  process.exit(0)
}

const providerConfigurationFile = process.env.SCIFORGE_COLLABORATION_PROVIDER_CONFIG_FILE?.trim()
const providerSecretDirectory = process.env.SCIFORGE_COLLABORATION_SECRET_DIRECTORY?.trim()
if (Boolean(providerConfigurationFile) !== Boolean(providerSecretDirectory)) {
  throw new Error('Provider runtime requires both SCIFORGE_COLLABORATION_PROVIDER_CONFIG_FILE and SCIFORGE_COLLABORATION_SECRET_DIRECTORY.')
}
const providerConfiguration = providerConfigurationFile
  ? await loadProviderConfiguration(providerConfigurationFile)
  : undefined
const oidcIssuer = process.env.SCIFORGE_COLLABORATION_OIDC_ISSUER?.trim()

const runtime = createCollaborationServerRuntime({
  pool,
  host: process.env.SCIFORGE_COLLABORATION_LISTEN_HOST?.trim() || '127.0.0.1',
  port: integerEnvironment('SCIFORGE_COLLABORATION_LISTEN_PORT', 8787, 1, 65_535),
  basePath: process.env.SCIFORGE_COLLABORATION_BASE_PATH,
  allowedOrigins: optionalCsvEnvironment('SCIFORGE_COLLABORATION_ALLOWED_ORIGINS'),
  ...(oidcIssuer ? { oidc: {
    issuer: oidcIssuer,
    audience: process.env.SCIFORGE_COLLABORATION_OIDC_AUDIENCE?.trim() || 'sciforge-cloud-api',
    allowedAuthorizedParties: optionalCsvEnvironment('SCIFORGE_COLLABORATION_OIDC_ALLOWED_AUTHORIZED_PARTIES') ??
      ['sciforge-desktop', 'sciforge-web-mobile']
  } } : {}),
  ...(providerConfiguration && providerSecretDirectory
    ? { providerRuntimeFactory: ({ repository, service, providerIdentityResolver }) => createInstalledProviderRuntime({
        pool, repository, service, authentication: providerIdentityResolver,
        configuration: providerConfiguration,
        secretFileDirectory: providerSecretDirectory
      }) }
    : {})
})

await runtime.start()

let shutdownStarted = false
async function shutdown(): Promise<void> {
  if (shutdownStarted) return
  shutdownStarted = true
  const force = setTimeout(() => process.exit(1), 15_000)
  force.unref()
  try {
    await runtime.stop()
    process.exit(0)
  } catch {
    process.exit(1)
  }
}

process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}.`)
  return value
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid integer environment variable ${name}.`)
  return value
}

function optionalCsvEnvironment(name: string): string[] | undefined {
  const value = process.env[name]
  if (!value?.trim()) return undefined
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
