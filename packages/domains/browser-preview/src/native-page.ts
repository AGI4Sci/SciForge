// Fixed, package-owned programs executed only in a dedicated isolated world.
// Web pages cannot access the opaque target map, and callers never supply code.
export const NATIVE_PAGE_WORLD = 1042
const sensitiveSelector = 'input[type="password"], [autocomplete~="current-password"], [autocomplete~="new-password"], [autocomplete~="one-time-code"], [autocomplete^="cc-"], [data-visual-context-sensitive]'

export const nativePageSnapshotScript = `(() => {
  const state = globalThis.__sciforgePage ??= { refs: new WeakMap(), targets: new Map() };
  const sensitive = element => element.closest(${JSON.stringify(sensitiveSelector)});
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const lines = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  let count = 0;
  while ((node = walker.nextNode()) && count < 60000) {
    const element = node.parentElement;
    if (!element || element.closest('script, style, noscript') || sensitive(element) || !visible(element)) continue;
    const text = node.textContent.trim();
    if (text) { lines.push('- text ' + JSON.stringify(text.slice(0, 4000))); count += text.length; }
  }
  // Include readable same-origin iframe text so the conversation sees the
  // page a human sees. Cross-origin frames remain isolated by the browser.
  for (const frame of document.querySelectorAll('iframe')) {
    if (count >= 60000) break;
    try {
      const frameDoc = frame.contentDocument;
      if (!frameDoc) continue;
      const frameWalker = frameDoc.createTreeWalker(frameDoc.body || frameDoc.documentElement, NodeFilter.SHOW_TEXT);
      let frameNode;
      while ((frameNode = frameWalker.nextNode()) && count < 60000) {
        const frameElement = frameNode.parentElement;
        if (!frameElement || frameElement.closest('script, style, noscript') || sensitive(frameElement) || !visible(frameElement)) continue;
        const frameText = frameNode.textContent.trim();
        if (frameText) { lines.push('- iframe text ' + JSON.stringify(frameText.slice(0, 4000))); count += frameText.length; }
      }
    } catch (_) { /* cross-origin frame */ }
  }
  // Spreadsheet-like editors often render their grid on a canvas, while
  // keeping a semantic accessibility layer in the DOM. Expose that layer
  // explicitly so virtualized tables (including embedded Feishu Base views)
  // remain readable even when they contain no text nodes of their own.
  // Traverse open shadow roots used by componentized editors and widgets.
  const roots = [];
  const seenRoots = new Set();
  const collectRoot = root => {
    if (!root || seenRoots.has(root)) return;
    seenRoots.add(root); roots.push(root);
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collectRoot(element.shadowRoot);
  };
  collectRoot(document);
  const tableRoots = roots.flatMap(root => [...root.querySelectorAll('table, [role="table"], [role="grid"]')]);
  for (const root of tableRoots) {
    if (count >= 60000 || sensitive(root) || !visible(root)) continue;
    const rows = root.querySelectorAll('tr, [role="row"]');
    let rowNumber = 0;
    for (const row of rows) {
      if (count >= 60000 || sensitive(row) || !visible(row)) continue;
      rowNumber++;
      const cells = row.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], [role="cell"]');
      const values = [];
      for (const cell of cells) {
        if (sensitive(cell) || !visible(cell)) continue;
        const value = (cell.getAttribute('aria-label') || cell.textContent || '').replace(/\\s+/gu, ' ').trim();
        if (value) values.push(value.slice(0, 2000));
      }
      if (values.length) {
        lines.push('- table row ' + (row.getAttribute('aria-rowindex') || rowNumber) + ': ' + JSON.stringify(values));
        count += values.join(' ').length;
      }
    }
  }
  const targets = [];
  state.targets.clear();
  const interactive = roots.flatMap(root => [...root.querySelectorAll('a[href], button, input, textarea, select, canvas, svg [role], [contenteditable="true"], [role], [tabindex]')]);
  for (const element of interactive) {
    if (targets.length >= 512) break;
    if (sensitive(element) || !visible(element)) continue;
    let ref = state.refs.get(element);
    if (!ref) { ref = 'target_' + [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join(''); state.refs.set(element, ref); }
    state.targets.set(ref, element);
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const safeText = [];
    const children = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let child;
    while ((child = children.nextNode())) {
      if (child.parentElement && !sensitive(child.parentElement) && visible(child.parentElement)) safeText.push(child.textContent);
    }
    const name = element.getAttribute('aria-label') || element.getAttribute('placeholder') || safeText.join(' ').trim() || element.getAttribute('title') || '';
    const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? ' value=' + JSON.stringify(element.value.slice(0, 4000)) : '';
    lines.push('- ' + role + ' ' + JSON.stringify(name.slice(0, 1000)) + value + ' [ref=' + ref + ']');
    targets.push({ targetRef: ref });
  }
  // Canvas widgets have no text nodes; expose author-provided labels and
  // geometry so the visual presentation path can target them for OCR/vision.
  for (const canvas of roots.flatMap(root => [...root.querySelectorAll('canvas')])) {
    if (sensitive(canvas) || !visible(canvas)) continue;
    const label = canvas.getAttribute('aria-label') || canvas.getAttribute('title') || canvas.getAttribute('data-name') || canvas.getAttribute('data-testid') || '';
    if (label || canvas.width || canvas.height) lines.push('- canvas ' + JSON.stringify(label.slice(0, 1000)) + ' [size=' + canvas.width + 'x' + canvas.height + ']');
  }
  const text = lines.join('\\n');
  return { ariaSnapshot: text.slice(0, 60000), targets, truncated: text.length > 60000 || count >= 60000,
    viewport: { width: Math.max(1, Math.min(4096, innerWidth)), height: Math.max(1, Math.min(4096, innerHeight)) } };
})()`

