import { useEffect, useState, type ReactElement } from 'react'
import type { SiYuanServiceStatus } from '../editor-contract.js'
import { validateSiYuanConfiguration, type SiYuanEditorConfigurationStore } from './editor-configuration.js'
import { useSiYuanServiceStatus, type SiYuanServiceControls } from './service-status.js'
import { useSiYuanLocale } from './locale.js'

const tokenSummary = (service: SiYuanServiceStatus | undefined, text: (zh: string, en: string) => string): string => {
  if (!service) return text('读取中…', 'Loading…')
  if (service.token === 'stored') return text('已配置（保存在本机加密存储）', 'Configured (stored securely on this device)')
  if (service.token === 'environment') return text('来自环境变量 SIYUAN_API_TOKEN', 'Provided by installation configuration')
  if (service.tokenStorage === 'unavailable') return text('未配置（本机安全存储不可用，只能使用 SIYUAN_API_TOKEN）', 'Not configured (secure storage is unavailable)')
  return text('未配置', 'Not configured')
}

export function SiYuanSettingsSection({ service, settings, onSaved }: Readonly<{
  service: SiYuanServiceControls
  settings: SiYuanEditorConfigurationStore
  onSaved?: () => void
}>): ReactElement {
  const { text, errorText } = useSiYuanLocale()
  const [draft, setDraft] = useState(() => ({ url: settings.getSnapshot().url }))
  const [tokenDraft, setTokenDraft] = useState('')
  const [serviceStatus, setServiceStatus, statusError] = useSiYuanServiceStatus(service, true)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connection, setConnection] = useState<string>()
  const [edited, setEdited] = useState(false)
  const [mode, setMode] = useState<'managed' | 'custom'>('managed')
  const [modeEdited, setModeEdited] = useState(false)
  useEffect(() => { if (!modeEdited && serviceStatus) setMode(serviceStatus.mode) }, [modeEdited, serviceStatus])
  const identity = serviceStatus?.identity
  const configuredUrl = serviceStatus?.url
  useEffect(() => {
    if (!edited && configuredUrl !== undefined) setDraft({ url: configuredUrl ?? '' })
  }, [edited, configuredUrl])

  const save = async (): Promise<void> => {
    setConnection(undefined)
    setError(undefined)
    setSaved(false)
    setBusy(true)
    try {
      if (mode === 'custom') validateSiYuanConfiguration(draft)
      // A rejected token must not leave a new address partially saved.
      const token = tokenDraft.trim()
      setServiceStatus(await service.configure(mode === 'managed' ? { mode } : { mode, url: draft.url, ...(token ? { token } : {}) }))
      setTokenDraft('')
      if (mode === 'custom') settings.save(draft)
      else settings.reload()
      setDraft({ url: settings.getSnapshot().url })
      setSaved(true)
      onSaved?.()
    } catch (failure) {
      setError(errorText(failure))
    } finally { setBusy(false) }
  }

  const clearToken = async (): Promise<void> => {
    setConnection(undefined)
    setError(undefined)
    setSaved(false)
    setBusy(true)
    try {
      setServiceStatus(await service.configure({ token: null }))
      setTokenDraft('')
      settings.reload()
    } catch (failure) {
      setError(errorText(failure))
    } finally { setBusy(false) }
  }

  const checkConnection = async (): Promise<void> => {
    setError(undefined)
    setConnection(undefined)
    setBusy(true)
    try {
      const result = await service.check()
      setConnection(text(`连接正常（可读取）：${result.url}，版本 ${result.version}，${result.notebookCount} 个笔记本。`, `Connected (read verified): ${result.url}, version ${result.version}, ${result.notebookCount} notebooks.`))
    } catch (failure) {
      setError(errorText(failure))
    } finally { setBusy(false) }
  }

  return (
    <section aria-label={text('云服务设置', 'Cloud Services settings')} className="space-y-6 text-sm text-ds-ink">
      <label className="block">{text('连接方式', 'Connection mode')}
        <select className="mt-2 block w-full rounded border border-ds-border bg-ds-bg px-3 py-2" value={mode} disabled={busy}
          onChange={event => { setMode(event.target.value as 'managed' | 'custom'); setModeEdited(true); setSaved(false) }}>
          <option value="managed">{text('云空间（推荐）', 'Cloud spaces (recommended)')}</option>
          <option value="custom">{text('自定义服务', 'Custom service')}</option>
        </select>
      </label>
      {mode === 'managed' ? <div className="space-y-2 rounded-xl border border-ds-border p-4 text-ds-muted">
        <p>{text('使用 SciForge 账号自动登录个人空间。项目空间需要明确创建，仅项目当前成员可访问。', 'Use your SciForge account for your personal space. Project spaces are created explicitly and shared only with current project members.')}</p>
        <p>{identity?.state === 'signed-in' ? text('当前账号：', 'Current account: ') + identity.displayName : text('请先登录 SciForge 账号。', 'Sign in to your SciForge account first.')}</p>
        <p>{text('无需配置服务地址、API 令牌或访问授权码。保存后，在云服务页面选择个人或项目空间。', 'No service address, API token or access code is needed. Save, then choose your personal or a project space on the cloud services page.')}</p>
      </div> : <>
      <div className="space-y-2 rounded-xl border border-ds-border p-4 text-ds-muted">
        <h2 className="font-medium text-ds-ink">{text('共享空间', 'Shared space')}</h2>
        <p role="status">{identity?.state === 'signed-in'
          ? text('当前 SciForge 账号：', 'SciForge account: ') + identity.displayName
          : identity?.state === 'signed-out' ? text('请登录 SciForge 云端账号后发表评论', 'Sign in to SciForge to post comments')
            : text('正在确认 SciForge 账号，身份不可用时不能发表评论', 'Checking your SciForge account. Commenting requires a verified identity.')}</p>
        <p className="break-all">{text('当前服务：', 'Current service: ')}{serviceStatus?.url || settings.getSnapshot().url || text('未配置服务地址', 'No service address configured')}</p>
        <p>{text('同一服务中的笔记由团队共同访问；各账号的本机浏览器会话分开保存，评论署名自动跟随 SciForge 账号。', 'Your team shares the notes on this service. Browser sessions are isolated by account and comments use your SciForge identity.')}</p>
      </div>
      <label className="block">{text('服务地址', 'Service address')}
        <input className="mt-2 block w-full rounded border border-ds-border bg-ds-bg px-3 py-2"
          placeholder="http://192.168.1.10:6806" disabled={busy}
          value={draft.url}
          onChange={(event) => { setDraft({ url: event.target.value }); setEdited(true); setSaved(false) }} />
      </label>
      <p className="text-ds-muted">{text('填写可访问的云服务服务地址（局域网或 HTTPS），留空则使用安装时配置的默认地址。请确保服务已启动。', 'Enter the address supplied by your team administrator. Leave it blank to use an installation default, if available.')}</p>
      <button type="button" disabled={busy} className="rounded border border-ds-border px-3 py-2 disabled:opacity-50"
        onClick={() => { void checkConnection() }}>{text('测试已保存的连接', 'Test saved connection')}</button>
      {connection ? <p role="status">{connection}</p> : null}
      <label className="block">{text('API 令牌', 'API token')}
        <input className="mt-2 block w-full rounded border border-ds-border bg-ds-bg px-3 py-2"
          type="password" autoComplete="off" placeholder={text('仅在该服务启用鉴权时填写', 'Only required if your service uses API authentication')}
          disabled={busy} value={tokenDraft}
          onChange={(event) => { setTokenDraft(event.target.value); setSaved(false) }} />
      </label>
      <p className="text-ds-muted">
        {text('令牌：', 'Token: ')}{tokenSummary(serviceStatus, text)}。{text('令牌只写入本机加密存储，不会回显；留空保存则保持当前令牌不变。若服务启用了访问授权码，还需要在内嵌页面中解锁一次。', 'Tokens stay in secure device storage and are never displayed. Leave this field blank to keep the saved token. If your service uses an access code, unlock it in the embedded page.')}
      </p>
      {serviceStatus?.token === 'stored' ? <button type="button" disabled={busy}
        className="rounded border border-ds-border px-3 py-2 disabled:opacity-50"
        onClick={() => { void clearToken() }}>{text('清除已保存令牌', 'Clear saved token')}</button> : null}
      <div className="space-y-2 text-ds-muted">
        <p>{text('自动评论署名需要在服务端安装 Extended Comments 0.8.0 或更高版本。', 'Automatic comment attribution requires Extended Comments 0.8.0 or later on the service.')}</p>
        <p>{text('Agent 成功结束一轮回复后，会把该轮的目标与结论自动归档到所配置的云服务本；中间进度、失败和取消的轮次不会归档。', 'Completed agent replies archive their goal and conclusion to the configured notebook. Progress updates, failed replies, and cancelled turns are excluded.')}</p>
      </div>
      </>}
      {error || statusError ? <p role="alert" className="text-red-600">{error ?? errorText(statusError)}</p> : null}
      {saved ? <p role="status" className="text-ds-muted">{text('设置已保存，主对话与云服务已同步生效。', 'Settings saved. Chats and cloud services now use this configuration.')}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy}
          className="rounded bg-ds-accent px-4 py-2 text-white disabled:opacity-50"
          onClick={() => { void save() }}>{busy ? text('正在保存…', 'Saving…') : text('保存设置', 'Save settings')}</button>
        <button type="button" disabled={busy} className="rounded border border-ds-border px-4 py-2 disabled:opacity-50"
          onClick={() => { setDraft({ url: serviceStatus?.url ?? '' }); setMode(serviceStatus?.mode ?? 'managed'); setModeEdited(false); setEdited(false); setTokenDraft(''); setError(undefined); setSaved(false) }}>{text('重置输入', 'Reset input')}</button>
        <button type="button" disabled={busy} className="rounded border border-ds-border px-4 py-2 disabled:opacity-50"
          onClick={() => { settings.reload(); setSaved(false) }}>{text('重新加载云服务', 'Reload cloud services')}</button>
      </div>
    </section>
  )
}
