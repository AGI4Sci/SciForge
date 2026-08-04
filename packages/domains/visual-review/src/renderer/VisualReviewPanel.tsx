import type {
  VisualDocument,
  VisualReviewAnnotation as StoredVisualReviewAnnotation
} from '../types.js'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { Loader2, PanelRightClose, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  VisualReviewSurface,
  type VisualReviewAnnotation,
  type VisualReviewImage
} from './VisualReviewSurface'
import type { VisualReviewCapabilityClient } from './capability-client'

export type VisualReviewPanelProps = {
  workspaceRoot: string
  sessionId: string
  documentId: string
  className?: string
  refreshKey?: number
  onCollapse: () => void
  client: VisualReviewCapabilityClient
  workbench: DomainRendererWorkbenchHost
}

const CANDIDATE_POLL_MS = 1_500
const CANDIDATE_WAIT_TIMEOUT_MS = 5 * 60_000
const CANDIDATE_WATCH_TIMEOUT_MS = 30 * 60_000

function storedAnnotationToUi(annotation: StoredVisualReviewAnnotation): VisualReviewAnnotation {
  const common = {
    id: annotation.id,
    comment: annotation.instruction,
    status: annotation.status
  }
  if (annotation.geometry.kind === 'box') {
    return { ...common, kind: 'box', geometry: annotation.geometry.bounds }
  }
  if (annotation.geometry.kind === 'arrow') {
    return {
      ...common,
      kind: 'arrow',
      geometry: { start: annotation.geometry.from, end: annotation.geometry.to }
    }
  }
  if (annotation.geometry.kind === 'freehand') {
    return { ...common, kind: 'freehand', geometry: { points: annotation.geometry.points } }
  }
  return { ...common, kind: 'pin', geometry: annotation.geometry.point }
}

function uiAnnotationToStored(annotation: VisualReviewAnnotation) {
  const geometry = annotation.kind === 'box'
    ? { kind: 'box' as const, bounds: annotation.geometry }
    : annotation.kind === 'arrow'
      ? { kind: 'arrow' as const, from: annotation.geometry.start, to: annotation.geometry.end }
      : annotation.kind === 'freehand'
        ? { kind: 'freehand' as const, points: annotation.geometry.points }
        : { kind: 'pin' as const, point: annotation.geometry }
  return {
    id: annotation.id,
    geometry,
    instruction: annotation.comment.trim(),
    status: annotation.status
  }
}

export function buildVisualRevisionRequest(input: {
  workspaceRoot: string
  documentId: string
  packetPath: string
}): string {
  return [
    '请根据当前 VisualDocument 审改包生成一个候选修改版本。',
    `工作区：${input.workspaceRoot}`,
    `VisualDocument ID：${input.documentId}`,
    `审改包：${input.packetPath}`,
    '先读取审改包中的结构化批注、归一化区域、语义节点、truth locks 和 styleProfileRef。',
    '必须先调用 visual_generate，action="revision"，并传入源 artifact、当前审改包、可复现输入、truth locks 和已有证据；统一入口会锁定 code、model 或 hybrid 路线。',
    '若 visual_generate 返回 needs_context，只针对返回的未解决问题调用 research_search，合并新增证据后再次调用 visual_generate；达到 cost/round/token/time 上限或连续无信息增益时停止搜索，仍生成不臆造缺失事实的受限草稿并统一审查。',
    '必须逐项执行计划返回的 execution.stages；当阶段指定 image_generation_edit_from_visual_review_packet 时，直接传入当前审改包，禁止改用 image_generation_render 重绘整图。',
    '审改包是人类确认的输入：禁止改写批注文字、几何区域或状态，也禁止为了重试而导出更改过的审改包。',
    '若锁定路线为 model 或 hybrid，必须直接调用 image_generation_edit_from_visual_review_packet 并传入上述审改包；禁止用 image_generation_prepare 或 image_generation_render 替代，因为它们会重新生成整张图而不是按标注局部修改。',
    '只修改批注目标；未标注区域、精确标签、数据、连线关系和 truth locks 必须保持不变。',
    '生成后调用 image_generation_review_candidate 做清单绑定的候选版本发布 QA；发现重叠、裁切、不可读文字、错误关系或锁定事实变化时，应在同一路线内修复后重新检查。',
    '禁止覆盖源 artifact，也禁止调用 accept capability。检查通过且 repairable=false 后，通过 sciforge_discover 查找 Visual Review 的 create candidate capability，再用 sciforge_invoke 提交候选；reviewEvidence 必须等于 { tool: "image_generation_review_candidate", ...review结果 }，系统会核验候选路径和文件哈希。',
    '候选版本将由人类在修改前后对比页面中决定接受或拒绝。'
  ].join('\n')
}

