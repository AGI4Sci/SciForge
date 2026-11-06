import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { _electron } from 'playwright-core'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2])
await mkdir(out) // Fresh isolated profile required; never reuse personal settings.
const profile = path.join(out, 'profile')
await mkdir(profile)
await mkdir(path.join(out, 'workspace'))
await writeFile(path.join(profile, 'sciforge-settings.json'), JSON.stringify({ workspaceRoot: path.join(out, 'workspace') }))
const server = http.createServer(async (request, response) => {
  for await (const _ of request) { /* consume local fixture request */ }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ object: 'list', data: [{ id: 'ui-fixture', object: 'model', supported_reasoning_levels: [] }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
for (const key of Object.keys(env)) if (/^(ANTHROPIC|OPENAI|DEEPSEEK|CODEX)_|^(HTTPS?_PROXY|ALL_PROXY|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key]
let app
try {
  app = await _electron.launch({ executablePath: path.join(repo, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: [repo, `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], env, cwd: repo, timeout: 90_000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: /^Model API/ }).click({ timeout: 60_000 })
  const fields = page.locator('[data-generic-api-member]').last()
  await fields.getByLabel('Base URL', { exact: true }).fill(`http://127.0.0.1:${server.address().port}/v1`)
  await fields.getByLabel('API key', { exact: true }).fill('local-ui-fixture-only')
  await fields.getByLabel('Model name', { exact: true }).fill('ui-fixture')
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click()
  await page.locator('.ds-chat-composer').waitFor({ timeout: 60_000 })
  const later = page.getByRole('button', { name: 'Not now', exact: true })
  if (await later.isVisible()) await later.click()
  const checks = []
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('.ds-chat-composer')).backgroundColor === expected, theme === 'light' ? 'rgb(255, 254, 250)' : 'rgb(48, 48, 46)')
    const values = await page.locator('.ds-chat-composer').evaluate(element => ({ radius: getComputedStyle(element).borderRadius, background: getComputedStyle(element).backgroundColor }))
    assert.equal(values.radius, '28px')
    assert.equal(values.background, theme === 'light' ? 'rgb(255, 254, 250)' : 'rgb(48, 48, 46)')
    await page.screenshot({ path: path.join(out, `${theme}.png`) })
    checks.push({ theme, ...values })
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, scope: 'built Electron app; isolated profile; local model catalog only; no research inference', checks, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, out }))
} finally { await app?.close(); await new Promise(resolve => server.close(resolve)) }
