import React, { type ReactElement } from 'react'

import type { RequirementsWorkModule, RequirementsAcceptanceCriterion } from '@sciforge/collaboration-contracts'

import { translateWorkspace as cw } from '../workspace-i18n.js'

export type RequirementsEdits = { workModules: RequirementsWorkModule[]; acceptanceCriteria: RequirementsAcceptanceCriterion[] }

export function RequirementsEditor({ value, disabled, onChange }: Readonly<{ value: RequirementsEdits; disabled: boolean; onChange(value: RequirementsEdits): void }>): ReactElement {

  const { workModules, acceptanceCriteria } = value

  const update = (id: string, patch: Partial<RequirementsWorkModule>) => onChange({ ...value, workModules: workModules.map((item) => item.planItemId === id ? { ...item, ...patch } : item) })

  const criteria = (target: string) => <div className="collaboration-requirements-criteria-editor">

    {acceptanceCriteria.map((item, index) => item.target !== target ? null : <div key={index} className="collaboration-requirements-criterion">

      <label>{cw('验收标准')}<textarea value={item.criteria} onChange={(event) => onChange({ ...value, acceptanceCriteria: acceptanceCriteria.map((entry, i) => i === index ? { ...entry, criteria: event.target.value } : entry) })} /></label>

      <label>{cw('验证方式')}<textarea value={item.evidenceMethod} onChange={(event) => onChange({ ...value, acceptanceCriteria: acceptanceCriteria.map((entry, i) => i === index ? { ...entry, evidenceMethod: event.target.value } : entry) })} /></label>

      <button type="button" className="collaboration-workspace-button-secondary" onClick={() => onChange({ ...value, acceptanceCriteria: acceptanceCriteria.filter((_, i) => i !== index) })}>{cw('删除标准')}</button>

    </div>)}

    <button type="button" className="collaboration-workspace-button-secondary" onClick={() => onChange({ ...value, acceptanceCriteria: [...acceptanceCriteria, { target, criteria: '', evidenceMethod: '' }] })}>{cw('添加验收标准')}</button>

  </div>

  return <fieldset disabled={disabled} className="collaboration-workspace-requirements-section collaboration-requirements-editor">

    <legend>{cw('手动编辑工作模块与验收标准')}</legend>

    {workModules.map((item, index) => <fieldset className="collaboration-requirements-module" key={item.planItemId} data-plan-item-id={item.planItemId}>

      <legend>{cw('工作模块')} #{index + 1}</legend>

      <label>{cw('模块标题')}<input value={item.title} onChange={(event) => update(item.planItemId, { title: event.target.value })} /></label>

      <label>{cw('模块目标')}<textarea value={item.objective} onChange={(event) => update(item.planItemId, { objective: event.target.value })} /></label>

      <fieldset className="collaboration-requirements-dependencies"><legend>{cw('依赖模块')}</legend>{workModules.filter((entry) => entry.planItemId !== item.planItemId).map((entry) => <label key={entry.planItemId}><input type="checkbox" checked={item.dependencyPlanItemIds.includes(entry.planItemId)} onChange={(event) => update(item.planItemId, { dependencyPlanItemIds: event.target.checked ? [...item.dependencyPlanItemIds, entry.planItemId] : item.dependencyPlanItemIds.filter((id) => id !== entry.planItemId) })} />{entry.title || `#${workModules.indexOf(entry) + 1}`} </label>)}</fieldset>

      <label><input type="checkbox" checked={Boolean(item.output)} onChange={(event) => update(item.planItemId, { output: event.target.checked ? { kind: 'delivery.output', fileName: '', mediaType: '', maxBytes: 10_485_760 } : undefined })} />{cw('必交文件')}</label>

      {item.output ? <div className="collaboration-requirements-output">

        <label>{cw('文件名')}<input value={item.output.fileName} onChange={(event) => update(item.planItemId, { output: { ...item.output!, fileName: event.target.value } })} /></label>

        <label>{cw('文件媒体类型')}<input value={item.output.mediaType} onChange={(event) => update(item.planItemId, { output: { ...item.output!, mediaType: event.target.value } })} /></label>

        <label>{cw('文件大小上限（字节）')}<input type="number" min={1} max={1_073_741_824} value={item.output.maxBytes} onChange={(event) => update(item.planItemId, { output: { ...item.output!, maxBytes: Number(event.target.value) } })} /></label>

      </div> : null}

      {criteria(item.planItemId)}

      <button type="button" className="collaboration-workspace-button-secondary" onClick={() => onChange({ workModules: workModules.filter((entry) => entry.planItemId !== item.planItemId).map((entry) => ({ ...entry, dependencyPlanItemIds: entry.dependencyPlanItemIds.filter((id) => id !== item.planItemId) })), acceptanceCriteria: acceptanceCriteria.filter((entry) => entry.target !== item.planItemId) })}>{cw('删除模块')}</button>

    </fieldset>)}

    <button type="button" className="collaboration-workspace-button-secondary" onClick={() => onChange({ ...value, workModules: [...workModules, { planItemId: `item_${crypto.randomUUID().replaceAll('-', '')}`, title: '', objective: '', dependencyPlanItemIds: [] }] })}>{cw('添加工作模块')}</button>

    <fieldset><legend>{cw('项目验收标准')}</legend>{criteria('$project')}</fieldset>

  </fieldset>

}

