import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FloatingComposer,
  attachmentInputsFromPickedFiles,
  composeInsertedTextAtSelection,
  formatGoalElapsedSeconds,
  formatThreadContextStateLabel,
  handleComposerImagePaste,
  imageAttachmentInputsFromTransfer,
  imageFilesFromTransfer,
  imageTransferHasImages,
  isImageGenerationConfigured,
  runParsedGoalCommandForComposer,
  parseCompactCommand,
  parseGoalCommand,
  parseReviewCommand,
  parseSteerCommand
} from './FloatingComposer'
import {
  FloatingComposerModelPicker,
  calculateFloatingMenuPlacement,
  calculateFloatingSubmenuPlacement,
  composerReasoningEffortRequestValue,
} from './FloatingComposerModelPicker'
import { getGoalPanelDraftObjective } from './floating-composer-commands'
import { useChatStore } from '../../store/chat-store'
import {
  buildComposerFileContextPrompt,
  filterWorkspaceFileMentionSuggestions,
  formatComposerFileMentionToken,
  getFileMentionAtCursor,
  removeComposerFileMentionToken,
  replaceFileMentionInInput
} from '../../lib/composer-file-references'
import {
  resolveSpeechToTextSettingsFromAppSettings
} from './use-voice-dictation'

afterEach(() => {
  useChatStore.setState({ activeThreadContextState: null })
  vi.unstubAllGlobals()
})

