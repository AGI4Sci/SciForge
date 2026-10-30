import React, { useState, type ReactElement } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { statusLabel } from '../project-header/ProjectHeader.js'

type SettingsSection = 'basic' | 'members'

export function SettingsView({ model, busy, initialSection = 'basic', onAddMember, onRemoveMember }: Readonly<{ model: WorkspaceViewModel; busy: boolean; initialSection?: SettingsSection; onAddMember(userId: string): void; onRemoveMember?(membershipId: string): void }>): ReactElement {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const owner = Boolean(model.currentUserId && model.project?.project.ownerUserId === model.currentUserId)
  return (
    <section className="collaboration-workspace-settings-page">
      <nav className="collaboration-workspace-settings-nav" aria-label="项目设置导航">
        <p className="collaboration-workspace-eyebrow">项目设置</p>
        <button type="button" className={section === 'basic' ? 'is-active' : undefined} aria-current={section === 'basic' ? 'page' : undefined} onClick={() => setSection('basic')}>基本信息</button>
        <button type="button" className={section === 'members' ? 'is-active' : undefined} aria-current={section === 'members' ? 'page' : undefined} onClick={() => setSection('members')}>成员<b>{model.members.length}</b></button>
      </nav>
      <div className="collaboration-workspace-settings-content">
        {section === 'basic' ? <BasicInfo model={model} /> : <Members model={model} owner={owner} busy={busy} onAddMember={onAddMember} onRemoveMember={onRemoveMember} />}
      </div>
    </section>
  )
}

function BasicInfo({ model }: Readonly<{ model: WorkspaceViewModel }>): ReactElement {
  return (
    <div className="collaboration-workspace-settings-basic">
      <header className="collaboration-workspace-page-header">
        <div><h2>基本信息</h2><p>项目的名称和说明。</p></div>
      </header>
      <dl className="collaboration-workspace-settings-info">
        <div><dt>项目名称</dt><dd>{model.currentProject.name}</dd></div>
        <div><dt>项目状态</dt><dd>{statusLabel(model.currentProject.status)}</dd></div>
        <div><dt>项目标识</dt><dd><code>{model.projectId ?? '—'}</code></dd></div>
        <div><dt>项目说明</dt><dd>{model.currentProject.description || '—'}</dd></div>
      </dl>
    </div>
  )
}

function Members({ model, owner, busy, onAddMember, onRemoveMember }: Readonly<{ model: WorkspaceViewModel; owner: boolean; busy: boolean; onAddMember(userId: string): void; onRemoveMember?(membershipId: string): void }>): ReactElement {
  const [userId, setUserId] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const submitMember = () => {
    const value = userId.trim()
    if (!/^usr_[A-Za-z0-9_]{10,62}$/.test(value)) { setInvalid(true); return }
    onAddMember(value)
    setUserId('')
    setInvalid(false)
    setAddOpen(false)
  }
  return (
    <div className="collaboration-workspace-members-section">
      <header className="collaboration-workspace-page-header">
        <div><h2>项目成员 <span className="collaboration-workspace-count">{model.members.length}</span></h2><p>按用户 ID 邀请成员；对方在收件箱接受后加入项目。</p></div>
        {owner ? (
          <div className="collaboration-workspace-add-member-anchor">
            <button type="button" className="collaboration-workspace-button-primary" disabled={busy} aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}><Plus aria-hidden="true" />添加成员</button>
            {addOpen ? (
              <div className="collaboration-workspace-add-member-popover" role="dialog" aria-label="添加成员" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setAddOpen(false) } }}>
                <label>用户 ID<input autoFocus value={userId} aria-invalid={invalid} onChange={(event) => { setUserId(event.target.value); setInvalid(false) }} onKeyDown={(event) => { if (event.key === 'Enter') submitMember() }} placeholder="粘贴对方的用户 ID" /></label>
                {invalid ? <small className="collaboration-workspace-field-error" role="alert">用户 ID 应为 usr_ 格式</small> : <small className="collaboration-workspace-field-hint">对方可以在 Collaboration 左栏底部复制自己的用户 ID。</small>}
                <div>
                  <button type="button" className="collaboration-workspace-button-secondary" onClick={() => setAddOpen(false)}>取消</button>
                  <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={submitMember}>发送邀请</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="collaboration-workspace-members-table" role="table" aria-label="项目成员">
        <div className="collaboration-workspace-members-row is-header" role="row"><span role="columnheader">成员</span><span role="columnheader">职责与能力</span><span role="columnheader">角色与来源</span><span role="columnheader"><span className="collaboration-workspace-visually-hidden">操作</span></span></div>
        {model.members.map((member) => (
          <div className="collaboration-workspace-members-row" role="row" key={member.id}>
            <span className="collaboration-workspace-member-cell" role="cell"><span className="collaboration-workspace-avatar" aria-hidden="true">{member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.userId}</small></span></span>
            <span className="collaboration-workspace-member-capability" role="cell">未填写</span>
            <span className="collaboration-workspace-member-role" role="cell">
              <span className={`collaboration-workspace-pill ${member.role === '所有者' ? 'tone-accent' : 'tone-neutral'}`}>{member.role}</span>
              <small>{member.state === 'invited' ? '已邀请 · 待接受' : member.role === '所有者' ? '项目创建者' : '已加入'}</small>
            </span>
            <span role="cell">{owner && member.userId !== model.currentUserId ? <button type="button" className="collaboration-workspace-icon-button is-danger" aria-label={`移除 ${member.name}`} title={`移除 ${member.name}`} onClick={() => onRemoveMember?.(member.id)}><Trash2 aria-hidden="true" /></button> : null}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
