import type { SciForgeReference } from '../../domain';
import {
  parseSciForgeReferenceAttribute,
  referenceForTextSelection,
  referenceForUiElement,
} from '../../../../../packages/support/object-references';

const CONTEXT_MENU_SKIP_SELECTOR = [
  '.composer',
  '.reference-pick-banner',
  '.settings-dialog',
  '.settings-page',
  '.reference-context-menu',
  '.context-menu',
  '.feedback-popover',
  '.annotation-sidebar',
  '.scenario-list-explorer-tree',
  '.sidebar-section-threads',
  '[data-context-menu="skip"]',
].join(', ');

export function shouldSkipAppContextMenu(target: Element | null | undefined) {
  if (!target) return true;
  return Boolean(target.closest(CONTEXT_MENU_SKIP_SELECTOR));
}

export function textSelectionReferenceTarget(event?: MouseEvent): { element: HTMLElement; reference: SciForgeReference } | undefined {
  const rawTarget = event?.target instanceof Element ? event.target : undefined;
  if (rawTarget?.closest(CONTEXT_MENU_SKIP_SELECTOR)) return undefined;
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();
  if (!selection || selection.rangeCount === 0 || !selectedText) return undefined;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  const element = ancestor?.closest<HTMLElement>('[data-sciforge-reference], .message, .registry-slot, .card, .data-preview-table, table, section');
  if (!element || element.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page')) return undefined;
  if (rawTarget && !element.contains(rawTarget) && !rawTarget.contains(element)) return undefined;
  const sourceReference = parseSciForgeReferenceAttribute(element.dataset.sciforgeReference) ?? referenceForUiElement(element);
  const reference = referenceForTextSelection({ sourceReference, selectedText });
  if (!reference) return undefined;
  return { element, reference };
}

export function referenceTargetFromEvent(event: MouseEvent): { element: HTMLElement; reference: SciForgeReference } | undefined {
  const rawTarget = event.target instanceof Element ? event.target : undefined;
  if (!rawTarget || rawTarget.closest(CONTEXT_MENU_SKIP_SELECTOR)) return undefined;
  const explicit = rawTarget.closest<HTMLElement>('[data-sciforge-reference]');
  if (explicit) {
    const reference = parseSciForgeReferenceAttribute(explicit.dataset.sciforgeReference);
    if (reference) return { element: explicit, reference };
  }
  const implicit = rawTarget.closest<HTMLElement>('button, [role="button"], .registry-slot, .card, .message, .data-preview-table, table, canvas, svg, section, .explorer-row, .nav-item');
  if (!implicit || !(implicit instanceof HTMLElement) || implicit.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page')) return undefined;
  return { element: implicit, reference: referenceForUiElement(implicit) };
}

export function resolveAppContextMenuReference(event: MouseEvent): SciForgeReference | undefined {
  return textSelectionReferenceTarget(event)?.reference ?? referenceTargetFromEvent(event)?.reference;
}
