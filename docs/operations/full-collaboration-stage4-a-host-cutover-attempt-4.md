# Stage 4 A-host cutover attempt 4 and verified rollback

This receipt records the fourth explicitly approved OpenSpec 7.4 attempt. The
approval named personal-fork origin commit
`d59c6537e4c2b944177d1d7412d2db75d7b757f3`, authorized selecting only the
retained candidate through the existing public Edge, required the same U0
profile and exact source commit, and required the frozen rollback after any
failed gate. Public Identity, the existing Device and sole U0 Agent,
Collaboration, and the real Cloud Project create all ran through the candidate.
The Desktop capability broker then rejected the successful Cloud result because
the handler reported a changed resource without a resource handle. The new
Project was not focused and the Coordinator online User/Agent counts were not
shown. U0 was stopped and the exact old public Edge was restored. OpenSpec 7.4
therefore remains incomplete.

No credential, Token, private Provider origin, external account value,
unredacted Human identity or replayable authorization appears here.

## Exact source and preflight

Immediately before mutation:

- branch `codex/full-collaboration-loop-recovery`, local HEAD and the matching
  personal-fork branch all resolved to
  `d59c6537e4c2b944177d1d7412d2db75d7b757f3`; `origin` was the personal fork
  and `upstream` was not contacted or changed;
- a fresh clean clone of that exact commit completed `npm ci` and the production
  source build under Node `22.22.1`;
- the retained old Edge revision, immutable Caddyfile mount and SHA-256 matched
  the frozen rollback packet;
- the candidate image revision remained
  `763cc5a5619cc11cc491e75edb5f04dfb2e4deac`;
- the candidate remained at schema v14 with the admitted catalog fingerprint;
  all five safety counters were zero;
- before this attempt the candidate aggregate was 7 User principals, 7 OIDC
  identities, 24 Devices, 16 Agents and 13 Projects, with zero Projects owned
  by U0; and
- public old-stack health/readiness, unauthenticated `/v1/me` and the exact
  frozen issuer passed.

The candidate received only its retained unique Edge alias and approved restart
policy. Only the Edge service was recreated from the immutable base compose plus
the frozen one-line override. Public `/healthz`, `/readyz`, unauthenticated
`/v1/me`, the candidate revision header, exact Caddyfile mount and digest, and
OIDC discovery passed. The old app and database remained running and untouched.

## Real U0 source-app result

The exact source application was launched with the retained U0 profile,
`https://cloud-test.sciforge.cn` for public Identity and Collaboration, and the
unchanged `https://login-test.sciforge.cn/realms/SciForge` issuer. The real UI
proved:

- the same OIDC User and Desktop Device were connected without creating a
  duplicate Device;
- the existing `Stage4-U0` Agent
  `agt_df0f54bb1fd344019d44cadba8ad5c12` was active and online without creating
  a duplicate Agent;
- Collaboration reported `Connected`; and
- the public OpenContent Provider remained reachable without the optional
  private Agent Skill ZIP.

The Project form requested an exact Coordinator Agent revision. The first
attempt used the availability projection revision rather than the Agent-node
revision, and a later attempt raced the normal 15-second Agent heartbeat. Both
were rejected by Cloud as stale CAS inputs and read-only checks proved the
Project total remained 13. To obtain one stable observed revision without
altering server data directly, Collaboration was disconnected through its real
UI and the stabilized Agent-node revision `45` was submitted once. No direct
Cloud API, SQL write, fixture bypass or test-only production path was used.

Cloud then durably created:

| Field | Observed value |
| --- | --- |
| Project | `prj_5594a84705a34532b0dd50c3d16911f9` |
| Status | `paused` |
| Content mode | `none` |
| Coordinator Agent | `agt_df0f54bb1fd344019d44cadba8ad5c12` |
| Project revision | `1` |
| Candidate Project aggregate | `13 -> 14` |

The Project is retained as immutable acceptance evidence. It was not deleted,
rewritten or hidden during rollback.

## Failed Desktop receipt gate

After the successful Cloud mutation, the same application displayed:

`A changed result requires a resource handle.`

The HCI did not auto-focus the new Project and therefore never rendered the
Project-scoped Coordinator online User/Agent projection. Refresh did not recover
the newly created Project in the bounded observation window. This is not a
successful application-level create: a Human sees a failure after a durable
write and could accidentally retry. Consequently no Coordinator count is
claimed, and the fourth attempt triggered mandatory rollback.

The failure is source-side capability-envelope drift, not a Cloud, OIDC,
Alibaba Cloud, Agent transport, profile, Content Space or OpenContent Skill
failure:

- `project-coordinator.project.create` is a global `external-write` capability;
- its handler performs the Cloud create and then returns `changed: true`;
- no broker-owned resource handle is supplied for that global invocation; and
- the Host broker intentionally rejects every `changed` result without a
  resource handle after validating the handler output.

The package test calls the handler directly and asserts the same
`{ output, changed: true }` envelope, so it cannot detect this Host-broker
integration failure. Before a fifth attempt, the canonical Coordinator mutation
contract needs a general correction and a real broker-path regression test. The
repair must distinguish side-effect-only Cloud writes from actual broker-owned
resource revisions; it must not add a bypass, fake resource, compatibility
branch, Project-specific Host rule or acceptance-only fallback. The manual
revision field should also be replaced by a fresh authoritative Agent revision
selection so a Human does not race the normal heartbeat.

## Verified automatic rollback

The failed Project receipt/focus gate triggered the approved sequence:

1. The public U0 source process was stopped first; its profile and all local
   evidence were retained.
2. Only the Edge service was recreated from the immutable old base compose and
   exact old revision.
3. The restored Edge became healthy with revision
   `eaf9925092db2d488fa3dc61ae35ec054c80539a`, exact old Caddyfile mount and
   SHA-256
   `4079cc5e551cef1ba388d701591e8b09b1496d90ff8967db5e3200710f81d3c0`.
4. Public `/healthz`, `/readyz` and unauthenticated `/v1/me` returned
   `200/200/401`, the public revision header named the old revision, and issuer
   discovery remained exactly
   `https://login-test.sciforge.cn/realms/SciForge`.
5. Only after those checks passed was the candidate app detached from
   `sciforge-collaboration-private_private-edge` and restored to `restart=no`.
6. Read-only post-rollback inspection proved the old app/database and candidate
   app/database remained running, candidate app networking was again limited to
   its two isolated networks, and the new Project plus total 14 remained in the
   candidate database.

No database was down-migrated. No old stack, candidate, Project, cutover asset,
approval marker, validation container or evidence artifact was removed.

## Next approval boundary

The current authorization ended at mandatory rollback and does not authorize a
fifth public selection. A later attempt requires a clean, pushed personal-fork
source correction, fresh exact-source build and broker-path tests, the unchanged
server preflight, and a new explicit Human cutover approval. It must reuse the
retained U0 identity/profile, preserve the Project above as evidence, avoid a
blind duplicate create, and still prove all of the following in one real
application path: Project focus, Collaboration connected, Coordinator-visible
online User count and online Agent count.

No upstream operation, old-stack retirement, evidence cleanup, formal release
artifact, or five-Human completion was performed.

Receipt generated at `2026-08-27T01:21:30+08:00`.
