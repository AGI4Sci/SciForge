import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

/** Production iframe, synthetic transport/confirmation, real review + version owner. */
export async function exerciseReviewIframe(input: {
  workspaceRoot: string
  documentId: string
  outputDir: string
  invoke: (id: string, input: unknown) => Promise<any>
}): Promise<void> {
  const manifest = JSON.parse(await readFile(new URL('../sciforge.dsh.json', import.meta.url), 'utf8'))
  const ids = Object.values(manifest.tools as Record<string, { id: string }>).map((tool) => tool.id)
  assert.equal(ids.length, 19)
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    try {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><body><iframe sandbox="allow-scripts" src="/ui/index.html" style="width:900px;height:900px;border:0"></iframe><script>' +
          `const init=${JSON.stringify({ type: 'host.init', workspaceRoot: input.workspaceRoot, sessionId: 'fixture-review-session', locale: 'zh', capabilityIds: ids, activation: { revision: 1, payload: { documentId: input.documentId, tab: 'review' } } })};` +
          'window.addEventListener("message",async e=>{const f=document.querySelector("iframe");if(e.source!==f.contentWindow)return;const d=e.data;if(d.type==="ready")e.source.postMessage(init,"*");if(d.type==="capability.invoke"){try{const output=await window.ownerInvoke(d.actionId,d.input,d.approval);e.source.postMessage({type:"capability.result",requestId:d.requestId,ok:true,output},"*")}catch(error){e.source.postMessage({type:"capability.result",requestId:d.requestId,ok:false,error:{message:error.message}},"*")}}if(d.type==="composer.sendMessage")e.source.postMessage({type:"composer.result",requestId:d.requestId,ok:true,result:{ok:true}},"*")});</script></body></html>')
        return
      }
      const asset = new Map([['/ui/index.html', 'index.html'], ['/ui/main.js', 'main.js'], ['/ui/main.css', 'main.css'], ['/ui/tailwind.css', 'tailwind.css']]).get(request.url ?? '')
      if (!asset) { response.statusCode = 404; response.end(); return }
      response.setHeader('Content-Type', asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(new URL('../dist/ui/' + asset, import.meta.url)))
    } catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const browser = await chromium.launch({ executablePath: process.platform === 'win32'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/chromium', headless: true })
  const errors: string[] = []
  const calls: { id: string; approval: unknown }[] = []
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.exposeFunction('ownerInvoke', async (id: string, value: unknown, approval: unknown) => {
      assert.ok(ids.includes(id), 'Fixture grants only actual declared plugin tools; no host pin widening')
      calls.push({ id, approval })
      if (id === 'visual-review.accept-candidate') assert.deepEqual(approval, { mode: 'confirmation' })
      return input.invoke(id, value)
    })
    await page.goto(`http://127.0.0.1:${address.port}`)
    const frame = page.frameLocator('iframe')
    await frame.getByRole('button', { name: '接受并替换', exact: true }).waitFor()
    assert.equal(await frame.locator('.scientific-plotting-unified-tabs [role=tab]').count(), 3)
    assert.equal(await frame.locator('.visual-review-surface').evaluate((element) => getComputedStyle(element).display), 'flex', 'Production review stylesheet must be loaded')
    assert.ok(await frame.locator('img').count() >= 2)
    await frame.getByText('图片来源 · 请求与版本', { exact: true }).first().click()
    await frame.locator('p:visible').filter({ hasText: '实际发送的 prompt' }).first().waitFor()
    await frame.locator('body').screenshot({ path: join(input.outputDir, 'review-production-iframe.png') })
    await frame.getByRole('button', { name: '接受并替换', exact: true }).click()
    await frame.getByRole('button', { name: '生成修改版', exact: true }).waitFor()
    assert.equal(calls.filter((call) => call.id === 'visual-review.accept-candidate').length, 1)
    await frame.getByRole('tab', { name: '版本与溯源', exact: true }).click()
    await frame.getByText('图片来源 · 请求与版本', { exact: true }).last().waitFor()
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'dispose' }, '*'))
    await page.waitForFunction(() => document.querySelector('iframe') !== null)
    await frame.locator('#root:empty').waitFor()
    assert.deepEqual(errors, [])
    await writeFile(join(input.outputDir, 'review-ui-result.json'), JSON.stringify({ status: 'passed', scope: 'production iframe; synthetic transport/confirmation; real review and version owner', calls, errors }, null, 2))
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}
