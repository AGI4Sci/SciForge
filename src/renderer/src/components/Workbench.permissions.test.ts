import { describe, expect, it } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { composerPermissionLevelForRuntime } from './Workbench'

function settings(overrides: Partial<AppSettingsV1['agents']> = {}): AppSettingsV1 {
  return {
    agents: {
      codex: defaultCodexRuntimeSettings(),
      claude: defaultClaudeRuntimeSettings(),
      ...overrides
    }
  } as AppSettingsV1
}

describe('Workbench composer permission defaults', () => {
  it('uses the latest full-access setting for the active runtime', () => {
    expect(composerPermissionLevelForRuntime(settings({
      codex: {
        ...defaultCodexRuntimeSettings(),
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access'
      }
    }), 'codex')).toBe('danger-full-access')
  })

  it('reads Claude settings independently when the active runtime changes', () => {
    expect(composerPermissionLevelForRuntime(settings({
      claude: {
        ...defaultClaudeRuntimeSettings(),
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      }
    }), 'claude')).toBe('workspace-write')
  })

  it('preserves an externally managed sandbox until a permission choice is explicitly made', () => {
    expect(composerPermissionLevelForRuntime(settings({
      codex: { ...defaultCodexRuntimeSettings(), sandboxMode: 'external-sandbox', approvalPolicy: 'never' }
    }), 'codex')).toBe('external-sandbox')
  })

  it('defaults DSH to its existing workspace authority without expanding it', () => {
    expect(composerPermissionLevelForRuntime(settings(), 'dsh')).toBe('workspace-write')
  })
})
