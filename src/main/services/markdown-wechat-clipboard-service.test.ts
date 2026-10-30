import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Element, Parent, Root } from 'hast'
import rehypeParse from 'rehype-parse'
import { unified } from 'unified'
import {
  MARKDOWN_COPY_FOR_FEISHU_ACTION_ID,
  MARKDOWN_COPY_FOR_WECHAT_ACTION_ID,
  MARKDOWN_COPY_FOR_ZHIHU_ACTION_ID,
  markdownWechatCopyActionInputSchema,
  markdownWechatCopyResultSchema,
  markdownWechatRenderInputSchema
} from '../../shared/markdown-wechat'

const electronMocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  nativeImageFromDataUrl: vi.fn((dataUrl: string) => ({ dataUrl }))
}))

vi.mock('electron', () => ({
  clipboard: {
    write: electronMocks.clipboardWrite
  },
  nativeImage: {
    createFromDataURL: electronMocks.nativeImageFromDataUrl
  }
}))

import {
  copyMarkdownForFeishu,
  copyMarkdownForWechat,
  copyMarkdownForZhihu,
  copyMarkdownSelectionForFeishu,
  copyMarkdownSelectionForWechat,
  copyMarkdownSelectionForZhihu,
  renderMarkdownForWechat,
  renderMarkdownSelectionForWechat
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
    expect(first.html).toContain('tracker.png')
    expect(first.warnings).not.toContainEqual(expect.objectContaining({
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

  it('keeps leading list formulas and prose in one paragraph', async () => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: [
        '- **「反直觉发现 1」**：代理微调对「推理步骤 token」影响更大——GSM 中等式左边 token 的平均概率增量为 0.131。',
        '- $M^-$：小模型；$M^+$：专家。',
        '- $+$：加进来；$-$：减掉。',
        '- $\\mathrm{softmax}$：归一化。',
        '- $x_{<t}$ 是前缀。'
      ].join('\n')
    })
    const tree = unified().use(rehypeParse, { fragment: true }).parse(result.html) as Root
    const elements = (node: Parent): Element[] => node.children.filter(
      (child): child is Element => child.type === 'element'
    )
    const article = elements(tree)[0]
    const list = elements(article)[0]
    expect(list.tagName).toBe('ul')
    expect(elements(list)).toHaveLength(5)
    for (const item of elements(list)) {
      const paragraphs = elements(item)
      expect(paragraphs.map((node) => node.tagName)).toEqual(['p'])
      expect(paragraphs[0].properties.style).toMatch(/display: inline;/)
      expect(paragraphs[0].children.some((node) => node.type === 'text' && node.value.trim())).toBe(true)
      const assertInline = (node: Element): void => {
        if (node.tagName === 'span') {
          expect(node.properties.style).toMatch(/(?:^|;\s*)display: inline;/)
          expect(node.properties.style).not.toContain('line-height: 0')
        }
        if (node.tagName === 'svg') {
          expect(node.properties.style).toContain('display: inline-block;')
          return
        }
        for (const child of elements(node)) assertInline(child)
      }
      assertInline(paragraphs[0])
    }
    expect(result.counts.inlineFormulas).toBe(6)
    expect(result.warnings).toEqual([])
  })

  it('keeps nested lists and display formulas outside the generated list paragraph', async () => {
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '- $M$：模型\n  - $x$：嵌套项\n\n  $$\n  x^2\n  $$'
    })
    expect(result.html).toMatch(/<\/p>\s*<ul/)
    expect(result.html).toMatch(/<\/ul>\s*<section/)
    expect(result.html).not.toMatch(/<p[^>]*>\s*<(?:ul|section)/)
    expect(result.counts).toMatchObject({ inlineFormulas: 2, displayFormulas: 1 })
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

  it('renders publication HTML beyond the former image and output byte limits', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(12_000_000)}`
    const readWorkspaceImage = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/large.png',
      dataUrl,
      mimeType: 'image/png',
      size: 9_000_000,
      revision: 'large-revision'
    }))

    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '![Large one](./large.png)\n\n![Large two](./large.png)'
    }, { readWorkspaceImage })

    expect(readWorkspaceImage).toHaveBeenCalledTimes(1)
    expect(result.counts.embeddedImages).toBe(2)
    expect(result.outputBytes).toBeGreaterThan(20_000_000)
    expect(result.html.match(/data:image\/png;base64/g)).toHaveLength(2)
  }, 15_000)

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
      path: join(workspaceRoot, '..', 'outside.png').replaceAll('\\', '/'),
      workspaceRoot
    })
    expect(result.html).toContain('图片：Outside')
    expect(result.html).not.toContain('outside.png')
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'image-unavailable'
    }))
  })

  it('renders HTML image syntax through the same safe workspace image pipeline', async () => {
    const readWorkspaceImage = vi.fn(async () => ({
      ok: true as const,
      path: '/workspace/figure.png',
      dataUrl: 'data:image/png;base64,ZmFrZQ==',
      mimeType: 'image/png',
      size: 4,
      revision: 'figure-revision'
    }))
    const result = await renderMarkdownForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '<img src="./figure.png" width="720" alt="Figure 1">'
    }, { readWorkspaceImage })

    expect(readWorkspaceImage).toHaveBeenCalledWith({
      path: '/workspace/figure.png',
      workspaceRoot: '/workspace'
    })
    expect(result.html).toContain('data:image/png;base64,ZmFrZQ==')
    expect(result.html).toContain('Figure 1')
    expect(result.counts.embeddedImages).toBe(1)
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

  it('preserves table cells and Markdown block boundaries in both clipboard flavors', async () => {
    const markdown = '# Ready\n\nBefore\n\n| A | B |\n| --- | --- |\n| **一** | [Link](https://example.com)<br>two |\n| empty | |\n\nAfter\n'
    const result = await copyMarkdownForFeishu({
      sourcePath: '/workspace/article.md', workspaceRoot: '/workspace', markdown
    })
    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    const payload = electronMocks.clipboardWrite.mock.calls[0][0]
    expect(payload.text).toBe(markdown)
    expect(payload.html).not.toContain('<article')
    const tree = unified().use(rehypeParse, { fragment: true }).parse(payload.html)
    const cells: Element[] = []
    const walk = (parent: Parent): void => {
      for (const child of parent.children) {
        if (child.type !== 'element') continue
        if (child.tagName === 'td' || child.tagName === 'th') cells.push(child)
        walk(child)
      }
    }
    walk(tree)
    expect(cells).toHaveLength(6)
    expect(cells.every((cell) => cell.children[0]?.type === 'element' && cell.children[0].tagName === 'p')).toBe(true)
    expect(payload.html).toContain('<strong')
    expect(payload.html).toContain('https://example.com')
    expect(payload.html).toContain('<br>two')
    expect(result.outputBytes).toBe(Buffer.byteLength(payload.html, 'utf8'))
  })

  it('preserves blank lines and hard breaks in the Feishu Markdown fallback', async () => {
    const markdown = '# Title\n\nParagraph  \nline two\n\n```text\na\n\nb\n```\n'
    await copyMarkdownForFeishu({
      sourcePath: '/workspace/article.md', workspaceRoot: '/workspace', markdown
    })
    expect(electronMocks.clipboardWrite).toHaveBeenCalledWith(expect.objectContaining({ text: markdown }))
  })

  it('normalizes a rendered selection fragment into canonical publication HTML', async () => {
    const html = [
      '<h2>选中部分</h2>',
      '<p>能量 <span class="katex"><span class="katex-mathml"><math><semantics>',
      '<annotation encoding="application/x-tex">E=mc^2</annotation>',
      '</semantics></math></span><span class="katex-html" aria-hidden="true"><span>𝑥</span></span></span> 公式</p>',
      '<div class="ds-code-block" data-language="typescript">',
      '<div class="ds-code-block-header"><span class="ds-code-block-language">typescript</span>',
      '<div class="ds-code-block-actions"><button type="button" aria-label="Copy">Copy</button></div></div>',
      '<div class="ds-code-block-body"><div class="ds-code-block-html">',
      '<pre class="shiki shiki-themes" style="--shiki-light:#fff;--shiki-dark:#000"><code>',
      '<span class="line"><span style="--shiki-light:#123">const</span>',
      '<span style="color: var(--shiki-light)"> a</span> = 1</span>',
      '</code></pre>',
      '</div></div></div>',
      '<span class="katex-display"><span class="katex"><span class="katex-mathml"><math display="block"><semantics>',
      '<annotation encoding="application/x-tex">\\frac{a}{b}=c</annotation>',
      '</semantics></math></span></span></span>',
      '<p><button type="button" class="write-markdown-image-button" aria-label="预览">',
      '<img src="data:image/png;base64,ZmFrZQ==" alt="示意图">',
      '</button></p>'
    ].join('')

    const result = await renderMarkdownSelectionForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      html
    })

    expect(result.html).toContain('<h2 style=')
    expect(result.html).toContain('<pre style=')
    expect(result.html).toContain('<svg style=')
    expect(result.html).toContain('data:image/png;base64,ZmFrZQ==')
    expect(result.html).toContain('示意图')
    expect(result.html).not.toContain('ds-code-block')
    expect(result.html).not.toContain('katex')
    expect(result.html).not.toContain('var(--shiki')
    expect(result.html).not.toContain('shiki-themes')
    expect(result.html).not.toContain('<button')
    expect(result.counts).toMatchObject({
      formulas: 2,
      inlineFormulas: 1,
      displayFormulas: 1,
      codeBlocks: 1,
      embeddedImages: 1,
      remoteImages: 0
    })
    expect(result.plainText).toContain('E=mc^2')
    expect(result.plainText).toContain('const a = 1')
    expect(result.plainText).toContain('\\frac{a}{b}=c')
    expect(result.plainText).not.toContain('Copy')
    expect(result.plainText).not.toContain('typescript')
  })

  it('writes the selection clipboard with publication HTML and readable plain text', async () => {
    await copyMarkdownSelectionForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      html: '<p>Only <strong>this</strong> part</p>'
    }, {
      now: () => new Date('2026-07-30T10:00:00.000Z')
    })

    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    expect(electronMocks.clipboardWrite).toHaveBeenCalledWith({
      html: expect.stringContaining('<p style='),
      text: 'Only this part'
    })
  })

  it('adapts selection fragments for Feishu rich-text paste', async () => {
    await copyMarkdownSelectionForFeishu({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      html: '<h3>标题</h3><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>一<br>二</td></tr></tbody></table>'
    })

    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    const payload = electronMocks.clipboardWrite.mock.calls[0][0]
    expect(payload.html).not.toContain('<article')
    expect(payload.html).toContain('<table')
    expect(payload.text).toContain('标题')
  })

  it('writes pure Markdown for Zhihu paste', async () => {
    await copyMarkdownForZhihu({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '# 标题\n\n| A | B |\n| --- | --- |\n| **一** | 二 |\n'
    })

    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    const payload = electronMocks.clipboardWrite.mock.calls[0][0]
    expect(payload.html).toBeUndefined()
    expect(payload.text).toContain('# 标题')
    expect(payload.text).toContain('| **一** | 二 |')
  })

  it('copies a rendered selection fragment for Zhihu paste', async () => {
    await copyMarkdownSelectionForZhihu({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      html: '<h2>节选</h2><p>正文 <strong>重点</strong></p>'
    })

    expect(electronMocks.clipboardWrite).toHaveBeenCalledTimes(1)
    const payload = electronMocks.clipboardWrite.mock.calls[0][0]
    expect(payload.html).not.toContain('<article')
    expect(payload.html).toContain('节选')
    expect(payload.text).toBe('节选\n正文 重点')
  })

  it('inlines local images in pure Markdown for Zhihu paste', async () => {
    await copyMarkdownForZhihu({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: '# 标题\n\n![示意图](images/example.png)\n\n正文'
    }, {
      readWorkspaceImage: async ({ path }) => ({
        ok: true,
        path,
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        size: 4,
        revision: '4:1'
      })
    })

    const payload = electronMocks.clipboardWrite.mock.calls[0][0]
    expect(payload.html).toBeUndefined()
    expect(payload.text).toContain('![示意图](images/example.png)')
    expect(payload.image).toEqual({ dataUrl: 'data:image/png;base64,AAAA' })
    expect(payload.text).not.toContain('data:image/png;base64,AAAA\n')
  })

  it('falls back to plain text with a warning when a formula has no TeX source', async () => {
    const result = await renderMarkdownSelectionForWechat({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      html: '<p>公式 <span class="katex"><span class="katex-html">𝑥2</span></span> 结束</p>'
    })

    expect(result.html).not.toContain('katex')
    expect(result.html).toContain('𝑥2')
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'formula-invalid' }))
  })

  it('accepts selection action input with an HTML fragment and stays strict', () => {
    expect(markdownWechatCopyActionInputSchema.safeParse({}).success).toBe(true)
    expect(markdownWechatCopyActionInputSchema.safeParse({
      html: '<p>Chosen</p>'
    }).success).toBe(true)
    expect(markdownWechatCopyActionInputSchema.safeParse({
      html: `<img src="data:image/png;base64,${'a'.repeat(5_000_000)}" alt="big">`
    }).success).toBe(true)
    expect(markdownWechatCopyActionInputSchema.safeParse({
      html: '<p>Chosen</p>',
      text: 'Chosen'
    }).success).toBe(false)
  })

  it('accepts long Markdown and unbounded output metadata', () => {
    expect(markdownWechatRenderInputSchema.safeParse({
      sourcePath: '/workspace/article.md',
      workspaceRoot: '/workspace',
      markdown: 'x'.repeat(1_000_001)
    }).success).toBe(true)

    expect(markdownWechatCopyResultSchema.safeParse({
      copiedAt: new Date().toISOString(),
      outputBytes: 50_000_000,
      counts: {
        formulas: 25_000,
        inlineFormulas: 10_000,
        displayFormulas: 15_000,
        codeBlocks: 20_000,
        embeddedImages: 15_000,
        remoteImages: 12_000
      },
      warnings: [],
      effect: 'clipboard-write'
    }).success).toBe(true)
  })

  it('publishes the stable action id and rejects malformed action results', () => {
    expect(MARKDOWN_COPY_FOR_WECHAT_ACTION_ID).toBe('markdown.copyForWechat')
    expect(MARKDOWN_COPY_FOR_FEISHU_ACTION_ID).toBe('markdown.copyForFeishu')
    expect(MARKDOWN_COPY_FOR_ZHIHU_ACTION_ID).toBe('markdown.copyForZhihu')
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
