// Run with: node scripts/e2e/responsive-workbench-smoke.mjs
// Uses installed Chrome, or CHROME_EXECUTABLE_PATH when provided.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cacheDir = await mkdtemp(join(tmpdir(), 'sciforge-responsive-vite-'))
const server = await createServer({
  cacheDir: join(cacheDir, 'node_modules/.vite'),
  optimizeDeps: {
    noDiscovery: true,
    include: [
      'react',
      'react-dom/client',
      'react/jsx-runtime',
      'lucide-react',
      'i18next',
      'react-i18next',
      'zustand',
      'zod'
    ]
  },
  root,
  configFile: false,
  plugins: [
    react(),
    {
      name: 'responsive-workbench-fixture',
      configureServer(vite) {
        vite.middlewares.use('/responsive-workbench-smoke', async (_req, res, next) => {
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              await vite.transformIndexHtml(
                '/responsive-workbench-smoke',
                '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/e2e/fixtures/responsive-workbench.tsx"></script></body></html>'
              )
            )
          } catch (error) {
            next(error)
          }
        })
      }
    }
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@shared': `${root}src/shared`,
      '@renderer': `${root}src/renderer/src`
    }
  },
  server: { host: '127.0.0.1', port: 0 }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch(
    process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH, headless: true }
      : { channel: 'chrome', headless: true }
  )
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  const address = server.httpServer.address()
  await page.goto(`http://127.0.0.1:${address.port}/responsive-workbench-smoke`)
  await page.waitForSelector('.ds-usage-overview-grid')
  const results = []
  for (const width of [320, 375, 480, 640, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(100)
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.ds-usage-overview-grid')
      const card = document.querySelector('.ds-usage-command-center')
      const first = grid.children[0].getBoundingClientRect()
      const second = grid.children[1].getBoundingClientRect()
      const toolbar = document.querySelector('.chat-workbench-topbar')
      const buttons = [...toolbar.querySelectorAll(':scope > button')]
      return {
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        cardWidth: card.clientWidth,
        stacked: second.top >= first.bottom,
        visible: buttons.length,
        metricColumns: getComputedStyle(document.querySelector('.ds-usage-metrics')).gridTemplateColumns.split(' ').length,
        clippedText: [...document.querySelectorAll('.ds-usage-metric span, .ds-usage-streaks span')].some((element) => element.scrollWidth > element.clientWidth + 1),
        left: buttons[0]?.getBoundingClientRect().left,
        lastRight: toolbar.querySelector('.toolbar-tail').getBoundingClientRect().right
      }
    })
    assert(layout.scrollWidth <= width, `Horizontal overflow at ${width}`)
    assert.equal(layout.stacked, true)
    assert.equal(layout.metricColumns, layout.cardWidth >= 600 ? 4 : layout.cardWidth >= 280 ? 2 : 1)
    assert.equal(layout.clippedText, false, `Clipped usage text at ${width}`)
    assert(layout.lastRight <= width, `Toolbar overflow at ${width}`)
    results.push(layout)
  }
  assert.equal(results.at(-1).visible, 15)
  assert.equal(results.at(-1).left, results.at(-2).left)
  assert.equal(results.at(-1).lastRight, results.at(-2).lastRight)
  assert(results[0].visible < results[3].visible)

  // A narrow content pane must stack even inside a wide application window.
  await page.locator('#card-host').evaluate((element) => {
    element.style.width = '420px'
  })
  await page.waitForTimeout(100)
  assert.equal(
    await page
      .locator('.ds-usage-overview-grid')
      .evaluate(
        (element) =>
          element.children[1].getBoundingClientRect().top >=
          element.children[0].getBoundingClientRect().bottom
      ),
    true
  )

  // Restore focus when a focused tool moves into overflow during resize.
  await page.getByRole('button', { name: 'Tool 12', exact: true }).focus()
  await page.setViewportSize({ width: 480, height: 1000 })
  await page.waitForTimeout(100)
  assert.match(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    /More tools/
  )
  await page.getByRole('button', { name: /More tools/ }).click()
  await page.getByRole('button', { name: 'Tool 12', exact: true }).click()
  assert.equal(await page.evaluate(() => window.lastAction), 'test-11')
  await page.getByRole('button', { name: /More tools/ }).click()
  await page.keyboard.press('Escape')
  assert.match(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    /More tools/
  )
  await page.getByRole('button', { name: /More tools/ }).click()
  await page.getByRole('button', { name: 'Customize toolbar', exact: true }).click()
  await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Locale, theme and application scaling must not clip controls.
  await page.evaluate(() => {
    window.previewI18n.changeLanguage('zh')
    document.documentElement.dataset.theme = 'dark'
    document.documentElement.style.setProperty('--ds-ui-scale', '1.5')
    document.querySelector('#card-host').style.width = ''
  })
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: /更多工具/ }).click()
  const bounds = await page.getByRole('dialog', { name: '更多工具', exact: true }).boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 481)
  assert(bounds.y + bounds.height <= 1001)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(results))
  console.log('Responsive workbench browser checks passed.')
} finally {
  await browser?.close()
  await server.close()
  await rm(cacheDir, { recursive: true, force: true })
}
