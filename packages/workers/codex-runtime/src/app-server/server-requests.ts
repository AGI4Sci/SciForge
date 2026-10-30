import type { CodexAppServerJsonRpcRequest } from './protocol'

import {
  codexAppServerApprovalMethodInfo,
  isCodexAppServerUserInputRequestMethod
} from './request-registry'

export function defaultCodexAppServerServerRequestHandler(
  request: CodexAppServerJsonRpcRequest
): unknown {
  return defaultCodexAppServerServerRequestResponse(request)
}

export function defaultCodexAppServerServerRequestResponse(
  request: CodexAppServerJsonRpcRequest
): unknown {
  const approvalInfo = codexAppServerApprovalMethodInfo(request.method)
  if (approvalInfo) return approvalInfo.defaultResponse()
  if (request.method === 'mcpServer/elicitation/request') return { action: 'cancel', content: null }
  if (isCodexAppServerUserInputRequestMethod(request.method)) return { answers: {} }
  if (request.method === 'attestation/generate') return { token: '' }
  throw new Error(`Unsupported Codex app-server request: ${request.method}`)
}

export function visibleServerRequestFailureMessage(_method: string): string {
  return 'Codex requested an unsupported operation and it was declined.'
}
