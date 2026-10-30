/**
 * Minimal static server for the market acceptance runs.
 *
 * It exists so the HTTP acceptance can prove a *real* transfer happened: every
 * response is logged with method, path, status and the number of bytes written.
 * The packaged app is pointed at this server with SCIFORGE_MARKET_INDEX so the
 * download path (progress bytes, size guard, digest check) runs for real instead
 * of reading a file from disk.
 *
 *   node scripts/market-http-fixture-server.mjs --dir market --port 8123 --log <file>
 */
import { createServer } from 'node:http'
import { createReadStream, appendFileSync, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const dir = resolve(flag('dir', 'market'))
const port = Number(flag('port', '8123'))
const logPath = flag('log', join(process.cwd(), 'market-http-fixture.log'))
if (!existsSync(dir)) throw new Error(`--dir does not exist: ${dir}`)

const log = (line) => appendFileSync(logPath, `${line}\n`)

/**
 * Content types matter here: a browser must *render* the site, not download it.
 * Artifacts and anything unknown stay octet-stream on purpose.
 */
const CONTENT_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}))

function contentTypeFor(path) {
  const match = /\.[a-z0-9]+$/i.exec(path)
  return (match ? CONTENT_TYPES.get(match[0].toLowerCase()) : undefined) ?? 'application/octet-stream'
}
log(`# serving ${dir} on http://127.0.0.1:${port} at ${new Date().toISOString()}`)

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
  const target = join(dir, relative)
  if (!target.startsWith(dir) || !existsSync(target) || statSync(target).isDirectory()) {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
    log(`${request.method} ${url.pathname} 404 0`)
    return
  }
  const size = statSync(target).size
  response.writeHead(200, { 'content-type': contentTypeFor(target), 'content-length': String(size) })
  const stream = createReadStream(target)
  stream.pipe(response)
  response.on('finish', () => log(`${request.method} ${url.pathname} 200 ${size}`))
})

server.listen(port, '127.0.0.1', () => {
  log(`# listening`)
  process.stdout.write(`market-http-fixture listening on http://127.0.0.1:${port} (${dir})\n`)
})