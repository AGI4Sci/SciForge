# Stage 4 A-host cutover attempt 7, exact rollback, and U0 Runtime correction

This receipt records the seventh explicitly authorized OpenSpec 7.4 operation
against personal-fork commit
`94f6d89b321b40651ad2febc5bce6524e5765bf8` and the frozen packet
[`full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md`](./full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md).
It used two bounded public-selection windows under the same authorization. The
refreshed Cloud candidate passed its public and authenticated data-path gates,
but the real U0 source application did not reach Collaboration `connected`,
retained Project focus, or Coordinator online User/Agent counts. U0 was stopped
before each exact rollback. OpenSpec 7.4 therefore remains incomplete.

## Preflight and retained evidence

Before either window, the operator proved the exact personal-fork branch and
source commit, absence of U0, exact old Edge revision/mount/Caddy digest,
public `200/200/401`, frozen issuer, refreshed image/revision, candidate-only
loopback port, two isolated networks, and `restart=no`. The prepared Caddy and
compose assets matched their frozen hashes and rendered successfully.

Fresh read-only candidate checks were retained rather than deleted:

- the corrected database preflight exited zero with schema v14, fingerprint
  `7413f6ac9d926784b10a84a83cbb80cfbff25be6e7f04ae1efdda2bf6763cf0d`,
  `49/636/494/124` migration aggregates, and readiness true;
- the corrected safety audit exited zero with all five safety counters at zero
  and `2 cancelled / 8 completed / 4 paused` retained Projects;
- the corrected identity audit exited zero with `7/7/24/16` aggregate counts;
- an initial database preflight container started without the required Node
  entrypoint, was stopped without being treated as evidence, and remains
  retained alongside the corrected checks.

The explicit approval marker for `94f6d89b...` was installed with the frozen
content, ownership, group, and mode. It remains retained as evidence and does
not authorize a later public selection by itself.

## First controlled window

The refreshed candidate was attached under its unique Edge alias, passed
Edge-internal health/readiness, and became the sole selected Cloud upstream.
The exact candidate revision/mount/Caddy digest, public `200/200/401`, strict
unauthenticated `authentication_required`, and frozen issuer all passed.

The exact-source guard then failed before U0 launch because the interactive
shell supplied Node `23.11.0`; the repository accepts supported Node 22 or Node
24 and later, not Node 23. No U0 process or live-profile write occurred. The
operator proved U0 absent, recreated the exact old Edge, rechecked its public
and immutable gates, and only then detached the refreshed candidate and
restored `restart=no`.

## Second controlled window

Native arm64 Node `22.22.1` was selected and the full old-public, candidate,
source, approval-marker, Caddy, compose, schema, safety, and identity preflight
was repeated. After the same bounded Edge selection, every candidate public
gate passed again. The exact-source guard then passed, including the frozen
branch/commit/origin, source build outputs, Cloud/OIDC contract, public
OpenContent Provider discovery, Provider origin reachability, and
`privateSkillRequired: false`.

The real U0 source application recovered the retained OIDC User and Device and
showed the Desktop connected to Identity. Its existing Agent remained unique.
When the Human selected Collaboration Connect, the UI returned a connection
handler failure instead of reaching `connected`; the retained Project was not
focused and Coordinator online User/Agent counts were not rendered.

A post-failure read-only candidate database transaction proved that the new
Cloud path itself had succeeded before the local handler returned:

- the existing U0 Agent was active and online at revision 48 with a fresh
  heartbeat from the same Device;
- the canonical Worker availability projection was current and online,
  runtime readiness was `ready`, new offers were accepted, active task count
  was zero, and availability revision 46 was committed with matching fresh
  observation/heartbeat timing;
- retained Project `prj_5594a84705a34532b0dd50c3d16911f9` remained paused and
  owned by the same U0 Coordinator Agent.

This closes the prior HTTP response-schema defect: refreshed commit
`94f6d89b...` accepts the real heartbeat-to-availability path. It does not,
however, substitute database evidence for the missing real UI gates.

## Local Runtime root cause and correction

The real UI exposed the decisive local error before and during Connect. The U0
profile stored the generic command `codex`, whose automatic resolution selected
`/opt/homebrew/bin/codex`. That global npm installation referenced a missing
platform vendor executable and failed with `ENOENT` while spawning
`app-server --listen stdio://`. Collaboration Connect checks the canonical
Agent Runtime readiness, so this local failure blocked the connection handler
and the downstream Coordinator UI. The earlier assumption that this Runtime
failure could not block online-count acceptance was incorrect.

The working installation is `/usr/local/bin/codex` (`codex-cli 0.146.1`). After
rollback, a bounded standalone `app-server` probe using the same U0
`CODEX_HOME` stayed running. The U0 setting was then changed through the real
SciForge Settings UI to the absolute executable path. A separate offline real
Electron launch showed the local service running, official sign-in confirmed,
OpenAI Responses selected, trace capture ready, and an enabled Agent surface.
The diagnostic process was stopped and U0 absence was re-proved. No production
source, Cloud image, OpenContent Provider, optional Skill ZIP, OIDC realm, or
server configuration was changed for this correction.

## Mandatory rollback and final state

Immediately after the real Connect gate failed, U0 was stopped and proved
absent. Only then was the exact old Edge recreated. Its old application
revision, immutable mount, Caddy SHA-256, health, public `200/200/401`, revision
header, and issuer all matched the frozen rollback contract. After those gates
passed, the refreshed candidate was detached from the Edge network and restored
to `restart=no`.

The final state is:

- the public Edge selects the exact old stable Cloud application;
- the refreshed `94f6d89b...` application is running only on its two isolated
  candidate networks and loopback port, with `restart=no`;
- U0 is stopped and its Codex executable setting now names the verified
  absolute local path;
- the old stack, both candidates, databases, approval marker, validation
  containers, probes, Project, and all evidence remain retained;
- no upstream operation, resource deletion, down-migration, release packaging,
  or OpenContent Skill publication occurred.

## Next approval boundary

A later public selection requires another explicit Human authorization. It
must revalidate the retained approval marker rather than infer authorization
from its existence, use the same exact source/profile and supported Node 22,
confirm the absolute Runtime executable before selection, then prove through
the real UI: Collaboration `connected`, current availability, retained Project
focus, and Coordinator-visible online User and Agent counts. Any failure keeps
the same stop-U0-first exact rollback order.

Receipt generated on 2026-08-27 (Asia/Shanghai).
