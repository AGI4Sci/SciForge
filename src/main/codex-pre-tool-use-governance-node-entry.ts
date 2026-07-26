import {
  CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV,
  CodexPreToolUseGovernanceBridge,
  codexPreToolUseFailureClosedOutput,
  parseCodexPreToolUseHookInput
} from './runtime/codex/codex-pre-tool-use-governance'
import {
  CODEX_PRE_TOOL_USE_WORKER_ARG,
  codexPreToolUseChallengeOutput,
  superviseCodexPreToolUseWorker
} from './runtime/codex/codex-pre-tool-use-hook'

const MAX_HOOK_INPUT_BYTES = 1024 * 1024

void main()

async function main(): Promise<void> {
  if (!process.argv.includes(CODEX_PRE_TOOL_USE_WORKER_ARG)) {
    return runSupervisor()
  }
  return runWorker()
}

async function runSupervisor(): Promise<void> {
  try {
    const entryPath = process.argv[1]
    if (!entryPath) {
      return writeOutput(codexPreToolUseFailureClosedOutput(
        'SciForge hook launcher entry is unavailable.'
      ))
    }
    const inputJson = await readBoundedStdin(MAX_HOOK_INPUT_BYTES)
    writeOutput(await superviseCodexPreToolUseWorker({
      executablePath: process.execPath,
      entryPath,
      inputJson
    }))
  } catch (error) {
    writeOutput(codexPreToolUseFailureClosedOutput(
      error instanceof Error ? error.message : String(error)
    ))
  }
}

async function runWorker(): Promise<void> {
  try {
    const storageRoot =
      process.env[CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV]?.trim()
    const input = parseCodexPreToolUseHookInput(
      JSON.parse(await readBoundedStdin(MAX_HOOK_INPUT_BYTES))
    )
    if (!storageRoot || !input) {
      return writeOutput(codexPreToolUseFailureClosedOutput(
        'SciForge hook configuration or input is invalid.'
      ))
    }
    const challenge = codexPreToolUseChallengeOutput(input)
    if (challenge) return writeOutput(challenge)
    const bridge = new CodexPreToolUseGovernanceBridge({
      storageRoot
    })
    writeOutput(await bridge.evaluate(input))
  } catch (error) {
    writeOutput(codexPreToolUseFailureClosedOutput(
      error instanceof Error ? error.message : String(error)
    ))
  }
}

async function readBoundedStdin(limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > limit) throw new Error('Codex hook input exceeds the size limit.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeOutput(output: unknown): void {
  process.stdout.write(`${JSON.stringify(output)}\n`)
}
