const { contextBridge, ipcRenderer } = require('electron');

const INTERNAL_EVENT_SCHEMA = 'sciforge.desktop.annotation-overlay.internal-event.v1';
const DEFAULT_COMMENT = 'Desktop screen annotation';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function bounds(value) {
  const input = record(value);
  const x = finiteNumber(input.x);
  const y = finiteNumber(input.y);
  const width = finiteNumber(input.width);
  const height = finiteNumber(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function text(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return fallback;
  return trimmed.slice(0, 1000);
}

function optionalText(value) {
  return text(value, undefined);
}

const api = {
  submitSelection(input) {
    const payload = record(input);
    const safeBounds = bounds(payload.bounds);
    if (!safeBounds) {
      return Promise.reject(new Error('Screen-region annotation requires valid bounds.'));
    }
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-selection-submitted',
      bounds: safeBounds,
      comment: text(payload.comment, DEFAULT_COMMENT),
      threadId: optionalText(payload.threadId),
      messageDraftId: optionalText(payload.messageDraftId),
    });
  },
  cancelSelection() {
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-selection-cancelled',
    });
  },
};

contextBridge.exposeInMainWorld('sciforgeAnnotationOverlay', api);
