import React, { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Send } from 'lucide-react'
import { collaborationActivityCommentInputSchema } from '../../../contract.js'
import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'

export type TaskDiscussionMentionableUser = Readonly<{ userId: string; displayName: string }>
type Mention = TaskDiscussionMentionableUser & Readonly<{ start: number; end: number; invalidated?: boolean }>

function boundary(character: string | undefined): boolean {
  return !character || !/[\p{L}\p{N}\p{M}_@-]/u.test(character)
}
function startsMention(text: string, start: number): boolean {
  return boundary(Array.from(text.slice(0, start)).at(-1))
}
function endsMention(text: string, end: number): boolean {
  return boundary(Array.from(text.slice(end))[0])
}

/** A changed selection stays unresolved until explicitly selected again, even if its name is restored. */
function editedMentions(previous: string, next: string, mentions: readonly Mention[]): Mention[] {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1
  let suffix = 0
  while (suffix < previous.length - start && suffix < next.length - start && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix += 1
  const oldEnd = previous.length - suffix
  const delta = next.length - previous.length
  return mentions.flatMap((mention): Mention[] => {
    if (mention.end <= start) return [mention]
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }]
    // Deleting the @ removes this occurrence. Edits within its name retain an
    // unresolved marker so a now-unique same name cannot inherit its identity.
    if (start <= mention.start) return []
    return [{ ...mention, end: Math.max(mention.start + 1, mention.end + delta), invalidated: true }]
  }).map((mention) => ({
    ...mention,
    invalidated: mention.invalidated || next.slice(mention.start, mention.end) !== `@${mention.displayName}` || !startsMention(next, mention.start) || !endsMention(next, mention.end)
  }))
}

function recipients(text: string, users: readonly TaskDiscussionMentionableUser[], selected: readonly Mention[]) {
  const ids = new Set<string>()
  let ambiguous = false
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('@', cursor)
    if (start < 0) break
    cursor = start + 1
    if (!startsMention(text, start)) continue
    const explicit = selected.find((mention) => mention.start === start)
    if (explicit) {
      // A removed/renamed/edited recipient must not silently turn into another
      // member who happens to have the same name. Only a new selection clears it.
      if (!explicit.invalidated && text.slice(start, explicit.end) === `@${explicit.displayName}` && endsMention(text, explicit.end) && users.some((user) => user.userId === explicit.userId && user.displayName === explicit.displayName)) ids.add(explicit.userId)
      cursor = Math.max(start + 1, explicit.end)
      continue
    }
    const matches = users.filter((user) => text.startsWith(user.displayName, start + 1) && endsMention(text, start + 1 + user.displayName.length))
    const longest = Math.max(0, ...matches.map((user) => user.displayName.length))
    const exact = new Set(matches.filter((user) => user.displayName.length === longest).map((user) => user.userId))
    if (exact.size === 1) ids.add([...exact][0]!)
    else if (exact.size > 1) ambiguous = true
    cursor = start + 1 + longest
  }
  return { ids: [...ids], ambiguous }
}

