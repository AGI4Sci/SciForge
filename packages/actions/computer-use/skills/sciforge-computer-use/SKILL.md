---
name: sciforge-computer-use
description: Use SciForge Computer Use through the TS-only Agent Host / WindowActionSession product path with refs-first evidence and scoped host-port actions.
---

# SciForge Computer Use

Use this skill for Computer Use tasks that need visible GUI observation,
bounded target-window actions, current-run evidence, approval handoff, and
verification. The active path is TypeScript-only:

```text
Agent Host -> WindowActionSession -> TypeScript host-port contract -> current evidence bundle
```

## Boundary

- Treat Codex app-server or Codex CLI as the L2 host. Computer Use is an
  L1/L0 action adapter, not a task brain.
- Use current app/window/session refs, screenshot or crop refs, accessibility
  or DOM/AX observation refs, before/after evidence, action ledger refs, and
  verifier refs.
- DOM/AX/Playwright evidence may guide observation and grounding, but it cannot
  bypass the Computer Use lease, executor event, before/after evidence, or
  validator.
- High-risk actions must stop at `needs-confirmation` and return approval refs.
  Confirmation and user-level completion stay with the L2 host.
- The retired Python package, pytest suite, Docker/noVNC isolated desktop
  probes, M6 Python demo, and VirtualAppScreen runtime/provider package must
  not be used as product/default Computer Use acceptance.

## Expected Evidence

- target app/window/session refs
- current screenshot/crop or image evidence refs
- input intent and scoped executor event refs
- before/after evidence and action ledger refs
- artifact refs when files are created or modified
- verifier or human approval refs for risky or user-visible completion
