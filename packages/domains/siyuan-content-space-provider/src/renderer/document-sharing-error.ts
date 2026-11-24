type Text = (zh: string, en: string) => string
const messages: Readonly<Record<string, readonly [string, string]>> = {
  'Cloud rejection: unsupported_content.': ['分享服务暂不支持处理这篇文档的内容。原文不受影响，请稍后重试。', 'The sharing service cannot process this document content yet. The original is unchanged; try again later.'],
  'Cloud rejection: kernel_response_invalid.': ['云端返回的文档格式暂时无法处理。原文不受影响，请稍后重试或联系维护者。', 'The service could not process the document response. The original is unchanged; retry later or contact the administrator.'],
  'Cloud rejection: invalid_request.': ['分享请求未被接受，请关闭分享面板后重新打开。', 'The sharing request was not accepted. Close and reopen the sharing panel.'],
  'Cloud rejection: source_mismatch.': ['文档与分享链接不匹配，请重新打开当前文档的分享面板。', 'The document and share link do not match. Reopen sharing for the current document.'],
  'Cloud rejection: access_denied.': ['你没有管理这篇文档分享的权限，请联系空间负责人。', 'You cannot manage sharing for this document. Contact the space owner.'],
  'Cloud rejection: permission_denied.': ['你没有执行此操作的权限，请联系空间负责人。', 'You do not have permission for this operation. Contact the space owner.'],
  'Cloud rejection: login_required.': ['请重新登录 SciForge 后重试。', 'Sign in to SciForge again, then retry.'],
  'Cloud rejection: link_revoked.': ['这个分享链接已撤销，请重新打开分享面板查看当前状态。', 'This share link was revoked. Reopen the sharing panel to see its current state.'],
  'Cloud rejection: document_not_found.': ['无法找到或访问这篇文档，请重新打开文档后重试。', 'The document cannot be found or accessed. Open the document again and retry.'],
  'Cloud rejection: link_not_found.': ['无法找到这个分享链接，请重新打开分享面板。', 'This share link was not found. Reopen the sharing panel.'],
  'Cloud rejection: revision_conflict.': ['分享状态已更新，请关闭并重新打开面板后再操作。', 'The sharing state changed. Close and reopen the panel before trying again.'],
  'Cloud rejection: idempotency_conflict.': ['该操作与已有请求冲突，请重新打开面板核对状态。', 'This operation conflicts with an earlier request. Reopen the panel to check its state.'],
  'Cloud rejection: operation_in_doubt.': ['操作结果尚未确认，请先重新打开面板核对状态，不要重复提交。', 'The operation outcome is not confirmed. Reopen the panel to check its state before submitting again.'],
  'Cloud rejection: operation_rejected.': ['操作未被接受，请重新打开面板核对权限和状态。', 'The operation was rejected. Reopen the panel to check permissions and state.'],
  'Cloud rejection: kernel_unavailable.': ['文档服务暂时不可用，请稍后重试。', 'The document service is temporarily unavailable. Try again later.'],
  'Cloud rejection: service_unavailable.': ['分享服务暂时不可用，请稍后重试。', 'The sharing service is temporarily unavailable. Try again later.']
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined

/** Match exact, locally generated markers in the public capability failure envelope.
 * Never extract a code from or display arbitrary server/handler message text. */
export function documentSharingErrorText(failure: unknown, text: Text): string {
  const outer = record(failure)
  const reason = outer?.code === 'handler_failed' ? record(outer.details) : outer
  const code = outer?.code === 'handler_failed' ? reason?.reasonCode : reason?.code
  const message = outer?.code === 'handler_failed' ? reason?.reasonMessage : reason?.message
  if ((code === 'cloud_rejected' || code === 'cloud_unavailable') && typeof message === 'string' && Object.hasOwn(messages, message)) {
    const pair = messages[message]
    return text(pair[0], pair[1])
  }
  if (code === 'identity_required' || code === 'authentication_required' || code === 'principal_changed') return text('请重新登录 SciForge 后重试。', 'Sign in to SciForge again, then retry.')
  if (code === 'space_not_ready') return text('空间尚未准备好，请稍后重试。', 'This space is not ready. Try again later.')
  if (code === 'space_required') return text('请选择个人空间或你有权限访问的项目空间。', 'Choose your personal space or a project space you can access.')
  if (code === 'unauthorized' || code === 'forbidden' || code === 'resource_scope_mismatch') return text('当前账号无法访问这篇文档，请重新打开文档或联系空间负责人。', 'This account cannot access the document. Open it again or contact the space owner.')
  return text('暂时无法完成分享操作，请确认云端连接后重新打开分享面板。', 'Sharing could not be completed. Check the cloud connection and reopen the sharing panel.')
}
