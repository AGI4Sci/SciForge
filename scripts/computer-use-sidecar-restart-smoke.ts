import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { startElectronComputerUseAdapterRuntime } from '@sciforge/domain-computer-use/main'

const workerDirectory = fileURLToPath(new URL(
  '../packages/workers/gui-owl-computer-use/', import.meta.url
))
const python = process.env.CUA_TEST_PYTHON?.trim() || 'python'
const serviceToken = randomBytes(32).toString('hex')

type Sidecar = Readonly<{
  process: ChildProcess
  output: () => string
}>

async function main(): Promise<void> {
  const port = await availablePort()
  const serviceUrl = `http://127.0.0.1:${port}`
  let sidecar: Sidecar | null = null
  let runtime: Awaited<ReturnType<typeof startElectronComputerUseAdapterRuntime>> | null = null
  try {
    sidecar = startSidecar(port)
    await waitForHealth(serviceUrl, sidecar)
    runtime = await startElectronComputerUseAdapterRuntime({
      listWebContents: () => [],
      serviceUrl,
      serviceToken,
      retryIntervalMs: 5_000
    })
    await waitForCdpAvailability(serviceUrl, true, 3_000)
    const firstInstanceId = await serverInstanceId(serviceUrl)

    await stopSidecar(sidecar)
    sidecar = startSidecar(port)
    await waitForHealth(serviceUrl, sidecar)
    const secondInstanceId = await serverInstanceId(serviceUrl)
    if (firstInstanceId === secondInstanceId) throw new Error('Sidecar instance identity did not change.')
    await waitForCdpAvailability(serviceUrl, true, 8_000)

    await runtime.close()
    runtime = null
    await waitForCdpAvailability(serviceUrl, false, 3_000)
    process.stdout.write(JSON.stringify({
      ok: true,
      sidecarRestarts: 1,
      instanceChanged: true,
      registrationRecovered: true,
      casClearVerified: true
    }))
  } finally {
    await runtime?.close().catch(() => undefined)
    if (sidecar) await stopSidecar(sidecar).catch(() => undefined)
  }
}

function startSidecar(port: number): Sidecar {
  const chunks: string[] = []
  const env = { ...process.env }
  delete env.SCIFORGE_CUA_CDP_ADAPTER_URL
  delete env.SCIFORGE_CUA_CDP_ADAPTER_TOKEN
  Object.assign(env, {
    CUA_PORT: String(port),
    CUA_SERVICE_TOKEN: serviceToken,
    SCIFORGE_CUA_SERVICE_TOKEN: serviceToken,
    CUA_ALLOW_EXECUTE: 'false',
    CUA_INVOCATION_PROOF_MODE: 'legacy',
    CUA_LEASE_REAPER_ENABLED: 'false'
  })
  const child = spawn(python, ['-u', '-m', 'cua.server'], {
    cwd: workerDirectory,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (value) => chunks.push(String(value)))
  child.stderr?.on('data', (value) => chunks.push(String(value)))
  return { process: child, output: () => chunks.join('').slice(-4_096) }
}

async function stopSidecar(sidecar: Sidecar): Promise<void> {
  if (sidecar.process.exitCode !== null) return
  sidecar.process.kill()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(
      `Sidecar did not exit after termination. Output: ${sidecar.output()}`
    )), 5_000)
    sidecar.process.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function waitForHealth(serviceUrl: string, sidecar: Sidecar): Promise<void> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (sidecar.process.exitCode !== null) {
      throw new Error(`Sidecar exited before health check. Output: ${sidecar.output()}`)
    }
    try {
      const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch { /* retry until deadline */ }
    await delay(50)
  }
  throw new Error(`Sidecar health check timed out. Output: ${sidecar.output()}`)
}

async function waitForCdpAvailability(
  serviceUrl: string, expected: boolean, timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await cdpAvailable(serviceUrl) === expected) return
    await delay(50)
  }
  throw new Error(`CDP availability did not become ${String(expected)} within ${timeoutMs}ms.`)
}

async function cdpAvailable(serviceUrl: string): Promise<boolean> {
  const response = await fetch(`${serviceUrl}/computer-use/capabilities`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
    signal: AbortSignal.timeout(1_000)
  })
  if (!response.ok) throw new Error(`Sidecar capabilities returned HTTP ${response.status}.`)
  const payload = await response.json() as {
    data?: { backends?: Array<{ backend?: string; available?: boolean }> }
  }
  return payload.data?.backends?.some((backend) => (
    backend.backend === 'browser-cdp' && backend.available === true
  )) ?? false
}

async function serverInstanceId(serviceUrl: string): Promise<string> {
  const response = await fetch(`${serviceUrl}/computer-use/status`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
    signal: AbortSignal.timeout(1_000)
  })
  if (!response.ok) throw new Error(`Sidecar status returned HTTP ${response.status}.`)
  const payload = await response.json() as { data?: { serverInstanceId?: unknown } }
  const instanceId = payload.data?.serverInstanceId
  if (typeof instanceId !== 'string' || !instanceId) {
    throw new Error('Sidecar status omitted serverInstanceId.')
  }
  return instanceId
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a loopback port.')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
