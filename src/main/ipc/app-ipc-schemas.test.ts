import { describe, expect, it } from 'vitest'
import { pluginManifestSchema } from '@sciforge/plugin-sdk/manifest'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS,
  type AgentRuntimeAuxiliaryOperation
} from '../../shared/agent-runtime-contract'
import {
  agentRuntimeApprovalResolvePayloadSchema,
  agentRuntimeAuxiliaryPayloadSchema,
  agentRuntimeListThreadsPayloadSchema,
  agentRuntimeReadThreadPagePayloadSchema,
  agentRuntimeReadThreadStatusPayloadSchema,
  agentRuntimeReadToolArtifactPayloadSchema,
  agentRuntimeResumeIncompleteWorkPayloadSchema,
  agentRuntimeSessionResumePayloadSchema,
  agentRuntimeStartThreadPayloadSchema,
  agentRuntimeThreadCompactPayloadSchema,
  agentRuntimeThreadDeletePayloadSchema,
  agentRuntimeThreadForkPayloadSchema,
  agentRuntimeThreadRenamePayloadSchema,
  agentRuntimeThreadRelationPayloadSchema,
  agentRuntimeTurnSteerPayloadSchema,
  agentRuntimeTurnTargetPayloadSchema,
  agentRuntimeUsagePayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeUserInputResolvePayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  remoteWorkspaceAttachPayloadSchema,
  remoteWorkspaceSelectPayloadSchema,
  remoteWorkspaceSessionPayloadSchema,
  domainExtensionCandidatePayloadSchema,
  domainExtensionInstallPayloadSchema,
  domainExtensionListPayloadSchema,
  domainExtensionListResultSchema,
  domainExtensionPackagePayloadSchema,
  domainExtensionSetEnabledPayloadSchema,
  domainExtensionSummarySchema,
  isSafeOpenExternalUrl,
  scheduleTaskFromTextPayloadSchema,
  settingsPatchSchema,
  shellOpenExternalUrlSchema,
  speechTranscriptionPayloadSchema,
  traceExportPayloadSchema,
  traceReadPayloadSchema,
  traceSummariesPayloadSchema,
  skillListPayloadSchema,
  workspaceClipboardPastePayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryCopyPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryImportPayloadSchema,
  workspaceEntryMovePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspacePdfRenameSuggestionPayloadSchema,
  workspacePreviewOpenPayloadSchema,
  writeExportPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writeRetrievalPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas', () => {
  it.each([
    '', '.', '..', '.hidden', '_hidden', 'Dsh-example', 'dsh/example',
    '@scope', '@scope/../example', '@scope/Example', 'node_modules', 'favicon.ico',
    'dsh%2fexample', 'dsh\\example', 'dsh\u0000example', 'dsh-example\n',
    ' dsh-example', 'dsh-example ', ' @scope/example ', 'a'.repeat(215)
  ])('rejects noncanonical extension identity %j without normalization', (packageName) => {
    expect(domainExtensionPackagePayloadSchema.safeParse({ packageName }).success).toBe(false)
    expect(domainExtensionSetEnabledPayloadSchema.safeParse({ packageName, enabled: true }).success).toBe(false)
    expect(domainExtensionCandidatePayloadSchema.safeParse({ packageName, path: '/candidate' }).success).toBe(false)
    expect(domainExtensionSummarySchema.shape.packageName.safeParse(packageName).success).toBe(false)
  })

  it('validates bounded renderer-safe extension metadata and strict operation inputs', () => {
    const summary = {
      packageName: '@sciforge/domain-browser',
      moduleId: 'sciforge.browser',
      moduleDisplayName: 'Browser',
      version: '1.2.3',
      publisher: {
        id: 'sciforge',
        displayName: 'SciForge'
      },
      source: 'user',
      verification: 'official-signed',
      execution: 'sandboxed-runtime',
      status: 'active',
      permissions: ['network.outbound'],
      contributionKinds: ['command', 'right-panel'],
      contributionCount: 2,
      canRollback: false,
      installedAt: '2026-07-27T12:30:00.000Z'
    }

    expect(domainExtensionListPayloadSchema.parse({})).toEqual({})
    expect(domainExtensionInstallPayloadSchema.parse({ path: ' /tmp/browser.sfx ' })).toEqual({
      path: '/tmp/browser.sfx'
    })
    expect(domainExtensionPackagePayloadSchema.parse({
      packageName: '@sciforge/domain-browser'
    })).toEqual({
      packageName: '@sciforge/domain-browser'
    })
    expect(domainExtensionSetEnabledPayloadSchema.parse({
      packageName: '@sciforge/domain-browser',
      enabled: false
    })).toEqual({
      packageName: '@sciforge/domain-browser',
      enabled: false
    })
    expect(domainExtensionSummarySchema.parse(summary)).toEqual(summary)
    expect(domainExtensionListResultSchema.parse([summary])).toEqual([summary])

    expect(() => domainExtensionListPayloadSchema.parse({ includeInvalid: true })).toThrow()
    expect(() => domainExtensionInstallPayloadSchema.parse({
      path: '/tmp/browser.sfx',
      allowUnsigned: true
    })).toThrow()
    expect(() => domainExtensionPackagePayloadSchema.parse({
      packageName: '../domain-browser'
    })).toThrow()
    expect(() => domainExtensionSummarySchema.parse({
      ...summary,
      verification: 'unsigned'
    })).toThrow()
    expect(() => domainExtensionSummarySchema.parse({
      ...summary,
      permissions: Array.from({ length: 1_001 }, (_, index) => `permission.item-${index}`)
    })).toThrow()
  })

  it('preserves the real dsh-unitverse description through the manifest and list result contract', () => {
    // Unmodified dsh-unitverse@1.1.1 package.json; development summaries project description here.
    const description = 'DSH plugin: universal unit conversion across length, area, volume, time, angle, speed, temperature, pressure, energy and power, with Chinese/English aliases. 单位换算 DSH 插件（长度/面积/体积/时间/角度/速度/温度/压力/热量/功率，支持中英文单位名）。'
    const manifest = pluginManifestSchema.parse({
      name: 'dsh-unitverse', version: '1.1.1', description,
      dsh: { bundle: { patch: './cordis.patch.yml' } }
    })
    const summary = {
      packageName: manifest.name, moduleId: 'dsh.unitverse',
      moduleDisplayName: manifest.description, version: manifest.version,
      publisher: { id: 'sciforge-dev', displayName: 'SciForge development plugin' },
      source: 'development', verification: 'development-local', execution: 'sandboxed-runtime',
      status: 'disabled', permissions: [], contributionKinds: [], contributionCount: 0, canRollback: false
    }
    const result = domainExtensionListResultSchema.safeParse([summary])
    // Show the full Zod issue path on regression, rather than the IPC's first-issue message only.
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success && result.data).toEqual([summary])
  })

  it('bounds DSH description metadata consistently without widening publisher names or identities', () => {
    const manifest = {
      name: 'dsh-example', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } }
    }
    expect(pluginManifestSchema.safeParse({ ...manifest, description: 'x'.repeat(4_000) }).success).toBe(true)
    expect(domainExtensionSummarySchema.shape.moduleDisplayName.safeParse('x'.repeat(4_000)).success).toBe(true)
    expect(pluginManifestSchema.safeParse({ ...manifest, description: 'x'.repeat(4_001) }).success).toBe(false)
    expect(domainExtensionSummarySchema.shape.moduleDisplayName.safeParse('x'.repeat(4_001)).success).toBe(false)
    expect(domainExtensionSummarySchema.shape.publisher.shape.displayName.safeParse('x'.repeat(161)).success).toBe(false)
    expect(domainExtensionSummarySchema.shape.moduleDisplayName.safeParse(' ').success).toBe(false)
    expect(domainExtensionSummarySchema.shape.moduleDisplayName.safeParse({ text: 'unsafe' }).success).toBe(false)
    expect(domainExtensionSummarySchema.shape.packageName.safeParse('../dsh-example').success).toBe(false)
  })

  it('normalizes and bounds explicit work continuation requests', () => {
    expect(agentRuntimeResumeIncompleteWorkPayloadSchema.parse({ workId: ' work-1 ' })).toEqual({ workId: 'work-1' })
    expect(() => agentRuntimeResumeIncompleteWorkPayloadSchema.parse({ workId: ' ' })).toThrow()
    expect(() => agentRuntimeResumeIncompleteWorkPayloadSchema.parse({ workId: 'work-1', extra: true })).toThrow()
  })

  it('accepts bounded protocol-neutral full-trace queries', () => {
    expect(traceReadPayloadSchema.parse({})).toEqual({ limit: 500 })
    expect(traceReadPayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      kinds: ['model_request', 'agent_event', 'execution_event'],
      order: 'desc',
      limit: 20
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      kinds: ['model_request', 'agent_event', 'execution_event'],
      order: 'desc',
      limit: 20
    })
    expect(traceSummariesPayloadSchema.parse({ traceIds: [' trace-1 '], limit: 5 })).toEqual({
      traceIds: ['trace-1'],
      limit: 5
    })
    expect(traceExportPayloadSchema.parse({ traceIds: ['trace-1'] })).toEqual({
      traceIds: ['trace-1']
    })
    expect(() => traceReadPayloadSchema.parse({ kinds: ['openai-chat'] })).toThrow()
  })

  it('accepts side-thread metadata when starting a PDF annotation thread', () => {
    expect(agentRuntimeStartThreadPayloadSchema.parse({
      runtimeId: 'codex',
      workspace: ' /tmp/workspace ',
      title: ' PDF: selected text ',
      mode: ' agent ',
      model: ' runtime-model ',
      reasoningEffort: ' ultra ',
      serviceTier: ' priority ',
      relation: ' side ',
      parentThreadId: ' parent-thread ',
      parentTurnId: ' parent-turn ',
      threadSource: ' pdf_annotation ',
      sidebarVisibility: ' hidden '
    })).toEqual({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'PDF: selected text',
      mode: 'agent',
      model: 'runtime-model',
      reasoningEffort: 'ultra',
      serviceTier: 'priority',
      relation: 'side',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    })
  })

  it('accepts only opaque authorized and attached Workspace Host identities', () => {
    expect(remoteWorkspaceAttachPayloadSchema.parse({
      providerId: ' remote-ssh.workspace-host-provider ',
      authorizedSessionId: ' authorized-session-1 '
    })).toEqual({
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'authorized-session-1'
    })
    expect(remoteWorkspaceSelectPayloadSchema.parse({ sessionId: null }))
      .toEqual({ sessionId: null })
    expect(remoteWorkspaceSessionPayloadSchema.parse({ sessionId: ' session-1 ' }))
      .toEqual({ sessionId: 'session-1' })
    expect(() => remoteWorkspaceAttachPayloadSchema.parse({
      providerId: 'remote-ssh.workspace-host-provider',
      authorizedSessionId: 'authorized-session-1',
      workspaceRoot: '/must/not-cross-this-boundary'
    })).toThrow()
  })

  it('accepts neutral agent runtime turn payloads', () => {
    const payload = agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'claude',
      threadId: ' thread-1 ',
      text: ' hello ',
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false
      },
      clientDirectiveId: ' directive-1 ',
      executionIntent: {
        mode: 'execute',
        requirements: [
          { id: 'visual-look-locate', receiptKind: 'visual.look' },
          {
            id: 'visual-capture',
            receiptKind: 'visual.capture',
            requiresRegionRef: true,
            dependsOn: ['visual-look-locate']
          }
        ]
      },
      workspace: ' /tmp/workspace ',
      model: ' deepseek-v4-pro ',
      reasoningEffort: ' medium ',
      serviceTier: ' priority ',
      permissionLevel: 'assisted-approval',
      governanceProfile: 'remote_guard',
      visibleContextOwnerThreadId: ' parent-thread ',
      fileReferences: [{
        path: ' docs/spec.pdf ',
        relativePath: ' docs/spec.pdf ',
        name: ' spec.pdf ',
        kind: 'pdf',
        mimeType: ' application/pdf '
      }]
    })

    expect(payload).toEqual({
      runtimeId: 'claude',
      threadId: 'thread-1',
      text: 'hello',
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false
      },
      clientDirectiveId: 'directive-1',
      executionIntent: {
        mode: 'execute',
        requirements: [
          { id: 'visual-look-locate', receiptKind: 'visual.look' },
          {
            id: 'visual-capture',
            receiptKind: 'visual.capture',
            requiresRegionRef: true,
            dependsOn: ['visual-look-locate']
          }
        ]
      },
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'medium',
      serviceTier: 'priority',
      permissionLevel: 'assisted-approval',
      governanceProfile: 'remote_guard',
      visibleContextOwnerThreadId: 'parent-thread',
      fileReferences: [{
        path: 'docs/spec.pdf',
        relativePath: 'docs/spec.pdf',
        name: 'spec.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf'
      }]
    })

    expect(() => agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'codex',
      threadId: 'thread-1',
      text: 'hello',
      fileReferences: [{
        path: 'docs/spec.pdf',
        relativePath: 'docs/spec.pdf',
        name: 'spec.pdf',
        delivery: 'inline_context'
      }]
    })).toThrow()
    expect(() => agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'codex',
      threadId: 'thread-1',
      text: 'hello',
      outputSchema: ['not-an-object-schema']
    })).toThrow()
  })

  it('accepts stable directive identity on steer payloads', () => {
    expect(agentRuntimeTurnSteerPayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      turnId: ' turn-1 ',
      text: ' use the current annotations ',
      clientDirectiveId: ' correction-1 ',
      executionIntent: {
        mode: 'inspect',
        requirements: [{ receiptKind: 'visual.look' }]
      }
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      text: 'use the current annotations',
      clientDirectiveId: 'correction-1',
      executionIntent: {
        mode: 'inspect',
        requirements: [{ receiptKind: 'visual.look' }]
      }
    })
  })

  it('rejects empty neutral agent runtime turn text', () => {
    expect(() =>
      agentRuntimeStartTurnPayloadSchema.parse({
        runtimeId: 'codex',
        threadId: 'thread-1',
        text: ' '
      })
    ).toThrow()
  })

  it('accepts neutral agent runtime event subscription and control payloads', () => {
    expect(agentRuntimeListThreadsPayloadSchema.parse({
      runtimeId: 'dsh',
      limit: 20,
      search: ' side path ',
      includeArchived: true,
      includeSide: true,
      summary: true
    })).toEqual({
      runtimeId: 'dsh',
      limit: 20,
      search: 'side path',
      includeArchived: true,
      includeSide: true,
      summary: true
    })

    expect(agentRuntimeEventSubscribePayloadSchema.parse({
      runtimeId: 'dsh',
      threadId: ' thread-1 ',
      sinceSeq: 7,
      streamId: ' stream-1 '
    })).toEqual({
      runtimeId: 'dsh',
      threadId: 'thread-1',
      sinceSeq: 7,
      streamId: 'stream-1'
    })

    expect(agentRuntimeApprovalResolvePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      approvalId: ' approval-1 ',
      decision: 'allowed',
      message: ' ok '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed',
      message: 'ok'
    })

    expect(agentRuntimeUserInputResolvePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      requestId: ' request-1 ',
      answers: [{ id: ' choice ', label: ' Choice ', value: ' yes ' }]
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'request-1',
      answers: [{ id: 'choice', label: 'Choice', value: 'yes' }]
    })

    expect(agentRuntimeThreadRenamePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      title: ' New title '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'New title'
    })

    expect(agentRuntimeThreadDeletePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })

    expect(agentRuntimeThreadCompactPayloadSchema.parse({
      runtimeId: 'dsh',
      threadId: ' thread-1 ',
      reason: ' Manual cleanup '
    })).toEqual({
      runtimeId: 'dsh',
      threadId: 'thread-1',
      reason: 'Manual cleanup'
    })

    expect(agentRuntimeThreadForkPayloadSchema.parse({
      runtimeId: 'dsh',
      threadId: ' thread-1 ',
      relation: ' side ',
      title: ' Side path '
    })).toEqual({
      runtimeId: 'dsh',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })

    expect(agentRuntimeSessionResumePayloadSchema.parse({
      runtimeId: 'dsh',
      sessionId: ' session-1 ',
      model: ' deepseek-v4-pro ',
      mode: ' agent ',
      maxResumeCount: 3
    })).toEqual({
      runtimeId: 'dsh',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      maxResumeCount: 3
    })

    expect(agentRuntimeThreadRelationPayloadSchema.parse({
      runtimeId: 'dsh',
      threadId: ' thread-1 ',
      relation: ' primary '
    })).toEqual({
      runtimeId: 'dsh',
      threadId: 'thread-1',
      relation: 'primary'
    })

    expect(agentRuntimeUsagePayloadSchema.parse({
      runtimeId: 'dsh',
      groupBy: 'day',
      from: ' 2026-06-01 ',
      to: ' 2026-06-11 ',
      timezone: ' Asia/Shanghai '
    })).toEqual({
      runtimeId: 'dsh',
      groupBy: 'day',
      from: '2026-06-01',
      to: '2026-06-11',
      timezone: 'Asia/Shanghai'
    })
  })

  it('requires explicit runtime ids for thread, turn, session, and interaction runtime payloads', () => {
    const cases = [
      ['startThread', agentRuntimeStartThreadPayloadSchema, { title: 'New thread' }],
      ['readThreadStatus', agentRuntimeReadThreadStatusPayloadSchema, { threadId: 'thread-1' }],
      ['readThreadPage', agentRuntimeReadThreadPagePayloadSchema, { threadId: 'thread-1', limit: 20 }],
      ['readToolArtifact', agentRuntimeReadToolArtifactPayloadSchema, { threadId: 'thread-1', ref: 'ref-1', size: 12 }],
      ['startTurn', agentRuntimeStartTurnPayloadSchema, { threadId: 'thread-1', text: 'hello' }],
      ['interruptTurn', agentRuntimeTurnTargetPayloadSchema, { threadId: 'thread-1', turnId: 'turn-1' }],
      ['steerTurn', agentRuntimeTurnSteerPayloadSchema, { threadId: 'thread-1', turnId: 'turn-1', text: 'continue' }],
      ['subscribeEvents', agentRuntimeEventSubscribePayloadSchema, { threadId: 'thread-1' }],
      ['renameThread', agentRuntimeThreadRenamePayloadSchema, { threadId: 'thread-1', title: 'Renamed' }],
      ['deleteThread', agentRuntimeThreadDeletePayloadSchema, { threadId: 'thread-1' }],
      ['compactThread', agentRuntimeThreadCompactPayloadSchema, { threadId: 'thread-1' }],
      ['forkThread', agentRuntimeThreadForkPayloadSchema, { threadId: 'thread-1' }],
      ['resumeSession', agentRuntimeSessionResumePayloadSchema, { sessionId: 'session-1' }],
      ['updateThreadRelation', agentRuntimeThreadRelationPayloadSchema, { threadId: 'thread-1', relation: 'primary' }],
      ['threadUsage', agentRuntimeUsagePayloadSchema, { groupBy: 'thread', threadId: 'thread-1' }],
      ['resolveApproval', agentRuntimeApprovalResolvePayloadSchema, {
        threadId: 'thread-1',
        approvalId: 'approval-1',
        decision: 'allowed'
      }],
      ['resolveUserInput', agentRuntimeUserInputResolvePayloadSchema, {
        threadId: 'thread-1',
        requestId: 'request-1',
        answers: [{ id: 'answer-1', value: 'yes' }]
      }]
    ] as const

    for (const [name, schema, payload] of cases) {
      expect(() => schema.parse(payload), name).toThrow()
    }

    expect(agentRuntimeListThreadsPayloadSchema.parse({ limit: 5 })).toEqual({ limit: 5 })
    expect(agentRuntimeUsagePayloadSchema.parse({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'thread-1'
    })).toEqual({
      runtimeId: 'codex',
      groupBy: 'thread',
      threadId: 'thread-1'
    })
    expect(() => agentRuntimeUsagePayloadSchema.parse({
      runtimeId: 'codex',
      groupBy: 'thread'
    })).toThrow()
  })

  it('accepts every current runtime id and rejects the retired sciforge runtime id', () => {
    for (const runtimeId of ['codex', 'claude', 'dsh'] as const) {
      expect(agentRuntimeStartThreadPayloadSchema.parse({ runtimeId }).runtimeId).toBe(runtimeId)
    }

    // The retired SciForge runtime id survives only in legacy persisted settings; runtime
    // commands must reject it instead of treating it as a selectable runtime.
    expect(() => agentRuntimeStartThreadPayloadSchema.parse({ runtimeId: 'sciforge' })).toThrow()
    expect(() => agentRuntimeListThreadsPayloadSchema.parse({ runtimeId: 'sciforge', limit: 5 })).toThrow()
    expect(() => agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      text: 'hello'
    })).toThrow()
    expect(() => agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'sciforge',
      operation: 'getRuntimeInfo',
      payload: {}
    })).toThrow()
  })

  it('accepts shared host-service auxiliary operations', () => {
    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'codex',
      operation: 'startCodingPlanLogin',
      payload: { method: 'device' }
    })).toEqual({
      runtimeId: 'codex',
      operation: 'startCodingPlanLogin',
      payload: { method: 'device' }
    })

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'codex',
      operation: 'runCodeNavigation',
      payload: {
        workspaceRoot: ' /tmp/workspace ',
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
        line: 3,
        character: 8
      }
    })).toEqual({
      runtimeId: 'codex',
      operation: 'runCodeNavigation',
      payload: {
        workspaceRoot: ' /tmp/workspace ',
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
        line: 3,
        character: 8
      }
    })

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'claude',
      operation: 'listThreadChildren',
      payload: {
        threadId: 'thread-1',
        parentTurnId: 'turn-1',
        activeOnly: true
      }
    })).toEqual({
      runtimeId: 'claude',
      operation: 'listThreadChildren',
      payload: {
        threadId: 'thread-1',
        parentTurnId: 'turn-1',
        activeOnly: true
      }
    })

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'claude',
      operation: 'readChildTranscript',
      payload: {
        parentThreadId: 'thread-1',
        childId: 'child-1',
        transcriptRef: {
          kind: 'runtime',
          transcriptId: 'transcript-1'
        }
      }
    })).toEqual({
      runtimeId: 'claude',
      operation: 'readChildTranscript',
      payload: {
        parentThreadId: 'thread-1',
        childId: 'child-1',
        transcriptRef: {
          kind: 'runtime',
          transcriptId: 'transcript-1'
        }
      }
    })

    for (const operation of AGENT_RUNTIME_AUXILIARY_OPERATIONS) {
      expect(agentRuntimeAuxiliaryPayloadSchema.parse({
        runtimeId: 'dsh',
        operation,
        payload: { threadId: 'thread-1' }
      }).operation).toBe(operation)
    }
  })

  it('requires top-level runtime ids for runtime-bound auxiliary operations', () => {
    const runtimeIdRequired = new Set<AgentRuntimeAuxiliaryOperation>(
      AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
    )

    for (const operation of AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS) {
      expect(() =>
        agentRuntimeAuxiliaryPayloadSchema.parse({
          operation,
          payload: {
            threadId: 'thread-1',
            sourceThreadId: 'thread-1',
            parentThreadId: 'thread-1',
            requestId: 'request-1'
          }
        })
      , operation).toThrow()

      expect(agentRuntimeAuxiliaryPayloadSchema.parse({
        runtimeId: 'codex',
        operation,
        payload: { threadId: 'thread-1' }
      })).toMatchObject({ runtimeId: 'codex', operation })
    }

    for (const operation of [
      'getCodingPlanAccount',
      'startCodingPlanLogin',
      'waitForCodingPlanLogin',
      'logoutCodingPlanAccount',
      'getCodingPlanRateLimits'
    ] as const) {
      expect(() => agentRuntimeAuxiliaryPayloadSchema.parse({ operation, payload: {} }), operation).toThrow()
    }

    for (const operation of AGENT_RUNTIME_AUXILIARY_OPERATIONS.filter((item) => !runtimeIdRequired.has(item))) {
      expect(agentRuntimeAuxiliaryPayloadSchema.parse({
        operation,
        payload: {}
      })).toEqual({ operation, payload: {} })
    }

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      operation: 'listWorkspaceReferences',
      payload: { workspaceRoot: '/tmp/workspace' }
    })).toEqual({
      operation: 'listWorkspaceReferences',
      payload: { workspaceRoot: '/tmp/workspace' }
    })
  })

  it('accepts skill list payloads with an optional workspace root', () => {
    expect(skillListPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace '
    })).toEqual({ workspaceRoot: '/tmp/workspace' })
    expect(skillListPayloadSchema.parse({})).toEqual({})
  })

  it('accepts capability-backed workspace preview open payloads', () => {
    expect(workspacePreviewOpenPayloadSchema.parse({
      path: ' protein.PDB ',
      workspaceRoot: ' /tmp/workspace ',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'remote-session-1',
        path: '/tmp/workspace'
      },
      mimeType: ' chemical/x-pdb ',
      mode: ' inspect '
    })).toEqual({
      path: 'protein.PDB',
      workspaceRoot: '/tmp/workspace',
      workspaceLocator: {
        contractVersion: 1,
        hostSessionId: 'remote-session-1',
        path: '/tmp/workspace'
      },
      mimeType: 'chemical/x-pdb',
      mode: 'inspect'
    })
    expect(workspacePreviewOpenPayloadSchema.parse({
      path: ' evidence.pdf ',
      workspaceRoot: ' /tmp/workspace ',
      anchor: {
        kind: 'document',
        page: 5,
        rects: [{ page: 5, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
      },
      integrity: {
        algorithm: 'sha256',
        expectedDigest: 'A'.repeat(64)
      }
    })).toMatchObject({
      path: 'evidence.pdf',
      workspaceRoot: '/tmp/workspace',
      anchor: { kind: 'document', page: 5 },
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${'a'.repeat(64)}`
      }
    })
    expect(() =>
      workspacePreviewOpenPayloadSchema.parse({
        path: 'protein.PDB',
        workspaceRoot: '/tmp/workspace',
        mode: 'review'
      })
    ).toThrow()
  })

  it('accepts speech transcription payloads without provider override settings', () => {
    const payload = speechTranscriptionPayloadSchema.parse({
      audioBase64: Buffer.from('fake-wav-bytes').toString('base64'),
      mimeType: ' audio/wav ',
      durationMs: 1200
    })

    expect(payload).toEqual({
      audioBase64: Buffer.from('fake-wav-bytes').toString('base64'),
      mimeType: 'audio/wav',
      durationMs: 1200
    })
  })

  it('rejects non-audio speech transcription payloads', () => {
    expect(() =>
      speechTranscriptionPayloadSchema.parse({
        audioBase64: Buffer.from('fake-image-bytes').toString('base64'),
        mimeType: 'image/png'
      })
    ).toThrow(/audio MIME type/)
  })

  it('accepts a valid settings patch for local runtime and write settings', () => {
    const payload = settingsPatchSchema.parse({
      theme: 'dark',
      activeAgentRuntime: 'claude',
      agentCapabilities: {
        subagents: {
          enabled: true,
          maxParallel: 10
        }
      },
      modelAccess: {
        mode: 'api',
        planAdapterId: ''
      },
      modelRouter: {
        profiles: {
          default: {
            imageGenerator: {
              baseUrl: 'https://api.example.test/v1',
              apiKey: 'image-key',
              model: 'image-model'
            }
          }
        }
      },
      agents: {
        sciforge: {
          port: 9000,
          model: 'deepseek-chat',
          tokenEconomy: {
            enabled: true,
            compressToolResults: false,
            historyHygiene: {
              maxToolResultTokens: 4000
            }
          }
        },
        codex: {
          command: 'codex',
          codexHome: '/tmp/codex-home',
          model: 'runtime-discovered-model',
          reasoningEffort: 'ultra',
          serviceTier: 'priority',
          approvalPolicy: 'never',
          sandboxMode: 'workspace-write'
        },
        claude: {
          command: 'claude',
          configDir: '/tmp/claude-code',
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          extraArgs: ['--allowedTools', 'Edit']
        },
        dsh: {
          command: 'dsh',
          executablePath: '/opt/dsh/bin/dsh',
          selectedModel: 'deepseek-chat',
          reasoningEffort: 'high'
        }
      },
      write: {
        inlineCompletion: {
          maxTokens: 128
        }
      },
      speechToText: {
        enabled: false,
        protocol: 'mimo-asr',
        baseUrl: '',
        apiKey: '',
        model: '',
        language: '',
        timeoutMs: 60000
      },
      skills: {
        extraDirs: [' /tmp/sciforge-skills ']
      }
    })

    expect(payload.agents?.sciforge?.port).toBe(9000)
    expect(payload.agents?.sciforge?.tokenEconomy?.enabled).toBe(true)
    expect(payload.agents?.sciforge?.tokenEconomy?.historyHygiene?.maxToolResultTokens).toBe(4000)
    expect(payload.activeAgentRuntime).toBe('claude')
    expect(payload.agentCapabilities?.subagents?.maxParallel).toBe(10)
    expect(payload.modelAccess).toEqual({ mode: 'api', planAdapterId: '' })
    expect(payload.agents?.codex?.codexHome).toBe('/tmp/codex-home')
    expect(payload.agents?.codex?.model).toBe('runtime-discovered-model')
    expect(payload.agents?.codex?.reasoningEffort).toBe('ultra')
    expect(payload.agents?.dsh?.executablePath).toBe('/opt/dsh/bin/dsh')
    expect(payload.agents?.dsh?.selectedModel).toBe('deepseek-chat')
    expect(payload.agents?.dsh?.reasoningEffort).toBe('high')
    expect(payload.agents?.codex?.serviceTier).toBe('priority')
    expect(payload.agents?.claude?.configDir).toBe('/tmp/claude-code')
    expect(payload.write?.inlineCompletion?.maxTokens).toBe(128)
    expect(payload.speechToText?.baseUrl).toBe('')
    expect(payload.skills?.extraDirs).toEqual(['/tmp/sciforge-skills'])
    expect(payload.modelRouter?.profiles?.default?.imageGenerator?.model).toBe('image-model')
  })

  it('accepts cleared optional runtime selections from a full settings snapshot', () => {
    const payload = settingsPatchSchema.parse({
      agents: {
        sciforge: { model: '' },
        codex: { reasoningEffort: '' }
      }
    })

    expect(payload.agents?.sciforge?.model).toBe('')
    expect(payload.agents?.codex?.reasoningEffort).toBe('')
  })

  it('accepts bounded Workbench toolbar placement settings', () => {
    expect(settingsPatchSchema.parse({
      workbenchToolbar: {
        hiddenCommandIds: [' paper-radar.open '],
        commandOrder: ['remote-ssh.open', 'paper-radar.open']
      }
    })).toEqual({
      workbenchToolbar: {
        hiddenCommandIds: ['paper-radar.open'],
        commandOrder: ['remote-ssh.open', 'paper-radar.open']
      }
    })

    expect(() => settingsPatchSchema.parse({
      workbenchToolbar: {
        commandOrder: Array.from({ length: 257 }, (_, index) => `plugin-${index}.open`)
      }
    })).toThrow()
  })

  it('accepts every DSH runtime field the Settings UI writes, including clearing', () => {
    expect(settingsPatchSchema.parse({
      agents: {
        dsh: {
          command: ' /opt/dsh/bin/dsh ',
          executablePath: '/opt/dsh/bin/dsh',
          selectedModel: 'deepseek-chat',
          reasoningEffort: 'high'
        }
      }
    })).toEqual({
      agents: {
        dsh: {
          command: '/opt/dsh/bin/dsh',
          executablePath: '/opt/dsh/bin/dsh',
          selectedModel: 'deepseek-chat',
          reasoningEffort: 'high'
        }
      }
    })

    // Clearing a selection sends an empty string and must fall back to the
    // runtime default rather than being rejected.
    expect(settingsPatchSchema.parse({
      agents: { dsh: { executablePath: '', selectedModel: '', reasoningEffort: '' } }
    })).toEqual({
      agents: { dsh: { executablePath: '', selectedModel: '', reasoningEffort: '' } }
    })

    expect(() => settingsPatchSchema.parse({
      agents: { dsh: { unsupportedDshField: 'value' } }
    })).toThrow()
  })

  it('rejects obsolete host settings for installed domain packages', () => {
    expect(() => settingsPatchSchema.parse({
      evidenceDag: { enabled: false }
    })).toThrow()
  })


  it('accepts a positive contextWindow and rejects invalid values', () => {
    const parsed = settingsPatchSchema.parse({
      modelRouter: {
        profiles: {
          default: {
            textReasoner: { contextWindow: 131072 }
          }
        }
      }
    })
    expect(parsed.modelRouter?.profiles?.default?.textReasoner?.contextWindow).toBe(131072)
    for (const bad of [{ contextWindow: -1 }, { contextWindow: 0 }, { contextWindow: 1.5 }, { contextWindow: 17_000_000 }]) {
      expect(() => settingsPatchSchema.parse({
        modelRouter: { profiles: { default: { textReasoner: bad } } }
      })).toThrow()
    }
  })

  it('accepts a per-model reasoning effort vocabulary on every member role', () => {
    const parsed = settingsPatchSchema.parse({
      modelRouter: {
        profiles: {
          default: {
            textReasoner: { reasoningEfforts: [' low ', 'high', 'xhigh', 'max'] },
            imageGenerator: { reasoningEfforts: ['off'] },
            translators: {
              vision: { reasoningEfforts: ['minimal', 'low'] },
              scientific: { reasoningEfforts: ['high'] }
            }
          }
        }
      }
    })

    const profile = parsed.modelRouter?.profiles?.default
    expect(profile?.textReasoner?.reasoningEfforts).toEqual(['low', 'high', 'xhigh', 'max'])
    expect(profile?.imageGenerator?.reasoningEfforts).toEqual(['off'])
    expect(profile?.translators?.vision?.reasoningEfforts).toEqual(['minimal', 'low'])
    expect(profile?.translators?.scientific?.reasoningEfforts).toEqual(['high'])
  })

  it('accepts only declared Chat structured-output modes', () => {
    for (const mode of ['json_schema', 'json_object'] as const) {
      expect(settingsPatchSchema.parse({
        modelRouter: { profiles: { default: { textReasoner: { chatStructuredOutputMode: mode } } } }
      }).modelRouter?.profiles?.default?.textReasoner?.chatStructuredOutputMode).toBe(mode)
    }
    for (const bad of ['text', 'JSON_OBJECT', '', 1]) {
      expect(() => settingsPatchSchema.parse({
        modelRouter: { profiles: { default: { textReasoner: { chatStructuredOutputMode: bad } } } }
      })).toThrow()
    }
  })

  it('rejects malformed reasoning effort vocabularies', () => {
    for (const bad of [
      { reasoningEfforts: 'low' },
      { reasoningEfforts: [''] },
      { reasoningEfforts: ['   '] },
      { reasoningEfforts: [42] },
      { reasoningEfforts: ['x'.repeat(33)] },
      { reasoningEfforts: Array.from({ length: 33 }, (_, index) => `effort-${index}`) }
    ]) {
      expect(() => settingsPatchSchema.parse({
        modelRouter: { profiles: { default: { textReasoner: bad } } }
      })).toThrow()
    }
  })

  it('rejects legacy Model Router member fields', () => {
    for (const member of [
      { provider: 'legacy-provider' },
      { maxSupplementRounds: 1 },
      { timeoutMs: 60_000 }
    ]) {
      expect(() => settingsPatchSchema.parse({
        modelRouter: {
          profiles: {
            default: {
              textReasoner: member
            }
          }
        }
      })).toThrow(/Unrecognized key/)
    }
  })

  it.each(['use', 'bypass'])('accepts model edits with persisted vision cache policy %s', (visionCachePolicy) => {
    const patch = {
      modelRouter: {
        profiles: { default: { visionCachePolicy, textReasoner: { model: 'updated-model' } } }
      }
    }
    expect(settingsPatchSchema.parse(patch)).toEqual(patch)
  })

  it('rejects request-only and unknown persistent vision cache policies', () => {
    for (const visionCachePolicy of ['refresh', 'invalid']) {
      expect(() => settingsPatchSchema.parse({
        modelRouter: { profiles: { default: { visionCachePolicy } } }
      })).toThrow()
    }
  })

  it('accepts workflow AI-agent runtime ownership in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      workflow: {
        workflows: [{
          id: 'workflow-1',
          name: 'Runtime-owned workflow',
          enabled: true,
          callableByAgent: true,
          nodes: [{
            id: 'agent-1',
            type: 'ai-agent',
            config: {
              prompt: 'Run the workflow task.',
              workspaceRoot: '/tmp/workspace',
              runtimeId: 'dsh',
              model: '',
              reasoningEffort: 'high',
              mode: 'agent'
            }
          }]
        }]
      }
    })

    const workflow = payload.workflow?.workflows?.[0]
    expect(workflow?.nodes?.[0]).toMatchObject({
      type: 'ai-agent',
      config: { runtimeId: 'dsh' }
    })
  })

  it('rejects Local Runtime credential override patches', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          sciforge: {
            apiKey: 'sk-local',
            baseUrl: 'https://local-runtime.example/v1',
            providerId: 'legacy-provider'
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects write inline direct-provider override patches', () => {
    expect(() =>
      settingsPatchSchema.parse({
        write: {
          inlineCompletion: {
            apiKey: 'sk-write-only',
            baseUrl: 'https://write-only.example/v1'
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects write inline model override patches', () => {
    expect(() =>
      settingsPatchSchema.parse({
        write: {
          inlineCompletion: {
            inheritModel: false,
            model: 'deepseek-v4-pro'
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects legacy computer-use backend patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        computerUse: {
          backend: 'global-native'
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        computerUse: {
          experimentalAppScopedBackend: true
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('accepts schedule settings patches and task payloads', () => {
    const payload = settingsPatchSchema.parse({
      schedule: {
        enabled: true,
        keepAwake: true,
        defaultWorkspaceRoot: '/tmp/schedule',
        model: 'deepseek-v4-flash',
        mode: 'plan',
        promptPrefix: 'Use the project checklist.',
        skills: {
          defaultNames: ['review'],
          extraDirs: ['/tmp/skills']
        },
        internal: {
          port: 9788,
          secret: 'secret'
        },
        tasks: [{
          id: 'task-1',
          title: 'Daily review',
          enabled: true,
          prompt: 'Review the repo',
          workspaceRoot: '/tmp/schedule',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-task-thread' },
          model: 'auto',
          reasoningEffort: 'high',
          mode: 'agent',
          schedule: {
            kind: 'daily',
            everyMinutes: 60,
            timeOfDay: '09:30',
            atTime: ''
          },
          lastStatus: 'idle'
        }]
      }
    })

    expect(payload.schedule?.internal?.port).toBe(9788)
    expect(payload.schedule?.tasks?.[0]?.schedule?.kind).toBe('daily')
    expect(payload.schedule?.tasks?.[0]?.reasoningEffort).toBe('high')
    expect(payload.schedule?.tasks?.[0]?.agentThreadIds).toEqual({ codex: 'codex-task-thread' })
    const fromText = scheduleTaskFromTextPayloadSchema.parse({
      text: 'Remind me tomorrow morning to ship the review',
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-pro',
      mode: 'agent'
    })

    expect(fromText.workspaceRoot).toBe('/tmp/schedule')
    expect(fromText.modelHint).toBe('deepseek-v4-pro')
  })

  it('rejects legacy settings keys instead of stripping them', () => {
    expect(() =>
      settingsPatchSchema.parse({
        locale: 'zh',
        reasonix: { model: 'legacy-reasoner' }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        locale: 'zh',
        quickChat: { enabled: true }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          sciforge: { port: 9001 },
          reasonix: { model: 'legacy-reasoner' }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        schedule: {
          tasks: [{
            id: 'task-1',
            lastThreadId: 'legacy-thread'
          }]
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(settingsPatchSchema.parse({
      locale: 'zh',
      agents: {
        sciforge: { port: 9001 }
      }
    }).agents?.sciforge?.port).toBe(9001)
  })

  it('rejects the removed direct-provider settings chain', () => {
    expect(() => settingsPatchSchema.parse({
      provider: {
        apiKey: 'sk-legacy',
        baseUrl: 'https://legacy.example/v1'
      }
    })).toThrow(/Unrecognized key/)
  })

  it('rejects endpoint format patches in settings API payloads', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          sciforge: {
            endpointFormat: 'chat_completions'
          }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        provider: {
          providers: [{
            id: 'deepseek',
            endpointFormat: 'responses'
          }]
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('accepts partial keyboard shortcut binding maps in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      keyboardShortcuts: {
        bindings: {
          settings: ['Ctrl+,']
        }
      }
    })

    expect(payload.keyboardShortcuts?.bindings?.settings).toEqual(['Ctrl+,'])
  })

  it('rejects unknown settings patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          sciforge: {
            mysteryFlag: true
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects the retired Remote Executor settings path', () => {
    expect(() =>
      settingsPatchSchema.parse({
        remoteExecutor: {
          enabled: true
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects legacy local runtime tuning patches in favor of runtime guards', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          sciforge: {
            runtimeTuning: {
              execution: {
                exactRepeatThreshold: 4
              }
            }
          }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(settingsPatchSchema.parse({
      runtimeGuards: {
        execution: {
          exactRepeatThreshold: 4
        }
      }
    }).runtimeGuards).toMatchObject({
      execution: {
        exactRepeatThreshold: 4
      }
    })

    expect(() => settingsPatchSchema.parse({
      runtimeGuards: {
        execution: { semanticFailureThreshold: 3 }
      }
    })).toThrow(/Unrecognized key/)

    expect(() => settingsPatchSchema.parse({
      runtimeGuards: {
        execution: { threshold: 4 }
      }
    })).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        runtimeGuards: {
          execution: {
            softThreshold: 4,
            hardThreshold: 8
          },
          budgets: {
            writeMaxToolEvents: 64
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects unknown schedule patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        schedule: {
          tasks: [{
            id: 'task-1',
            prompt: 'Run',
            schedule: { kind: 'manual' },
            legacyOnlyField: true
          }]
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('allows only safe external URL protocols', () => {
    expect(isSafeOpenExternalUrl('https://deepseek.com')).toBe(true)
    expect(isSafeOpenExternalUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isSafeOpenExternalUrl('mailto:zhongxingyuemail@gmail.com')).toBe(true)
    expect(isSafeOpenExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeOpenExternalUrl('file:///tmp/test')).toBe(false)
    expect(() => shellOpenExternalUrlSchema.parse('javascript:alert(1)')).toThrow(
      /Only http, https, and mailto URLs are allowed/
    )
  })

  it('accepts workspace directory payloads without a child path', () => {
    const payload = workspaceDirectoryTargetPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace'
    })

    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.path).toBeUndefined()
  })

  it('accepts workspace directory create payloads', () => {
    const payload = workspaceDirectoryCreatePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: 'notes'
    })

    expect(payload.path).toBe('notes')
  })

  it('accepts workspace rename payloads', () => {
    const payload = workspaceEntryRenamePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md',
      newName: 'final.md'
    })

    expect(payload.newName).toBe('final.md')
  })

  it('accepts PDF rename suggestion payloads', () => {
    const payload = workspacePdfRenameSuggestionPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: 'papers/2603.10165v2.pdf'
    })

    expect(payload.path).toBe('papers/2603.10165v2.pdf')
  })

  it('accepts workspace delete payloads', () => {
    const payload = workspaceEntryDeletePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
  })

  it('accepts workspace copy and move payloads with a root target directory', () => {
    const copyPayload = workspaceEntryCopyPayloadSchema.parse({
      sourceWorkspaceRoot: '/tmp/source',
      sourcePath: 'draft.md',
      targetWorkspaceRoot: '/tmp/target',
      targetDirectory: '',
      conflictPolicy: { strategy: 'rename' }
    })
    const movePayload = workspaceEntryMovePayloadSchema.parse({
      sourceWorkspaceRoot: '/tmp/source',
      sourcePath: 'draft.md',
      targetWorkspaceRoot: '/tmp/target',
      targetDirectory: 'notes',
      conflictPolicy: { strategy: 'overwrite' }
    })

    expect(copyPayload.targetDirectory).toBe('')
    expect(copyPayload.conflictPolicy).toEqual({ strategy: 'rename' })
    expect(movePayload.targetDirectory).toBe('notes')
    expect(movePayload.conflictPolicy).toEqual({ strategy: 'overwrite' })
  })

  it('accepts workspace import payloads with multiple source paths', () => {
    const payload = workspaceEntryImportPayloadSchema.parse({
      sourcePaths: ['/tmp/source/a.csv', '/tmp/source/images'],
      targetWorkspaceRoot: '/tmp/workspace',
      targetDirectory: '',
      conflictPolicy: {
        strategy: 'rename',
        renameTemplate: '{name} ({n}){ext}',
        maxAttempts: 5
      }
    })

    expect(payload.sourcePaths).toEqual(['/tmp/source/a.csv', '/tmp/source/images'])
    expect(payload.targetDirectory).toBe('')
    expect(payload.conflictPolicy).toEqual({
      strategy: 'rename',
      renameTemplate: '{name} ({n}){ext}',
      maxAttempts: 5
    })
  })

  it('accepts workspace clipboard paste payloads', () => {
    const payload = workspaceClipboardPastePayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      targetDirectory: ' notes ',
      conflictPolicy: { strategy: 'skip' }
    })

    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.targetDirectory).toBe('notes')
    expect(payload.conflictPolicy).toEqual({ strategy: 'skip' })
  })

  it('accepts structured inline completion payloads', () => {
    const payload = writeInlineCompletionPayloadSchema.parse({
      prefix: '## Heading\n\nSome intro',
      suffix: '',
      mode: 'edit',
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/notes.md',
      cursor: {
        line: 3,
        column: 10
      },
      context: {
        language: 'markdown',
        currentLinePrefix: 'Some intro',
        currentLineSuffix: '',
        previousLine: '',
        previousNonEmptyLine: '## Heading',
        nextLine: '',
        indentation: '',
        signals: {
          list: false,
          quote: false,
          heading: false,
          table: false,
          atLineEnd: true,
          endsWithSentencePunctuation: false,
          previousLineEndsWithSentencePunctuation: false,
          prefersNewLineCompletion: false,
          paragraphBreakOpportunity: false
        }
      },
      policy: {
        name: 'precision-inline-v2',
        instruction: 'Return only the inserted text.',
        acceptanceCriteria: ['Keep it short.'],
        rejectionCriteria: ['Do not ramble.']
      },
      preview: {
        local: 'Some intro',
        documentTail: '## Heading Some intro'
      },
      editCandidate: {
        kind: 'paragraph',
        from: 12,
        to: 22,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 10,
        original: 'Some intro',
        selectedText: 'Some'
      },
      recentEdits: [{
        source: 'user',
        ageMs: 1_200,
        filePath: '/tmp/workspace/notes.md',
        from: 12,
        to: 16,
        deletedText: 'Old',
        insertedText: 'Some',
        beforeContext: '',
        afterContext: ' intro'
      }]
    })

    expect(payload.mode).toBe('edit')
    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.cursor.line).toBe(3)
    expect(payload.editCandidate?.kind).toBe('paragraph')
    expect(payload.recentEdits?.[0].insertedText).toBe('Some')
  })

  it('rejects inline completion payload model overrides', () => {
    expect(() =>
      writeInlineCompletionPayloadSchema.parse({
        prefix: 'Hello',
        suffix: '',
        cursor: { line: 1, column: 5 },
        context: {
          language: 'markdown',
          currentLinePrefix: 'Hello',
          currentLineSuffix: '',
          previousLine: '',
          previousNonEmptyLine: '',
          nextLine: '',
          indentation: '',
          signals: {
            list: false,
            quote: false,
            heading: false,
            table: false,
            atLineEnd: true,
            endsWithSentencePunctuation: false,
            previousLineEndsWithSentencePunctuation: false,
            prefersNewLineCompletion: false,
            paragraphBreakOpportunity: false
          }
        },
        policy: {
          name: 'precision-inline-v2',
          instruction: 'Return only text.',
          acceptanceCriteria: [],
          rejectionCriteria: []
        },
        preview: {
          local: 'Hello',
          documentTail: 'Hello'
        },
        model: 'deepseek-v4-pro'
      })
    ).toThrow(/Unrecognized key/)
  })

  it('accepts structured write retrieval payloads', () => {
    const payload = writeRetrievalPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      currentFilePath: ' /tmp/workspace/draft.md ',
      query: ' 面向科学场景的大模型复杂推理 ',
      maxSnippets: 4,
      includeCurrentFile: true
    })

    expect(payload).toEqual({
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/draft.md',
      query: '面向科学场景的大模型复杂推理',
      maxSnippets: 4,
      includeCurrentFile: true
    })
  })

  it('rejects empty write retrieval queries and excessive snippet counts', () => {
    expect(() =>
      writeRetrievalPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        query: ' '
      })
    ).toThrow()

    expect(() =>
      writeRetrievalPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        query: 'science',
        maxSnippets: 9
      })
    ).toThrow()
  })

  it('accepts write export payloads', () => {
    const payload = writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'docx',
      content: '# Draft',
      runtimeId: 'codex',
      threadId: 'thread-1',
      overrideConfirmed: true
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.format).toBe('docx')
    expect(payload.content).toBe('# Draft')
    expect(payload.runtimeId).toBe('codex')
    expect(payload.threadId).toBe('thread-1')
    expect(payload.overrideConfirmed).toBe(true)
    expect(() => writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      format: 'docx',
      content: '# Draft',
      evidenceDagGateOverride: true
    })).toThrow()

    expect(writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'tex',
      content: '# Draft'
    }).format).toBe('tex')
  })

})
