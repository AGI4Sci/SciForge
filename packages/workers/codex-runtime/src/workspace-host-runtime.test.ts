import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  WorkspaceHostOperationError,
  type WorkspaceHostPayload
} from '@sciforge/domain-sdk/workspace-host'

import type {
  CodexAppServerClientEvent,
  CodexAppServerInputItem,
  CodexAppServerJsonRpcClient,
  CodexAppServerJsonRpcClientOptions,
  CodexAppServerPendingRequest
} from './app-server/index.js'
import {
  createCodexWorkspaceHostRuntime,
  type CodexWorkspaceHostRuntime
} from './workspace-host-runtime.js'
import { RuntimeEventStore } from './runtime-event-store.js'
import {
  boundRuntimeEventPayload,
  decodeRuntimeToolArtifactRef
} from './runtime-payload-boundary.js'

const temporaryDirectories: string[] = []
const runtimes: CodexWorkspaceHostRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('CodexWorkspaceHostRuntime', () => {
  it('runs Codex beside the workspace and replays sequenced AgentRuntime events', async () => {
    const root = await temporaryWorkspace()
    await mkdir(join(root, 'papers'), { recursive: true })
    await mkdir(join(root, 'figures'), { recursive: true })
    await writeFile(join(root, 'papers', 'notes.md'), 'notes')
    await writeFile(join(root, 'papers', 'large.pdf'), '%PDF fixture')
    await writeFile(join(root, 'figures', 'cell.png'), 'image fixture')
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: (options) => {
        fake.captureOptions(options)
        return fake.client
      },
      now: () => new Date('2026-07-30T00:00:00.000Z')
    })
    runtimes.push(runtime)
    const published: Array<{ kind: string; payload: WorkspaceHostPayload }> = []
    const context = runtimeContext(root, {
      publishEvent(kind, payload) {
        published.push({ kind, payload })
      },
      environment: scopedProxyEnvironment(43100)
    })

    await invoke(runtime, context, 'connect')
    const capabilities = record(await invoke(runtime, context, 'capabilities'))
    assert.equal(capabilities.runtimeId, 'codex')
    assert.equal(record(capabilities.events).replayable, true)

    await invoke(runtime, context, 'subscribeEvents', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      sinceSeq: 0
    }, 'stream-1')
    const thread = record(await invoke(runtime, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      workspace: root,
      title: 'Remote work'
    }))
    assert.equal(thread.id, 'gui-thread-1')
    assert.equal(thread.backendThreadId, 'codex-thread-1')

    const turn = record(await invoke(runtime, context, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      workspace: root,
      text: 'inspect the cluster file',
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false
      },
      fileReferences: [
        {
          path: 'papers',
          relativePath: 'papers',
          name: 'papers',
          kind: 'directory'
        },
        {
          path: 'papers/notes.md',
          relativePath: 'papers/notes.md',
          name: 'notes.md',
          kind: 'text',
          mimeType: 'text/markdown'
        },
        {
          path: 'papers/large.pdf',
          relativePath: 'papers/large.pdf',
          name: 'large.pdf',
          kind: 'pdf',
          mimeType: 'application/pdf'
        },
        {
          path: 'figures/cell.png',
          relativePath: 'figures/cell.png',
          name: 'cell.png',
          kind: 'image',
          mimeType: 'image/png'
        }
      ]
    }))
    assert.equal(turn.turnId, 'turn-1')
    assert.deepEqual(fake.startTurns[0]?.outputSchema, {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
      additionalProperties: false
    })
    const turnInputs = fake.startTurns[0]?.input ?? []
    assert.deepEqual(turnInputs[0], {
      type: 'text',
      text: 'inspect the cluster file',
      text_elements: []
    })
    assert.equal(turnInputs[1]?.type, 'text')
    if (turnInputs[1]?.type !== 'text') assert.fail('Expected workspace reference context text.')
    assert.match(turnInputs[1].text, /"relativePath":"papers"/u)
    assert.match(turnInputs[1].text, /"relativePath":"papers\/notes\.md"/u)
    assert.match(turnInputs[1].text, /"relativePath":"papers\/large\.pdf"/u)
    assert.deepEqual(turnInputs[2], {
      type: 'localImage',
      path: join(root, 'figures', 'cell.png')
    })
    assert.equal(turnInputs.some((item) => item.type === 'mention'), false)
    assert.equal(
      record(fake.options?.env).HTTPS_PROXY,
      scopedProxyEnvironment(43100).HTTPS_PROXY
    )
    assert.equal(
      record(fake.options?.env).SCIFORGE_RUNTIME_API_KEY,
      TEST_MODEL_ACCESS.authorization.token
    )
    assert.equal(record(fake.options?.env).OPENAI_API_KEY, undefined)
    assert.equal(record(fake.options?.env).CODEX_HOME, join(stateDirectory, 'codex-home'))
    const config = await readFile(join(stateDirectory, 'codex-home', 'config.toml'), 'utf8')
    assert.match(config, /model_provider = "sciforge-model-router"/)
    assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:43999\/v1"/)
    assert.doesNotMatch(config, new RegExp(TEST_MODEL_ACCESS.authorization.token))

    fake.events.push({
      type: 'event',
      channel: 'codex:event',
      payload: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'remote answer'
        }
      }
    })
    await waitFor(() => published.some(({ payload }) =>
      record(record(payload).event).kind === 'assistant_delta'
    ))

    const commandOutput = 'x'.repeat(20_000)
    fake.events.push({
      type: 'event',
      channel: 'codex:event',
      payload: {
        method: 'item/started',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'command-1',
          item: {
            id: 'command-1',
            type: 'commandExecution',
            command: 'npm test'
          }
        }
      }
    })
    fake.events.push({
      type: 'event',
      channel: 'codex:event',
      payload: {
        method: 'item/completed',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'command-1',
          item: {
            id: 'command-1',
            type: 'commandExecution',
            command: 'npm test',
            aggregatedOutput: commandOutput
          }
        }
      }
    })
    await waitFor(() => published.some(({ payload }) => {
      const event = record(record(payload).event)
      return event.kind === 'item_snapshot' && record(event.item).id === 'command-1'
    }))
    const page = record(await invoke(runtime, context, 'readThreadPage', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      limit: 1
    }))
    const command = array(record(array(page.turns)[0]).items)
      .map(record)
      .find((item) => item.id === 'command-1')
    assert.equal(
      array(record(array(page.turns)[0]).items)
        .map(record)
        .filter((item) => item.id === 'command-1').length,
      1
    )
    assert.equal(String(command?.detail).length, 4_096)
    assert.equal(record(command?.detailArtifact).size, commandOutput.length)

    const replay = record(await runtime.replayEvents({
      contractVersion: 1,
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      sinceSeq: 0,
      streamId: 'stream-1'
    }, context))
    const replayedEvents = array(replay.events).map(record)
    assert.deepEqual(
      replayedEvents.map((event) => event.seq),
      replayedEvents.map((_event, index) => index + 1)
    )
    assert.ok(replayedEvents.some((event) => event.kind === 'user_message'))
    assert.ok(replayedEvents.some((event) => event.kind === 'assistant_delta'))
    assert.ok(published.every(({ kind }) => kind === WORKSPACE_HOST_EVENT_KINDS.runtimeEvent))
  })

  it('reconciles a provider terminal turn that was missed before worker restart', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-recovery-')
    const first = fakeCodexClient()
    const runtime1 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => first.client
    })
    runtimes.push(runtime1)
    const context = runtimeContext(root)
    await invoke(runtime1, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-recovered',
      workspace: root,
      title: 'Recovered turn'
    })
    await invoke(runtime1, context, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'gui-thread-recovered',
      workspace: root,
      text: 'finish before restart'
    })
    await runtime1.dispose()

    const second = fakeCodexClient()
    second.client.readThread = async (input) => {
      second.reads.push(input)
      return {
        thread: {
          id: input.threadId,
          name: 'Recovered turn',
          turns: [{ id: 'turn-1', status: 'completed' }]
        }
      }
    }
    const runtime2 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => second.client
    })
    runtimes.push(runtime2)
    await invoke(runtime2, context, 'subscribeEvents', {
      runtimeId: 'codex',
      threadId: 'gui-thread-recovered',
      sinceSeq: 0
    }, 'stream-recovered')

    const replay = record(await runtime2.replayEvents({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      threadId: 'gui-thread-recovered',
      sinceSeq: 0,
      streamId: 'stream-recovered'
    }, context))
    const events = array(replay.events).map(record)
    assert.deepEqual(second.reads.at(-1), {
      threadId: 'codex-thread-1',
      includeTurns: true
    })
    assert.ok(events.some((event) =>
      event.kind === 'turn_lifecycle' &&
      event.turnId === 'turn-1' &&
      event.state === 'completed'
    ))
  })

  it('reads bounded status, cursor pages, tool artifacts, and replay deltas', async () => {
    const root = await temporaryWorkspace()
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory: await temporaryDirectory('sciforge-remote-codex-state-'),
      createClient: () => fake.client
    })
    runtimes.push(runtime)
    const context = runtimeContext(root)
    await invoke(runtime, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-paged',
      workspace: root
    })

    const largeDetail = '详'.repeat(20_000)
    for (let index = 1; index <= 3; index += 1) {
      const turnId = `turn-${index}`
      await invoke(runtime, context, 'publishSyntheticEvent', {
        threadId: 'gui-thread-paged',
        turnId,
        itemId: `user-${index}`,
        kind: 'user_message',
        text: `question ${index}`
      })
      await invoke(runtime, context, 'publishSyntheticEvent', {
        threadId: 'gui-thread-paged',
        turnId,
        kind: 'turn_lifecycle',
        state: 'started'
      })
      await invoke(runtime, context, 'publishSyntheticEvent', {
        threadId: 'gui-thread-paged',
        turnId,
        itemId: `tool-${index}`,
        kind: 'item_snapshot',
        item: {
          id: `tool-${index}`,
          turnId,
          kind: 'tool',
          summary: `tool ${index}`,
          status: 'completed',
          detail: index === 1 ? largeDetail : `detail ${index}`
        }
      })
      await invoke(runtime, context, 'publishSyntheticEvent', {
        threadId: 'gui-thread-paged',
        turnId,
        kind: 'turn_lifecycle',
        state: 'completed'
      })
    }

    const status = record(await invoke(runtime, context, 'readThreadStatus', {
      runtimeId: 'codex',
      threadId: 'gui-thread-paged'
    }))
    assert.equal(fake.reads.at(-1)?.includeTurns, false)
    assert.equal(status.latestTurnId, 'turn-3')
    assert.equal(status.latestTurnStatus, 'completed')
    assert.equal('hasUserMessage' in status, false)
    assert.equal(Object.hasOwn(status, 'turns'), false)
    assert.equal(Object.hasOwn(status, 'items'), false)

    const recentPage = record(await invoke(runtime, context, 'readThreadPage', {
      runtimeId: 'codex',
      threadId: 'gui-thread-paged',
      limit: 2
    }))
    assert.deepEqual(array(recentPage.turns).map((turn) => record(turn).id), [
      'turn-2',
      'turn-3'
    ])
    assert.equal(typeof recentPage.nextCursor, 'string')
    assert.equal(recentPage.latestSeq, status.latestSeq)

    const olderPage = record(await invoke(runtime, context, 'readThreadPage', {
      runtimeId: 'codex',
      threadId: 'gui-thread-paged',
      cursor: recentPage.nextCursor,
      limit: 2
    }))
    assert.deepEqual(array(olderPage.turns).map((turn) => record(turn).id), ['turn-1'])
    assert.equal(olderPage.nextCursor, null)
    const tool = array(record(array(olderPage.turns)[0]).items)
      .map(record)
      .find((item) => item.id === 'tool-1')
    assert.ok(Buffer.byteLength(String(tool?.detail), 'utf8') <= 4_096)
    const artifactRef = record(tool?.detailArtifact)
    assert.equal(artifactRef.size, Buffer.byteLength(largeDetail, 'utf8'))

    const artifact = record(await invoke(runtime, context, 'readToolArtifact', {
      runtimeId: 'codex',
      threadId: 'gui-thread-paged',
      ref: artifactRef.ref
    }))
    assert.equal(artifact.content, largeDetail)
    assert.equal(artifact.size, Buffer.byteLength(largeDetail, 'utf8'))

    const latestSeq = Number(status.latestSeq)
    await invoke(runtime, context, 'publishSyntheticEvent', {
      threadId: 'gui-thread-paged',
      turnId: 'turn-3',
      kind: 'runtime_status',
      phase: 'idle'
    })
    const replay = record(await runtime.replayEvents({
      contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      runtimeId: 'codex',
      threadId: 'gui-thread-paged',
      sinceSeq: latestSeq
    }, context))
    assert.deepEqual(array(replay.events).map((event) => record(event).seq), [latestSeq + 1])
  })

  it('publishes fail-closed approval and user-input requests and resolves them', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: (options) => {
        fake.captureOptions(options)
        return fake.client
      }
    })
    runtimes.push(runtime)
    const published: WorkspaceHostPayload[] = []
    const context = runtimeContext(root, {
      publishEvent(_kind, payload) {
        published.push(payload)
      }
    })

    await invoke(runtime, context, 'connect')
    await invoke(runtime, context, 'subscribeEvents', {
      runtimeId: 'codex',
      threadId: 'thread-1'
    }, 'stream-1')
    fake.pending?.({
      requestId: 41,
      method: 'item/commandExecution/requestApproval',
      kind: 'approval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      summary: 'Command approval requested',
      params: {}
    })
    fake.pending?.({
      requestId: 42,
      method: 'item/tool/requestUserInput',
      kind: 'user_input',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'input-1',
      summary: 'User input requested',
      params: {
        questions: [{
          id: 'confirm',
          header: 'Confirm',
          question: 'Continue?',
          options: [{ label: 'Yes' }]
        }]
      }
    })

    assert.deepEqual(
      published.map((payload) => record(record(payload).event).kind),
      ['approval_requested', 'user_input_requested']
    )

    await invoke(runtime, context, 'resolveApproval', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: '41',
      decision: 'allowed'
    })
    await invoke(runtime, context, 'resolveUserInput', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: '42',
      answers: [{ id: 'confirm', value: 'Yes' }]
    })

    assert.deepEqual(fake.approvals, [{
      requestId: 41,
      decision: 'allowed'
    }])
    assert.deepEqual(fake.userInputs, [{
      requestId: 42,
      answers: [{ id: 'confirm', value: 'Yes' }],
      status: 'submitted'
    }])
  })

  it('interrupts the backend thread through the canonical app-server client', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => fake.client
    })
    runtimes.push(runtime)
    const context = runtimeContext(root)

    await invoke(runtime, context, 'interruptTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    assert.deepEqual(fake.interruptions, [{
      threadId: 'thread-1',
      turnId: 'turn-1'
    }])
  })

  it('discards a client whose turn/start acknowledgement fails and reconnects for the next turn', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const first = fakeCodexClient()
    const second = fakeCodexClient()
    const clients = [first, second]
    let clientIndex = 0
    first.client.startTurn = async (input) => {
      first.startTurns.push(input)
      throw new Error('Codex app-server did not acknowledge turn/start within 20 ms.')
    }
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => clients[clientIndex++]!.client
    })
    runtimes.push(runtime)
    const context = runtimeContext(root)

    await assert.rejects(
      invoke(runtime, context, 'startTurn', {
        runtimeId: 'codex',
        threadId: 'thread-1',
        workspace: root,
        text: 'first attempt'
      }),
      /did not acknowledge turn\/start/u
    )
    assert.equal(first.startTurns.length, 1)
    assert.equal(first.stopCount, 1)

    const recovered = record(await invoke(runtime, context, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspace: root,
      text: 'retry with a fresh client'
    }))
    assert.equal(recovered.turnId, 'turn-1')
    assert.equal(second.startTurns.length, 1)
    assert.equal(clientIndex, 2)
  })

  it('rotates scoped egress and model access without retaining stale credentials', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const clients = [
      fakeCodexClient(),
      fakeCodexClient(),
      fakeCodexClient(),
      fakeCodexClient()
    ]
    let clientIndex = 0
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      environment: {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'must-not-leak',
        HTTPS_PROXY: 'http://old-proxy.example:8080',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-token'
      },
      createClient: (options) => {
        const fake = clients[clientIndex++]!
        fake.captureOptions(options)
        return fake.client
      }
    })
    runtimes.push(runtime)
    const context1 = runtimeContext(root, {
      environment: scopedProxyEnvironment(43101),
      processGeneration: 1,
      modelAccess: TEST_MODEL_ACCESS,
      modelGeneration: 1
    })

    await invoke(runtime, context1, 'connect')
    await invoke(runtime, context1, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspace: root,
      text: 'with network'
    })
    assert.equal(record(clients[0]!.options?.env).OPENAI_API_KEY, undefined)
    assert.equal(clients[0]!.startTurns[0]?.sandboxPolicy.networkAccess, true)

    await runtime.operationHandlers[0]!.onProcessEnvironmentChanged?.(
      scopedProxyEnvironment(43102),
      2,
      true
    )
    assert.equal(clients[0]!.stopCount, 1)
    assert.equal(
      record(clients[1]!.options?.env).HTTPS_PROXY,
      scopedProxyEnvironment(43102).HTTPS_PROXY
    )

    await runtime.operationHandlers[0]!.onProcessEnvironmentChanged?.({}, 3, false)
    assert.equal(clients[1]!.stopCount, 1)
    await invoke(runtime, runtimeContext(root, {
      processGeneration: 3,
      modelAccess: TEST_MODEL_ACCESS,
      modelGeneration: 1
    }), 'startTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspace: root,
      text: 'without network'
    })
    assert.equal(record(clients[2]!.options?.env).HTTPS_PROXY, undefined)
    assert.equal(clients[2]!.startTurns[0]?.sandboxPolicy.networkAccess, false)

    const nextModelAccess = {
      ...TEST_MODEL_ACCESS,
      authorization: {
        scheme: 'bearer' as const,
        token: 'scoped-model-token-rotated-123456789'
      }
    }
    await runtime.operationHandlers[0]!.onModelAccessChanged?.(
      nextModelAccess,
      2,
      true
    )
    assert.equal(clients[2]!.stopCount, 1)
    assert.equal(
      record(clients[3]!.options?.env).SCIFORGE_RUNTIME_API_KEY,
      nextModelAccess.authorization.token
    )
    assert.notEqual(
      record(clients[3]!.options?.env).SCIFORGE_RUNTIME_API_KEY,
      TEST_MODEL_ACCESS.authorization.token
    )

    await runtime.operationHandlers[0]!.onModelAccessChanged?.(
      undefined,
      3,
      false
    )
    assert.equal(clients[3]!.stopCount, 1)
    const unavailableContext = runtimeContext(root, {
      processGeneration: 3,
      modelGeneration: 3,
      modelAccess: undefined
    })
    const unavailableCapabilities = record(
      await invoke(runtime, unavailableContext, 'capabilities')
    )
    assert.equal(unavailableCapabilities.ready, false)
    assert.equal(
      record(record(unavailableCapabilities.matrix).nativeHistory).available,
      false
    )
    await assert.rejects(
      invoke(runtime, unavailableContext, 'connect'),
      (error: unknown) =>
        error instanceof WorkspaceHostOperationError &&
        error.code === 'model-access-unavailable' &&
        /scoped Model Router access/i.test(error.message)
    )
  })

  it('restores GUI-to-Codex thread bindings from private atomic state', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const first = fakeCodexClient()
    const runtime1 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => first.client
    })
    const context = runtimeContext(root)
    await invoke(runtime1, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-persisted',
      workspace: root,
      title: 'Persisted'
    })
    await runtime1.dispose()

    const second = fakeCodexClient()
    const runtime2 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => second.client
    })
    runtimes.push(runtime2)
    const thread = record(await invoke(runtime2, context, 'readThreadStatus', {
      runtimeId: 'codex',
      threadId: 'gui-thread-persisted'
    }))

    assert.equal(second.reads[0]?.threadId, 'codex-thread-1')
    assert.equal(thread.id, 'gui-thread-persisted')
    const persisted = JSON.parse(
      await readFile(join(stateDirectory, 'thread-bindings.json'), 'utf8')
    ) as { workspaceRoot: string; threads: unknown[] }
    assert.equal(persisted.workspaceRoot, root)
    assert.equal(persisted.threads.length, 1)
  })
})

