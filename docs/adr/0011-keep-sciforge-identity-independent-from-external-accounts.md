---
status: accepted
---

# Keep SciForge identity independent from external accounts

SciForge owns its User identity and uses it for Agent, device, Project, and collaboration relationships; OpenContent and other service accounts connect only through explicit, revocable External Account Bindings. Provider accounts, provider sessions, and matching attributes such as email addresses never create or merge a SciForge User automatically. This adds a binding and lifecycle-management burden, but prevents an external document provider from becoming the identity authority for the SciForge platform.
