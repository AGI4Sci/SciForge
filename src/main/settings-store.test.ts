import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_CODEX_DATA_DIR,
  DEFAULT_CLAUDE_CONFIG_DIR,
  defaultAgentCapabilitySettings,
  defaultCodexRuntimeSettings,
  getAgentCapabilitySettings,
  getClaudeRuntimeSettings,
  getModelAccessSettings,
  defaultLocalRuntimeSettings,
  defaultSpeechToTextSettings,
  getCodexRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { DEFAULT_GUI_UPDATE_CHANNEL } from '../shared/gui-update'
import { JsonSettingsStore } from './settings-store'

describe('JsonSettingsStore', () => {
  it('defaults GUI updates to the stable channel for new settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.guiUpdate.channel).toBe(DEFAULT_GUI_UPDATE_CHANNEL)
    expect(loaded.activeAgentRuntime).toBe('codex')
    expect(loaded.agents.sciforge.autoStart).toBe(false)
    expect(getAgentCapabilitySettings(loaded)).toEqual(defaultAgentCapabilitySettings())
    expect(loaded.agents.sciforge.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(getCodexRuntimeSettings(loaded).codexHome).toBe(DEFAULT_CODEX_DATA_DIR)
    expect(getClaudeRuntimeSettings(loaded).configDir).toBe(DEFAULT_CLAUDE_CONFIG_DIR)
    expect(loaded.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    })
    expect(loaded.speechToText).toEqual(defaultSpeechToTextSettings())
    expect('evidenceDag' in loaded).toBe(false)
    expect(getModelAccessSettings(loaded)).toBeUndefined()
    expect(loaded.workbenchToolbar).toEqual({
      hiddenCommandIds: [],
      commandOrder: []
    })
  })

  it('persists normalized Workbench toolbar placement independently from extensions', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-toolbar-'))
    try {
      const store = new JsonSettingsStore(userDataDir)
      const saved = await store.patch({
        workbenchToolbar: {
          hiddenCommandIds: [' paper-radar.open ', 'paper-radar.open'],
          commandOrder: ['remote-ssh.open', 'missing-package.open']
        }
      })
      expect(saved.workbenchToolbar).toEqual({
        hiddenCommandIds: ['paper-radar.open'],
        commandOrder: ['remote-ssh.open', 'missing-package.open']
      })

      const reloaded = await new JsonSettingsStore(userDataDir).load()
      expect(reloaded.workbenchToolbar).toEqual(saved.workbenchToolbar)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('keeps persisted settings without an access mode in setup-required state', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({ version: 1 }),
      'utf8'
    )

    const loaded = await new JsonSettingsStore(userDataDir).load()

    expect(getModelAccessSettings(loaded)).toBeUndefined()
  })

  it.each(['sciforge', 'unknown-runtime'])('migrates persisted %s runtime selection to Codex', async (activeAgentRuntime) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    const initial = await new JsonSettingsStore(userDataDir).load()
    await writeFile(settingsPath, JSON.stringify({
      ...initial,
      activeAgentRuntime
    }), 'utf8')

    const loaded = await new JsonSettingsStore(userDataDir).load()
    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as AppSettingsV1

    expect(loaded.activeAgentRuntime).toBe('codex')
    expect(persisted.activeAgentRuntime).toBe('codex')
  })

  it('persists an explicit model access selection', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const store = new JsonSettingsStore(userDataDir)

    const selected = await store.patch({
      modelAccess: { mode: 'coding-plan', planAdapterId: 'example-plan' }
    })

    expect(getModelAccessSettings(selected)).toEqual({
      mode: 'coding-plan',
      planAdapterId: 'example-plan'
    })
  })

  it('naturally ignores obsolete domain-owned fields in persisted settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    await new JsonSettingsStore(userDataDir).load()
    const legacy = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>
    legacy.evidenceDag = { enabled: false }
    legacy.remoteExecutor = {
      enabled: true,
      defaultTargetId: 'retired-target',
      targets: [{ id: 'retired-target' }]
    }
    await writeFile(settingsPath, JSON.stringify(legacy), 'utf8')

    const loaded = await new JsonSettingsStore(userDataDir).load()

    expect('evidenceDag' in loaded).toBe(false)
    expect('remoteExecutor' in loaded).toBe(false)
  })

  it('patches shared agent capability settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const next = await store.patch({
      agentCapabilities: {
        subagents: {
          enabled: false,
          maxParallel: 3
        }
      }
    })

    expect(getAgentCapabilitySettings(next)).toEqual({
      subagents: {
        enabled: false,
        maxParallel: 3
      }
    })
    const raw = JSON.parse(await readFile(join(userDataDir, 'sciforge-settings.json'), 'utf8'))
    expect(raw.agentCapabilities).toMatchObject({
      subagents: {
        enabled: false,
        maxParallel: 3
      }
    })
  })

  it('patches the active runtime and Claude Code settings without changing SciForge settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const next = await store.patch({
      activeAgentRuntime: 'claude',
      agents: {
        claude: {
          command: 'claude',
          configDir: '/tmp/sciforge-claude',
          approvalPolicy: 'auto'
        }
      }
    })

    expect(next.activeAgentRuntime).toBe('claude')
    expect(next.agents.sciforge).toEqual(loaded.agents.sciforge)
    expect(getClaudeRuntimeSettings(next)).toEqual(expect.objectContaining({
      command: 'claude',
      configDir: '/tmp/sciforge-claude',
      approvalPolicy: 'auto'
    }))
  })

  it('patches the active runtime and Codex settings without changing SciForge settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const next = await store.patch({
      activeAgentRuntime: 'codex',
      agents: {
        codex: {
          codexHome: '/tmp/sciforge-codex',
          approvalPolicy: 'never'
        }
      }
    })

    expect(next.activeAgentRuntime).toBe('codex')
    expect(next.agents.sciforge).toEqual(loaded.agents.sciforge)
    expect(getCodexRuntimeSettings(next)).toEqual(expect.objectContaining({
      ...defaultCodexRuntimeSettings(),
      codexHome: '/tmp/sciforge-codex',
      approvalPolicy: 'never'
    }))
  })

  it('preserves persisted Codex runtime settings on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        activeAgentRuntime: 'codex',
        agents: {
          sciforge: defaultLocalRuntimeSettings(),
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome: '/tmp/persisted-codex',
            profile: 'work',
            extraArgs: ['--search']
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.activeAgentRuntime).toBe('codex')
    expect(getCodexRuntimeSettings(loaded)).toEqual(expect.objectContaining({
      codexHome: '/tmp/persisted-codex',
      profile: 'work',
      extraArgs: ['--search']
    }))
  })

  it('backfills shared agent capability settings into existing settings files', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        agents: {
          sciforge: defaultLocalRuntimeSettings()
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const raw = JSON.parse(await readFile(join(userDataDir, 'sciforge-settings.json'), 'utf8'))
    expect(raw.agentCapabilities).toEqual(defaultAgentCapabilitySettings())
  })

  it('creates a default write workspace with welcome.md', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.defaultWorkspaceRoot).toContain('.sciforge')
    expect(loaded.write.workspaces).toContain(loaded.write.defaultWorkspaceRoot)
    expect(loaded.write.inlineCompletion.enabled).toBe(true)
    expect(loaded.write.inlineCompletion.retrievalEnabled).toBe(true)
    expect(loaded.write.inlineCompletion.longCompletionEnabled).toBe(true)
    expect(loaded.modelRouter?.baseUrl).toBe('http://127.0.0.1:3892/v1')
    expect(loaded.write.inlineCompletion.longMaxTokens).toBe(256)
    expect(await readFile(join(loaded.write.defaultWorkspaceRoot, 'welcome.md'), 'utf8')).toContain('Welcome to Write')
  })

  it('generates and persists a local Model Router runtime API key on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const legacySettingsPath = join(userDataDir, 'sciforge-settings.json')
    const settingsPath = join(userDataDir, 'sciforge-settings.json')

    await writeFile(
      legacySettingsPath,
      JSON.stringify({
        version: 1,
        provider: {
          apiKey: 'sk-provider-member'
        },
        modelRouter: {
          runtimeApiKey: ''
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      modelRouter?: { runtimeApiKey?: string }
      provider?: unknown
    }

    expect(loaded.modelRouter?.runtimeApiKey).toMatch(/^local-router-/)
    expect(loaded.modelRouter?.runtimeApiKey).not.toBe('sk-provider-member')
    expect(persisted.modelRouter?.runtimeApiKey).toBe(loaded.modelRouter?.runtimeApiKey)
    expect(persisted.provider).toBeUndefined()
  })

  it('generates and persists schedule and workflow internal HTTP secrets on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')

    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        schedule: {
          internal: {
            port: 9788,
            secret: ''
          }
        },
        workflow: {
          webhookPort: 9898,
          webhookSecret: ''
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      schedule?: { internal?: { secret?: string } }
      workflow?: { webhookSecret?: string }
    }

    expect(loaded.schedule.internal.secret).toMatch(/^sciforge-schedule-internal-/)
    expect(loaded.workflow.webhookSecret).toMatch(/^sciforge-workflow-internal-/)
    expect(persisted.schedule?.internal?.secret).toBe(loaded.schedule.internal.secret)
    expect(persisted.workflow?.webhookSecret).toBe(loaded.workflow.webhookSecret)
  })

  it('regenerates schedule and workflow internal HTTP secrets when a patch clears them', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    const next = await store.patch({
      schedule: {
        internal: { secret: '' }
      },
      workflow: {
        webhookSecret: ''
      }
    })

    expect(next.schedule.internal.secret).toMatch(/^sciforge-schedule-internal-/)
    expect(next.workflow.webhookSecret).toMatch(/^sciforge-workflow-internal-/)
    expect(next.schedule.internal.secret).not.toBe(loaded.schedule.internal.secret)
    expect(next.workflow.webhookSecret).not.toBe(loaded.workflow.webhookSecret)
  })

  it('drops legacy write completion model overrides on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-pro'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion).not.toHaveProperty('inheritModel')
    expect(loaded.write.inlineCompletion).not.toHaveProperty('model')
  })

  it('drops legacy write inline direct-provider fields on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            apiKey: 'sk-write-only',
            baseUrl: 'https://write-only.example/v1',
            model: 'deepseek-v4-pro'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion).not.toHaveProperty('apiKey')
    expect(loaded.write.inlineCompletion).not.toHaveProperty('baseUrl')
    expect(loaded.write.inlineCompletion).not.toHaveProperty('model')
  })

  it('drops legacy flash write completion defaults on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        write: {
          inlineCompletion: {
            model: 'deepseek-v4-flash'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.write.inlineCompletion).not.toHaveProperty('inheritModel')
    expect(loaded.write.inlineCompletion).not.toHaveProperty('model')
  })

  it('loads current local runtime autoStart settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot,
        agents: {
          sciforge: {
            autoStart: false
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.sciforge.autoStart).toBe(false)
  })

  it('drops stale local runtime credential fields', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        agents: {
          sciforge: {
            apiKey: 'sk-existing',
            baseUrl: 'https://runtime.example/v1'
          }
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect('apiKey' in loaded.agents.sciforge).toBe(false)
    expect('baseUrl' in loaded.agents.sciforge).toBe(false)
  })

  it('drops removed provider credentials and provider selection', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')

    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        provider: {
          apiKey: 'sk-default',
          baseUrl: 'https://api.deepseek.com',
          providers: [
            {
              id: 'custom-provider-2',
              name: 'Custom Provider',
              apiKey: 'sk-custom',
              baseUrl: 'https://custom.example/v1',
              endpointFormat: 'messages',
              models: ['custom-model']
            }
          ]
        },
        agents: {
          sciforge: {
            ...defaultLocalRuntimeSettings(),
            providerId: 'custom-provider-2',
            model: 'custom-model'
          }
        }
      }),
      'utf8'
    )

    const loaded = await new JsonSettingsStore(userDataDir).load()
    const persisted = await readFile(settingsPath, 'utf8')

    expect(loaded.agents.sciforge.model).toBe('custom-model')
    expect(loaded.agents.sciforge).not.toHaveProperty('providerId')
    expect(persisted).not.toContain('sk-default')
    expect(persisted).not.toContain('sk-custom')
    expect(JSON.parse(persisted)).not.toHaveProperty('provider')
  })

  it('loads settings from the legacy lowercase userData directory and writes them into the current path', async () => {
    const supportRoot = await mkdtemp(join(tmpdir(), 'sciforge-settings-compat-'))
    const legacyUserDataDir = join(supportRoot, 'sciforge')
    const currentUserDataDir = join(supportRoot, 'SciForge')
    const currentSettingsPath = join(currentUserDataDir, 'sciforge-settings.json')

    await mkdir(legacyUserDataDir, { recursive: true })
    await writeFile(
      join(legacyUserDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        locale: 'zh',
        provider: {
          apiKey: 'sk-legacy-provider'
        }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(currentUserDataDir)
    const loaded = await store.load()

    expect(loaded.locale).toBe('zh')
    expect(await readFile(currentSettingsPath, 'utf8')).not.toContain('sk-legacy-provider')
  })

  it('creates the configured code workspace on load', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const workspaceRoot = join(userDataDir, 'missing-workspace')

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        workspaceRoot
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.workspaceRoot).toBe(workspaceRoot)
    expect((await stat(workspaceRoot)).isDirectory()).toBe(true)
  })

  it('ignores removed agentProvider and deepseek settings', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))

    await writeFile(
      join(userDataDir, 'sciforge-settings.json'),
      JSON.stringify({
        version: 1,
        agentProvider: 'deepseek-runtime',
        deepseek: { port: 8787 }
      }),
      'utf8'
    )

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()

    expect(loaded.agents.sciforge.port).toBe(8899)
  })

  it('replaces invalid JSON without duplicating the original settings payload', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const legacySettingsPath = join(userDataDir, 'sciforge-settings.json')
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    await writeFile(legacySettingsPath, '{ invalid json', 'utf8')

    const store = new JsonSettingsStore(userDataDir)
    const loaded = await store.load()
    const files = await readdir(userDataDir)

    expect(loaded.workspaceRoot.length).toBeGreaterThan(0)
    expect(files.some((file) => file.startsWith('sciforge-settings.invalid-'))).toBe(false)
    const replaced = await readFile(settingsPath, 'utf8')
    expect(() => JSON.parse(replaced)).not.toThrow()
  })

  it('throws for non-recoverable read errors', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    await mkdir(settingsPath, { recursive: true })

    const store = new JsonSettingsStore(userDataDir)

    await expect(store.load()).rejects.toThrow(/Failed to read settings file/)
  })

  it('merges local runtime settings patches', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const saved = await store.patch({
      agents: {
        sciforge: {
          model: 'deepseek-reasoner',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write'
        }
      }
    })

    expect(saved.agents.sciforge.model).toBe('deepseek-reasoner')
    expect(saved.agents.sciforge.approvalPolicy).toBe('on-request')
    expect(saved.agents.sciforge.sandboxMode).toBe('workspace-write')
  })

  it('merges desktop behavior patches without keeping invalid startup state', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const enabled = await store.patch({
      appBehavior: {
        openAtLogin: true,
        startMinimized: true,
        closeToTray: true
      }
    })
    const disabled = await store.patch({
      appBehavior: {
        openAtLogin: false
      }
    })

    expect(enabled.appBehavior).toEqual({
      openAtLogin: true,
      startMinimized: true,
      closeToTray: true
    })
    expect(disabled.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: true
    })
  })

  it('omits agentProvider when writing normalized settings to disk', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    const store = new JsonSettingsStore(userDataDir)
    await store.load()
    await store.patch({
      agents: {
        sciforge: {
          model: 'deepseek-chat'
        }
      }
    })

    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect('agentProvider' in persisted).toBe(false)
    expect(persisted.agents).toEqual(
      expect.objectContaining({
        sciforge: expect.objectContaining({ model: 'deepseek-chat' })
      })
    )
  })

  it('migrates only legacy generic skill directories and removes legacy roots from disk', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-skills-migration-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    await writeFile(settingsPath, JSON.stringify({
      version: 1,
      remoteChannel: {
        skills: {
          extraDirs: [' /tmp/legacy-skills ', '/tmp/legacy-skills', '/tmp/other-skills']
        },
        opaqueState: { marker: 'must-not-survive' }
      },
      connectPhone: { marker: 'must-not-survive' }
    }), 'utf8')

    const loaded = await new JsonSettingsStore(userDataDir).load()
    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(loaded.skills).toEqual({
      extraDirs: ['/tmp/legacy-skills', '/tmp/other-skills']
    })
    expect(persisted.skills).toEqual(loaded.skills)
    expect('remoteChannel' in persisted).toBe(false)
    expect('connectPhone' in persisted).toBe(false)
  })

  it('uses only the generic skills patch path for subsequent writes', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-skills-patch-'))
    const settingsPath = join(userDataDir, 'sciforge-settings.json')
    const store = new JsonSettingsStore(userDataDir)
    await store.load()

    const next = await store.patch({
      skills: { extraDirs: [' /tmp/current-skills '] },
      remoteChannel: { skills: { extraDirs: ['/tmp/ignored-skills'] } }
    } as unknown as Parameters<JsonSettingsStore['patch']>[0])
    const persisted = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>

    expect(next.skills).toEqual({ extraDirs: ['/tmp/current-skills'] })
    expect(persisted.skills).toEqual(next.skills)
    expect('remoteChannel' in persisted).toBe(false)
  })

  it('saves settings atomically (no .tmp file left on success)', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-settings-atomic-'))

    try {
      const store = new JsonSettingsStore(userDataDir)
      const loaded = await store.load()
      await store.save(loaded)

      // Final file is present and non-empty.
      const finalContents = await readFile(
        join(userDataDir, 'sciforge-settings.json'),
        'utf8'
      )
      expect(finalContents.length).toBeGreaterThan(0)

      // No .tmp leftover from the atomic write.
      const entries = await readdir(userDataDir)
      expect(entries.filter((entry) => entry.includes('.tmp'))).toEqual([])
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
