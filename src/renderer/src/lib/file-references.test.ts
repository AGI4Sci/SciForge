import { describe, expect, it } from 'vitest'
import {
  createFileReferenceHref,
  FILE_REFERENCE_SCHEME,
  findFileReferences,
  isFileReferenceHref,
  LEGACY_FILE_REFERENCE_SCHEME,
  parseExactFileReference,
  parseFileReferenceHref
} from './file-references'

describe('file reference hrefs', () => {
  it('generates neutral SciForge file-reference hrefs', () => {
    const href = createFileReferenceHref({ path: 'src/main.ts', line: 12, column: 4, kind: 'file' })

    expect(href.startsWith(FILE_REFERENCE_SCHEME)).toBe(true)
    expect(href.startsWith(LEGACY_FILE_REFERENCE_SCHEME)).toBe(false)
    expect(parseFileReferenceHref(href)).toEqual({
      path: 'src/main.ts',
      line: 12,
      column: 4,
      kind: 'file'
    })
  })

  it('still parses legacy DeepSeek file-reference hrefs without generating them', () => {
    const href = `${LEGACY_FILE_REFERENCE_SCHEME}//open?path=src%2Flegacy.ts&line=7`

    expect(isFileReferenceHref(href)).toBe(true)
    expect(parseFileReferenceHref(href)).toEqual({
      path: 'src/legacy.ts',
      line: 7
    })
  })

  it('rejects malformed internal file-reference hrefs', () => {
    expect(isFileReferenceHref(`${FILE_REFERENCE_SCHEME}//open?line=3`)).toBe(true)
    expect(parseFileReferenceHref(`${FILE_REFERENCE_SCHEME}//open?line=3`)).toBeNull()
    expect(isFileReferenceHref('https://example.test/src/main.ts')).toBe(false)
  })
})

describe('file reference detection', () => {
  it('detects bare workspace filenames in inline code or prose', () => {
    expect(findFileReferences('打开 01_search_strategy.md 查看细节')).toEqual([
      {
        start: 3,
        end: 24,
        text: '01_search_strategy.md',
        target: {
          path: '01_search_strategy.md',
          kind: 'file'
        }
      }
    ])
  })

  it('detects directory paths and trims punctuation from the target', () => {
    const text = '已写入 molclaw_demo_scenes/scene_01_target_discovery/outputs/:'

    expect(findFileReferences(text)).toEqual([
      {
        start: 4,
        end: 58,
        text: 'molclaw_demo_scenes/scene_01_target_discovery/outputs/',
        target: {
          path: 'molclaw_demo_scenes/scene_01_target_discovery/outputs',
          kind: 'directory'
        }
      }
    ])
  })

  it('keeps line and column suffixes on file references', () => {
    expect(findFileReferences('见 src/App.tsx:42:7')).toEqual([
      {
        start: 2,
        end: 18,
        text: 'src/App.tsx:42:7',
        target: {
          path: 'src/App.tsx',
          line: 42,
          column: 7,
          kind: 'file'
        }
      }
    ])
  })

  it('does not turn URL paths into local file references', () => {
    expect(findFileReferences('打开 https://example.test/src/App.tsx 查看')).toEqual([])
  })

  it('parses exact inline-code paths whose first segment or filename contains spaces', () => {
    expect(parseExactFileReference(
      'AI Scientist/Frontis-MA1 - Training an AI4AI Model/Frontis-MA1_读书报告.md'
    )).toEqual({
      path: 'AI Scientist/Frontis-MA1 - Training an AI4AI Model/Frontis-MA1_读书报告.md',
      kind: 'file'
    })

    expect(parseExactFileReference('results/My report.md')).toEqual({
      path: 'results/My report.md',
      kind: 'file'
    })
  })

  it('parses exact nested directory references with or without a trailing separator', () => {
    expect(parseExactFileReference('assets/')).toEqual({
      path: 'assets',
      kind: 'directory'
    })
    expect(parseExactFileReference('AI Scientist/Frontis MA1/')).toEqual({
      path: 'AI Scientist/Frontis MA1',
      kind: 'directory'
    })
    expect(parseExactFileReference('AI Scientist/Frontis MA1')).toEqual({
      path: 'AI Scientist/Frontis MA1'
    })
  })

  it('keeps commands, URLs, and ordinary inline code out of exact path references', () => {
    expect(parseExactFileReference('npm run test')).toBeNull()
    expect(parseExactFileReference('https://example.test/report.md')).toBeNull()
    expect(parseExactFileReference('const value = 1')).toBeNull()
  })
})
