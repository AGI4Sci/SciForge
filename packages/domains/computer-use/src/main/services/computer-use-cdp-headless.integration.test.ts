import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import { createPlaywrightCdpDriver, startComputerUseCdpAdapter } from './computer-use-cdp-adapter'

const edge = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync)

describe.skipIf(!edge)('test-owned single CDP target', () => {
  it('observes, performs a structured input sequence, verifies, and releases its handle', async () => {
    const app = createServer((_request, response) => {
      const body = Buffer.from(`<!doctype html><title>Single Target</title>
        <label>Editor<input aria-label="Editor"></label>
        <button onclick="document.querySelector('output').textContent='Committed:'+document.querySelector('input').value">Commit</button>
        <output></output>`)
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) })
      response.end(body)
    })
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
    const address = app.address()
    if (!address || typeof address === 'string') throw new Error('test server did not listen')
    const cdpPort = await freePort()
    const browser = await chromium.launch({
      executablePath: edge,
      headless: true,
      args: [`--remote-debugging-port=${cdpPort}`]
    })
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      await page.goto(`http://127.0.0.1:${address.port}`)
      const adapter = await startComputerUseCdpAdapter({
        driver: createPlaywrightCdpDriver([`http://127.0.0.1:${cdpPort}`])
      })
      const rawCall = async (path: string, body?: Record<string, unknown>) => {
        const response = await fetch(`${adapter.url}/v1/${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${adapter.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        })
        return await response.json() as {
          ok: boolean
          data: Record<string, any>
          error?: { code?: string }
        }
      }
      const call = async (path: string, body?: Record<string, unknown>) => {
        const payload = await rawCall(path, body)
        expect(payload.ok).toBe(true)
        return payload.data
      }
      try {
        const listed = await call('targets')
        const target = (listed.targets as Array<Record<string, any>>)
          .find((candidate) => candidate.metadata?.title === 'Single Target')
        expect(target).toBeTruthy()
        const opened = await call('handles/open', { target, requestId: 'single-request' })
        let observed = await call('observe', { handleId: opened.handleId })
        const editor = observed.metadata.semanticTree.find((node: Record<string, any>) => node.name === 'Editor')
        const clicked = await call('action', {
          handleId: opened.handleId, expectedRevision: observed.revision,
          action: { action: 'click', coordinate: toPixels(editor.center) }
        })
        const typed = await call('action', {
          handleId: opened.handleId, expectedRevision: clicked.verification.revisionAfter,
          action: { action: 'type', text: 'alpha' }
        })
        observed = await call('observe', { handleId: opened.handleId })
        const commit = observed.metadata.semanticTree.find((node: Record<string, any>) => node.name === 'Commit')
        const committed = await call('action', {
          handleId: opened.handleId, expectedRevision: observed.revision,
          action: { action: 'click', coordinate: toPixels(commit.center) }
        })
        expect(committed.verification.status).toMatch(/verified|unverified/u)
        expect(await page.locator('output').textContent()).toBe('Committed:alpha')
        const final = await call('observe', { handleId: opened.handleId })
        expect(final.metadata.semanticTree).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'Committed:alpha' })
        ]))
        await call('handles/close', { handleId: opened.handleId, reason: 'test_complete' })
        expect(page.isClosed()).toBe(false)
        expect(await page.locator('output').textContent()).toBe('Committed:alpha')
        const reopened = await call('handles/open', { target, requestId: 'target-loss-request' })
        await page.close()
        expect(await rawCall('observe', { handleId: reopened.handleId })).toMatchObject({
          ok: false, error: { code: 'TARGET_LOST' }
        })
        await call('handles/close', { handleId: reopened.handleId, reason: 'target_lost' })
        expect((await call('capabilities')).activeHandleCount).toBe(0)
      } finally {
        await adapter.close()
      }
    } finally {
      await browser.close()
      await new Promise<void>((resolve) => app.close(() => resolve()))
    }
  }, 30_000)
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no free loopback port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function toPixels(center: readonly [number, number]): [number, number] {
  return [Math.round(center[0] * 0.8), Math.round(center[1] * 0.6)]
}
