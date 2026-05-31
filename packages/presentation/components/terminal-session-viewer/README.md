# Terminal session viewer

`terminal-session-viewer` is a pure SciForge presentation component for an already-existing interactive terminal session. It renders host-provided terminal state and exposes host-owned interaction intent.

## Agent quick contract

- componentId: `terminal-session-viewer`
- accepts: `terminal-session`, `terminal-buffer`, `runtime-terminal-session`
- requires: `TerminalSessionAdapter`/`HostOwnedTerminalSession` identity plus either a host-owned live mount or a transcript buffer
- outputs: `terminal-session`
- events: `data-input`, `paste-input`, `resize`, `copy-request`, `download-request`, `stop-request`, `focus-change`
- fallback: `generic-artifact-inspector`
- safety: presentation only; does not execute code, open sockets, select providers, start commands, or write workspace files
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`

## Inputs

The renderer merges `artifact.data` and `slot.props`; `slot.props` wins when both provide the same field.

- `mode`: `live` or `transcript`
- `adapter`: `TerminalSessionAdapter`
- `hostSession` or `session`: `HostOwnedTerminalSession`
- `sessionRef`
- `sessionId`
- `terminalSessionRef`
- `terminalSessionId`
- `cwd`
- `status`: `running`, `completed`, `stopped`, or `error`
- `rows`
- `cols`
- `exitCode`
- `startedAt`
- `completedAt`
- `transcriptRef`
- `ptyTranscriptRef`
- `buffer`
- `transcript`
- `title`
- `capabilities`
- `theme`
- `liveSurfaceRef`
- `liveSurfaceLabel`

`TerminalSessionAdapter` is the host-owned session contract. It carries `kind: "host-owned-terminal-session"`, `mode`, `session`, optional `buffer`/`transcript`, optional `liveSurfaceRef`, and optional `liveSurfaceLabel`. `HostOwnedTerminalSession` carries `sessionId`, optional `sessionRef`, `cwd`, `rows`, `cols`, `status`, `exitCode`, `startedAt`, `completedAt`, `transcriptRef`, and `ptyTranscriptRef`.

`buffer` may be a string or an array of strings/objects with `text`. ANSI control sequences are stripped for a safe static preview.
When `mode` is `live` and `liveSurfaceRef` is provided, the component renders a host-owned live PTY mount point instead of a static buffer. If a live surface is requested without a ref, it falls back to `mode="transcript"`. The host remains responsible for xterm, WebSocket attachment, stdin, resize, and stop behavior.

The visible session surface is intentionally narrow: mode, session ref/id, cwd, status, rows/cols, exit code, started time, completed time, and terminal-equivalent intents. It does not render agent trace, activity, step summary, environment dump, agent answer summary, arbitrary metadata objects, or raw JSON callback payloads.

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

`completed`, `stopped`, and `error` sessions disable input and paste so the UI cannot keep sending data to a closed terminal.

Publish with `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`, and `render.test.tsx`, then run the package renderer test with `node --import tsx --test packages/presentation/components/terminal-session-viewer/render.test.tsx`.
