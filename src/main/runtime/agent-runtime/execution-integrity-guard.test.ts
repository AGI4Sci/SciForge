import { describe, expect, it } from 'vitest'

import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'
import {
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  RuntimeExecutionIntegrityGuard,
  withExecutionIntegrityRequirement
} from './execution-integrity-guard'
import {
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY,
  withVisualExecutionRequirement
} from './visual-execution-guard'

const RUNTIME_IDS: AgentRuntimeId[] = ['sciforge', 'codex', 'claude']
const ATTESTATION = `sha256:${'b'.repeat(64)}`

describe('RuntimeExecutionIntegrityGuard', () => {
  it.each(RUNTIME_IDS)('blocks a requested execution with no receipt for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.')
    const observation = guard.observe(runtimeId, completed(runtimeId))

    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(observation.violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      verdict: 'blocked',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it.each(RUNTIME_IDS)('blocks an open tool call for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Explain the result.')
    guard.observe(runtimeId, tool(runtimeId, 'requested'))

    expect(guard.observe(runtimeId, completed(runtimeId)).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: [`${runtimeId}-call`]
    })
  })

  it.each(RUNTIME_IDS)('accepts a correlated executor success receipt for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.')
    guard.observe(runtimeId, tool(runtimeId, 'requested'))
    guard.observe(runtimeId, tool(runtimeId, 'succeeded'))

    const observation = guard.observe(runtimeId, completed(runtimeId))
    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
    expect(observation.violation).toBeUndefined()
  })

  it('does not treat a failed executor receipt as successful execution', () => {
    const guard = rememberedGuard('codex', 'Run the unit tests.')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('does not use an unrelated read receipt to satisfy a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'read_file'
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('accepts a matching write receipt for a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'apply_patch',
      toolKind: 'file_change'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it.each([
    ['Run the auto-fix command.', 'eslint --fix src'],
    ['Run rm -f temp.txt.', 'rm -f temp.txt'],
    ['Delete temp.txt.', 'rm -f temp.txt']
  ])('accepts all effects proved by one command receipt: %s', (request, command) => {
    const guard = rememberedGuard('codex', request)
    const receipt = {
      ...tool('codex', 'succeeded'),
      toolKind: 'command_execution' as const,
      meta: { arguments: { command } }
    }
    guard.observe('codex', receipt)

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('marks an affirmative claim without a receipt as unverified', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.')
    guard.observe('claude', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'answer',
      text: 'I successfully ran the command and fixed the file.'
    })

    expect(guard.observe('claude', completed('claude')).violation).toMatchObject({
      code: 'runtime_execution_claim_unverified',
      verdict: 'unverified'
    })
  })

  it('does not use an unrelated read receipt to validate a claimed file edit', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.')
    guard.observe('claude', {
      ...tool('claude', 'succeeded'),
      toolName: 'read_file'
    })
    guard.observe('claude', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'answer',
      text: 'I successfully modified the file.'
    })

    expect(guard.observe('claude', completed('claude')).violation).toMatchObject({
      code: 'runtime_execution_claim_unverified',
      verdict: 'unverified'
    })
  })

  it('allows an ordinary text-only answer with no execution obligation', () => {
    const guard = rememberedGuard('codex', 'Explain what a receipt ledger is.')
    guard.observe('codex', {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'answer',
      text: 'A receipt ledger records authoritative lifecycle facts.'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('requires attested semantic evidence for a visual obligation', () => {
    const input = withVisualExecutionRequirement(baseInput('codex', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'gui_visual_capture',
      summary: 'gui_visual_capture',
      detail: JSON.stringify({ ok: true })
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_visual_execution_missing'
    })
  })

  it('accepts an attested semantic visual result', () => {
    const input = withVisualExecutionRequirement(baseInput('sciforge', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('sciforge', input, 'sciforge-thread', 'sciforge-turn')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      toolName: 'gui_visual_capture',
      summary: 'gui_visual_capture',
      detail: JSON.stringify({
        ok: true,
        inspection: { provider: 'model-router-vision', attestation: ATTESTATION }
      })
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('does not confuse child dispatch with child completion', () => {
    const guard = rememberedGuard('codex', 'Explain the task.')
    guard.observe('codex', childEvent('running'))
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['child:researcher']
    })
  })

  it('does not confuse an accepted asynchronous job with job completion', () => {
    const guard = rememberedGuard('sciforge', 'Submit the folding job.')
    guard.observe('sciforge', tool('sciforge', 'requested'))
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      meta: { output: { status: 'accepted', jobId: 'af3-job-1' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['sciforge-call']
    })
  })

  it('closes an asynchronous command launch when a later poll for the same session succeeds', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-1' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-poll',
      itemId: 'bash-poll',
      meta: { arguments: { action: 'poll', session_id: 'bash-session-1' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-poll',
      itemId: 'bash-poll-result',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'bash-session-1' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('closes an asynchronous command launch when its terminal poll reports failure', () => {
    const guard = rememberedGuard('sciforge', 'Explain the command result.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-2' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-poll',
      itemId: 'bash-poll',
      meta: { arguments: { action: 'poll', session_id: 'bash-session-2' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'failed'),
      callId: 'bash-poll',
      itemId: 'bash-poll-result',
      meta: { output: { status: 'completed', exit_code: 1, session_id: 'bash-session-2' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('keeps an asynchronous launch open when a session action returns a non-terminal receipt', () => {
    const guard = rememberedGuard('sciforge', 'Explain the command state.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-3' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-write',
      itemId: 'bash-write',
      meta: { arguments: { action: 'write', session_id: 'bash-session-3' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-write',
      itemId: 'bash-write-result',
      meta: { output: { status: 'running', exit_code: null, session_id: 'bash-session-3' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: expect.arrayContaining(['bash-run', 'bash-write'])
    })
  })

  it('correlates a terminal poll across tool names by the shared async handle', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'launch',
      itemId: 'launch',
      toolName: 'exec_command',
      meta: { output: { status: 'running', session_id: 'session-a' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'poll',
      itemId: 'poll',
      toolName: 'write_stdin',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'session-a' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('does not correlate same-tool terminal receipts from different async handles', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'launch-a',
      itemId: 'launch-a',
      meta: { output: { status: 'running', session_id: 'session-a' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'terminal-b',
      itemId: 'terminal-b',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'session-b' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['launch-a']
    })
  })

  it('reconstructs only marked policy turns during replay', () => {
    const guarded = withExecutionIntegrityRequirement(baseInput('claude', 'Run the checks.'))
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.observe('claude', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'user',
      text: guarded.text
    })
    expect(guard.observe('claude', completed('claude')).violation).toBeDefined()

    const oldHistory = new RuntimeExecutionIntegrityGuard()
    oldHistory.observe('claude', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-old-turn',
      itemId: 'old-user',
      text: 'Run the checks.'
    })
    expect(oldHistory.observe('claude', {
      ...completed('claude'),
      turnId: 'claude-old-turn'
    }).violation).toBeUndefined()
  })

  it('emits a replayed violation only once while keeping completion failed', () => {
    const guarded = withExecutionIntegrityRequirement(baseInput('codex', 'Run the checks.'))
    const guard = new RuntimeExecutionIntegrityGuard()
    const userEvent: AgentRuntimeEvent = {
      kind: 'user_message',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'user',
      text: guarded.text
    }
    guard.observe('codex', userEvent)
    expect(guard.observe('codex', completed('codex')).violation).toBeDefined()
    guard.observe('codex', userEvent)
    const replayed = guard.observe('codex', completed('codex'))
    expect(replayed.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(replayed.violation).toBeUndefined()
  })

  it('fails closed on conflicting terminal receipts for the same call', () => {
    const guard = rememberedGuard('codex', 'Run the checks.')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'succeeded'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('handles a bounded batch of concurrent receipts deterministically', () => {
    const guard = rememberedGuard('codex', 'Run the checks.')
    for (let index = 0; index < 100; index += 1) {
      const callId = `call-${index}`
      guard.observe('codex', { ...tool('codex', 'requested'), callId, itemId: callId })
    }
    for (let index = 99; index >= 0; index -= 1) {
      const callId = `call-${index}`
      guard.observe('codex', { ...tool('codex', 'succeeded'), callId, itemId: `${callId}-result` })
    }
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })
})

describe('execution integrity input policy', () => {
  it('detects direct Chinese execution requests without relying on ASCII word boundaries', () => {
    const input = baseInput('codex', '支持，帮我修改这个文件。')
    const guarded = withExecutionIntegrityRequirement(input)
    expect(guarded.text).toContain('"effectClass":"local_write"')
  })

  it('does not let an English safety prohibition broaden a read-only check into a write', () => {
    const input = baseInput('sciforge', 'Do not edit or write files. Run the existing read-only checks and report the result.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('"effectClass":"command_execution"')
    expect(guarded.text).not.toContain('"effectClass":"local_write"')
  })

  it('does not let a Chinese safety prohibition broaden a command request into a write', () => {
    const input = baseInput('sciforge', '不要修改或删除文件，只运行现有检查并报告结果。')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('"effectClass":"command_execution"')
    expect(guarded.text).not.toContain('"effectClass":"local_write"')
  })

  it('does not create an execution obligation from a prohibition alone', () => {
    const input = baseInput('codex', 'Do not open, copy, execute, or display any protected data. Explain the prior failure.')
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it.each([
    ['Do not edit, but run the tests.', '"effectClass":"command_execution"'],
    ['Do not open protected data, only read public.txt.', 'requested-execution'],
    ['不要修改，但是运行测试。', '"effectClass":"command_execution"']
  ])('keeps an affirmative action after a negated clause: %s', (text, marker) => {
    expect(withExecutionIntegrityRequirement(baseInput('sciforge', text)).text).toContain(marker)
  })

  it('does not treat an action token in a status label as a write request', () => {
    const input = baseInput(
      'sciforge',
      'You are reviewing a POST-FIX acceptance run. Do not edit artifacts. Read the files and verify their hashes.'
    )
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('requested-execution')
    expect(guarded.text).not.toContain('"effectClass":"local_write"')
  })

  it.each([
    'Explain the POST-FIX acceptance report.',
    'Run 8c50d482 failed. Explain why.',
    'Run history shows the prior failure. Summarize it.',
    'Fix is a status label. Explain it.',
    'Read-only mode is enabled. Explain it.',
    'Create Loop is open. Describe the UI.',
    'Delete operation failed. Explain it.',
    'Update job succeeded.',
    'Publish task failed.',
    'Patch failed validation.',
    '运行已失败，请解释。',
    '创建 Loop 已完成。',
    '发布任务失败。'
  ])('does not create an obligation from an action token used only in a status label: %s', (text) => {
    const input = baseInput('sciforge', text)
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it.each([
    'Explain why you must fix the file.',
    'Tell me whether I should delete the file.',
    '解释为什么我们必须修改这个文件。'
  ])('does not treat a subordinate action mention as the requested root action: %s', (text) => {
    const input = baseInput('sciforge', text)
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it.each([
    'Explain why I should read the file and then delete it.',
    'Tell me whether I should run tests and also publish the result.'
  ])('ignores coordinated actions inside a non-execution subordinate clause: %s', (text) => {
    const input = baseInput('sciforge', text)
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it.each([
    ['We need to run the tests.', '"effectClass":"command_execution"'],
    ['I need to edit the file.', '"effectClass":"local_write"'],
    ['Could you please run the tests?', '"effectClass":"command_execution"'],
    ['Would you kindly edit the file?', '"effectClass":"local_write"'],
    ['We need to actually run the tests.', '"effectClass":"command_execution"'],
    ['I need you to please edit the file.', '"effectClass":"local_write"'],
    ['我们需要运行测试。', '"effectClass":"command_execution"'],
    ['我们需要修改文件。', '"effectClass":"local_write"'],
    ['必须运行测试。', '"effectClass":"command_execution"'],
    ['需要修改文件。', '"effectClass":"local_write"'],
    ['请务必运行测试。', '"effectClass":"command_execution"'],
    ['请你运行测试。', '"effectClass":"command_execution"'],
    ['麻烦你修改文件。', '"effectClass":"local_write"'],
    ['你需要运行测试。', '"effectClass":"command_execution"'],
    ['请实际运行测试。', '"effectClass":"command_execution"'],
    ['重新运行测试。', '"effectClass":"command_execution"'],
    ['请你务必运行测试。', '"effectClass":"command_execution"'],
    ['麻烦你重新运行测试。', '"effectClass":"command_execution"'],
    ['我需要你实际修改文件。', '"effectClass":"local_write"'],
    ['Task: run the tests.', '"effectClass":"command_execution"'],
    ['Please do the following: edit the file.', '"effectClass":"local_write"']
  ])('recognizes a root action request with an explicit subject: %s', (text, marker) => {
    expect(withExecutionIntegrityRequirement(baseInput('codex', text)).text).toContain(marker)
  })

  it.each([
    'The docs say: run the tests.',
    'Explain this example: delete the file.'
  ])('does not promote a quoted colon suffix into an execution request: %s', (text) => {
    const input = baseInput('codex', text)
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it.each([
    'Fix the file and run the tests.',
    'Please patch the module.',
    '请修改这个文件。',
    'Create a local summary for the issue.',
    'Update the local report about the ticket.',
    'Delete the cached message file.',
    'Create a file describing the pull request.',
    '创建一份关于议题的本地报告。',
    '更新关于工单的本地笔记。'
  ])('preserves a real local write request: %s', (text) => {
    expect(withExecutionIntegrityRequirement(baseInput('codex', text)).text)
      .toContain('"effectClass":"local_write"')
  })

  it('classifies a command whose name mentions a write effect by its requested root action', () => {
    expect(withExecutionIntegrityRequirement(baseInput('codex', 'Run the auto-fix command.')).text)
      .toContain('"effectClass":"command_execution"')
  })

  it('accepts a successful Dataset MCP receipt for a conversational Dataset execution request', () => {
    const request = '执行一次纯对话 Dataset 准备验收，只调用 dataset_prepare_plan 并等待确认。'
    const guarded = withExecutionIntegrityRequirement(baseInput('codex', request))
    expect(guarded.text).toContain('"kind":"any_success"')
    expect(guarded.text).not.toContain('"effectClass":"command_execution"')

    const guard = rememberedGuard('codex', request)
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'dataset_prepare_plan'
    })
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('unwraps a successful local-runtime mcp_call receipt for a Dataset plan write', () => {
    const request = '只创建一个未确认的数据准备草案。'
    const guarded = withExecutionIntegrityRequirement(baseInput('sciforge', request))
    expect(guarded.text).toContain('"effectClass":"local_write"')

    const guard = rememberedGuard('sciforge', request)
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      toolName: 'mcp_call',
      meta: { arguments: { toolId: 'dataset_api/dataset_prepare_plan' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      toolName: 'mcp_call',
      meta: {
        output: {
          serverId: 'dataset_api',
          toolName: 'dataset_prepare_plan',
          toolId: 'dataset_api/dataset_prepare_plan'
        }
      }
    })
    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('treats publishing a prepared dataset locally as a local write', () => {
    const request = '发布准备好的数据集。'
    const guarded = withExecutionIntegrityRequirement(baseInput('sciforge', request))
    expect(guarded.text).toContain('"effectClass":"local_write"')

    const guard = rememberedGuard('sciforge', request)
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      toolName: 'mcp_call',
      meta: { output: { toolName: 'dataset_publish' } }
    })
    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('keeps publishing a dataset to a remote repository as an external mutation', () => {
    expect(withExecutionIntegrityRequirement(baseInput(
      'sciforge',
      'Publish the dataset to a remote Hugging Face repository.'
    )).text).toContain('"effectClass":"external_mutation"')
  })

  it.each([
    ['Open an issue.', 'open_issue'],
    ['Create a pull request.', 'create_pull_request'],
    ['Create a message.', 'create_message'],
    ['Delete the issue.', 'delete_issue'],
    ['Update the ticket.', 'update_ticket']
  ])('accepts a matching external mutation receipt: %s', (request, toolName) => {
    const guard = rememberedGuard('codex', request)
    guard.observe('codex', { ...tool('codex', 'succeeded'), toolName })
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it.each([
    'delete_file',
    'delete_file_for_issue'
  ])('does not accept a local file deletion for an external issue deletion: %s', (toolName) => {
    const guard = rememberedGuard('codex', 'Delete the issue.')
    guard.observe('codex', { ...tool('codex', 'succeeded'), toolName })
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it.each([
    ['Publish the release.', 'github_search_issues'],
    ['Submit the job.', 'github_list_jobs']
  ])('does not accept an unrelated provider read for an external mutation: %s', (request, toolName) => {
    const guard = rememberedGuard('codex', request)
    guard.observe('codex', { ...tool('codex', 'succeeded'), toolName })
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it.each([
    ['Deploy the app.', 'npm run deploy'],
    ['Deploy the app.', 'kubectl apply -f deploy.yaml'],
    ['Deploy the app.', 'kubectl apply -n production -f deploy.yaml'],
    ['Publish the image.', 'docker push example/image:latest'],
    ['Publish the release.', 'git -C repo push origin main']
  ])('accepts an external mutation performed by an explicit command: %s', (request, command) => {
    const guard = rememberedGuard('codex', request)
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolKind: 'command_execution',
      meta: { arguments: { command } }
    })
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it.each([
    ['Publish the release.', 'git push --dry-run origin main'],
    ['Publish the release.', 'git push -n origin main'],
    ['Publish the package.', 'npm publish --dry-run'],
    ['Deploy the app.', 'kubectl apply --dry-run=client -f deploy.yaml']
  ])('does not accept a dry-run command as an external mutation: %s', (request, command) => {
    const guard = rememberedGuard('codex', request)
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolKind: 'command_execution',
      meta: { arguments: { command } }
    })
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('injects a replay marker for explicit execution while preserving display text', () => {
    const input = baseInput('codex', 'Run the unit tests.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('Runtime-enforced execution integrity gate:')
    expect(guarded.displayText).toBe(input.displayText)
    expect(guarded.metadata?.[EXECUTION_INTEGRITY_POLICY_METADATA_KEY]).toBe('execution-integrity.v1')
  })

  it('adds no prompt or metadata overhead to a text-only turn', () => {
    const input = baseInput('claude', 'Explain this algorithm.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toBe(input.text)
    expect(guarded).toEqual(input)
  })

  it('preserves the visual obligation in the unified policy', () => {
    const input = baseInput('sciforge', 'Inspect the layout.')
    input.metadata = { [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true }
    expect(withExecutionIntegrityRequirement(input).text).toContain('visual_inspection')
  })
})

function rememberedGuard(runtimeId: AgentRuntimeId, text: string): RuntimeExecutionIntegrityGuard {
  const guard = new RuntimeExecutionIntegrityGuard()
  guard.rememberTurn(runtimeId, withExecutionIntegrityRequirement(baseInput(runtimeId, text)), `${runtimeId}-thread`, `${runtimeId}-turn`)
  return guard
}

function baseInput(runtimeId: AgentRuntimeId, text: string): AgentRuntimeTurnStartInput {
  return {
    runtimeId,
    threadId: `${runtimeId}-thread`,
    text,
    displayText: text
  }
}

function completed(runtimeId: AgentRuntimeId): AgentRuntimeEvent {
  return {
    kind: 'turn_lifecycle',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    state: 'completed'
  }
}

function tool(
  runtimeId: AgentRuntimeId,
  phase: 'requested' | 'succeeded' | 'failed'
): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  return {
    kind: 'tool_event',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    itemId: `${runtimeId}-call`,
    callId: `${runtimeId}-call`,
    toolName: 'local_shell',
    status: phase === 'requested' ? 'running' : phase === 'succeeded' ? 'success' : 'error',
    phase,
    factSource: phase === 'requested' ? 'model_output' : 'executor_result',
    evidenceStrength: phase === 'requested' ? 'intent' : 'executor_receipt'
  }
}

function childEvent(status: 'running' | 'completed'): AgentRuntimeEvent {
  return {
    kind: 'child_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'codex-turn',
    child: {
      runtimeId: 'codex',
      parentThreadId: 'codex-thread',
      parentTurnId: 'codex-turn',
      id: 'researcher',
      kind: 'agent',
      status
    }
  }
}