export function nativePageScrollScript(input: { targetRef?: string; deltaX: number; deltaY: number }): string {
  return `(() => {
  const state = globalThis.__sciforgePage ??= { refs: new WeakMap(), targets: new Map() };
  const requestedTarget = ${JSON.stringify(input.targetRef ?? '')};
  const deltaX = ${JSON.stringify(input.deltaX)};
  const deltaY = ${JSON.stringify(input.deltaY)};
  const root = document.scrollingElement || document.documentElement;
  const visible = element => element === root || (element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const scrollable = element => {
    if (!visible(element)) return false;
    const style = getComputedStyle(element);
    const vertical = deltaY === 0 || /^(?:auto|overlay|scroll)$/u.test(style.overflowY);
    const horizontal = deltaX === 0 || /^(?:auto|overlay|scroll)$/u.test(style.overflowX);
    return vertical && horizontal
      && (deltaY === 0 || element.scrollHeight - element.clientHeight > 2)
      && (deltaX === 0 || element.scrollWidth - element.clientWidth > 2);
  };
  const targetElement = requestedTarget ? state.targets.get(requestedTarget) : undefined;
  const ancestors = [];
  let current = targetElement;
  while (current) { if (scrollable(current)) ancestors.push(current); current = current.parentElement; }
  const pointElement = document.elementFromPoint(Math.max(0, innerWidth / 2), Math.max(0, innerHeight / 2));
  current = pointElement;
  while (current) { if (scrollable(current) && !ancestors.includes(current)) ancestors.push(current); current = current.parentElement; }
  if (scrollable(root) && !ancestors.includes(root)) ancestors.push(root);
  const target = ancestors[0] || root;
  state.fullPageTarget = target;
  const beforeTop = Math.max(0, Number(target.scrollTop) || 0);
  const beforeLeft = Math.max(0, Number(target.scrollLeft) || 0);
  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const maxLeft = Math.max(0, target.scrollWidth - target.clientWidth);
  target.scrollTop = Math.min(maxTop, Math.max(0, beforeTop + deltaY));
  target.scrollLeft = Math.min(maxLeft, Math.max(0, beforeLeft + deltaX));
  const afterTop = Math.max(0, Number(target.scrollTop) || 0);
  const afterLeft = Math.max(0, Number(target.scrollLeft) || 0);
  const changed = beforeTop !== afterTop || beforeLeft !== afterLeft;
  return { changed, beforeTop, afterTop, maxTop, atStart: afterTop <= 1, atEnd: afterTop >= maxTop - 1 };
})()`
}

export function nativePageFullPageScript(input: { targetRef?: string; top?: number }): string {
  return `(() => {
  const state = globalThis.__sciforgePage ??= { refs: new WeakMap(), targets: new Map() };
  const requestedTarget = ${JSON.stringify(input.targetRef ?? '')};
  const requestedTop = ${input.top === undefined ? 'undefined' : JSON.stringify(input.top)};
  const root = document.scrollingElement || document.documentElement;
  const visible = element => element === root || (element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const scrollable = element => visible(element) && element.scrollHeight - element.clientHeight > 2
    && /^(?:auto|overlay|scroll)$/u.test(getComputedStyle(element).overflowY);
  const targetElement = requestedTarget ? state.targets.get(requestedTarget) : undefined;
  const ancestors = [];
  let current = targetElement;
  while (current) { if (scrollable(current)) ancestors.push(current); current = current.parentElement; }
  const pointElement = document.elementFromPoint(Math.max(0, innerWidth / 2), Math.max(0, innerHeight / 2));
  current = pointElement;
  while (current) { if (scrollable(current) && !ancestors.includes(current)) ancestors.push(current); current = current.parentElement; }
  const remembered = state.fullPageTarget;
  const target = remembered?.isConnected ? remembered : (ancestors[0] || root);
  state.fullPageTarget = target;
  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  if (requestedTop !== undefined) target.scrollTop = Math.min(maxTop, Math.max(0, requestedTop));
  return {
    top: Math.max(0, Number(target.scrollTop) || 0),
    maxTop,
    scrollHeight: Math.max(1, Number(target.scrollHeight) || 1),
    clientHeight: Math.max(1, Number(target.clientHeight) || 1),
    scrollWidth: Math.max(1, Number(target.scrollWidth) || 1),
    clientWidth: Math.max(1, Number(target.clientWidth) || 1)
  };
})()`
}

export function nativeTargetScript(input: {
  targetRef: string
  operation: 'click' | 'fill' | 'select' | 'press'
  value?: string
}): string {
  return `(() => {
    const input = ${JSON.stringify(input)};
    const element = globalThis.__sciforgePage?.targets.get(input.targetRef);
    if (!element?.isConnected) throw new Error('The target reference is stale. Observe the browser page again.');
    if (element.closest(${JSON.stringify(sensitiveSelector)})) {
      throw new Error('Sensitive fields require direct user input.');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    if (input.operation === 'fill') {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.select();
      else if (element.isContentEditable) {
        const range = document.createRange(); range.selectNodeContents(element);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      } else throw new Error('The target is not editable.');
    }
    if (input.operation === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('The target is not a select element.');
      if (![...element.options].some(option => option.value === input.value)) throw new Error('The option is unavailable.');
      element.value = input.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`
}
