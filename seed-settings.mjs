// Pre-seed DeepSeek GUI (gui branch) settings so the app can run turns without
// touching the Settings UI. Drives the app's own JsonSettingsStore.patch() =>
// guaranteed schema-valid. Run from the repo root:  node --import tsx ./seed-settings.mjs
import { join } from 'node:path'
import { homedir } from 'node:os'
import { JsonSettingsStore } from './src/main/settings-store.ts'

const APPDATA = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
const USER_DATA = join(APPDATA, 'DeepSeek GUI') // app.setName('DeepSeek GUI')

// Secrets/config from env (never hardcode). Set these before running.
const DS_URL = process.env.SCIFORGE_GATEWAY_URL || 'http://YOUR_GATEWAY:3888/v1'
const DS_MODEL = process.env.SCIFORGE_TEXT_MODEL || 'bailian/deepseek-v4-flash'
const QWEN_MODEL = process.env.SCIFORGE_VISION_MODEL || 'qwen3.7-plus'
const KEY = process.env.SCIFORGE_GATEWAY_KEY || ''
if (!KEY) {
  console.error('[seed] Missing SCIFORGE_GATEWAY_KEY. Set it (and optionally SCIFORGE_GATEWAY_URL) in the environment before seeding.')
  process.exit(1)
}

const store = new JsonSettingsStore(USER_DATA)
const next = await store.patch({
  provider: { apiKey: KEY, baseUrl: DS_URL },
  modelRouter: {
    enabled: true,
    autoStart: true,
    profiles: {
      default: {
        textReasoner: { provider: 'openai-compatible', baseUrl: DS_URL, apiKey: KEY, model: DS_MODEL },
        translators: {
          vision: { provider: 'qwen-compatible', baseUrl: DS_URL, apiKey: KEY, model: QWEN_MODEL }
        }
      }
    }
  }
})

const mr = next.modelRouter
console.log('[seed] settings written to', join(USER_DATA, 'deepseek-gui-settings.json'))
console.log('[seed] modelRouter.enabled =', mr.enabled, '| autoStart =', mr.autoStart, '| alias =', mr.publicModelAlias)
console.log('[seed] text  =', mr.profiles.default.textReasoner.model, '@', mr.profiles.default.textReasoner.baseUrl, mr.profiles.default.textReasoner.apiKey ? '(key set)' : '(NO KEY)')
console.log('[seed] vision=', mr.profiles.default.translators.vision.model, '@', mr.profiles.default.translators.vision.baseUrl, mr.profiles.default.translators.vision.apiKey ? '(key set)' : '(NO KEY)')
