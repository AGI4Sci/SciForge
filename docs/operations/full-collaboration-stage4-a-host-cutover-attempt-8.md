# Stage 4 A-host cutover attempt 8 and exact rollback

This receipt records the eighth explicitly authorized OpenSpec 7.4 public
selection against personal-fork commit
`fbe50fc6383cb6692c1c52b0023984b6890166f7`. The public candidate, exact-source
U0 Identity, local Runtime, Agent heartbeat, and Worker availability path all
passed. The real U0 UI then rejected its retained first inbox message, so U0
was stopped before the exact old Edge rollback. OpenSpec 7.4 remained
incomplete at the end of this attempt.

## Gates that passed

- the refreshed image label and public Edge revision were the exact authorized
  commit;
- public `/healthz`, `/readyz`, and unauthenticated `/v1/me` returned
  `200/200/401`, while the strict unauthenticated
  `worker.availability.list` request returned `authentication_required`;
- the issuer remained exactly
  `https://login-test.sciforge.cn/realms/SciForge`;
- the exact-source guard passed with native arm64 Node `22.22.1` and the
  personal Fork origin;
- the retained U0 OIDC User and Desktop were connected, Model access showed
  `Running`, official sign-in confirmed, OpenAI Responses selected, and trace
  capture ready;
- U0 Agent `agt_df0f54bb1fd344019d44cadba8ad5c12` became online and Cloud committed
  its current, Runtime-ready Worker availability.

## Decisive failure and correction

The first retained inbox row for Project
`prj_5594a84705a34532b0dd50c3d16911f9` had been written as a raw
`project.created` payload. The shared client contract only admits a strict
`collaboration.state.changed` envelope containing the `project.created` event,
so the real UI failed with `The strict collaboration schema rejected this
request or response.` This was a server write-shape defect, not an OIDC,
Aliyun, Caddy, Agent Runtime, or OpenContent failure.

Personal-fork commit `444722d3f37eb9044e48e437d629128a7b99f3c0`
made new Project creation use the canonical envelope and added migration 15 to
atomically normalize retained raw rows in place. The focused server suite
passed `149` tests with `8` intentional skips; server typecheck, changed-file
lint, production build, and the real PostgreSQL 17 integration suite (`7/7`)
also passed.

## Mandatory rollback

U0 was stopped and proved absent before the exact old Edge was recreated. The
old revision, immutable Caddy mount and SHA-256, public `200/200/401`, and
issuer were reverified before the candidate was detached from the Edge network
and restored to `restart=no`. No stack, database, candidate, probe, or evidence
was deleted, and no upstream operation occurred.

Receipt generated on 2026-08-27 (Asia/Shanghai).
