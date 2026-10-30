# `@sciforge/workspace-host`

Headless, Electron-free server for a SciForge remote workspace. The desktop
keeps the renderer, credentials, VPN, SSH policy, and network bridges locally;
this package runs workspace-scoped file, search, Git, controlled-process,
Codex, and scientific-preview operations beside the authoritative files.

## Connection and lifecycle

The public wire contract comes exclusively from
`@sciforge/domain-sdk/workspace-host`. The authenticated SSH command carries a
bounded UTF-8 JSONL stream:

1. the client sends one `WorkspaceHostHandshakeRequest`;
2. the server returns one `WorkspaceHostHandshakeResponse`;
3. requests, acknowledgements, lease controls, responses, and sequenced events
   share the established stream.

Events enter a bounded journal before publication. Reattach supplies the
previous session and last acknowledged sequence; the daemon replays later
events or returns the typed `replay-gap` failure.

The preferred Linux x64 lifecycle is `persistent-daemon`. A non-root user
daemon owns one canonical workspace/server/domain-cohort session behind a
private Unix socket. The runtime directory is `0700`; socket and metadata are
`0600`. SSH is only a byte relay, so disconnecting SSH does not discard the
service, journal, preview sessions, file watchers, or managed Codex runtime.
Only one relay attaches at a time; a newer authenticated attach supersedes a
stale relay.

`probe-daemon` truthfully checks Linux x64, non-root POSIX identity, runtime
directory ownership/mode, and Unix-socket path limits. When it reports
unsupported, Remote SSH may use the explicitly degraded `connection-session`
lifecycle, where transport close disposes the service and its processes.

## Workspace operations

All operation paths are workspace-relative POSIX paths. Absolute paths, `..`,
backslashes, NULs, and symlink escapes are rejected.

- directory listing is sorted, cursor-paged, and bounded;
- stat/read/range use canonical SDK results and content revisions;
- writes require optimistic revision agreement for existing files and commit
  through same-directory temporary-file, fsync, revision recheck, and rename;
- text search invokes remote `rg` with argv and bounded output;
- Git status/diff invoke remote Git with argv and bounded output;
- controlled processes expose only `profile: "system-shell"`; the server
  chooses the executable and always spawns an argv array with `shell: false`;
- output uses bounded cursors and long-poll reads and survives relay reconnects
  while the daemon remains alive.

The controlled-process contract is not a full PTY. Interactive shell stdin and
stdout work through pipes; resize sends a best-effort `SIGWINCH` notification
and must be treated as degraded rather than VS Code terminal parity. Trusted
server runtimes have a separate internal argv-only process API.

## Scoped network and model access

`egressMode: "none"` disables network-dependent capabilities. For `local` or
`remote-target`, sensitive proxy access may appear only in the authenticated
handshake. The server derives standard proxy variables for managed child
processes; the bearer token never appears in argv, session state, responses,
events, logs, or the journal.

Scoped Model Router access is independent of general CONNECT proxy data but is
authorized only for a network-enabled workspace route:

```text
modelAccess = {
  baseUrl: "http://127.0.0.1:<forwarded-port>/v1",
  authorization: { scheme: "bearer", token: "<scoped-token>" },
  expiresAt: "<RFC3339>"
}
```

The server accepts only an explicit loopback port and `/v1` path. It exposes
this material solely through the trusted operation context used by the managed
runtime. It never accepts a desktop static key or an upstream provider key.

Long-lived attachments renew existing leases without retransmitting tokens:

```text
{ protocolVersion: 1, sessionId, control: "egress-renew", expiresAt }
{ protocolVersion: 1, sessionId, control: "egress-revoke" }
{ protocolVersion: 1, sessionId, control: "model-access-renew", expiresAt }
{ protocolVersion: 1, sessionId, control: "model-access-revoke" }
```

These strict control frames are session-bound, produce no journal/log/response
record, and fail closed. Expiry immediately removes access from trusted runtime
views; revoke or disconnect also erases retained credential material.
Package-owned handlers report canonical failures with the public
`WorkspaceHostOperationError`, including `model-access-unavailable`, without
importing host-private code.

## Scientific preview and domain backend

Generated workspace-server composition loads the exact package/version-matched
Life Science Preview provider cohort. Its domain backend is useful because
large or private scientific files stay on the cluster: format detection,
bounded range reads, observations, artifact preparation, edits, and exports run
next to the data, while the local renderer receives only canonical bounded
results. Adding another domain backend is a package composition change, not a
host feature-map edit.

The single canonical `workspace.preview.invoke` operation supports:

| Method | Input |
| --- | --- |
| `open` | `{relativePath, mimeType?, mode?, selection?, integrity?}` |
| `observe`, `describeAsset`, `release` | `{sessionId}` |
| `readRange` | `{sessionId, range}` |
| `prepareArtifact`, `readArtifactRange` | `{sessionId, request}` |
| `applyEdit` | `{sessionId, expectedRevision, operation}` |
| `exportPreview` | `{sessionId, expectedRevision, target}` |
| `invokeAction` | `{sessionId, action}` |

The server replaces client file metadata with the authorized canonical root,
retains bounded artifacts inside the session, returns bytes as base64 ranges,
and uses source revisions for optimistic mutation. There is no local-provider
fallback for remote data.

## CLI and self-contained artifact

Remote SSH invokes the manifest entrypoint, not `node`:

```text
workspace-host attach \
  --workspace-root-base64 <unpadded-base64url-absolute-root> \
  --lifecycle-mode persistent-daemon \
  --runtime-dir-base64 <unpadded-base64url-runtime-dir>
```

Session IDs, cursors, scoped credentials, and tokens never appear in argv.
`probe-daemon`, `start-daemon`, and the internal `daemon` command support the
persistent lifecycle; Remote SSH owns the fallback decision.

Build with:

```text
npm --workspace @sciforge/workspace-host run build:artifact
```

The deterministic Linux x64 artifact contains:

- a POSIX `workspace-host` wrapper;
- bundled Node `22.18.0` at `runtime/node`, so the cluster needs no Node/PATH;
- the bundled `server.mjs`;
- the complete fixed official Codex Linux x64 cohort;
- license files and a canonical manifest with SHA-256, size, executable mode,
  readiness probes, and generated domain contribution cohorts.

Fixed package tarballs are downloaded only on the desktop build machine,
verified against pinned SHA-512 integrity, and cached under ignored `.cache/`;
the remote cluster never downloads runtime components. Deployment restores
`0700` for every declared executable and `0600` for ordinary files, verifies
all digests, then runs readiness probes. The bundled Node is a glibc Linux x64
ELF; musl-only or non-x64 targets must fail platform/readiness checks rather
than falling back to a system runtime.

Set `SCIFORGE_WORKSPACE_HOST_ARTIFACT_OFFLINE=1` to require a complete,
integrity-valid local build cache and fail instead of downloading a missing
build asset.
