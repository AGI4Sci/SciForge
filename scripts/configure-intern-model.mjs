import { chmod, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const settingsPath = resolve(process.argv[2] ?? '')
const apiKey = process.env.INTERN_API_KEY?.trim()
if (!settingsPath || !apiKey) {
  console.error('Usage: INTERN_API_KEY=… node scripts/configure-intern-model.mjs <sciforge-settings.json>')
  process.exit(2)
}

const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
const modelRouter = settings.modelRouter ?? {}
const profiles = modelRouter.profiles ?? {}
const defaultProfile = profiles.default ?? {}
const textReasoner = defaultProfile.textReasoner ?? {}

settings.modelAccess = { ...(settings.modelAccess ?? {}), mode: 'api' }
settings.modelRouter = {
  ...modelRouter,
  enabled: true,
  autoStart: true,
  baseUrl: 'http://127.0.0.1:50879/v1',
  publicModelAlias: modelRouter.publicModelAlias || 'sciforge-router',
  profiles: {
    ...profiles,
    default: {
      ...defaultProfile,
      textReasoner: {
        ...textReasoner,
        baseUrl: 'https://discovery-api.intern-ai.org.cn/v1',
        apiKey,
        model: 'deepseek-v4-flash-0731',
        protocol: 'auto'
      }
    }
  }
}

await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
await chmod(dirname(settingsPath), 0o700).catch(() => undefined)
console.log(`Configured Intern model in ${settingsPath} (API key value omitted).`)
