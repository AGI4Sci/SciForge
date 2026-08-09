import type { DomainRendererWorkspaceHost } from '@sciforge/domain-sdk/host'
import { Check, ChevronDown, ImagePlus, Loader2, Palette } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { VisualDocumentApplyStyleReferenceResult, VisualStyleProfileSummary } from '../types.js'
import type { VisualReviewCapabilityClient } from './capability-client.js'

export type VisualStyleControlProps = {
  workspaceRoot: string
  documentId: string
  profileRef: string | null
  client: VisualReviewCapabilityClient
  workspace?: DomainRendererWorkspaceHost | undefined
  onApplied: (result: VisualDocumentApplyStyleReferenceResult) => void
}

export function VisualStyleControl({
  workspaceRoot,
  documentId,
  profileRef,
  client,
  workspace,
  onApplied
}: VisualStyleControlProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<VisualStyleProfileSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const chooseReference = async (): Promise<void> => {
    if (!workspace) {
      setMessage('当前运行环境不支持选择本地参考图。')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const picked = await workspace.pickFile({
        title: '选择视觉风格参考图',
        defaultPath: workspaceRoot,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp']
        }]
      })
      if (picked.canceled || !picked.path) return
      if (!/\.(?:png|jpe?g|webp|bmp)$/iu.test(picked.path)) {
        setMessage('请选择 PNG、JPG、WEBP 或 BMP 参考图。')
        return
      }
      const result = await client.applyStyleReference({
        documentId,
        sourcePath: picked.path
      }, workspaceRoot)
      setProfile(result.profile)
      onApplied(result)
      setMessage('已识别并应用为论文视觉规范，生成修改版时会自动继承。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const swatches = profile
    ? (profile.palette.accent.length > 0 ? profile.palette.accent : profile.palette.colors).slice(0, 6)
    : []

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-ds-border-muted px-2 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Palette className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-48 truncate">风格：{profileRef ? '论文视觉规范' : '保持当前图片'}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-ds-border bg-white p-3 shadow-xl dark:bg-ds-card">
          <div className="text-[12.5px] font-semibold text-ds-ink">图像风格识别</div>
          <p className="mt-1 text-[11.5px] leading-5 text-ds-faint">
            选择参考图后，系统会识别配色、排版、线条和生成元素风格，并保存为当前论文的视觉规范。
          </p>
          <button
            type="button"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ds-ink px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-ds-canvas"
            onClick={() => void chooseReference()}
            disabled={busy || !workspaceRoot.trim() || !documentId.trim()}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : profileRef
                ? <Check className="h-4 w-4" />
                : <ImagePlus className="h-4 w-4" />}
            {busy ? '正在识别…' : profileRef ? '更换参考图' : '选择参考图'}
          </button>
          {profile ? (
            <div className="mt-3 rounded-md bg-ds-surface-subtle p-2">
              <div className="flex gap-1.5">
                {swatches.map((color) => (
                  <span
                    key={color}
                    className="h-5 w-5 rounded border border-black/10"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-ds-muted">
                {profile.semanticDescription}
              </p>
              <p className="mt-1 text-[10.5px] text-ds-faint">
                识别置信度 {Math.round(profile.confidence * 100)}%
              </p>
            </div>
          ) : null}
          {message ? <p className="mt-2 text-[11px] leading-4 text-ds-muted">{message}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