describe('RuntimeEventStore', () => {
  it('keeps canonical history, replay deltas, pages, and artifacts beyond 10k events', async () => {
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-events-')
    const threadId = 'thread-long-lived'
    const detail = 'persisted-output-'.repeat(2_000)
    const first = await RuntimeEventStore.create(stateDirectory)
    for (let index = 1; index <= 10_020; index += 1) {
      first.append(threadId, {
        kind: 'item_snapshot',
        turnId: `turn-${index}`,
        itemId: `tool-${index}`,
        item: {
          id: `tool-${index}`,
          turnId: `turn-${index}`,
          kind: 'tool',
          status: 'completed',
          detail: index === 1 ? detail : `result ${index}`
        }
      }, '2026-08-09T00:00:00.000Z')
    }
    await first.flush()

    const reloaded = await RuntimeEventStore.create(stateDirectory)
    const summary = await reloaded.summary(threadId)
    assert.equal(summary?.latestSeq, 10_020)
    assert.equal(summary?.latestTurnId, 'turn-10020')

    const replay = await reloaded.readSince(threadId, 10_000)
    assert.deepEqual(replay.map((event) => event.seq), [
      10_001, 10_002, 10_003, 10_004, 10_005,
      10_006, 10_007, 10_008, 10_009, 10_010,
      10_011, 10_012, 10_013, 10_014, 10_015,
      10_016, 10_017, 10_018, 10_019, 10_020
    ])

    let cursor = ''
    let oldestTurnId = ''
    let pageCount = 0
    do {
      const page = await reloaded.readPage(threadId, cursor, 100)
      oldestTurnId = String(page.events[0]?.turnId ?? oldestTurnId)
      cursor = page.nextCursor ?? ''
      pageCount += 1
    } while (cursor)
    assert.equal(pageCount, 101)
    assert.equal(oldestTurnId, 'turn-1')
    assert.equal(await reloaded.readLatestToolArtifact(threadId, 'tool-1'), detail)

    const eventDirectory = join(stateDirectory, 'runtime-events')
    const eventFile = (await readdir(eventDirectory))
      .find((name) => name.endsWith('.events.jsonl'))
    assert.ok(eventFile)
    const eventPath = join(eventDirectory, eventFile)
    const persistedLog = await readFile(eventPath, 'utf8')
    const firstLineEnd = persistedLog.indexOf('\n')
    await writeFile(eventPath, `{malformed-old-record}\n${persistedLog.slice(firstLineEnd + 1)}`)
    assert.equal((await reloaded.readSince(threadId, 10_000)).length, 20)
    await assert.rejects(reloaded.readSince(threadId, 0), /invalid JSON/)
  })

  it('bounds pages within a single long turn by records and raw bytes', async () => {
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-long-turn-')
    const store = await RuntimeEventStore.create(stateDirectory)
    const threadId = 'thread-one-long-turn'
    for (let index = 1; index <= 600; index += 1) {
      store.append(threadId, {
        kind: 'assistant_delta',
        turnId: 'turn-long',
        itemId: 'assistant-1',
        text: `chunk-${index}`
      }, '2026-08-09T00:00:00.000Z')
    }
    await store.flush()

    const seen = new Set<number>()
    let cursor = ''
    do {
      const page = await store.readPage(threadId, cursor, 20)
      assert.ok(page.events.length <= 256)
      for (const event of page.events) seen.add(event.seq)
      cursor = page.nextCursor ?? ''
    } while (cursor)
    assert.equal(seen.size, 600)

    const byteBounded = await RuntimeEventStore.create(
      await temporaryDirectory('sciforge-remote-codex-byte-page-')
    )
    for (let index = 1; index <= 20; index += 1) {
      byteBounded.append(threadId, {
        kind: 'assistant_delta',
        turnId: 'turn-large',
        itemId: 'assistant-1',
        text: '界'.repeat(16_000)
      }, '2026-08-09T00:00:00.000Z')
    }
    await byteBounded.flush()
    const page = await byteBounded.readPage(threadId, '', 20)
    assert.ok(page.events.length < 10)
    assert.ok(page.nextCursor)
  })

  it('bounds every duplicated tool expansion field before serialization', () => {
    const large = '界'.repeat(20_000)
    const bounded = record(boundRuntimeEventPayload('thread-1', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      kind: 'item_snapshot',
      item: {
        id: 'tool-1',
        kind: 'tool',
        detail: large,
        arguments: { prompt: large },
        meta: { toolName: 'exec', output: large, arguments: { prompt: large } },
        receipt: { status: 'success', detail: large, output: { nested: large } },
        completionReceipts: [{
          receiptId: 'receipt-1',
          issuer: large,
          callId: 'tool-1',
          subjectRef: 'artifact-1',
          attestation: large
        }]
      }
    }))
    const item = record(bounded.item)
    assert.ok(Buffer.byteLength(String(item.detail), 'utf8') <= 4_096)
    assert.deepEqual(item.meta, { toolName: 'exec' })
    assert.equal(item.arguments, undefined)
    assert.equal(record(item.receipt).output, undefined)
    assert.ok(Buffer.byteLength(String(record(item.receipt).detail), 'utf8') <= 4_096)
    assert.ok(
      Buffer.byteLength(
        String(record(array(item.completionReceipts)[0]).attestation),
        'utf8'
      ) <= 128
    )
    const artifact = record(item.detailArtifact)
    assert.equal(decodeRuntimeToolArtifactRef(String(artifact.ref)), 'tool-1')
    assert.ok(Number(artifact.size) > Buffer.byteLength(large, 'utf8'))
    assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 16_384)
  })
})

