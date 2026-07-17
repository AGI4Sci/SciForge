# Biology Room stress suite

This suite exercises the failure modes most likely to corrupt scientific state
or trigger excessive agent tool use. Source files are fixtures and must have the
same SHA-256 before and after every room-only operation.

## Automated gates

Run:

```bash
npx vitest run \
  src/shared/biology-room.test.ts \
  src/main/services/biology-room-service.test.ts \
  src/main/biology-room-mcp-tools.test.ts \
  src/main/workspace-preview-asset-protocol.test.ts \
  src/main/runtime/agent-runtime/host.test.ts \
  src/renderer/src/biology-room/biology-room.test.ts \
  src/renderer/src/biology-room/MolstarBiologyRoomAdapter.test.ts \
  src/renderer/src/workspace-preview/molecular-molstar.test.ts
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

### Circular GenBank plasmid

- Open a multi-feature `.gb`/`.gbk` file in Biology Room.
- Switch to circular view and drag a motif selection across the sequence origin.
- Add an annotation, add the selection to chat, close the room, and reopen it.
- Pass when the two internal half-open ranges are restored as one clockwise
  SeqViz selection, the exact JSON is present in chat, and the annotation anchor
  remains valid.

### Protein active site

- Open an mmCIF structure containing polymer, ligand, ion, and water components.
- Select a chain, a residue with an insertion code, and an atom; annotate the
  active site and ask the agent to color it.
- Change polymer representation to cartoon and capture a screenshot.
- Pass when stable author-space locators round-trip, ligand/water remain visible
  as ball-and-stick, camera orientation restores, and source SHA-256 is unchanged.

### FASTA + GFF3 + VCF tracks

- Open an indexed FASTA reference, then attach compatible GFF3 and VCF tracks.
- Pan/zoom repeatedly, hide/show a track, select a feature and a variant, and
  restart SciForge.
- Pass when JBrowse is not remounted after each persisted viewport update, the
  last room/location/visibility restore, and selected-feature details never
  disagree with the Room selection/highlight.
- Repeat with a partially matching track; pass when unmatched contigs are an
  amber bounded warning. Repeat with zero overlap; pass when linking/viewing is
  blocked.

### User/agent revision conflict

- Keep a Room open and have an agent add an annotation at revision N.
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

- With no Biology Room open, ask an unrelated coding/research question.
- Pass when Biology Room tools are absent from Kun direct/search discovery and
  Codex keeps them deferred.
- With an active Room, ask to annotate the current selection.
- Pass when the bounded active-room summary is injected directly, the model does
  does not rediscover the Room through a removed direct GUI path, and it uses at most one
  `biology_room_observe` before a requested `biology_room_apply`.

## Quality ledger

For each smoke run, record app commit, platform, fixture hashes, room/revision,
viewer, operation count, tool-call count, warnings, conflicts, reload behavior,
and screenshots. Treat source-hash changes, silent stale-revision overwrites,
remote JBrowse configuration/plugin loads, or executable biology formats as
release blockers.
