// Isolated browser fixture: production layout, dock, toolbar and composer.
// No Electron profile, runtime provider, model call or credential bridge is installed.
// Run: node scripts/ui-layout-review-smoke.mjs
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(process.argv[2] ?? `${tmpdir()}/sciforge-ui-layout-${Date.now()}`)
const virtualId = 'virtual:ui-layout-review.tsx'
const fixture = `
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/renderer/src/index.css'
import '/src/renderer/src/styles/base-shell.css'
import '/src/renderer/src/styles/markdown-code.css'
import i18n from '/src/renderer/src/i18n'
import { useWorkbenchLayout, WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS } from '/src/renderer/src/components/workbench-layout'
import { SessionRightPanelDock } from '/src/renderer/src/components/SessionRightPanelDock'
import { useSideConversationDock } from '/src/renderer/src/components/side-conversation-layout'
import { WorkbenchTopBar } from '/src/renderer/src/components/chat/WorkbenchTopBar'
import { FloatingComposer } from '/src/renderer/src/components/chat/FloatingComposer'
import { useChatStore } from '/src/renderer/src/store/chat-store'
i18n.changeLanguage('en')
useChatStore.setState({ activeThreadId: 'layout-fixture', workspaceRoot: '', runtimeConnection: 'disconnected',
  threads: [{ id: 'layout-fixture', title: 'Layout fixture', runtimeId: 'codex' }],
  sidePanel: { open: false, activeSideId: null } })
function Fixture() {
 const layout = useWorkbenchLayout({activeSessionId:'layout-fixture'})
 const side = useSideConversationDock(layout.rightPanelOverlay ? 0 : layout.rightPanelDockViewportWidth)
 const [input, setInput] = useState('Layout only: no runtime attached')
 useEffect(() => { window.layoutFixture = {
   layout,
   add: () => layout.addRightPanelPaneForSession('layout-fixture', {mode:'file'}, {width:560}),
   side: (open) => useChatStore.setState({sidePanel:{open,activeSideId:null}})
 } }, [layout])
 return <div ref={layout.shellRef} className="ds-workbench-shell relative flex h-full min-h-0 w-full min-w-0">
   <aside ref={layout.sidebarOverlayRef} hidden={layout.leftSidebarCollapsed}
     style={{width:layout.leftSidebarWidth, position:layout.leftSidebarOverlay?'absolute':'relative',insetBlock:0,left:0,zIndex:60,background:'var(--ds-bg-main)',maxWidth:'calc(100% - 48px)'}}>
     <button onClick={layout.toggleLeftSidebar}>Close navigation</button><p>Navigation fixture</p>
   </aside>
   {!layout.leftSidebarCollapsed && !layout.leftSidebarOverlay && <div className="ds-workbench-divider"/>}
   <main ref={side.stageRef} className="ds-stage-surface relative flex min-h-0 min-w-0 flex-1">
     <div className="ds-chat-stage flex min-h-0 min-w-0 flex-1 flex-col" data-main style={{padding:12}}>
       <header className="chat-topbar flex shrink-0 min-w-0 items-center">
         <button className="ds-titlebar-sidebar-toggle shrink-0" onClick={layout.toggleLeftSidebar}>Navigation</button>
         <WorkbenchTopBar focusedRightPanelMode={layout.focusedRightPanelMode} onToggleFocusedRightPanelMode={() => window.layoutFixture.add()} workspaceRoot="" />
       </header>
       <div className="min-h-0 min-w-0 flex-1 overflow-auto"><p>Main conversation</p></div>
       <FloatingComposer input={input} setInput={setInput} mode="agent" setMode={()=>{}} busy={false} runtimeReady hasActiveThread
          composerModel="fixture-long-model-name" composerPickList={['fixture-long-model-name']} onComposerModelChange={()=>{}}
          queuedMessages={[]} onRemoveQueuedMessage={()=>{}} onSend={()=>{window.fixtureSent=true}} onInterrupt={()=>{}} />
     </div>
     {layout.activeRightPanelWorkspace?.panes.length > 0 && <div className={WORKBENCH_RIGHT_PANEL_VISIBLE_CLASS}
       data-right-panel-presentation={layout.rightPanelOverlay?'overlay':'docked'}
       style={{width:layout.rightPanelDockViewportWidth,...(layout.rightPanelOverlay?{position:'absolute',insetBlock:0,right:0,zIndex:40}:{})}}>
       <SessionRightPanelDock workspace={layout.activeRightPanelWorkspace} active bindings={[{id:'file',label:'Files'},{id:'plan',label:'Plan'}]}
         labels={{dock:'Right dock',pane:({index})=>'Pane '+index,back:'Back',forward:'Forward',binding:'Binding',switchPane:'Switch pane',resize:'Resize',split:'Split',splitAction:'New pane',close:'Close pane'}}
         onFocusPane={layout.focusRightPanelPaneForSession} onNavigatePane={layout.navigateRightPanelPaneHistoryForSession}
         onRebindPane={(sid,pid,mode)=>layout.rebindRightPanelPaneForSession(sid,pid,{mode})}
         onBeginResizePane={layout.beginRightPanelPaneResize} onSplitPane={layout.splitRightPanelPaneForSession} onClosePane={layout.closeRightPanelPaneForSession}
         renderPane={(pane)=><div data-fixture-pane={pane.paneId}><pre style={{whiteSpace:'pre'}}> {'command --argument='.repeat(90)} </pre>
            <table><tbody><tr>{Array.from({length:18},(_,i)=><td key={i}>Long_column_{i}</td>)}</tr></tbody></table></div>} />
     </div>}
   </main>
 </div>
}
createRoot(document.getElementById('root')).render(<Fixture />)
`
await mkdir(output, { recursive: true })
const server = await createServer({ root, configFile: false, cacheDir: `${output}/node_modules/.vite`,
  optimizeDeps: { entries: ['src/renderer/src/components/chat/FloatingComposer.tsx', 'src/renderer/src/components/chat/WorkbenchTopBar.tsx'], include: ['react','react-dom/client','react/jsx-runtime','lucide-react','i18next','react-i18next','zustand','zod'] },
  plugins: [react(), {
    name:'ui-layout-review-fixture',
    resolveId(id) { if(id===virtualId) return `\0${virtualId}` },
    async load(id) { if(id===`\0${virtualId}`) return (await transformWithEsbuild(fixture, virtualId, {loader:'tsx',jsx:'automatic'})).code },
    configureServer(vite) { vite.middlewares.use('/ui-layout-review', async (_req,res,next)=>{
      try { res.setHeader('Content-Type','text/html'); res.end(await vite.transformIndexHtml('/ui-layout-review',
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${virtualId}"></script></body></html>`)) }
      catch(error) { next(error) }
    }) }
  }], resolve:{dedupe:['react','react-dom'],alias:{'@shared':`${root}src/shared`,'@renderer':`${root}src/renderer/src`}},
  server:{host:'127.0.0.1',port:0,watch:null,hmr:false}
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({channel:'chrome',headless:true})
  const page = await browser.newPage({viewport:{width:1440,height:900}})
  page.setDefaultTimeout(15000)
  const errors=[]
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/ui-layout-review`, {waitUntil:'domcontentloaded',timeout:60000})
  await Promise.race([page.waitForFunction(()=>Boolean(window.layoutFixture), null, {timeout:60000}), page.waitForEvent('pageerror').then(error=>{throw error})])
  await page.evaluate(()=>window.layoutFixture.add())
  await page.waitForSelector('[data-session-right-panel-pane]')
  const results=[]
  for(const width of [720,1024,1440,576,819,1152]) {
    await page.setViewportSize({width,height:900})
    for(const panes of [1,2]) {
      if(panes===2) await page.evaluate(()=>window.layoutFixture.add())
      await page.waitForFunction(() => {
        const layout = window.layoutFixture.layout
        const width = layout.shellRef.current.clientWidth
        return layout.leftSidebarOverlay === (width < 958) && layout.rightPanelOverlay === (width < 671)
      })
      await page.locator('[data-main] textarea').fill('Isolated layout fixture message')
      await page.screenshot({path:`${output}/${width}-${panes}.png`})
      const measurement=await page.evaluate(()=>{
        const main=document.querySelector('[data-main]').getBoundingClientRect()
        const dock=document.querySelector('[data-session-right-panel-dock]')
        const pane=document.querySelector('[data-focused="true"]')
        const rect=pane.getBoundingClientRect()
        const close=pane.querySelector('[aria-label="Close pane"]').getBoundingClientRect()
        const content=pane.querySelector('[data-right-panel-pane-content]')
        return {viewport:innerWidth,shellWidth:document.querySelector('.ds-workbench-shell').clientWidth,
          shellRect:document.querySelector('.ds-workbench-shell').getBoundingClientRect().width,
          leftCollapsed:window.layoutFixture.layout.leftSidebarCollapsed,leftOverlay:window.layoutFixture.layout.leftSidebarOverlay,
          dockRequested:window.layoutFixture.layout.rightPanelDockViewportWidth,
          mainWidth:main.width,paneWidth:rect.width,dockWidth:dock.clientWidth,
          closeLeft:close.left,closeRight:close.right,closeTop:close.top,closeBottom:close.bottom,
          scrollWidth:document.documentElement.scrollWidth,localScroll:content.scrollWidth>content.clientWidth,
          overlay:window.layoutFixture.layout.rightPanelOverlay,
          widths:window.layoutFixture.layout.activeRightPanelWorkspace.panes.map(p=>p.width)}
      })
      assert(measurement.mainWidth>=359,JSON.stringify(measurement))
      assert(measurement.paneWidth>=300,JSON.stringify(measurement))
      assert(measurement.closeLeft>=0&&measurement.closeRight<=width+1,JSON.stringify(measurement))
      assert(measurement.scrollWidth<=width+1,JSON.stringify(measurement))
      assert(measurement.localScroll, 'Long content must scroll inside its pane')
      assert(measurement.widths.every(w=>w===560),'Viewport must not persist reduced widths')
      const send = page.locator('[data-main] button[aria-label="Send"]')
      const sendBounds = await send.boundingBox()
      assert(sendBounds && sendBounds.x >= 0 && sendBounds.x + sendBounds.width <= width + 1 && sendBounds.y + sendBounds.height <= 901, JSON.stringify(sendBounds))
      if (!measurement.overlay) {
        await send.click()
        assert.equal(await page.evaluate(()=>window.fixtureSent),true)
      }
      results.push({...measurement,panes,sendBounds})
      if(panes===2) await page.locator('[data-focused="true"] [aria-label="Close pane"]').click()
    }
  }
  // Keep both panes mounted and focused while the viewport changes.
  await page.setViewportSize({width:1440,height:900})
  await page.evaluate(()=>window.layoutFixture.add())
  for (const width of [1440, 1024, 720, 576, 819, 1440]) {
    await page.setViewportSize({width,height:900})
    await page.waitForFunction(() => {
      const layout = window.layoutFixture.layout
      const width = layout.shellRef.current.clientWidth
      return layout.leftSidebarOverlay === (width < 958) && layout.rightPanelOverlay === (width < 671)
    })
    await page.waitForTimeout(100)
    const bounds = await page.locator('[data-focused="true"] [aria-label="Close pane"]').boundingBox()
    await page.screenshot({path:`${output}/persistent-two-panes-${width}.png`})
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, JSON.stringify({persistentTwoPanes:width,bounds}))
    results.push({persistentTwoPanes:width,closeBounds:bounds})
  }
  await page.locator('[data-focused="true"] [aria-label="Close pane"]').click()
  // Browser CSS fallback only: this is deliberately not claimed as Electron webFrame zoom.
  await page.setViewportSize({width:720,height:900})
  for(const scale of [0.82,0.88,1,1.25]) {
    await page.evaluate(scale=>document.documentElement.style.setProperty('--ds-ui-scale',String(scale)),scale)
    await page.waitForTimeout(150)
    const bounds=await page.locator('[data-focused="true"] [aria-label="Close pane"]').boundingBox()
    assert(bounds.x>=0&&bounds.x+bounds.width<=721,JSON.stringify({scale,bounds}))
    await page.screenshot({path:`${output}/css-scale-${scale}.png`})
    results.push({cssFallbackScale:scale,closeBounds:bounds})
  }
  assert.deepEqual(errors,[])
  await writeFile(`${output}/result.json`, JSON.stringify({ results, errors },null,2))
  console.log(JSON.stringify(results,null,2))
  console.log('UI layout fixture passed; native Electron zoom remains untested.')
} finally {
  await browser?.close()
  await server.close()
  // Preserve isolated diagnostics and cache, including failed attempts.
}
