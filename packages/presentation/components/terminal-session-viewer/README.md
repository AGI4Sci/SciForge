# Terminal session viewer

`terminal-session-viewer` is a pure SciForge presentation component for an already-existing interactive terminal session. It renders host-provided terminal state and exposes host-owned interaction intent.

## Agent quick contract

- componentId: `terminal-session-viewer`
- accepts: `terminal-session`, `terminal-buffer`, `runtime-terminal-session`
- requires: `sessionRef`, `status`, `buffer`
- outputs: `terminal-session`
- events: `data-input`, `paste-input`, `resize`, `copy-request`, `download-request`, `stop-request`, `focus-change`
- fallback: `generic-artifact-inspector`
- safety: presentation only; does not execute code, open sockets, select providers, start commands, or write workspace files
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`

## Inputs

The renderer reads the same payload shape from `slot.props` first and `artifact.data` second:

- `sessionRef`
- `status`
- `buffer`
- `title`
- `capabilities`
- `theme`
- `metadata`
- `liveSurfaceRef`
- `liveSurfaceLabel`

`buffer` may be a string or an array of strings/objects with `text`. ANSI control sequences are stripped for a safe static preview.
When `liveSurfaceRef` is provided, the component renders a host-owned live PTY mount point instead of a static buffer. The host remains responsible for xterm, WebSocket attachment, stdin, resize, and stop behavior.

## Events

The component never performs side effects itself. Hosts may bind declared callback props or listen to DOM buttons and inputs carrying `data-event` and `data-terminal-event`:

- `data-input`, callback `onDataInput`
- `paste-input`, callback `onPasteInput`
- `resize`, callback `onResize`
- `copy-request`, callback `onCopyRequest`
- `download-request`, callback `onDownloadRequest`
- `stop-request`, callback `onStopRequest`
- `focus-change`, callback `onFocusChange`

## Boundary

This renderer does not start a process, open sockets, choose a provider, execute a command, write files, or decide completion. PTY lifecycle, stdin, paste, resize, copy/download materialization, stop handling, focus handling, and persistence belong to the host.

Publish with `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`, and `render.test.tsx`, then run the package renderer test with `node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx`.
