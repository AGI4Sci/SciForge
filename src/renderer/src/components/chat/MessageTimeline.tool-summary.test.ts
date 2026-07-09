import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RemoteChannelV1 } from '@shared/app-settings'
import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline, summarizeToolBlock } from './MessageTimeline'
import { MessageBubble } from './message-timeline-bubbles'
import {
  resolveMarkdownImageReference,
  timelineCanvasArtifactsFromToolBlock,
  timelineImagesFromToolBlock,
  timelineImagesFromToolBlocks
} from './message-timeline-media'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'

const labels: Record<string, string> = {
  toolActionCommand: 'Ran command',
  toolBuiltinRead: 'Read',
  toolBuiltinWrite: 'Write',
  toolBuiltinEdit: 'Edit',
  toolBuiltinGrep: 'Search',
  toolBuiltinFind: 'Find',
  toolBuiltinLs: 'List',
  toolBuiltinBash: 'Bash',
  reasoningVisibility: 'Reasoning visibility',
  reasoningVisibilitySummary: 'Summary',
  reasoningVisibilityTrace: 'Trace',
  reasoningVisibilityFullRuntimeText: 'Full runtime text',
  reasoningVisibilityNone: 'Hidden',
  reasoningSource: 'Reasoning source',
  reasoningSourceModel: 'Model',
  reasoningSourceRuntimeSummary: 'Runtime summary',
  reasoningSourceBackendRedacted: 'Redacted',
  reasoningSourceUnknown: 'Unknown source'
}

const t = (key: string) => labels[key] ?? (key === 'toolActionCommand' ? 'Ran command' : key)

const activeThread: NormalizedThread = {
  id: 'thr_1',
  title: 'Thread',
  updatedAt: '2026-06-07T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    ...overrides
  }
}

function remoteChannel(overrides: Partial<RemoteChannelV1> = {}): RemoteChannelV1 {
  const base: RemoteChannelV1 = {
    id: 'discord-channel',
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
    runtimeId: 'codex',
    agentThreadIds: {
      codex: 'thr_1'
    },
    workspaceRoot: '/tmp/project',
    agentProfile: {
      name: 'discord bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    recentMessages: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z'
  }
  return { ...base, ...overrides }
}

describe('MessageTimeline tool summaries', () => {
  it('keeps reasoning, tool work, and intermediate output in one chronological process stream', () => {
    const sections = groupProcessSections([
      { kind: 'reasoning', id: 'reasoning_1', text: 'inspect the plan' },
      toolBlock({ id: 'tool_read', summary: 'read: file' }),
      { kind: 'assistant', id: 'intermediate', text: 'I found the config.' },
      toolBlock({ id: 'tool_grep', summary: 'grep: query' })
    ])

    expect(sections.map((section) => section.kind)).toEqual([
      'execution',
      'execution',
      'execution',
      'execution'
    ])
    expect(sections.map((section) => section.blocks.map((block) => block.id))).toEqual([
      ['reasoning_1'],
      ['tool_read'],
      ['intermediate'],
      ['tool_grep']
    ])
  })

  it('summarizes built-in read/write/edit tools with their file path', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'read: file',
          meta: { toolName: 'read' },
          filePath: '/tmp/readme.md'
        }),
        t
      )
    ).toBe('Read /tmp/readme.md')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'write: file',
          meta: { toolName: 'write' },
          filePath: '/tmp/out.ts'
        }),
        t
      )
    ).toBe('Write /tmp/out.ts')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'edit: file',
          meta: { toolName: 'edit' },
          filePath: '/tmp/app.ts'
        }),
        t
      )
    ).toBe('Edit /tmp/app.ts')
  })

  it('summarizes built-in grep/find with pattern context', () => {
    const grep = summarizeToolBlock(
      toolBlock({
        summary: 'grep: search',
        meta: { toolName: 'grep', pattern: 'needle' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(grep).toBe('Search needle · /tmp/src')

    const find = summarizeToolBlock(
      toolBlock({
        summary: 'find: files',
        meta: { toolName: 'find', pattern: '*.ts' },
        filePath: '/tmp/src'
      }),
      t
    )
    expect(find).toBe('Find *.ts · /tmp/src')
  })

  it('summarizes built-in ls with its path and bash with its command', () => {
    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'ls: list',
          meta: { toolName: 'ls' },
          filePath: '/tmp/project'
        }),
        t
      )
    ).toBe('List /tmp/project')

    expect(
      summarizeToolBlock(
        toolBlock({
          summary: 'bash: exec',
          toolKind: 'command_execution',
          meta: { toolName: 'bash', command: 'npm test' }
        }),
        t
      )
    ).toBe('Ran command npm test')
  })
})

