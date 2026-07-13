import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVIDENCE_DAG_SERVICE_URL,
  evidenceDagUiUrl
} from './contract'

describe('Evidence DAG desktop contract', () => {
  it('builds runtime-scoped UI URLs with the API token in the hash fragment', () => {
    expect(evidenceDagUiUrl({
      runtimeId: 'codex',
      threadId: 'thread-1',
      serviceUrl: 'http://127.0.0.1:4897/',
      apiKey: 'test-token'
    })).toBe('http://127.0.0.1:4897/?thread=codex%3Athread-1&preview=trusted#token=test-token')
  })

  it('omits empty thread and token values', () => {
    expect(evidenceDagUiUrl({ threadId: '   ', apiKey: '   ' }))
      .toBe(`${DEFAULT_EVIDENCE_DAG_SERVICE_URL}/`)
  })

  it('ships an opaque-ID evidence preview request and returned-node restoration', () => {
    const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
    const message = html.match(/const message = \{([\s\S]*?)\n {2}\};/)?.[1] ?? ''
    expect(html).toContain("const Q_NODE = new URLSearchParams(location.search).get('node')")
    expect(html).toContain('if (restoredNodeId) requestAnimationFrame(() => centerNode(restoredNodeId))')
    expect(html).toContain('查看原始证据')
    expect(html).toContain('runtime / trace 来源仅保留运行时引用')
    expect(html).toContain('远程或 citation 来源不会作为本地 workspace 路径打开')
    expect(html).toContain('该来源受访问策略限制')
    expect(html).toContain('请从绑定具体 runtime thread 的 Evidence DAG 面板打开本地证据')
    expect(html).toContain("window.parent.postMessage(message, '*')")
    expect(message).toContain('sourceAssertionId: node.id')
    expect(message).toContain('artifactVersionId: node.artifact_version_id')
    expect(message).toContain('sourceAnchorId: node.source_anchor_id')
    expect(message).not.toContain('locator')
    expect(message).not.toContain('contentDigest')
    expect(message).not.toContain('selector')
  })

  it('ships an accessible human-review heat overlay and deduplicated review queue', () => {
    const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
    expect(html).toContain('id="reviewHeat"')
    expect(html).toContain('id="reviewQueue"')
    expect(html).toContain('data-human-review-level=')
    expect(html).toContain('Human Review Queue')
    expect(html).toContain('reviewPacketId')
    expect(html).toContain('machineChecks')
    expect(html).toContain('blastRadius')
    expect(html).toContain('aria-label="Human review checkpoint"')
  })
})
