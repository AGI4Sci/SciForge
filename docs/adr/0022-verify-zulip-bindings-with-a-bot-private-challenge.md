---
status: accepted
reviewed: 2026-08-17
---

# Verify Zulip bindings with a Bot private challenge

Regardless of any upstream human-authentication mechanism, a SciForge collaboration UserPrincipal must prove control of a specific Zulip Provider Instance and immutable Zulip user ID through a short-lived, one-time Bot private-message challenge before the binding becomes active. The additional interaction prevents email, username, display-name, or unverified provider-claim matching from silently binding the wrong communication endpoint.

## Current applicability

The private challenge remains effective and is implemented in provider-neutral form by the current collaboration contracts and provider runtime. The operative rule is proof of control over the exact `(provider, realmId, providerUserId)` identity before binding.
