import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  startModelRouterServer,
  type ModelRouterConfig
} from '../../../../packages/workers/model-router/src/router'
import {
  ClaudeCodeRuntimeService,
  type ClaudeAgentSdk
} from './claude-code-service'

type QueryCall = {
  prompt: string | AsyncIterable<unknown>
  options?: ClaudeAgentSdkOptions
}

type CapturedProviderCall = {
  url: string
  body: Record<string, unknown>
}

type CapturedClaudeRequest = {
  path: string
  body: Record<string, unknown>
  env: NodeJS.ProcessEnv
}

function configuredModelRouterSettings(baseUrl: string) {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = baseUrl
  modelRouter.publicModelAlias = 'sciforge-router'
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
    baseUrl: 'https://text.example/v1',
    apiKey: 'text-provider-key',
    model: 'text-model',
    endpointFormat: 'chat_completions'
  }
  return modelRouter
}

function settings(input: { workspaceRoot: string; modelRouterBaseUrl: string }): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        model: '',
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: configuredModelRouterSettings(input.modelRouterBaseUrl),
    workspaceRoot: input.workspaceRoot,
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function modelRouterConfig(): ModelRouterConfig {
  return {
    defaultProfile: 'default',
    publicModelAlias: 'sciforge-router',
    runtimeApiKeyEnv: 'MODEL_ROUTER_RUNTIME_KEY',
    profiles: {
      default: {
        traceRoot: '.sciforge/model-router-traces',
        textReasoner: {
          provider: 'test-text-provider',
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'TEXT_PROVIDER_KEY',
          model: 'text-model',
          endpointFormat: 'chat_completions'
        },
        translators: {}
      }
    }
  }
}

function modelRouterEnv(): Record<string, string> {
  return {
    MODEL_ROUTER_RUNTIME_KEY: 'local-runtime-router-key',
    TEXT_PROVIDER_KEY: 'text-secret'
  }
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code model-router e2e condition.')
}

function fakeSdk(
  handler: (call: QueryCall) => SDKMessage[] | Promise<SDKMessage[]>
): { sdk: ClaudeAgentSdk; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  return {
    calls,
    sdk: {
      query: vi.fn((call: QueryCall) => {
        calls.push(call)
        return queryFromMessages(async () => handler(call))
      })
    }
  }
}

function queryFromMessages(
  messages: () => SDKMessage[] | Promise<SDKMessage[]>
): ClaudeAgentSdkQuery {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of await messages()) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        yield message
      }
    }
  } as unknown as ClaudeAgentSdkQuery
}

function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as SDKMessage
}

async function fakeClaudeSdkTurn(call: QueryCall, captured: CapturedClaudeRequest[]): Promise<SDKMessage[]> {
  const env = call.options?.env ?? {}
  const baseUrl = String(env.ANTHROPIC_BASE_URL ?? '')
  const apiKey = String(env.ANTHROPIC_API_KEY ?? '')
  const requestUrl = `${baseUrl}/v1/messages?beta=true`
  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    stream: true,
    thinking: { type: 'disabled' },
    output_config: { type: 'text' },
    system: [{ type: 'text', text: 'You are Claude Code.' }],
    tools: [{
      name: 'Bash',
      description: 'execute shell commands',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command'],
        additionalProperties: false
      }
    }],
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'Run a harmless check.' }]
    }]
  }
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  })
  captured.push({
    path: new URL(requestUrl).pathname + new URL(requestUrl).search,
    body: requestBody,
    env
  })
  if (!response.ok) throw new Error(`Fake Claude CLI request failed: ${response.status} ${await response.text()}`)
  const body = await response.text()
  const events = parseSseEvents(body)
  const text = events
    .map((event) => recordValue(event.delta))
    .filter((delta) => delta.type === 'text_delta')
    .map((delta) => String(delta.text ?? ''))
    .join('')
  return [
    sdkMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-e2e-session',
      uuid: 'claude-e2e-init',
      claude_code_version: '2.1.143',
      cwd: call.options?.cwd,
      tools: ['Bash'],
      model: call.options?.model,
      permissionMode: call.options?.permissionMode
    }),
    sdkMessage({
      type: 'assistant',
      session_id: 'claude-e2e-session',
      uuid: 'claude-e2e-assistant',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 17, output_tokens: 5 }
      }
    }),
    sdkMessage({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: text,
      usage: { input_tokens: 17, output_tokens: 5 },
      session_id: 'claude-e2e-session',
      uuid: 'claude-e2e-result'
    })
  ]
}

