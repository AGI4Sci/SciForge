---
status: accepted
amends: ADR-0039
---

# Deliver Task Offers durably to Users and bind the winning Device on claim

One Task Offer belongs to a Worker User and is delivered through the existing durable Inbox to every active Agent Device owned by that User, without requiring an online Runtime when the Offer is created. A Human click on one Device releases the existing authenticated Agent claim path; the atomic Cloud claim records that Device and Agent in the Execution fence, while rejection closes the shared Offer and local dismissal only hides the current Device's view.

An accepted Execution cannot move between Devices. A failed, cancelled, or revoked assignment is explicitly re-dispatched as a new Offer and new Execution, including when the same Worker User is selected again. Automatic acceptance is outside the scientific MVP.
