import type { FeedbackTargetSnapshot, SciForgeReference } from '../../domain';
import { parseSciForgeReferenceAttribute } from '../../../../../packages/support/object-references';

export function highlightSciForgeReference(reference: SciForgeReference, selectedText?: string) {
  const element = elementForSciForgeReference(reference);
  if (!element) return false;
  focusReferencedElement(element, reference, selectedText);
  return true;
}

export function highlightFeedbackTargetSnapshot(target: FeedbackTargetSnapshot, reference?: SciForgeReference, selectedText?: string) {
  const element = elementForFeedbackTargetSnapshot(target);
  if (element) {
    focusReferencedElement(element, reference, selectedText);
    return true;
  }
  if (reference && highlightSciForgeReference(reference, selectedText)) return true;
  return false;
}

function focusReferencedElement(element: HTMLElement, reference?: SciForgeReference, selectedTextOverride?: string) {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('sciforge-reference-focus');
  window.setTimeout(() => element.classList.remove('sciforge-reference-focus'), 2200);
  const payload = isRecord(reference?.payload) ? reference.payload : undefined;
  const selectedText = selectedTextOverride || (typeof payload?.selectedText === 'string' ? payload.selectedText : '');
  if (selectedText) selectTextInElement(element, selectedText);
}

function elementForFeedbackTargetSnapshot(target: FeedbackTargetSnapshot) {
  for (const selector of [target.stableSelector, target.selector]) {
    if (!selector) continue;
    try {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) return element;
    } catch {
      // Ignore invalid selectors from captured evidence and try the next fallback.
    }
  }
  return undefined;
}

function elementForSciForgeReference(reference: SciForgeReference) {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const sourceRef = typeof payload?.sourceRef === 'string' ? payload.sourceRef : reference.ref;
  const uiRef = sourceRef.replace(/^ui-text:/, '').replace(/#[^#]*$/, '');
  if (uiRef.startsWith('ui:')) {
    const selector = uiRef.slice(3);
    try {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) return element;
    } catch {
      // Ignore invalid selectors from legacy references and fall back to attribute matching.
    }
  }
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-sciforge-reference]'))) {
    const parsed = parseSciForgeReferenceAttribute(element.dataset.sciforgeReference);
    if (parsed?.id === reference.id || parsed?.ref === sourceRef || parsed?.ref === reference.ref) return element;
  }
  return undefined;
}

function selectTextInElement(element: HTMLElement, text: string) {
  const range = rangeForTextInElement(element, text);
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function rangeForTextInElement(element: HTMLElement, text: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent ?? '';
    const offset = value.indexOf(text);
    if (offset >= 0) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + text.length);
      return range;
    }
    node = walker.nextNode();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