function fakeCodexClient(): {
  client: CodexAppServerJsonRpcClient
  events: AsyncQueue<CodexAppServerClientEvent>
  approvals: unknown[]
  userInputs: unknown[]
  interruptions: unknown[]
  reads: Array<{ threadId: string; includeTurns?: boolean }>
  startTurns: Array<{
    sandboxPolicy: { networkAccess: boolean }
    input?: CodexAppServerInputItem[]
    outputSchema?: Record<string, unknown>
  }>
  stopCount: number
  options?: CodexAppServerJsonRpcClientOptions
  pending?: (request: CodexAppServerPendingRequest) => void
  captureOptions(options: CodexAppServerJsonRpcClientOptions): void
} {
  const events = new AsyncQueue<CodexAppServerClientEvent>()
  const approvals: unknown[] = []
  const userInputs: unknown[] = []
  const interruptions: unknown[] = []
  const reads: Array<{ threadId: string; includeTurns?: boolean }> = []
  const startTurns: Array<{
    sandboxPolicy: { networkAccess: boolean }
    input?: CodexAppServerInputItem[]
    outputSchema?: Record<string, unknown>
  }> = []
  const state: ReturnType<typeof fakeCodexClient> = {
    events,
    approvals,
    userInputs,
    interruptions,
    reads,
    startTurns,
    stopCount: 0,
    captureOptions(options) {
      state.options = options
      const pending = options.pendingServerRequests
      if (pending && !(typeof pending === 'object' && 'handle' in pending)) {
        state.pending = pending.onPendingRequest
      }
    },
    client: {
      connect: async () => ({
        userAgent: 'codex-test',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'linux'
      }),
      subscribe: () => events,
      listThreads: async () => ({
        data: [{ id: 'codex-thread-1', name: 'Remote work' }]
      }),
      startThread: async () => ({
        thread: {
          id: 'codex-thread-1',
          name: 'Remote work',
          cwd: '/unused'
        }
      }),
      readThread: async (input: { threadId: string; includeTurns?: boolean }) => {
        reads.push(input)
        return {
          thread: { id: input.threadId, name: 'Remote work', turns: [] }
        }
      },
      startTurn: async (input: {
        sandboxPolicy: { networkAccess: boolean }
        input?: CodexAppServerInputItem[]
        outputSchema?: Record<string, unknown>
      }) => {
        startTurns.push(input)
        return {
          turn: { id: 'turn-1', userMessageItemId: 'user-1' }
        }
      },
      interruptTurn: async (input: unknown) => {
        interruptions.push(input)
      },
      steerTurn: async () => undefined,
      renameThread: async () => undefined,
      deleteThread: async () => undefined,
      resolveApproval: (input: unknown) => approvals.push(input),
      resolveUserInput: (input: unknown) => userInputs.push(input),
      stop: async () => {
        state.stopCount += 1
        events.end()
      }
    } as unknown as CodexAppServerJsonRpcClient
  }
  return state
}

