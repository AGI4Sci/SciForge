import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspacePreviewFileState,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewSession
} from '../../../shared/workspace-preview'
import {
  MARKDOWN_COPY_FOR_WECHAT_ACTION_ID
} from '../../../shared/markdown-wechat'
import {
  WorkspacePreviewProviderRegistry,
  type WorkspacePreviewProvider
} from './provider-registry'
import { WorkspacePreviewWorkerClient } from './worker-client'

function createWorkerClient(): WorkspacePreviewWorkerClient {
  return WorkspacePreviewWorkerClient.compose({}).workerClient
}

describe('WorkspacePreviewProviderRegistry', () => {
  it('routes providers by plugin ID and orders owner-aware snapshots deterministically', () => {
    const first: WorkspacePreviewProvider = {
      pluginId: 'first-provider',
      observe: async () => ({
        ok: false,
        reason: 'unsupported-format',
        message: 'first observation'
      })
    }
    const second: WorkspacePreviewProvider = {
      pluginId: 'second-provider',
      invokeAction: async () => ({
        ok: false,
        reason: 'unsupported-action',
        message: 'second action'
      })
    }
    const registry = new WorkspacePreviewProviderRegistry([
      { ownerId: 'module-z', provider: first, order: 20 },
      { ownerId: 'module-a', provider: second, order: 10 }
    ])

    expect(registry.get('first-provider')).toMatchObject(first)
    expect(registry.get('second-provider')).toMatchObject(second)
    expect(registry.get('missing-provider')).toBeUndefined()
    expect(registry.list().map(({ ownerId, provider }) => `${ownerId}:${provider.pluginId}`)).toEqual([
      'module-a:second-provider',
      'module-z:first-provider'
    ])
    expect(Object.isFrozen(registry.list())).toBe(true)
  })

  it('rejects a duplicate batch atomically before replacing an existing route', () => {
    const original: WorkspacePreviewProvider = { pluginId: 'duplicate-provider' }
    const registry = new WorkspacePreviewProviderRegistry([
      { ownerId: 'module-original', provider: original }
    ])

    expect(() => registry.registerMany([
      { ownerId: 'module-new', provider: { pluginId: 'new-provider' } },
      { ownerId: 'module-duplicate', provider: { pluginId: 'duplicate-provider' } }
    ])).toThrow(
      'Workspace preview provider duplicate-provider is already registered.'
    )
    expect(registry.get('duplicate-provider')).toMatchObject(original)
    expect(registry.get('new-provider')).toBeUndefined()
    expect(registry.list().map(({ provider }) => provider.pluginId)).toEqual(['duplicate-provider'])
  })

  it('disposes a registration batch idempotently and permits re-registration', () => {
    const registry = new WorkspacePreviewProviderRegistry()
    const batch = registry.registerMany([
      { ownerId: 'module-domain', provider: { pluginId: 'domain-a' }, order: 20 },
      { ownerId: 'module-domain', provider: { pluginId: 'domain-b' }, order: 10 }
    ])

    batch.dispose()
    batch.dispose()
    expect(registry.list()).toEqual([])

    const replacement = registry.register('module-replacement', { pluginId: 'domain-a' })
    batch.dispose()
    expect(registry.get('domain-a')).toMatchObject({ pluginId: 'domain-a' })

    replacement.dispose()
    expect(registry.get('domain-a')).toBeUndefined()
  })
})