describe('FloatingComposer slash commands', () => {
  it('parses compact command aliases', () => {
    expect(parseCompactCommand('/compact')).toEqual({})
    expect(parseCompactCommand('/compress')).toEqual({})
    expect(parseCompactCommand('/summarize')).toEqual({})
    expect(parseCompactCommand('/压缩')).toEqual({})
    expect(parseCompactCommand('/压缩会话')).toEqual({})
    expect(parseCompactCommand('/总结')).toEqual({})
  })

  it('parses compact reasons and ignores adjacent command names', () => {
    expect(parseCompactCommand('/compact preparing for a long continuation')).toEqual({
      reason: 'preparing for a long continuation'
    })
    expect(parseCompactCommand('/压缩会话 继续实现前整理上下文')).toEqual({
      reason: '继续实现前整理上下文'
    })
    expect(parseCompactCommand('/compactness')).toBeNull()
    expect(parseCompactCommand('please /compact')).toBeNull()
  })

  it('parses goal command controls and objectives', () => {
    expect(parseGoalCommand('/goal')).toEqual({ action: 'menu' })
    expect(parseGoalCommand('/goal pause')).toEqual({ action: 'pause' })
    expect(parseGoalCommand('/goal resume')).toEqual({ action: 'resume' })
    expect(parseGoalCommand('/goal clear')).toEqual({ action: 'clear' })
    expect(parseGoalCommand('/goal complete')).toEqual({ action: 'complete' })
    expect(parseGoalCommand('/goal done')).toEqual({ action: 'complete' })
    expect(parseGoalCommand('/goal ship the feature')).toEqual({
      action: 'set',
      objective: 'ship the feature'
    })
    expect(parseGoalCommand('/goalkeeper')).toBe(false)
  })

  it('parses review command targets', () => {
    expect(parseReviewCommand('/review')).toEqual({ kind: 'uncommittedChanges' })
    expect(parseReviewCommand('/review base main')).toEqual({ kind: 'baseBranch', branch: 'main' })
    expect(parseReviewCommand('/review branch release/1.2')).toEqual({ kind: 'baseBranch', branch: 'release/1.2' })
    expect(parseReviewCommand('/review commit abc123')).toEqual({ kind: 'commit', sha: 'abc123' })
    expect(parseReviewCommand('/review focus on auth regressions')).toEqual({
      kind: 'custom',
      instructions: 'focus on auth regressions'
    })
    expect(parseReviewCommand('/reviewer')).toBe(false)
  })

  it('parses steer command text and ignores adjacent command names', () => {
    expect(parseSteerCommand('/steer use the latest instruction')).toBe('use the latest instruction')
    expect(parseSteerCommand('/steer')).toBe('')
    expect(parseSteerCommand('/steering use the latest instruction')).toBe(false)
    expect(parseSteerCommand('please /steer')).toBe(false)
  })

  it('uses ordinary composer text as a goal draft only when the goal panel is open', () => {
    expect(getGoalPanelDraftObjective('ship the goal UX', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('  ship the goal UX  ', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('ship the goal UX', false)).toBe('')
    expect(getGoalPanelDraftObjective('/goal pause', true)).toBe('')
    expect(getGoalPanelDraftObjective('/compact after this', true)).toBe('')
  })

  it('does not consume /goal commands when the active runtime does not support goals', () => {
    const handled = runParsedGoalCommandForComposer({
      command: parseGoalCommand('/goal ship the feature'),
      canOpenGoalPanel: false,
      setInput: vi.fn(),
      setGoalPanelOpen: vi.fn(),
      focusComposer: vi.fn(),
      setActiveThreadGoal: vi.fn(),
      setActiveThreadGoalStatus: vi.fn(),
      clearActiveThreadGoal: vi.fn()
    })

    expect(handled).toBe(false)
  })
})

describe('FloatingComposer goal helpers', () => {
  it('formats elapsed goal time compactly', () => {
    expect(formatGoalElapsedSeconds(3)).toBe('3s')
    expect(formatGoalElapsedSeconds(60)).toBe('1m')
    expect(formatGoalElapsedSeconds(125)).toBe('2m 5s')
    expect(formatGoalElapsedSeconds(3720)).toBe('1h 2m')
  })

  it('formats shared context state with existing composer copy', () => {
    const t = (key: string, options?: Record<string, unknown>): string => {
      if (key === 'compactionCompletedWithCounts') {
        return `Compacted context (${options?.before} -> ${options?.after} messages)`
      }
      if (key === 'goalActiveHeading') return 'Active goal'
      if (key === 'goalStatusShort.blocked') return 'Blocked'
      return key
    }

    expect(formatThreadContextStateLabel({
      runtimeId: 'codex',
      threadId: 'thr_1',
      rawHistoryItems: 12,
      effectiveHistoryItems: 4,
      summarySource: 'heuristic',
      updatedAt: '2026-06-20T00:00:00.000Z',
      goalResume: {
        status: 'blocked',
        resumeCount: 2,
        lastFailureReason: 'no progress',
        updatedAt: '2026-06-20T00:00:01.000Z'
      }
    }, t)).toBe('Compacted context (12 -> 4 messages) · Active goal: Blocked · ×2 · no progress')
  })
})

describe('FloatingComposer voice input helpers', () => {
  it('normalizes configured speech-to-text settings from the dedicated settings shape', () => {
    const settings = {
      speechToText: {
        enabled: true,
        protocol: 'mimo-asr',
        baseUrl: ' https://speech.example/v1 ',
        apiKey: ' sk-speech ',
        model: ' whisper-1 ',
        language: ' zh ',
        timeoutMs: 45000
      }
    } as unknown as Parameters<typeof resolveSpeechToTextSettingsFromAppSettings>[0]

    expect(resolveSpeechToTextSettingsFromAppSettings(settings)).toEqual({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-1',
      language: 'zh',
      timeoutMs: 45000
    })
  })

  it('ignores legacy local runtime speech-to-text settings so voice input stays a unified composer setting', () => {
    const settings = {
      agents: {
        kun: {
          speechToText: {
            enabled: true,
            protocol: 'openai-transcriptions' as never,
            baseUrl: 'https://api.example/v1',
            apiKey: 'sk-speech',
            model: 'whisper-1',
            language: '',
            timeoutMs: 60000
          }
        }
      }
    } as unknown as Parameters<typeof resolveSpeechToTextSettingsFromAppSettings>[0]

    expect(resolveSpeechToTextSettingsFromAppSettings(settings)).toBeNull()
  })

  it('treats incomplete speech-to-text settings as unavailable', () => {
    const settings = {
      speechToText: {
        enabled: true,
        protocol: 'mimo-asr',
        baseUrl: '',
        apiKey: '',
        model: '',
        language: '',
        timeoutMs: 60000
      }
    } as unknown as Parameters<typeof resolveSpeechToTextSettingsFromAppSettings>[0]

    expect(resolveSpeechToTextSettingsFromAppSettings(settings)).toBeNull()
  })

  it('inserts dictated text at the composer selection with readable spacing', () => {
    expect(composeInsertedTextAtSelection({
      currentValue: 'please now',
      selectionStart: 6,
      selectionEnd: 6,
      text: 'summarize this'
    })).toEqual({
      input: 'please summarize this now',
      cursor: 21
    })
  })
})

describe('FloatingComposer file references', () => {
  it('parses @ file mention queries at the current cursor', () => {
    expect(getFileMentionAtCursor('please inspect @src/ren', 'please inspect @src/ren'.length)).toEqual({
      start: 15,
      end: 23,
      query: 'src/ren',
      quoted: false
    })
    expect(getFileMentionAtCursor('compare @"docs/product plan', 'compare @"docs/product plan'.length)).toEqual({
      start: 8,
      end: 27,
      query: 'docs/product plan',
      quoted: true
    })
    expect(getFileMentionAtCursor('email test@example.com', 'email test@example.com'.length)).toBeNull()
  })

  it('formats, inserts, removes, and ranks composer file references', () => {
    const files = [
      { path: '/repo/src/App.tsx', relativePath: 'src/App.tsx', name: 'App.tsx' },
      { path: '/repo/package.json', relativePath: 'package.json', name: 'package.json' },
      { path: '/repo/docs/product plan.md', relativePath: 'docs/product plan.md', name: 'product plan.md' }
    ]

    expect(formatComposerFileMentionToken('docs/product plan.md')).toBe('@"docs/product plan.md"')
    expect(filterWorkspaceFileMentionSuggestions(files, 'pack')).toEqual([files[1]])

    const mention = getFileMentionAtCursor('open @doc', 'open @doc'.length)
    expect(mention).not.toBeNull()
    const replaced = replaceFileMentionInInput('open @doc', mention!, files[2])
    expect(replaced.input).toBe('open @"docs/product plan.md" ')
    expect(removeComposerFileMentionToken(replaced.input, files[2].relativePath)).toBe('open')
  })

  it('builds a compact prompt from referenced workspace files', () => {
    const prompt = buildComposerFileContextPrompt('summarize this', [{
      relativePath: 'src/App.tsx',
      content: 'export function App() {}',
      truncated: true
    }])

    expect(prompt).toContain('<workspace_file path="src/App.tsx" truncated="true">')
    expect(prompt).toContain('export function App() {}')
    expect(prompt).toContain('User request:\nsummarize this')
  })
})

describe('FloatingComposer model controls', () => {
  it('maps the low reasoning chip to disabled thinking for faster turns', () => {
    expect(composerReasoningEffortRequestValue('low')).toBe('off')
    expect(composerReasoningEffortRequestValue('max')).toBe('max')
  })

  it('anchors the model menu to the trigger using the rendered menu height', () => {
    const placement = calculateFloatingMenuPlacement({
      anchorRect: { top: 780, right: 920, bottom: 816 },
      menuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(712)
    expect(placement.top).toBe(633)
  })

  it('keeps the model menu anchored when the app UI is zoomed', () => {
    const placement = calculateFloatingMenuPlacement({
      anchorRect: { top: 624, right: 736, bottom: 652.8 },
      menuHeight: 140,
      viewportHeight: 720,
      viewportWidth: 800,
      coordinateScale: 0.8
    })

    expect(placement.left).toBe(712)
    expect(placement.top).toBe(633)
  })

  it('places the model submenu beside the active provider row', () => {
    const placement = calculateFloatingSubmenuPlacement({
      anchorRect: { top: 650, right: 700, bottom: 686, left: 492 },
      submenuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(706)
    expect(placement.top).toBe(642)
  })

  it('flips the model submenu left when there is not enough room on the right', () => {
    const placement = calculateFloatingSubmenuPlacement({
      anchorRect: { top: 650, right: 920, bottom: 686, left: 712 },
      submenuHeight: 140,
      viewportHeight: 900,
      viewportWidth: 1000
    })

    expect(placement.left).toBe(474)
    expect(placement.top).toBe(642)
  })

  it('keeps the reasoning strength visible in the model control', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'auto',
        composerPickList: ['auto', 'deepseek-v4-pro'],
        composerReasoningEffort: 'high',
        canChangeModel: true,
        onComposerModelChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined
      })
    )

    expect(html).toContain('Auto')
    expect(html).toContain('High')
  })
})

describe('FloatingComposer image transfer helpers', () => {
  it('extracts image files from clipboard or drop payloads', () => {
    const screenshot = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const pastedWebp = new File([new Uint8Array([4])], '', { type: 'image/webp' })
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const source = {
      items: {
        length: 3,
        0: { kind: 'file', type: 'image/webp', getAsFile: () => pastedWebp },
        1: { kind: 'file', type: 'text/plain', getAsFile: () => notes },
        2: { kind: 'string', type: 'text/plain', getAsFile: () => null }
      },
      files: {
        length: 2,
        0: screenshot,
        1: notes
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([pastedWebp, screenshot])
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('deduplicates files exposed through both transfer item and file lists', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 1,
        0: screenshot
      }
    }

    expect(imageFilesFromTransfer(source)).toEqual([screenshot])
  })

  it('exposes picker file paths with image attachment inputs', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const getPathForFile = vi.fn(() => '/tmp/project/shot.png')
    vi.stubGlobal('window', {
      sciforge: { getPathForFile }
    })
    const source = {
      files: {
        length: 1,
        0: screenshot
      }
    }

    expect(imageAttachmentInputsFromTransfer(source)).toEqual([
      { file: screenshot, path: '/tmp/project/shot.png' }
    ])
    expect(getPathForFile).toHaveBeenCalledWith(screenshot)
  })

  it('keeps picked PDF files as path-backed workspace attachment inputs', () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'paper.pdf', { type: 'application/pdf' })
    const getPathForFile = vi.fn(() => '/tmp/project/papers/paper.pdf')
    vi.stubGlobal('window', {
      sciforge: { getPathForFile }
    })

    expect(attachmentInputsFromPickedFiles([pdf])).toEqual([
      { file: pdf, path: '/tmp/project/papers/paper.pdf' }
    ])
    expect(getPathForFile).toHaveBeenCalledWith(pdf)
  })

  it('keeps picked scientific files as path-backed workspace attachment inputs', () => {
    const fasta = new File(['>seq\\nACGT\\n'], 'sample.fasta', { type: 'text/plain' })
    const getPathForFile = vi.fn(() => '/tmp/project/data/sample.fasta')
    vi.stubGlobal('window', {
      sciforge: { getPathForFile }
    })

    expect(attachmentInputsFromPickedFiles([fasta])).toEqual([
      { file: fasta, path: '/tmp/project/data/sample.fasta' }
    ])
    expect(getPathForFile).toHaveBeenCalledWith(fasta)
  })

  it('keeps clipboard item MIME hints when pasted image files omit their own type', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot', { type: '' })
    const source = {
      items: {
        length: 1,
        0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
      },
      files: {
        length: 0
      }
    }

    const [file] = imageFilesFromTransfer(source)

    expect(file).toBeInstanceOf(File)
    expect(file?.type).toBe('image/png')
    expect(file?.name).toBe('shot')
    expect(imageTransferHasImages(source)).toBe(true)
  })

  it('handles pasted image files through the attachment picker', () => {
    const screenshot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    const preventDefault = vi.fn()
    const onPickAttachments = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => '',
        items: {
          length: 1,
          0: { kind: 'file', type: 'image/png', getAsFile: () => screenshot }
        }
      },
      preventDefault,
      onPickAttachments,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPickAttachments).toHaveBeenCalledWith([{ file: screenshot }])
    expect(onPasteClipboardImage).not.toHaveBeenCalled()
  })

  it('does not intercept ordinary text paste', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: (format) => format === 'text/plain' ? 'hello' : ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: true })
  })

  it('falls back to the Electron clipboard image bridge when files are unavailable', () => {
    const preventDefault = vi.fn()
    const onPasteClipboardImage = vi.fn()
    const handled = handleComposerImagePaste({
      canPickAttachment: true,
      clipboardData: {
        getData: () => ''
      },
      preventDefault,
      onPasteClipboardImage
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onPasteClipboardImage).toHaveBeenCalledWith({ silentNoImage: false })
  })
})

