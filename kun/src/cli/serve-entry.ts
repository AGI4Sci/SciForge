#!/usr/bin/env node
import process from 'node:process'
import { parseServeOptionsSafe, SERVE_USAGE, ServeExitCode } from './serve.js'
import {
  LOCAL_RUNTIME_CLI_USAGE,
  runAgentCommand,
  splitLocalRuntimeCliCommand
} from './agent-cli.js'
import { startLocalRuntimeServe } from '../server/runtime-factory.js'
import { consumeBioGymPrivateBootstrap } from './biogym-private-bootstrap.js'

export const KUN_READY_PREFIX = 'KUN_READY '

/**
 * Serve-mode command. Kept separate from the dispatcher so GUI startup
 * still has the exact same KUN_READY handshake behavior.
 */
async function serveMain(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(SERVE_USAGE)
    return ServeExitCode.ok
  }
  const parsed = parseServeOptionsSafe(argv, process.env)
  if (!parsed.ok) {
    process.stderr.write(`kun serve: ${parsed.message}\n`)
    if (parsed.issues) {
      process.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
    }
    return parsed.exitCode
  }
  // Consume and close the inherited private pipe before composing any model or
  // tool runtime. Missing/malformed bootstrap input simply leaves BioGym
  // unavailable; it is never recovered from argv or process.env.
  const bioGymBridge = await consumeBioGymPrivateBootstrap()
  const handle = await startLocalRuntimeServe({
    ...parsed.options,
    ...(bioGymBridge ? { bioGymBridge } : {})
  })
  const info = handle.runtime.info()
  const startupInfo = {
    service: 'kun',
    mode: 'serve',
    host: handle.host,
    port: handle.port,
    configPath: info.configPath,
    dataDir: info.dataDir,
    model: info.model,
    approvalPolicy: info.approvalPolicy,
    sandboxMode: info.sandboxMode,
    insecure: info.insecure,
    startedAt: info.startedAt,
    pid: info.pid,
    message: `SciForge Runtime listening on http://${handle.host}:${handle.port}`
  }
  process.stdout.write(`${KUN_READY_PREFIX}${JSON.stringify(startupInfo)}\n`)
  process.stdout.write(JSON.stringify(startupInfo, null, 2) + '\n')
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000)
    const stop = () => {
      clearInterval(keepAlive)
      void handle.close().finally(resolve)
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
  return ServeExitCode.ok
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = splitLocalRuntimeCliCommand(argv)
  if (command.command === 'help') {
    if (command.error) {
      process.stderr.write(`kun: ${command.error}\n`)
      process.stderr.write(LOCAL_RUNTIME_CLI_USAGE)
      return ServeExitCode.usage
    }
    process.stdout.write(LOCAL_RUNTIME_CLI_USAGE)
    return ServeExitCode.ok
  }
  if (command.command === 'serve') {
    return serveMain(command.args)
  }
  return runAgentCommand(command.command, command.args, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: () => process.cwd()
  })
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(code)
  },
  (error) => {
    process.stderr.write(`kun serve: ${String(error)}\n`)
    process.exit(ServeExitCode.runtime)
  }
)