describe('MessageTimeline local runtime metadata smoke', () => {
  beforeEach(() => {
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: 'thr_1',
      threads: [activeThread],
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      remoteChannels: [],
      activeRemoteChannelId: ''
    })
  })

  it('renders user image attachments as thumbnails instead of attachment chips', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_1',
      text: '为什么图片完全没有识别啊',
      meta: {
        attachmentIds: ['att_1'],
        attachments: [{
          id: 'att_1',
          name: 'image.png',
          mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,abc'
        }]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).toContain('为什么图片完全没有识别啊')
    expect(html).not.toContain('Attachments 1')
  })

  it('keeps id-only image attachments in the timeline until their content loads', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_1',
      text: 'attached image',
      meta: {
        attachmentIds: ['att_1']
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('att_1')
    expect(html).toContain('Preview unavailable')
    expect(html).not.toContain('Attachments 1')
  })

  it('renders assistant generated image metadata below markdown text', () => {
    const block: ChatBlock = {
      kind: 'assistant',
      id: 'assistant_1',
      text: 'Here is the image.',
      meta: {
        generatedFiles: [{
          name: 'plot.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,abc'
        }]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('Here is the image.')
    expect(html).toContain('<img')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).toContain('plot.png')
  })

  it('does not render unsupported generated image data URLs as thumbnails', () => {
    const block: ChatBlock = {
      kind: 'assistant',
      id: 'assistant_unsafe_image',
      text: 'Here is the image.',
      meta: {
        generatedFiles: [{
          name: 'plot.png',
          mimeType: 'image/svg+xml',
          dataUrl: 'data:image/svg+xml;base64,AAAA'
        }]
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('plot.png')
    expect(html).toContain('Preview unavailable')
    expect(html).not.toContain('src="data:image/svg+xml;base64,AAAA"')
  })

  it('surfaces successful tool result images in the completed turn body', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_image', text: 'make an image' },
      toolBlock({
        id: 'tool_image',
        summary: 'created image',
        meta: {
          generatedFiles: [{
            fileName: 'generated.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,tool'
          }]
        }
      })
    ]

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('generated.png')
    expect(html).toContain('src="data:image/png;base64,tool"')
  })

  it('extracts image generation MCP artifacts from structured tool detail', () => {
    const block = toolBlock({
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            outputPath: '/tmp/project/.sciforge/images/nature.png',
            manifestPath: '/tmp/project/.sciforge/images/nature.manifest.json',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature.generated-image.artifact.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'generated_image',
        outputPath: '/tmp/project/.sciforge/images/nature.png',
        artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature.generated-image.artifact.json',
        workspaceRoot: '/tmp/project',
        sourceTool: 'image_generation'
      })
    ])
  })

  it('normalizes artifact workspace roots when the runtime points at the .sciforge child folder', () => {
    const block = toolBlock({
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            workspaceRoot: '/tmp/project/.sciforge',
            outputPath: '/tmp/project/nature-infographic/nature-infographic-001.png',
            manifestPath: '/tmp/project/nature-infographic/nature-infographic-001.manifest.json',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-infographic-001.generated-image.artifact.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'generated_image',
        outputPath: '/tmp/project/nature-infographic/nature-infographic-001.png',
        workspaceRoot: '/tmp/project',
        sourceTool: 'image_generation'
      })
    ])
  })

  it('normalizes image cards when the selected workspace is nested under .sciforge', () => {
    const block = toolBlock({
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            workspaceRoot: '/tmp/project/.sciforge/default',
            outputPath: '/tmp/project/science-cover/science-cover-001.png',
            manifestPath: '/tmp/project/science-cover/science-cover-001.manifest.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'generated_image',
        outputPath: '/tmp/project/science-cover/science-cover-001.png',
        workspaceRoot: '/tmp/project',
        sourceTool: 'image_generation'
      })
    ])
  })

  it('keeps the runtime default workspace for artifacts inside nested .sciforge image output dirs', () => {
    const block = toolBlock({
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            outputPath: '/Users/yhh/.sciforge/default_workspace/.sciforge/images/generated-image.png',
            manifestPath: '/Users/yhh/.sciforge/default_workspace/.sciforge/images/generated-image.manifest.json',
            artifactManifestPath: '/Users/yhh/.sciforge/default_workspace/.sciforge/artifacts/generated-image.generated-image.artifact.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'generated_image',
        outputPath: '/Users/yhh/.sciforge/default_workspace/.sciforge/images/generated-image.png',
        workspaceRoot: '/Users/yhh/.sciforge/default_workspace',
        sourceTool: 'image_generation'
      })
    ])
  })

  it('extracts scientific plotting render artifacts from structured tool detail', () => {
    const block = toolBlock({
      summary: 'scientific_plotting_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            outputPath: '/tmp/project/figures/nature-research-flowchart.png',
            manifestPath: '/tmp/project/figures/nature-research-flowchart.manifest.json',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-research-flowchart.scientific-plot.artifact.json'
          }
        }
      }),
      meta: { toolName: 'scientific_plotting_render' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'scientific_plot',
        outputPath: '/tmp/project/figures/nature-research-flowchart.png',
        artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-research-flowchart.scientific-plot.artifact.json',
        workspaceRoot: '/tmp/project',
        sourceTool: 'scientific_plotting'
      })
    ])
  })

  it('extracts ppt-master export artifacts from structured tool detail', () => {
    const block = toolBlock({
      summary: 'ppt_master_export_pptx: exported',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            exitCode: 0,
            pptxPath: '/tmp/project/ppt_nature/exports/nature.pptx',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/ppt_nature.ppt-export.artifact.json'
          }
        }
      }),
      meta: { toolName: 'ppt_master_export_pptx' }
    })

    expect(timelineCanvasArtifactsFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'ppt_export',
        pptxPath: '/tmp/project/ppt_nature/exports/nature.pptx',
        artifactManifestPath: '/tmp/project/.sciforge/artifacts/ppt_nature.ppt-export.artifact.json',
        workspaceRoot: '/tmp/project',
        sourceTool: 'ppt_master'
      })
    ])
  })

  it('renders ppt export artifact cards without an external original opener', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_ppt', text: 'make a ppt' },
      toolBlock({
        id: 'tool_ppt',
        summary: 'ppt_master_export_pptx: exported',
        detail: JSON.stringify({
          structuredContent: {
            result: {
              exitCode: 0,
              pptxPath: '/tmp/project/ppt_nature/exports/nature.pptx',
              artifactManifestPath: '/tmp/project/.sciforge/artifacts/ppt_nature.ppt-export.artifact.json'
            }
          }
        }),
        meta: { toolName: 'ppt_master_export_pptx' }
      })
    ]

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined,
        onOpenImageArtifactInCanvas: () => undefined
      })
    )

    expect(html).toContain('PPTX export')
    expect(html).toContain('Open canvas review')
    expect(html).toContain('Copy file path')
    expect(html).not.toContain('Open original')
  })

  it('extracts generated images from canvas insertion tool artifacts', () => {
    const block = toolBlock({
      summary: 'sciforge_canvas_insert_artifact: inserted',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            canvasId: 'nature-intro-canvas',
            canvasDir: '/tmp/project/.sciforge/canvases/nature-intro-canvas',
            shapeId: 'shape:nature-infographic-001',
            artifact: {
              artifactKind: 'generated_image',
              outputPath: '/tmp/project/.sciforge/images/nature-infographic-001.png',
              artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-infographic-001.artifact.json',
              title: 'Nature Infographic',
              sourceTool: 'image_generation'
            }
          }
        }
      }),
      meta: { toolName: 'sciforge_canvas_insert_artifact' }
    })

    expect(timelineImagesFromToolBlock(block)).toEqual([
      expect.objectContaining({
        artifactKind: 'generated_image',
        outputPath: '/tmp/project/.sciforge/images/nature-infographic-001.png',
        artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-infographic-001.artifact.json',
        workspaceRoot: '/tmp/project',
        canvasId: 'nature-intro-canvas',
        name: 'Nature Infographic',
        sourceTool: 'image_generation'
      })
    ])
  })

  it('keeps the project workspace root when image artifacts are merged across tool blocks', () => {
    const renderBlock = toolBlock({
      id: 'tool_render',
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            outputPath: '/tmp/project/nature-infographic/nature-infographic-001.png',
            manifestPath: '/tmp/project/nature-infographic/nature-infographic-001.manifest.json',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/nature-infographic-001.generated-image.artifact.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })
    const canvasBlock = toolBlock({
      id: 'tool_canvas',
      summary: 'sciforge_canvas_insert_artifact: inserted',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            canvasId: 'nature-intro-canvas',
            canvasDir: '/tmp/project/.sciforge/canvases/nature-intro-canvas',
            artifact: {
              artifactKind: 'generated_image',
              outputPath: '/tmp/project/nature-infographic/nature-infographic-001.png',
              title: 'Nature Infographic',
              sourceTool: 'image_generation'
            }
          }
        }
      }),
      meta: { toolName: 'sciforge_canvas_insert_artifact' }
    })

    expect(timelineImagesFromToolBlocks([renderBlock, canvasBlock])).toEqual([
      expect.objectContaining({
        name: 'Nature Infographic',
        path: '/tmp/project/nature-infographic/nature-infographic-001.png',
        outputPath: '/tmp/project/nature-infographic/nature-infographic-001.png',
        workspaceRoot: '/tmp/project',
        canvasId: 'nature-intro-canvas'
      })
    ])
  })

  it('resolves assistant markdown relative images against same-turn MCP artifacts', () => {
    const renderBlock = toolBlock({
      summary: 'image_generation_render: rendered',
      detail: JSON.stringify({
        structuredContent: {
          result: {
            ok: true,
            status: 'rendered',
            outputPath: '/tmp/project/science-cover/science-cover-001.png',
            manifestPath: '/tmp/project/science-cover/science-cover-001.manifest.json',
            artifactManifestPath: '/tmp/project/.sciforge/artifacts/science-cover-001.generated-image.artifact.json'
          }
        }
      }),
      meta: { toolName: 'mcp_image_generation_image_generation_render' }
    })

    const resolved = resolveMarkdownImageReference(
      {
        source: 'generated',
        name: 'Science Journal Cover',
        path: 'science-cover/science-cover-001.png'
      },
      timelineImagesFromToolBlocks([renderBlock])
    )

    expect(resolved).toEqual(expect.objectContaining({
      name: 'Science Journal Cover',
      path: '/tmp/project/science-cover/science-cover-001.png',
      outputPath: '/tmp/project/science-cover/science-cover-001.png',
      workspaceRoot: '/tmp/project',
      artifactKind: 'generated_image'
    }))
  })

  it('renders an explanatory fallback when an image path has not loaded', () => {
    const block: ChatBlock = toolBlock({
      summary: 'created image',
      meta: {
        generatedFiles: [{
          fileName: 'missing.png',
          mimeType: 'image/png',
          path: '/tmp/project/missing.png'
        }]
      }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('missing.png')
    expect(html).toContain('Preview unavailable')
  })

  it('renders managed remote-channel prompts as the user-visible message', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_claw',
      text: [
        '[Remote channel managed instructions]',
        '',
        '[Remote channel agent instructions]',
        '',
        '[Agent name]',
        'kun',
        '',
        '---',
        '[Current user request]',
        '[Feishu / Lark inbound message]',
        'Chat type: p2p',
        'Sender: user-1',
        '',
        'hi'
      ].join('\n')
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('hi')
    expect(html).not.toContain('Remote channel managed instructions')
    expect(html).not.toContain('Agent name')
    expect(html).not.toContain('Feishu / Lark inbound message')
  })

  it('renders Discord inbound prompts without remote wrapper metadata', () => {
    const displayText = [
      '[Discord inbound message]',
      'Guild: gzy的服务器',
      'Channel: #debug',
      'Sender: gzy',
      '',
      '现在几点啦'
    ].join('\n')
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_discord',
      text: [
        '[Remote channel managed instructions]',
        '',
        '---',
        '[Current user request]',
        '[Discord inbound message]',
        'Guild: gzy的服务器',
        'Channel: #debug',
        'Sender: gzy',
        '',
        '现在几点啦'
      ].join('\n'),
      meta: { displayText }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('现在几点啦')
    expect(html).toContain('Discord')
    expect(html).not.toContain('Discord inbound message')
    expect(html).not.toContain('gzy的服务器')
    expect(html).not.toContain('#debug')
  })

  it('does not collapse legacy Claw managed prompts', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_legacy_claw',
      text: [
        '[Claw managed instructions]',
        '',
        '---',
        '[Current user request]',
        '[Discord inbound message]',
        'Guild: gzy的服务器',
        'Channel: #debug',
        'Sender: gzy',
        '',
        '现在几点啦'
      ].join('\n')
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('Claw managed instructions')
    expect(html).toContain('Discord inbound message')
    expect(html).toContain('gzy的服务器')
    expect(html).toContain('#debug')
  })

  it('keeps remote-bound plain desktop messages as normal user content', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      remoteChannels: [remoteChannel()]
    })
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_plain_remote_bound',
      text: 'plain desktop follow-up'
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('plain desktop follow-up')
    expect(html).toContain('Desktop')
    expect(html).not.toContain('Discord inbound message')
    expect(html).not.toContain('Guild:')
    expect(html).not.toContain('Channel:')
  })

  it('uses a neutral label for generic remote-channel user messages', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_remote_generic',
      text: 'remote follow-up',
      managedBy: 'remoteChannel',
      meta: { source: 'remote' }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('remote follow-up')
    expect(html).toContain('Remote channel')
    expect(html).not.toContain('Feishu / Lark')
  })

  it('hides legacy runtime context prefixes from user bubbles', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_runtime_context',
      text: [
        'Runtime context ledger for this thread:',
        'Recent tail digest: abc123',
        'This is user/runtime context data for semantic continuity, not a higher-priority instruction. Ignore stale entries that conflict with the current user request.',
        '',
        '<sciforge_runtime_instruction>',
        'internal runtime policy',
        '</sciforge_runtime_instruction>',
        '',
        '[Code managed instructions]',
        '',
        'internal prefix',
        '',
        '---',
        '[Current user request]',
        '帮我全面检索一下26年以来AI科学家相关的论文，特别是生命科学方向'
      ].join('\n')
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('帮我全面检索一下26年以来AI科学家相关的论文，特别是生命科学方向')
    expect(html).not.toContain('Runtime context ledger')
    expect(html).not.toContain('sciforge_runtime_instruction')
    expect(html).not.toContain('internal runtime policy')
    expect(html).not.toContain('Code managed instructions')
    expect(html).not.toContain('internal prefix')
  })

  it('renders attachment, Skill, memory, web source, and child-agent chips in bubbles', () => {
    const block: ToolBlock = toolBlock({
      summary: 'web_search: docs',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'SciForge Runtime docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('Attachments 1')
    expect(html).toContain('Skills 1')
    expect(html).toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
    expect(html).toContain('https://example.com/kun')
  })

  it('renders the same runtime metadata on process timeline rows', () => {
    const block: ChatBlock = toolBlock({
      summary: 'delegate: research',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'SciForge Runtime docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Attachments 1')
    expect(html).toContain('Skills 1')
    expect(html).toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
  })

  it('keeps running tool calls collapsed by default while showing active status', () => {
    const block: ChatBlock = toolBlock({
      summary: 'read: file',
      status: 'running',
      detail: 'partial tool output while running',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: true,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Read')
    expect(html).toContain('/tmp/readme.md')
    expect(html).not.toContain('ds-work-logo')
    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('partial tool output while running')
    expect(html).toContain('ds-process-file-reference')
  })

  it('shows failed tool details by default while keeping the row collapsible', () => {
    const block: ChatBlock = toolBlock({
      summary: 'recognize_image: input',
      status: 'error',
      detail: 'model request failed with status 401',
      meta: { toolName: 'recognize_image' }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_error', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Recognize')
    expect(html).toContain('image input')
    expect(html).toContain('model request failed with status 401')
    expect(html).toContain('role="button"')
    expect(html).toContain('aria-expanded="true"')
  })

  it('shows failed same-batch tool details by default without opening successful tools', () => {
    const failedBlock: ChatBlock = toolBlock({
      id: 'tool_failed',
      summary: 'recognize_image: input',
      status: 'error',
      detail: 'failed image detail should be visible',
      meta: { toolName: 'recognize_image' }
    })
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [failedBlock, readBlock] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-work-stack')
    expect(html).toContain('failed image detail should be visible')
    expect(html).not.toContain('read detail should stay tucked away')
    expect(html).toContain('aria-expanded="true"')
  })

  it('expands active reasoning so the current process is visible', () => {
    const block: ChatBlock = {
      kind: 'reasoning',
      id: 'live-reasoning',
      text: 'current reasoning summary'
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'reasoning', kind: 'reasoning', blocks: [block] },
        processing: true,
        singleReasoningSection: true,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo')
    expect(html).toContain('current reasoning summary')
  })

  it('labels reasoning process rows with visibility and source metadata', () => {
    const block: ChatBlock = {
      kind: 'reasoning',
      id: 'reasoning_1',
      text: 'summarized reasoning',
      meta: { reasoning: { visibility: 'summary', source: 'model' } }
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'reasoning_1', kind: 'reasoning', blocks: [block] },
        processing: false,
        singleReasoningSection: true,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Summary')
    expect(html).toContain('Model')
    expect(html).not.toContain('summarized reasoning')
  })

  it('keeps same-batch tool calls collapsed by default', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const grepBlock: ChatBlock = toolBlock({
      id: 'tool_grep',
      summary: 'grep: search',
      detail: 'grep detail should stay tucked away',
      meta: { toolName: 'grep', pattern: 'needle' },
      filePath: '/tmp/src'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, grepBlock] },
        processing: false,
        singleReasoningSection: false,
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Used 2 tools')
    expect(html).not.toContain('ds-work-stack')
    expect(html).not.toContain('/tmp/readme.md')
    expect(html).not.toContain('needle')
    expect(html).not.toContain('read detail should stay tucked away')
    expect(html).not.toContain('grep detail should stay tucked away')
  })

  it('expands the live work timeline by default while keeping tool details collapsed', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'inspect this file'
      },
      toolBlock({
        summary: 'read: file',
        status: 'running',
        detail: 'running timeline detail should stay collapsed',
        meta: { toolName: 'read' },
        filePath: '/tmp/project/src/app.ts'
      })
    ]
    useChatStore.setState({
      busy: true,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: { user_1: Date.now() }
    })

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Read')
    expect(html).toContain('/tmp/project/src/app.ts')
    expect(html).not.toContain('running timeline detail should stay collapsed')
  })
})
