# Source Release Boundary

Last updated: 2026-06-27

This note was created during commercial-use cleanup work. SciForge is
distributed under the Apache License 2.0 in `LICENSE`. This document defines the
source boundary for releases and preserves the historical cleanup evidence. It
is an engineering release note, not legal advice.

## Release Scope

The source package is produced from the cleaned working tree used for release.
It must not include `.git`, local refs, historical branches, build output,
dependency directories, local secrets, or Codex runtime state.

The project intentionally does not rewrite all historical Git refs in this
cleanup phase. Historical refs may still contain exact Git blobs that match
historical reference content introduced after the reference changed away from MIT. Those historical refs are
outside the source package boundary and must not be included in a release
archive.

## Required Evidence

Before publishing a source package:

1. Run the reference exact-hit scan on the release working tree:

   ```sh
   REFERENCE_REPO=/path/to/reference node scripts/license-risk-scan.mjs --max-details 20
   ```

2. Export the actual source package from the cleaned working tree, excluding at
   least:

   ```text
   .git/
   .codex-runtime/
   node_modules/
   dist/
   out/
   release/
   ```

3. Re-scan the exported package as an isolated Git repository so local refs
   cannot affect the result:

   ```sh
   tmp_repo="$(mktemp -d)"
   rsync -a --delete \
     --exclude .git \
     --exclude .codex-runtime \
     --exclude node_modules \
     --exclude dist \
     --exclude out \
     --exclude release \
     ./ "$tmp_repo"/
   git -C "$tmp_repo" init
   git -C "$tmp_repo" add -A
   git -C "$tmp_repo" -c user.name=SciForge -c user.email=sciforge@example.invalid commit -m source-package-scan
   node scripts/license-risk-scan.mjs --repo "$tmp_repo" --reference-repo /path/to/reference --max-details 20
   ```

4. Archive the scan output with the release evidence. The expected publish gate
   is:

   ```text
   current HEAD exact hits: 0
   worktree exact hits: 0
   ```

`all refs exact hits` can be nonzero in the development repository until a
separate history rewrite is explicitly scheduled. It must be zero or irrelevant
in the isolated exported package, because the package contains only one clean
release commit and no historical refs.

## Distribution Rules

- Model and LLM capabilities must go through Model Router. Users configure their
  own providers or remote services.
- Do not bundle model weights, default model endpoints, or provider credentials
  unless their license and target-use terms are explicitly cleared.
- Do not bundle media, logos, screenshots, or videos unless their provenance and
  release rights are clear.
- Preserve `THIRD_PARTY_NOTICES.md`, dependency lockfiles, and any package-local
  license files that are part of the release evidence.
