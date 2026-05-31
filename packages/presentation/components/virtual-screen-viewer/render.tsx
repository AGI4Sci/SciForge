import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE,
  VIRTUAL_SCREEN_VIEWER_COMPONENT_ID,
} from './manifest';

export interface VirtualScreenCursor {
  actorId?: string;
  cursorId?: string;
  label?: string;
  color?: string;
  x?: number;
  y?: number;
  state?: string;
}

export interface VirtualScreenEvent {
  label?: string;
  ref?: string;
  status?: string;
}

export interface VirtualScreenPayload {
  title?: string;
  status?: string;
  sessionRef?: string;
  displayGroupRef?: string;
  screenRef?: string;
  frameRef?: string;
  replayRef?: string;
  permissionRef?: string;
  stopRef?: string;
  cancelLeaseRef?: string;
  screen?: { width?: number; height?: number; label?: string };
  actorCursors?: VirtualScreenCursor[];
  isolation?: Record<string, unknown>;
  events?: VirtualScreenEvent[];
  onTerminalEquivalentText?: (event: { commandText: string; label: string; targetRef?: string }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function s(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function n(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function payloadFromProps(props: UIComponentRendererProps): VirtualScreenPayload {
  const artifactData = isRecord(props.artifact?.data) ? props.artifact.data : {};
  const slotProps = isRecord(props.slot.props) ? props.slot.props : {};
  return normalizePayload({ ...artifactData, ...slotProps });
}

function normalizePayload(value: Record<string, unknown>): VirtualScreenPayload {
  const screen = isRecord(value.screen) ? value.screen : {};
  const isolation = isRecord(value.isolation) ? {
    sharedSystemInputUsed: bool(value.isolation.sharedSystemInputUsed),
    systemPointerMoved: bool(value.isolation.systemPointerMoved),
    systemKeyboardEventsSent: bool(value.isolation.systemKeyboardEventsSent),
    inputExecuted: bool(value.isolation.inputExecuted),
    diagnosticOnly: bool(value.isolation.diagnosticOnly),
  } : undefined;
  return {
    title: s(value.title),
    status: s(value.status),
    sessionRef: s(value.sessionRef),
    displayGroupRef: s(value.displayGroupRef),
    screenRef: s(value.screenRef),
    frameRef: s(value.frameRef),
    replayRef: s(value.replayRef),
    permissionRef: s(value.permissionRef),
    stopRef: s(value.stopRef),
    cancelLeaseRef: s(value.cancelLeaseRef),
    screen: {
      width: n(screen.width),
      height: n(screen.height),
      label: s(screen.label),
    },
    actorCursors: Array.isArray(value.actorCursors) ? value.actorCursors.filter(isRecord).map((cursor) => ({
      actorId: s(cursor.actorId),
      cursorId: s(cursor.cursorId),
      label: s(cursor.label),
      color: s(cursor.color),
      x: n(cursor.x),
      y: n(cursor.y),
      state: s(cursor.state),
    })) : [],
    isolation,
    events: Array.isArray(value.events) ? value.events.filter(isRecord).map((event) => ({
      label: s(event.label),
      ref: s(event.ref),
      status: s(event.status),
    })) : [],
    onTerminalEquivalentText: typeof value.onTerminalEquivalentText === 'function'
      ? value.onTerminalEquivalentText as VirtualScreenPayload['onTerminalEquivalentText']
      : undefined,
  };
}

function command(label: string, commandText: string, targetRef: string | undefined, onTerminalEquivalentText: VirtualScreenPayload['onTerminalEquivalentText']) {
  return (
    <button
      type="button"
      data-event="virtual-screen-terminal-equivalent-text"
      data-command-text={commandText}
      disabled={!targetRef}
      onClick={() => targetRef ? onTerminalEquivalentText?.({ commandText, label, targetRef }) : undefined}
    >
      {label}
    </button>
  );
}

function refChip(label: string, ref: string | undefined) {
  if (!ref) return null;
  return (
    <span className="virtual-screen-ref-chip">
      <strong>{label}</strong>
      <code>{ref}</code>
    </span>
  );
}

function isolationRows(isolation: VirtualScreenPayload['isolation']) {
  const rows = [
    ['shared input', isolation?.sharedSystemInputUsed],
    ['system pointer', isolation?.systemPointerMoved],
    ['system keyboard', isolation?.systemKeyboardEventsSent],
    ['input executed', isolation?.inputExecuted],
    ['diagnostic only', isolation?.diagnosticOnly],
  ] as const;
  return rows.map(([label, value]) => (
    <span key={label} data-isolation-flag={label} data-isolation-value={String(value ?? 'unknown')}>
      {label}: <strong>{String(value ?? 'unknown')}</strong>
    </span>
  ));
}

function cursorStyle(cursor: VirtualScreenCursor, width: number, height: number): React.CSSProperties {
  const x = Math.max(0, Math.min(100, ((cursor.x ?? 0) / Math.max(1, width)) * 100));
  const y = Math.max(0, Math.min(100, ((cursor.y ?? 0) / Math.max(1, height)) * 100));
  return {
    left: `${x}%`,
    top: `${y}%`,
    '--cursor-color': cursor.color || '#00e5a0',
  } as React.CSSProperties;
}

export function renderVirtualScreenViewer(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const hasRefs = Boolean(payload.sessionRef || payload.screenRef || payload.frameRef || payload.replayRef);
  if (!hasRefs) {
    return (
      <div className="virtual-screen-viewer" data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} data-render-boundary="presentation-only" data-status="empty">
        {ComponentEmptyState ? (
          <ComponentEmptyState componentId={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} artifactType={props.artifact?.type ?? VIRTUAL_SCREEN_VIEWER_ARTIFACT_TYPE} detail="Virtual screen refs are not attached." />
        ) : (
          <p>Virtual screen refs are not attached.</p>
        )}
      </div>
    );
  }
  const width = payload.screen?.width ?? 1440;
  const height = payload.screen?.height ?? 900;
  const status = payload.status ?? 'waiting';
  return (
    <div className="virtual-screen-viewer" data-component-id={VIRTUAL_SCREEN_VIEWER_COMPONENT_ID} data-render-boundary="presentation-only" data-status={status}>
      <header className="virtual-screen-toolbar">
        <div>
          <strong>{payload.title ?? props.slot.title ?? 'Virtual Screen'}</strong>
          <span>{payload.screen?.label ?? payload.screenRef ?? 'screen'}</span>
        </div>
        <div className="virtual-screen-toolbar-actions">
          {command('Observe', `/computer-use observe --screen-ref ${JSON.stringify(payload.screenRef ?? payload.sessionRef ?? '')}`, payload.screenRef ?? payload.sessionRef, payload.onTerminalEquivalentText)}
          {command('Replay', `/computer-use replay --replay-ref ${JSON.stringify(payload.replayRef ?? '')}`, payload.replayRef, payload.onTerminalEquivalentText)}
          {command('Stop', `/computer-use stop --stop-ref ${JSON.stringify(payload.stopRef ?? '')}`, payload.stopRef, payload.onTerminalEquivalentText)}
          <span>{status}</span>
        </div>
      </header>
      <section className="virtual-screen-stage" aria-label="Computer Use virtual screen">
        <div className="virtual-screen-frame" style={{ aspectRatio: `${width} / ${height}` }}>
          {payload.frameRef ? (
            <div className="virtual-screen-frame-ref">
              <span>frame ref</span>
              <code>{payload.frameRef}</code>
            </div>
          ) : (
            <div className="virtual-screen-empty-frame">
              <strong>Waiting for virtual display frame</strong>
              <span>No raw screenshot is embedded in GUI state.</span>
            </div>
          )}
          {payload.actorCursors?.map((cursor, index) => (
            <span
              key={`${cursor.actorId ?? 'actor'}:${cursor.cursorId ?? index}`}
              className="virtual-screen-cursor"
              style={cursorStyle(cursor, width, height)}
              title={`${cursor.label ?? cursor.actorId ?? 'actor'} ${cursor.state ?? ''}`.trim()}
            >
              <i />
              <b>{cursor.label ?? cursor.actorId ?? `actor-${index + 1}`}</b>
            </span>
          ))}
        </div>
      </section>
      <footer className="virtual-screen-footer">
        <div className="virtual-screen-refs">
          {refChip('session', payload.sessionRef)}
          {refChip('display', payload.displayGroupRef)}
          {refChip('screen', payload.screenRef)}
          {refChip('replay', payload.replayRef)}
          {refChip('permission', payload.permissionRef)}
          {refChip('cancel', payload.cancelLeaseRef)}
        </div>
        <div className="virtual-screen-isolation" aria-label="Computer Use isolation flags">
          {isolationRows(payload.isolation)}
        </div>
        {payload.events?.length ? (
          <ol className="virtual-screen-events">
            {payload.events.map((event, index) => (
              <li key={`${event.ref ?? event.label ?? 'event'}:${index}`}>
                <span>{event.label ?? event.status ?? 'event'}</span>
                {event.ref ? <code>{event.ref}</code> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </footer>
    </div>
  );
}
