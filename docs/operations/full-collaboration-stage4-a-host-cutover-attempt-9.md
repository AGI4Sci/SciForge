# Stage 4 A-host cutover attempt 9 success receipt

This receipt records the successful ninth OpenSpec 7.4 public selection against
the exact personal-fork commit
`444722d3f37eb9044e48e437d629128a7b99f3c0`. The candidate remains selected on
public `cloud-test.sciforge.cn`; the previous stack and all rollback resources
remain retained.

## Candidate and migration gates

The first isolated bundle check caught that the package contained migration
`0015` but stale v14 bundled JavaScript. It was never selected publicly and did
not mutate the v14 candidate database. The exact source server was rebuilt,
repacked, its file dependency lockfile regenerated, and a distinct no-cache v2
image was retained rather than overwriting or deleting the failed evidence.

- v2 archive SHA-256:
  `c13425e05361e37060cff973426b985d724b7a8b4fbf56ba66ad6d026f195473`;
- v2 image ID:
  `sha256:25241ee1aef46e10e9147edee3c2afa95fec6ab714d6e8b0f015b97c77887ce0`;
- image revision label: exact `444722d3f37eb9044e48e437d629128a7b99f3c0`;
- database version: `15`;
- full public-lineage catalog fingerprint:
  `c73f6befaa308cf3c4d588a06fab0fe576e8271bb68103022ac5d2051c86189d`;
- catalog aggregates remained `49/636/494/124`, readiness was true, and all
  five retained safety invariants were zero;
- the retained inbox row was normalized in place to
  `collaboration.state.changed -> project.created`, preserving Project
  `prj_5594a84705a34532b0dd50c3d16911f9`.

The isolated application then passed `200/200/401`, strict unauthenticated
`authentication_required`, exact image revision, and `restart=no`. The new
Caddyfile differed from the prior candidate only by its unique upstream alias;
the compose override differed only by the immutable Caddyfile source. Caddy
validation, compose rendering, approval-marker ownership/mode, and the
Edge-internal application probe all passed before selection.

## Public and real source-app gates

After the controlled Edge recreation:

- public `/healthz`, `/readyz`, and unauthenticated `/v1/me` returned
  `200/200/401`;
- strict unauthenticated `worker.availability.list` returned HTTP 401 with
  `authentication_required`;
- `X-SciForge-Edge-Revision` was the exact candidate commit;
- the issuer remained exactly
  `https://login-test.sciforge.cn/realms/SciForge`;
- the exact-source U0 guard passed on branch
  `codex/full-collaboration-loop-recovery`, personal Fork origin, and Node
  `22.22.1`;
- the real Identity UI showed the existing OIDC User and Desktop connected;
- the real Collaboration UI showed `Cloud connection Connected`, inbox
  sequence `#1`, and `Stage4-U0` Online;
- the real Project coordination UI focused retained Project
  `Stage4 U0 Coordinator Count Acceptance` and showed `1 / 1 members online`
  plus `1 / 1 Agents online`;
- post-success Cloud evidence showed the same Agent active/online with a fresh
  heartbeat, Worker availability online/ready/current with zero active Tasks,
  and the same paused Project with its exact Owner and Coordinator.

Local screenshot evidence is retained outside the repository:

- `openspec-7.4-project-coordinator-444722d3.jpeg`, SHA-256
  `bfbd8b084a3c5a58d6ea18ff0b1fb5c2037f21742f2ca3b7bf895578c41ef4ed`;
- `openspec-7.4-collaboration-connected-444722d3.jpeg`, SHA-256
  `0f68a29e72361b7b4a88a9cc21b8d39d0ba50a364fcbb587b5f7d0e6ba65d629`.

Both are under
`/Users/ares/.codex/stage4-acceptance/sciforge-stage4-20260826T080435Z/evidence/`.
Remote migration, database, safety, identity, HTTP, Caddy, compose, and cutover
probes remain under the session-prefixed candidate directory on the A host.

## Final state and scope

The successful candidate application is running with `restart=unless-stopped`
on its isolated application/database networks and the public Edge network. The
Edge is healthy and mounts the immutable v2 candidate Caddyfile. U0 remains
running so current availability is visible. The old stack, old databases,
candidates, probes, approval markers, and rollback assets were not retired or
deleted. No upstream, release artifact, DMG, OpenContent Skill publication, or
private Skill runtime operation occurred.

This completes OpenSpec 7.4 only. Five-Human/multi-device acceptance and its
recovery/final-artifact checks remain separately tracked by 8.6-8.8; formal
installer validation remains deferred in 8.4.

Receipt generated on 2026-08-27 (Asia/Shanghai).
