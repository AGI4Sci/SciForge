import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  CreateThreadRequest,
  ThreadSchema,
  ThreadSummarySchema,
  ThreadGoalSchema,
  ThreadTodoListSchema,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  RuntimeEvent,
  StartTurnRequest,
  UsageSnapshotSchema,
  AttachmentUploadRequest,
  MemoryRecord,
  LocalRuntimeErrorBody,
  LocalRuntimeCapabilitiesConfig,
  RuntimeCapabilityManifest,
  buildRuntimeCapabilityManifest,
  emptyUsageSnapshot,
  type RuntimeEvent as RuntimeEventType
} from '../src/contracts/index.js'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig
} from '../src/loop/model-context-profile.js'
import {
  parseServeOptionsSafe,
  parseServeOptions,
  validateServeOptions,
  SERVE_USAGE,
  ServeExitCode
} from '../src/cli/serve.js'
import { RuntimeTuningConfigSchema } from '../src/config/kun-config.js'

describe('contracts', () => {
  it('round-trips a thread creation payload through zod', () => {
    const parsed = CreateThreadRequest.parse({
      title: 'demo',
      workspace: '/tmp/ws',
      model: 'deepseek-chat'
    })
    expect(parsed.title).toBe('demo')
    expect(parsed.mode).toBe('agent')
  })

  it('accepts thread goal contracts and events', () => {
    const goal = ThreadGoalSchema.parse({
      threadId: 'thr_1',
      objective: 'ship goal mode',
      status: 'active',
      tokenBudget: 1000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    })
    expect(goal.objective).toBe('ship goal mode')
    expect(SetThreadGoalRequest.parse({ status: 'paused' }).status).toBe('paused')
    const event = RuntimeEvent.parse({
      kind: 'goal_updated',
      seq: 1,
      timestamp: '2026-06-03T00:00:01.000Z',
      threadId: 'thr_1',
      goal
    })
    expect(event.kind).toBe('goal_updated')
  })

  it('accepts thread todo contracts and events', () => {
    const todos = ThreadTodoListSchema.parse({
      threadId: 'thr_1',
      updatedAt: '2026-06-03T00:00:00.000Z',
      items: [{
        id: 'todo_1',
        content: 'Implement todo panel',
        status: 'in_progress',
        source: {
          kind: 'plan',
          planId: 'plan_1',
          relativePath: '.sciforge/plan/plan.md',
          ordinal: 0,
          contentHash: 'abc'
        },
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }]
    })
    expect(todos.items[0]?.source?.kind).toBe('plan')
    expect(SetThreadTodosRequest.parse({
      todos: [{ content: 'Done', status: 'completed' }]
    }).todos[0]?.status).toBe('completed')
    expect(SetThreadTodosRequest.safeParse({
      todos: [
        { content: 'one', status: 'in_progress' },
        { content: 'two', status: 'in_progress' }
      ]
    }).success).toBe(false)
    const event = RuntimeEvent.parse({
      kind: 'todos_updated',
      seq: 2,
      timestamp: '2026-06-03T00:00:01.000Z',
      threadId: 'thr_1',
      todos
    })
    expect(event.kind).toBe('todos_updated')
  })

  it('accepts GUI plan metadata on thread records and summaries', () => {
    const thread = ThreadSchema.parse({
      id: 'thr_plan',
      title: 'Plan thread',
      workspace: '/tmp/ws',
      model: 'deepseek-chat',
      mode: 'agent',
      status: 'idle',
      relation: 'primary',
      guiPlan: {
        operation: 'draft',
        workspaceRoot: '/tmp/ws',
        relativePath: '.sciforge/plan/auth.md',
        planId: '/tmp/ws:.sciforge/plan/auth.md',
        sourceRequest: 'Add auth',
        title: 'Auth'
      },
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z',
      turns: []
    })
    const summary = ThreadSummarySchema.parse(thread)
    expect(summary.guiPlan?.relativePath).toBe('.sciforge/plan/auth.md')

    const invalid = ThreadSchema.safeParse({
      ...thread,
      guiPlan: {
        ...thread.guiPlan,
        relativePath: '.sciforge/plan/nested/auth.md'
      }
    })
    expect(invalid.success).toBe(false)
  })

  it('rejects invalid start turn payloads', () => {
    const result = StartTurnRequest.safeParse({ prompt: '' })
    expect(result.success).toBe(false)
  })

  it('accepts per-turn reasoning effort on start turn payloads', () => {
    const parsed = StartTurnRequest.parse({
      prompt: 'Compare the approaches',
      model: 'auto',
      reasoningEffort: 'max'
    })
    expect(parsed.reasoningEffort).toBe('max')
  })

  it('accepts a remote target id on start turn payloads', () => {
    const parsed = StartTurnRequest.parse({
      prompt: 'Run on the remote machine',
      remoteTargetId: ' gpu-a '
    })
    expect(parsed.remoteTargetId).toBe('gpu-a')
  })

  it('accepts per-turn tool allow-lists on start turn payloads', () => {
    const parsed = StartTurnRequest.parse({
      prompt: 'Run the bounded experiment',
      allowedToolNames: ['bash', 'read'],
      strictAllowedToolNames: true,
      bashCommandPolicy: {
        allowPatterns: ['^python3 - <<'],
        denyPatterns: ['\\bls\\b']
      },
      filePathPolicy: {
        allowPaths: ['/tmp/allowed.py'],
        denyPatterns: ['\\.h5ad$']
      }
    })
    expect(parsed.allowedToolNames).toEqual(['bash', 'read'])
    expect(parsed.strictAllowedToolNames).toBe(true)
    expect(parsed.bashCommandPolicy?.denyPatterns).toEqual(['\\bls\\b'])
    expect(parsed.filePathPolicy?.allowPaths).toEqual(['/tmp/allowed.py'])
  })

  it('rejects invalid bash command policy regexes', () => {
    const result = StartTurnRequest.safeParse({
      prompt: 'Run the bounded experiment',
      bashCommandPolicy: {
        allowPatterns: ['[']
      }
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid file path policy regexes', () => {
    const result = StartTurnRequest.safeParse({
      prompt: 'Patch the bounded artifact',
      filePathPolicy: {
        allowPatterns: ['[']
      }
    })
    expect(result.success).toBe(false)
  })

  it('accepts turn failure lifecycle messages', () => {
    const event = RuntimeEvent.parse({
      kind: 'turn_failed',
      seq: 1,
      timestamp: '2026-06-03T00:00:01.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      message: 'model stream exploded'
    })
    expect(event).toMatchObject({
      kind: 'turn_failed',
      message: 'model stream exploded'
    })
  })

  it('accepts GUI plan context on start turn payloads', () => {
    const parsed = StartTurnRequest.parse({
      prompt: 'Plan auth',
      displayText: 'Generate implementation plan',
      guiPlan: {
        operation: 'draft',
        workspaceRoot: '/tmp/ws',
        relativePath: '.sciforge/plan/auth.md',
        planId: '/tmp/ws:.sciforge/plan/auth.md',
        sourceRequest: 'Add auth',
        title: 'Auth'
      }
    })
    expect(parsed.guiPlan?.relativePath).toBe('.sciforge/plan/auth.md')
    expect(parsed.displayText).toBe('Generate implementation plan')
  })

  it('rejects unsafe GUI plan context paths on start turn payloads', () => {
    const result = StartTurnRequest.safeParse({
      prompt: 'Plan auth',
      guiPlan: {
        operation: 'draft',
        workspaceRoot: '/tmp/ws',
        relativePath: '.sciforge/plan/nested/auth.md',
        planId: 'plan_bad'
      }
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-canonical GUI plan context paths on start turn payloads', () => {
    for (const relativePath of ['.sciforge/plan/nested/auth.md', '.legacy/plan/auth.md']) {
      const result = StartTurnRequest.safeParse({
        prompt: 'Plan auth',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/tmp/ws',
          relativePath,
          planId: 'plan_bad'
        }
      })
      expect(result.success).toBe(false)
    }
  })

  it('produces a deterministic empty usage snapshot', () => {
    const usage = emptyUsageSnapshot()
    expect(usage.cacheHitRate).toBeNull()
    expect(usage.totalTokens).toBe(0)
  })

  it('parses usage with cache metrics', () => {
    const usage = UsageSnapshotSchema.parse({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 60,
      cacheHitTokens: 40,
      cacheMissTokens: 60,
      cacheHitRate: 0.4,
      turns: 1
    })
    expect(usage.cacheHitRate).toBeCloseTo(0.4)
  })

  it('accepts the canonical lifecycle runtime events', () => {
    const samples: RuntimeEventType[] = [
      {
        kind: 'thread_created',
        seq: 1,
        timestamp: '2025-01-01T00:00:00.000Z',
        threadId: 'thr_1',
        title: 'demo'
      },
      {
        kind: 'turn_started',
        seq: 2,
        timestamp: '2025-01-01T00:00:01.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1'
      },
      {
        kind: 'usage',
        seq: 3,
        timestamp: '2025-01-01T00:00:02.000Z',
        threadId: 'thr_1',
        usage: emptyUsageSnapshot()
      },
      {
        kind: 'heartbeat',
        seq: 4,
        timestamp: '2025-01-01T00:00:03.000Z',
        threadId: 'thr_1'
      }
    ]
    for (const sample of samples) {
      const parsed = RuntimeEvent.parse(sample)
      expect(parsed.kind).toBe(sample.kind)
    }
  })

  it('accepts extension contracts for attachments, memory, child events, and structured errors', () => {
    expect(AttachmentUploadRequest.parse({
      name: 'shot.png',
      mimeType: 'image/png',
      dataBase64: 'abcd',
      textFallback: {
        dataBase64: 'abcd',
        mimeType: 'image/webp',
        byteSize: 3,
        width: 1,
        height: 1,
        wasCompressed: true
      },
      threadId: 'thr_1'
    }).textFallback?.mimeType).toBe('image/webp')

    expect(MemoryRecord.parse({
      id: 'mem_1',
      content: 'Use pnpm',
      scope: 'workspace',
      workspace: '/tmp/ws',
      tags: ['frontend'],
      confidence: 0.9,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }).tags).toEqual(['frontend'])

    const child = RuntimeEvent.parse({
      kind: 'turn_completed',
      seq: 10,
      timestamp: '2026-06-03T00:00:00.000Z',
      threadId: 'thr_1',
      turnId: 'turn_1',
      child: {
        parentThreadId: 'thr_1',
        parentTurnId: 'turn_1',
        childId: 'child_1',
        childLabel: 'research',
        childStatus: 'completed',
        childSeq: 1
      }
    })
    expect(child.child?.childId).toBe('child_1')

    expect(LocalRuntimeErrorBody.parse({
      code: 'model_modality_unsupported',
      message: 'model does not support image input'
    }).code).toBe('model_modality_unsupported')
  })
})

describe('cli', () => {
  it('rejects the obsolete ambiguous execution threshold field', () => {
    expect(() => RuntimeTuningConfigSchema.parse({
      executionGovernance: { threshold: 4 }
    })).toThrow(/Unrecognized key/)
  })

  it('defaults serve provider to the local model router and ignores legacy direct-provider env defaults', () => {
    const parsed = parseServeOptions(['--data-dir', '/tmp/ca'], {
      DEEPSEEK_API_KEY: 'deepseek-env-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/beta',
      KUN_BASE_URL: 'https://direct-provider.example/v1',
      SCIFORGE_MODEL_ROUTER_BASE_URL: 'http://localhost:4892/v1',
      SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: 'local-router-key'
    })

    expect(parsed.modelRouterBaseUrl).toBe('http://localhost:4892/v1')
    expect(parsed.model).toBe('sciforge-router')
    expect(parsed.apiKey).toBe('local-router-key')
  })

  it('parses serve options with the canonical flags', () => {
    const parsed = parseServeOptions([
      '--host',
      '127.0.0.1',
      '--port',
      '8787',
      '--data-dir',
      '/tmp/ca',
      '--runtime-token',
      'abc',
      '--model-router-base-url',
      'http://127.0.0.1:4892/v1',
      '--model',
      'deepseek-chat',
      '--approval-policy',
      'auto',
      '--sandbox-mode',
      'workspace-write',
      '--token-economy',
      '--model-stream-idle-timeout-ms',
      '180000',
      '--insecure'
    ])
    expect(parsed.host).toBe('127.0.0.1')
    expect(parsed.port).toBe(8787)
    expect(parsed.tokenEconomyMode).toBe(true)
    expect(parsed.tokenEconomy?.enabled).toBe(true)
    expect(parsed.insecure).toBe(true)
    expect(parsed.modelRouterBaseUrl).toBe('http://127.0.0.1:4892/v1')
    expect(parsed.runtime?.modelStreamIdleTimeoutMs).toBe(180_000)
  })

  it('parses flags in --key=value form', () => {
    const parsed = parseServeOptions([
      '--host=0.0.0.0',
      '--port=9090',
      '--data-dir=/srv/ca',
      '--storage-backend=file'
    ])
    expect(parsed.host).toBe('0.0.0.0')
    expect(parsed.port).toBe(9090)
    expect(parsed.dataDir).toBe('/srv/ca')
    expect(parsed.storage.backend).toBe('file')
  })

  it('loads serve and context compaction settings from an explicit config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-config-'))
    try {
      const configPath = join(dir, 'local-runtime.config.json')
      await writeFile(configPath, JSON.stringify({
        serve: {
          host: '0.0.0.0',
          port: 7777,
          dataDir: join(dir, 'data'),
          model: 'deepseek-v4-flash',
          approvalPolicy: 'auto',
          tokenEconomy: {
            enabled: true,
            compressToolDescriptions: false,
            compressToolResults: true,
            conciseResponses: false,
            historyHygiene: {
              maxToolResultLines: 120,
              maxToolResultBytes: 16384,
              maxToolResultTokens: 4000,
              maxToolArgumentStringBytes: 4096,
              maxToolArgumentStringTokens: 1000,
              maxArrayItems: 40
            }
          },
          storage: {
            backend: 'hybrid',
            sqlitePath: join(dir, 'data', 'index.sqlite3')
          }
        },
        contextCompaction: {
          defaultSoftThreshold: 32_000,
          defaultHardThreshold: 48_000,
          summaryMode: 'model',
          summaryTimeoutMs: 15_000,
          summaryMaxTokens: 1_200,
          summaryInputMaxBytes: 98_304
        },
        models: {
          profiles: {
            'custom-1m': {
              aliases: ['vendor/custom-1m'],
              contextWindowTokens: 1_000_000,
              contextCompaction: {
                softRatio: 0.7,
                hardRatio: 0.85
              },
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: false,
              messageParts: ['text', 'image_url']
            }
          }
        },
        runtime: {
          modelStreamIdleTimeoutMs: 120_000,
          maxTurnModelSteps: 128,
          executionGovernance: {
            enabled: true,
            windowSize: 5,
            exactRepeatThreshold: 4,
            semanticFailureThreshold: 3
          },
          toolArgumentRepair: {
            maxStringBytes: 4096
          },
          toolBudget: {
            enabled: true,
            profiles: {
              explanation: { softLimit: 2, hardLimit: 5, maxAutomaticPhases: 1, totalLimit: 5 },
              review: { softLimit: 8, hardLimit: 16, maxAutomaticPhases: 1, totalLimit: 16 },
              implementation: { softLimit: 16, hardLimit: 32, maxAutomaticPhases: 1, totalLimit: 32 },
              long: { softLimit: 16, hardLimit: 16, maxAutomaticPhases: 3, totalLimit: 48 }
            }
          },
          parallelism: {
            localReadOnly: 8,
            networkMcp: 4
          }
        },
        capabilities: {
          web: {
            enabled: true,
            fetchEnabled: true,
            searchEnabled: false,
            provider: 'test'
          },
          skills: {
            enabled: true,
            roots: ['/tmp/skills']
          }
        }
      }), 'utf8')

      const parsed = parseServeOptions([
        '--config',
        configPath,
        '--model',
        'deepseek-v4-pro'
      ], {
        KUN_PORT: '9091'
      })

      expect(parsed.configPath).toBe(configPath)
      expect(parsed.host).toBe('0.0.0.0')
      expect(parsed.port).toBe(9091)
      expect(parsed.model).toBe('deepseek-v4-pro')
      expect(parsed.approvalPolicy).toBe('auto')
      expect(parsed.tokenEconomyMode).toBe(true)
      expect(parsed.tokenEconomy).toMatchObject({
        enabled: true,
        compressToolDescriptions: false,
        compressToolResults: true,
        conciseResponses: false,
        historyHygiene: {
          maxToolResultLines: 120,
          maxToolResultBytes: 16384,
          maxToolResultTokens: 4000,
          maxToolArgumentStringBytes: 4096,
          maxToolArgumentStringTokens: 1000,
          maxArrayItems: 40
        }
      })
      expect(parsed.storage).toEqual({
        backend: 'hybrid',
        sqlitePath: join(dir, 'data', 'index.sqlite3')
      })
      expect(parsed.contextCompaction?.defaultSoftThreshold).toBe(32_000)
      expect(parsed.contextCompaction?.summaryMode).toBe('model')
      expect(parsed.contextCompaction?.summaryTimeoutMs).toBe(15_000)
      expect(parsed.contextCompaction?.summaryMaxTokens).toBe(1_200)
      expect(parsed.contextCompaction?.summaryInputMaxBytes).toBe(98_304)
      expect(parsed.models?.profiles?.['custom-1m']?.contextCompaction?.softRatio).toBe(0.7)
      expect(parsed.models?.profiles?.['custom-1m']?.inputModalities).toEqual(['text', 'image'])
      expect(parsed.runtime?.executionGovernance?.windowSize).toBe(5)
      expect(parsed.runtime?.executionGovernance?.exactRepeatThreshold).toBe(4)
      expect(parsed.runtime?.executionGovernance?.semanticFailureThreshold).toBe(3)
      expect(parsed.runtime?.toolArgumentRepair?.maxStringBytes).toBe(4096)
      expect(parsed.runtime?.toolBudget?.profiles?.review).toEqual({
        softLimit: 8,
        hardLimit: 16,
        maxAutomaticPhases: 1,
        totalLimit: 16
      })
      expect(parsed.runtime?.parallelism).toEqual({ localReadOnly: 8, networkMcp: 4 })
      expect(parsed.runtime?.modelStreamIdleTimeoutMs).toBe(120_000)
      expect(parsed.runtime?.maxTurnModelSteps).toBe(128)
      expect(parsed.capabilities.web.enabled).toBe(true)
      expect(parsed.capabilities.web.fetchEnabled).toBe(true)
      expect(parsed.capabilities.skills.roots).toEqual(['/tmp/skills'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails loudly for unsupported context compaction scorer overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-config-'))
    try {
      const configPath = join(dir, 'local-runtime.config.json')
      await writeFile(configPath, JSON.stringify({
        serve: {
          dataDir: join(dir, 'data')
        },
        contextCompaction: {
          summaryMode: 'heuristic',
          summaryScorer: 'custom'
        }
      }), 'utf8')

      expect(() => parseServeOptions(['--config', configPath]))
        .toThrow(/summaryScorer/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('normalizes capability config to disabled defaults', () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({})
    expect(config.mcp.enabled).toBe(false)
    expect(config.mcp.search.enabled).toBe(false)
    expect(config.mcp.search.mode).toBe('auto')
    expect(config.web.enabled).toBe(false)
    expect(config.skills.enabled).toBe(false)
    expect(config.subagents.maxParallel).toBe(2)
    expect(config.subagents.maxChildRuns).toBe(16)
    expect(config.attachments.allowedMimeTypes).toContain('image/png')
    expect(config.attachments.textFallbackMaxBase64Bytes).toBe(512 * 1024)
    expect(config.attachments.textFallbackMaxImageDimension).toBe(1280)
    expect(config.attachments.textFallbackPreferredMimeType).toBe('image/webp')
    expect(config.memory.scopes).toEqual(['user', 'workspace', 'project'])
  })

  it('ignores legacy subagent step-limit config fields', () => {
    const config = LocalRuntimeCapabilitiesConfig.parse({
      subagents: {
        enabled: true,
        maxParallel: 2,
        maxChildRuns: 16,
        defaultStepLimit: 99
      }
    })

    expect(config.subagents).toMatchObject({
      enabled: true,
      maxParallel: 2,
      maxChildRuns: 16
    })
    expect('defaultStepLimit' in config.subagents).toBe(false)
  })

  it('resolves model capability fields from configured profiles', () => {
    const profiles = modelContextProfilesFromConfig({
      models: {
        profiles: {
          'vision-model': {
            contextWindowTokens: 128_000,
            contextCompaction: {
              softRatio: 0.7,
              hardRatio: 0.8
            },
            inputModalities: ['text', 'image'],
            supportsToolCalling: false,
            messageParts: ['text', 'image_url']
          }
        }
      }
    })
    const model = modelCapabilitiesForModel('vision-model', profiles)

    expect(model.contextWindowTokens).toBe(128_000)
    expect(model.inputModalities).toEqual(['text', 'image'])
    expect(model.supportsToolCalling).toBe(false)
    expect(model.messageParts).toEqual(['text', 'image_url'])
  })

  it('ignores legacy contextCompaction model profiles', () => {
    const profiles = modelContextProfilesFromConfig({
      contextCompaction: {
        modelProfiles: {
          'legacy-model': {
            contextWindowTokens: 64_000,
            softThreshold: 48_000,
            hardThreshold: 56_000
          }
        }
      }
    } as never)
    const model = modelCapabilitiesForModel('legacy-model', profiles)
    const legacy = profiles.find((profile) => profile.canonicalModel === 'legacy-model')

    expect(model.contextWindowTokens).toBeUndefined()
    expect(legacy).toBeUndefined()
  })

  it('rejects legacy contextCompaction model profile config files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-config-legacy-model-profiles-'))
    try {
      const configPath = join(dir, 'local-runtime.config.json')
      await writeFile(configPath, JSON.stringify({
        contextCompaction: {
          modelProfiles: {
            'legacy-model': {
              contextWindowTokens: 64_000
            }
          }
        }
      }), 'utf8')

      expect(() => parseServeOptions(['--config', configPath])).toThrow(/modelProfiles/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects flat per-profile context compaction thresholds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-config-flat-model-profile-'))
    try {
      const configPath = join(dir, 'local-runtime.config.json')
      await writeFile(configPath, JSON.stringify({
        models: {
          profiles: {
            'flat-model': {
              contextWindowTokens: 64_000,
              softThreshold: 48_000,
              hardThreshold: 56_000
            }
          }
        }
      }), 'utf8')

      expect(() => parseServeOptions(['--config', configPath])).toThrow(/softThreshold/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses 980k as the built-in DeepSeek v4 soft compaction threshold', () => {
    const profile = modelContextProfilesFromConfig()
      .find((candidate) => candidate.canonicalModel === 'deepseek-v4-pro')
    const routerProfile = modelContextProfilesFromConfig()
      .find((candidate) => candidate.modelIds.includes('sciforge-router'))

    expect(profile?.contextWindowTokens).toBe(1_000_000)
    expect(profile?.softThreshold).toBe(980_000)
    expect(profile?.hardThreshold).toBe(990_000)
    expect(routerProfile?.canonicalModel).toBe('deepseek-v4-flash')
    expect(routerProfile?.contextWindowTokens).toBe(1_000_000)
  })

  it('keeps built-in DeepSeek v4 models and the public router alias text-only', () => {
    for (const modelId of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'sciforge-router'] as const) {
      const model = modelCapabilitiesForModel(modelId)
      expect(model.inputModalities).toEqual(['text'])
      expect(model.messageParts).toEqual(['text'])
    }
  })

  it('builds runtime capability manifests with unavailable reasons', () => {
    const manifest = RuntimeCapabilityManifest.parse(buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('deepseek-chat')
    }))
    expect(manifest.contractVersion).toBe(1)
    expect(manifest.model.inputModalities).toContain('text')
    expect(manifest.mcp.available).toBe(false)
    expect(manifest.mcp.reason).toMatch(/disabled/)
    expect(manifest.mcp.search.enabled).toBe(false)
    expect(manifest.mcp.search.active).toBe(false)
    expect(manifest.research.available).toBe(false)
    expect(manifest.research.toolName).toBe('research_search')
    expect(manifest.attachments.textFallbackMaxBase64Bytes).toBe(512 * 1024)
    expect(manifest.attachments.textFallbackMaxImageDimension).toBe(1280)
    expect(manifest.attachments.textFallbackPreferredMimeType).toBe('image/webp')
    expect(manifest.computerUse).toMatchObject({
      enabled: true,
      available: false,
      reason: 'GUI-Owl computer-use MCP server is not configured'
    })

    const enabledButMissingProvider = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('deepseek-chat'),
      config: LocalRuntimeCapabilitiesConfig.parse({
        web: { enabled: true, fetchEnabled: true, searchEnabled: true, provider: 'test' }
      })
    })
    expect(enabledButMissingProvider.web.enabled).toBe(true)
    expect(enabledButMissingProvider.web.available).toBe(false)
    expect(enabledButMissingProvider.web.reason).toMatch(/no web providers/)

    const researchEnabled = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('deepseek-chat'),
      research: {
        enabled: true,
        available: true,
        sources: ['arxiv', 'semantic_scholar'],
        maxResults: 7
      }
    })
    expect(researchEnabled.research).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'research_search',
      sources: ['arxiv', 'semantic_scholar'],
      maxResults: 7
    })

    const computerUseEnabled = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('deepseek-chat'),
      computerUse: {
        available: true
      }
    })
    expect(computerUseEnabled.computerUse).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'computer_use',
      backend: 'gui-owl',
      inputIsolation: 'host-approved',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: false
    })
  })

  it('loads config.json from the data dir when present', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-data-'))
    try {
      await writeFile(join(dataDir, 'config.json'), JSON.stringify({
        serve: {
          model: 'deepseek-v4-flash'
        },
        contextCompaction: {
          defaultSoftThreshold: 12_345,
          defaultHardThreshold: 23_456
        }
      }), 'utf8')

      const parsed = parseServeOptions(['--data-dir', dataDir])

      expect(parsed.configPath).toBe(join(dataDir, 'config.json'))
      expect(parsed.dataDir).toBe(dataDir)
      expect(parsed.modelRouterBaseUrl).toBe('http://127.0.0.1:3892/v1')
      expect(parsed.model).toBe('deepseek-v4-flash')
      expect(parsed.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
      expect(parsed.contextCompaction?.defaultHardThreshold).toBe(23_456)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects legacy direct-provider serve config fields', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-data-legacy-'))
    try {
      await writeFile(join(dataDir, 'config.json'), JSON.stringify({
        serve: {
          baseUrl: 'https://example.invalid/v1',
          endpointFormat: 'chat_completions'
        }
      }), 'utf8')

      expect(() => parseServeOptions(['--data-dir', dataDir])).toThrow(/Invalid SciForge Runtime config/)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('returns a structured error when data-dir is missing', () => {
    const result = parseServeOptionsSafe([
      '--host',
      '127.0.0.1',
      '--port',
      '8899'
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.exitCode).toBe(ServeExitCode.config)
    }
  })

  it('fails closed when a serve API key is missing', () => {
    const result = parseServeOptionsSafe([
      '--data-dir',
      '/srv/ca'
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.exitCode).toBe(ServeExitCode.config)
      expect(result.message).toMatch(/api key/i)
    }
  })

  it('validates pre-constructed options', () => {
    const parsed = validateServeOptions({
      host: '127.0.0.1',
      port: 8899,
      dataDir: '/srv/ca',
      runtimeToken: '',
      model: 'deepseek-chat',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      insecure: false
    })
    expect(parsed.port).toBe(8899)
    expect(parsed.storage.backend).toBe('hybrid')
    expect(parsed.capabilities.mcp.enabled).toBe(false)
  })

  it('exposes a usage string', () => {
    expect(SERVE_USAGE).toContain('kun serve')
  })

  it('surfaces zod issues for invalid configurations', () => {
    const result = parseServeOptionsSafe([
      '--port=abc',
      '--data-dir=/srv/ca'
    ])
    expect(result.ok).toBe(false)
  })

  it('flags unknown enum values through the schema', () => {
    const result = ApprovalPolicySchema.safeParse('mystery')
    expect(result.success).toBe(false)
  })
})