describe('WorkspacePreviewWorkerClient provider routing', () => {
  it('does not install the desktop WeChat copy host action in worker-only provider composition', async () => {
    const client = createWorkerClient()
    const input = markdownProviderInput()

    await expect(client.observe(input)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-plugin',
      message: `Workspace preview plugin ${MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID} does not have a first-party worker observer.`
    })
    await expect(client.invokeAction({
      ...input,
      action: {
        actionId: MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
        input: {}
      }
    })).resolves.toEqual({
      ok: false,
      reason: 'unsupported-plugin',
      message: `Workspace preview plugin ${MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID} does not expose first-party worker actions.`
    })
  })

  it('preserves unknown-provider errors for observe, action, and artifact operations', async () => {
    const client = createWorkerClient()
    const input = unknownProviderInput()

    await expect(client.observe(input)).resolves.toEqual({
      ok: false,
      reason: 'unsupported-plugin',
      message: 'Workspace preview plugin unknown-provider does not have a first-party worker observer.'
    })
    await expect(client.invokeAction({
      ...input,
      action: { actionId: 'unknown.inspect', input: {} }
    })).resolves.toEqual({
      ok: false,
      reason: 'unsupported-plugin',
      message: 'Workspace preview plugin unknown-provider does not expose first-party worker actions.'
    })
    await expect(client.prepareArtifact({
      ...input,
      request: { kind: 'thumbnail', width: 32, height: 32 }
    })).resolves.toEqual({
      ok: false,
      reason: 'unsupported-plugin',
      message: 'Workspace preview plugin unknown-provider does not expose first-party worker artifacts.'
    })
    await expect(client.validateFile({ manifest: input.manifest, file: input.file })).resolves.toEqual({ ok: true })
    await expect(client.applyEdit({
      ...input,
      operation: {
        kind: 'text.replaceRange',
        path: input.file.path,
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 1 }
        },
        text: 'replacement'
      },
      now: '2026-07-22T00:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      message: 'Workspace preview edit operation text.replaceRange is not implemented for plugin unknown-provider.'
    })
    await expect(client.exportPreview({
      ...input,
      target: { kind: 'workspace-file', format: 'unknown' },
      now: '2026-07-22T00:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      message: 'Workspace preview plugin unknown-provider does not expose first-party host exports.'
    })
  })

  it('preserves artifact-kind validation before provider lookup', async () => {
    const client = createWorkerClient()

    await expect(client.prepareArtifact({
      ...unknownProviderInput(),
      request: { kind: 'cache-artifact', source: 'observation' }
    })).resolves.toEqual({
      ok: false,
      reason: 'unsupported-artifact',
      message: 'Workspace preview worker artifacts are not implemented for cache-artifact.'
    })
  })

  it('routes through a live injected provider registry and observes disposal', async () => {
    const registry = new WorkspacePreviewProviderRegistry()
    const registration = registry.register('module-custom', {
      pluginId: 'unknown-provider',
      observe: async () => ({
        ok: false,
        reason: 'unsupported-format',
        message: 'custom provider observation'
      }),
      invokeAction: async () => ({
        ok: false,
        reason: 'unsupported-action',
        message: 'custom provider action'
      }),
      prepareArtifact: async () => ({
        ok: false,
        reason: 'unsupported-artifact',
        message: 'custom provider artifact'
      }),
      validateFile: async () => ({ ok: false, message: 'custom provider validation' }),
      applyEdit: async () => ({ ok: false, message: 'custom provider edit' }),
      exportPreview: async () => ({ ok: false, message: 'custom provider export' }),
      invokeHostAction: async (input) => input.action.actionId === 'custom.host'
        ? {
            ok: true,
            result: { source: 'host' },
            bytesRead: 0,
            truncated: false,
            effect: 'host-action'
          }
        : null
    })
    const client = new WorkspacePreviewWorkerClient({ providerRegistry: registry })
    const input = unknownProviderInput()

    await expect(client.observe(input)).resolves.toMatchObject({
      reason: 'unsupported-format',
      message: 'custom provider observation'
    })
    await expect(client.invokeAction({
      ...input,
      action: { actionId: 'custom.inspect', input: {} }
    })).resolves.toMatchObject({
      reason: 'unsupported-action',
      message: 'custom provider action'
    })
    await expect(client.prepareArtifact({
      ...input,
      request: { kind: 'thumbnail', width: 32, height: 32 }
    })).resolves.toMatchObject({
      reason: 'unsupported-artifact',
      message: 'custom provider artifact'
    })
    await expect(client.validateFile({ manifest: input.manifest, file: input.file })).resolves.toEqual({
      ok: false,
      message: 'custom provider validation'
    })
    await expect(client.applyEdit({
      ...input,
      operation: {
        kind: 'workspace.setSelection',
        path: input.file.path,
        selection: {
          kind: 'text',
          ranges: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }]
        }
      },
      now: '2026-07-22T00:00:00.000Z'
    })).resolves.toEqual({ ok: false, message: 'custom provider edit' })
    await expect(client.exportPreview({
      ...input,
      target: { kind: 'workspace-file', format: 'unknown' },
      now: '2026-07-22T00:00:00.000Z'
    })).resolves.toEqual({ ok: false, message: 'custom provider export' })
    await expect(client.invokeAction({
      ...input,
      action: { actionId: 'custom.host', input: {} }
    })).resolves.toMatchObject({
      ok: true,
      result: { source: 'host' },
      effect: 'host-action'
    })
    await expect(client.invokeAction({
      ...input,
      action: { actionId: 'custom.worker', input: {} }
    })).resolves.toMatchObject({
      reason: 'unsupported-action',
      message: 'custom provider action'
    })

    registration.dispose()
    await expect(client.observe(input)).resolves.toMatchObject({
      reason: 'unsupported-plugin'
    })
  })
})

function markdownProviderInput(): {
  manifest: WorkspacePreviewPluginManifest
  file: WorkspacePreviewFileState
  session: WorkspacePreviewSession
} {
  const manifest = DEFAULT_WORKSPACE_PREVIEW_PLUGIN_MANIFESTS.find(
    (candidate) => candidate.id === MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID
  )
  if (!manifest) throw new Error('Missing Markdown workspace preview manifest fixture.')
  const file: WorkspacePreviewFileState = {
    workspaceRoot: '/workspace',
    path: '/workspace/article.md',
    relativePath: 'article.md',
    size: 10,
    mtimeMs: 1
  }
  const session: WorkspacePreviewSession = {
    id: 'session-markdown-provider',
    pluginId: manifest.id,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality: manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    mtimeMs: file.mtimeMs
  }
  return { manifest, file, session }
}

function unknownProviderInput(): {
  manifest: WorkspacePreviewPluginManifest
  file: WorkspacePreviewFileState
  session: WorkspacePreviewSession
} {
  const manifest: WorkspacePreviewPluginManifest = {
    contractVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    id: 'unknown-provider',
    displayName: 'Unknown Provider',
    version: '0.1.0',
    modality: 'unknown',
    lifecycle: 'worker',
    priority: 1,
    extensions: ['.unknown'],
    mimeTypes: [],
    capabilities: {
      preview: true,
      edit: false,
      inspect: true,
      structuredSelection: false,
      export: []
    }
  }
  const file: WorkspacePreviewFileState = {
    workspaceRoot: '/workspace',
    path: '/workspace/sample.unknown',
    relativePath: 'sample.unknown',
    size: 0,
    mtimeMs: 1
  }
  const session: WorkspacePreviewSession = {
    id: 'session-unknown-provider',
    pluginId: manifest.id,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality: manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    mtimeMs: file.mtimeMs
  }
  return { manifest, file, session }
}
