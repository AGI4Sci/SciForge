import { app, BrowserWindow, type WebContents } from 'electron'
import { createServer, type Server } from 'node:http'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { createSiYuanNativeView, type SiYuanNativeView } from '../src/main/native-view.js'

const LF = String.fromCharCode(10)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const key = 'fixture-local-router-key'
const servers: Server[] = [], windows: BrowserWindow[] = [], views: SiYuanNativeView[] = []
const checks: string[] = []
app.setPath('userData', process.env.SIYUAN_AI_SMOKE_PROFILE!)
const listen = async (server: Server) => {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port
}
const fetchFrom = (page: WebContents, path: string, value: unknown = {}) =>
  page.executeJavaScript('fetch(' + JSON.stringify(path) + ', {method: "POST", headers: {"Content-Type":"application/json"},body: JSON.stringify(' +
    JSON.stringify(value) + ')}).then(async r => ({status:r.status,text:await r.text()}))') as Promise<{ status: number; text: string }>

async function main() {
  await app.whenReady()
  let serverAiCalls = 0, settingsWrites = 0, templateCalls = 0, cancelled = 0
  const modelCalls: { model: string; prompt: string }[] = []
  const origin = await listen(createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture').pathname
    res.setHeader('Content-Type', 'application/json')
    if (path === '/api/system/getConf') {
      res.end(JSON.stringify({ code: 0, data: { conf: { ai: {
        editing: { modelId: 'shared', maxHistoryMessages: 7, temperature: 1, maxCompletionTokens: 0 },
        providers: [{ id: 'server', apiKey: 'shared-server-fixture-key', enabled: true, models: [] }]
      }, untouched: 'preserved' } } })); return
    }
    if (path === '/api/setting/setAI') settingsWrites++
    if (path.endsWith('/lsActions')) { templateCalls++; res.end(JSON.stringify({ code: 0, data: [] })); return }
    if (path.startsWith('/api/ai/')) serverAiCalls++
    if (path === '/ordinary') { res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' })); return }
    res.setHeader('Content-Type', 'text/html')
    res.end('<body>AI fixture<iframe src="/child"></iframe></body>')
  }))
  const router = await listen(createServer(async (req, res) => {
    assert.equal(req.url, '/v1/responses')
    assert.equal(req.headers.authorization, 'Bearer ' + key)
    let body = ''
    for await (const chunk of req) body += chunk
    const value = JSON.parse(body), prompt = value.input.at(-1).content
    modelCalls.push({ model: value.model, prompt })
    res.setHeader('Content-Type', 'text/event-stream')
    res.on('close', () => { if (!res.writableEnded) cancelled++ })
    const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + LF + LF
    res.write(frame({ type: 'response.reasoning_summary_text.delta', delta: '思考' }))
    if (prompt.includes('stall')) return
    const bytes = Buffer.from(frame({ type: 'response.output_text.delta', delta: value.model + ' 摘要🙂' }))
    res.write(bytes.subarray(0, bytes.length - 9)); await delay(10); res.write(bytes.subarray(bytes.length - 9))
    res.end(frame({ type: 'response.completed', response: { status: 'completed' } }))
  }))
  let identityA: CurrentUserProfile = { state: 'signed-in', userId: 'fixture-a', displayName: 'A' }
  const identityB: CurrentUserProfile = { state: 'signed-in', userId: 'fixture-b', displayName: 'B' }
  const open = async (read: () => CurrentUserProfile, model: string) => {
    const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    windows.push(host)
    await host.loadURL('data:text/html,Host')
    const view = createSiYuanNativeView({ readIdentity: read, nativeAi: {
      textReasoner: async () => ({ baseUrl: router, apiKey: key, model }),
      readBlock: async () => '# fixture block'
    } })
    views.push(view)
    await view.present({ hostId: host.webContents.id, url: origin + '/',
      viewport: { x: 0, y: 0, width: 600, height: 400, visible: true } })
    const page = (host.contentView.children[0] as Electron.WebContentsView).webContents
    return { view, page }
  }
  const a = await open(() => identityA, 'local-a'), b = await open(() => identityB, 'local-b')
  await a.page.executeJavaScript('document.cookie="account=a;path=/"')
  await b.page.executeJavaScript('document.cookie="account=b;path=/"')
  assert.equal(JSON.parse((await fetchFrom(a.page, '/ordinary')).text).cookie, 'account=a')
  assert.equal(JSON.parse((await fetchFrom(b.page, '/ordinary')).text).cookie, 'account=b')
  checks.push('two account cookies survive ordinary request forwarding')
  const config = await fetchFrom(a.page, '/api/system/getConf')
  assert.ok(config.text.includes('SciForge 本机模型'))
  assert.ok(!config.text.includes('shared-server-fixture-key'))
  assert.ok(!config.text.includes(key))
  assert.equal(JSON.parse(config.text).data.conf.untouched, 'preserved')
  checks.push('native config displays local model without any runtime or shared provider key')
  for (const [client, model] of [[a, 'local-a'], [b, 'local-b']] as const) {
    const result = await fetchFrom(client.page, '/api/ai/editor/chat', { taskID: model, input: '原文', action: '总结 {{input}}' })
    assert.equal(result.status, 200)
    assert.ok(result.text.includes('event: reasoning') && result.text.includes(model + ' 摘要🙂'))
    assert.ok(result.text.includes('event: done') && !result.text.includes(key))
  }
  assert.deepEqual(modelCalls, [{ model: 'local-a', prompt: '总结 原文' }, { model: 'local-b', prompt: '总结 原文' }])
  checks.push('native request and SSE work with separate local model identities')
  await fetchFrom(a.page, '/api/ai/editor/lsActions')
  assert.equal(templateCalls, 1)
  assert.equal((await fetchFrom(a.page, '/api/setting/setAI')).status, 400)
  assert.equal((await fetchFrom(a.page, '/api/ai/agent/chat')).status, 400)
  assert.equal((await fetchFrom(a.page, '/api/ai/chatGPT')).status, 400)
  assert.equal(settingsWrites, 0); assert.equal(serverAiCalls, 0)
  checks.push('native templates pass through; settings and unsupported model calls never reach shared AI')
  const before = modelCalls.length
  const child = await a.page.executeJavaScript('document.querySelector("iframe").contentWindow.fetch("/api/ai/editor/chat",{method:"POST",body:JSON.stringify({taskID:"child",input:"x"})}).then(()=>"unexpected",()=>"blocked")')
  assert.equal(child, 'blocked')
  assert.equal(modelCalls.length, before)
  checks.push('same-origin child frames cannot invoke the local model')
  const stopCode = '(async()=>{const ac=new AbortController();const r=await fetch("/api/ai/editor/chat",{method:"POST",body:JSON.stringify({taskID:"stop",input:"stall"}),signal:ac.signal});const reader=r.body.getReader();await reader.read();await reader.read();ac.abort();})()'
  await a.page.executeJavaScript(stopCode)
  for (let i = 0; i < 40 && !cancelled; i++) await delay(25)
  assert.equal(cancelled, 1)
  checks.push('native AbortController stops the actual model HTTP stream')
  const peer = await open(() => identityA, 'local-a')
  a.view.dispose()
  assert.ok((await fetchFrom(peer.page, '/api/ai/editor/chat', { taskID: 'peer', input: '原文' })).text.includes('event: done'))
  checks.push('same-account windows share one handler and dispose independently')
  const pending = fetchFrom(peer.page, '/api/ai/editor/chat', { taskID: 'logout', input: 'stall' }).catch(() => null)
  const count = modelCalls.length
  for (let i = 0; i < 40 && modelCalls.length === count; i++) await delay(25)
  identityA = { state: 'signed-out' }
  for (let i = 0; i < 40 && cancelled < 2; i++) await delay(25)
  assert.equal(cancelled, 2)
  await pending
  checks.push('account changes abort old streams')
  const c = await open(() => identityA, 'forbidden')
  assert.equal((await fetchFrom(c.page, '/api/ai/editor/chat', { taskID: 'out', input: 'x' })).status, 403)
  checks.push('signed-out views cannot use a local credential')
  assert.equal(serverAiCalls, 0); assert.equal(settingsWrites, 0)
  return { passed: true, checks, sharedModelRequests: serverAiCalls, sharedSettingsWrites: settingsWrites }
}
void main().then(async result => {
  await writeFile(process.env.SIYUAN_AI_SMOKE_RESULT!, JSON.stringify(result, null, 2))
  app.exit(0)
}).catch(async error => {
  await writeFile(process.env.SIYUAN_AI_SMOKE_RESULT!, JSON.stringify({ passed: false, checks, error: String(error), stack: error.stack }, null, 2))
  app.exit(1)
}).finally(() => {
  views.forEach(view => view.dispose())
  windows.forEach(window => { if (!window.isDestroyed()) window.destroy() })
  servers.forEach(server => server.close())
})
