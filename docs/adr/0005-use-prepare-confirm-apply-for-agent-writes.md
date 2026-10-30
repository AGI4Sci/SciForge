---
status: accepted
---

# Use prepare-confirm-apply for Agent document writes

Every Agent document creation or change is first prepared as a non-mutating proposal containing its target, impact preview, authoritative base revision or creation precondition, and operation digest. The existing Capability Broker can authorize apply only when the confirmer is the Human Principal owning the execution node’s selected Provider Connection; Project initiator status cannot substitute, and absence of that confirmer returns `human_action_required`. This adds a round trip but prevents opaque, cross-principal, and stale writes.
