// Run with: npx electron scripts/development-plugin-ui.electron.cjs
// Exercises the production service, protocol, CSP and React host in real Chromium.
const { app, BrowserWindow, net, protocol } = require('electron')
const { buildSync } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const repository = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sciforge-plugin-panel-'))
const plugins = fs.mkdtempSync(path.join(repository, 'test-fixtures/migration-plugins/.panel-smoke-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.on('window-all-closed', () => {})

const protocolBundle = path.join(temporary, 'protocol.cjs')
fs.writeFileSync(protocolBundle, buildSync({
  entryPoints: [path.join(repository, 'src/main/extensions/development-plugin-ui-protocol.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs'
}).outputFiles[0].text)
const uiProtocol = require(protocolBundle)
protocol.registerSchemesAsPrivileged([uiProtocol.developmentPluginUiScheme])

let service
let window
let server
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => {
  fs.appendFileSync(path.join(temporary, 'smoke.log'), `${new Date().toISOString()} ${message}\n`)
  console.log(message)
}
const stage = (name) => log(`PLUGIN_UI_SMOKE_STAGE ${name}`)
async function waitFor(check, description) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(50)
  }
  throw new Error(`Timed out: ${description}`)
}

async function mount(descriptor) {
  await window.webContents.executeJavaScript(`window.renderPluginPanel(${JSON.stringify(descriptor)})`)
}

async function panelReady(version) {
  await waitFor(async () => {
    const loading = await window.webContents.executeJavaScript('Boolean(document.querySelector("[role=status], [role=alert]"))')
    const frame = window.webContents.mainFrame.frames.find((item) => item.url.startsWith('sciforge-plugin:'))
    return !loading && frame && await frame.executeJavaScript('document.querySelector("#status")?.textContent') === `Plugin ${version} / generation ${serviceDescriptor.generation}`
  }, `plugin ${version} handshake`)
  return window.webContents.mainFrame.frames.find((item) => item.url.startsWith('sciforge-plugin:'))
}

let serviceDescriptor
async function descriptor() {
  serviceDescriptor = (await service.rendererContributionDescriptors())[0]
  assert.ok(serviceDescriptor, 'active UI descriptor missing')
  return serviceDescriptor
}

async function run() {
  stage('app-ready')
  await app.whenReady()
  stage('service-bundle')
  const fixture = path.join(repository, 'test-fixtures/migration-plugins/p2-better-sidebar')
  const installed = path.join(plugins, 'sidebar')
  fs.cpSync(fixture, installed, { recursive: true })
  const serviceBundle = path.join(temporary, 'service.mjs')
  fs.writeFileSync(serviceBundle, buildSync({
    stdin: {
      contents: "export { DevelopmentExternalPluginService } from './src/main/extensions/development-external-plugins.ts'; export { CapabilityRegistry } from './src/main/capabilities/registry.ts';",
      resolveDir: repository
    },
    bundle: true, write: false, platform: 'node', format: 'esm',
    banner: { js: `import { createRequire as smokeRequire } from 'node:module'; const require = smokeRequire(${JSON.stringify(pathToFileURL(__filename).href)});` }
  }).outputFiles[0].text)
  stage('service-import')
  const { DevelopmentExternalPluginService, CapabilityRegistry } = await import(pathToFileURL(serviceBundle).href)
  stage('service-imported')
  const pluginId = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).name
  service = new DevelopmentExternalPluginService({
    root: plugins, userDataPath: path.join(temporary, 'profile'), hostApiVersion: '1.11.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([[pluginId, { approved: true, hostApiRange: '^1.0.0', permissions: [] }]])
  })
  stage('service-initialize')
  await service.initialize()
  stage('plugin-enable')
  await service.attachCapabilityRegistry(new CapabilityRegistry())
  await service.setEnabled(pluginId, true)
  uiProtocol.installDevelopmentPluginUiProtocol(protocol, {
    resolveAsset: (asset) => service.rendererAssetPath(asset),
    fetchFile: (url, method) => net.fetch(url, { method })
  })

  stage('renderer-bundle')
  const renderer = buildSync({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import i18next from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import common from './src/renderer/src/locales/en/common.json';
        import { DevelopmentPluginPanelHost } from './src/renderer/src/components/extensions/DevelopmentPluginPanelHost.tsx';
        const i18n = i18next.createInstance();
        await i18n.init({ lng: 'en', resources: { en: { translation: common } } });
        const root = createRoot(document.getElementById('root'));
        window.pluginReadyMessages = 0;
        window.addEventListener('message', event => { if(event.data?.type === 'ready') window.pluginReadyMessages++; });
        window.renderPluginPanel = contribution => root.render(contribution ? React.createElement(I18nextProvider, { i18n }, React.createElement(DevelopmentPluginPanelHost, { contribution, active: true })) : null);
      `,
      loader: 'tsx', resolveDir: repository
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }
  }).outputFiles[0].text
  const csp = fs.readFileSync(path.join(repository, 'src/renderer/index.html'), 'utf8').match(/content="(default-src[^"]+)"/)[1]
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body,#root,#root>div{margin:0;height:100%;font:14px sans-serif}iframe{width:100%;height:100%;border:0}.opacity-0{opacity:0}</style></head><body><div id="root"></div><script type="module" src="./panel.js"></script></body></html>`
  fs.writeFileSync(path.join(temporary, 'index.html'), html)
  fs.writeFileSync(path.join(temporary, 'panel.js'), renderer)
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/panel.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/panel.js' ? renderer : html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  window = new BrowserWindow({ show: false, width: 480, height: 520,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', (event) => {
    if (event.message) errors.push(event.message)
  })
  stage('renderer-load')
  await window.loadURL(origin)
  await waitFor(() => window.webContents.executeJavaScript('typeof window.renderPluginPanel === "function"'), 'renderer bootstrap')

  // Reproduce the original rejected local-file navigation with the production CSP.
  const initial = await descriptor()
  stage('reproduce-file-failure')
  await mount({ ...initial, entryUrl: pathToFileURL(path.join(installed, 'dist/renderer.html')).href })
  await delay(250)
  assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector("[role=status]"))'), true)
  assert.ok(errors.some((message) => /Not allowed to load local resource|frame-src|Content Security Policy/iu.test(message)), JSON.stringify(errors))
  log('ORIGINAL_FILE_LOAD_FAILURE_REPRODUCED')

  stage('fixed-initial')
  await mount(initial)
  let frame = await panelReady('0.1.0')
  await frame.executeJavaScript('document.getElementById("ping").click()')
  await waitFor(async () => await frame.executeJavaScript('document.getElementById("status").textContent') === 'Host bridge connected', 'ping/pong')
  assert.equal(await frame.executeJavaScript('typeof window.sciforge'), 'undefined')
  assert.equal(await frame.executeJavaScript('typeof window.require'), 'undefined')
  assert.equal(await frame.executeJavaScript('(() => { try { return Boolean(parent.document) } catch { return false } })()'), false)
  const readyCount = await window.webContents.executeJavaScript('window.pluginReadyMessages')
  await delay(250)
  assert.equal(await window.webContents.executeJavaScript('window.pluginReadyMessages'), readyCount, 'handshake message loop')
  // A fresh object from host polling must preserve the frame and its UI state.
  await mount(await descriptor())
  await delay(100)
  assert.equal(await frame.executeJavaScript('document.getElementById("status").textContent'), 'Host bridge connected')

  const candidate = path.join(plugins, '.candidates/v2')
  stage('live-update')
  fs.cpSync(fixture, candidate, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'))
  manifest.version = '0.2.0'
  fs.writeFileSync(path.join(candidate, 'package.json'), JSON.stringify(manifest))
  const ui = fs.readFileSync(path.join(candidate, 'dist/renderer.html'), 'utf8').replace('<h1>Better Sidebar</h1>', '<h1>Better Sidebar v2</h1>')
  fs.writeFileSync(path.join(candidate, 'dist/renderer.html'), ui.replace('</body>', '<link rel="stylesheet" href="./extra.css"><script type="module" src="./extra.mjs"></script></body>'))
  fs.writeFileSync(path.join(candidate, 'dist/extra.mjs'), "import label from './label.mjs'; document.querySelector('h1').dataset.module = label;")
  fs.writeFileSync(path.join(candidate, 'dist/label.mjs'), "export default 'relative-module-loaded';")
  fs.writeFileSync(path.join(candidate, 'dist/extra.css'), 'h1 { color: rgb(22, 33, 44) }')
  await service.checkCandidate(pluginId, candidate)
  await service.applyCandidate(pluginId)
  await mount(await descriptor())
  frame = await panelReady('0.2.0')
  await waitFor(async () => await frame.executeJavaScript('document.querySelector("h1").dataset.module') === 'relative-module-loaded', 'relative ES module import')
  assert.equal(await frame.executeJavaScript('getComputedStyle(document.querySelector("h1")).color'), 'rgb(22, 33, 44)')
  assert.equal((await net.fetch(initial.entryUrl)).status, 404, 'old generation remains readable')
  assert.equal(window.webContents.getURL(), `${origin}/`, 'host navigated during hot update')

  await service.rollback(pluginId)
  stage('rollback')
  const rollback = await descriptor()
  await mount(rollback)
  frame = await panelReady('0.1.0')
  assert.equal(await frame.executeJavaScript('document.querySelector("h1").textContent'), 'Better Sidebar')

  // The same production resource path also works when the parent loads from a built file.
  await window.loadFile(path.join(temporary, 'index.html'))
  stage('file-parent')
  await waitFor(() => window.webContents.executeJavaScript('typeof window.renderPluginPanel === "function"'), 'file renderer bootstrap')
  await mount(rollback)
  frame = await panelReady('0.1.0')
  await frame.executeJavaScript('document.getElementById("ping").click()')
  await waitFor(async () => await frame.executeJavaScript('document.getElementById("status").textContent') === 'Host bridge connected', 'file parent ping/pong')
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await delay(100)
  const screenshot = path.join(repository, 'artifacts/development-plugin-ui-fixed.png')
  fs.mkdirSync(path.dirname(screenshot), { recursive: true })
  fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG())
  await service.setEnabled(pluginId, false)
  await mount(null)
  await waitFor(() => window.webContents.executeJavaScript('!document.querySelector("iframe")'), 'disabled panel unmount')
  assert.equal((await net.fetch(rollback.entryUrl)).status, 404, 'disabled UI remains readable')
  log('DEVELOPMENT_PLUGIN_UI_ELECTRON_PASSED ' + JSON.stringify({
    httpParent: true, fileParent: true, pingPong: true, isolated: true, boundedHandshake: true,
    pollingPreservesState: true, liveUpdate: true, relativeModulesAndCss: true, rollback: true, disable: true, screenshot
  }))
}

;(async () => {
  let exitCode = 0
  const watchdog = setTimeout(() => {
    log('PLUGIN_UI_SMOKE_TIMEOUT')
    app.exit(1)
  }, 40_000)
  try { await run() } catch (error) { log(error.stack || String(error)); exitCode = 1 }
  finally {
    stage('cleanup')
    if (window && !window.isDestroyed()) window.destroy()
    if (service) await service.dispose()
    if (server) await new Promise((resolve) => server.close(resolve))
    // These exact directories were allocated by this smoke run; never touch the user profile.
    fs.rmSync(plugins, { recursive: true, force: true })
    // Chromium keeps the active user-data directory locked on Windows until
    // after the Electron process exits. Preserve it there for OS temp cleanup.
    if (process.platform !== 'win32') fs.rmSync(temporary, { recursive: true, force: true })
    clearTimeout(watchdog)
    app.exit(exitCode)
  }
})()
