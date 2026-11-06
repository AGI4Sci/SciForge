/** A public prose prefix must never expose a split secret or control envelope.
 * Potentially rewritable tails stay buffered for the canonical final sanitizer.
 * This is deliberately conservative for markup/JSON, which may encode tools.
 */
export function publicTextPrefixStream(
  emit: (text: string, phase?: string) => void,
  sensitiveValues: string[],
): (text: string, phase?: string) => void {
  let raw = '';
  let started = false;
  let deferred = false;
  const sensitive = sensitiveValues.map(value => value.trim()).filter(value => value.length >= 4);
  const keywords = ['Authorization', 'Bearer', 'sk-', 'api_key', 'api-key', 'apikey', 'token', 'secret', 'password', 'credential'];
  return (text, phase) => {
    if (deferred) return;
    raw += text;
    if (!started) {
      if (!raw.trim()) return;
      if (/^\s*[[{`<]/u.test(raw)) { deferred = true; raw = ''; return; }
      started = true;
    }
    let end = raw.length;
    // DSML and other markup may be normalized to a tool call only at completion.
    const marker = raw.indexOf('<');
    if (marker >= 0) { end = Math.min(end, marker); deferred = true; }
    const privateStart = /\b(?:Authorization\s*:|Bearer\s+|sk-|(?:api[_-]?key|token|secret|password|credential)\s*[:=])/iu.exec(raw);
    if (privateStart) { end = Math.min(end, privateStart.index); deferred = true; }
    for (const value of sensitive) {
      const index = raw.indexOf(value);
      if (index >= 0) { end = Math.min(end, index); deferred = true; }
    }
    for (const value of [...sensitive, ...keywords]) {
      for (let length = 1; length <= Math.min(value.length, raw.length); length++) {
        if (raw.slice(-length).toLowerCase() === value.slice(0, length).toLowerCase()) end = Math.min(end, raw.length - length);
      }
    }
    const pendingAssignment = /\b(?:Authorization|Bearer|api[_-]?key|token|secret|password|credential)\s*$/iu.exec(raw);
    if (pendingAssignment) end = Math.min(end, pendingAssignment.index);
    if (end > 0) emit(raw.slice(0, end), phase);
    // Only retain the ambiguous suffix; never rescan the entire generated answer.
    raw = deferred ? '' : raw.slice(end);
  };
}
