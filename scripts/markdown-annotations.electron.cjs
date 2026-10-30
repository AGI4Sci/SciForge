// Run with: electron scripts/markdown-annotations.electron.cjs
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const katex = require('katex')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sciforge-markdown-selection-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
;(async () => {
  await app.whenReady()
  const bundle = buildSync({
    entryPoints: [path.resolve(__dirname, '../src/renderer/src/workspace-preview/dom-text-annotations.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'anchors', platform: 'browser'
  }).outputFiles[0].text
  const html = `<html><head><link rel="stylesheet" href="${pathToFileURL(require.resolve('katex/dist/katex.min.css'))}">
  <style>body{margin:0;font:18px sans-serif}#scroller{box-sizing:border-box;position:relative;width:510px;height:460px;overflow:auto;padding:24px;border:3px solid gray;margin:50px}#layer{position:absolute;inset:0;pointer-events:none}.box{position:absolute;background:#38bdf844}#root{padding-top:500px;padding-bottom:600px}p{line-height:1.8}</style></head>
  <body><div id="scroller"><div id="root"><p id="first">问题设定：<span id="formula">${katex.renderToString('S=(D,\\theta,H)')}</span><span id="after">公式后的中文内容</span><button>不计入锚点</button><span id="tail">精确选择</span></p><p id="second">预算 <span id="budget">${katex.renderToString('B=(\\beta_{tok},\\beta_{gpu})')}</span> 约束。</p><p>模型的输入输出：下一段</p></div><div id="layer"></div></div></body></html>`
  const file = path.join(temp, 'fixture.html')
  fs.writeFileSync(file, html)
  const win = new BrowserWindow({ show: false, width: 900, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  await win.loadFile(file)
  await win.webContents.executeJavaScript(bundle)
  const result = await win.webContents.executeJavaScript(`(${async function () {
    const anchors = globalThis.anchors
    await document.fonts.ready
    const root = document.getElementById('root')
    const scroller = document.getElementById('scroller')
    const assert = (condition, message) => { if (!condition) throw new Error(message) }
    const range = document.createRange()
    const after = document.getElementById('after')
    range.selectNodeContents(after)
    assert(anchors.documentTextAnchorFromDomRange(root, range).quote === after.textContent, 'Element endpoint after formula drifted')
    range.selectNodeContents(document.getElementById('tail'))
    assert(anchors.documentTextAnchorFromDomRange(root, range).quote === '精确选择', 'Ignored button shifted element endpoint')
    const visibleMath = document.querySelector('#formula .katex-html')
    range.selectNodeContents(visibleMath)
    const formula = anchors.documentTextAnchorFromDomRange(root, range)
    assert(formula.quote === 'S=(D,θ,H)', 'Formula includes hidden MathML/TeX or adjacent text: '+formula.quote)
    assert(formula.range.startContainer.parentElement.closest('.katex-html'), 'Formula start resolved outside visible formula')
    assert(formula.range.endContainer.parentElement.closest('.katex-html'), 'Formula end resolved outside visible formula')
    const restored = anchors.resolveDomDocumentTextAnchor(root, { quote: formula.quote, textRange: {start:formula.from,end:formula.to} })
    assert(restored.range.toString() === visibleMath.textContent, 'Saved formula anchor did not round-trip')
    const leaf = after.firstChild
    range.setStart(leaf,0); range.setEnd(leaf,5)
    const selected = anchors.documentTextAnchorFromDomRange(root,range)
    assert(selected.quote === '公式后的中', 'Text endpoint drifted')
    const geometry = []
    for (const zoom of [0.82, 1, 1.25]) {
      document.body.style.zoom = String(zoom)
      scroller.scrollTop = 450
      await new Promise(resolve => requestAnimationFrame(resolve))
      for (const anchor of [selected, formula]) {
        const sourceRects = anchors.documentTextRangeClientRects(root,anchor.range)
        assert(sourceRects.length > 0, 'Visible selection has no rectangles')
        const overlay = anchors.resolveDocumentTextOverlayRects(root,scroller,[{id:'test',kind:'comment',quote:anchor.quote,textRange:{start:anchor.from,end:anchor.to}}])[0]
        assert(overlay.rects.length === sourceRects.length, 'Overlay and selection disagree')
        for (let i=0;i<overlay.rects.length;i++) {
          const box = document.createElement('span');box.className='box'
          for(const [k,v] of Object.entries(overlay.rects[i])) box.style[k]=v+'px'
          document.getElementById('layer').append(box)
          const actual=box.getBoundingClientRect(), expected=sourceRects[i]
          for(const key of ['left','top','width','height']) assert(Math.abs(actual[key]-expected[key])<0.12, 'Zoom '+zoom+' '+key+' drift: '+(actual[key]-expected[key])+' details '+JSON.stringify({rect:overlay.rects[i],expected:expected.toJSON(),actual:actual.toJSON(),scale:anchors.documentElementScale(scroller),clientLeft:scroller.clientLeft,style:getComputedStyle(scroller).borderLeftWidth}))
          box.remove()
        }
      }
      geometry.push(zoom)
    }
    // A cross-paragraph selection must not produce ancestor paragraph/table boxes.
    range.setStart(after.firstChild,0)
    range.setEnd(document.getElementById('second').lastChild,3)
    const cross = anchors.documentTextAnchorFromDomRange(root,range)
    assert(!cross.quote.includes('\\beta') && !cross.quote.includes('不计入'), 'Cross-block selection contains ignored text')
    return {formula:formula.quote,geometry,elementEndpoints:true,textEndpoints:true,roundTrip:true}
  }.toString()})()`)
  console.log('MARKDOWN_ANNOTATIONS_BROWSER_PASSED', JSON.stringify(result))
  win.destroy()
  app.exit(0)
})().catch(error => { console.error(error); app.exit(1) })
