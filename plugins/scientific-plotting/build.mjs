import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { cp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyCanvasRuntime, inspectCanvasRuntime } from './scripts/canvas-runtime.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)
const out = join(root, 'dist')
// Remove only this package's verified build directory, so stale legacy UI never ships.
if (dirname(out) !== root.slice(0, -1)) throw new Error('Unexpected build directory')
try { if (await realpath(out) !== out) throw new Error('Build directory must not be a symlink') } catch (error) { if (error.code !== 'ENOENT') throw error }
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await build({ entryPoints: [join(root, 'src/native-dsh/index.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/*'], outfile: join(out, 'main.js'), logLevel: 'warning' })
await build({ entryPoints: [join(root, 'src/figure-store/worker.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['@napi-rs/canvas'], outfile: join(out, 'figure-worker.cjs'), logLevel: 'warning' })
// Ship the exact native dependency beside the worker. Installations never borrow it
// from the host or source checkout. Each platform artifact contains its own binary.
const runtime = await inspectCanvasRuntime(require)
const { canvasManifest, nativeName } = runtime
await copyCanvasRuntime(runtime, join(out, 'node_modules'))
await writeFile(join(out, 'native-runtime.json'), JSON.stringify({ platform: process.platform, arch: process.arch, canvas: canvasManifest.version, nativePackage: nativeName }, null, 2))
// Browser entry is a formal DSH ModuleLoader factory; React is supplied by DSH.
const browser = await build({ entryPoints: [join(root, 'src/native-dsh/client.tsx')], bundle: true, platform: 'browser', format: 'cjs', target: 'chrome120', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'], outfile: join(out, 'client.js'), write: false, logLevel: 'warning' })
const javascript = browser.outputFiles.find(file => file.path.endsWith('.js')).text
const css = browser.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n')
await writeFile(join(out, 'client.js'), `window.__ModuleLoader__.load({id:'@sciforge/plugin-scientific-plotting',factory(require){var module={exports:{}};var exports=module.exports;\n${javascript}\nconst plugin=module.exports.default ?? module.exports;return {...plugin,apply(ctx){ctx.effect(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);return ()=>style.remove()});return plugin.apply(ctx)}};}});\n`)
await writeFile(join(out, 'client.css'), css)
// SciForge serves this explicit standalone entry in an opaque-origin iframe.
// React and the canonical shared panels are bundled; no native ModuleLoader is used.
await build({ entryPoints: [join(root, 'src/sciforge/index.tsx')], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, outfile: join(out, 'ui/index.js'), logLevel: 'warning' })
await cp(join(root, 'src/sciforge/index.html'), join(out, 'ui/index.html'))