async function invoke(
  runtime: CodexWorkspaceHostRuntime,
  context: {
    workspaceRoot: string
    sessionId: string
    publishEvent(kind: string, payload: WorkspaceHostPayload): unknown
    getProcessEnvironment?(): NodeJS.ProcessEnv
    getProcessEnvironmentGeneration?(): number
    isProcessNetworkEgressReady?(): boolean
    getModelAccess?(): typeof TEST_MODEL_ACCESS | undefined
    getModelAccessGeneration?(): number
    isModelAccessReady?(): boolean
  },
  method: string,
  input?: WorkspaceHostPayload,
  streamId?: string
): Promise<WorkspaceHostPayload> {
  const response = record(await runtime.invoke({
    contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    runtimeId: 'codex',
    method,
    ...(input === undefined ? {} : { input }),
    ...(streamId ? { streamId } : {})
  }, context))
  assert.equal(response.runtimeId, 'codex')
  assert.equal(response.method, method)
  return response.result as WorkspaceHostPayload
}

async function temporaryWorkspace(): Promise<string> {
  return temporaryDirectory('sciforge-remote-codex-')
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  temporaryDirectories.push(path)
  return path
}

const TEST_MODEL_ACCESS = {
  baseUrl: 'http://127.0.0.1:43999/v1',
  authorization: {
    scheme: 'bearer' as const,
    token: 'scoped-model-token-1234567890123456789'
  },
  expiresAt: '2099-01-01T00:00:00.000Z'
}

