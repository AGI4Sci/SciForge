import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
  MARKDOWN_WECHAT_LIMITS,
  markdownWechatCopyResultSchema
} from '../../shared/markdown-wechat'

const electronMocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {
    write: electronMocks.clipboardWrite
  }
}))

import {
  copyMarkdownForWechat,
  renderMarkdownForWechat
} from './markdown-wechat-clipboard-service'

describe('markdown-wechat-clipboard-service', () => {
  beforeEach(() => {
    electronMocks.clipboardWrite.mockReset()
  })

  it('renders deterministic fixed-theme HTML with GFM, highlighted code, and self-contained SVG math', async () => {
    const input = {
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: [
        '# Heading',
        '',
        '> Quote',
        '',
        '- one',
        '- two',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '```typescript',
        'const answer: number = 42',
        '```',
        '',
        'Inline $E=mc^2$.',
        '',
        '$$',
        '\\frac{a}{b}=c',
        '$$',
        '',
        '[Unsafe link](javascript:alert(1))',
        '',
        '<img src="https://example.com/tracker.png" onerror="alert(1)">',
        '<script>alert(1)</script>'
      ].join('\n')
    }

    const first = await renderMarkdownForWechat(input)
    const second = await renderMarkdownForWechat(input)

    expect(first.html).toBe(second.html)
    expect(first.html).toContain('<article style=')
    expect(first.html).toContain('<h1 style=')
    expect(first.html).toContain('<blockquote style=')
    expect(first.html).toContain('<table style=')
    expect(first.html).toContain('<pre style=')
    expect(first.html).toContain('<svg style=')
    expect(first.html).toContain('<path')
    expect(first.html).not.toMatch(/<style\b/i)
    expect(first.html).not.toMatch(/\sclass=/i)
    expect(first.html).not.toMatch(/<(?:script|use|defs)\b/i)
    expect(first.html).not.toContain('font-cache')
    expect(first.html).not.toMatch(/\son[a-z]+=/i)
    expect(first.html).not.toMatch(/href=["']javascript:/i)
    expect(first.counts).toMatchObject({
      formulas: 2,
      inlineFormulas: 1,
      displayFormulas: 1,
      codeBlocks: 1
    })
    expect(first.warnings).toContainEqual(expect.objectContaining({
      code: 'raw-html-omitted'
    }))
  })

  it.each([
    {
      name: 'sized divergence separator',
      tex: String.raw`\mathcal{L}_{\text{SDPO}}(\theta) = \mathbb{E}_{x \sim \mathcal{D}}\left[D_{\text{KL}}\left(p_{\theta}(y \mid x, y^*, f) \;\big\|\; p_{\theta}(y \mid x)\right)\right]`
    },
    {
      name: 'extensible overbrace',
      tex: String.raw`\overbrace{a+b+c+d}^{n}`
    },
    {
      name: 'extensible arrow',
      tex: String.raw`A \xrightarrow{\text{long label}} B`
    }
  ])('preserves nested MathJax SVG viewports for $name', async ({ tex }) => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: `$$\n${tex}\n$$`
    })

    const svgTags = result.html.match(/<svg\b[^>]*>/g) ?? []
    expect(svgTags.length).toBeGreaterThan(1)
    expect(svgTags[0]).toMatch(/\swidth="\d+(?:\.\d+)?"/)
    expect(svgTags[0]).toMatch(/\sheight="\d+(?:\.\d+)?"/)
    expect(svgTags[0]).toMatch(/style="[^"]*\bwidth:\s*\d+(?:\.\d+)?px;/)
    expect(svgTags[0]).not.toMatch(/style="[^"]*\b(?:width|height):\s*\d+(?:\.\d+)?(?:ex|em);/)
    for (const nestedSvg of svgTags.slice(1)) {
      expect(nestedSvg).toMatch(/\swidth="\d+(?:\.\d+)?"/)
      expect(nestedSvg).toMatch(/\sheight="\d+(?:\.\d+)?"/)
      expect(nestedSvg).toMatch(/\sviewBox="[^"]+"/)
      expect(nestedSvg).not.toMatch(/style="[^"]*\b(?:width|height):\s*\d+(?:\.\d+)?;/)
    }
    expect(result.html).toContain('<path')
    expect(result.warnings).not.toContainEqual(expect.objectContaining({
      code: 'formula-invalid'
    }))
  })

  it('gives copied formulas fixed SVG dimensions that survive editor style stripping', async () => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: 'Inline $E=mc^2$.\n\n$$\n\\frac{a}{b}=c\n$$'
    })

    const outerSvgTags = result.html.match(/<svg\b[^>]*>/g)?.filter((tag) =>
      /\srole="img"/.test(tag)
    ) ?? []
    expect(outerSvgTags).toHaveLength(2)
    for (const svgTag of outerSvgTags) {
      expect(svgTag).toMatch(/\swidth="\d+(?:\.\d+)?"/)
      expect(svgTag).toMatch(/\sheight="\d+(?:\.\d+)?"/)
      expect(svgTag).toMatch(/style="[^"]*\bwidth:\s*\d+(?:\.\d+)?px;/)
      expect(svgTag).not.toMatch(/style="[^"]*\b(?:width|height):\s*\d+(?:\.\d+)?(?:ex|em);/)
      const height = Number(/\sheight="(\d+(?:\.\d+)?)"/.exec(svgTag)?.[1])
      expect(height).toBeGreaterThan(8)
      expect(height).toBeLessThan(64)
    }
  })

  it('preserves invalid or active TeX as readable text without active output', async () => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: String.raw`Unsafe $\href{javascript:alert(1)}{click}$ and broken $\frac{$.`
    })

    expect(result.html).not.toMatch(/<a\b[^>]*href=["']javascript:/i)
    expect(result.html).toMatch(/\\\(.*\\href/)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'formula-invalid'
    }))
  })

  it.each([
    String.raw`$\href{javascript:alert(1)}{click}$`,
    String.raw`$\style{background:url(javascript:alert(1))}{x}$`,
    String.raw`$\color{url(javascript:alert(1))}{x}$`,
    String.raw`$\bbox[background=url(javascript:alert(1))]{x}$`
  ])('never emits active attributes from TeX: %s', async (markdown) => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown
    })

    expect(result.html).not.toMatch(
      /(?:style|fill|stroke|href)=["'][^"']*(?:javascript:|url\s*\()/i
    )
    expect(result.html).not.toMatch(/\son[a-z]+=/i)
  })

  it('embeds workspace images with deduplicated reads and warns for remote or unsafe images', async () => {
    const readWorkspaceImage = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/image.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
      size: 8,
      revision: 'revision-1'
    }))
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: [
        '![One](./image.png)',
        '',
        '![Two](./image.png)',
        '',
        '![Remote](https://example.com/image.png)',
        '',
        '![Unsafe](data:image/svg+xml;base64,PHN2Zz4=)'
      ].join('\n')
    }, { readWorkspaceImage })

    expect(readWorkspaceImage).toHaveBeenCalledTimes(1)
    expect(result.html.match(/data:image\/png;base64,iVBORw0KGgo=/g)).toHaveLength(2)
    expect(result.html).toContain('https://example.com/image.png')
    expect(result.html).not.toContain('image/svg+xml')
    expect(result.html).toContain('图片：Unsafe')
    expect(result.counts).toMatchObject({
      embeddedImages: 2,
      remoteImages: 1
    })
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['remote-image-preserved', 'image-unsafe'])
    )
  })

  it('accepts bounded raster data URLs without reading the workspace', async () => {
    const readWorkspaceImage = vi.fn()
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '![Inline](data:image/png;base64,AAAA)'
    }, { readWorkspaceImage })

    expect(readWorkspaceImage).not.toHaveBeenCalled()
    expect(result.html).toContain('data:image/png;base64,AAAA')
    expect(result.counts.embeddedImages).toBe(1)
  })

  it('delegates traversal-shaped image paths to the workspace-safe reader and preserves alt text on rejection', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-wechat-workspace-'))
    const readWorkspaceImage = vi.fn(async () => ({
      ok: false as const,
      message: 'Path is outside the workspace.'
    }))
    const result = await renderMarkdownForWechat({
      sourcePath: join(workspaceRoot, 'docs', 'article.md'),
      workspaceRoot,
      markdown: '![Outside](../../outside.png)'
    }, { readWorkspaceImage })

    expect(readWorkspaceImage).toHaveBeenCalledWith({
      path: join(workspaceRoot, '..', 'outside.png'),
      workspaceRoot
    })
    expect(result.html).toContain('图片：Outside')
    expect(result.html).not.toContain('outside.png')
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'image-unavailable'
    }))
  })

  it('writes HTML and original Markdown exactly once after successful preflight', async () => {
    const markdown = '# Ready\n\nBody'
    const result = await copyMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown
    }, {
      now: () => new Date('2026-07-30T10:00:00.000Z')
    })

    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    expect(electronMocks.clipboardWrite).toHaveBeenCalledWith({
      html: expect.stringContaining('<article style='),
      text: markdown
    })
    expect(result).toEqual(markdownWechatCopyResultSchema.parse({
      copiedAt: '2026-07-30T10:00:00.000Z',
      outputBytes: result.outputBytes,
      counts: {
        formulas: 0,
        inlineFormulas: 0,
        displayFormulas: 0,
        codeBlocks: 0,
        embeddedImages: 0,
        remoteImages: 0
      },
      warnings: [],
      effect: 'clipboard-write'
    }))
  })

  it('does not touch the clipboard when mandatory preflight fails', async () => {
    await expect(copyMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: 'x'.repeat(MARKDOWN_WECHAT_LIMITS.maxMarkdownChars + 1)
    })).rejects.toThrow()
    expect(electronMocks.clipboardWrite).not.toHaveBeenCalled()
  })

  it('publishes the stable action id and rejects malformed action results', () => {
    expect(MARKDOWN_COPY_FOR_WECHAT_ACTION_ID).toBe('markdown.copyForWechat')
    expect(markdownWechatCopyResultSchema.safeParse({
      copiedAt: new Date().toISOString(),
      outputBytes: 1,
      counts: {
        formulas: 1,
        inlineFormulas: 1,
        displayFormulas: 1,
        codeBlocks: 0,
        embeddedImages: 0,
        remoteImages: 0
      },
      warnings: [],
      effect: 'clipboard-write'
    }).success).toBe(false)
  })
})
