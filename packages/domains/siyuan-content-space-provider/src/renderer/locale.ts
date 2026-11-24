import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/** Package-owned copy follows the shared application language, without host imports. */
export function useSiYuanLocale() {
  const { i18n } = useTranslation()
  const english = (i18n.resolvedLanguage ?? i18n.language ?? 'zh').startsWith('en')
  const text = useCallback((zh: string, en: string): string => english ? en : zh, [english])
  const errorText = useCallback((failure: unknown): string => {
    const message = failure instanceof Error ? failure.message : String(failure)
    if (/editor_unavailable/u.test(message)) return text('当前环境不支持内嵌编辑器，请使用 SciForge 桌面应用打开云服务。', 'The embedded editor is unavailable here. Open Cloud Services in the SciForge desktop app.')
    if (/space_not_ready/u.test(message)) return text('空间尚未准备好，请查看创建状态；如果创建失败，可重试个人空间或联系项目负责人。', 'This space is not ready. Check its provisioning status; if it failed, retry your personal space or contact the project owner.')
    if (/identity_required|signed.out|authentication_required/u.test(message)) return text('请先登录 SciForge 账号后重试。', 'Sign in to SciForge, then try again.')
    if (/project_directory_unavailable|cloud_unavailable|device_required/u.test(message)) return text('暂时无法读取项目，请确认云端连接后重试。', 'Projects are unavailable. Check your cloud connection and retry.')
    if (/space_required/u.test(message)) return text('请选择个人空间或你有权限访问的项目空间。', 'Choose your personal space or a project space you can access.')
    if (/forbidden|membership|access_denied/u.test(message)) return text('你当前没有该空间的操作权限，请刷新空间列表；项目空间请联系项目负责人。', 'You do not have permission for this space operation. Refresh the spaces list or contact the project owner.')
    if (/provision|gateway|managed.*unavailable/u.test(message)) return text('空间暂未准备好，请查看创建状态后重试。', 'This space is not ready yet. Check its provisioning status before retrying.')
    if (/not_configured/u.test(message)) return text('请填写云服务服务地址后连接。', 'Enter your cloud services service address to connect.')
    if (/unauthorized/u.test(message)) return text('服务拒绝访问。请检查 API 令牌或服务访问授权。', 'Access denied. Check your API token or service access authorization.')
    if (/provider_unavailable/u.test(message)) return text('无法连接服务，请检查地址和网络后重试。', 'Cannot reach the service. Check the address and network, then retry.')
    if (/invalid_configuration|HTTP 或 HTTPS/u.test(message)) return text('请输入有效的 HTTP 或 HTTPS 服务地址。', 'Enter a valid HTTP or HTTPS service address.')
    return english ? 'Cloud Services could not complete this operation. Check your service settings and try again.' : message
  }, [english, text])
  return { text, errorText }
}

export const siYuanTranslations = Object.freeze({
  namespace: 'common',
  resources: {
    en: { siyuanCloudNotes: 'Cloud Services' },
    zh: { siyuanCloudNotes: '云服务' }
  }
})
