import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import type { DeliveryManifest } from '@sciforge/collaboration-contracts'
import { deliveryValidationSpecSchema, type DeliveryValidationSpec, type DeliveryValidationRecord, type DeliveryValidationReference } from '../../../coordinator/delivery-validation-contract.js'

export type ValidationAdoption = Readonly<{ required: boolean; reference?: DeliveryValidationReference }>
export type DeliveryValidationProps = Readonly<{
  validationManifest?: DeliveryManifest
  onValidateDelivery?(spec: DeliveryValidationSpec): Promise<DeliveryValidationRecord>
}>

/** Mounted with a scope key by the drawer; unmounted requests cannot restore a reference. */
export function DeliveryValidationControls({ validationManifest: manifest, onValidateDelivery, busy, onAdopt, adopting, required, onRequiredChange }: DeliveryValidationProps & Readonly<{
  busy: boolean; adopting: boolean; required: boolean; onRequiredChange(value: boolean): void; onAdopt?(selection: ValidationAdoption): void
}>): ReactElement {
  const [objectId, setObjectId] = useState(manifest?.objects[0]?.objectId ?? '')
  const [assertions, setAssertions] = useState('[]')
  const [result, setResult] = useState<DeliveryValidationRecord>()
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const invalidate = () => { generation.current++; setResult(undefined); setChecking(false); setError('') }
  const object = manifest?.objects.find(entry => entry.objectId === objectId)
  let spec: DeliveryValidationSpec | undefined
  try {
    spec = deliveryValidationSpecSchema.parse({ version: 1, target: { projectId: manifest?.projectId, taskId: manifest?.taskId,
      deliveryManifestId: manifest?.deliveryManifestId, manifestDigest: manifest?.manifestDigest, object }, assertions: JSON.parse(assertions) })
  } catch { /* Invalid drafts never leave the editor. */ }
  const check = async () => {
    if (!spec || !onValidateDelivery || busy || checking) return
    const token = ++generation.current
    setResult(undefined); setError(''); setChecking(true)
    try {
      const record = await onValidateDelivery(spec)
      if (token === generation.current) setResult(record)
    } catch (cause) {
      if (token === generation.current) setError(cause instanceof Error ? cause.message : '检查中断')
    } finally { if (token === generation.current) setChecking(false) }
  }
  const reference = result?.status === 'passed' ? { specDigest: result.specDigest, targetDigest: result.targetDigest } : undefined
  return <div data-testid="delivery-validation">
    {manifest && onValidateDelivery ? <fieldset>
      <legend>封存交付 JSON 字段的确定性验收</legend>
      <p>仅依据当前封存交付的 JSON 检查所列字段条件，最多 1 MiB。通过不代表科研结论成立或复现成功；规格与结果保存在此设备。</p>
      <p>封存清单 {manifest.deliveryManifestId} · {manifest.manifestDigest}</p>
      <label>封存对象<select aria-label="封存检查对象" value={objectId} disabled={busy} onChange={event => { invalidate(); setObjectId(event.target.value) }}>
        {manifest.objects.map(entry => <option key={entry.objectId} value={entry.objectId}>{manifest.outputs?.find(output => output.objectId === entry.objectId)?.fileName ?? entry.objectId} · {entry.sha256.slice(0, 12)}</option>)}
      </select></label>
      {object ? <p>对象版本 {object.revision} · {object.byteCount} bytes · {object.mediaType}{object.byteCount > 1_048_576 ? ' · 超出 1 MiB，不能检查' : ''}</p> : null}
      <p>path 是属性键数组（数组下标用字符串），[] 表示根；equals 比较标量 expected，range 检查闭区间 min/max。</p>
      <label>字段条件（JSON）<textarea aria-label="JSON assertions" rows={5} value={assertions} disabled={busy} onChange={event => { invalidate(); setAssertions(event.target.value) }} /></label>
      {!spec ? <p role="status">请输入 1–128 条 equals/range 条件；格式与上下界须有效。</p> : null}
      <button type="button" disabled={busy || checking || !spec || !object || object.byteCount > 1_048_576} onClick={() => void check()}>冻结规格并检查</button>
      {checking ? <p role="status">unknown · 检查进行中</p> : null}
      {result ? <p role="status">{result.status} · 记录号 {result.checkId} · {result.detail}</p> : null}
      {error ? <p role="alert">unknown · {error}</p> : null}
    </fieldset> : null}
    <label><input type="checkbox" checked={required} disabled={busy} onChange={event => onRequiredChange(event.target.checked)} />本次采纳必须使用冻结检查</label>
    <p>{required ? '检查采纳：必须通过当前规格检查，后台将重新授权并检查。' : '普通人工采纳：由负责人审阅判断。'}</p>
    <button type="button" className="collaboration-workspace-button-primary" disabled={busy || checking || (required && !reference)} onClick={() => { if (!required || reference) onAdopt?.({ required, ...(reference ? { reference } : {}) }) }}>{adopting ? '处理中…' : '采纳交付'}</button>
  </div>
}
