# Visible Window Action Design

Date: 2026-06-04

## Goal

SciForge should match the useful parts of Codex app's computer-use experience without keeping the old isolated `VirtualAppScreen` product model.

The target user experience is:

```text
circle or comment on something
  -> annotation refs become context
  -> user says "change this to X"
  -> agent automatically enters the bound real window
  -> agent cursor visibly performs the work
  -> before/after evidence is shown in Image / Evidence Pane
```

Target apps may be real visible windows. They may be placed behind other windows when idle. When an action needs real system focus, SciForge may briefly bring the target window forward or take focus.

## Product Boundaries

Annotation is separate from Computer Use.

Annotation owns:

- `annotationRef`
- `imageRef`
- `targetRef`
- `windowBinding`
- pending composer context

Annotation does not own:

- action execution
- input adapters
- action leases
- task completion
- provider routing

Agent Host owns:

- intent classification
- automatic transition from bound annotation to WindowActionSession
- completion judgement
- repair and retry policy

WindowActionSession owns:

- target window/session refs
- actor cursor state
- scoped input adapter refs
- action timeline
- pause / stop / remove controls
- before/after evidence refs

Computer Use owns:

- action/input adapter facade
- execute/verify/writeTrace style host-port behavior
- refs-first evidence and replay material

Computer Use does not own:

- annotation
- GUI rendering
- user-level completion
- a standalone virtual-screen product model

## Automatic Window Action

Bound annotation plus mutating user intent automatically creates or reuses a WindowActionSession.

```text
annotationRef + mutating user message
  -> Agent Host checks windowBinding
  -> manual-bound or high-confidence auto-bound
  -> create/reuse WindowActionSession
  -> attach actorCursor(agentSessionId)
  -> attach ScopedInputAdapter(agentSessionId)
  -> dispatch through Action Adapter
  -> write before/after evidence
```

`unbound`, `blocked`, low-confidence candidates, and image-only refs must not auto-upgrade into executable targets. They remain context until the user identifies a window or creates an App window annotation.

M1 does not implement a permission or risk confirmation system. The agent can freely operate the target window. The required control surface is pause, stop current session, remove window, visible actor state, and action evidence.

## Scoped Input Adapter

Each agent session has its own logical input adapter:

```text
AgentSession
  -> actorCursor
  -> ScopedInputAdapter
  -> WindowActionSession
  -> Action Adapter
```

`ScopedInputAdapter` does not mean the OS has multiple independent physical mice. It means each agent has its own input queue, target binding, lease refs, actor cursor projection, and evidence refs.

Suggested fields:

```text
scopedInputAdapterRef
agentSessionId
actorCursorRef
targetWindowRef
inputQueueRef
inputLeaseRef
focusLeaseRef?
adapterKind
controlMode
lastActionRef
```

## Adapter Order

Use the least disruptive adapter that can complete the action:

```text
1. Browser/CDP/Playwright/WebContentsView
2. App-native command or extension command
3. Terminal / PTY command
4. Accessibility/UI Automation/AT-SPI
5. Vision/OCR grounded adapter over an executable backend
6. Focused system input
```

Non-focus adapters can run concurrently. Actions requiring the real desktop focus, system keyboard, pointer, menu bar, or IME must acquire a global `FocusLease` and run serially.

## Focus Lease

`FocusLease` is the honest boundary for visible desktop takeover.

```text
focusLeaseRef
agentSessionId
actorCursorRef
targetWindowRef
startedAt
endedAt?
reason
actionRefs
```

When focus takeover is used, UI and evidence must show the active agent, target window, action status, and focus lease. The product may bring the target window forward briefly.

## Evidence

Every mutating action should produce:

- source annotation refs when present
- target window/session refs
- actor cursor ref
- scoped input adapter ref
- action event ref
- before/after evidence refs
- focus lease ref when focus takeover is used
- result or verification refs

Image / Evidence Pane remains presentation-only. It can show annotation crops, screenshots, before/after images, provenance, and action timeline links. It must not become a live control surface.

## Migration Notes

Replace active `VirtualAppScreen` wording with:

- `WindowActionSession`
- `actorCursor`
- `ScopedInputAdapter`
- `FocusLease`
- `Image / Evidence Pane`

Keep old virtual-screen, noVNC, Xpra, virtual display, and native-driver smoke as historical compatibility or backend research only. They must not produce current product pass evidence.

## Acceptance

- Annotation refs become pending context.
- Bound annotation plus mutating intent automatically enters WindowActionSession.
- Each agent session has an actorCursor and ScopedInputAdapter.
- Focus-required desktop actions use FocusLease.
- Pause, stop, and remove controls are visible.
- Before/after evidence is refs-first and shown in Image / Evidence Pane.
- Annotation does not execute actions.
- GUI does not call Computer Use executors directly.