function scopedProxyEnvironment(port: number): NodeJS.ProcessEnv {
  const proxy = `http://sciforge-lease:scoped-egress-token@127.0.0.1:${port}`
  return {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy
  }
}

function runtimeContext(
  workspaceRoot: string,
  options: {
    publishEvent?(kind: string, payload: WorkspaceHostPayload): unknown
    environment?: NodeJS.ProcessEnv
    processGeneration?: number
    modelAccess?: typeof TEST_MODEL_ACCESS
    modelGeneration?: number
  } = {}
) {
  const environment = options.environment ?? {}
  const modelAccess = Object.hasOwn(options, 'modelAccess')
    ? options.modelAccess
    : TEST_MODEL_ACCESS
  return {
    workspaceRoot,
    sessionId: 'session-1',
    publishEvent: options.publishEvent ?? (() => undefined),
    getProcessEnvironment: () => environment,
    getProcessEnvironmentGeneration: () => options.processGeneration ?? 1,
    isProcessNetworkEgressReady: () =>
      Boolean(environment.HTTPS_PROXY),
    getModelAccess: () => modelAccess,
    getModelAccessGeneration: () => options.modelGeneration ?? 1,
    isModelAccessReady: () => modelAccess !== undefined
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  assert.fail('Timed out waiting for remote Codex event.')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = []
  #ended = false

  push(value: T): void {
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.#values.push(value)
  }

  end(): void {
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ done: true, value: undefined })
    }
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift()
    if (value !== undefined) return { done: false, value }
    if (this.#ended) return { done: true, value: undefined }
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}
