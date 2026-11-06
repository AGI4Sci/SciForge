import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as runtime from '../src/index.js'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { canonicalizeDshComposedConfig } from '../src/deployment.js'
import { DSH_DARWIN_ARM64_PIN } from '../src/release-darwin-arm64.js'
import { createDshDerivedModelRouterPatch } from '../src/model-router.js'

test('reviewed production release composition pins the same model-router overlay used at launch', async () => {
  const text = await readFile(new URL('./fixtures/official-acp/safe-acp.yml', import.meta.url), 'utf8')
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: string) => ({ __jsExpr: value }) })])
  const rows = yaml.load(text, { schema }) as any[]
  assert.equal(rows.find(row => row.id === 'acp').config.provider, 'sciforge-model-router')
  assert.deepEqual(rows.find(row => row.id === 'acp').config.model, { __jsExpr: 'process.env.SCIFORGE_DSH_ROUTER_MODEL' })
  for (const id of ['llm-deepseek', 'llm-deepseek-account']) assert.equal(rows.find(row => row.id === id).disabled, true)
  const provider = rows.find(row => row.id === 'llm-pi-ai').config.providers['sciforge-model-router']
  assert.equal(provider.api, 'openai-completions')
  assert.equal(provider.apiKeyEnv, 'SCIFORGE_DSH_ROUTER_KEY')
  assert.deepEqual(provider.baseURL, { __jsExpr: 'process.env.SCIFORGE_DSH_ROUTER_URL' })
  assert.equal(createHash('sha256').update(canonicalizeDshComposedConfig(text)).digest('hex'), DSH_DARWIN_ARM64_PIN.configDigest)
})
test('derived pi-ai model inputs require explicit Host modalities while pinned bytes stay unchanged', () => {
  const route = { baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'local-only', model: 'alias' }
  assert.equal(createDshDerivedModelRouterPatch(route), runtime.DSH_MODEL_ROUTER_PATCH)
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value: string) => ({ __jsExpr: value }) })])
  for (const input of [['text'], ['text', 'image']] as const) {
    const rows = yaml.load(createDshDerivedModelRouterPatch({ ...route, inputModalities: input }), { schema }) as any[]
    const model = rows.find(row => row.id === 'llm-pi-ai').config.providers['sciforge-model-router'].models[0]
    assert.deepEqual(model.input, input)
    assert.deepEqual(model.id, { __jsExpr: 'process.env.SCIFORGE_DSH_ROUTER_MODEL' })
    assert.equal(model.inputModalities, undefined)
  }
  assert.doesNotMatch(runtime.DSH_MODEL_ROUTER_PATCH, /input:/)
  for (const inputModalities of [[], ['audio'], ['image', 'image']]) {
    assert.throws(() => createDshDerivedModelRouterPatch({ ...route, inputModalities: inputModalities as never }), { code: 'runtime_model_route_invalid' })
  }
})
const { createDshEnvironment } = runtime

test('maps neutral local-only router inputs into the pinned official pi-ai chat provider', () => {
  const env = createDshEnvironment({ executable: '/fixture', stateDirectory: '/state', verifyDeployment: async () => {}, modelRouter: { baseUrl: 'http://127.0.0.1:3892/v1', apiKey: 'local-only', model: 'chosen-alias' } })
  assert.equal(env.SCIFORGE_DSH_ROUTER_URL, 'http://127.0.0.1:3892/v1')
  assert.equal(env.SCIFORGE_DSH_ROUTER_KEY, 'local-only')
  assert.equal(env.SCIFORGE_DSH_ROUTER_MODEL, 'chosen-alias')
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.match(runtime.DSH_MODEL_ROUTER_PATCH, /api: openai-completions/)
  assert.match(runtime.DSH_MODEL_ROUTER_PATCH, /provider: sciforge-model-router/)
  assert.match(runtime.DSH_MODEL_ROUTER_PATCH, /apiKeyEnv: SCIFORGE_DSH_ROUTER_KEY/)
})
