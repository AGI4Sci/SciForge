import { useEffect, useRef, useState, type ReactElement, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { validateUserInputAnswers, type DomainUserInputAnswer, type DomainUserInputPresentation } from '@sciforge/domain-sdk/user-input'

type Props = Parameters<DomainUserInputPresentation['render']>[0]
type Position = { left: number; top: number }
const POSITION_KEY = 'sciforge:user-input:window-position'
/** Wire-level marker for the free-text option; never shown to the user. */
const FREE_TEXT_OPTION = 'Other'
function readPosition(): Position | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(POSITION_KEY) ?? 'null')
    return value && Number.isFinite(value.left) && Number.isFinite(value.top) ? value : null
  } catch { return null }
}
type Draft = Record<string, { label: string; text: string }>

function readDraft(key: string): Draft {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, answer]) => answer &&
      typeof answer === 'object' && typeof answer.label === 'string' && typeof answer.text === 'string'))
  } catch { return {} }
}

export function DecisionQuestionnaire(props: Props): ReactElement {
  const { t } = useTranslation('userDecisions')
  const key = `sciforge:user-input:${props.requestId}`
  const dialog = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<Draft>(() => readDraft(key))
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(readPosition)
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = props.status === 'pending' || props.status === 'error'
  const question = props.questions[index]
  const answer = question ? draft[question.id] : undefined
  const freeText = question?.options.length === 0 || answer?.label === FREE_TEXT_OPTION
  const currentValid = Boolean(answer && (freeText ? answer.text.trim() : answer.label))
  const allValid = props.questions.every((q) => {
    const a = draft[q.id]
    return a && (q.options.length === 0 || a.label === FREE_TEXT_OPTION ? a.text.trim() : q.options.some((o) => o.label === a.label))
  })

  useEffect(() => {
    try { if (pending) sessionStorage.setItem(key, JSON.stringify(draft)); else sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
  }, [draft, key, pending])
  useEffect(() => {
    if (!pending || props.active === false) { setOpen(false); return }
    let dismissed = false
    try { dismissed = sessionStorage.getItem(`${key}:dismissed`) === 'true' } catch { /* Optional preference. */ }
    if (props.autoOpen && !dismissed && document.visibilityState === 'visible' && trigger.current?.getClientRects().length) setOpen(true)
  }, [props.autoOpen, props.active, key, pending])
  const clamp = (next: Position): Position => {
    const bounds = dialog.current?.getBoundingClientRect()
    return {
      left: Math.max(8, Math.min(next.left, window.innerWidth - (bounds?.width ?? 460) - 8)),
      top: Math.max(8, Math.min(next.top, window.innerHeight - (bounds?.height ?? 400) - 8))
    }
  }
  useEffect(() => {
    if (!open) return
    const resize = (): void => setPosition((previous) => previous ? clamp(previous) : null)
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [open])
  useEffect(() => {
    if (position) { try { sessionStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch { /* Optional preference. */ } }
  }, [position])
  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const bounds = dialog.current?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    setPosition(clamp({ left: start.left + event.clientX - start.x, top: start.top + event.clientY - start.y }))
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const close = (): void => {
    try { sessionStorage.setItem(`${key}:dismissed`, 'true') } catch { /* Optional preference. */ }
    setOpen(false)
    trigger.current?.focus()
  }
  const update = (label: string, text = answer?.text ?? ''): void => {
    if (!question) return
    setDraft((previous) => ({ ...previous, [question.id]: { label, text } }))
  }
  const resolve = async (cancel = false): Promise<void> => {
    if (busy || (!cancel && !allValid)) return
    setBusy(true); setError('')
    try {
      if (cancel) await props.onCancel()
      else {
        const answers: DomainUserInputAnswer[] = props.questions.map((q) => {
          const a = draft[q.id]
          return { id: q.id, label: q.options.length ? a.label : 'Answer',
            value: q.options.length && a.label !== FREE_TEXT_OPTION
              ? [a.label, a.text.trim()].filter(Boolean).join('\n\n') : a.text.trim() }
        })
        await props.onSubmit(validateUserInputAnswers({ questions: props.questions }, answers))
      }
      close()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const buttonClass = 'rounded-lg border border-ds-border px-3 py-2 text-ds-lg disabled:opacity-40'
  return <section className="rounded-xl border border-ds-border bg-ds-card p-4 text-ds-ink" aria-label={t('title')}>
    <div className="flex items-center justify-between gap-3">
      <strong>{t('title')}</strong>
      {pending ? <button ref={trigger} className={buttonClass} onClick={() => setOpen(true)}>{t('answerQuestions', { count: props.questions.length })}</button>
        : <span>{props.status === 'submitted' ? t('answered') : t('cancelled')}</span>}
    </div>
    {props.questions.map((q) => <div key={q.id} className="mt-3 text-ds-lg"><p>{q.question}</p>
      {props.answers?.find((a) => a.id === q.id) ? <p className="mt-1 whitespace-pre-wrap text-ds-muted">{props.answers.find((a) => a.id === q.id)?.value}</p> : null}</div>)}
    {props.errorMessage ? <p role="alert">{props.errorMessage}</p> : null}
    {open && pending && props.active !== false ? createPortal(<div ref={dialog} role="dialog" data-native-view-occluder="true" aria-modal="false" aria-labelledby={`${props.requestId}-title`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
      style={position ? { left: position.left, top: position.top } : { right: 24, bottom: 24 }}
      className="fixed z-[80] flex max-h-[75vh] w-[min(460px,calc(100vw-32px))] flex-col rounded-2xl border border-ds-border bg-ds-canvas text-ds-ink shadow-2xl">
      <div role="group" tabIndex={0} aria-label={t('moveWindowLabel')}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const bounds = dialog.current?.getBoundingClientRect()
          if (bounds) setPosition(clamp({ left: bounds.left + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0),
            top: bounds.top + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0) }))
        }}
        className="flex shrink-0 cursor-move touch-none select-none items-center justify-between gap-3 border-b border-ds-border px-5 py-3"><h2 id={`${props.requestId}-title`} className="text-ds-2xl font-semibold">{t('title')}</h2>
        <button aria-label={t('answerLater')} className={buttonClass} onClick={close}>×</button></div>
      <div className="min-h-0 overflow-y-auto px-5 pb-5">
      <p className="mt-3 text-ds-lg text-ds-muted">{t('moveHint')}</p>
      {question ? <fieldset disabled={busy} className="mt-5">
        <legend className="mb-4 w-full text-ds-xl font-medium">{question.header ? `${question.header} · ` : ''}{t('questionCounter', { current: index + 1, total: props.questions.length })}<br />{question.question}</legend>
        <div className="grid gap-2">
          {question.options.map((option) => <label key={option.id ?? option.label} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${answer?.label === option.label ? 'border-accent bg-accent/10' : 'border-ds-border'}`}>
            <input type="radio" name={`${props.requestId}-${question.id}`} checked={answer?.label === option.label} onChange={() => update(option.label)} className="mt-1" />
            <span><span className="font-medium">{option.label}{option.recommended ? t('recommended') : ''}</span>{option.description ? <span className="mt-1 block text-ds-lg text-ds-muted">{option.description}</span> : null}</span>
          </label>)}
          {question.options.length ? <label className="flex items-center gap-3 rounded-xl border border-ds-border p-3"><input type="radio" name={`${props.requestId}-${question.id}`} checked={answer?.label === FREE_TEXT_OPTION} onChange={() => update(FREE_TEXT_OPTION)} />{t('other')}</label> : null}
        </div>
        <label className="mt-4 block text-ds-lg">{freeText ? t('answerLabel') : t('contextLabel')}
          <textarea className="mt-2 min-h-24 w-full rounded-lg border border-ds-border bg-ds-main p-3" maxLength={12000}
            value={answer?.text ?? ''} onChange={(event) => update(answer?.label ?? (question.options.length ? FREE_TEXT_OPTION : 'Answer'), event.target.value)} /></label>
      </fieldset> : null}
      {error ? <p role="alert" className="mt-3 text-red-600">{error}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button className={buttonClass} onClick={close}>{t('later')}</button>
        <button disabled={busy} className={buttonClass} onClick={() => void resolve(true)}>{t('cancelRequest')}</button>
        {index > 0 ? <button disabled={busy} className={buttonClass} onClick={() => setIndex(index - 1)}>{t('back')}</button> : null}
        {index < props.questions.length - 1 ? <button disabled={busy || !currentValid} className={buttonClass} onClick={() => setIndex(index + 1)}>{t('next')}</button>
          : <button disabled={busy || !allValid} className={`${buttonClass} bg-accent text-white`} onClick={() => void resolve()}>{busy ? t('submitting') : t('submit')}</button>}
      </div>
      </div>
    </div>, document.body) : null}
  </section>
}
