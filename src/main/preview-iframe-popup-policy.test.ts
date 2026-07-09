import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSandboxTokens(relativePath: string): string[][] {
  const source = readFileSync(resolve(relativePath), 'utf8')
  return [...source.matchAll(/sandbox="([^"]+)"/g)].map((match) => match[1]?.split(/\s+/) ?? [])
}

describe('preview iframe popup policy', () => {
  it('does not grant popup permission to dev or workspace preview iframes', () => {
    const sandboxes = [
      ...readSandboxTokens('src/renderer/src/components/DevBrowserPanel.tsx'),
      ...readSandboxTokens('src/renderer/src/workspace-preview/HtmlWorkspaceViewer.tsx')
    ]

    expect(sandboxes.length).toBeGreaterThan(0)
    for (const tokens of sandboxes) {
      expect(tokens).not.toContain('allow-popups')
    }
  })

  it('does not grant same-origin permission to dev or workspace preview iframes', () => {
    const sandboxes = [
      ...readSandboxTokens('src/renderer/src/components/DevBrowserPanel.tsx'),
      ...readSandboxTokens('src/renderer/src/workspace-preview/HtmlWorkspaceViewer.tsx')
    ]

    expect(sandboxes.length).toBeGreaterThan(0)
    for (const tokens of sandboxes) {
      expect(tokens).not.toContain('allow-same-origin')
    }
  })
})
