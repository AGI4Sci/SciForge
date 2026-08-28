## Context

See `proposal.md` for motivation and `specs/agentic-project-workspace-navigation/spec.md` for observable behavior. The current Host sidebar owns local Workspace/Thread navigation under the user-visible title “Projects”. `domain-project-coordinator` already owns the canonical workspace read/create capabilities and a package-owned Collaboration Center right panel, but no generic Host slot can place a domain-owned section in the left navigation. The Team integration task is concurrently changing membership, invitation, provisioning, dispatch and continuation; this donor must not touch those state machines.

## Goals / Non-Goals

**Goals:**

- Add one generic renderer contribution location that any installed domain can use without Host feature switches.
- Let Project Coordinator own the complete Cloud Projects renderer, reads and activation payloads.
- Make a draft Workbench session sufficient to open the canonical create HCI when no persistent Thread exists.
- Let an unbound ordinary Agent Runtime Session start a Project chat-first through the canonical Agent capability surface, then bind only the successful create receipt.
- Group existing local Agent Runtime Sessions under a Cloud Project and bind their composer context to an exact canonical collaboration scope without teaching Host about Project IDs.
- Keep the donor small enough to cherry-pick after the Team snapshot with narrow conflict resolution.
- Preserve the existing sidebar design system while making Cloud lifecycle visibly distinct from local folders.

**Non-Goals:**

- Creating Project, Membership, invitation, Team-root, Task or review facts from the sidebar itself.
- Changing Cloud schemas, Project provisioning order, continuation, Agent capability audiences/approvals, evidence review or final artifact semantics.
- Making a local Thread the identity or persistence boundary of a Cloud Project.
- Building a second full-page Project router or replacing the existing Collaboration Center.

## Decisions

### 1. Reuse `renderer.extension` with a strict navigation-section location

Domain SDK adds a strict `workbench.navigation-section` contract/version and render-value guard while retaining `renderer.extension` as the manifest contribution kind. The renderer contribution registry recognizes this location, registers it in a deterministic owned slot and exposes it to Workbench. Sidebar receives the registered list as ordinary props and renders it with a generic current-session context.

This keeps Host ignorant of Project Coordinator and avoids a new parallel renderer contribution family. Reusing the existing workspace-section contract was rejected because that contract composes sections inside a package-owned workspace; the global Host sidebar has different ownership and lifecycle.

### 2. Project Coordinator owns all Cloud-specific presentation and activation

`domain-project-coordinator` contributes a `ProjectCoordinatorSidebarSection`. It creates the existing renderer capability client, reads `workspaceRead`, and maps only the returned Project views into rows. Each Project expands to ordinary local Agent Runtime Sessions selected by a package-owned Project-session projection plus Tasks, Files, Decisions and Activity/Recovery tools. Selecting a Session delegates to the same Host Session selection callback used by Local Workspaces; opening a Project tool calls the existing Project Coordinator command/right-panel contribution with the exact `projectId` and an optional package-owned view intent. New Project uses the same activation with `create` intent; the panel opens its existing form, which invokes canonical `project.create` only after confirmation.

The Host receives no Project DTO and contains no `project-coordinator` identifier. It exposes only a bounded catalog of its existing Sessions and the canonical Session selection action in the generic navigation render context. Calling `project.create` directly from the sidebar was rejected because it would duplicate form validation, confirmation and ownership logic.

This does not prohibit chat-first creation. An ordinary Session's Agent may discover and invoke the same `project.create` capability through the Host Agent tool surface. The distinction is ownership: the sidebar is presentation-only, while natural language and HCI both converge on the one governed capability.

### 3. A package-local invalidation signal accelerates canonical rereads

The Project Coordinator renderer client publishes a package-local invalidation only after canonical create returns successfully. The sidebar subscribes and performs a fresh workspace read. It also refreshes on document visibility and a bounded interval so another Device or Cloud event becomes visible. The signal contains at most an optional Project ID and is never treated as proof that a Project exists; the new row appears only from a subsequent canonical projection.

Optimistically inserting the create response into sidebar state was rejected because a renderer cache would become a second Project list and could leak across identity changes.

### 4. Draft sessions are valid presentation owners, not Cloud identities

Workbench passes the same stable session owner already used by right-panel surfaces: the active Thread ID when present, otherwise the draft-session owner derived from the selected local Workspace. It also passes a bounded presentation-only catalog of existing ordinary Sessions and the existing canonical selection callback. This allows “New Project” from an empty sidebar without creating a hidden Thread and lets Cloud Project rows reuse already-created Coordinator/Worker Runtime Sessions. The draft session scopes presentation only; Cloud derives User/Device/Coordinator from authenticated canonical commands.

Inventing a new “Coordinator conversation” entity was rejected. Coordinator and Worker conversations are ordinary local Runtime Sessions; Project grouping is an explicit binding/projection, and private transcript never becomes a shared Cloud fact.

### 5. The visual signature is a quiet Cloud lifecycle rail

The subject is a scientific collaboration control room; the sidebar's single job is to distinguish durable Cloud work from local coding context at a glance. The token plan uses the existing SciForge variables, with these reference values only as design intent: Cloud blue `#4C78E8`, ready green `#2F8F6B`, attention amber `#B7791F`, graphite ink `#263244`, and cool mist `#EEF2F7`. Production CSS uses existing semantic variables rather than new raw colors.

Typography remains the product's current sans stack: 13px medium for Project names, 11px utility for status, and 12px for child routes. Layout is compact and vertical:

