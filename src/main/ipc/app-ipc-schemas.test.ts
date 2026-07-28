import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS,
  type AgentRuntimeAuxiliaryOperation
} from '../../shared/agent-runtime-contract'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import {
  agentRuntimeApprovalResolvePayloadSchema,
  agentRuntimeAuxiliaryPayloadSchema,
  agentRuntimeListThreadsPayloadSchema,
  agentRuntimeReadThreadPayloadSchema,
  agentRuntimeReadThreadSidebarProbePayloadSchema,
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
  connectPhoneInstallQrPayloadSchema,
  connectPhoneInstallPollPayloadSchema,
  domainExtensionInstallPayloadSchema,
  domainExtensionListPayloadSchema,
  domainExtensionListResultSchema,
  domainExtensionPackagePayloadSchema,
  domainExtensionSetEnabledPayloadSchema,
  domainExtensionSummarySchema,
  visualStyleExtractPayloadSchema,
  visualStyleSaveProfilePayloadSchema,
  isSafeOpenExternalUrl,
  remoteChannelActiveThreadContextPayloadSchema,
  remoteChannelMirrorPayloadSchema,
  remoteChannelTaskFromTextPayloadSchema,
  scheduleTaskFromTextPayloadSchema,
  settingsPatchSchema,
  shellOpenExternalUrlSchema,
  speechTranscriptionPayloadSchema,
  traceExportPayloadSchema,
  traceReadPayloadSchema,
  traceSummariesPayloadSchema,
  visualDocumentInsertArtifactPayloadSchema,
  visualDocumentSaveAnnotationsPayloadSchema,
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
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writeRetrievalPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas', () => {
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
      packageName: ' @sciforge/domain-browser '
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
      packageName: 'domain-browser'
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

  it('accepts bounded protocol-neutral full-trace queries', () => {
    expect(traceReadPayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      kinds: ['model_request', 'agent_event'],
      order: 'desc',
      limit: 20
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      kinds: ['model_request', 'agent_event'],
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
      relation: 'side',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    })
  })

  it('accepts neutral agent runtime turn payloads', () => {
    const payload = agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'claude',
      threadId: ' thread-1 ',
      text: ' hello ',
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
      governanceProfile: 'remote_guard',
      visibleContextOwnerThreadId: ' parent-thread ',
      fileReferences: [{
        path: ' /tmp/workspace/docs/spec.pdf ',
        relativePath: ' docs/spec.pdf ',
        name: ' spec.pdf ',
        kind: 'pdf',
        delivery: 'model_router_object',
        mimeType: ' application/pdf ',
        modelRouterObject: true
      }]
    })

    expect(payload).toEqual({
      runtimeId: 'claude',
      threadId: 'thread-1',
      text: 'hello',
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
      governanceProfile: 'remote_guard',
      visibleContextOwnerThreadId: 'parent-thread',
      fileReferences: [{
        path: '/tmp/workspace/docs/spec.pdf',
        relativePath: 'docs/spec.pdf',
        name: 'spec.pdf',
        kind: 'pdf',
        delivery: 'model_router_object',
        mimeType: 'application/pdf',
        modelRouterObject: true
      }]
    })
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

  it('accepts strict VisualDocument artifacts and normalized review annotations', () => {
    expect(visualDocumentInsertArtifactPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      documentId: ' thread-1 ',
      kind: 'generated_image',
      sourcePath: ' .sciforge/images/cover.png ',
      manifestPath: ' .sciforge/artifacts/cover.manifest.json '
    })).toMatchObject({
      workspaceRoot: '/tmp/workspace',
      documentId: 'thread-1',
      kind: 'generated_image',
      sourcePath: '.sciforge/images/cover.png',
      manifestPath: '.sciforge/artifacts/cover.manifest.json'
    })

    expect(visualDocumentInsertArtifactPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      kind: 'edited_image',
      sourcePath: '.sciforge/images/cover-v2.png'
    }).kind).toBe('edited_image')

    expect(visualDocumentSaveAnnotationsPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      annotations: [{
        geometry: { kind: 'box', bounds: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } },
        instruction: ' Increase the whitespace. '
      }]
    }).annotations[0]?.instruction).toBe('Increase the whitespace.')

    expect(() => visualDocumentSaveAnnotationsPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      annotations: [{
        geometry: { kind: 'pin', point: { x: 1.2, y: 0.5 } },
        instruction: 'Invalid coordinate'
      }]
    })).toThrow()
  })

  it('accepts bounded visual style extraction payloads', () => {
    expect(visualStyleExtractPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      sourcePath: ' figures/reference.png ',
      sourceType: 'image',
      sourceKind: 'reference',
      scope: 'manuscript',
      figureId: ' Fig. 2A ',
      notes: ' Use only visual style. '
    })).toEqual({
      workspaceRoot: '/tmp/workspace',
      sourcePath: 'figures/reference.png',
      sourceType: 'image',
      sourceKind: 'reference',
      scope: 'manuscript',
      figureId: 'Fig. 2A',
      notes: 'Use only visual style.'
    })

    expect(() =>
      visualStyleExtractPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        sourcePath: 'figure.png',
        scope: 'global'
      })
    ).toThrow()
  })

  it('accepts visual style profile saves with controlled artifact paths', () => {
    const profile = {
      version: 1 as const,
      id: 'manuscript-default',
      scope: 'manuscript' as const,
      source: { type: 'reference', path: 'figures/reference.png' },
      tokens: {
        canvas: { width: 640, height: 420, aspectRatio: 1.52, background: '#ffffff' },
        palette: { colors: ['#123456'], background: '#ffffff', ink: '#222222', accent: ['#123456'], colorMode: 'limited' as const },
        typography: { fontFamily: 'Arial', axisSize: 8, labelSize: 9, titleSize: 11, weight: 'regular' as const },
        strokes: { ink: '#222222', primaryWidth: 1.2, secondaryWidth: 0.6, lineCap: 'round' as const },
        spacing: { margin: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 }, gutter: 'balanced' as const, density: 'balanced' as const },
        shapes: { fillMode: 'mixed' as const, shadow: 'none' as const }
      },
      semanticDescription: 'Calm, compact scientific visual language.',
      confidence: { overall: 0.8, palette: 0.9, spacing: 0.7, plots: 0.5, typography: 0.4, generatedAssets: 0.3 }
    }
    expect(visualStyleSaveProfilePayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      path: ' .sciforge/visual-styles/manuscript-default.json ',
      profile,
      diagnostics: {
        analyzedAt: '2026-07-12T00:00:00.000Z',
        sampledPixels: 100,
        foregroundRatio: 0.3,
        darkPixelRatio: 0.2,
        chromaRatio: 0.1,
        warnings: []
      }
    })).toEqual({
      workspaceRoot: '/tmp/workspace',
      path: '.sciforge/visual-styles/manuscript-default.json',
      profile,
      diagnostics: {
        analyzedAt: '2026-07-12T00:00:00.000Z',
        sampledPixels: 100,
        foregroundRatio: 0.3,
        darkPixelRatio: 0.2,
        chromaRatio: 0.1,
        warnings: []
      }
    })

    expect(() =>
      visualStyleSaveProfilePayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        profile: { ...profile, confidence: { ...profile.confidence, overall: 2 } },
        diagnostics: {
          analyzedAt: '2026-07-12T00:00:00.000Z',
          sampledPixels: 100,
          foregroundRatio: 0.3,
          darkPixelRatio: 0.2,
          chromaRatio: 0.1,
          warnings: []
        }
      })
    ).toThrow()
  })

  it('accepts neutral agent runtime event subscription and control payloads', () => {
    expect(agentRuntimeListThreadsPayloadSchema.parse({
      runtimeId: 'sciforge',
      limit: 20,
      search: ' side path ',
      includeArchived: true,
      includeSide: true,
      summary: true
    })).toEqual({
      runtimeId: 'sciforge',
      limit: 20,
      search: 'side path',
      includeArchived: true,
      includeSide: true,
      summary: true
    })

    expect(agentRuntimeEventSubscribePayloadSchema.parse({
      runtimeId: 'sciforge',
      threadId: ' thread-1 ',
      sinceSeq: 7,
      streamId: ' stream-1 '
    })).toEqual({
      runtimeId: 'sciforge',
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
      runtimeId: 'sciforge',
      threadId: ' thread-1 ',
      reason: ' Manual cleanup '
    })).toEqual({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      reason: 'Manual cleanup'
    })

    expect(agentRuntimeThreadForkPayloadSchema.parse({
      runtimeId: 'sciforge',
      threadId: ' thread-1 ',
      relation: ' side ',
      title: ' Side path '
    })).toEqual({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })

    expect(agentRuntimeSessionResumePayloadSchema.parse({
      runtimeId: 'sciforge',
      sessionId: ' session-1 ',
      model: ' deepseek-v4-pro ',
      mode: ' agent ',
      maxResumeCount: 3
    })).toEqual({
      runtimeId: 'sciforge',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      maxResumeCount: 3
    })

    expect(agentRuntimeThreadRelationPayloadSchema.parse({
      runtimeId: 'sciforge',
      threadId: ' thread-1 ',
      relation: ' primary '
    })).toEqual({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'primary'
    })

    expect(agentRuntimeUsagePayloadSchema.parse({
      runtimeId: 'sciforge',
      groupBy: 'day',
      from: ' 2026-06-01 ',
      to: ' 2026-06-11 ',
      timezone: ' Asia/Shanghai '
    })).toEqual({
      runtimeId: 'sciforge',
      groupBy: 'day',
      from: '2026-06-01',
      to: '2026-06-11',
      timezone: 'Asia/Shanghai'
    })
  })

  it('requires explicit runtime ids for thread, turn, session, and interaction runtime payloads', () => {
    const cases = [
      ['startThread', agentRuntimeStartThreadPayloadSchema, { title: 'New thread' }],
      ['readThread', agentRuntimeReadThreadPayloadSchema, { threadId: 'thread-1' }],
      ['readThreadSidebarProbe', agentRuntimeReadThreadSidebarProbePayloadSchema, { threadId: 'thread-1' }],
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
    expect(agentRuntimeUsagePayloadSchema.parse({ groupBy: 'thread', threadId: 'thread-1' })).toEqual({
      groupBy: 'thread',
      threadId: 'thread-1'
    })
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
        runtimeId: 'sciforge',
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
      mimeType: ' chemical/x-pdb ',
      mode: ' inspect '
    })).toEqual({
      path: 'protein.PDB',
      workspaceRoot: '/tmp/workspace',
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
          maxParallel: 3,
          maxChildRuns: 4
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
          approvalPolicy: 'never',
          sandboxMode: 'workspace-write'
        },
        claude: {
          command: 'claude',
          configDir: '/tmp/claude-code',
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          extraArgs: ['--allowedTools', 'Edit']
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
      remoteExecutor: {
        enabled: true,
        defaultTargetId: 'hpc-1',
        targets: [{
          id: 'hpc-1',
          label: 'HPC',
          enabled: true,
          kind: 'slurm',
          remoteWorkspaceRoot: '/remote/workspace',
          ssh: {
            host: 'login.example.edu',
            user: 'alice',
            port: 22,
            pythonPath: '/usr/bin/python3',
            identityFile: '/Users/alice/.ssh/id_ed25519'
          },
          slurm: {
            defaults: {
              partition: 'gpu',
              account: 'lab',
              qos: 'normal',
              timeLimit: '01:00:00',
              nodes: 1,
              ntasks: 1,
              cpusPerTask: 8,
              gpus: 1,
              memory: '32G',
              constraint: 'a100',
              gres: 'gpu:a100:1',
              extraArgs: ['--exclusive']
            }
          },
          trustedWorkspaces: [{
            workspaceRoot: '/repo/project',
            targetFingerprint: 'fp-1',
            trustedAt: '2026-01-01T00:00:00.000Z',
            trustedBy: 'user',
            approvalBypass: true
          }]
        }]
      }
    })

    expect(payload.agents?.sciforge?.port).toBe(9000)
    expect(payload.agents?.sciforge?.tokenEconomy?.enabled).toBe(true)
    expect(payload.agents?.sciforge?.tokenEconomy?.historyHygiene?.maxToolResultTokens).toBe(4000)
    expect(payload.activeAgentRuntime).toBe('claude')
    expect(payload.agentCapabilities?.subagents?.maxParallel).toBe(3)
    expect(payload.agentCapabilities?.subagents?.maxChildRuns).toBe(4)
    expect(payload.modelAccess).toEqual({ mode: 'api', planAdapterId: '' })
    expect(payload.agents?.codex?.codexHome).toBe('/tmp/codex-home')
    expect(payload.agents?.claude?.configDir).toBe('/tmp/claude-code')
    expect(payload.write?.inlineCompletion?.maxTokens).toBe(128)
    expect(payload.speechToText?.baseUrl).toBe('')
    expect(payload.modelRouter?.profiles?.default?.imageGenerator?.model).toBe('image-model')
    expect(payload.remoteExecutor?.defaultTargetId).toBe('hpc-1')
    expect(payload.remoteExecutor?.targets?.[0]?.slurm?.defaults?.extraArgs).toEqual(['--exclusive'])
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

  it('rejects obsolete host settings for installed domain packages', () => {
    expect(() => settingsPatchSchema.parse({
      evidenceDag: { enabled: false }
    })).toThrow()
  })

  it('accepts normalized full settings snapshots with persisted remote-channel failures', () => {
    const base = normalizeAppSettings({} as AppSettingsV1)
    const failure = {
      provider: 'zulip' as const,
      message: 'Runtime offline',
      failureKind: 'runtime_unavailable',
      failureTitle: 'Runtime unavailable',
      channelId: 'channel-1',
      chatId: 'chat-1',
      remoteThreadId: 'remote-thread-1',
      threadId: 'thread-1',
      runtimeId: 'codex' as const,
      occurredAt: '2026-07-19T00:00:00.000Z'
    }
    const normalized = normalizeAppSettings({
      ...base,
      remoteChannel: {
        ...base.remoteChannel,
        enabled: true,
        channels: [{
          id: 'zulip-1',
          provider: 'zulip',
          label: 'Zulip',
          enabled: true,
          model: 'auto',
          workspaceRoot: '/tmp/workspace',
          lastFailure: failure,
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: 'remote-thread-1',
            latestMessageId: 'message-1',
            senderId: 'sender-1',
            senderName: 'User',
            agentThreadIds: { codex: 'thread-1' },
            workspaceRoot: '/tmp/workspace',
            lastFailure: failure,
            createdAt: '2026-07-19T00:00:00.000Z',
            updatedAt: '2026-07-19T00:00:00.000Z'
          }],
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: '2026-07-19T00:00:00.000Z'
        }]
      }
    } as AppSettingsV1)

    const payload = settingsPatchSchema.parse(normalized)
    expect(payload.remoteChannel?.channels?.[0]?.lastFailure).toEqual(failure)
    expect(payload.remoteChannel?.channels?.[0]?.conversations?.[0]?.lastFailure).toEqual(failure)
  })

  it('keeps persisted remote-channel failure payloads strict', () => {
    expect(() => settingsPatchSchema.parse({
      remoteChannel: {
        channels: [{
          lastFailure: {
            provider: 'zulip',
            message: 'Runtime offline',
            occurredAt: '2026-07-19T00:00:00.000Z',
            unexpected: true
          }
        }]
      }
    })).toThrow(/Unrecognized key/)
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
              runtimeId: 'sciforge',
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
      config: { runtimeId: 'sciforge' }
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
      },
      remoteChannel: {
        channels: [{
          id: 'channel-1',
          provider: 'feishu',
          label: 'Team',
          enabled: true,
          model: 'auto',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-channel-thread' },
          workspaceRoot: '/tmp/claw',
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            latestMessageId: 'message-1',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'codex-conversation-thread' },
            workspaceRoot: '/tmp/claw'
          }]
        }]
      }
    })

    expect(payload.schedule?.internal?.port).toBe(9788)
    expect(payload.schedule?.tasks?.[0]?.schedule?.kind).toBe('daily')
    expect(payload.schedule?.tasks?.[0]?.reasoningEffort).toBe('high')
    expect(payload.schedule?.tasks?.[0]?.agentThreadIds).toEqual({ codex: 'codex-task-thread' })
    expect(payload.remoteChannel?.channels?.[0]?.agentThreadIds).toEqual({ codex: 'codex-channel-thread' })
    expect(payload.remoteChannel?.channels?.[0]?.conversations?.[0]?.agentThreadIds).toEqual({
      codex: 'codex-conversation-thread'
    })

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
        remoteChannel: {
          channels: [{
            id: 'channel-1',
            threadId: 'legacy-thread'
          }]
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        remoteChannel: {
          channels: [{
            id: 'channel-1',
            conversations: [{
              id: 'conversation-1',
              localThreadId: 'legacy-thread'
            }]
          }]
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

  it('enforces canonical settings domains for remote-channel and connect-phone patches', () => {
    expect(() =>
      settingsPatchSchema.parse({
        claw: {}
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        remoteChannel: {
          tasks: []
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        remoteChannel: {
          im: {
            openClawGatewayUrl: 'https://gateway.example/webhook'
          }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(() =>
      settingsPatchSchema.parse({
        remoteChannel: {
          im: {
            weixinBridgeUrl: 'https://weixin.example/bridge'
          }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(settingsPatchSchema.parse({
      connectPhone: {
        weixinBridgeUrl: ' https://weixin.example/bridge '
      }
    }).connectPhone?.weixinBridgeUrl).toBe('https://weixin.example/bridge')
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
          exactRepeatThreshold: 4,
          semanticFailureThreshold: 3
        }
      }
    }).runtimeGuards).toMatchObject({
      execution: {
        exactRepeatThreshold: 4,
        semanticFailureThreshold: 3
      }
    })

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
            legacyClawOnlyField: true
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

  it('accepts long Feishu install device codes', () => {
    const deviceCode = 'x'.repeat(2_048)
    const payload = connectPhoneInstallPollPayloadSchema.parse({
      provider: 'feishu',
      deviceCode
    })

    expect(payload.deviceCode).toBe(deviceCode)
  })

  it('accepts canonical connect-phone and remote-channel IPC payloads', async () => {
    const schemas = await import('./app-ipc-schemas')
    expect('clawImInstallQrPayloadSchema' in schemas).toBe(false)
    expect('clawImInstallPollPayloadSchema' in schemas).toBe(false)
    expect('clawActiveThreadContextPayloadSchema' in schemas).toBe(false)
    expect('clawMirrorPayloadSchema' in schemas).toBe(false)
    expect('clawTaskFromTextPayloadSchema' in schemas).toBe(false)
    expect(connectPhoneInstallQrPayloadSchema.parse({
      provider: 'feishu',
      isLark: true
    })).toEqual({
      provider: 'feishu',
      isLark: true
    })
    expect(connectPhoneInstallPollPayloadSchema.parse({
      provider: 'weixin',
      deviceCode: ' device-1 '
    })).toEqual({
      provider: 'weixin',
      deviceCode: 'device-1'
    })
    expect(remoteChannelActiveThreadContextPayloadSchema.parse({
      threadId: ' thread-1 ',
      runtimeId: 'codex',
      workspaceRoot: ' /tmp/workspace '
    })).toEqual({
      threadId: 'thread-1',
      runtimeId: 'codex',
      workspaceRoot: '/tmp/workspace'
    })
    expect(remoteChannelMirrorPayloadSchema.parse({
      threadId: ' thread-1 ',
      text: ' hello ',
      direction: 'user'
    })).toEqual({
      threadId: 'thread-1',
      text: 'hello',
      direction: 'user'
    })
    expect(remoteChannelTaskFromTextPayloadSchema.parse({
      text: ' schedule ',
      channelId: ' channel-1 ',
      modelHint: ' auto ',
      mode: 'agent'
    })).toEqual({
      text: 'schedule',
      channelId: 'channel-1',
      modelHint: 'auto',
      mode: 'agent'
    })
  })

  it('accepts Discord Client ID, binding, and guarded takeover payloads', async () => {
    const schemas = await import('./app-ipc-schemas')

    expect(schemas.discordConfigureClientPayloadSchema.parse({
      clientId: ' client-1 '
    })).toEqual({ clientId: 'client-1' })

    expect(schemas.discordConfigureProxyPayloadSchema.parse({
      proxyUrl: ' http://127.0.0.1:7890 '
    })).toEqual({ proxyUrl: 'http://127.0.0.1:7890' })

    expect(schemas.discordBindChannelPayloadSchema.parse({
      channelConfigId: ' config-1 ',
      guildId: ' guild-1 ',
      guildName: ' Support ',
      channelId: ' channel-1 ',
      channelName: ' support ',
      enabled: false,
      workspaceRoot: '/tmp/support',
      model: 'deepseek-v4-flash',
      agentProfile: {
        name: 'Support bot'
      }
    })).toMatchObject({
      channelConfigId: 'config-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      workspaceRoot: '/tmp/support',
      model: 'deepseek-v4-flash',
      agentProfile: { name: 'Support bot' }
    })

    expect(schemas.discordSetGuardPayloadSchema.parse({
      enabled: true,
      channelConfigId: ' config-1 ',
      forceTakeover: true
    })).toEqual({
      enabled: true,
      channelConfigId: 'config-1',
      forceTakeover: true
    })
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

  it('accepts write rich clipboard payloads', () => {
    const payload = writeRichClipboardPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.content).toBe('# Draft')
  })
})
