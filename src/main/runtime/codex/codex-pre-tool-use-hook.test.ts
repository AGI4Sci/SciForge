import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  codexPreToolUseHooksJson,
  createCodexPreToolUseHookDefinition,
  parseCodexPreToolUseHookOutput,
  probeCodexPreToolUseHook,
  superviseCodexPreToolUseWorker
} from './codex-pre-tool-use-hook'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('Codex PreToolUse hook definition', () => {
  it('builds one app-owned hook with a structured deny fallback', () => {
    const definition = createCodexPreToolUseHookDefinition({
      codexHome: '/tmp/SciForge Codex Home',
      launch: {
        appPath: "/tmp/Sci'Forge App",
        execPath: '/usr/bin/node',
        isPackaged: false
      }
    })

    expect(definition).toMatchObject({
      sourcePath: join('/tmp/SciForge Codex Home', 'hooks.json')
    })
    expect(definition.command).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(definition.command).toContain(
      "'/tmp/Sci'\\''Forge App/out/main/codex-pre-tool-use-governance-node-entry.js'"
    )
    expect(definition.command).toContain(
      '|| { status=$?; printf'
    )
    expect(definition.command).toContain(
      '"permissionDecision":"deny"'
    )
    expect(definition.commandWindows).toContain('set "ELECTRON_RUN_AS_NODE=1"&&')
    expect(definition.commandWindows).toContain(
      'out/main/codex-pre-tool-use-governance-node-entry.js'
    )
    expect(definition.commandWindows).toContain(
      '|| echo {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"'
    )
  })

  it('uses the stable development Node runtime instead of the replaceable Electron dist', () => {
    const definition = createCodexPreToolUseHookDefinition({
      codexHome: '/tmp/codex-home',
      launch: {
        appPath: '/tmp/sciforge-app',
        execPath: '/tmp/sciforge-app/node_modules/electron/dist/Electron',
        nodeExecPath: '/opt/homebrew/bin/node',
        isPackaged: false
      }
    })

    expect(definition.command).toContain("ELECTRON_RUN_AS_NODE=1 '/opt/homebrew/bin/node'")
    expect(definition.command).not.toContain('node_modules/electron/dist/Electron')
  })

  it('serializes one matcher-free synchronous PreToolUse command for every tool', () => {
    const definition = createCodexPreToolUseHookDefinition({
      codexHome: '/tmp/codex-home',
      launch: {
        appPath: '/tmp/sciforge-app',
        execPath: '/usr/bin/node',
        isPackaged: false
      }
    })

    expect(JSON.parse(codexPreToolUseHooksJson(definition))).toEqual({
      hooks: {
        PreToolUse: [{
          hooks: [{
            type: 'command',
            command: definition.command,
            commandWindows: definition.commandWindows,
            timeout: 10,
            async: false,
            statusMessage: 'Checking SciForge visual execution policy'
          }]
        }]
      }
    })
  })
})

describe('Codex PreToolUse hook supervision', () => {
  it('forwards an exact valid worker denial', async () => {
    const entryPath = await workerFixture(`
const input = JSON.parse(await readStdin())
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'fixture-deny:' + input.tool_use_id
  }
}))
`)
    await expect(superviseCodexPreToolUseWorker({
      executablePath: process.execPath,
      entryPath,
      inputJson: JSON.stringify({ tool_use_id: 'call-1' })
    })).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'fixture-deny:call-1'
      }
    })
  })

  it.each([
    {
      name: 'non-zero exit',
      body: 'process.exitCode = 17',
      timeoutMs: 1_000,
      reason: 'exited with status 17'
    },
    {
      name: 'bad JSON',
      body: "process.stdout.write('not-json')",
      timeoutMs: 1_000,
      reason: 'returned invalid JSON'
    },
    {
      name: 'timeout',
      body: 'setTimeout(() => undefined, 10_000)',
      timeoutMs: 20,
      reason: 'timed out'
    }
  ])('turns $name into a Codex-recognized deny response', async ({
    body,
    timeoutMs,
    reason
  }) => {
    const entryPath = await workerFixture(body)
    const output = await superviseCodexPreToolUseWorker({
      executablePath: process.execPath,
      entryPath,
      inputJson: '{}',
      timeoutMs
    })

    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(reason)
      }
    })
  })

  it('turns worker startup failure into a Codex-recognized deny response', async () => {
    const root = await tempRoot()
    const output = await superviseCodexPreToolUseWorker({
      executablePath: join(root, 'missing-worker-runtime'),
      entryPath: join(root, 'missing-worker-entry.js'),
      inputJson: '{}'
    })

    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'SciForge governance worker failed'
        )
      }
    })
  })

  it('converts launcher startup failure to deny while refusing to trust the fallback', async () => {
    const root = await tempRoot()
    const definition = createCodexPreToolUseHookDefinition({
      codexHome: join(root, 'codex-home'),
      launch: {
        appPath: join(root, 'missing-app'),
        execPath: join(root, 'missing-electron'),
        isPackaged: false
      }
    })
    const result = await runShellHook(definition.command, '{}', root)

    expect(result.status).toBe(0)
    expect(parseCodexPreToolUseHookOutput(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_governance_unavailable: SciForge hook launcher failed with shell status 127'
        )
      }
    })
    await expect(probeCodexPreToolUseHook({
      definition,
      cwd: root,
      storageRoot: root
    })).rejects.toThrow(/exact deny challenge/u)
  })

  it('trust probe accepts only a denial produced by the real challenge path', async () => {
    const root = await tempRoot()
    const appPath = join(root, 'app')
    const entryPath = join(
      appPath,
      'out/main/codex-pre-tool-use-governance-node-entry.js'
    )
    await mkdir(join(appPath, 'out/main'), { recursive: true })
    await writeFile(join(appPath, 'package.json'), '{"type":"module"}\n', 'utf8')
    await writeFile(entryPath, `
const chunks = []
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'sciforge_hook_deny_challenge:' + input.tool_input.nonce
  }
}))
`, 'utf8')
    const definition = createCodexPreToolUseHookDefinition({
      codexHome: join(root, 'codex-home'),
      launch: {
        appPath,
        execPath: process.execPath,
        isPackaged: false
      }
    })

    await expect(probeCodexPreToolUseHook({
      definition,
      cwd: root,
      storageRoot: root
    })).resolves.toMatchObject({
      denied: true,
      reason: expect.stringMatching(/^sciforge_hook_deny_challenge:/u)
    })
  })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-hook-'))
  tempRoots.push(root)
  return root
}

async function workerFixture(body: string): Promise<string> {
  const root = await tempRoot()
  const entryPath = join(root, 'worker.mjs')
  await writeFile(entryPath, `
async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
${body}
`, 'utf8')
  return entryPath
}

async function runShellHook(
  command: string,
  input: string,
  cwd: string
): Promise<{ status: number | null; stdout: string }> {
  const child = spawn(command, [], {
    cwd,
    env: process.env,
    shell: true,
    stdio: 'pipe'
  })
  const stdout: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stdin.end(input)
  const status = await new Promise<number | null>((resolve) => {
    child.once('close', resolve)
  })
  return {
    status,
    stdout: Buffer.concat(stdout).toString('utf8').trim()
  }
}
