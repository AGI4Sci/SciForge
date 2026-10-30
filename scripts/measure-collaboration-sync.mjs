#!/usr/bin/env node
// Adapted from the 2026-10-20 replay driver. Explicit source targets only.
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const portsArgument = process.argv.find((argument) => argument.startsWith('--ports='))?.slice('--ports='.length)
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
if (!portsArgument || !outputArgument) throw new Error('Explicit --ports=19310,19311 and --output=artifacts/...json are required.')
const ports = portsArgument.split(',').map(Number)
if (ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535 || (port >= 19262 && port <= 19266))) {
  throw new Error('Invalid source port, or a protected A–E demo application port.')
}
const outputPath = resolve(root, outputArgument)
if (!outputPath.startsWith(resolve(root, 'artifacts') + '/')) throw new Error('Output must stay inside this worktree artifacts directory.')
const sourceUrl = pathToFileURL(resolve(root, 'out/renderer/index.html')).href
const samples = []
for (const port of ports) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  try {
    const page = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().split('?')[0] === sourceUrl)
    if (!page) throw new Error(`Port ${port} is not a source build from this worktree.`)
    samples.push({ port, ...await page.evaluate(async () => {
      const call = async (actionId, input) => {
        const transportRequestId = crypto.randomUUID()
        const start = performance.now()
        const timer = setTimeout(() => void window.sciforge.capabilities.cancel(transportRequestId).catch(() => undefined), 45_000)
        try {
          const { output } = await window.sciforge.capabilities.invoke({ transportRequestId, request: { actionId, input } })
          const connectionState = output.connection?.state
          return { actionId, ms: Math.round(performance.now() - start),
            ok: connectionState === 'ready' || connectionState === 'connected', connectionState,
            projects: output.projects?.length, dashboards: output.dashboards?.length,
            diagnostics: output.diagnostics?.map(({ code }) => code) }
        } catch (error) {
          return { actionId, ms: Math.round(performance.now() - start), ok: false, error: String(error).slice(0, 260) }
        } finally { clearTimeout(timer) }
      }
      const started = performance.now()
      const reads = await Promise.all([call('collaboration.workspace.read', {}),
        call('collaboration.status.read', { refreshDashboards: true })])
      return { ms: Math.round(performance.now() - started), ok: reads.every(({ ok }) => ok), reads }
    }) })
  } finally {
    // A CDP-connected Browser close disconnects this client, leaving the app running.
    await browser.close()
  }
}
const report = { mode: 'authenticated-source-page-data', samples,
  scope: 'Two canonical page-data capabilities; excludes DOM drawing and additional Worker Delivery reads.' }
await writeFile(outputPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exitCode = samples.every(({ ok }) => ok) ? 0 : 1
