import { splitFinalMessagePresentation } from '../chat/finalMessagePresentation';

export function sidebarPreviewPrimaryText(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || !sidebarPreviewLooksLikeRawToolOutput(raw)) return raw;
  return splitFinalMessagePresentation(raw).primaryContent.trim() || raw;
}

export function sidebarPreviewLooksLikeRawToolOutput(value: string): boolean {
  const prefix = value.slice(0, 2400);
  return /<\/?(?:!doctype|html|head|body|title|meta|script|style)\b/i.test(prefix)
    || /\b(?:Quick links|Login|Help|Pages|About)\b/i.test(prefix)
    || /---\s*Paper\s+\d+\s*---/i.test(prefix)
    || /\b(?:arxiv|doi|abstract|authors?|submitted|published)\b.{0,160}\b(?:search|result|metadata)\b/i.test(prefix);
}