function parseSseEvents(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\n\n+/)
    .map((block) => block.split(/\n/).find((line) => line.startsWith('data: '))?.slice('data: '.length).trim() ?? '')
    .filter((line) => line && line !== '[DONE]')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function providerFetch(calls: CapturedProviderCall[]): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {}
    calls.push({ url: String(input), body })
    return new Response(JSON.stringify({
      id: 'chatcmpl-claude-e2e',
      object: 'chat.completion',
      created: 1,
      model: 'text-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Routed Claude request.'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 17,
        completion_tokens: 5,
        total_tokens: 22
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Claude Code runtime + Model Router e2e', () => {
  it('routes Claude Code Anthropic Messages traffic through the local Model Router', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'upstream-openai-key')
    vi.stubEnv('DEEPSEEK_API_KEY', 'upstream-deepseek-key')
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-anthropic-key')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'upstream-anthropic-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    vi.stubEnv('ANTHROPIC_MODEL', 'opus')
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'bailian/deepseek-v4-flash')

    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-workspace-'))
    await mkdir(workspaceRoot, { recursive: true })
    const providerCalls: CapturedProviderCall[] = []
    const claudeRequests: CapturedClaudeRequest[] = []
    const router = await startModelRouterServer({
      port: 0,
      config: modelRouterConfig(),
      env: modelRouterEnv(),
      workspaceRoot,
      fetchImpl: providerFetch(providerCalls)
    })
    const { sdk } = fakeSdk((call) => fakeClaudeSdkTurn(call, claudeRequests))
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings({
        workspaceRoot,
        modelRouterBaseUrl: `${router.url}/v1`
      }),
      storageRoot: await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-store-')),
      managedConfigDir: await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-config-')),
      claudeAgentSdk: sdk
    })

    try {
      const thread = await service.startThread({ workspace: workspaceRoot, title: 'Claude e2e' })
      if (!thread.ok) throw new Error(thread.message)
      const turn = await service.startTurn({
        threadId: thread.thread.id,
        text: 'Run a harmless check.',
        workspace: workspaceRoot
      })
      if (!turn.ok) throw new Error(turn.message)

      await waitUntil(async () => {
        const detail = await service.readThread(thread.thread.id)
        return detail.ok && detail.detail.latestTurnStatus === 'completed'
      })

      const detail = await service.readThread(thread.thread.id)
      if (!detail.ok) throw new Error(detail.message)
      expect(detail.detail.backendThreadId).toBe('claude-e2e-session')
      expect(detail.detail.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_message',
          text: 'Routed Claude request.'
        })
      ]))
      expect(claudeRequests).toHaveLength(1)
      expect(claudeRequests[0]?.path).toBe('/v1/messages?beta=true')
      expect(claudeRequests[0]?.body).toMatchObject({
        model: 'claude-sonnet-4-6',
        stream: true,
        thinking: { type: 'disabled' },
        output_config: { type: 'text' }
      })
      expect(claudeRequests[0]?.body.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Bash' })
      ]))
      expect(claudeRequests[0]?.env.OPENAI_API_KEY).toBeUndefined()
      expect(claudeRequests[0]?.env.DEEPSEEK_API_KEY).toBeUndefined()
      expect(claudeRequests[0]?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
      expect(claudeRequests[0]?.env.ANTHROPIC_BASE_URL).toBe(router.url)
      expect(claudeRequests[0]?.env.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
      expect(claudeRequests[0]?.env.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
      expect(claudeRequests[0]?.env.ANTHROPIC_MODEL).toBe('sonnet')
      expect(providerCalls).toHaveLength(1)
      expect(providerCalls[0]?.url).toBe('https://text.example/v1/chat/completions')
      expect(providerCalls[0]?.body.model).toBe('text-model')
      expect(providerCalls[0]?.body).not.toHaveProperty('thinking')
      expect(providerCalls[0]?.body).not.toHaveProperty('output_config')
      expect(providerCalls[0]?.body.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'Bash' })
        })
      ]))
    } finally {
      await service.stop()
      await router.close()
    }
  })
})
