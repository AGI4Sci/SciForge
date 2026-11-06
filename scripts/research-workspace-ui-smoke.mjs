import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2])
await mkdir(out, { recursive: true })
const server = await createServer({ root, configFile: false, plugins: [react()], optimizeDeps: { entries: ['scripts/e2e/research-workspace.html'] }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: process.env.SCIFORGE_TEST_CHROMIUM || undefined, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const checks = []
try {
  await page.goto(`${server.resolvedUrls.local[0]}scripts/e2e/research-workspace.html`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.getByRole('heading', { name: '今天，想把研究推进到哪里？' }).waitFor({ timeout: 90_000 })
  for (const [theme, width, height] of [['light', 1440, 1000], ['dark', 1440, 1000], ['light', 900, 800], ['light', 640, 800]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.locator('.collaboration-workspace-project-header').evaluate((header) => {
      const title = header.querySelector('.collaboration-workspace-project-header-main').getBoundingClientRect()
      const tabs = header.querySelector('[role=tablist]').getBoundingClientRect()
      return title.right <= tabs.left + 1 || title.bottom <= tabs.top + 1
    }), true, 'header title and navigation must not overlap')
    await page.screenshot({ path: path.join(out, `${theme}-${width}.png`) })
    checks.push(`${theme} ${width}: no horizontal document overflow`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '设计一个最有区分度的实验' }).click()
  assert.equal(await page.getByRole('textbox', { name: '研究问题' }).inputValue(), '设计一个最有区分度的实验')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '开始研究对话' }).click()
  const sent = JSON.parse(await page.getByTestId('research-sent').textContent())
  assert.deepEqual(sent.deliveryManifestIds, ['dmf_Research000001'])
  assert.equal(await page.getByRole('textbox', { name: '研究问题' }).inputValue(), '')
  checks.push('editable suggestion, exact result selection and successful submit')
  await page.getByRole('button', { name: /核对独立队列中的差异信号/ }).click()
  await page.getByLabel('选择历史版本').selectOption('1')
  assert.equal(await page.locator('[data-testid="delivery-history-version"]').count(), 1)
  assert.equal(await page.locator('details details').count(), 0)
  await page.screenshot({ path: path.join(out, 'task-detail.png') })
  await page.keyboard.press('Escape')
  assert.equal(await page.getByLabel('任务详情', { exact: true }).count(), 0)
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /核对独立队列/)
  checks.push('single history version, no nested expansion, Escape closes inspector and returns focus')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.research-composer').evaluate((element) => getComputedStyle(element).transitionDuration), '0s')
  checks.push('reduced motion')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ platform: process.platform, browser: browser.version(), scope: 'production React components with deterministic fixture data; no live Cloud/model', checks, errors }, null, 2))
} finally { await browser.close(); await server.close() }
console.log(JSON.stringify({ passed: checks.length, out }))