describe('FloatingComposer image generation helpers', () => {
  it('requires an image model API key, base URL, and model id', () => {
    expect(isImageGenerationConfigured(null)).toBe(false)
    expect(isImageGenerationConfigured({
      apiKey: '',
      baseUrl: 'https://image.example/v1',
      model: 'gpt-image-2'
    })).toBe(false)
    expect(isImageGenerationConfigured({
      apiKey: 'sk-image',
      baseUrl: '',
      model: 'gpt-image-2'
    })).toBe(false)
    expect(isImageGenerationConfigured({
      apiKey: 'sk-image',
      baseUrl: 'https://image.example/v1',
      model: 'gpt-image-2'
    })).toBe(true)
  })

})

describe('FloatingComposer capability controls', () => {
  it('hides runtime actions that are not available for the active runtime', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onReviewCommand: () => undefined,
        onBtwCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        skillCommands: [{
          id: 'openspec-apply-change',
          name: 'Openspec Apply Change',
          description: 'Implement tasks from an OpenSpec change',
          root: '/workspace/sciforge/.codex/skills/openspec-apply-change'
        }],
        runtimeCapabilities: {
          compact: false,
          fork: false,
          goals: false,
          review: false,
          sideConversations: false,
          skills: false
        }
      })
    )

    expect(html).not.toContain('/compact')
    expect(html).not.toContain('/fork')
    expect(html).not.toContain('/goal')
    expect(html).not.toContain('/review')
    expect(html).not.toContain('/btw')
    expect(html).not.toContain('/skill:openspec-apply-change')
    expect(html).not.toContain('Openspec Apply Change')
  })

  it('hides /btw when the runtime explicitly disables fork support', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onBtwCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: {
          fork: false,
          sideConversations: true
        }
      })
    )

    expect(html).not.toContain('/btw')
  })

  it('hides /btw when the provider method gate is unavailable', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onBtwCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: {
          fork: true,
          sideConversations: true
        },
        sideConversationsEnabled: false
      })
    )

    expect(html).not.toContain('/btw')
  })

  it('labels normal busy sends as queued continuation even when steering is supported', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'add this now',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: { steer: true }
      })
    )

    expect(html).toContain('Queue continuation')
    expect(html).toContain('Keep typing; sends wait and go out after the current reply finishes')
    expect(html).not.toContain('Inject into current run')
  })

  it('shows /steer as the busy-turn injection command when steering is supported', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/ste',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: { steer: true }
      })
    )

    expect(html).toContain('/steer')
    expect(html).toContain('Steer current run')
  })

  it('labels /steer busy sends as active-turn injection when steering is supported', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/steer add this now',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: { steer: true }
      })
    )

    expect(html).toContain('Inject into current run')
    expect(html).toContain('Keep typing; sends wait and go out after the current reply finishes')
  })

  it('renders a manual steer action for queued composer messages', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [{ id: 'q-1', text: 'follow up after this' }],
        onRemoveQueuedMessage: () => undefined,
        onSteerQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: { steer: true }
      })
    )

    expect(html).toContain('follow up after this')
    expect(html).toContain('Inject this queued message into the current run')
    expect(html).toContain('Remove queued message')
  })

  it('labels busy sends as queued continuation when steering is unsupported', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'continue later',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        runtimeCapabilities: { steer: false }
      })
    )

    expect(html).toContain('Queue continuation')
    expect(html).toContain('Keep typing; sends wait and go out after the current reply finishes')
    expect(html).not.toContain('Inject into current run')
  })

  it('enables goal setup before a thread exists when a workspace is available', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: ''
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/goal',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        workspaceRootOverride: '/workspace/sciforge',
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const goalButton = html.match(/<button[^>]*>[\s\S]*?\/goal[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(goalButton).toContain('/goal')
    expect(goalButton).not.toContain('disabled=""')
  })

  it('enables plan mode before a thread exists when a workspace is available', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: ''
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/plan',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        workspaceRootOverride: '/workspace/sciforge',
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onPlanCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const planButton = html.match(/<button[^>]*>[\s\S]*?\/plan[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(planButton).toContain('/plan')
    expect(planButton).not.toContain('disabled=""')
  })

  it('shows discovered project Skills in the slash command menu', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '/openspec',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        skillCommands: [{
          id: 'openspec-apply-change',
          name: 'Openspec Apply Change',
          description: 'Implement tasks from an OpenSpec change',
          root: '/workspace/sciforge/.codex/skills/openspec-apply-change'
        }]
      })
    )

    expect(html).toContain('Openspec Apply Change')
    expect(html).toContain('Implement tasks from an OpenSpec change')
    expect(html).toContain('Project')
    expect(html).toContain('/skill:openspec-apply-change')
  })

  it('enables local remote-channel input when a WeChat channel is already mapped to a local thread', () => {
    useChatStore.setState({
      activeThreadId: 'thr_weixin',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '',
      threads: [{
        id: 'thr_weixin',
        title: '[Remote channel:weixin agent]',
        updatedAt: '2026-06-02T00:00:00.000Z',
        model: 'auto',
        mode: 'agent',
        workspace: ''
      }],
      activeRemoteChannelId: 'channel_weixin',
      remoteChannels: [{
        id: 'channel_weixin',
        provider: 'weixin',
        label: 'weixin agent',
        enabled: true,
        model: 'auto',
        agentThreadIds: {
          sciforge: 'thr_weixin'
        },
        workspaceRoot: '',
        agentProfile: {
          name: '',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        platformCredential: {
          kind: 'weixin',
          accountId: 'wx_account',
          sessionKey: 'wx_session',
          createdAt: '2026-06-02T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'auto',
        composerPickList: ['auto'],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ''
    expect(textarea).not.toContain('disabled=""')
    expect(textarea).not.toContain('先去飞书')
  })

  it('hides image upload when attachment upload is unavailable', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )
    expect(html).not.toContain('Attach image')
    expect(html).not.toContain('Image input is unavailable')
  })

  it('keeps the composer unchanged when speech-to-text is not configured', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).not.toContain('Voice input')
    expect(html).not.toContain('lucide-mic')
  })

  it('renders the plus trigger alongside uploaded attachments', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'describe this',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachments: [{ id: 'att_1', name: 'shot.png', mimeType: 'image/png' }],
        attachmentUploadEnabled: true,
        webAccessAvailable: true,
        onRemoveAttachment: () => undefined
      })
    )
    expect(html).toContain('More actions')
    expect(html).not.toContain('Attach image')
    expect(html).toContain('shot.png')
  })

  it('keeps the busy composer toolbar focused on stop and model text', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: true,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['deepseek-v4-pro'],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Stop')
    expect(html).not.toContain('Stop and discard')
    expect(html).not.toContain('lucide-trash-2')
    expect(html).not.toContain('lucide-zap')
    expect(html).not.toContain('Default (thread)')
  })

  it('renders the model control chip without an empty default option', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: false,
        mode: 'select',
        composerModel: 'deepseek-v4-pro',
        composerPickList: ['auto', 'deepseek-v4-flash', 'deepseek-v4-pro'],
        canChangeModel: true,
        composerReasoningEffort: 'max',
        onComposerReasoningEffortChange: () => undefined,
        onComposerModelChange: () => undefined
      })
    )

    expect(html).toContain('deepseek-v4-pro')
    expect(html).toContain('Ultra')
    expect(html).toContain('Runtime, model, and reasoning settings')
    expect(html).not.toContain('>Auto<')
    expect(html).not.toContain('<option value=""></option>')
    expect(html).not.toContain('Default (thread)')
  })

  it('renders compact combobox controls as a picker button with model and reasoning labels', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: true,
        mode: 'combobox',
        composerModel: 'deepseek-v4-flash',
        composerPickList: ['auto', 'deepseek-v4-flash', 'deepseek-v4-pro'],
        canChangeModel: true,
        composerReasoningEffort: 'high',
        onComposerReasoningEffortChange: () => undefined,
        onComposerModelChange: () => undefined
      })
    )

    expect(html).toContain('deepseek-v4-flash')
    expect(html).toContain('High')
    expect(html).toContain('Runtime, model, and reasoning settings')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('<input')
  })

  it('shows the active runtime as a short lowercase label in the model picker', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposerModelPicker, {
        compact: true,
        mode: 'combobox',
        composerModel: 'deepseek-v4-flash',
        composerPickList: ['auto', 'deepseek-v4-flash', 'deepseek-v4-pro'],
        activeAgentRuntime: 'claude',
        canChangeModel: true,
        composerReasoningEffort: 'high',
        onActiveAgentRuntimeChange: () => undefined,
        onComposerReasoningEffortChange: () => undefined,
        onComposerModelChange: () => undefined
      })
    )

    expect(html).toContain('claude')
    expect(html).not.toContain('Claude Code CLI')
    expect(html).toContain('Runtime, model, and reasoning settings')
  })

  it('shows a plan badge in the input toolbar when plan mode is enabled', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'plan this',
        setInput: () => undefined,
        mode: 'plan',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onPlanCommand: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )
    expect(html).toContain('title="Plan"')
    expect(html).toContain('>Plan</span>')
  })

  it('keeps the file picker available while the runtime is loading', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: false,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        onPickAttachments: () => undefined,
        attachmentUploadEnabled: false,
        attachmentUploadBusy: false,
        webAccessAvailable: false
      })
    )

    const menuButton = html.match(/<button[^>]*aria-label="More actions"[^>]*>/)?.[0] ?? ''
    expect(menuButton).toContain('aria-label="More actions"')
    expect(menuButton).not.toContain('disabled=""')
    expect(html).not.toContain('aria-label="Attach file"')
    expect(html).toContain('type="file"')
    expect(html).toContain('.fasta')
  })

  it('renders image attachment thumbnails when a local preview is available', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachments: [{
          id: 'att_1',
          name: 'shot.png',
          mimeType: 'image/png',
          previewUrl: 'blob:shot-preview'
        }],
        attachmentUploadEnabled: true,
        webAccessAvailable: true,
        onRemoveAttachment: () => undefined
      })
    )

    expect(html).toContain('src="blob:shot-preview"')
    expect(html).toContain('alt="shot.png"')
  })

  it('renders @ file reference chips as sendable context', () => {
    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        fileReferenceEnabled: true,
        fileReferences: [{
          path: '/workspace/sciforge/papers/spec.pdf',
          relativePath: 'papers/spec.pdf',
          name: 'spec.pdf',
          kind: 'pdf',
          mimeType: 'application/pdf'
        }],
        onPreviewFileReference: () => undefined,
        onRemoveFileReference: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('papers/spec.pdf')
    expect(html).toContain('Open papers/spec.pdf')
    expect(html).toContain('PDF')
    expect(html).toContain('Remove file reference')
    expect(html).toContain('aria-label="Send"')
    expect(html).not.toContain('aria-label="Send" disabled=""')
  })

  it('hides execution access controls in the composer footer', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge'
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'hello',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).not.toContain('Full access')
    expect(html).not.toContain('aria-label="Execution"')
  })

  it('renders shared context and goal resume state above the input', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      activeThreadContextState: {
        runtimeId: 'codex',
        threadId: 'thr_1',
        rawHistoryItems: 10,
        effectiveHistoryItems: 3,
        summarySource: 'heuristic',
        summary: 'Kept recent work.',
        updatedAt: '2026-06-20T00:00:00.000Z',
        goalResume: {
          status: 'blocked',
          resumeCount: 1,
          lastFailureReason: 'no progress',
          updatedAt: '2026-06-20T00:00:01.000Z'
        }
      },
      route: 'chat',
      workspaceRoot: '/workspace/sciforge'
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'continue',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        contextState: {
          runtimeId: 'codex',
          threadId: 'thr_1',
          rawHistoryItems: 10,
          effectiveHistoryItems: 3,
          summarySource: 'heuristic',
          summary: 'Kept recent work.',
          updatedAt: '2026-06-20T00:00:00.000Z',
          goalResume: {
            status: 'blocked',
            resumeCount: 1,
            lastFailureReason: 'no progress',
            updatedAt: '2026-06-20T00:00:01.000Z'
          }
        }
      })
    )

    expect(html).toContain('Compacted context')
    expect(html).toContain('Active goal: Blocked')
    expect(html).toContain('Kept recent work.')
  })

  it('renders a changed-file review card above the input', () => {
    useChatStore.setState({
      activeThreadId: 'thr_1',
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge'
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'review this',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: true,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false,
        changedFiles: [
          { path: 'src/a.ts', added: 3, removed: 1 },
          { path: 'src/b.ts', added: 2, removed: 4 }
        ],
        changedFileStats: { added: 5, removed: 5 },
        onOpenChanges: () => undefined,
        onReviewChanges: () => undefined
      })
    )

    expect(html).toContain('2 files changed')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('+5')
    expect(html).toContain('-5')
    expect(html).toContain('Preview')
    expect(html).toContain('Review')
  })

  it('keeps the empty-session composer interactive in the Electron drag shell', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: '',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html).toContain('ds-floating-composer ds-no-drag')
    expect(html).toContain('ds-composer-shell ds-chat-composer ds-frosted ds-no-drag')
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ''
    expect(textarea).toContain('w-full')
    expect(textarea).not.toContain('disabled=""')
  })

  it('allows typing while a new chat has no selected runtime thread yet', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'draft while creating',
        setInput: () => undefined,
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: true,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html.match(/<textarea[^>]*>/)?.[0] ?? '').not.toContain('disabled=""')
    expect(html).toContain('Choose a working directory before creating a thread.')
    const sendButton = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButton).toContain('disabled=""')
  })

  it('keeps the draft editable while the runtime is loading and shows send loading', () => {
    useChatStore.setState({
      activeThreadId: null,
      activeThreadGoal: null,
      route: 'chat',
      workspaceRoot: '/workspace/sciforge',
      threads: []
    })

    const html = renderToStaticMarkup(
      createElement(FloatingComposer, {
        input: 'draft during startup',
        setInput: () => undefined,
        workspaceRootOverride: '/workspace/sciforge',
        mode: 'agent',
        setMode: () => undefined,
        busy: false,
        runtimeReady: false,
        hasActiveThread: false,
        composerModel: '',
        composerPickList: [],
        onComposerModelChange: () => undefined,
        queuedMessages: [],
        onRemoveQueuedMessage: () => undefined,
        onSend: () => undefined,
        onInterrupt: () => undefined,
        attachmentUploadEnabled: false,
        webAccessAvailable: false
      })
    )

    expect(html.match(/<textarea[^>]*>/)?.[0] ?? '').not.toContain('disabled=""')
    const sendButton = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButton).toContain('disabled=""')
    expect(html).toContain('lucide-loader-circle')
  })
})
