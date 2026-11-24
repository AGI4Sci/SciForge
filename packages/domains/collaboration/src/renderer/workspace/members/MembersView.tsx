import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { useState, type ReactElement } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'

/**
 * The 成员 page. Everyone sees who is on the Project; only its Owner may invite
 * or remove members, and the Coordinator enforces the same rule.
 */
export function MembersView({ model, busy, onAddMember, onRemoveMember }: Readonly<{ model: WorkspaceViewModel; busy: boolean; onAddMember(userId: string): void; onRemoveMember?(membershipId: string): void }>): ReactElement {
  useWorkspaceTranslation()
  const [userId, setUserId] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const owner = Boolean(model.currentUserId && model.project?.project.ownerUserId === model.currentUserId)
  const submitMember = () => {
    const value = userId.trim()
    if (!/^usr_[A-Za-z0-9_]{10,62}$/.test(value)) { setInvalid(true); return }
    onAddMember(value)
    setUserId('')
    setInvalid(false)
    setAddOpen(false)
  }
  return (
    <section className="collaboration-workspace-page-panel collaboration-workspace-members-page">
      <header className="collaboration-workspace-page-header">
        <div><h2>{cw("项目成员")}<span className="collaboration-workspace-count">{model.members.length}</span></h2><p>{cw("按用户 ID 邀请成员；对方在收件箱接受后加入项目。")}</p></div>
        {owner ? (
          <div className="collaboration-workspace-add-member-anchor">
            <button type="button" className="collaboration-workspace-button-primary" disabled={busy} aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}><Plus aria-hidden="true" />{cw("添加成员")}</button>
            {addOpen ? (
              <div className="collaboration-workspace-add-member-popover" role="dialog" data-native-view-occluder="true" aria-label={cw("添加成员")} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setAddOpen(false) } }}>
                <label>{cw("用户 ID")}<input autoFocus value={userId} aria-invalid={invalid} onChange={(event) => { setUserId(event.target.value); setInvalid(false) }} onKeyDown={(event) => { if (event.key === 'Enter') submitMember() }} placeholder={cw("粘贴对方的用户 ID")} /></label>
                {invalid ? <small className="collaboration-workspace-field-error" role="alert">{cw("用户 ID 应为 usr_ 格式")}</small> : <small className="collaboration-workspace-field-hint">{cw("对方可以在 Collaboration 左栏底部复制自己的用户 ID。")}</small>}
                <div>
                  <button type="button" className="collaboration-workspace-button-secondary" onClick={() => setAddOpen(false)}>{cw("取消")}</button>
                  <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={submitMember}>{cw("发送邀请")}</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="collaboration-workspace-members-table" role="table" aria-label={cw("项目成员")}>
        <div className="collaboration-workspace-members-row is-header" role="row"><span role="columnheader">{cw("成员")}</span><span role="columnheader">{cw("职责与能力")}</span><span role="columnheader">{cw("角色与来源")}</span><span role="columnheader"><span className="collaboration-workspace-visually-hidden">{cw("操作")}</span></span></div>
        {model.members.map((member) => (
          <div className="collaboration-workspace-members-row" role="row" key={member.id}>
            <span className="collaboration-workspace-member-cell" role="cell"><span className="collaboration-workspace-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.userId}</small></span></span>
            <span className="collaboration-workspace-member-capability" role="cell">{cw("未填写")}</span>
            <span className="collaboration-workspace-member-role" role="cell">
              <span className={`collaboration-workspace-pill ${member.role === '所有者' ? 'tone-accent' : 'tone-neutral'}`}>{cw(member.role)}</span>
              <small>{member.state === 'invited' ? cw("已邀请 · 待接受") : member.role === '所有者' ? cw("项目创建者") : cw("已加入")}</small>
            </span>
            <span role="cell">{owner && member.userId !== model.currentUserId ? <button type="button" className="collaboration-workspace-icon-button is-danger" aria-label={cw("移除 {{v0}}", { v0: member.name })} title={cw("移除 {{v0}}", { v0: member.name })} onClick={() => onRemoveMember?.(member.id)}><Trash2 aria-hidden="true" /></button> : null}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
