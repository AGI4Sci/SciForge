---
status: accepted
reviewed: 2026-08-17
---

# Bind Projects to exclusive shared content directories

Cloud Collaboration owns a separately versioned Project Content Space Binding from one Project to at most one shared Content Container Reference. Only the Project Owner may bind, replace, or unbind; one directory cannot serve two Projects; Provider ACL remains authoritative; and Project archival or deletion never deletes Provider content. Project Tasks are further restricted to that directory and descendants even when the executing owner's Provider account can access more.
