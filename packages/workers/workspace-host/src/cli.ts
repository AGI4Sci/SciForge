import {
  workspaceHostLifecycleModeSchema,
  workspaceNetworkEgressStateSchema
} from '@sciforge/domain-sdk/workspace-host'
import { createCodexWorkspaceHostRuntime } from '@sciforge/codex-runtime/workspace-host'

import { requireWorkspaceHostBundledCodexExecutable } from './artifact.js'
import { createWorkspaceHostDomainComposition } from './composition.js'
import {
  attachWorkspaceHostDaemon,
  defaultWorkspaceHostRuntimeDirectory,
  probeWorkspaceHostDaemon,
  runWorkspaceHostDaemon,
  startWorkspaceHostDaemon
} from './daemon.js'
import { createWorkspaceHostPreviewOperation } from './preview-service.js'
import { WorkspaceHostJsonlServer } from './server.js'
import { WorkspaceHostService } from './service.js'

await main(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `sciforge-workspace-host: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})

async function main(argv: readonly string[]): Promise<void> {
  const command = argv[2]
  switch (command) {
    case 'probe-daemon': {
      const runtimeDirectory = decodeBase64Url(
        requiredArg(argv, '--runtime-dir-base64'),
        'Runtime directory'
      )
      writeJson(await probeWorkspaceHostDaemon(runtimeDirectory))
      return
    }
    case 'start-daemon': {
      const workspaceRoot = decodeBase64Url(
        requiredArg(argv, '--workspace-root-base64'),
        'Workspace root'
      )
      const runtimeDirectory = runtimeDirectoryArg(argv)
      const entrypointPath = process.argv[1]
      if (!entrypointPath) {
        throw new Error('Workspace Host daemon entrypoint is unavailable.')
      }
      writeJson(await startWorkspaceHostDaemon({
        workspaceRoot,
        runtimeDirectory,
        entrypointPath
      }))
      return
    }
    case 'daemon': {
      const workspaceRoot = decodeBase64Url(
        requiredArg(argv, '--workspace-root-base64'),
        'Workspace root'
      )
      await runWorkspaceHostDaemon({
        workspaceRoot,
        runtimeDirectory: runtimeDirectoryArg(argv)
      })
      return
    }
    case 'attach': {
      await attach(argv)
      return
    }
    default:
      throw new Error(
        'Usage: sciforge-workspace-host '
        + '<probe-daemon|start-daemon|daemon|attach> [options]'
      )
  }
}

async function attach(argv: readonly string[]): Promise<void> {
  assertArtifactPlatform()
  const workspaceRoot = decodeBase64Url(
    requiredArg(argv, '--workspace-root-base64'),
    'Workspace root'
  )
  const lifecycleMode = workspaceHostLifecycleModeSchema.parse(
    optionalArg(argv, '--lifecycle-mode') ?? 'connection-session'
  )
  if (lifecycleMode === 'persistent-daemon') {
    await attachWorkspaceHostDaemon({
      workspaceRoot,
      runtimeDirectory: runtimeDirectoryArg(argv),
      input: process.stdin,
      output: process.stdout
    })
    return
  }

  const egressMode = optionalArg(argv, '--egress-mode') ?? 'none'
  const egressStatus = optionalArg(argv, '--egress-status')
    ?? (egressMode === 'none' ? 'disabled' : 'unavailable')
  const egressState = workspaceNetworkEgressStateSchema.parse({
    mode: egressMode,
    status: egressStatus
  })
  const codexExecutable = await requireWorkspaceHostBundledCodexExecutable(
    import.meta.dirname
  )
  const composition = createWorkspaceHostDomainComposition({
    log(entry) {
      process.stderr.write(`[workspace-server:${entry.level}] ${entry.message}\n`)
    }
  })
  try {
    const previewOperation = createWorkspaceHostPreviewOperation(
      composition.contributions
    )
    const codexRuntime = await createCodexWorkspaceHostRuntime({
      workspaceRoot,
      command: codexExecutable
    })
    try {
      const service = await WorkspaceHostService.create({
        workspaceRoot,
        lifecycleMode,
        lifecycleReason: 'Server is owned by the authenticated SSH attachment.',
        operationHandlers: [
          ...codexRuntime.operationHandlers,
          ...(previewOperation ? [previewOperation] : [])
        ]
      })
      const server = new WorkspaceHostJsonlServer({
        service,
        input: process.stdin,
        output: process.stdout,
        contributions: composition.cohorts,
        egressState,
        disposeServiceOnClose: true
      })
      await server.run()
    } finally {
      await codexRuntime.dispose()
    }
  } finally {
    composition.dispose()
  }
}

function runtimeDirectoryArg(argv: readonly string[]): string {
  const encoded = optionalArg(argv, '--runtime-dir-base64')
  return encoded
    ? decodeBase64Url(encoded, 'Runtime directory')
    : defaultWorkspaceHostRuntimeDirectory()
}

function assertArtifactPlatform(): void {
  if (
    (process.platform !== 'linux' || process.arch !== 'x64')
    && process.env.SCIFORGE_WORKSPACE_HOST_ALLOW_UNSUPPORTED_PLATFORM !== '1'
  ) {
    throw new Error('This Workspace Host artifact supports Linux x64 only.')
  }
}

function requiredArg(argv: readonly string[], flag: string): string {
  const value = optionalArg(argv, flag)
  if (!value) throw new Error(`Missing required ${flag}.`)
  return value
}

function optionalArg(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`)
  }
  return value
}

function decodeBase64Url(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must use unpadded base64url encoding.`)
  }
  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) {
    throw new Error(`${label} base64url encoding is not canonical.`)
  }
  const path = decoded.toString('utf8')
  if (!path || path.includes('\0')) {
    throw new Error(`${label} is invalid.`)
  }
  return path
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
