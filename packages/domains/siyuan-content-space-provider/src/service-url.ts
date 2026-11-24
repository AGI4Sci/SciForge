/** The editor and API must agree on one service, including its deployment path. */
export function normalizeSiYuanServiceUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入有效的 HTTP 或 HTTPS 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash || /[\r\n]/u.test(value)) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 地址，且不能包含用户名、密码、查询参数或换行。')
  }
  return url.href.replace(/\/$/u, '')
}
