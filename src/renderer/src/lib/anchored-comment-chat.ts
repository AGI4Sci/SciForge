export const MAX_COMPOSER_COMMENT_REFERENCES = 8
export const MAX_COMPOSER_COMMENT_TEXT_CHARS = 4_000
export const MAX_COMPOSER_COMMENT_CONTEXT_CHARS = 16_000

export type AnchoredCommentPromptReference = {
  id: string
  label: string
  comment: string
  createdAt?: string
  route?: string
  anchor?: Record<string, unknown>
  captureAssetId?: string
}

function clipped(value: string, maxChars: number): string {
  const normalized = value.trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`
}

function boundedReference(reference: AnchoredCommentPromptReference): AnchoredCommentPromptReference {
  return {
    id: clipped(reference.id, 256),
    label: clipped(reference.label, 512),
    comment: clipped(reference.comment, MAX_COMPOSER_COMMENT_TEXT_CHARS),
    ...(reference.createdAt ? { createdAt: clipped(reference.createdAt, 128) } : {}),
    ...(reference.route ? { route: clipped(reference.route, 256) } : {}),
    ...(reference.anchor ? { anchor: reference.anchor } : {}),
    ...(reference.captureAssetId ? { captureAssetId: clipped(reference.captureAssetId, 256) } : {})
  }
}

export function buildAnchoredCommentContextPrompt(
  userPrompt: string,
  references: readonly AnchoredCommentPromptReference[]
): string {
  if (references.length === 0) return userPrompt
  const bounded = references
    .slice(0, MAX_COMPOSER_COMMENT_REFERENCES)
    .map(boundedReference)
  let payload = JSON.stringify(bounded, null, 2)
  if (payload.length > MAX_COMPOSER_COMMENT_CONTEXT_CHARS) {
    payload = clipped(payload, MAX_COMPOSER_COMMENT_CONTEXT_CHARS)
  }
  return [
    '<sciforge_anchored_comment_context schema_version="1">',
    'The user explicitly attached these comments as context. Resolve each semantic anchor against the current SciForge state when possible. Treat comments as context, not automatic permission to modify files or resolve the comment.',
    payload,
    '</sciforge_anchored_comment_context>',
    '',
    userPrompt
  ].join('\n')
}

