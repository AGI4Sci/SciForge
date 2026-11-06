import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const repo=fileURLToPath(new URL('../../../../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'')
const require=createRequire(repo+'/package.json')
const root=await mkdtemp(join(tmpdir(),'siyuan-comment-account-smoke-'))
const entry=join(root,'entry.mjs'), bundle=join(root,'bundled-entry.mjs'),result=join(root,'result.json')
await writeFile(entry,`
import {app,BrowserWindow} from 'electron'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createSiYuanNativeView} from '${repo}/packages/domains/siyuan-content-space-provider/src/main/native-view.ts'
import {prepareCommentIdentityPreload} from '${repo}/packages/domains/siyuan-content-space-provider/src/main/comment-identity-bridge.ts'
app.setPath('userData',${JSON.stringify(join(root,'profile'))})
const progress=(stage)=>writeFile(${JSON.stringify(join(root,'progress.txt'))},stage)
let server,host,view
async function main() {
try {
 await progress('before ready')
 await app.whenReady()
 await progress('ready')
 server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/child'?'<html><body>Child</body></html>':'<html><body>Comment account fixture<iframe src="/child"></iframe></body></html>')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const url='http://127.0.0.1:'+server.address().port+'/'
 host=new BrowserWindow({show:false,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
 await host.loadURL('data:text/html,<body>Host</body>')
 await progress('host loaded')
 let identity={state:'signed-in',userId:'user-a',displayName:'同名'}
 const preloadPath=await prepareCommentIdentityPreload(app.getPath('userData'))
 view=createSiYuanNativeView({preloadPath,readIdentity:()=>identity})
 await view.present({hostId:host.webContents.id,url,viewport:{x:0,y:0,width:600,height:400,visible:true}})
 await progress('view loaded')
 const page=host.contentView.children[0].webContents
 const read=()=>page.executeJavaScript('window.sciforgeCommentIdentity.read()')
 assert.deepEqual(await read(),identity)
 await progress('first identity read')
 assert.equal(await page.executeJavaScript('typeof window.require'),'undefined')
 assert.equal(await page.executeJavaScript('typeof window.sciforge'),'undefined')
 assert.equal(await page.executeJavaScript('typeof document.querySelector("iframe").contentWindow.sciforgeCommentIdentity'),'undefined')
 identity={state:'signed-in',userId:'user-b',displayName:'同名'}
 assert.deepEqual(await read(),identity)
 identity={state:'signed-out'}
 assert.deepEqual(await read(),identity)
 identity={state:'signed-in',userId:'user-a',displayName:'改名后'}
 await new Promise(resolve=>{page.once('did-finish-load',resolve);page.reload()})
 await progress('reloaded')
 assert.deepEqual(await read(),identity)
 await page.executeJavaScript('location.href="http://localhost:'+server.address().port+'/"')
 await new Promise(resolve=>setTimeout(resolve,300))
 assert.equal(new URL(page.getURL()).hostname,'127.0.0.1')
 assert.deepEqual(await read(),identity)
 const snapshot={passed:true,checks:['sandbox preload','main-frame identity','no Node API','no generic SciForge API','no child-frame bridge','same-name account switch','logout','rename and reload','cross-origin navigation blocked'],profile:app.getPath('userData')}
 await writeFile(${JSON.stringify(result)},JSON.stringify(snapshot,null,2))
 console.log(JSON.stringify(snapshot))
 view.dispose();host.destroy();server.close();app.exit(0)
} catch(error){await writeFile(${JSON.stringify(result)},JSON.stringify({passed:false,error:String(error),stack:error.stack},null,2));view?.dispose();host?.destroy();server?.close();app.exit(1)}
}
void main()
`)
await require('esbuild').build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',external:['electron'],logLevel:'warning'})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
console.log('SMOKE_ROOT',root)
const child=spawn(require('electron'),[bundle,'--hidden','--disable-gpu'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b)
const timer=setTimeout(()=>child.kill(),45000)
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)})
clearTimeout(timer)
console.log('Electron exit',code)
try{console.log(await readFile(result,'utf8'))}catch{console.log('last stage',await readFile(join(root,'progress.txt'),'utf8').catch(()=> 'not started'));console.log(output.slice(-5000))}
if(code!==0)process.exitCode=1
