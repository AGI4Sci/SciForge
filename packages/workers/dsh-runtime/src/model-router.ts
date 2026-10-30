import { DshRuntimeError } from './transport.js'

/** Neutral Host-owned route. Never an upstream provider credential. */
export interface DshModelRouter { baseUrl: string; apiKey: string; model: string }

/** Official 639ed015 ACP + pi-ai OpenAI chat contract. Dump preserves these
 * fixed expressions unevaluated, so arbitrary aliases never weaken the pin. */
export const DSH_MODEL_ROUTER_PATCH = `
- id: llm-deepseek
  disabled: true
- id: llm-deepseek-account
  disabled: true
- id: llm-pi-ai
  config:
    providers:
      sciforge-model-router:
        api: openai-completions
        apiKeyEnv: SCIFORGE_DSH_ROUTER_KEY
        baseURL: !!js process.env.SCIFORGE_DSH_ROUTER_URL
        models:
          - id: !!js process.env.SCIFORGE_DSH_ROUTER_MODEL
- id: acp
  config:
    provider: sciforge-model-router
    model: !!js process.env.SCIFORGE_DSH_ROUTER_MODEL
`

export function modelRouterEnvironment(route: DshModelRouter): NodeJS.ProcessEnv {
  let url: URL
  try { url = new URL(route.baseUrl) } catch { throw new DshRuntimeError('runtime_model_route_invalid') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/v1' || !route.apiKey?.trim() || !route.model?.trim() || /[\r\n\0]/.test(route.apiKey + route.model)) throw new DshRuntimeError('runtime_model_route_invalid')
  return { SCIFORGE_DSH_ROUTER_URL: route.baseUrl, SCIFORGE_DSH_ROUTER_KEY: route.apiKey, SCIFORGE_DSH_ROUTER_MODEL: route.model }
}
