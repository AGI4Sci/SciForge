import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

import { actor, commitPlot, fixture } from './figure-binding-fixture.js'

// Real dossier image component -> public openResource shape -> packaged iframe
// entry -> public owner handlers. The test Host is intentionally synthetic;
// this does not claim Electron admission, approval, or an installed package test.
test('dossier image card opens actual packaged iframe and preserves exact source identity', { timeout: 90_000 }, async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const pins = JSON.parse(await readFile(new URL('../../../resources/extensions/plugin-contract-pins.json', import.meta.url), 'utf8'))
  const pin = pins.pins[`${pkg.name}@${pkg.version}`]
  assert.ok(pin, 'Main integration must add the released plugin version to the canonical host pin file')
  const admitted: string[] = pin.uiCapabilities
  assert.ok(admitted.includes('artifact-versions.describe-v2'), 'Main integration must grant describe-v2 in the canonical pin')
  const context = await fixture()
  const old = await commitPlot(context, 1)
  const latest = await commitPlot(context, 2, old.figure)
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const bundle = await build({ stdin: { sourcefile: 'card-harness.tsx', resolveDir: repo, loader: 'tsx', contents:
    "import { createRoot } from 'react-dom/client';" +
    "import { ExactArtifactImageCard } from './packages/domains/research-dossier/src/renderer/ExactArtifactImageCard.tsx';" +
    "import { domainWorkbenchOpenResourceInputSchema } from '@sciforge/domain-sdk/renderer';" +
    "const openResource = input => { window.openedResource = domainWorkbenchOpenResourceInputSchema.parse(input); window.readyReceived=false; document.querySelector('iframe')?.remove(); const frame=document.createElement('iframe'); frame.sandbox='allow-scripts'; frame.style='width:760px;height:1400px;border:0'; frame.src='/ui/index.html'; document.body.append(frame); return true };" +
    "window.openResourceForTest=openResource;" +
    "window.addEventListener('message', async event => { if(event.source !== document.querySelector('iframe')?.contentWindow)return; const data=event.data; if(data.type==='ready'&&!window.readyReceived) {window.readyReceived=true; event.source.postMessage({type:'host.init',workspaceRoot:window.fixture.workspace,sessionId:'test-session',locale:'en',capabilityIds:window.fixture.admitted,activation:{revision:1,payload:{resource:window.openedResource.resource}}},'*');} if(data.type==='capability.invoke'){try{const output=await window.ownerInvoke(data.actionId,data.input);event.source.postMessage({type:'capability.result',requestId:data.requestId,ok:true,output},'*')}catch(error){event.source.postMessage({type:'capability.result',requestId:data.requestId,ok:false,error:{message:error.message}},'*')}} });" +
    "const client={readArtifactVersion:(_root,input)=>window.ownerInvoke('artifact-versions.read',input)};" +
    "createRoot(document.getElementById('card')).render(<ExactArtifactImageCard reference={window.fixture.ref} client={client} workspaceRoot={window.fixture.workspace} sessionId='test-session' workbench={{openResource,canOpenResource:kind=>kind==='scientific-plot'}}/>);"
  }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
  const script = bundle.outputFiles[0].text
  const hostHtml = '<!doctype html><html><body><div id="card"></div><script>window.fixture=' + JSON.stringify({ workspace: context.workspace, ref: old.figure, admitted }) + '</script><script type="module" src="/card.js"></script></body></html>'
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    try {
      if(request.url === '/') { response.setHeader('Content-Type','text/html'); response.end(hostHtml); return }
      if(request.url === '/card.js') { response.setHeader('Content-Type','text/javascript'); response.end(script); return }
      const asset = new Map([['/ui/index.html','index.html'],['/ui/main.js','main.js'],['/ui/main.css','main.css'],['/ui/tailwind.css','tailwind.css']]).get(request.url ?? '')
      if(!asset) { response.statusCode=404; response.end(); return }
      response.setHeader('Content-Type', asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html')
      response.end(await readFile(join(process.env.SCIFORGE_PLOT_BUILD_DIR || join(repo,'plugins/scientific-plotting/dist'),'ui',asset)))
    } catch(error) { response.statusCode=500; response.end(String(error)) }
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  assert.ok(address && typeof address === 'object')
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ executablePath: process.env.SCIFORGE_TEST_CHROMIUM || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/chromium'),headless:true })
    const page = await browser.newPage({ viewport:{width:1000,height:1000} })
    const errors: string[]=[]
    const calls: Array<{id:string;input:unknown}>=[]
    let readFault: 'mismatch' | 'denied' | undefined
    page.on('pageerror',error=>errors.push(error.message))
    page.on('dialog',dialog=>void dialog.accept())
    await page.exposeFunction('ownerInvoke',async(id:string,input:unknown)=>{
      assert.ok(admitted.includes(id),'Only admitted read/draft capabilities are permitted')
      calls.push({id,input})
      if (id === 'artifact-versions.read' && (input as {versionId:string}).versionId === latest.code.versionId && readFault) {
        if (readFault === 'denied') return { ok: false, issue: { code: 'access-restricted', message: 'Code content access denied' } }
        const result = await context.service.read(context.workspace, input as Parameters<typeof context.service.read>[1], actor)
        assert.ok(result.ok)
        return { ok: true, value: { ...result.value, ref: { ...result.value.ref, byteLength: 0 } } }
      }
      return context.invoke(context.workspace,id,input,actor)
    })
    await page.goto('http://127.0.0.1:'+address.port)
    await page.getByRole('button',{name:'Open exact image source'}).click()
    const frame=page.frameLocator('iframe')
    await frame.getByRole('button',{name:'Source',exact:true}).click()
    assert.equal(calls.filter(call=>call.id==='artifact-versions.read' && [old.code.versionId,old.data.versionId].includes((call.input as {versionId:string}).versionId)).length,0, 'Opening Source must not read code or data bytes')
    await frame.getByRole('button',{name:'View generated code',exact:true}).click()
    await frame.getByText(old.rawCode,{exact:true}).waitFor()
    await frame.getByRole('button').filter({hasText:old.data.versionId}).click()
    await frame.getByText(old.rawData,{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=> (window as unknown as {openedResource:unknown}).openedResource),{sessionId:'test-session',resource:{resourceKind:'scientific-plot',resourceId:old.figure.versionId,integrity:{algorithm:'sha256',expectedDigest:'sha256:'+old.figure.contentDigest}}})
    assert.equal(calls.some(call=>call.id==='artifact-versions.list' && !(call.input as {dependencyTarget?:unknown}).dependencyTarget),false)
    await frame.locator('body').screenshot({path:join(context.directory,'exact-code-data.png')})
    await frame.getByRole('button',{name:'Save new code draft',exact:true}).click()
    await frame.getByText('New draft saved from the fixed Artifact',{exact:true}).waitFor()
    const draft=calls.find(call=>call.id==='artifact-versions.materialize')!.input as {destinationPath:string;overwrite:boolean}
    assert.equal(draft.overwrite,false)
    assert.ok(draft.destinationPath.startsWith('.sciforge/drafts/'))
    assert.equal(await readFile(join(context.workspace,draft.destinationPath),'utf8'),old.rawCode)
    // The real Host keeps the frame mounted when activation changes.
    await page.evaluate(({ workspace, reference }) => {
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'host.init', workspaceRoot: workspace, sessionId: 'test-session', activation: { revision: 2, payload: { resource: { resourceKind: 'scientific-plot', resourceId: reference.versionId, integrity: { algorithm: 'sha256', expectedDigest: 'sha256:' + reference.contentDigest } } } } }, '*')
    }, { workspace: context.workspace, reference: latest.figure })
    await frame.getByRole('button',{name:'Source',exact:true}).click()
    await frame.getByRole('button',{name:'View generated code',exact:true}).click()
    await frame.getByText(latest.rawCode,{exact:true}).waitFor()
    assert.equal(await frame.getByText(old.rawCode,{exact:true}).count(),0)
    readFault = 'mismatch'
    await frame.getByRole('button',{name:'View generated code',exact:true}).click()
    await frame.getByText('The Artifact reference digest does not match the stored snapshot.', {exact:true}).first().waitFor()
    assert.equal(await frame.getByText(latest.rawCode,{exact:true}).count(),0)
    readFault = 'denied'
    await frame.getByRole('button',{name:'View generated code',exact:true}).click()
    await frame.getByText('Code content access denied',{exact:true}).first().waitFor()
    assert.equal(await frame.getByText(latest.rawCode,{exact:true}).count(),0)
    readFault = undefined
    await page.evaluate(({ workspace, reference }) => {
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'host.init', workspaceRoot: workspace, sessionId: 'test-session', activation: { revision: 3, payload: { resource: { resourceKind: 'scientific-plot', resourceId: reference.versionId, integrity: { algorithm: 'sha256', expectedDigest: 'sha256:' + '0'.repeat(64) } } } } }, '*')
    }, { workspace: context.workspace, reference: old.figure })
    await page.frameLocator('iframe').getByText('The requested exact version digest does not match. No other figure was selected.',{exact:true}).waitFor()
    assert.equal(await page.frameLocator('iframe').locator('img').count(),0)
    await page.evaluate(()=>{
      (window as unknown as {openResourceForTest:(input:unknown)=>void}).openResourceForTest({sessionId:'test-session',resource:{resourceKind:'scientific-plot',resourceId:'artifact-version:missing'}})
    })
    await page.frameLocator('iframe').getByText(/Artifact version not found/i).waitFor()
    assert.equal(await page.frameLocator('iframe').locator('img').count(),0)
    assert.deepEqual(errors,[])
    await writeFile(join(context.directory,'ui-result.json'),JSON.stringify({status:'passed',scope:'synthetic Host with production card, packaged iframe entry and public owner handlers',calls,errors},null,2))
  } finally {
    await browser?.close()
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    await context.dispose()
  }
})