async function workspaceImage(
  client: VisualReviewCapabilityClient,
  workspaceRoot: string,
  path: string,
  width: number,
  height: number,
  alt: string
): Promise<VisualReviewImage> {
  const result = await client.readImage(path, workspaceRoot)
  let naturalWidth = width
  let naturalHeight = height
  if (!(naturalWidth > 0 && naturalHeight > 0)) {
    const image = new Image()
    image.src = result.dataUrl
    await image.decode()
    naturalWidth = image.naturalWidth
    naturalHeight = image.naturalHeight
  }
  return { src: result.dataUrl, width: naturalWidth, height: naturalHeight, alt, id: path }
}

export function VisualReviewPanel({
  workspaceRoot,
  sessionId,
  documentId,
  className = '',
  refreshKey,
  onCollapse,
  client,
  workbench
}: VisualReviewPanelProps): ReactElement {
  const [document, setDocument] = useState<VisualDocument | null>(null)
  const [source, setSource] = useState<VisualReviewImage | null>(null)
  const [candidate, setCandidate] = useState<VisualReviewImage | null>(null)
  const [annotations, setAnnotations] = useState<VisualReviewAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [awaitingCandidate, setAwaitingCandidate] = useState(false)
  const [watchingCandidate, setWatchingCandidate] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const activeCandidate = useMemo(() => document?.revisions.find(
    (revision) => revision.id === document.activeCandidateRevisionId && revision.status === 'candidate'
  ) ?? null, [document])

  const load = useCallback(async (quiet = false): Promise<void> => {
    if (!workspaceRoot.trim() || !documentId.trim()) {
      setDocument(null)
      setSource(null)
      setCandidate(null)
      setMessage('请先选择工作区，再从对话中的图片打开审改。')
      setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    try {
      const opened = await client.readDocument({ documentId }, workspaceRoot)
      const next = opened.document
      setDocument(next)
      setAnnotations(next.annotations.map(storedAnnotationToUi))
      if (!next.artifact) {
        setSource(null)
        setCandidate(null)
        setMessage('当前 VisualDocument 还没有图片，请从对话中的图片打开审改。')
        return
      }
      const width = next.artifact.width ?? 0
      const height = next.artifact.height ?? 0
      setSource(await workspaceImage(
        client,
        workspaceRoot,
        next.artifact.workingCopyPath,
        width,
        height,
        next.artifact.title ?? '修改前图片'
      ))
      const revision = next.revisions.find((item) => item.id === next.activeCandidateRevisionId)
      if (revision?.status === 'candidate') {
        setCandidate(await workspaceImage(
          client,
          workspaceRoot,
          revision.artifactPath,
          revision.width ?? width,
          revision.height ?? height,
          '候选修改版本'
        ))
        setAwaitingCandidate(false)
        setWatchingCandidate(false)
      } else {
        setCandidate(null)
      }
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [client, documentId, workspaceRoot])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (!watchingCandidate) return undefined
    const timer = window.setInterval(() => void load(true), CANDIDATE_POLL_MS)
    const waitTimeout = window.setTimeout(() => {
      setAwaitingCandidate(false)
      setMessage('候选版本仍在生成；面板会在后台继续检查，完成后自动进入前后对比。')
    }, CANDIDATE_WAIT_TIMEOUT_MS)
    const watchTimeout = window.setTimeout(() => {
      setWatchingCandidate(false)
    }, CANDIDATE_WATCH_TIMEOUT_MS)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(waitTimeout)
      window.clearTimeout(watchTimeout)
    }
  }, [load, watchingCandidate])

  const requestRevision = useCallback(async (nextAnnotations: VisualReviewAnnotation[]) => {
    const persistable = nextAnnotations.filter((annotation) => annotation.comment.trim())
    const ready = persistable.filter((annotation) =>
      annotation.status === 'open' && annotation.comment.trim()
    )
    if (ready.length === 0) {
      setMessage('请至少填写一条修改建议。')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await client.saveAnnotations({
        documentId,
        annotations: persistable.map(uiAnnotationToStored)
      }, workspaceRoot)
      const exported = await client.exportReviewPacket({ documentId }, workspaceRoot)
      if (!workbench.sendMessage) throw new Error('Visual Review message submission is unavailable.')
      const submitted = await workbench.sendMessage({
        sessionId,
        text: buildVisualRevisionRequest({
          workspaceRoot,
          documentId,
          packetPath: exported.packetPath
        }),
        displayText: '请根据图片批注生成候选修改版，完成后让我对比确认。'
      })
      if (!submitted.ok) throw new Error(submitted.error.message)
      setAwaitingCandidate(true)
      setWatchingCandidate(true)
      setMessage('已发送修改请求；候选版本生成后会自动进入前后对比。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [client, documentId, sessionId, workbench, workspaceRoot])

  const reject = useCallback(async () => {
    if (!activeCandidate) return
    setBusy(true)
    try {
      await client.rejectCandidate({
        documentId,
        revisionId: activeCandidate.id
      }, workspaceRoot)
      setCandidate(null)
      setWatchingCandidate(false)
      setMessage('候选版本已拒绝，源图没有改变。')
      await load(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [activeCandidate, client, documentId, load, workspaceRoot])

  const accept = useCallback(async () => {
    if (!activeCandidate) return
    setBusy(true)
    try {
      const result = await client.acceptCandidate({
        documentId,
        revisionId: activeCandidate.id
      }, workspaceRoot)
      setCandidate(null)
      setWatchingCandidate(false)
      setMessage('已接受候选版本并原子替换源图；旧版本已保存在修订备份中。')
      setDocument(result.document)
      if (workbench.sendMessage) {
        const submitted = await workbench.sendMessage({
          sessionId,
          text: '我已在人类审改页面接受候选图片。请重新编译所有引用该图片的文档，并检查最终输出中的裁切、重叠、标签可读性和引用是否正确。',
          displayText: '已接受图片，请重新编译并检查最终文档。'
        })
        if (!submitted.ok) throw new Error(submitted.error.message)
      }
      await load(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [activeCandidate, client, documentId, load, sessionId, workbench, workspaceRoot])

  if (loading || !source) {
    return (
      <aside className={`ds-no-drag flex h-full min-h-0 flex-col bg-white dark:bg-ds-canvas ${className}`}>
        <div className="flex h-12 items-center justify-between border-b border-ds-border-muted px-4">
          <span className="text-[13px] font-semibold text-ds-ink">图片审改</span>
          <button type="button" className="ds-sidebar-toggle-button" onClick={onCollapse} aria-label="收起右侧栏">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-ds-muted">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在打开图片审改…</> : message}
        </div>
      </aside>
    )
  }

  return (
    <aside className={`ds-no-drag flex h-full min-h-0 flex-col bg-white dark:bg-ds-canvas ${className}`}>
      <div className="flex min-h-12 items-center gap-2 border-b border-ds-border-muted px-3 py-2">
        <button type="button" className="ds-sidebar-toggle-button" onClick={onCollapse} aria-label="收起右侧栏">
          <PanelRightClose className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          className="ds-sidebar-toggle-button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="刷新审改文档"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {message ? <div className="border-b border-ds-border-muted px-3 py-2 text-[12px] text-ds-muted">{message}</div> : null}
      <VisualReviewSurface
        className="min-h-0 flex-1"
        source={source}
        candidate={candidate ?? undefined}
        annotations={annotations}
        mode={candidate ? 'compare' : 'annotate'}
        readOnly={Boolean(candidate)}
        busy={busy || awaitingCandidate}
        onAnnotationsChange={setAnnotations}
        onRequestRevision={(items) => void requestRevision(items)}
        onReject={() => void reject()}
        onContinueAnnotating={() => void reject()}
        onAccept={() => void accept()}
      />
    </aside>
  )
}