export function TaskDiscussionComposer({ cloudTaskId, busy = false, mentionableUsers, onComment }: Readonly<{
  cloudTaskId?: string
  busy?: boolean
  mentionableUsers: readonly TaskDiscussionMentionableUser[]
  onComment?(text: string, mentionedUserIds: readonly string[]): void
}>): ReactElement {
  useWorkspaceTranslation()
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<readonly Mention[]>([])
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const listId = useId()
  const disabled = busy || !cloudTaskId || !onComment
  // Only the real current-project directory is eligible; repeated rows cannot
  // create duplicate options or manufacture an extra identity.
  const users = [...new Map(mentionableUsers.filter((user) => user.displayName.trim()).map((user) => [user.userId, user])).values()]
  const mentionStart = text.lastIndexOf('@', Math.max(0, caret - 1))
  const query = mentionStart >= 0 && mentionStart < caret && startsMention(text, mentionStart)
    ? text.slice(mentionStart + 1, caret)
    : null
  const suggestions = query === null ? [] : users.filter((user) => user.displayName.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()))
  const menuOpen = !disabled && !dismissed && suggestions.length > 0
  const active = Math.min(activeIndex, Math.max(0, suggestions.length - 1))
  const resolved = recipients(text, users, selected)
  const validText = collaborationActivityCommentInputSchema.shape.text.safeParse(text.trim()).success
  useLayoutEffect(() => {
    setSelected((previous) => {
      if (!previous.some((mention) => !mention.invalidated && !mentionableUsers.some((user) => user.userId === mention.userId && user.displayName === mention.displayName))) return previous
      return previous.map((mention) => mentionableUsers.some((user) => user.userId === mention.userId && user.displayName === mention.displayName) ? mention : { ...mention, invalidated: true })
    })
  }, [mentionableUsers])
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    input.current?.focus()
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [text])

  const choose = (user: TaskDiscussionMentionableUser): void => {
    if (disabled || query === null) return
    const existing = selected.find((mention) => mention.start === mentionStart && mention.end >= caret)
    let end = existing?.end ?? caret
    if (!existing) while (end < text.length && !boundary(Array.from(text.slice(end))[0])) end += 1
    const token = `@${user.displayName}`
    const next = text.slice(0, mentionStart) + token + ' ' + text.slice(end)
    const preserved = editedMentions(text, next, selected).filter((mention) => mention.start < mentionStart || mention.start >= mentionStart + token.length + 1)
    setSelected([...preserved, { ...user, start: mentionStart, end: mentionStart + token.length }])
    setText(next)
    const position = mentionStart + token.length + 1
    setCaret(position)
    pendingCaret.current = position
    setDismissed(true)
    setActiveIndex(0)
  }
  const send = (): void => {
    if (disabled || !validText) return
    onComment?.(text.trim(), resolved.ids)
    setText('')
    setSelected([])
    setCaret(0)
    setDismissed(false)
  }
  return <div className="collaboration-workspace-task-drawer-composer-region">
    {!cloudTaskId ? <p className="collaboration-workspace-task-drawer-composer-note" role="status" data-testid="discussion-unavailable">{cw('该模块还没有云端任务，派发后才能发起讨论')}</p> : null}
    {menuOpen ? <ul id={listId} role="listbox" aria-label={cw('选择要提及的成员')} style={{ listStyle: 'none', margin: 0, padding: 4, maxHeight: 180, overflowY: 'auto' }}>
      {suggestions.map((user, index) => <li key={user.userId} role="presentation"><button
        type="button" role="option" tabIndex={-1} id={`${listId}-${index}`} aria-selected={index === active}
        className="collaboration-workspace-button-secondary" style={{ width: '100%', textAlign: 'left', fontWeight: index === active ? 700 : 400 }}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(user)}
      >{user.displayName}{users.some((other) => other.userId !== user.userId && other.displayName === user.displayName) ? <small> · {user.userId}</small> : null}</button></li>)}
    </ul> : null}
    {resolved.ids.length ? <p className="collaboration-workspace-task-drawer-composer-note" role="status">{cw('将通知：{{names}}', { names: resolved.ids.map((id) => {
      const user = users.find((entry) => entry.userId === id)!
      return users.some((other) => other.userId !== id && other.displayName === user.displayName) ? `${user.displayName} (${id})` : user.displayName
    }).join('、') })}</p> : null}
    {resolved.ambiguous ? <p className="collaboration-workspace-task-drawer-composer-note" role="status">{cw('同名成员须从建议中选择；未选择的同名提及不会通知。')}</p> : null}
    <div className="collaboration-workspace-task-drawer-composer">
      <input ref={input} disabled={disabled} value={text} role="combobox" aria-autocomplete="list" aria-expanded={menuOpen} aria-controls={menuOpen ? listId : undefined} aria-activedescendant={menuOpen ? `${listId}-${active}` : undefined}
        maxLength={collaborationActivityCommentInputSchema.shape.text.maxLength ?? undefined}
        placeholder={cw('发起新讨论… @成员')} aria-label={cw('发起新讨论')}
        onChange={(event) => {
          const next = event.target.value
          setSelected(editedMentions(text, next, selected))
          setText(next); setCaret(event.target.selectionStart ?? next.length); setActiveIndex(0); setDismissed(false)
        }}
        onSelect={(event) => { setCaret(event.currentTarget.selectionStart ?? text.length); setActiveIndex(0) }}
        onFocus={() => setDismissed(false)} onBlur={() => setDismissed(true)}
        onKeyDown={(event) => {
          if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return
          if (menuOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation()
            if (event.key === 'Enter') choose(suggestions[active]!)
            else if (event.key === 'Escape') setDismissed(true)
            else setActiveIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter') { event.preventDefault(); send() }
        }} />
      <button type="button" aria-label={cw('发送')} title={cw('发送')} disabled={disabled || !validText} onClick={send}><Send aria-hidden="true" /></button>
    </div>
  </div>
}
