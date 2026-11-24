const { app, BrowserWindow, session } = require('electron')
const { createServer } = require('node:http')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { gzipSync } = require('node:zlib')
const { attachNativeAiSession } = require(process.argv[2])
app.setPath('userData', mkdtempSync(join(tmpdir(), 'sciforge-native-network-smoke-')))
const paths = []
let origin
const server = createServer(async (req, res) => {
  paths.push(req.url)
  if (req.url === '/') { res.writeHead(302, { location: '/stage/build/desktop/' }); res.end(); return }
  if (req.url === '/stage/build/desktop/') { res.setHeader('Content-Type', 'text/html'); res.end('<script src="main.js"></script>'); return }
  if (req.url === '/stage/build/desktop/main.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Encoding': 'gzip' })
    res.end(gzipSync("fetch('/api/check',{method:'POST',body:'payload'}).then(r=>r.json()).then(x=>window.done=x).catch(e=>window.done={error:String(e)})")); return
  }
  if (req.url === '/api/check') {
    let body='';for await(const part of req)body+=part
    const valid = req.headers.origin === origin && (req.headers.cookie || '').includes('fixture=value')
    res.writeHead(valid?200:403, { 'content-type':'application/json' });res.end(JSON.stringify({ok:valid,body}));return
  }
  res.writeHead(404);res.end()
})
app.whenReady().then(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port
  const jar = session.fromPartition('native-network-smoke-'+Date.now())
  await jar.cookies.set({url:origin,name:'fixture',value:'value'})
  const window = new BrowserWindow({show:false,webPreferences:{session:jar,nodeIntegration:false,contextIsolation:true,sandbox:true}})
  const detach = attachNativeAiSession(jar, origin+'/', { page: window.webContents, authorized: () => true, access: { textReasoner: async () => null, readBlock: async () => '' } })
  await window.loadURL(origin+'/')
  let result
  for(let i=0;i<100;i++){result=await window.webContents.executeJavaScript('window.done');if(result)break;await new Promise(r=>setTimeout(r,50))}
  const finalPath=new URL(window.webContents.getURL()).pathname
  const success=result?.ok===true&&result.body==='payload'&&finalPath==='/stage/build/desktop/'&&paths.includes('/stage/build/desktop/main.js')
  process.stdout.write(JSON.stringify({success,finalPath,result,relativeGzipScript:paths.includes('/stage/build/desktop/main.js')})+'\n')
  detach();window.destroy();server.close();app.exit(success?0:1)
}).catch(error=>{process.stderr.write(String(error.stack)+'\n');server.close();app.exit(1)})
