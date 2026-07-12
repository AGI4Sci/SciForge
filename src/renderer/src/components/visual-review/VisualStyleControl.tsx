import type { VisualStyleProfile } from '@shared/visual-style'
import { Check, ChevronDown, ImagePlus, Loader2, Palette } from 'lucide-react'
import { useState, type ReactElement } from 'react'

type Props = {
  workspaceRoot: string
  profileRef: string | null
  onApplied: (profileRef: string, profile: VisualStyleProfile) => void
}

const MANUSCRIPT_STYLE_PATH = '.sciforge/visual-styles/manuscript-default.json'

export function VisualStyleControl({ workspaceRoot, profileRef, onApplied }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<VisualStyleProfile | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const chooseReference = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const picked = await window.sciforge.pickWorkspaceFile(workspaceRoot)
      if (picked.canceled || !picked.path) return
      if (!/\.(?:png|jpe?g|webp|bmp)$/i.test(picked.path)) {
        setMessage('请选择 PNG、JPG、WEBP 或 BMP 参考图。PDF 可先在文档预览中裁剪目标图。')
        return
      }
      const extracted = await window.sciforge.extractVisualStyleProfile({
        workspaceRoot,
        sourcePath: picked.path,
        sourceType: 'image',
        sourceKind: 'reference',
        scope: 'manuscript'
      })
      if (!extracted.ok) throw new Error(extracted.message)
      const saved = await window.sciforge.saveVisualStyleProfile({
        workspaceRoot,
        path: MANUSCRIPT_STYLE_PATH,
        profile: extracted.profile,
        diagnostics: extracted.diagnostics
      })
      if (!saved.ok) throw new Error(saved.message)
      setProfile(extracted.profile)
      onApplied(saved.path, extracted.profile)
      setMessage('已设为论文视觉规范，后续候选图片将自动继承。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

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
          <div className="text-[12.5px] font-semibold text-ds-ink">参考风格</div>
          <p className="mt-1 text-[11.5px] leading-5 text-ds-faint">
            默认保持当前风格。选择参考图后会自动提取配色、排版、线条和生成元素风格，并作为论文级规范复用。
          </p>
          <button
            type="button"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ds-ink px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-ds-canvas"
            onClick={() => void chooseReference()}
            disabled={busy || !workspaceRoot.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : profileRef ? <Check className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
            {busy ? '正在识别…' : profileRef ? '更换参考图' : '选择参考图'}
          </button>
          {profile ? (
            <div className="mt-3 rounded-md bg-ds-surface-subtle p-2">
              <div className="flex gap-1.5">
                {(profile.tokens.palette.accent.length
                  ? profile.tokens.palette.accent
                  : profile.tokens.palette.colors).slice(0, 6).map((color) => (
                    <span key={color} className="h-5 w-5 rounded border border-black/10" style={{ backgroundColor: color }} title={color} />
                  ))}
              </div>
              <p className="mt-2 line-clamp-3 text-[11px] leading-4 text-ds-muted">{profile.semanticDescription}</p>
            </div>
          ) : null}
          {message ? <p className="mt-2 text-[11px] leading-4 text-ds-muted">{message}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
