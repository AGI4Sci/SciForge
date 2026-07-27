# Biology Room stress suite

This suite exercises the failure modes most likely to corrupt scientific state
or trigger excessive agent tool use. Source files are fixtures and must have the
same SHA-256 before and after every room-only operation.

## Automated gates

Run:

```bash
npm --prefix packages/domains/biology-room test
npx vitest run \
  src/main/capabilities/app-registry.test.ts \
  src/main/workspace-preview-asset-protocol.test.ts \
  src/main/runtime/agent-runtime/host.test.ts \
  src/renderer/src/workspace-preview/registry.test.ts \
  src/renderer/src/workspace-preview/plugin-outlet.test.tsx
```

The service suite includes a multi-turn user/agent trajectory:

1. A user selects a GFF3 feature.
2. A second service instance observes that exact revision and adds an agent
   annotation with task/turn provenance.
3. A stale user operation is rejected rather than overwriting the agent change.
4. The GFF3 source changes outside SciForge.
5. Refresh clears the identity-based selection, orphans its annotation, and
   preserves the audit history.

It also covers transaction recovery, concurrent writers, restore against
changed sources, missing sources/indexes, index-only changes, contig mismatch,
path/symlink escapes, manifest limits, and source immutability.

## Interactive release smoke cases

### Canonical preview routing

- Open representative sequence, structure, genome-feature, and variant files.
- Pass when each file resolves through one Workspace Preview manifest and its
  matching provider/renderer contribution, with no Biology-specific IPC call or
  pre-registry route.
- Exercise selection and viewport state where supported; pass when source bytes
  and SHA-256 remain unchanged.

### User/agent revision conflict

- Create or load room state through generic Broker capabilities and have an agent
  add an annotation at revision N.
- At the same time, attempt a user mutation based on revision N.
- Pass when exactly one commit wins, the open UI live-loads the winning
  revision, stale controls are gated until reload, and no source bytes change.

### External deletion and recovery

- Delete an open source or required index outside SciForge.
- Pass when the viewer stops reading it, displays the persisted readiness error,
  and marks invalid anchors orphaned.
- Recreate the file at the same path without closing the Room.
- Pass when the retry watcher detects it, refreshes fingerprints/compatibility,
  and re-enables the viewer without rewriting the source.

### Tool-use budget

- Ask an unrelated coding/research question. Pass when no Biology-specific MCP
  tool or direct GUI transport appears.
- Ask an agent to inspect and mutate known room state. Pass when it uses generic
  capability discovery plus invocation, with no removed direct GUI path.

## Quality ledger

For each smoke run, record app commit, platform, fixture hashes, room/revision,
preview contribution, operation count, tool-call count, warnings, conflicts,
reload behavior, and screenshots. Treat source-hash changes, silent
stale-revision overwrites, remote viewer configuration/plugin loads, or executable biology formats as
release blockers.
