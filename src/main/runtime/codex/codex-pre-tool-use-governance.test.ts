import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CodexPreToolUseGovernanceBridge,
  parseCodexPreToolUseHookInput,
  type CodexPreToolUseHookInput
} from './codex-pre-tool-use-governance'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CodexPreToolUseGovernanceBridge', () => {
  it.each([
    ['Bash', { command: 'python inspect.py' }],
    ['view_image', { path: '/tmp/render.png' }]
  ])('denies %s before execution while native visual proof remains pending', async (toolName, toolInput) => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })

    await expect(bridge.evaluate(hookInput(toolName, toolInput))).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_proof_chain_required')
      }
    })
  })

  it('uses the shared governor for owned visual shell policy without duplicating command matching', async () => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: false
      }
    })

    await expect(bridge.evaluate(hookInput('Bash', {
      command: 'screencapture -x /tmp/window.png'
    }))).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('owned_visual_policy_denied')
      }
    })
  })

  it('allows native visual tools and removes terminal turn state', async () => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })
    await expect(bridge.evaluate(hookInput('sciforge_capture', {
      regionRef: 'region-1'
    }))).resolves.toEqual({})

    await bridge.deleteTurnState('turn-1')
    await expect(bridge.evaluate(hookInput('Bash', {
      command: 'python inspect.py'
    }))).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_governance_unavailable'
        )
      }
    })
  })

  it('uses a path-safe opaque turn key and ignores missing snapshots', async () => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: '../turn/with/path',
      snapshot: {
        ownedVisualToolsAvailable: false,
        nativeVisualProofChainPending: false
      }
    })

    const files = await readdir(bridge.rootDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^turn-[a-f0-9]{64}\.json$/u)
    expect(files[0]).not.toContain('with')
    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'pwd' }),
      turn_id: 'missing-turn'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_governance_unavailable'
        )
      }
    })
  })

  it('uses the typed session seed before a turn snapshot exists', async () => {
    const bridge = await createBridge()
    await bridge.seedSession('session-1', {
      ownedVisualToolsAvailable: false,
      nativeVisualProofChainPending: true
    })
    await expect(bridge.evaluate(hookInput('Bash', {
      command: 'python inspect.py'
    }))).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_proof_chain_required'
        )
      }
    })

    await bridge.seedSession('session-1', {
      ownedVisualToolsAvailable: false,
      nativeVisualProofChainPending: false
    })
    await expect(bridge.evaluate(hookInput('Bash', {
      command: 'pwd'
    }))).resolves.toEqual({})
  })

  it('enforces a Host-bound tool allowlist before Codex executes native tools', async () => {
    const bridge = await createBridge()
    await bridge.seedSession('session-policy', {
      ownedVisualToolsAvailable: false,
      nativeVisualProofChainPending: false
    }, ['sciforge_discover'])

    await expect(bridge.evaluate({
      ...hookInput('sciforge_discover', {}),
      session_id: 'session-policy',
      turn_id: 'pending-turn'
    })).resolves.toEqual({})
    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'pwd' }),
      session_id: 'session-policy',
      turn_id: 'pending-turn'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('tool_policy_denied')
      }
    })

    await bridge.bindTurn({
      threadId: 'thread-policy',
      turnId: 'turn-policy',
      sessionId: 'session-policy'
    })
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-policy',
      turnId: 'turn-policy',
      snapshot: {
        ownedVisualToolsAvailable: false,
        nativeVisualProofChainPending: false
      }
    })
    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'pwd' }),
      turn_id: 'turn-policy'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('tool_policy_denied')
      }
    })
  })

  it('binds child sessions and turns to the live parent Host governance snapshot', async () => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })
    await bridge.seedSessionForGovernanceTurn(
      'child-session',
      'parent-turn'
    )

    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'python inspect.py' }),
      session_id: 'child-session',
      turn_id: 'child-not-materialized'
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_proof_chain_required'
        )
      }
    })

    await bridge.bindTurn({
      threadId: 'child-thread',
      turnId: 'child-turn',
      sessionId: 'child-session',
      governanceTurnId: 'parent-turn'
    })
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: false
      }
    })
    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'pwd' }),
      session_id: 'child-session',
      turn_id: 'child-turn'
    })).resolves.toEqual({})

    await bridge.deleteTurnState('child-turn')
    await bridge.deleteSessionSeed('child-session')
    await expect(bridge.evaluate({
      ...hookInput('Bash', { command: 'pwd' }),
      session_id: 'parent-session',
      turn_id: 'parent-turn'
    })).resolves.toEqual({})
  })

  it('blocks controls for an existing executor session when a snapshot becomes pending', async () => {
    const bridge = await createBridge()
    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: false
      }
    })
    await expect(bridge.evaluate(hookInput('write_stdin', {
      session_id: 'executor-session-1',
      chars: 'echo before-steer\n'
    }))).resolves.toEqual({})

    await bridge.updateSnapshot({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })

    for (const input of [
      hookInput('write_stdin', {
        session_id: 'executor-session-1',
        chars: 'python3 inspect_pixels.py\n'
      }),
      hookInput('write_stdin', {
        session_id: 'executor-session-1'
      }),
      hookInput('Bash', {
        action: 'write',
        session_id: 'executor-session-1',
        chars: 'python3 inspect_pixels.py\n'
      })
    ]) {
      await expect(bridge.evaluate(input)).resolves.toMatchObject({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining(
            'native_visual_proof_chain_required'
          )
        }
      })
    }

    await expect(bridge.evaluate(hookInput('Bash', {
      action: 'stop',
      session_id: 'executor-session-1'
    }))).resolves.toEqual({})
  })

  it('throws on corrupt persisted state so the hook entry can fail closed', async () => {
    const bridge = await createBridge()
    await bridge.seedSession('session-1', {
      ownedVisualToolsAvailable: false,
      nativeVisualProofChainPending: true
    })
    const file = (await readdir(bridge.rootDir))[0]
    await writeFile(join(bridge.rootDir, file), '{broken', 'utf8')

    await expect(bridge.evaluate(hookInput('Bash', {
      command: 'pwd'
    }))).rejects.toThrow()
  })
})

describe('parseCodexPreToolUseHookInput', () => {
  it('accepts the documented Codex PreToolUse shape and rejects malformed events', () => {
    expect(parseCodexPreToolUseHookInput({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: { command: 'pwd' },
      cwd: '/tmp/workspace'
    })).toMatchObject({
      hook_event_name: 'PreToolUse',
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: { command: 'pwd' },
      cwd: '/tmp/workspace'
    })
    expect(parseCodexPreToolUseHookInput({
      hook_event_name: 'PostToolUse',
      turn_id: 'turn-1'
    })).toBeNull()
    expect(parseCodexPreToolUseHookInput({
      hook_event_name: 'PreToolUse',
      turn_id: 'turn-1',
      tool_name: 'Bash',
      tool_use_id: 'call-1',
      tool_input: 'pwd'
    })).toBeNull()
  })
})

async function createBridge(): Promise<CodexPreToolUseGovernanceBridge> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'sciforge-codex-pre-tool-'))
  roots.push(storageRoot)
  return new CodexPreToolUseGovernanceBridge({ storageRoot })
}

function hookInput(
  toolName: string,
  toolInput: Record<string, unknown>
): CodexPreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'session-1',
    turn_id: 'turn-1',
    tool_name: toolName,
    tool_use_id: `call-${toolName}`,
    tool_input: toolInput,
    cwd: '/tmp/workspace'
  }
}