```text
Cloud Projects                         ↻  +
│ ● Multi-user design review            Working
│   ├ Sessions
│   │  └ Review experiment plan
│   ├ Tasks
│   ├ Files
│   ├ Decisions
│   └ Activity / Recovery

Local Workspaces                       ⌕  ▣  +
  ▾ default
      Agent thread
```

Only the selected/expanded Project reveals its local Sessions and tool routes; this is the deliberate revision from an initial always-expanded tree, which would become noisy with many Projects and read like a generic file browser. The status rail is the one visual risk: it borrows the logic of an experiment timeline, but stays quiet, uses no ambient animation, and reports only canonical lifecycle facts.

### 6. View intents remain package-owned and fail safe

The activation schema accepts a closed sidebar intent (`overview`, `tasks`, `files`, `decisions`, `recovery`, or `create`). The panel maps these to its built-in or manifest-contributed workspace navigation after it has collected installed sections. If a contributed Files section is absent, it falls back to overview. The activation cannot carry locator, membership, Task revision, capability handle or authority.

Allowing arbitrary Host view IDs was rejected because it would leak internal navigation contracts and permit stale or uninstalled section activation.

### 7. Ordinary Sessions receive role-scoped Project context, not a second Project API

An ordinary persistent Session starts in an explicit unbound state. While unbound, its Agent receives authenticated Principal readiness but no Project scope, and may discover/check prerequisites and invoke the existing canonical `project.create`. A package-owned durable binding is committed only after that invocation returns a validated canonical receipt; the binding uses the exact returned `projectId`, current `runtimeId` and current `threadId`. Rejection, approval cancellation, transport failure, invalid receipt, or a create result without the exact Session identity leaves the Session unbound. No renderer callback, optimistic row or session title may synthesize the binding.

This gives Chat-first Collaboration the same transition as the HCI without creating a Project-specific chat/runtime. The successful binding then supplies Project scope for invitation, Plan, Project-scoped Team-root provisioning, dispatch and review. Those later operations remain governed by current membership/authority and are never implied merely by the existence of the local binding.

One local Session may be explicitly projected into one Cloud Project collaboration scope. Worker execution Sessions reuse the already durable `{projectId, taskId, executionId, runtimeId, threadId}` binding in Collaboration's task-run journal. Coordinator Sessions require an explicit package-owned binding to the exact Project and current coordinator authority; they are not inferred from title, Workspace path or the fact that a Plan run happened once. A transfer, membership removal, execution fence or identity change narrows/removes the current operational scope from canonical facts without deleting the private local transcript.

A standard `renderer.composer-context-provider` resolves the current Session binding, rereads the exact Project/task through canonical projections, and contributes a bounded summary containing Project identity, lifecycle/revision and either coordinator-project or exact worker-execution scope. It never contributes secrets, credentials or treats role text as authority. Each Device sees only its own ordinary Sessions under the Project; no Coordinator/Worker transcript is synchronized to another User.

The Host already exposes the canonical `sciforge_discover`, `sciforge_observe`, `sciforge_invoke` and `sciforge_events` tools to Agent runtimes. Those tools, not the composer provider, own operation discovery, approval, invocation, receipts and events. Enabling appropriate Project Coordinator capabilities for the `agent` audience is therefore an integration responsibility of the Team state-machine owner; this donor neither changes capability audiences nor implements a parallel command interpreter. Injecting a hidden prompt that directly calls renderer methods was rejected because it would bypass capability governance and make UI and conversation mutate different systems.

## Risks / Trade-offs

- [The generic slot is introduced for one immediate domain] → Keep its contract presentation-only, versioned and fully tested with a second fixture contribution; do not add domain fields.
- [Polling can add Cloud reads] → Refresh only while visible, use a bounded interval, ignore overlapping/stale requests and provide manual refresh.
- [Identity changes during an in-flight read] → Sequence reads and clear Project rows on non-ready/different-User projections; never merge results across observations.
- [Team integration changes the Project Coordinator renderer client] → Keep this donor free of Cloud/state-machine edits and resolve only the narrow activation/invalidation wrapper after the Team snapshot.
- [Nested routes imply capabilities not installed] → Resolve routes against installed navigation contributions and fail back to the Project overview.
- [A draft session might be mistaken for a Project conversation] → Copy and contracts describe it only as a presentation owner; no Thread is created or bound to Project identity.
- [A failed chat-first create could leave a phantom Project Session] → Persist the binding only after validating the canonical create receipt and exact current ordinary Session identity; failure paths are tested to remain unbound.
- [Session binding or prompt context could become stale or authorize a write] → Project current scope from fresh Cloud authority/fence facts, treat prompt content only as bounded orientation, and require all operations to be rediscovered/invoked through the Host agent capability surface.

## Migration Plan

1. Add and test the Domain SDK contract/value guard and renderer-owned registry slot.
2. Render generic navigation sections above Local Workspaces and pass the existing active-or-draft session context.
3. Add the Project Coordinator manifest contributions, package-owned sidebar component, active-Project composer context, activation mapping and canonical-read invalidation.
4. Regenerate standard composition/capability artifacts and run focused renderer, package, type, lint and architecture gates.
5. Commit the clean donor without pushing; after the Team snapshot, rebase/cherry-pick and rerun all affected gates before any PR decision.

Rollback removes the Project Coordinator contribution and generic slot together; Local Workspaces remain functional because they do not depend on the extension registry.
