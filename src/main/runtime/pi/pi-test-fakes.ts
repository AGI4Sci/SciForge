import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiRpcClient } from './pi-rpc-client'

/**
 * Test-only scripted fake of Pi's `--mode rpc` peer. NOT a mock of production
 * behavior: the script only speaks the verified JSONL framing (id-correlated
 * responses, LF records), so client/service tests exercise real stdio, real
 * framing and real process lifecycle against a controllable peer.
 *
 * Scenario format:
 * {
 *   crlf?: boolean                      // write records with CRLF endings
 *   commands?: { [type]: CommandSpec }  // behavior for non-prompt commands
 *   prompts?: CommandSpec[]             // consumed in order, one per prompt
 * }
 * CommandSpec = {
 *   respond?: { success?: boolean; data?: unknown; error?: string }
 *   noResponse?: boolean                // hang: exercises caller timeouts
 *   events?: Array<{ atMs?: number; record: object }>
 *   exitCode?: number; exitAfterMs?: number
 * }
 */
export type FakePiScenario = Readonly<{
  crlf?: boolean
  commands?: Readonly<Record<string, FakePiCommandSpec>>
  prompts?: readonly FakePiCommandSpec[]
}>

export type FakePiCommandSpec = Readonly<{
  respond?: Readonly<{ success?: boolean; data?: unknown; error?: string }>
  noResponse?: boolean
  /** Answer prompts by echoing the prompt text (isolation tests). */
  echo?: boolean
  events?: ReadonlyArray<{ atMs?: number; record: Readonly<Record<string, unknown>> }>
  exitCode?: number
  exitAfterMs?: number
}>

const FAKE_PI_SCRIPT = `'use strict'
const readline = require('node:readline')
const fs = require('node:fs')
const scenario = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const prompts = [...(scenario.prompts || [])]
const commands = scenario.commands || {}
const eol = scenario.crlf ? '\\r\\n' : '\\n'
function emit(record) {
  process.stdout.write(JSON.stringify(record) + eol)
}
function apply(spec, cmd) {
  if (!spec) {
    emit({ type: 'response', id: cmd.id, command: cmd.type, success: false, error: 'unscripted command' })
    return
  }
  if (!spec.noResponse) {
    const respond = spec.respond || {}
    emit({
      type: 'response',
      id: cmd.id,
      command: cmd.type,
      success: respond.success !== false,
      data: respond.data,
      error: respond.error
    })
  }
  for (const ev of spec.events || []) {
    setTimeout(() => emit(ev.record), ev.atMs || 0)
  }
  if (typeof spec.exitCode === 'number') {
    setTimeout(() => process.exit(spec.exitCode), spec.exitAfterMs == null ? 30 : spec.exitAfterMs)
  }
}
const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  let cmd
  try { cmd = JSON.parse(line) } catch { return }
  if (cmd.type === 'prompt') {
    const spec = prompts.length ? prompts.shift() : { respond: { success: false, error: 'no scripted prompt behavior' } }
    if (spec.echo) {
      // Echo mode: answer with the prompt text itself (isolation tests).
      const text = String(cmd.message || '')
      emit({ type: 'response', id: cmd.id, command: 'prompt', success: true, data: { disposition: 'started' } })
      const seq = [
        { type: 'agent_start' },
        { type: 'turn_start' },
        { type: 'message_start' },
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text, contentIndex: 0 } },
        { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } },
        { type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop', usage: { input: 1, output: 1, totalTokens: 2 } } },
        { type: 'agent_end' },
        { type: 'agent_settled', aborted: false }
      ]
      seq.forEach((rec, i) => setTimeout(() => emit(rec), i * 5))
      return
    }
    apply(spec, cmd)
    return
  }
  apply(commands[cmd.type], cmd)
})
`

export type FakePiHandle = Readonly<{
  client: PiRpcClient
  dir: string
  pid: number | undefined
}>

/** Spawn the scripted peer on the real Node executable (no cmd shim). */
export function spawnFakePi(scenario: FakePiScenario): FakePiHandle {
  const dir = mkdtempSync(join(tmpdir(), 'pi-fake-'))
  writeFileSync(join(dir, 'fake-pi.cjs'), FAKE_PI_SCRIPT)
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario))
  const child = spawn(process.execPath, [join(dir, 'fake-pi.cjs'), join(dir, 'scenario.json')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  return { client: PiRpcClient.fromChild(child), dir, pid: child.pid }
}

/** A complete scripted turn: agent_start .. agent_settled, with text deltas. */
export function turnEvents(
  text: string,
  options: { aborted?: boolean; stopReason?: string } = {}
): NonNullable<FakePiCommandSpec['events']> {
  const stopReason = options.aborted ? 'aborted' : options.stopReason ?? 'stop'
  return [
    { record: { type: 'agent_start' } },
    { record: { type: 'turn_start' } },
    { record: { type: 'message_start' } },
    { record: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text, contentIndex: 0 } } },
    {
      record: {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason }
      }
    },
    {
      record: {
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }],
          stopReason,
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18 }
        }
      }
    },
    { record: { type: 'agent_end' } },
    { record: { type: 'agent_settled', aborted: options.aborted === true } }
  ]
}
